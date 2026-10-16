import { expect, test, create, send } from "./helpers";
test("SSE восстанавливается автоматически без второго model request; reload продолжает активный запуск", async ({
  page,
}) => {
  const chat = await create(page, "slow");
  const initial = await (await page.request.get("/api/__e2e/stats")).json();
  let connections = 0;
  await page.route("**/api/runs/*/events?*", async (route) => {
    connections++;
    if (connections === 1) await route.abort("failed");
    else await route.continue();
  });
  await send(page);
  await expect(page.getByTestId("conversation")).toContainText(
    "Поток ответа.",
    { timeout: 12000 },
  );
  expect(connections).toBeGreaterThan(1);
  const before = await (await page.request.get("/api/__e2e/stats")).json();
  expect(before.modelCalls - initial.modelCalls).toBe(2);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Остановить", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("conversation")).toContainText("Поток ответа.");
  const after = await (await page.request.get("/api/__e2e/stats")).json();
  expect(after.modelCalls).toBe(before.modelCalls);
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await expect(
    page.getByText("Запуск остановлен.", { exact: true }),
  ).toBeVisible();
  const state = await (await page.request.get(`/api/chats/${chat.id}`)).json();
  expect(state.todos).toHaveLength(1);
});
