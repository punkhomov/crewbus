import { expect, test, create, send } from "./helpers";

test("тема системы применяется при первом открытии", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page).toHaveTitle("Crewbus");
  await expect(page.getByRole("heading", { name: "Ваш следующий шаг" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("body")).toHaveCSS("color-scheme", "dark");
  await page.getByRole("button", { name: "Включить светлую тему", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Включить тёмную тему", exact: true })).toBeVisible();
});

test("тёмная тема сохраняется и покрывает чат, инструменты и мобильные панели", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await create(page);
  await page.getByRole("button", { name: "Включить тёмную тему", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(17, 23, 34)");
  await expect(page.locator("header").first()).toHaveCSS("background-color", "rgb(24, 33, 47)");
  await send(page);
  await expect(page.getByText("Задача создана", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Создание задачи Готово" }).click();
  const code = page.locator("pre").first();
  await expect(code).toBeVisible();
  await expect(code).toHaveCSS("background-color", "rgb(36, 41, 46)");
  const property = code.locator("span").filter({ hasText: /^"title"$/ });
  await expect(property).toHaveCSS("color", "rgb(121, 184, 255)");
  await page.screenshot({ path: "/tmp/crewbus-dark-desktop.png" });
  await page.getByRole("button", { name: "Включить светлую тему", exact: true }).click();
  await expect(code).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(property).toHaveCSS("color", "rgb(0, 92, 197)");
  await page.getByRole("button", { name: "Включить тёмную тему", exact: true }).click();
  await page.getByRole("button", { name: "Создание задачи Готово" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Настройки провайдера", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("background-color", "rgb(17, 23, 34)");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Открыть задачи", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Изучить pi", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/crewbus-dark-mobile-tasks.png" });
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/crewbus-dark-mobile.png" });
  const toggle = page.getByRole("button", { name: "Включить светлую тему", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveCSS("color-scheme", "light");
});

test("переключатель работает при недоступном хранилище настроек", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Включить светлую тему", exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("color-scheme", "light");
});
