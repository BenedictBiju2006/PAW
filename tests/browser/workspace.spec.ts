import { test, expect } from "@playwright/test";

test("sign up, manually configure a workspace, persist across sessions, and isolate accounts", async ({
  page,
  browser,
}) => {
  const suffix = Date.now();
  const email = `owner${suffix}@example.com`;
  const password = "PAW-local-test-password-123!";
  await page.goto("/");
  await page.screenshot({ path: "/tmp/paw-auth-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your workspaces" }),
  ).toBeVisible();
  const cookies = await page.context().cookies();
  expect(
    cookies.some((c) => c.name.includes("auth-token") && c.httpOnly),
  ).toBeTruthy();
  await page.getByRole("button", { name: "+ New workspace" }).click();
  const workspaceDialog = page.getByRole("dialog");
  await workspaceDialog.getByLabel("Workspace name").fill("Reading room");
  await workspaceDialog
    .getByRole("button", { name: "Create workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reading room", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "+ Add your first collection" })
    .click();
  const collectionDialog = page.getByRole("dialog");
  await collectionDialog.getByLabel("Collection name").fill("Books");
  await collectionDialog
    .getByRole("button", { name: "Create collection", exact: true })
    .click();
  await expect(page.getByText("No records yet")).toBeVisible();
  await page.getByRole("button", { name: "+ Add record", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Title")
    .fill("The Left Hand of Darkness");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add record", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "The Left Hand of Darkness", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Interface builder" }).click();
  await page.getByRole("button", { name: "Add heading", exact: true }).click();
  await page
    .getByRole("button", { name: "Add Books form & table", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add Books chart", exact: true })
    .click();
  const definitionInput = page.getByLabel("A2UI messages");
  const definition = JSON.parse(await definitionInput.inputValue());
  const updates = definition.messages.filter((m: any) => m.updateComponents);
  const root = updates
    .at(-1)
    .updateComponents.components.find((c: any) => c.id === "root");
  const collectionId = updates
    .flatMap((m: any) => m.updateComponents.components)
    .find((c: any) => c.component === "CollectionForm").collectionId;
  definition.messages.push({
    version: "v0.9.1",
    updateComponents: {
      surfaceId: "workspace",
      components: [
        {
          id: "draft_input",
          component: "TextField",
          label: "Draft title",
          value: { path: "/draft/title" },
        },
        {
          id: "draft_mirror",
          component: "Text",
          text: { path: "/draft/title" },
        },
        { id: "draft_label", component: "Text", text: "Save draft" },
        {
          id: "draft_button",
          component: "Button",
          child: "draft_label",
          action: {
            event: {
              name: "paw.createRecord",
              context: { collectionId, data: { path: "/draft" } },
            },
          },
        },
        {
          ...root,
          children: [
            ...root.children,
            "draft_input",
            "draft_mirror",
            "draft_button",
          ],
        },
      ],
    },
  });
  definition.messages.push({
    version: "v0.9.1",
    updateDataModel: {
      surfaceId: "workspace",
      path: "/",
      value: { draft: { title: "Binding works" } },
    },
  });
  await definitionInput.fill(JSON.stringify(definition, null, 2));
  const preview = page.getByRole("region", { name: "Interface preview" });
  await expect(
    preview.getByRole("heading", { name: "My workspace", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByText("Binding works", { exact: true }),
  ).toBeVisible();
  await preview.getByLabel("Draft title", { exact: true }).fill("Preview only");
  await expect(
    preview.getByText("Preview only", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Add record", exact: true }),
  ).toBeDisabled();
  const invalid = structuredClone(definition);
  invalid.messages.push({
    version: "v0.9.1",
    updateComponents: {
      surfaceId: "workspace",
      components: [{ id: "root", component: "Script" }],
    },
  });
  await definitionInput.fill(JSON.stringify(invalid));
  await expect(
    page.getByRole("button", { name: "Save interface", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#interface-validation")).toContainText(
    /unknown|unsupported/i,
  );
  await definitionInput.fill(JSON.stringify(definition, null, 2));
  await page
    .getByRole("button", { name: "Save interface", exact: true })
    .click();
  await expect(page.locator(".notice")).toContainText("Interface saved");
  await page.getByRole("tab", { name: "Workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "My workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "The Left Hand of Darkness", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Title")
    .fill("A Wizard of Earthsea");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "A Wizard of Earthsea", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("img", { name: "Value counts for title across all records" })
      .getByText("A Wizard of Earthsea", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Title *", { exact: true }).fill("The Dispossessed");
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "The Dispossessed", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Draft title", { exact: true })
    .fill("Created through A2UI action");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("cell", {
      name: "Created through A2UI action",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reading room", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "A Wizard of Earthsea", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Interface builder" }).click();
  await page
    .getByRole("button", { name: "Revision history", exact: true })
    .click();
  await page
    .locator(".history-row")
    .filter({ has: page.getByText("Revision 1", { exact: true }) })
    .getByRole("button", { name: "Restore as new revision" })
    .click();
  await expect(page.getByText(/Interface revision 3/)).toBeVisible();
  await page
    .getByRole("button", { name: "Revision history", exact: true })
    .click();
  await page
    .locator(".history-row")
    .filter({ has: page.getByText("Revision 2", { exact: true }) })
    .getByRole("button", { name: "Restore as new revision" })
    .click();
  await expect(page.getByText(/Interface revision 4/)).toBeVisible();
  await page.getByRole("tab", { name: "Workspace", exact: true }).click();
  await expect(
    page.getByRole("cell", {
      name: "Created through A2UI action",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "PAW", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .locator("form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Reading room.*Open your collections/ })
    .click();
  await expect(
    page.getByRole("cell", { name: "A Wizard of Earthsea", exact: true }),
  ).toBeVisible();
  const list = await (await page.request.get("/api/workspaces")).json();
  const workspaceId = list[0].id;
  const second = await browser.newContext();
  const visitor = await second.newPage();
  await visitor.goto("/");
  await visitor.getByRole("button", { name: "Sign up", exact: true }).click();
  await visitor
    .getByLabel("Email", { exact: true })
    .fill(`stranger${suffix}@example.com`);
  await visitor.getByLabel("Password", { exact: true }).fill(password);
  await visitor
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    visitor.getByRole("heading", { name: "Your workspaces" }),
  ).toBeVisible();
  await expect(visitor.getByText("Reading room", { exact: true })).toHaveCount(
    0,
  );
  expect(
    (await visitor.request.get(`/api/workspaces/${workspaceId}`)).status(),
  ).toBe(404);
  const forbidden = await visitor.request.patch(
    `/api/workspaces/${workspaceId}`,
    {
      headers: { Origin: process.env.PAW_BROWSER_TEST_URL! },
      data: { name: "Hijacked" },
    },
  );
  expect(forbidden.status()).toBe(404);
  const csrf = await page.request.post("/api/workspaces", {
    headers: { Origin: "https://attacker.example" },
    data: { name: "Injected" },
  });
  expect(csrf.status()).toBe(403);
  await second.close();
  await page.screenshot({
    path: "/tmp/paw-workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Reading room", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/paw-workspace-mobile.png",
    fullPage: true,
  });
});
