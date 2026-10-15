import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
const consoleRecords = new WeakMap<Page, { type: string; text: string }[]>();
test.beforeEach(async ({ page }) => {
  const records: { type: string; text: string }[] = [];
  consoleRecords.set(page, records);
  page.on("pageerror", (error) =>
    records.push({ type: "pageerror", text: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      records.push({ type: message.type(), text: message.text() });
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const records = consoleRecords.get(page) ?? [];
  const logPath = testInfo.outputPath("browser-console.json");
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, JSON.stringify(records, null, 2));
  await testInfo.attach("browser-console", {
    path: logPath,
    contentType: "application/json",
  });
  const expectedNetwork =
    testInfo.title.includes("неопределённый сетевой") ||
    testInfo.title.includes("SSE восстанавливается");
  const unexpected = records.filter(
    (record) =>
      record.type === "pageerror" ||
      (record.type === "error" &&
        !(expectedNetwork && record.text.includes("net::ERR_FAILED")) &&
        !(testInfo.title.startsWith("409") && record.text.includes("409"))),
  );
  expect(unexpected, "unexpected browser errors").toEqual([]);
});
test("провайдер → инструмент → сохранённая задача", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый диалог", exact: true }).click();
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

async function create(
  page: import("@playwright/test").Page,
  scenario = "todo",
) {
  await page.request.post("/api/__e2e/scenario", { data: { scenario } });
  const providers = await (await page.request.get("/api/providers")).json();
  const provider = providers[0];
  await page.request.put(`/api/providers/${provider.id}/credential`, {
    data: { key: "e2e-test-key" },
  });
  const models = await (
    await page.request.get(`/api/providers/${provider.id}/models`)
  ).json();
  const chat = await (
    await page.request.post("/api/chats", {
      data: { providerId: provider.id, modelId: models[0].id },
    })
  ).json();
  await page.goto(`/?chat=${chat.id}`);
  await expect(
    page.getByRole("textbox", { name: "Сообщение", exact: true }),
  ).toBeEnabled();
  return chat;
}
async function send(
  page: import("@playwright/test").Page,
  text = "Создай задачу Изучить pi",
) {
  await page
    .getByRole("textbox", { name: "Сообщение", exact: true })
    .fill(text);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
}
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
test("SSE восстанавливается автоматически без второго model request; reload продолжает активный запуск", async ({
  page,
}) => {
  const chat = await create(page, "slow");
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
