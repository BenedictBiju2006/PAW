import { test, expect, type Page } from "@playwright/test";
import {
  openConversations,
  showChat,
  showInterface,
  newConversation,
  developerTools,
  conversationMenu,
} from "./navigation";
async function geometry(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true);
  const composer = page.locator(".chat-composer");
  if (await composer.isVisible()) {
    const box = await composer.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
  }
}
for (const width of [390, 768, 1024, 1440, 1920])
  test(`workspace navigation at ${width}px without screenshots`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const providers = [
      {
        id: "google",
        name: "Gemini",
        models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
        model: "gemini-3.8-flash",
        configured: true,
      },
      {
        id: "groq",
        name: "Groq",
        models: ["llama-3.3-70b-versatile"],
        model: "llama-3.3-70b-versatile",
        configured: true,
      },
    ];
    let selected = { provider: "google", model: "gemini-3.8-flash" };
    await page.route("**/api/ai-settings", async (route) => {
      if (route.request().method() === "PATCH")
        selected = route.request().postDataJSON();
      await route.fulfill({
        json: {
          ...selected,
          providers,
          configured: true,
          encryptionReady: true,
          models: providers.find((p) => p.id === selected.provider)!.models,
          tokenWarning: 100000,
          usage: { input: 0, output: 0, cost: null, period: "Fixture" },
          warning: false,
        },
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    await page
      .getByLabel("Email", { exact: true })
      .fill(`nav-${width}-${Date.now()}@example.com`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("PAW-local-test-password-123!");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your workspaces" }),
    ).toBeVisible();
    const request = async (path: string, data: unknown, method = "POST") => {
      const r = await page.request.fetch(`/api/${path}`, {
        method,
        headers: { Origin: process.env.PAW_BROWSER_TEST_URL! },
        data,
      });
      expect(r.ok(), await r.text()).toBe(true);
      return r.json();
    };
    const workspace = await request("workspaces", { name: "Movie workspace" }),
      base = `workspaces/${workspace.id}`;
    await page.goto(`/?workspace=${workspace.id}`);
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Start conversation" }),
    ).toHaveCount(0);
    expect(
      (await (await page.request.get(`/api/${base}/conversations`)).json())
        .conversations,
    ).toHaveLength(0);
    await geometry(page);
    await openConversations(page);
    await expect(
      page.getByRole("button", { name: "Interface", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "+ New chat", exact: true }),
    ).toBeVisible();
    if (width <= 1024) {
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Open navigation" }),
      ).toBeFocused();
    }
    await showInterface(page);
    await expect(
      page.getByText("Your interface has not been created yet."),
    ).toBeVisible();
    await geometry(page);
    const short = await request(`${base}/conversations`, {
        title: "Short conversation",
      }),
      long = await request(`${base}/conversations`, {
        title:
          "Long conversation with a deliberately descriptive and very lengthy title",
      });
    await request(`${base}/conversations/${short.id}/messages`, {
      text: "A short persisted message",
    });
    for (let i = 0; i < 12; i++)
      await request(`${base}/conversations/${long.id}/messages`, {
        text: `Message ${i}: ${"long content ".repeat(35)}`,
      });
    for (let i = 0; i < 14; i++)
      await request(`${base}/conversations`, {
        title: `Additional topic ${i}`,
      });
    await page.goto(`/?workspace=${workspace.id}&conversation=${long.id}`);
    await expect(page.getByRole("log")).toContainText("Message 11");
    await geometry(page);
    await openConversations(page);
    await expect(
      page
        .getByRole("navigation", { name: "Conversations" })
        .getByRole("button", { name: long.title, exact: true }),
    ).toHaveAttribute("title", long.title);
    await page
      .getByRole("navigation", { name: "Conversations" })
      .getByRole("button", { name: "Short conversation", exact: true })
      .click();
    await expect(page.getByRole("log")).toContainText(
      "A short persisted message",
    );
    await page.getByLabel("Message", { exact: true }).fill("Keep short draft");
    const collection = await request(`${base}/collections`, {
      name: "Films",
      fields: [
        { key: "title", label: "Title", type: "string", required: true },
        { key: "rating", label: "Rating", type: "number", required: true },
      ],
    });
    await request(`${base}/collections/${collection.id}`, {
      data: { title: "Arrival", rating: 5 },
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
                    children: ["heading", "form", "table", "chart"],
                  },
                  {
                    id: "heading",
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
    // Interface creation does not redirect an active chat. Selection loads persisted state.
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Keep short draft",
    );
    await showInterface(page);
    await expect(
      page
        .locator(".primary-interface")
        .getByRole("heading", { name: "Your movie tracker" }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "Arrival" })).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: "Value counts for rating across all records",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Add to Films", exact: true }),
    ).toBeVisible();
    const inspectedResponse = await page.request.get(`/api/${base}`);
    expect(inspectedResponse.ok()).toBeTruthy();
    const inspected = await inspectedResponse.json();
    const updated = await request(
      `${base}/interface`,
      {
        revision: inspected.revision,
        messages: [
          {
            version: "v0.9.1",
            updateComponents: {
              surfaceId: "workspace",
              components: [
                {
                  id: "form",
                  component: "CollectionForm",
                  collectionId: collection.id,
                  title: "Add a movie",
                },
                {
                  id: "table",
                  component: "DataTable",
                  collectionId: collection.id,
                  title: { path: "/tableTitle" },
                },
              ],
            },
          },
          {
            version: "v0.9.1",
            updateDataModel: {
              surfaceId: "workspace",
              path: "/tableTitle",
              value: "Saved movies",
            },
          },
        ],
      },
      "PATCH",
    );
    expect(updated.revision).toBe(inspected.revision + 1);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Saved movies", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Add a movie", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "Arrival" })).toBeVisible();
    const pane = await page.locator(".primary-interface").boundingBox();
    expect(pane!.width).toBeGreaterThan(width - (width > 1024 ? 280 : 1));
    await geometry(page);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Your movie tracker" }),
    ).toBeVisible();
    await newConversation(page);
    await expect(
      page.getByRole("heading", { name: "What would you like to create?" }),
    ).toBeVisible();
    await openConversations(page);
    await page
      .getByRole("navigation", { name: "Conversations" })
      .getByRole("button", { name: short.title, exact: true })
      .click();
    await page
      .getByLabel("Message", { exact: true })
      .fill("Draft after reload");
    await showInterface(page);
    await openConversations(page);
    await page
      .getByRole("navigation", { name: "Conversations" })
      .getByRole("button", { name: short.title, exact: true })
      .click();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Draft after reload",
    );
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Your movie tracker" }),
    ).toBeVisible();
    await page.goForward();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Draft after reload",
    );
    await page
      .getByLabel("AI model")
      .selectOption("google:gemini-3.5-flash-lite");
    await page
      .getByRole("button", { name: "AI settings", exact: true })
      .click();
    const settings = page.getByRole("dialog", {
      name: "AI settings",
      exact: true,
    });
    await expect(
      settings.getByRole("combobox", { name: "Provider", exact: true }),
    ).toBeVisible();
    await settings.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(
      settings.getByRole("button", { name: "Validate & save" }),
    ).toBeInViewport();
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await developerTools(page);
    await expect(
      page.getByRole("tab", { name: "Collections & data" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Interface builder" }).click();
    await expect(page.getByLabel("A2UI messages")).toBeVisible();
    await openConversations(page);
    await page
      .getByRole("button", { name: "Developer Tools", exact: true })
      .click();
    if (width <= 1024)
      await page.getByRole("button", { name: "Close navigation" }).click();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Draft after reload",
    );
    await geometry(page);
    const menu = await conversationMenu(page, short.title);
    page.once("dialog", (dialog) => dialog.accept("Manually renamed topic"));
    await menu.getByRole("button", { name: "Rename conversation" }).click();
    if (width <= 1024)
      await page.getByRole("button", { name: "Close navigation" }).click();
    await expect(
      page.getByRole("heading", { name: "Manually renamed topic" }),
    ).toBeVisible();
    const other = await request("workspaces", { name: "Other workspace" });
    await page.goto(`/?workspace=${other.id}&conversation=${short.id}`);
    await expect(page.getByRole("alert")).toContainText("not found");
    await expect(page.getByRole("log")).not.toContainText(
      "A short persisted message",
    );
  });
