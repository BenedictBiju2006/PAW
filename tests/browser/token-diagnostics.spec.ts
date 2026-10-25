import { test, expect } from "@playwright/test";

test("Developer Tools displays per-request tokens separately from context character estimates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`tokens-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("PAW-local-test-password-123!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your workspaces" }),
  ).toBeVisible();
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/${path}`, {
      headers: { Origin: process.env.PAW_BROWSER_TEST_URL! },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const workspace = await post("workspaces", { name: "Token audit" });
  const conversation = await post(`workspaces/${workspace.id}/conversations`, {
    title: "Inspect token growth",
  });
  const requests = [1, 2, 3].map((request) => ({
    request,
    provider: "google",
    model: "fixture-model",
    status: "completed",
    inputTokens: request * 100,
    outputTokens: 10,
    cachedInputTokens: request === 2 ? 0 : null,
    cumulativeInputTokens: request * (request + 1) * 50,
    cumulativeOutputTokens: request * 10,
    contextCharacters: {
      system: 4000,
      history: 1200,
      tools: 5000,
      exchanges: (request - 1) * 3000,
    },
  }));
  await page.route("**/conversations/*/turns", (route) =>
    route.fulfill({
      json: [
        {
          id: "fixture-turn",
          provider: "google",
          model: "fixture-model",
          status: "completed",
          input_tokens: 600,
          output_tokens: 30,
          model_requests: 3,
          tool_calls: 2,
          cached_input_tokens: 0,
          request_diagnostics: requests,
        },
        {
          id: "legacy-turn",
          provider: "openai",
          model: "legacy",
          status: "completed",
          input_tokens: 12,
          output_tokens: 3,
          model_requests: 1,
          tool_calls: 0,
          cached_input_tokens: null,
          request_diagnostics: [],
        },
      ],
    }),
  );
  await page.goto(
    `/?workspace=${workspace.id}&conversation=${conversation.id}`,
  );
  await page
    .getByRole("button", { name: "Developer Tools", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Token diagnostics",
    exact: true,
  });
  await expect(
    panel.getByRole("heading", { name: "Token diagnostics" }),
  ).toBeVisible();
  await panel
    .locator("summary")
    .filter({ hasText: "google / fixture-model" })
    .click();
  const table = panel.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(
    table.getByRole("columnheader", { name: "Input tokens", exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("columnheader", {
      name: "Accumulated exchange chars",
      exact: true,
    }),
  ).toBeVisible();
  await expect(table.getByRole("row").nth(1)).toContainText("Unknown");
  await expect(table.getByRole("row").nth(2)).toContainText("3,000");
  await expect(table.getByRole("row").nth(3)).toContainText("600 / 30");
  await panel.locator("summary").filter({ hasText: "openai / legacy" }).click();
  await expect(panel).toContainText(
    "Per-request diagnostics are unavailable for this turn",
  );
  await page.screenshot({
    path: "/tmp/paw12-tokens-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/tmp/paw12-tokens-mobile.png",
    fullPage: true,
  });
});
