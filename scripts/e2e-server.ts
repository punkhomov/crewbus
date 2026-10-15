import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/src/app.js";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
const faux = fauxProvider({
  tokensPerSecond: 500,
  models: [
    { id: "faux-model", name: "Faux Model" },
    { id: "faux-alternate", name: "Faux Alternate" },
  ],
});
const models = createModels();
models.setProvider({ ...faux.provider, name: "Faux" });
type Scenario = "todo" | "slow" | "error" | "unsafe";
function responses(scenario: Scenario) {
  const respond = (context: TranscriptContext): AssistantMessage => {
    if (scenario === "error")
      return fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "e2e-test-key rejected by scripted provider",
      });
    if (scenario === "unsafe")
      return fauxAssistantMessage(
        '<img src=x onerror="window.__injected=true"><script>window.__injected=true</script>\n\n[опасная ссылка](javascript:window.__injected=true)',
      );
    const last = context.messages.at(-1);
    if (last?.role === "toolResult")
      return fauxAssistantMessage(
        scenario === "slow" ? "Поток ответа. ".repeat(6000) : "Задача создана",
      );
    return fauxAssistantMessage(
      [
        fauxToolCall(
          "todo_create",
          { title: "Изучить pi" },
          { id: crypto.randomUUID() },
        ),
      ],
      { stopReason: "toolUse" },
    );
  };
  faux.setResponses(Array.from({ length: 100 }, () => respond));
}
responses("todo");
const dataDir = await mkdtemp(join(tmpdir(), "crewbus-e2e-worker-0-"));
// Real child dies after the SQLite commit, before the agent receives its result.
const { crashRun } = await import('../apps/server/test/fixtures/crash-after-tool.js');
const recoveryFixture = await crashRun(dataDir);
const app = await createApp({ dataDir, models });
app.storage.database.prepare('UPDATE chats SET title=? WHERE id=?').run('Восстановленный диалог', recoveryFixture.chatId);
app.get('/api/__e2e/recovery', async () => recoveryFixture);
// Test-only control and persisted fixtures. This entrypoint is never imported by production.
app.post<{ Body: { scenario: Scenario } }>(
  "/api/__e2e/scenario",
  async (request) => {
    responses(request.body.scenario);
    return { ok: true };
  },
);
app.get("/api/__e2e/stats", async () => ({ modelCalls: faux.state.callCount }));
app.post<{
  Body: {
    chatId: string;
    kind: "interrupted" | "history" | "timeout" | "turn_limit";
  };
}>("/api/__e2e/seed", async (request) => {
  const { chatId, kind } = request.body;
  const { run } = app.storage.runs.accept(
    chatId,
    { text: "Сохранённая история", clientRequestId: crypto.randomUUID() },
    "fixture",
  );
  const count = kind === "history" ? 35 : 1;
  for (let i = 0; i < count; i++)
    app.storage.events.append(run.id, {
      type: "message.completed",
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        text:
          kind === "history"
            ? `Сохранённый ответ ${i + 1}. ` +
              "Строка истории для проверки прокрутки. ".repeat(12)
            : "",
        state: "completed",
        tools:
          kind === "interrupted"
            ? [
                {
                  id: "unfinished",
                  name: "todo_create",
                  state: "running",
                  input: { title: "Незавершённая задача" },
                  output: null,
                  error: null,
                },
              ]
            : [],
      },
    });
  const reason =
    kind === "timeout" || kind === "turn_limit" ? kind : "user_abort";
  const finished = app.storage.runs.finish(run.id, "aborted", reason);
  app.storage.events.append(run.id, { type: "run.finished", run: finished });
  return { ok: true };
});
await app.listen({ host: "127.0.0.1", port: 3000 });
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
    process.exit(0);
  });
