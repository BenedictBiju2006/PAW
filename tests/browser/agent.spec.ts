import { test, expect, type Page } from "@playwright/test";
import {
  showChat,
  newConversation,
  openConversations,
  developerTools,
  showInterface,
} from "./navigation";
import { createClient } from "@supabase/supabase-js";
// UI transport fixtures only. Scripted real-database orchestration is separately
// exercised by integration.test.ts. Ordinary tests never call a paid provider.
test("native streaming transcript, tools, mutation refresh, safe Markdown and conversation isolation", async ({
  page,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const origin = process.env.PAW_BROWSER_TEST_URL!;
  let selected = { provider: "openai", model: "gpt-4.1-mini" };
  const providers = [
    { id: "openai", name: "OpenAI", model: "gpt-4.1-mini" },
    { id: "google", name: "Gemini", model: "gemini-3.8-flash" },
    { id: "groq", name: "Groq", model: "llama-3.3-70b-versatile" },
  ].map((p) => ({
    ...p,
    configured: true,
    models: [p.model],
    tokenWarning: 100000,
  }));
  await page.route("**/api/ai-settings", async (route) => {
    const method = route.request().method();
    if (method === "PATCH" || method === "PUT") {
      const body = route.request().postDataJSON();
      selected = { provider: body.provider, model: body.model };
    }
    if (method === "DELETE") {
      providers.find(
        (p) => p.id === route.request().postDataJSON().provider,
      )!.configured = false;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({
      json: {
        providers,
        configured: providers.find((p) => p.id === selected.provider)!
          .configured,
        encryptionReady: true,
        ...selected,
        models: providers.find((p) => p.id === selected.provider)!.models,
        tokenWarning: 100000,
        usage: { input: 0, output: 0, cost: null, period: "Test fixture" },
        warning: false,
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`agent${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("PAW-local-test-password-123!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your workspaces" }),
  ).toBeVisible();
  const actor = (await (await page.request.get("/api/auth/session")).json())
    .user.id;
  const workspace = await (
    await page.request.post("/api/workspaces", {
      headers: { Origin: origin },
      data: { name: "Streaming room" },
    })
  ).json();
  await page.goto(`/?workspace=${workspace.id}`);
  await showChat(page);
  await newConversation(page);
  await page
    .getByLabel("AI model", { exact: true })
    .selectOption("google:gemini-3.8-flash");
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let count = 0;
  await page.route("**/api/agent", async (route) => {
    count++;
    const body = route.request().postDataJSON();
    const snapshot = { ...selected };
    const start = await admin.rpc("start_agent_turn", {
      actor,
      turn: body.turnId,
      workspace: workspace.id,
      conversation: body.conversationId,
      request_hash: "ui-fixture",
      user_text: body.text,
      model_provider: snapshot.provider,
      model_id: snapshot.model,
    });
    expect(start.error).toBeNull();
    const collection = await page.request.post(
      `/api/workspaces/${workspace.id}/collections`,
      {
        headers: { Origin: origin },
        data: {
          name: "Agent notes",
          fields: [
            { key: "title", label: "Title", type: "string", required: true },
          ],
        },
      },
    );
    expect(collection.ok()).toBeTruthy();
    const activity = {
      invocationId: `${body.turnId}:1`,
      toolId: "create_collection",
      arguments: { name: "Agent notes" },
      status: "completed",
      result: { ok: true },
    };
    const text =
      "## Workspace updated\n\nYour **notes** are ready.\n\n```text\nSafe code example\n```\n\n<script>window.pawUnsafe=true</script>\n[Unsafe](javascript:alert(1))";
    expect(
      (
        await admin.rpc("append_agent_event", {
          actor,
          turn: body.turnId,
          event: "text",
          message_role: "assistant",
          blocks: [{ type: "text", text }],
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await admin.rpc("append_agent_event", {
          actor,
          turn: body.turnId,
          event: "call",
          message_role: "assistant",
          blocks: [
            {
              type: "tool_call",
              invocationId: activity.invocationId,
              toolId: activity.toolId,
              arguments: activity.arguments,
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
          turn: body.turnId,
          event: "result",
          message_role: "tool",
          blocks: [
            {
              type: "tool_result",
              invocationId: activity.invocationId,
              toolId: activity.toolId,
              result: activity.result,
              isError: false,
            },
          ],
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await admin.rpc("finish_agent_turn", {
          actor,
          turn: body.turnId,
          final_status: "completed",
          input_count: 10,
          output_count: 20,
          explanation: null,
        })
      ).error,
    ).toBeNull();
    const surface = await page.request.put(
      `/api/workspaces/${workspace.id}/interface`,
      {
        headers: { Origin: origin },
        data: {
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
                    { id: "root", component: "Column", children: ["title"] },
                    {
                      id: "title",
                      component: "Text",
                      text: "Agent interface",
                      variant: "h2",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    );
    expect(surface.ok()).toBeTruthy();
    await responseGate;
    const chunks = [
      { type: "start", messageId: body.turnId },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: text.slice(0, 25) },
      { type: "text-delta", id: "text", delta: text.slice(25) },
      { type: "text-end", id: "text" },
      { type: "data-activity", id: activity.invocationId, data: activity },
      {
        type: "data-mutation",
        data: { workspaceId: workspace.id },
        transient: true,
      },
      {
        type: "data-turn",
        data: {
          id: body.turnId,
          status: "completed",
          usage: { input: 10, output: 20 },
        },
      },
      { type: "finish" },
    ];
    await route.fulfill({
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body:
        chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
        "data: [DONE]\n\n",
    });
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByLabel("Message", { exact: true }).fill("Create notes");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Message", { exact: true }).press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("AI model", { exact: true })
    .selectOption("groq:llama-3.3-70b-versatile");
  await showInterface(page);
  releaseResponse();
  await expect(
    page
      .locator(".primary-interface")
      .getByRole("heading", { name: "Agent interface", exact: true }),
  ).toBeVisible();
  await showChat(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole("heading", { name: "Workspace updated", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Live interface", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1 collection · Interface revision 1"),
  ).toHaveCount(0);
  expect(count).toBe(1);
  await expect(
    page
      .locator(".primary-interface")
      .getByRole("heading", { name: "Agent interface", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("log")).toContainText("Create notes");
  const savedTurns = await (
    await page.request.get(
      `/api/workspaces/${workspace.id}/conversations/${(await admin.from("agent_turns").select("conversation_id").eq("workspace_id", workspace.id).single()).data!.conversation_id}/turns`,
    )
  ).json();
  expect(savedTurns[0].provider).toBe("google");
  expect(savedTurns[0].model).toBe("gemini-3.8-flash");
  await expect(page.getByLabel("AI model", { exact: true })).toHaveValue(
    "groq:llama-3.3-70b-versatile",
  );
  await expect(page.locator(".tool-activity summary")).toContainText(
    "completed",
  );
  expect(await page.evaluate(() => Boolean((window as any).pawUnsafe))).toBe(
    false,
  );
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copy code", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI settings", exact: true }).click();
  const settingsDialog = page.getByRole("dialog", {
    name: "AI settings",
    exact: true,
  });
  await settingsDialog
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("google");
  await expect(
    settingsDialog.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue("gemini-3.8-flash");
  await settingsDialog
    .getByLabel("API key", { exact: true })
    .fill("fixture-replacement-key");
  await settingsDialog
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("groq");
  await expect(
    settingsDialog.getByLabel("API key", { exact: true }),
  ).toHaveValue("");
  await settingsDialog
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("google");
  await settingsDialog
    .getByLabel("API key", { exact: true })
    .fill("fixture-replacement-key");
  await settingsDialog
    .getByRole("button", { name: "Validate & save", exact: true })
    .click();
  await expect(settingsDialog.getByRole("status")).toContainText(
    "Model metadata checked",
  );
  await expect(
    settingsDialog.getByLabel("API key", { exact: true }),
  ).toHaveValue("");
  page.once("dialog", (dialog) => dialog.accept());
  await settingsDialog
    .getByRole("button", { name: "Remove key", exact: true })
    .click();
  await expect(settingsDialog.getByRole("status")).toContainText(
    "API key removed",
  );
  expect(providers.find((p) => p.id === "groq")!.configured).toBe(true);
  expect(providers.find((p) => p.id === "openai")!.configured).toBe(true);
  await settingsDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("Create notes");
  await newConversation(page);
  await expect(
    page.getByRole("heading", {
      name: "What would you like to create?",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Workspace updated", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await showChat(page);
  const conversations = (
    await (
      await page.request.get(`/api/workspaces/${workspace.id}/conversations`)
    ).json()
  ).conversations;
  // Both default titles are intentionally equal; select the first stored thread.
  const ordered = conversations.sort((a: any, b: any) =>
    a.created_at.localeCompare(b.created_at),
  );
  await openConversations(page);
  await page
    .getByRole("navigation", { name: "Conversations", exact: true })
    .getByRole("button", { name: "New conversation", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Workspace updated", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Conversations", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Conversations", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close conversations", exact: true })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/paw-agent-mobile.png", fullPage: true });
});
