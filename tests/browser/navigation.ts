import { expect, type Page } from "@playwright/test";
export async function openConversations(page: Page) {
  const toggle = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute("aria-expanded")) !== "true"
  )
    await toggle.click();
}
export async function showInterface(page: Page) {
  await openConversations(page);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Interface", exact: true })
    .click();
}
export async function showChat(page: Page) {
  if (await page.getByLabel("Message", { exact: true }).isVisible()) {
    const close = page.getByRole("button", {
      name: "Close navigation",
      exact: true,
    });
    if (await close.isVisible()) await close.click();
    return;
  }
  await openConversations(page);
  const first = page
    .locator(".conversation-history > .conversation-row > .nav-item")
    .first();
  if (await first.count()) await first.click();
  else
    await page.getByRole("button", { name: "+ New chat", exact: true }).click();
}
export async function newConversation(page: Page) {
  await openConversations(page);
  await page.getByRole("button", { name: "+ New chat", exact: true }).click();
}
export async function developerTools(page: Page) {
  await openConversations(page);
  const button = page.getByRole("button", {
    name: "Developer Tools",
    exact: true,
  });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  const close = page.getByRole("button", {
    name: "Close navigation",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
}
export async function conversationMenu(page: Page, title?: string) {
  await openConversations(page);
  const row = title
    ? page
        .locator(".conversation-row")
        .filter({ has: page.getByRole("button", { name: title, exact: true }) })
    : page
        .locator(".conversation-row")
        .filter({ has: page.locator('[aria-current="page"]') });
  await row.locator("summary").click();
  return row;
}
