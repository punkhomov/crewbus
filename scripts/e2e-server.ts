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
type Scenario = "search-exa" | "search-parallel" | "search-error" | "todo" | "slow" | "error" | "overflow" | "unsafe" | "crud";
let searchFails = false;
const realFetch = globalThis.fetch;
// Hosted MCP responses stay local and deterministic in this test-only entrypoint.
globalThis.fetch = async (input, init) => {
  if (['https://mcp.exa.ai/mcp', 'https://search.parallel.ai/mcp'].includes(String(input))) {
    if (searchFails) return new Response('Access denied', { status: 403 });
    return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text',
      text: 'Title: Node.js\nURL: https://nodejs.org/\nText: Official documentation',
    }] } });
  }
  return realFetch(input, init);
};
function responses(scenario: Scenario) {
  searchFails = scenario === 'search-error';
  const respond = (context: TranscriptContext): AssistantMessage => {
    if (scenario === "error" || scenario === "overflow")
      return fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: scenario === "overflow" ? "prompt is too long: e2e-test-key" : "e2e-test-key rejected by scripted provider",
      });
    if (scenario === "unsafe")
      return fauxAssistantMessage(
        '<img src=x onerror="window.__injected=true"><script>window.__injected=true</script>\n\n[опасная ссылка](javascript:window.__injected=true)',
      );
    const last = context.messages.at(-1);
    if (scenario.startsWith('search-')) {
      if (last?.role === 'toolResult') return fauxAssistantMessage(last.isError ? 'Поиск недоступен' : '[Node.js](https://nodejs.org/) — результат поиска.');
      return fauxAssistantMessage([fauxToolCall('web_search', {
        query: 'Node.js documentation', provider: scenario === 'search-parallel' ? 'parallel' : 'exa',
      }, { id: crypto.randomUUID() })], { stopReason: 'toolUse' });
    }
    if (scenario === "crud") {
      if (last?.role === "toolResult") return fauxAssistantMessage("Операция завершена");
      const prompt = context.messages.filter(message => message.role === "user").at(-1);
      const text = JSON.stringify(prompt?.content);
      const operation = text.includes("Заверши") ? "todo_update" : text.includes("Удали") ? "todo_delete" : text.includes("Прочитай") ? "todo_list" : "todo_create";
      // The ID comes from the actual durable tool result, never from a fixture guess.
      const created = context.messages.find(message => message.role === "toolResult" && message.toolName === "todo_create");
      let id: string | undefined;
      if (created?.role === "toolResult") {
        const content = created.content.find(part => part.type === "text");
        if (content?.type === "text") id = JSON.parse(content.text).id;
      }
      if ((operation === "todo_update" || operation === "todo_delete") && !id) throw new Error("Missing actual created tool result ID");
      const input = operation === "todo_create" ? { title: "Агент CRUD" } : operation === "todo_update" ? { id, completed: true } : operation === "todo_delete" ? { id } : {};
      return fauxAssistantMessage([fauxToolCall(operation, input, { id: crypto.randomUUID() })], { stopReason: "toolUse" });
    }
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
app.get('/api/__e2e/recovery', async () => {
  const saved = app.storage.database.prepare('SELECT result_json FROM tool_results WHERE run_id=?').get(recoveryFixture.runId);
  if (!saved) throw new Error('Crash fixture has no committed journal result');
  return { ...recoveryFixture, savedResult: JSON.parse(String(saved.result_json)) };
});
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
