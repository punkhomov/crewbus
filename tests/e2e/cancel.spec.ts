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

test("частичный ответ остаётся помеченным после следующего ответа и reload", async ({page}) => {
 const chat=await create(page,"slow");await send(page);
 await expect(page.getByTestId("conversation")).toContainText("Поток ответа.");
 await page.getByRole("button",{name:"Остановить",exact:true}).click();
 const marker=page.getByRole("status").filter({hasText:"Ответ прерван"});
 await expect(marker).toBeVisible();
 const before=await (await page.request.get(`/api/chats/${chat.id}`)).json();
 const partial=before.messages.find((m:{state:string; text:string})=>m.state==="interrupted"&&m.text.includes("Поток ответа."));
 expect(partial).toBeTruthy();
 await page.request.post("/api/__e2e/scenario",{data:{scenario:"todo"}});
 await send(page,"Продолжим");await expect(page.getByText("Задача создана",{exact:true})).toBeVisible();
 await page.reload();await expect(marker).toHaveCount(1);await expect(marker).toBeVisible();
 const after=await (await page.request.get(`/api/chats/${chat.id}`)).json();
 expect(after.messages.find((m:{id:string})=>m.id===partial.id)).toEqual(partial);
 await expect(page.getByTestId("conversation")).toContainText(partial.text);
 await expect(page.getByRole("button",{name:"Создание задачи Готово"})).toHaveCount(2);
 await page.screenshot({path:"/tmp/crewbus-final-interrupted.png"});
});

test("переполнение контекста предлагает новый диалог после reload без утечки ключа",async({page})=>{
 const chat=await create(page,"overflow");await send(page);
 const guidance="Контекст диалога переполнен. Создайте новый диалог.";
 await expect(page.getByRole("status").filter({hasText:guidance})).toBeVisible();
 await page.reload();await expect(page.getByRole("status").filter({hasText:guidance})).toBeVisible();
 const snapshot=await (await page.request.get(`/api/chats/${chat.id}`)).json();
 expect(snapshot.run.reason).toBe("context_overflow");expect(JSON.stringify(snapshot)).not.toContain("e2e-test-key");
 expect(await page.locator("body").innerText()).not.toContain("e2e-test-key");
 await page.screenshot({path:"/tmp/crewbus-final-overflow.png"});
});
