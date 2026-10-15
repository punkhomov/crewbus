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
      record.type === "pageerror" || record.type === "warning" ||
      (record.type === "error" &&
        !(expectedNetwork && record.text.includes("net::ERR_FAILED")) &&
        !(testInfo.title.startsWith("409") && record.text.includes("409"))),
  );
  expect(unexpected, "unexpected browser errors").toEqual([]);
});
export async function create(
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
export async function send(
  page: import("@playwright/test").Page,
  text = "Создай задачу Изучить pi",
) {
  await page
    .getByRole("textbox", { name: "Сообщение", exact: true })
    .fill(text);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
}
export { expect, test };
