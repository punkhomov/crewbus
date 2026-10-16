import { expect, test, create, send } from "./helpers";
test("390×844: Sheet и Dialog доступны с клавиатуры, задачи не обрезаются", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const chat = await create(page);
  await page
    .getByRole("button", { name: "Открыть диалоги", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "Диалоги", exact: true });
  await expect(sheet).toBeVisible();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press(i < 10 ? "Tab" : "Shift+Tab");
    expect(
      await sheet.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Tab");
  expect(
    await sheet.evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Открыть диалоги", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Настройки провайдера",
    exact: true,
  });
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press(i < 10 ? "Tab" : "Shift+Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.getByLabel("API-ключ", { exact: true }).fill("discard-this-key");
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByLabel("API-ключ", { exact: true })).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: ".artifacts/screenshots/mobile-chat.png" });
  await page
    .getByRole("button", { name: "Открыть задачи", exact: true })
    .click();
  const tasks = page.getByRole("dialog", {
    name: "Задачи диалога",
    exact: true,
  });
  await expect(tasks).toBeVisible();
  await tasks
    .getByLabel("Новая задача", { exact: true })
    .fill("Задача на узком экране");
  await tasks
    .getByRole("button", { name: "Добавить задачу", exact: true })
    .click();
  await expect(
    tasks.getByText("Задача на узком экране", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".artifacts/screenshots/mobile-tasks.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  expect(
    (await (await page.request.get(`/api/chats/${chat.id}`)).json()).todos,
  ).toHaveLength(1);
});
