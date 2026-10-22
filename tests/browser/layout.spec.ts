import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  openConversations,
  showChat,
  showInterface,
  developerTools,
} from "./navigation";

// Real authenticated persistence and official A2UI rendering; no live inference.
const widths = [390, 768, 1024, 1440, 1920];
const output = process.env.PAW_VISUAL_OUTPUT_DIR || "work/visual";
async function geometry(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    )
    .toBe(true);
  const composer = page.locator(".chat-composer");
  if (await composer.isVisible()) {
    const box = await composer.boundingBox();
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    const log = await page.getByRole("log").boundingBox();
    if (log) expect(log.height).toBeGreaterThan(80);
  }
}
for (const width of widths)
  test(`rendered workspace visual audit at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await mkdir(output, { recursive: true });
    const shot = async (state: string) => {
      await geometry(page);
      await page.screenshot({
        path: resolve(output, `${width}-${state}.png`),
        fullPage: true,
      });
    };
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const providers = [
      {
        id: "google",
        name: "Gemini",
        model: "gemini-3.8-flash",
        models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
      },
      {
        id: "groq",
        name: "Groq",
        model: "llama-3.3-70b-versatile",
        models: ["llama-3.3-70b-versatile"],
      },
    ].map((p) => ({ ...p, configured: true, tokenWarning: 100000 }));
    let active = { provider: "google", model: "gemini-3.8-flash" };
    await page.route("**/api/ai-settings", async (route) => {
      if (route.request().method() === "PATCH")
        active = route.request().postDataJSON();
      await route.fulfill({
        json: {
          ...active,
          configured: true,
          encryptionReady: true,
          providers,
          models: providers.find((p) => p.id === active.provider)!.models,
          tokenWarning: 100000,
          warning: false,
          usage: {
            input: 1500,
            output: 800,
            cost: null,
            period: "Visual fixture",
          },
        },
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await page
      .getByLabel("Email", { exact: true })
      .fill(`visual-${width}-${Date.now()}@example.com`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("PAW-visual-test-password-123!");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your workspaces" }),
    ).toBeVisible();
    const origin = process.env.PAW_BROWSER_TEST_URL!;
    const actor = (await (await page.request.get("/api/auth/session")).json())
      .user.id;
    const request = async (path: string, data: unknown, method = "POST") => {
      const response = await page.request.fetch(`/api/${path}`, {
        method,
        headers: { Origin: origin },
        data,
      });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const workspace = await request("workspaces", { name: "Movie workspace" });
    const base = `workspaces/${workspace.id}`;
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    for (const title of ["Short conversation", "Long conversation"]) {
      const conversation = await request(`${base}/conversations`, { title });
      const turn = randomUUID();
      expect(
        (
          await admin.rpc("start_agent_turn", {
            actor,
            turn,
            workspace: workspace.id,
            conversation: conversation.id,
            request_hash: turn,
            user_text:
              title === "Short conversation"
                ? "Create a movie tracker."
                : "Add a chart and explain the updated tracker.",
            model_provider: "google",
            model_id: "gemini-3.8-flash",
          })
        ).error,
      ).toBeNull();
      const text =
        title === "Short conversation"
          ? "Describe what you want to build. Your workspace is ready."
          : Array.from(
              { length: 18 },
              (_, i) =>
                `### Update ${i + 1}\n\nYour tracker keeps films, ratings, and watched status together. This paragraph verifies independent message scrolling while the composer stays visible.\n\n\`\`\`text\n${"long-data-".repeat(30)}\n\`\`\``,
            ).join("\n\n");
      expect(
        (
          await admin.rpc("append_agent_event", {
            actor,
            turn,
            event: "text",
            message_role: "assistant",
            blocks: [{ type: "text", text }],
          })
        ).error,
      ).toBeNull();
      if (title === "Long conversation") {
        expect(
          (
            await admin.rpc("append_agent_event", {
              actor,
              turn,
              event: "call",
              message_role: "assistant",
              blocks: [
                {
                  type: "tool_call",
                  invocationId: `${turn}:1`,
                  toolId: "save_interface",
                  arguments: {
                    revision: 1,
                    definition: {
                      description: "Validated movie interface",
                      components: Array(12).fill("collection-backed component"),
                    },
                  },
                  status: "running",
                },
              ],
            })
          ).error,
        ).toBeNull();
        expect(
          (
            await admin.rpc("append_agent_event", {
              actor,
              turn,
              event: "result",
              message_role: "tool",
              blocks: [
                {
                  type: "tool_result",
                  invocationId: `${turn}:1`,
                  toolId: "save_interface",
                  result: { ok: true, revision: 2 },
                  isError: false,
                },
              ],
            })
          ).error,
        ).toBeNull();
      }
      expect(
        (
          await admin.rpc("finish_agent_turn", {
            actor,
            turn,
            final_status: "completed",
            input_count: 1000,
            output_count: 300,
            explanation: null,
          })
        ).error,
      ).toBeNull();
    }
    await page.goto(`/?workspace=${workspace.id}`);
    await expect(
      page.getByRole("button", { name: /Developer Tools/ }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    await openConversations(page);
    await page
      .getByRole("navigation", { name: "Conversations", exact: true })
      .getByRole("button", { name: "Short conversation", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Short conversation", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("log")).toContainText(
      "Describe what you want to build.",
    );
    await shot("short-empty-chat");
    await showInterface(page);
    await expect(
      page.getByText("Your interface will appear here.", { exact: true }),
    ).toBeVisible();
    await shot("empty-interface");
    const collection = await request(`${base}/collections`, {
      name: "Films",
      fields: [
        { key: "title", label: "Title", type: "string", required: true },
        { key: "rating", label: "Rating", type: "number", required: true },
        { key: "watched", label: "Watched", type: "boolean", required: false },
      ],
    });
    for (const [title, rating] of [
      ["Arrival", 5],
      ["Spirited Away", 5],
      ["The Grand Budapest Hotel", 4],
    ] as const)
      await request(`${base}/collections/${collection.id}`, {
        data: { title, rating, watched: true },
      });
    await request(
      `${base}/interface`,
      {
        revision: workspace.revision,
        definition: {
          messages: [
            {
              version: "v0.9.1",
              createSurface: {
                surfaceId: "workspace",
                catalogId: "https://paw.local/catalogs/workspace-v1.json",
              },
            },
            {
              version: "v0.9.1",
              updateComponents: {
                surfaceId: "workspace",
                components: [
                  {
                    id: "root",
                    component: "Column",
                    children: ["title", "form", "table", "chart"],
                  },
                  {
                    id: "title",
                    component: "Text",
                    text: "Your movie tracker",
                    variant: "h2",
                  },
                  {
                    id: "form",
                    component: "CollectionForm",
                    collectionId: collection.id,
                  },
                  {
                    id: "table",
                    component: "DataTable",
                    collectionId: collection.id,
                  },
                  {
                    id: "chart",
                    component: "CollectionChart",
                    collectionId: collection.id,
                    field: "rating",
                  },
                ],
              },
            },
          ],
        },
      },
      "PUT",
    );
    await page.reload();
    await showInterface(page);
    await expect(
      page
        .locator(".primary-interface")
        .getByRole("heading", { name: "Your movie tracker", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".primary-interface")
        .getByRole("cell", { name: "Arrival", exact: false }),
    ).toBeVisible();
    await expect(
      page.locator(".primary-interface").getByRole("img", {
        name: "Value counts for rating across all records",
        exact: true,
      }),
    ).toBeVisible();
    await shot("populated-interface");
    await showChat(page);
    await page
      .getByLabel("Message", { exact: true })
      .fill("Draft survives expanding the interface.");
    await showInterface(page);
    const pane = await page.locator(".primary-interface").boundingBox();
    await page
      .getByRole("button", { name: "Expand interface", exact: true })
      .click();
    await expect(
      page
        .locator(".primary-interface")
        .getByRole("cell", { name: "Arrival", exact: false }),
    ).toBeVisible();
    await shot("expanded-interface");
    const expanded = await page.locator(".primary-interface").boundingBox();
    if (width >= 1280)
      expect(expanded!.width).toBeGreaterThan(pane!.width * 1.7);
    // The renderer and its fields grow with the pane, preserving record interactions.
    const fields = await page
      .locator(".primary-interface .record-fields")
      .first()
      .boundingBox();
    expect(fields!.width).toBeLessThan(expanded!.width);
    await page
      .locator(".interface-content")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await shot("expanded-interface-bottom");
    if (width === 390) {
      await page
        .locator(".primary-interface")
        .getByRole("button", { name: "Edit", exact: true })
        .first()
        .scrollIntoViewIfNeeded();
      await expect(
        page
          .locator(".primary-interface")
          .getByRole("button", { name: "Delete", exact: true })
          .first(),
      ).toBeInViewport();
      await shot("narrow-table-actions");
    }
    await page
      .getByRole("button", { name: "Restore interface", exact: true })
      .click();
    await showChat(page);
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Draft survives expanding the interface.",
    );
    await openConversations(page);
    const composerBefore = await page.locator(".chat-composer").boundingBox();
    await shot("conversation-drawer");
    expect(await page.locator(".chat-composer").boundingBox()).toEqual(
      composerBefore,
    );
    await page
      .getByRole("navigation", { name: "Conversations", exact: true })
      .getByRole("button", { name: "Long conversation", exact: true })
      .click();
    await expect(page.locator(".tool-activity summary")).toBeVisible();
    await page.locator(".tool-activity summary").click();
    await shot("long-tools");
    await page
      .getByLabel("Message", { exact: true })
      .fill("Keep this draft across views.");
    await showInterface(page);
    await showChat(page);
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Keep this draft across views.",
    );
    await page
      .getByLabel("AI model", { exact: true })
      .selectOption("google:gemini-3.5-flash-lite");
    await expect(page.getByLabel("AI model", { exact: true })).toHaveValue(
      "google:gemini-3.5-flash-lite",
    );
    await shot("model-selected");
    await page
      .getByRole("button", { name: "AI settings", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "AI settings",
      exact: true,
    });
    await expect(
      dialog.getByRole("combobox", { name: "Provider", exact: true }),
    ).toBeVisible();
    await shot("ai-settings");
    await dialog.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(
      dialog.getByRole("button", { name: "Validate & save", exact: true }),
    ).toBeInViewport();
    await shot("ai-settings-bottom");
    await dialog.evaluate((el) => (el.scrollTop = 0));
    await dialog
      .getByRole("combobox", { name: "Provider", exact: true })
      .selectOption("groq");
    await expect(
      dialog.getByRole("combobox", { name: "Model", exact: true }),
    ).toHaveValue("llama-3.3-70b-versatile");
    await shot("ai-settings-groq");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await developerTools(page);
    await shot("developer-data");
    await page
      .getByRole("tab", { name: "Interface builder", exact: true })
      .click();
    await expect(page.getByLabel("A2UI messages")).toBeVisible();
    await shot("developer-builder");
    await page.getByRole("button", { name: /Developer Tools/ }).click();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Keep this draft across views.",
    );
    if (width === 390) {
      await page.setViewportSize({ width, height: 560 });
      await geometry(page);
      await page.screenshot({
        path: resolve(output, `${width}-keyboard-height.png`),
      });
    }
    // Each conversation keeps its own draft when its thread remounts.
    const selectConversation = async (title: string) => {
      await openConversations(page);
      await page
        .getByRole("navigation", { name: "Conversations", exact: true })
        .getByRole("button", { name: title, exact: true })
        .click();
    };
    await selectConversation("Short conversation");
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
    await page
      .getByLabel("Message", { exact: true })
      .fill("Short thread draft.");
    await selectConversation("Long conversation");
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Keep this draft across views.",
    );
    await selectConversation("Short conversation");
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Short thread draft.",
    );
    await selectConversation("Long conversation");
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Keep this draft across views.",
    );
  });
