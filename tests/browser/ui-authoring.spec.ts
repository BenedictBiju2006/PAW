import { test, expect } from "@playwright/test";

test("batched movie authoring renders an editable table, form and chart with the official runtime", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill(`authoring-${Date.now()}@example.com`);
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
  const workspace = await post("workspaces", { name: "Movie ranking" });
  const base = `workspaces/${workspace.id}`;
  const collection = await post(`${base}/collections`, {
    name: "Movies",
    fields: [
      { key: "title", label: "Title", type: "string", required: true },
      { key: "rating", label: "Rating", type: "number", required: true },
    ],
  });
  await post(`${base}/collections/${collection.id}`, {
    data: { title: "Arrival", rating: 5 },
  });
  const tool = async (toolId: string, args: Record<string, unknown>) => {
    const result = await post("tools", {
      toolId,
      arguments: args,
      workspaceId: workspace.id,
    });
    expect(result.ok, JSON.stringify(result)).toBeTruthy();
    return result.data;
  };
  const discovered = await tool("search_ui_components", {
    query: "movie table form chart heading",
  });
  expect(discovered.map((c: any) => c.component)).toEqual(
    expect.arrayContaining([
      "Text",
      "DataTable",
      "CollectionForm",
      "CollectionChart",
    ]),
  );
  const detail = await tool("inspect_component", {
    component: "CollectionForm",
  });
  expect(detail["x-paw-authoring"].example.components).toHaveLength(1);
  const result = await tool("add_ui_components", {
    workspaceId: workspace.id,
    revision: workspace.revision,
    components: [
      {
        key: "heading",
        component: "Text",
        properties: { text: "My movie ranking", variant: "h2" },
      },
      {
        key: "table",
        component: "DataTable",
        properties: { collectionId: collection.id },
      },
      {
        key: "form",
        component: "CollectionForm",
        properties: { collectionId: collection.id },
      },
      {
        key: "chart",
        component: "CollectionChart",
        properties: { collectionId: collection.id, field: "rating" },
      },
    ],
  });
  expect(result.components).toHaveLength(4);
  expect(result.revision).toBe(workspace.revision + 1);
  expect(result.definition).toBeUndefined();
  await page.goto(`/?workspace=${workspace.id}`);
  await expect(
    page.getByRole("heading", { name: "My movie ranking", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Arrival", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Add to Movies", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Value counts for rating across all records",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Title").fill("Arrival (ranked)");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Arrival (ranked)", exact: true }),
  ).toBeVisible();
  await page
    .locator(".primary-interface")
    .getByLabel("Title *", { exact: true })
    .fill("Dune");
  await page
    .locator(".primary-interface")
    .getByLabel("Rating *", { exact: true })
    .fill("4");
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Dune", exact: true }),
  ).toBeVisible();
  const headingId = result.components.find((c: any) => c.key === "heading").id;
  await tool("update_ui_component", {
    workspaceId: workspace.id,
    revision: result.revision,
    componentId: headingId,
    properties: { text: "Ranked films" },
    placement: { parentId: "root", index: 0 },
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ranked films", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Arrival (ranked)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Dune", exact: true }),
  ).toBeVisible();
});
