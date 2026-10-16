import { expect, test, create, send } from "./helpers";
test("провайдер → инструмент → сохранённая задача", async ({ page }) => {
  await page.request.post("/api/__e2e/scenario", { data: { scenario: "todo" } });
  await page.goto("/");
  await page.getByRole("button", { name: "Новый диалог", exact: true }).and(page.locator(":not([data-chat-id])")).click();
  await page.getByLabel("Провайдер", { exact: true }).click();
  await page.getByRole("option", { name: "Faux", exact: true }).click();
  await page.getByLabel("API-ключ", { exact: true }).fill("e2e-test-key");
  await page
    .getByRole("button", { name: "Сохранить ключ", exact: true })
    .click();
  await page.getByLabel("Модель", { exact: true }).click();
  await page.getByRole("option").first().click();
  await page
    .getByRole("button", { name: "Создать диалог", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Сообщение", exact: true })
    .fill("Создай задачу Изучить pi");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    page.getByTestId("todo-panel").getByText("Изучить pi", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("conversation")
      .getByText("Задача создана", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByTestId("todo-panel").getByText("Изучить pi", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".artifacts/screenshots/desktop-completed.png",
  });
  await page.getByRole("button", { name: "Создание задачи Готово" }).click();
  await page.screenshot({
    path: ".artifacts/screenshots/desktop-tool-details.png",
  });
});
test("неверный ключ: безопасная ошибка провайдера и отсутствие секрета в хранилищах и ответах", async ({
  page,
}) => {
  const responses: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/"))
      void response
        .text()
        .then((body) => responses.push(body))
        .catch(() => {});
  });
  await create(page, "error");
  await send(page, "Привет");
  await expect(
    page.getByText(
      "Провайдер не выполнил запрос. Проверьте API-ключ и модель.",
      { exact: true },
    ),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("e2e-test-key");
  expect(responses.join("")).not.toContain("e2e-test-key");
  await expect(page.locator("body")).not.toContainText("e2e-test-key");
});
test("неопределённый сетевой результат повторяет тот же request ID и текст ровно один раз", async ({
  page,
}) => {
  const chat = await create(page);
  const inputs: unknown[] = [];
  let first = true;
  await page.route(`**/api/chats/${chat.id}/runs`, async (route) => {
    inputs.push(route.request().postDataJSON());
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await send(page);
  await expect(
    page.getByRole("button", { name: "Повторить отправку", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Сообщение", exact: true }),
  ).toHaveValue("Создай задачу Изучить pi");
  await page
    .getByRole("button", { name: "Повторить отправку", exact: true })
    .click();
  await expect(
    page
      .getByTestId("conversation")
      .getByText("Задача создана", { exact: true }),
  ).toBeVisible();
  expect(inputs).toHaveLength(2);
  expect(inputs[0]).toEqual(inputs[1]);
  const snapshot = await (
    await page.request.get(`/api/chats/${chat.id}`)
  ).json();
  expect(
    snapshot.messages.filter(
      (message: { role: string }) => message.role === "user",
    ),
  ).toHaveLength(1);
  expect(snapshot.todos).toHaveLength(1);
  await expect(
    page.getByRole("textbox", { name: "Сообщение", exact: true }),
  ).toHaveValue("");
});
test("смена диалога во время потока не переносит события и не останавливает запуск", async ({
  page,
}) => {
  const a = await create(page, "slow");
  await send(page);
  await expect(page.getByTestId("conversation")).toContainText("Поток ответа.");
  const b = await (
    await page.request.post("/api/chats", {
      data: { providerId: a.providerId, modelId: a.modelId },
    })
  ).json();
  await page.reload();
  await page.locator(`nav [data-chat-id="${b.id}"]`).click();
  await expect(page.getByTestId("conversation")).toContainText(
    "С чего начнём?",
  );
  await page.waitForTimeout(300);
  await expect(page.getByTestId("conversation")).not.toContainText(
    "Поток ответа.",
  );
  const state = await (await page.request.get(`/api/chats/${a.id}`)).json();
  expect(state.run.status).toBe("running");
  await page.request.post(`/api/runs/${state.run.id}/abort`);
});
test("устаревший snapshot отменяется при выборе другого диалога", async ({
  page,
}) => {
  const a = await create(page),
    b = await (
      await page.request.post("/api/chats", {
        data: { providerId: a.providerId, modelId: a.modelId },
      })
    ).json();
  await page.reload();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/chats/${a.id}`, async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page.locator(`nav [data-chat-id="${b.id}"]`).click();
  await page.locator(`nav [data-chat-id="${a.id}"]`).click();
  await page.locator(`nav [data-chat-id="${b.id}"]`).click();
  release();
  await expect(page).toHaveURL(new RegExp(b.id));
  await expect(page.getByTestId("conversation")).toContainText(
    "С чего начнём?",
  );
});
test("сырой HTML и опасные ссылки не исполняются", async ({ page }) => {
  await create(page, "unsafe");
  await send(page, "Безопасный ответ");
  await expect(
    page.getByRole("textbox", { name: "Сообщение", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("conversation")).toContainText(
    "опасная ссылка",
  );
  expect(
    await page.evaluate(() =>
      Boolean((window as Window & { __injected?: unknown }).__injected),
    ),
  ).toBe(false);
  expect(
    await page
      .getByTestId("conversation")
      .locator("a")
      .evaluateAll((links) =>
        links.every((link) => !link.href.startsWith("javascript:")),
      ),
  ).toBe(true);
  expect(
    await page
      .getByTestId("conversation")
      .locator("script,img[onerror]")
      .count(),
  ).toBe(0);
});
test("ручные задачи: создание, правка, завершение и удаление", async ({
  page,
}) => {
  await create(page);
  await page.getByLabel("Новая задача", { exact: true }).fill("Ручная задача");
  await page
    .getByRole("button", { name: "Добавить задачу", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Изменить: Ручная задача", exact: true })
    .click();
  await page
    .getByLabel("Название задачи", { exact: true })
    .fill("Готовый план");
  await page
    .getByRole("button", { name: "Сохранить задачу", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Завершить: Готовый план", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Завершить: Готовый план",
      exact: true,
    }),
  ).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("checkbox", {
      name: "Завершить: Готовый план",
      exact: true,
    }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Удалить: Готовый план", exact: true })
    .click();
  await expect(
    page.getByTestId("todo-panel").getByText("Готовый план", { exact: true }),
  ).toHaveCount(0);
});
test("desktop: ручная прокрутка во время stream, screenshot и чистая консоль", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const chat = await create(page, "slow");
  await page.request.post("/api/__e2e/seed", {
    data: { chatId: chat.id, kind: "history" },
  });
  await page.reload();
  await send(page, "Продолжай");
  await expect(page.getByTestId("conversation")).toContainText("Поток ответа.");
  const scroll = page.getByTestId("conversation").locator("> div").first();
  await page.screenshot({
    path: ".artifacts/screenshots/desktop-before-scroll.png",
  });
  await scroll.hover();
  await page.mouse.wheel(0, -100000);
  await expect(
    page.getByRole("button", { name: "К последнему сообщению", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeLessThan(
    50,
  );
  await page.screenshot({ path: ".artifacts/screenshots/desktop-history.png" });
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  expect(errors).toEqual([]);
  await expect(page).toHaveTitle("Crewbus");
  expect(await page.locator("vite-error-overlay").count()).toBe(0);
});
test("409 при ручном изменении обновляет snapshot и блокирует занятый диалог", async ({
  page,
}) => {
  const chat = await create(page, "slow");
  await page.getByLabel("Новая задача", { exact: true }).fill("Не создавать");
  const response = await page.request.post(`/api/chats/${chat.id}/runs`, {
    data: { text: "Начни", clientRequestId: crypto.randomUUID() },
  });
  const { runId } = await response.json();
  await page
    .getByRole("button", { name: "Добавить задачу", exact: true })
    .click();
  await expect(
    page.getByText("Диалог занят. Обновите данные.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Новая задача", { exact: true })).toBeDisabled();
  await expect(
    page.getByTestId("todo-panel").getByText("Не создавать", { exact: true }),
  ).toHaveCount(0);
  await page.request.post(`/api/runs/${runId}/abort`);
});
test("завершение ручной мутации старого диалога не подменяет новый snapshot", async ({
  page,
}) => {
  const a = await create(page),
    b = await (
      await page.request.post("/api/chats", {
        data: { providerId: a.providerId, modelId: a.modelId },
      })
    ).json();
  await page.reload();
  let release!: () => void,
    fulfilled = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/chats/${a.id}/todos`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
    fulfilled = true;
  });
  await page
    .getByLabel("Новая задача", { exact: true })
    .fill("Задача старого диалога");
  await page
    .getByRole("button", { name: "Добавить задачу", exact: true })
    .click();
  await page.locator(`nav [data-chat-id="${b.id}"]`).click();
  await expect(
    page.getByRole("textbox", { name: "Сообщение", exact: true }),
  ).toBeEnabled();
  release();
  await expect.poll(() => fulfilled).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("todo-panel")).not.toContainText(
    "Задача старого диалога",
  );
  await expect(page).toHaveURL(new RegExp(b.id));
});
test("разрыв последовательности событий обновляет snapshot вместо добавления выдуманного текста", async ({
  page,
}) => {
  const chat = await create(page, "slow");
  let injected = false,
    snapshots = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname === `/api/chats/${chat.id}`
    )
      snapshots++;
  });
  await page.route("**/api/runs/*/events?*", async (route) => {
    if (injected) {
      await route.continue();
      return;
    }
    injected = true;
    const runId = new URL(route.request().url()).pathname.split("/")[3];
    await route.fulfill({
      contentType: "text/event-stream",
      body: `event: crewbus\ndata: ${JSON.stringify({ id: 999, runId, chatId: chat.id, data: { type: "message.delta", messageId: "missing", delta: "ВЫДУМАННЫЙ ТЕКСТ" } })}\n\n`,
    });
  });
  await send(page);
  await expect(page.getByTestId("conversation")).toContainText("Поток ответа.");
  expect(snapshots).toBeGreaterThan(1);
  await expect(page.getByTestId("conversation")).not.toContainText(
    "ВЫДУМАННЫЙ ТЕКСТ",
  );
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
});
test("модель меняется между запусками; удаление и настройка ключа управляют отправкой", async ({
  page,
}) => {
  const chat = await create(page);
  await page.getByRole("button", { name: "Модель", exact: true }).click();
  await page
    .getByRole("option", { name: "Faux Alternate", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Модель", exact: true }),
  ).toContainText("Faux Alternate");
  expect(
    (await (await page.request.get(`/api/chats/${chat.id}`)).json()).chat
      .modelId,
  ).toBe("faux-alternate");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const replacement = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/credential"));
  await page.getByLabel("API-ключ", { exact: true }).fill("e2e-replacement-key");
  await page.getByRole("button", { name: "Сохранить ключ", exact: true }).click();
  expect((await replacement).status()).toBe(204);
  await expect(page.getByLabel("API-ключ", { exact: true })).toHaveValue("");
  await expect(page.getByText("Настроен", { exact: true })).toBeVisible();
  expect(await page.locator("body").textContent()).not.toContain("e2e-replacement-key");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("e2e-replacement-key");
  await page.getByRole("button", { name: "Удалить ключ", exact: true }).click();
  await expect(page.getByText("Не настроен", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Сообщение", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await page.getByLabel("API-ключ", { exact: true }).fill("e2e-test-key");
  await page
    .getByRole("button", { name: "Сохранить ключ", exact: true })
    .click();
  await expect(page.getByLabel("API-ключ", { exact: true })).toHaveValue("");
  await expect(page.getByText("Настроен", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Сообщение", exact: true }),
  ).toBeEnabled();
});

test('агент создаёт, читает, завершает и удаляет задачу по настоящему toolResult ID', async ({ page }) => {
  const chat = await create(page, 'crud');
  const panel = page.getByTestId('todo-panel');
  await send(page, 'Создай задачу');
  await expect(panel.getByText('Агент CRUD', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeEnabled();
  const [created] = await (await page.request.get(`/api/chats/${chat.id}/todos`)).json();
  expect(created.id).toBeTruthy();
  await send(page, 'Прочитай задачи');
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeEnabled();
  await send(page, 'Заверши задачу');
  await expect(panel.getByRole('checkbox')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeEnabled();
  await page.reload();
  await expect(panel.getByRole('checkbox')).toBeChecked();
  await send(page, 'Удали задачу');
  await expect(panel.getByText('Агент CRUD', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeEnabled();
  await page.reload();
  await expect(panel.getByText('Агент CRUD', { exact: true })).toHaveCount(0);
  const snapshot = await (await page.request.get(`/api/chats/${chat.id}`)).json();
  const tools = snapshot.messages.flatMap((message: { tools: unknown[] }) => message.tools ?? []);
  expect(tools.map((tool: { name: string }) => tool.name)).toEqual(['todo_create', 'todo_list', 'todo_update', 'todo_delete']);
  expect(tools[1].output).toEqual([expect.objectContaining({ id: created.id, completed: false })]);
  expect(tools[2].input).toEqual({ id: created.id, completed: true });
  expect(tools[3].input).toEqual({ id: created.id });
  expect(tools.every((tool: { state: string }) => tool.state === 'completed')).toBe(true);
});


test('двойная отправка допускает один запуск и одну задачу', async ({ page }) => {
  const chat = await create(page);
  const before = await (await page.request.get('/api/__e2e/stats')).json();
  const requests: unknown[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith(`/api/chats/${chat.id}/runs`)) requests.push(request.postDataJSON());
  });
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Создай ровно одну задачу');
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).evaluate(element => {
    const form = element.closest('form');
    if (!form) throw new Error('Composer form missing');
    form.requestSubmit(); form.requestSubmit();
  });
  await expect(page.getByTestId('conversation').getByText('Задача создана', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeEnabled();
  expect(requests).toHaveLength(1);
  const snapshot = await (await page.request.get(`/api/chats/${chat.id}`)).json();
  expect(snapshot.messages.filter((message: { role: string }) => message.role === 'user')).toHaveLength(1);
  expect(snapshot.todos).toHaveLength(1);
  const after = await (await page.request.get('/api/__e2e/stats')).json();
  expect(after.modelCalls - before.modelCalls).toBe(2);
});
