import { expect, test, create, send } from "./helpers";
test("реальная отмена потока сохраняет выполненный инструмент, блокирует изменения и восстанавливается после reload", async ({
  page,
}) => {
  await create(page, "slow");
  await send(page);
  await expect(
    page.getByTestId("todo-panel").getByText("Изучить pi", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Остановить", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Новая задача", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Модель", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Сообщение", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("conversation")).toContainText("Поток ответа.");
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Остановить", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Создание задачи Готово" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Создание задачи Готово" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("todo-panel").getByText("Изучить pi", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Создание задачи Готово" }).click();
  await expect(page.getByTestId("conversation")).toContainText("Результат");
});
test("сохранённый незавершённый инструмент: Прервано без результата", async ({
  page,
}) => {
  const chat = await create(page);
  await page.request.post("/api/__e2e/seed", {
    data: { chatId: chat.id, kind: "interrupted" },
  });
  await page.reload();
  await page.getByRole("button", { name: "Создание задачи Прервано" }).click();
  await expect(page.getByTestId("conversation")).toContainText(
    "Незавершённая задача",
  );
  await expect(
    page.getByTestId("conversation").getByText("Результат", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("conversation").getByText("Ошибка", { exact: true }),
  ).toHaveCount(0);
});
for (const [kind, text] of [
  ["timeout", "Превышено время ожидания: 5 минут."],
  ["turn_limit", "Достигнут лимит: 20 обращений к модели."],
] as const)
  test(`сохранённая причина ${kind} показана понятным текстом`, async ({
    page,
  }) => {
    const chat = await create(page);
    await page.request.post("/api/__e2e/seed", {
      data: { chatId: chat.id, kind },
    });
    await page.reload();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  });
