import { expect, type Page } from "@playwright/test";
export async function openConversations(page: Page) {
  const button = page.getByRole("button", {
    name: "Conversations",
    exact: true,
  });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}
export async function showChat(page: Page) {
  const button = page
    .locator(".primary-view-switch")
    .getByRole("button", { name: "Chat", exact: true });
  if (await button.isVisible()) await button.click();
}
export async function newConversation(page: Page) {
  await showChat(page);
  await openConversations(page);
  await page
    .locator(".conversation-list > .row")
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
}
export async function developerTools(page: Page) {
  const button = page.getByRole("button", { name: /Developer Tools/ });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}
export async function showInterface(page: Page) {
  const dev = page.getByRole("button", { name: /Developer Tools/ });
  if ((await dev.getAttribute("aria-expanded")) === "true") await dev.click();
  const button = page
    .locator(".primary-view-switch")
    .getByRole("button", { name: "Interface", exact: true });
  if (await button.isVisible()) await button.click();
}
