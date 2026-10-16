# Crewbus MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать сохраняемый локальный веб-чат на pi с API-ключами, стримингом, остановкой и четырьмя todo-инструментами.

**Architecture:** Fastify обслуживает API и React/Vite frontend. pi-ai отвечает за провайдеров, pi-agent-core — за агентный цикл; SQLite хранит каноническую историю, события и результаты изменений задач. UI получает собственные DTO Crewbus и адаптирует их к shadcn/AI Elements.

**Tech Stack:** TypeScript, Node.js 24.21.0 LTS, pnpm 12.6.0, Fastify, node:sqlite, React/Vite, Tailwind 4, shadcn/ui, AI Elements, Vitest, Playwright.

**Spec:** [Согласованная спецификация](../specs/2026-10-09-crewbus-mvp-design.md), одобрена пользователем 2026-10-12.

## Global Constraints

- Node.js `24.21.0`, pnpm `12.6.0`; все проверки приложения выполняются на Node 24.
- pi-ai и pi-agent-core: `@earendil-works/pi-ai@0.87.1`, `@earendil-works/pi-agent-core@0.87.1`. Исходники проверены по тегу `v0.87.1`, commit `f07218c4d4bbc12bef056a7058c3dd49dfe41abe`.
- Один владелец, локальное приложение, один серверный процесс на SQLite; разные диалоги могут работать одновременно, в каждом — один активный запуск.
- Ровно `todo_create`, `todo_list`, `todo_update`, `todo_delete`; инструментов coding agent, MCP и дочерних агентов в MVP нет.
- API-key подключение; ключ хранится на сервере, не возвращается через API, не пишется в localStorage и логи.
- Тудушки принадлежат диалогу; ручные изменения в активном диалоге и смена его модели запрещены с 409.
- Лимиты: 20 обращений к модели; 5 минут; сообщение до 16 000 символов; заголовок задачи 1–500 символов после trim.
- Нет автоматического повторения запросов к модели или изменений задач после сбоя; сохранённый результат инструмента предотвращает повторное применение.
- Каноническая история pi включает системное сообщение. При восстановлении не добавлять второе системное сообщение; системные сообщения не показывать в transcript UI.
- AI Elements используются как представление. Imports из `ai` — только типы; `useChat`, серверный runtime AI SDK и `@ai-sdk/react` не подключаются.
- Точные внешние версии, внутренние зависимости `workspace:*`, frozen lockfile в CI/Docker. Git/URL/tarball-зависимости в manifests запрещены.
- Исходники registry проверяются отдельно от npm: фиксированные upstream SHA, SHA-256 исходных файлов, сохранённая лицензия, проверяемые локальные изменения.
- Production обслуживает UI/API одним origin; Compose публикует порт на `127.0.0.1`, контейнер слушает `0.0.0.0`.
- Реальные ключи не нужны для автоматических проверок: использовать pi `fauxProvider`. Один живой smoke test с выбранным пользователем провайдером выполняется отдельно при наличии ключа.

Обязательные настройки `pnpm-workspace.yaml`, скопированные из спецификации:

```yaml
packages:
  - apps/*
  - packages/*
minimumReleaseAge: 20160
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
minimumReleaseAgeExclude: []
trustPolicy: no-downgrade
trustPolicyExclude: []
trustLockfile: false
blockExoticSubdeps: true
strictDepBuilds: true
dangerouslyAllowAllBuilds: false
allowBuilds: {}
verifyDepsBeforeRun: error
saveExact: true
engineStrict: true
```

## Порядок работы и границы файлов

Это один сквозной MVP: задачи ниже последовательно наращивают работающее приложение. Не вводить дополнительный framework, очередь заданий, ORM или универсальную платформу плагинов.

| Задача | Результат | Основные файлы |
| --- | --- | --- |
| 1 | Проверенная установка, сборка, HTTP health | Корневые configs, apps/server, apps/web, scripts/vendor-ui.mjs |
| 2 | Единый протокол UI и reducer событий | packages/contracts/src, apps/web/src/chat/reducer.ts |
| 3 | SQLite, диалоги и атомарные изменения тудушек | apps/server/src/storage, chats/repository.ts, todos/service.ts, events/repository.ts |
| 4 | Настройки провайдеров и постоянный CredentialStore | apps/server/src/providers, storage/credential-store.ts |
| 5 | Агент pi с четырьмя инструментами | packages/agent/src |
| 6 | Запуски, сохранение истории и событий, лимиты | apps/server/src/chats/run-manager.ts, agent-events.ts, snapshot.ts |
| 7 | HTTP чат и возобновляемый SSE | apps/server/src/chats/routes.ts, events/sse.ts, todos/routes.ts |
| 8 | Рабочий интерфейс | apps/web/src/chat, settings, todos, api |
| 9 | Восстановление после сбоя | apps/server/src/chats/recovery.ts, storage/context.ts |
| 10 | E2E, Docker, CI, инструкции запуска | tests/e2e, scripts, Dockerfile, compose.yaml, README.md |

Каждая задача начинается с указанного теста, заканчивается проверками и отдельным коммитом. Кодовые фрагменты задают конкретные контракты и критические алгоритмы; расширение файлов включает перечисленные поведения и сценарии, без обходов глобальных ограничений.

Перед реализацией создать изолированную ветку/worktree через Superpowers using-git-worktrees. Документы уже находятся в основной ветке. Отсутствие настроенного Git-автора не решать копированием чужой подписи; для агентных коммитов допустима локальная подпись `Codex <codex@localhost>`, ранее использованная в этом репозитории.

## Task 1: Проверенная установка, UI-исходники и запускаемый каркас

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.node-version`, `.npmrc`, `.gitignore`, `tsconfig.base.json`, `vitest.config.ts`; manifests и tsconfig для `apps/server`, `apps/web`, `packages/contracts`, `packages/agent`; `apps/server/src/app.ts`, `main.ts`, `config.ts`, `apps/server/test/health.test.ts`; `apps/web/index.html`, `src/main.tsx`, `src/app.tsx`, `src/styles.css`, `vite.config.ts`, `components.json`, `src/lib/utils.ts`; `scripts/{bootstrap-pnpm,vendor-ui}.mjs`, `docs/dependencies.json`, `docs/ui-provenance.json`, `vendor/ui/`.

**Interfaces:** Produces `createApp(options: AppOptions): Promise<FastifyInstance>` and `AppOptions { dataDir: string; models?: Models }`. `models` — серверная dependency injection для тестов, не HTTP-настройка. Пакеты называются `@crewbus/contracts`, `@crewbus/agent`, `@crewbus/server`, `@crewbus/web`.

- [ ] **Step 1: Проверить runtime и безопасно подготовить pnpm.**

```bash
node --version
pnpm --version
```

Требуются `v24.21.0` и `12.6.0`. Если их нет, использовать официальную Node-дистрибуцию с проверкой SHA-256 по release checksums. pnpm загружать как фиксированный npm-пакет, сравнить tarball с `dist.integrity` registry до первого запуска; bootstrap не запускает lifecycle scripts. Записать проверенные версии, даты публикации и integrity в `docs/dependencies.json`. Не запускать случайный install shell script или CLI через `@latest`.

`bootstrap-pnpm.mjs <prefix>` читает закреплённый pnpm descriptor из dependencies.json, загружает tarball в временный каталог, сверяет SHA-512, затем вызывает `npm install --global --ignore-scripts --prefix <prefix> <verified-local-tarball>`. Запускать через spawn аргументами, без shell-интерполяции. Проверить отсутствие внешних dependencies у bootstrap-пакета; если они есть, bootstrap прекращается до npm install. Проверить `<prefix>/bin/pnpm --version`, удалить временный tarball в finally. Этот npm-вызов устанавливает только проверенный менеджер пакетов; app dependencies устанавливает pnpm с policy.

- [ ] **Step 2: Записать configs и manifests.**

ESM во всех пакетах; сервер и agent/contracts компилируются TypeScript `NodeNext` в `dist/`, локальные импорты в серверных исходниках заканчиваются `.js`. Frontend использует `moduleResolution: Bundler`. `contracts` и `agent` экспортируют `dist/index.js` и `dist/index.d.ts`; сначала собираются contracts, затем agent, затем server. В scaffold index.ts этих пакетов содержит `export {};`, пока соответствующая задача не добавит exports. Manifests server/agent/contracts включают `files: ["dist"]`. Не менять exports между dev и production.

```json
{
  "name": "crewbus",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.6.0",
  "engines": { "node": "24.21.0" },
  "scripts": {
    "build:packages": "pnpm --filter @crewbus/contracts build && pnpm --filter @crewbus/agent build",
    "build": "pnpm build:packages && pnpm --filter @crewbus/server build && pnpm --filter @crewbus/web build",
    "typecheck": "pnpm build:packages && pnpm -r typecheck",
    "test": "pnpm build:packages && vitest run",
    "test:e2e": "playwright test",
    "dev:server": "pnpm build:packages && pnpm --filter @crewbus/server dev",
    "dev:web": "pnpm --filter @crewbus/web dev"
  }
}
```

Корневой Vitest использует Node environment и включает `apps/**/test/**/*.test.ts`, `packages/**/test/**/*.test.ts`; Playwright-файлы исключены. `config.ts` читает `CREWBUS_DATA_DIR`, `HOST`, `PORT`; default host без Docker — `127.0.0.1`, default port — `3000`.

Проверенные по npm metadata кандидаты на 2026-10-12, опубликованные до 2026-09-28:

| Назначение | Версии |
| --- | --- |
| Server | `fastify@5.12.5`, совместимая с Fastify 5 линия `@fastify/static@8.3.0` |
| Schema/pi | `typebox@1.3.27`, pi-ai/pi-agent-core `0.87.1` |
| Frontend | `react@19.3.0`, `react-dom@19.3.0`, `vite@8.3.1`, `@vitejs/plugin-react@6.1.1` |
| CSS | `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3` |
| Tooling | `typescript@6.0.3`, `tsx@4.23.15`, `vitest@5.0.2`, `@playwright/test@1.63.0` |
| Types | `@types/node@24.19.0`, `@types/react@19.3.0`, `@types/react-dom@19.3.0` |
| AI UI | `ai@7.0.118`, `zod@4.6.5`, `streamdown@2.6.0`, `lucide-react@1.48.0`, `use-stick-to-bottom@1.1.6`, `nanoid@6.0.1` |
| UI utilities | `clsx@2.1.1`, `tailwind-merge@3.7.0`, `class-variance-authority@0.7.1` |
| CLI, только если нужен | `shadcn@4.21.0` |

Это кандидаты для первого резолва, а не проверенный lockfile. Дополнительные Radix, Shiki, Streamdown plugin и обязательные peer-зависимости брать из импортируемых исходников и npm manifests, выбирать точные стабильные версии с выдержкой. Не добавлять optional peers без фактического использования. Fastify принимает JSON Schema из `typebox`; отдельный TypeBox type-provider не нужен. Если кандидат не проходит совместимость/audit, выбрать выдержанный исправленный релиз, записать причину в dependencies.json; для смены pi отдельно сверить API и этот план.

- [ ] **Step 3: Подготовить проверяемые UI-исходники.**

AI Elements upstream: `vercel/ai-elements`, SHA `6a9d5b1822ffb10bba4bd97175f01edd7d8651cd`, файлы `packages/elements/src/{conversation,message,prompt-input,tool,model-selector,code-block}.tsx`. Shadcn upstream: `shadcn-ui/ui`, SHA `30a58d4498f270af1c1e981a7d78a15cf5740841`, основа `apps/v4/registry/new-york-v4/ui/`.

`vendor-ui.mjs` загружает только raw GitHub URL с указанным SHA, сохраняет оригинал в `vendor/ui/`, SHA-256 и лицензию в `docs/ui-provenance.json`, затем создаёт рабочую копию в `apps/web/src/components/`. Для AI Elements заменяет `@repo/shadcn-ui/components/ui/` на `@/components/ui/`, `@repo/shadcn-ui/lib/utils` на `@/lib/utils`. Для shadcn нормализует внутренние imports к тому же alias. Отдельно хранить upstream и итоговый SHA-256, чтобы локальные изменения были видимы.

Включить транзитивно импортируемые shadcn-компоненты выбранных AI Elements и элементы приложения: button, button-group, tooltip, badge, collapsible, command, dropdown-menu, hover-card, input-group, select, spinner, dialog, sheet, input, textarea, label, checkbox, sidebar и их фактические локальные зависимости. Список определяется imports файлов фиксированного снимка, а не изменяемым registry URL. Если локальный import отсутствует, импорт завершается ошибкой. Текущая проверенная Conversation тоже импортирует тип `UIMessage` из `ai`; зависимости исходного registry-исследования не считать неизменными.

Критическая часть сохранения происхождения:

```js
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

export async function saveUpstream(url, target) {
  if (!/^https:\/\/raw\.githubusercontent\.com\/.+\/[0-9a-f]{40}\//.test(url)) {
    throw new Error('Upstream URL must include a commit SHA');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Source fetch failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(new URL('.', target), { recursive: true });
  await writeFile(target, bytes);
  return { url, sha256: createHash('sha256').update(bytes).digest('hex') };
}
```

Прочитать imports, сырой HTML, обработчики ссылок и optional действия перед подключением; импорт не выполняет код upstream. Отключать отсутствующие функции в композиции приложения, а не показывать неработающие кнопки. Токены Crewbus определить в `styles.css`; `cn` — `twMerge(clsx(...inputs))`.

- [ ] **Step 4: Написать health test, получить ожидаемый FAIL.**

```ts
import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';

test('health отвечает без обращения к провайдеру', async () => {
  const app = await createApp({ dataDir: ':memory:' });
  try {
    const response = await app.inject('/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ready: true });
  } finally { await app.close(); }
});
```

Run: `pnpm exec vitest run apps/server/test/health.test.ts`. Ожидается FAIL: маршрут ещё не зарегистрирован.

- [ ] **Step 5: Реализовать запускаемый каркас и health.**

```ts
import Fastify from 'fastify';
import type { Models } from '@earendil-works/pi-ai';

export interface AppOptions { dataDir: string; models?: Models }
export async function createApp(options: AppOptions) {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({ ready: true }));
  return app;
}
```

`main.ts` вызывает createApp/listen, обрабатывает SIGINT/SIGTERM через app.close. Пока Task 3 не подключила SQLite, health проверяет только HTTP-каркас; итоговый health обязательно проверяет базу. Vite проксирует `/api` на `http://127.0.0.1:3000`; alias `@` указывает на `apps/web/src`. `app.tsx` пока отображает название приложения и место для чата; готовые AI-компоненты должны компилироваться уже здесь.

- [ ] **Step 6: Резолв, review build scripts, повторная чистая установка и проверки.**

Run: `pnpm install`, затем `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm audit --prod --audit-level=high`. Первый install с неизвестными build scripts обязан остановиться. Прочитать конкретные скрипты, разрешить только проверенные точные версии в allowBuilds и повторить установку. Ошибки возраста, provenance или audit не обходить исключениями. Проверить clean install в новом каталоге без node_modules. Ожидается: health test PASS, web/server собираются; секретов и импортов Next.js нет.

- [ ] **Step 7: Commit.**

`git add package.json pnpm-workspace.yaml pnpm-lock.yaml .node-version .npmrc .gitignore tsconfig.base.json vitest.config.ts apps packages scripts/bootstrap-pnpm.mjs scripts/vendor-ui.mjs vendor docs/dependencies.json docs/ui-provenance.json`

`git commit -m "build: establish protected workspace and application shell"`

## Task 2: Публичные DTO и reducer событий

**Files:** Create `packages/contracts/src/{index,domain,events,reducer}.ts`, `apps/web/src/chat/reducer.ts`, `apps/web/test/chat-reducer.test.ts`.

**Interfaces:** Produces `Todo`, `ChatSummary`, `RunSummary`, `MessageView`, `ToolView`, `ChatSnapshot`, `CrewEvent`, `reduceChat(snapshot: ChatSnapshot, event: CrewEvent): ChatSnapshot`. Серверные pi messages не являются HTTP DTO.

- [ ] **Step 1: Зафиксировать public contracts.**

```ts
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type TodoToolName = 'todo_create' | 'todo_list' | 'todo_update' | 'todo_delete';
export interface Todo {
  id: string; chatId: string; title: string; completed: boolean;
  createdAt: number; updatedAt: number;
}
export interface ChatSummary {
  id: string; title: string; providerId: string; modelId: string;
  createdAt: number; updatedAt: number;
}
export interface RunSummary {
  id: string; chatId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted';
  reason: null | 'turn_limit' | 'timeout' | 'user_abort' | 'provider_error' | 'storage_error' | 'process_restart';
  error: string | null; startedAt: number; endedAt: number | null;
}
export interface ToolView {
  id: string; name: string; state: 'running' | 'completed' | 'failed' | 'interrupted';
  input: JsonValue; output: JsonValue | null; error: string | null;
}
export interface MessageView {
  id: string; role: 'user' | 'assistant'; text: string;
  state: 'streaming' | 'completed' | 'interrupted'; tools: ToolView[];
}
export interface ChatSnapshot {
  chat: ChatSummary; todos: Todo[]; messages: MessageView[];
  run: RunSummary | null; lastEventId: number;
}
export type EventData =
  | { type: 'message.started'; message: MessageView }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.completed'; message: MessageView }
  | { type: 'tool.started'; messageId: string; tool: ToolView }
  | { type: 'tool.completed'; messageId: string; tool: ToolView }
  | { type: 'todos.changed'; todos: Todo[] }
  | { type: 'run.finished'; run: RunSummary };
export interface CrewEvent { id: number; runId: string; chatId: string; data: EventData }
```

Входы API: `CreateChatInput { providerId; modelId }`, `StartRunInput { text; clientRequestId }`, `UpdateTodoInput { title?: string; completed?: boolean }`. Идентификаторы — UUID от сервера, timestamp — Unix milliseconds. Неизвестные поля входных объектов отклоняются. `message.completed` заменяет полное MessageView по ID; delta дописывает только текст. Tool result обновляет существующий ToolView по ID.

- [ ] **Step 2: Написать проверку повторной доставки и получить FAIL.**

```ts
import { expect, test } from 'vitest';
import type { ChatSnapshot, CrewEvent } from '@crewbus/contracts';
import { reduceChat } from '../src/chat/reducer.js';

test('delta применяется один раз и чужой чат не меняет snapshot', () => {
  const snapshot: ChatSnapshot = {
    chat: { id: 'c', title: 'Чат', providerId: 'faux', modelId: 'faux-model', createdAt: 0, updatedAt: 0 },
    todos: [], messages: [{ id: 'm', role: 'assistant', text: '', state: 'streaming', tools: [] }],
    run: { id: 'r', chatId: 'c', status: 'running', reason: null, error: null, startedAt: 0, endedAt: null },
    lastEventId: 0,
  };
  const event: CrewEvent = { id: 1, runId: 'r', chatId: 'c', data: { type: 'message.delta', messageId: 'm', delta: 'Привет' } };
  const next = reduceChat(snapshot, event);
  expect(reduceChat(next, event).messages[0].text).toBe('Привет');
  expect(reduceChat(next, { ...event, id: 2, chatId: 'other' })).toEqual(next);
});
```

Run: `pnpm test -- apps/web/test/chat-reducer.test.ts`; FAIL до reducer.

- [ ] **Step 3: Реализовать reducer с обработкой всех семи EventData.**

```ts
import type { ChatSnapshot, MessageView } from './domain.js';
import type { CrewEvent } from './events.js';

export function reduceChat(snapshot: ChatSnapshot, event: CrewEvent): ChatSnapshot {
  if (snapshot.chat.id !== event.chatId || snapshot.run?.id !== event.runId || event.id <= snapshot.lastEventId) return snapshot;
  const next = structuredClone(snapshot);
  const data = event.data;
  const upsertMessage = (message: MessageView) => {
    const index = next.messages.findIndex(item => item.id === message.id);
    if (index < 0) next.messages.push(message); else next.messages[index] = message;
  };
  switch (data.type) {
    case 'message.started':
    case 'message.completed': upsertMessage(data.message); break;
    case 'message.delta': {
      const message = next.messages.find(item => item.id === data.messageId);
      if (!message) throw new Error('Missing message for delta');
      message.text += data.delta;
      break;
    }
    case 'tool.started':
    case 'tool.completed': {
      const message = next.messages.find(item => item.id === data.messageId);
      if (!message) throw new Error('Missing message for tool');
      const index = message.tools.findIndex(item => item.id === data.tool.id);
      if (index < 0) message.tools.push(data.tool); else message.tools[index] = data.tool;
      break;
    }
    case 'todos.changed': next.todos = data.todos; break;
    case 'run.finished': {
      next.run = data.run;
      for (const message of next.messages) {
        if (message.state === 'streaming') message.state = 'interrupted';
        for (const tool of message.tools) if (tool.state === 'running') tool.state = 'interrupted';
      }
      break;
    }
  }
  next.lastEventId = event.id;
  return next;
}
```

Реализация живёт в `packages/contracts/src/reducer.ts`, exports — в index.ts; frontend `chat/reducer.ts` реэкспортирует её. Тип CrewEvent импортировать из events.ts, остальные — domain.ts. Сервер использует этот же чистый reducer при построении snapshot. Если message.started повторно встречает существующий ID на новом cursor, сохранять более полный уже показанный объект, а не затирать text; нормальная доставка фиксирует message.started один раз. При пропуске обязательного предшествующего события frontend получает новый snapshot вместо попытки угадать данные. Добавить отдельные тесты для message.completed после delta, двух разных toolCallId, todos.changed и run.finished без изменения готовых результатов.

- [ ] **Step 4: Проверить и commit.**

Run: `pnpm test -- apps/web/test/chat-reducer.test.ts`, `pnpm typecheck`. Ожидается PASS, без imports из pi/runtime AI SDK в public contracts.

`git add packages/contracts apps/web/src/chat/reducer.ts apps/web/test/chat-reducer.test.ts`

`git commit -m "feat: define chat protocol and replay-safe reducer"`

## Task 3: SQLite, диалоги и журнал результатов тудушек

**Files:** Create `apps/server/src/storage/{database,migrations,index}.ts`, `apps/server/src/chats/repository.ts`, `apps/server/src/todos/service.ts`, `apps/server/src/events/repository.ts`, `apps/server/src/lib/error.ts`; tests `apps/server/test/{storage,todos}.test.ts`; modify `apps/server/src/app.ts`.

**Interfaces:** Produces `createStorage(dataDir: string): Storage`, `Storage.close(): void`, `Storage.transaction<T>(fn: () => T): T`, repositories `storage.chats`, `storage.runs`, `storage.events`, `storage.todos`. `:memory:` используется только тестами; иначе файл `crewbus.sqlite` в закрытом каталоге dataDir.

Основные repository contracts:

```ts
export interface ToolContext { chatId: string; runId: string; toolCallId: string }
export interface ChatRepository {
  create(selection: { providerId: string; modelId: string }): ChatSummary;
  get(id: string): ChatSummary;
  list(): ChatSummary[];
  setModel(id: string, selection: { providerId: string; modelId: string }): ChatSummary;
}
export interface TodoService {
  create(chatId: string, input: { title: string }): Todo;
  list(chatId: string, completed?: boolean): Todo[];
  update(chatId: string, id: string, input: { title?: string; completed?: boolean }): Todo;
  delete(chatId: string, id: string): { id: string };
  apply(context: ToolContext, name: TodoToolName, input: unknown, signal?: AbortSignal): JsonValue;
}
export interface EventRepository {
  append(runId: string, data: EventData): CrewEvent;
  since(runId: string, after: number): CrewEvent[];
  cursor(runId: string): number;
}
```

`AppError` в `lib/error.ts` содержит `statusCode`, `code`, безопасный `message`. Ошибки: invalid_input 400, not_found 404, conflict 409. Репозитории выбрасывают AppError, HTTP переводит её в `{ error: { code, message } }`; необработанные ошибки возвращают 500 с общим текстом, без stack и секретов.

- [ ] **Step 1: Написать тест атомарного изменения и получить FAIL.**

```ts
import { expect, test } from 'vitest';
import { createStorage } from '../src/storage/index.js';

test('повтор toolCallId возвращает результат без второй задачи', () => {
  const s = createStorage(':memory:');
  try {
    const chat = s.chats.create({ providerId: 'faux', modelId: 'faux-model' });
    const run = s.runs.accept(chat.id, { text: 'Создай задачу', clientRequestId: crypto.randomUUID() }, 'system');
    const context = { chatId: chat.id, runId: run.run.id, toolCallId: 'call-1' };
    const first = s.todos.apply(context, 'todo_create', { title: ' Изучить pi ' });
    expect(s.todos.apply(context, 'todo_create', { title: ' Изучить pi ' })).toEqual(first);
    expect(s.todos.list(chat.id)).toHaveLength(1);
    expect(s.todos.list(chat.id)[0].title).toBe('Изучить pi');
    expect(() => s.todos.apply(context, 'todo_create', { title: 'Другая задача' })).toThrow();
    expect(s.todos.list(chat.id)).toHaveLength(1);
  } finally { s.close(); }
});
```

Run: `pnpm exec vitest run apps/server/test/todos.test.ts`; FAIL до repositories.

- [ ] **Step 2: Создать миграцию и synchronous transaction helper.**

```sql
CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
CREATE TABLE credentials (provider_id TEXT PRIMARY KEY, credential_json TEXT NOT NULL);
CREATE TABLE chats (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE runs (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL REFERENCES chats(id), client_request_id TEXT NOT NULL,
  input_text TEXT NOT NULL, user_message_id TEXT NOT NULL,
  provider_id TEXT NOT NULL, model_id TEXT NOT NULL, system_prompt TEXT NOT NULL,
  status TEXT NOT NULL, reason TEXT, error TEXT,
  started_at INTEGER NOT NULL, ended_at INTEGER,
  UNIQUE(chat_id, client_request_id)
);
CREATE UNIQUE INDEX one_running_per_chat ON runs(chat_id) WHERE status = 'running';
CREATE TABLE messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id),
  run_id TEXT REFERENCES runs(id), ordinal INTEGER NOT NULL,
  role TEXT NOT NULL, canonical_json TEXT NOT NULL,
  UNIQUE(chat_id, ordinal)
);
CREATE TABLE todos (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id),
  title TEXT NOT NULL, completed INTEGER NOT NULL CHECK(completed IN (0, 1)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE tool_results (
  run_id TEXT NOT NULL REFERENCES runs(id), tool_call_id TEXT NOT NULL,
  name TEXT NOT NULL, input_json TEXT NOT NULL, result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY(run_id, tool_call_id)
);
CREATE TABLE events (
  run_id TEXT NOT NULL REFERENCES runs(id), id INTEGER NOT NULL,
  data_json TEXT NOT NULL, PRIMARY KEY(run_id, id)
);
CREATE INDEX todo_chat_order ON todos(chat_id, created_at, id);
```

Открывать `DatabaseSync`, включать foreign_keys, WAL для файловой базы и busy_timeout. Миграция и version записываются одной транзакцией. DDL создаётся только для version 0; повторное открытие не теряет данные. Каталог создавать с mode 0700, файл — 0600 в Linux-контейнере; не менять права чужих каталогов.

```ts
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    if (result instanceof Promise) throw new Error('SQLite transaction must be synchronous');
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
```

Публичные methods имеют одну границу transaction; внутренние варианты принимают существующую transaction, чтобы не выполнять вложенные BEGIN. Snapshot позже использует обычную read transaction. UUID генерируются через `randomUUID` из node:crypto. Все SQL-параметры передаются placeholders, не конкатенацией пользовательского ввода.

- [ ] **Step 3: Реализовать CRUD и атомарный apply.**

`title.trim()` проверяется на длину 1–500; update требует хотя бы title или completed; completed должен быть boolean. Все lookup включают chat_id. list сортирует `(created_at, id)` и применяет необязательный completed. Точное сравнение повторов выполняется по канонической JSON-сериализации входа с отсортированными ключами, независимо от порядка полей объекта; имя инструмента тоже входит в сравнение.

```ts
function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}
```

В apply: проверить валидность ToolContext/аргументов и принадлежность run диалогу; проверить AbortSignal; внутри одной transaction прочитать tool_results. При совпадении вернуть сохранённый JSON, при несовпадении бросить 409 без изменения. Для нового вызова выполнить соответствующий CRUD внутренним методом и INSERT результата до commit. `todo_list` также сохраняет snapshot результата. Никаких await между изменением задачи и журналом. Поздняя отмена не заменяет успешный результат.

- [ ] **Step 4: Реализовать accept и EventRepository.**

`storage.runs.accept(chatId, input, systemPrompt): { run: RunSummary; created: boolean; userMessageId: string }` сначала ищет совпадающий clientRequestId: тот же текст возвращает existing, иной текст — 409. Затем проверяет busy, фиксирует выбранную пару provider/model в run, INSERT user message и run одной transaction. initial user message получает server timestamp и стабильный UUID. Последующие message_start/message_end обновляют тот же ID. Начальный system message хранится с ordinal 0; пользовательские и последующие сообщения — начиная с 1.

Дополнительные methods: `runs.get(runId): RunSummary`, `runs.list(chatId): RunSummary[]`, `runs.unfinished(): RunSummary[]`, `runs.finish(runId, status, reason, error): RunSummary`; private row также содержит text, userMessageId, selection, systemPrompt. `events.append` назначает `MAX(id)+1`, начиная с 1, внутри transaction; событие узнаёт chatId из run. append не публикует сеть. `events.cursor` возвращает 0 при отсутствии событий.

- [ ] **Step 5: Проверить перезапуск, изоляцию, rollback и health.**

Дополнить tests: открыть/закрыть файловую базу в временном каталоге, повторно прочитать чат/задачу; попытаться update/delete задачи другого чата; title из пробелов; update без изменений; AbortSignal до apply; искусственная ошибка между CRUD и INSERT журнала через SQLite trigger должна откатить обе записи. Параллельные start одного чата дают один новый run. Повтор accept после completed возвращает существующий run.

В createApp создать storage и закрывать через onClose. Health делает `SELECT 1`; при ошибке возвращает 503 `{ ready: false }` и не вызывает модель. Run: `pnpm test`, `pnpm typecheck`; ожидается PASS.

- [ ] **Step 6: Commit.**

`git add apps/server/src apps/server/test`

`git commit -m "feat: persist chats and atomic todo tool results"`

## Task 4: CredentialStore и выбор провайдера/модели

**Files:** Create `apps/server/src/storage/credential-store.ts`, `apps/server/src/providers/{catalog,routes}.ts`, `apps/server/src/lib/serial.ts`, `apps/server/test/providers.test.ts`; modify `apps/server/src/app.ts`.

**Interfaces:** Produces `SqliteCredentialStore implements CredentialStore`, constructor `(storage: Storage)`; `createCatalog(models: Models, credentials: CredentialStore, isProviderBusy?: (providerId: string) => boolean): CatalogService`. Methods `listProviders(): Promise<ProviderView[]>`, `listModels(providerId: string): ModelView[]`, `assertSelection(providerId: string, modelId: string): Model<Api>`, `saveKey(providerId: string, key: string): Promise<void>`, `deleteKey(providerId: string): Promise<void>`, `withProviderLock<T>(providerId: string, fn: () => Promise<T>): Promise<T>`. `ProviderView { id: string; name: string; configured: boolean }`; `ModelView { id: string; name: string; providerId: string; contextWindow: number }`. Private fields never spread into responses.

- [ ] **Step 1: Написать тест ключа и получить FAIL.**

```ts
import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';

test('ключ сохраняется, но API не возвращает его', async () => {
  const app = await createApp({ dataDir: ':memory:' });
  try {
    const secret = 'test-secret-that-must-not-be-returned';
    const put = await app.inject({ method: 'PUT', url: '/api/providers/openai/credential', payload: { key: secret } });
    expect(put.statusCode).toBe(204);
    const list = await app.inject('/api/providers');
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(secret);
    expect(list.json().find((p: { id: string }) => p.id === 'openai').configured).toBe(true);
  } finally { await app.close(); }
});
```

Run: `pnpm exec vitest run apps/server/test/providers.test.ts`; FAIL до routes.

- [ ] **Step 2: Реализовать serial read-modify-write.**

```ts
export class SerialByKey {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    const tail = result.catch(() => {});
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }
}
```

read/list проверяют signal и выполняют SQL без секретов в list. modify внутри SerialByKey читает current, awaits callback, проверяет signal перед записью; undefined оставляет current неизменным. delete использует ту же очередь. SQL-транзакция не удерживается через async callback. Не подавлять storage failures. На restart читать persisted credential_json; тип — `{ type: 'api_key', key }`.

- [ ] **Step 3: Подключить builtinModels и public catalog.**

```ts
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

const models = options.models ?? builtinModels({
  credentials,
  authContext: { env: async () => undefined, fileExists: async () => false },
});
```

Не использовать случайные ambient credentials окружения вместо введённого ключа. Catalog берёт id/name/models из `models.getProviders()`/`models.getModels(providerId)`. При подготовке списка проверить auth.apiKey.login/resolve built-in factories выбранной версии: показывать только формы с одним ключом без обязательных дополнительных env/baseUrl/OAuth. Наличие `auth.apiKey` само по себе не означает простой ключ. Результат проверки оформить в `catalog.ts` как политику доступности провайдеров, а не собственные модели или адаптеры. Обязательно включить проверенные OpenAI, Anthropic и DeepSeek; подключить остальные удовлетворяющие критерию built-ins. Тестовые Models допускают faux provider без регистрации в production.

Сохранение key не выполняет платный пробный запрос. Пустой key — 400; unknown provider/model — 404; неподдерживаемая форма — 400. Внутри provider queue перед save/delete вызвать isProviderBusy и возвращать 409 при активном запуске. createApp передаёт callback, проверяющий storage.runs.unfinished и, после Task6, active slots менеджера. В самостоятельных catalog tests default callback возвращает false. Старт run позднее использует ту же очередь для резервации, чтобы закрыть гонку с изменением ключа; вложенного входа в ту же очередь нет.

- [ ] **Step 4: Реализовать routes с response schemas.**

GET providers возвращает только ProviderView[], GET models — ModelView[]. PUT credential возвращает 204 без body; DELETE — 204. Запросы и ответы валидируются JSON Schema; `additionalProperties: false`. Logging body/Authorization отключён; сохраняемые исключения очищаются от текущего secret до выхода наружу. Файловый restart test подтверждает configured без возврата ключа. Unit test modify проверяет два одновременно вызванных callback и сохранение записи при callback→undefined.

- [ ] **Step 5: Проверить и commit.**

Run: `pnpm exec vitest run apps/server/test/providers.test.ts`, `pnpm typecheck`. Ожидается PASS; два поддерживаемых провайдера используют один catalog и одинаковый путь сохранения ключа.

`git add apps/server/src apps/server/test/providers.test.ts`

`git commit -m "feat: configure pi providers with persistent API keys"`

## Task 5: pi Agent и только четыре todo-инструмента

**Files:** Create `packages/agent/src/{index,create-agent,system-prompt,todo-port}.ts`, `packages/agent/src/tools/todos.ts`, `packages/agent/test/agent.test.ts`.

**Interfaces:** Produces `createTodoTools(options: TodoToolOptions): AgentTool[]`, `createCrewAgent(options: CrewAgentOptions): Agent`; consumes Models and ToolContext/TodoToolName/JsonValue. `TodoPort.apply` синхронен и соответствует TodoService из Task 3; пакет agent не импортирует Fastify/SQLite.

- [ ] **Step 1: Написать реальный fauxProvider test, получить FAIL.**

```ts
import { expect, test } from 'vitest';
import { createModels, fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { createCrewAgent } from '../src/create-agent.js';

test('агент исполняет todo_create и получает фактический результат', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const calls: string[] = [];
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('todo_create', { title: 'Изучить pi' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('Задача создана')]),
  ]);
  const agent = createCrewAgent({
    models, model: faux.getModel(), messages: [], runId: 'r', chatId: 'c',
    todos: { apply: (_context, name) => { calls.push(name); return { id: 't', title: 'Изучить pi' }; } },
    requireTodoRefresh: false, onEvent: async () => {}, onTurnLimit: () => {},
  });
  expect(agent.state.tools.map(t => t.name)).toEqual(['todo_create', 'todo_list', 'todo_update', 'todo_delete']);
  await agent.prompt('Создай задачу');
  expect(calls).toEqual(['todo_create']);
  expect(agent.state.messages.filter(m => m.role === 'system')).toHaveLength(1);
  expect(agent.state.messages.some(m => m.role === 'toolResult')).toBe(true);
  expect(faux.state.callCount).toBe(2);
});
```

Run: `pnpm exec vitest run packages/agent/test/agent.test.ts`; FAIL до factory.

- [ ] **Step 2: Реализовать schemas и executor.**

```ts
import { Type } from 'typebox';

export const todoSchemas = {
  todo_create: Type.Object({ title: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false }),
  todo_list: Type.Object({ completed: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  todo_update: Type.Object({ id: Type.String(), title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })), completed: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  todo_delete: Type.Object({ id: Type.String() }, { additionalProperties: false }),
};
```

`TodoToolOptions { runId; chatId; todos: TodoPort; requireTodoRefresh: boolean }`. Инструменты создаются в указанном порядке, description объясняет область текущего чата. В каждом execute передать toolCallId и signal в TodoPort; return `{ content: [{ type: 'text', text: JSON.stringify(result) }], details: result }`. Ошибки бросать, не маскировать успешным text. Общее замыкание `refreshed = !requireTodoRefresh` блокирует изменяющие tools, пока успешный todo_list не установит refreshed=true. Вызов list без изменений тоже журналируется.

- [ ] **Step 3: Реализовать factory и ограничение turns.**

```ts
export interface CrewAgentOptions {
  models: Models; model: Model<Api>; messages: AgentMessage[];
  runId: string; chatId: string; todos: TodoPort; requireTodoRefresh: boolean;
  onEvent(event: AgentEvent, signal: AbortSignal): Promise<void>;
  onTurnLimit(): void;
}
export function createCrewAgent(options: CrewAgentOptions): Agent {
  let turns = 0;
  const agent = new Agent({
    initialState: { model: options.model, messages: options.messages, systemPrompt: SYSTEM_PROMPT, tools: createTodoTools(options) },
    streamFn: options.models.streamSimple.bind(options.models),
    toolExecution: 'sequential',
    finishTurn: turn => {
      turns += 1;
      if (turn.message.stopReason === 'error' || turn.message.stopReason === 'aborted') return;
      if (turns >= 20 && turn.message.content.some(block => block.type === 'toolCall')) {
        options.onTurnLimit();
        return { action: 'end' };
      }
    },
  });
  agent.subscribe(options.onEvent);
  return agent;
}
```

Imports Agent/types берутся из pi-agent-core, Models/Model/Api — pi-ai. `SYSTEM_PROMPT`: «Ты Crewbus. Общайся с пользователем и управляй задачами текущего диалога через доступные todo-инструменты. Любое изменение задачи выполняй инструментом. Подтверждай действие только по успешному результату; сообщай об ошибке. После прерванного запуска сначала получи актуальные задачи через todo_list. Запуск других агентов пока недоступен». Не обещать несуществующие возможности.

Сохранённый leading system message имеет приоритет в Agent; при восстановлении передавать его ровно один раз. Новый leading system message взять из `agent.state.messages[0]` до prompt и сохранить в сервере. Инструменты двадцатого ответа исполняются, двадцать первый запрос не выполняется. Обычный финальный ответ на turn 20 не устанавливает turn_limit.

- [ ] **Step 4: Проверить schemas, sequential calls, отказ неизвестному инструменту и лимит.**

Добавить faux scripts: два todo_create в одном ответе → порядок вызовов совпадает с порядком blocks; вызов неизвестного tool → error result и ноль calls TodoPort; invalid update без изменений → service error; восстановленная history с system → один system message; 20 ответов с tools → callCount 20 и onTurnLimit один раз; 19 tool-turns + финальный text → completed без onTurnLimit. Перед mutation после recovery требуется list; отсутствующее чтение блокируется без эффекта.

Run: `pnpm exec vitest run packages/agent/test/agent.test.ts`, `pnpm build:packages`, `pnpm typecheck`. Ожидается PASS.

- [ ] **Step 5: Commit.**

`git add packages/agent`

`git commit -m "feat: run pi agent with scoped todo tools"`

## Task 6: Менеджер запусков и сохранение событий pi

**Files:** Create `apps/server/src/chats/{run-manager,agent-events,snapshot}.ts`, `apps/server/src/events/broker.ts`, `apps/server/src/storage/context.ts`, `apps/server/test/run-manager.test.ts`; modify `app.ts`, repositories из Task 3.

**Interfaces:** Produces `createRunManager(options: RunManagerOptions): RunManager`. Options: `storage: Storage`, `models: Models`, `catalog: CatalogService`, `timeoutMs?: number`, `todoPort?: TodoPort` (последние два — внутренние seams тестов). Methods: `start(chatId: string, input: StartRunInput): Promise<{ runId: string; created: boolean }>`, `abort(runId: string): void`, `wait(runId: string): Promise<void>`, `snapshot(chatId: string): ChatSnapshot`, `isChatBusy(chatId: string): boolean`, `isProviderBusy(providerId: string): boolean`, `close(): Promise<void>`. `EventBroker.subscribe(runId, listener): () => void`, `publish(event): void`; listener получает CrewEvent и не обращается к модели.

`CatalogService.withProviderLock<T>(providerId: string, fn: () => Promise<T>): Promise<T>` использует SerialByKey из Task 4. `storage.loadContext(chatId: string, beforeRunId: string): AgentMessage[]` возвращает восстановимую историю до принятого пользовательского сообщения текущего run. `storage.saveMessage(chatId, runId: string | null, messageId, message: AgentMessage): void` upsert по ID с сохранением ordinal.

- [ ] **Step 1: Написать integration test idempotency, получить FAIL.**

```ts
import { expect, test } from 'vitest';
import { createModels, fauxProvider, fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai';
import { createStorage } from '../src/storage/index.js';
import { createCatalog } from '../src/providers/catalog.js';
import { SqliteCredentialStore } from '../src/storage/credential-store.js';
import { createRunManager } from '../src/chats/run-manager.js';

test('повтор start не делает второй запрос к модели', async () => {
  const storage = createStorage(':memory:');
  const faux = fauxProvider();
  const models = createModels(); models.setProvider(faux.provider);
  const catalog = createCatalog(models, new SqliteCredentialStore(storage));
  const manager = createRunManager({ storage, models, catalog });
  try {
    const model = faux.getModel();
    const chat = storage.chats.create({ providerId: model.provider, modelId: model.id });
    faux.setResponses([fauxAssistantMessage([fauxText('Привет')])]);
    const input = { text: 'Привет', clientRequestId: crypto.randomUUID() };
    const first = await manager.start(chat.id, input);
    await manager.wait(first.runId);
    const second = await manager.start(chat.id, input);
    expect(second).toEqual({ runId: first.runId, created: false });
    expect(faux.state.callCount).toBe(1);
    expect(manager.snapshot(chat.id).messages.filter(m => m.role === 'user')).toHaveLength(1);
    expect(manager.snapshot(chat.id).run?.status).toBe('completed');
  } finally { await manager.close(); storage.close(); }
});
```

Test catalog допускает injected faux независимо от production eligibility; старт проверяет доступность через Models.getAuth, faux не требует реального ключа. Run: `pnpm exec vitest run apps/server/test/run-manager.test.ts`; FAIL до manager.

- [ ] **Step 2: Реализовать резервирование и запуск.**

start проверяет input, существующий clientRequestId и text раньше любых проверок credential/busy. Для нового запроса: получить chat, внутри provider lock подтвердить selection и configured auth, проверить in-memory active map, выполнить runs.accept. До выхода из lock зарегистрировать active slot диалога. Сеть и prompt не удерживают lock. При ошибке factory после accept run становится failed с сохранённым конечным событием и освобождением slot.

Создать Agent с loadContext, передать TodoPort и requireTodoRefresh при предыдущем interrupted run. Зафиксировать initial system message, если его ещё нет, с ordinal 0. Для initial prompt передать ранее сохранённый UserMessage с тем же timestamp/content; не вызывать prompt дважды при HTTP retry. Message identity map использует run-local role/index и стабильный userMessageId; полагаться на поле id в pi нельзя. Tool identity всегда `(runId, toolCallId)`.

Сохранить Promise агентного выполнения в active map до возврата start. Terminal callback сохраняет run status/event, а finally очищает timeout и active slot. Ошибка callback сохранения отменяет agent, сохраняется как storage_error при возможности; если SQLite недоступна, не публиковать ложный успех. `wait` ожидает фактическое settlement, включая awaited event listeners. `close` abort всех активных agents и ждёт их settlement до закрытия SQLite.

- [ ] **Step 3: Перевести pi events в канонические записи и public события.**

| Событие pi | Запись и представление |
| --- | --- |
| message_start:user | Использовать уже сохранённый ID; public started только один раз |
| message_start:assistant | Выдать ID, public message.started с пустым текстом |
| message_update:text_delta | Сохранить message.delta; thinking не выдавать за обычный text |
| message_end:assistant | Сохранить полное canonical message; public completed содержит полный текст и существующие ToolView |
| tool_execution_start | tool.started на родительском assistant ID, реальные args |
| tool_execution_end | tool.completed с details, isError и безопасным error; после изменения также todos.changed |
| message_end:toolResult | Сохранить canonical result; не создавать отдельное обычное сообщение UI |
| agent_end | Сохранить итоговый статус, reason и run.finished одной transaction |

При assistant completion текст собирается из всех text blocks; аргументы toolCall сохраняются полностью. Разделять ошибку provider и ошибку отдельного инструмента: error tool result может быть обработан моделью и не обязательно делает весь run failed.

Критический commit-before-publish:

```ts
function persistAndPublish(storage: Storage, broker: EventBroker, runId: string, data: EventData, save: () => void): CrewEvent {
  const event = storage.transaction(() => {
    save();
    return storage.events.append(runId, data);
  });
  broker.publish(event);
  return event;
}
```

append здесь использует существующую transaction. Subscriber возвращает Promise и ожидается pi. Событие run.finished сохраняется внутри agent_end, но его live-публикацию откладывать до освобождения active slot; это предотвращает повторную отправку сразу после финального события в ещё занятый диалог. Сбой DB не должен вести к повторному исполнению prompt или tools.

- [ ] **Step 4: Реализовать snapshot, отмену и причины завершения.**

Snapshot читается одной read transaction: chat, todos, ordered runs, saved events и стабильные user message IDs. Проекция каждого run воспроизводит его события тем же reduceChat; runId/lastEventId сбрасываются на границе запуска. Canonical system и toolResult не становятся обычными MessageView. Принятый user message виден даже до первого pi event; subsequent message.started не дублирует его. Возвращается cursor последнего run и текущий частичный text/tools, соответствующий этому cursor.

Таймер ставится после принятия run на 300 000 ms; только внутренний timeoutMs допускает короткий test. Timeout записывает reason timeout и вызывает abort. Ручной abort — user_abort; completed run остаётся completed. turn_limit callback ставит failed/turn_limit; provider stopReason error ставит failed/provider_error. При конкурентной отмене финал устанавливается один раз: уже завершённое состояние не переписывается. Пользовательский abort не откатывает успешно записанные tool results.

- [ ] **Step 5: Проверить поведение и commit.**

Tests: два одновременно запущенных разных чата → независимые события; другой start занятого чата →409; same ID/different text →409; отключённый listener не останавливает agent; delayed faux + abort →нет новых model calls после settlement; короткий timeout →aborted/timeout; полный ответ на turn 20 →completed; SQL failure при message_end →не опубликован completed. В журнале user одна запись, assistant/toolResult канонические, system ровно один.

Run: `pnpm exec vitest run apps/server/test/run-manager.test.ts`, `pnpm test`, `pnpm typecheck`; PASS.

`git add apps/server/src apps/server/test/run-manager.test.ts`

`git commit -m "feat: persist agent runs and streaming events"`

## Task 7: HTTP чат, ручные тудушки и SSE

**Files:** Create `apps/server/src/chats/routes.ts`, `apps/server/src/todos/routes.ts`, `apps/server/src/events/sse.ts`, `apps/server/test/{http,sse}.test.ts`; modify `app.ts`.

**Interfaces:** Register all spec routes. SSE endpoint `/api/runs/:id/events?after=:eventId`, response `text/event-stream`. Input header Last-Event-ID has precedence. HTTP start returns 202 `{ runId }` for new and repeated accepted requests; abort returns 202, terminal abort is harmless. JSON errors follow AppError contract.

- [ ] **Step 1: Написать HTTP isolation test, получить FAIL.**

```ts
import { expect, test } from 'vitest';
import { createApp } from '../src/app.js';

test('ручной update не может изменить задачу другого чата', async () => {
  const app = await createApp({ dataDir: ':memory:' });
  try {
    const selection = { providerId: 'openai', modelId: 'gpt-4o-mini' };
    const create = async () => (await app.inject({ method: 'POST', url: '/api/chats', payload: selection })).json();
    const a = await create(), b = await create();
    const task = (await app.inject({ method: 'POST', url: `/api/chats/${a.id}/todos`, payload: { title: 'Задача' } })).json();
    const edit = await app.inject({ method: 'PATCH', url: `/api/chats/${b.id}/todos/${task.id}`, payload: { completed: true } });
    expect(edit.statusCode).toBe(404);
    expect((await app.inject(`/api/chats/${a.id}/todos`)).json()[0].completed).toBe(false);
  } finally { await app.close(); }
});
```

Если каталог выбранного тега не содержит указанной модели, тест получает first model из GET models, а не вводит фиктивный ID в production catalog. Run: `pnpm exec vitest run apps/server/test/http.test.ts`; FAIL до routes.

- [ ] **Step 2: Реализовать JSON routes.**

POST chat —201 ChatSummary; GET list —ChatSummary[]; PATCH chat —ChatSummary; GET chat —ChatSnapshot. POST todo —201 Todo, PATCH —Todo, DELETE —200 `{ id }`, GET —Todo[]. Все ручные mutations проверяют busy и выполняются через тот же TodoService. Запрет активного run проверяется в той же синхронной transaction, что изменение; active map менеджера также учитывается до settlement. PATCH model проверяет catalog и busy, credential routes учитывают provider locks Task 4. Не возвращать internal row с credential/systemPrompt/raw canonical transcript.

- [ ] **Step 3: Реализовать SSE replay-before-live без пропусков.**

```ts
export function encodeEvent(event: CrewEvent): string {
  return `id: ${event.id}\nevent: crewbus\ndata: ${JSON.stringify(event)}\n\n`;
}
export function parseCursor(header: string | undefined, after: string | undefined, maximum: number): number {
  const raw = header ?? after ?? '0';
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new AppError(400, 'invalid_input', 'Некорректный cursor');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) throw new AppError(400, 'invalid_input', 'Некорректный cursor');
  return value;
}
```

Проверить run existence и cursor до отправки headers. Создать broker subscription, буферизующую live-события, затем прочитать events.since. Объединить replay и буфер по ID, отправлять строго по возрастанию, пропускать id<=последнего отправленного. Один последовательный writer обслуживает replay/live, включая backpressure `write`→false и ожидание drain; не блокировать запись SQLite или Agent на скорости браузера. При заполнении ограниченной очереди закрыть подписку, клиент восстановится по cursor; не терять события в storage. На request close удалить listener/heartbeat, agent.abort не вызывать. Heartbeat —SSE comment без ID раз в 15 секунд. No-cache headers, без gzip buffering.

После run.finished закончить stream; для terminal run воспроизвести оставшиеся events и закрыть. Если cursor уже равен terminal cursor, завершить сразу. Ограниченная очередь live-событий содержит не более 256 events; переполнение закрывает только connection. После disconnect и reconnect число model calls неизменно.

- [ ] **Step 4: Проверить SSE реальным HTTP-соединением.**

Тест запускает app.listen на ephemeral localhost port, читает stream через fetch ReadableStream. Взять snapshot.lastEventId, открыть after=cursor, запустить faux streaming; проверить increasing IDs. Отменить чтение, дождаться manager completion, повторить запрос с Last-Event-ID: получить только пропущенные events, включая run.finished. Проверить precedence header над after, after=-1/1.5/число больше cursor→400, неизвестный run→404, terminal stream EOF. Смену model/manual edit/credential при busy проверить на409. invalid request >16000, extra field, пустой title→400 без изменения базы.

Run: `pnpm exec vitest run apps/server/test/http.test.ts apps/server/test/sse.test.ts`, `pnpm typecheck`; PASS.

- [ ] **Step 5: Commit.**

`git add apps/server/src apps/server/test/http.test.ts apps/server/test/sse.test.ts`

`git commit -m "feat: expose chat API and resumable SSE"`

## Task 8: Интерфейс чата, настроек и тудушек

**Files:** Create `apps/web/src/api/{http,client,events}.ts`, `apps/web/src/chat/{use-chat,conversation,tool-card}.tsx`, `apps/web/src/settings/provider-dialog.tsx`, `apps/web/src/todos/todo-panel.tsx`; modify `apps/web/src/app.tsx`, `src/styles.css`, исходники AI Elements только для нужной локализации; create `tests/e2e/chat.spec.ts`, `scripts/e2e-server.ts`, `playwright.config.ts`.

**Interfaces:** Produces `api` с methods: `providers`, `models(providerId)`, `saveKey(providerId,key)`, `deleteKey(providerId)`, `chats`, `createChat(selection)`, `setModel(chatId,selection)`, `snapshot(chatId)`, `startRun(chatId,input)`, `abortRun(runId)`, `createTodo(chatId,input)`, `updateTodo(chatId,id,input)`, `deleteTodo(chatId,id)`; все возвращают Promise public DTO либо void. `connectEvents(runId: string, after: number, onEvent: (event: CrewEvent) => void, onError: () => void): () => void` возвращает cleanup. `useChat(chatId: string)` возвращает `{ snapshot, loading, error, send(text), retrySend(), stop(), refresh() }`.

- [ ] **Step 1: Написать E2E сценарий, получить FAIL на незавершённом UI.**

```ts
import { expect, test } from '@playwright/test';

test('провайдер → инструмент → сохранённая задача', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый диалог' }).click();
  await page.getByLabel('Провайдер').click();
  await page.getByRole('option', { name: 'Faux' }).click();
  await page.getByLabel('API-ключ').fill('e2e-test-key');
  await page.getByRole('button', { name: 'Сохранить ключ' }).click();
  await page.getByLabel('Модель').click();
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Создать диалог' }).click();
  await page.getByRole('textbox', { name: 'Сообщение' }).fill('Создай задачу Изучить pi');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByTestId('todo-panel').getByText('Изучить pi', { exact: true })).toBeVisible();
  await expect(page.getByTestId('conversation').getByText('Задача создана', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('todo-panel').getByText('Изучить pi', { exact: true })).toBeVisible();
});
```

`e2e-server.ts` создаёт временный каталог, createModels+fauxProvider и createApp({ dataDir, models }); faux script —todo_create+text «Задача создана». `main.ts` production не включает faux mode. Playwright webServer запускает этот entrypoint и Vite через фиксированные local tools; тесты используют отдельный файл базы на worker, не пользовательские данные. Run: `pnpm exec playwright test tests/e2e/chat.spec.ts`; ожидается FAIL, потому что UI-контролов ещё нет.

- [ ] **Step 2: Реализовать typed HTTP client и SSE lifecycle.**

```ts
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error?.message ?? 'Запрос не выполнен');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
```

Расширить ошибку statusCode/code через `HttpError`, чтобы отличать подтверждённый 4xx от сетевого сбоя. Не включать key в text ошибки. connectEvents создаёт EventSource с after, слушает `crewbus`, parses JSON и передаёт reducer. Browser automatic reconnect сам посылает Last-Event-ID; при run.finished закрывать EventSource. Cleanup убирает handlers и закрывает connection, но не вызывает abortRun. Fetch snapshot имеет AbortController; при смене chatId игнорировать старые результаты и events через generation ID.

send создаёт clientRequestId один раз, удерживает input до подтверждённого результата и блокирует вторую отправку. При сетевой неопределённости retrySend повторяет ту же пару ID/text; новый ID не генерируется. После 202 получить свежий snapshot и открыть SSE только для running run. При reload восстанавливать chat selection и snapshot; новый model request не отправляется. Неконсистентная последовательность событий вызывает refresh snapshot, а не дописывание предполагаемых данных.

- [ ] **Step 3: Собрать Conversation и ввод сообщения.**

Основная композиция Conversation:

```tsx
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { PromptInput, PromptInputTextarea, PromptInputSubmit } from '@/components/ai-elements/prompt-input';
import type { ChatSnapshot } from '@crewbus/contracts';
import { ToolCard } from './tool-card.js';

export function ChatConversation({ snapshot, send }: { snapshot: ChatSnapshot; send(text: string): Promise<void> }) {
  return <>
<Conversation data-testid="conversation">
  <ConversationContent>
    {snapshot.messages.map(message => (
      <Message key={message.id} from={message.role}>
        <MessageContent><MessageResponse>{message.text}</MessageResponse></MessageContent>
        {message.tools.map(tool => <ToolCard key={tool.id} tool={tool} />)}
      </Message>
    ))}
  </ConversationContent>
  <ConversationScrollButton />
</Conversation>
<PromptInput onSubmit={async ({ text }) => send(text)}>
  <PromptInputTextarea aria-label="Сообщение" disabled={snapshot.run?.status === 'running'} />
  <PromptInputSubmit aria-label="Отправить" disabled={snapshot.run?.status === 'running'} />
</PromptInput>
  </>;
}
```

- [ ] **Step 4: Собрать ToolCard с фактическими состояниями.**

ToolCard —Tool/ToolHeader/ToolContent/ToolInput/ToolOutput. Назначить dynamic-tool + toolName, mapping running→input-available, completed→output-available, failed→output-error. interrupted показывать отдельным badge «Прервано» без выдуманного output; не выдавать его за provider error. Обновить локальный statusLabels/getStatusBadge либо передавать собственный header, чтобы подписи были «Выполняется», «Готово», «Ошибка», «Прервано». Аргументы и результат раскрываются; все значения —React/CodeBlock, без raw HTML. Не отображать reasoning/thinking как обычный ответ или добавлять искусственное reasoning.

- [ ] **Step 5: Собрать ProviderDialog и ModelSelector.**

ProviderDialog сохраняет ключ отдельным запросом, очищает поле после успеха/закрытия, отображает configured без восстановления secret. Создать диалог можно после выбора существующих provider/model; отправить —после настройки ключа. ModelSelector меняет модель только между runs. Настройки/API-ключи не сохраняются в browser storage.

- [ ] **Step 6: Подключить TodoPanel, навигацию и адаптивную композицию.**

Sidebar показывает диалоги и кнопку нового; URL выбранного чата содержит chatId для reload. TodoPanel использует серверный результат, ручные actions disabled при running; при409 refresh. Остановка —отдельная кнопка «Остановить», видимая только running. Reasons отображаются понятным текстом, включая timeout и turn_limit.

На узком экране Sidebar/TodoPanel открываются в Sheet, чат остаётся основной областью. Стили используют semantic tokens, видимый focus и reduced-motion; кастомный визуальный стиль определяется токенами Crewbus. PromptInput не включает attachments, screenshot, microphone или voice actions. До добавления изменения React-компонентов исполнитель читает react-best-practices/shadcn skills; при визуальной проверке —frontend-testing-debugging.

- [ ] **Step 7: Проверить состояния и браузер.**

Reducer tests уже покрывают reconnect. Browser tests: готовый результат инструмента после отмены сохраняется, незавершённый инструмент показывает «Прервано» без output; ошибочный ключ через scripted faux error; busy controls; остановка во время tokensPerSecond streaming; смена диалога во время stream; сохранение ручной прокрутки; Tab navigation Dialog/Sheet; narrow viewport 390×844; отсутствие console errors. Проверить сырой HTML/опасные ссылки в scripted model answer: не исполняются. Проверить после saveKey отсутствие ключа в localStorage/sessionStorage и HTTP responses.

Run: `pnpm test`, `pnpm exec playwright test tests/e2e/chat.spec.ts`, `pnpm typecheck`, `pnpm build`; PASS.

- [ ] **Step 8: Commit.**

`git add apps/web scripts/e2e-server.ts playwright.config.ts tests/e2e/chat.spec.ts`

`git commit -m "feat: build persistent chat and todo interface"`

## Task 9: Восстановление и проверка сбоя после commit инструмента

**Files:** Create `apps/server/src/chats/recovery.ts`, `apps/server/test/recovery.test.ts`, `apps/server/test/fixtures/crash-after-tool.ts`; modify `storage/context.ts`, `chats/snapshot.ts`, `app.ts`.

**Interfaces:** Produces `recoverInterrupted(storage: Storage): void`, выполняется до app.listen/routes availability. Восстановление читает tool_results и каноническую историю; не обращается к Models и не исполняет TodoPort.

- [ ] **Step 1: Написать regression test восстановления результата.**

```ts
import { expect, test } from 'vitest';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createStorage } from '../src/storage/index.js';
import { recoverInterrupted } from '../src/chats/recovery.js';

test('commit задачи переживает отсутствие message_end результата', () => {
  const s = createStorage(':memory:');
  try {
    const chat = s.chats.create({ providerId: 'faux', modelId: 'faux-model' });
    const accepted = s.runs.accept(chat.id, { text: 'Создай задачу', clientRequestId: crypto.randomUUID() }, 'system');
    const assistant = fauxAssistantMessage([fauxToolCall('todo_create', { title: 'Изучить pi' }, { id: 'call-1' })], { stopReason: 'toolUse' });
    s.saveMessage(chat.id, accepted.run.id, 'assistant-1', assistant);
    s.todos.apply({ chatId: chat.id, runId: accepted.run.id, toolCallId: 'call-1' }, 'todo_create', { title: 'Изучить pi' });
    recoverInterrupted(s);
    expect(s.runs.get(accepted.run.id).status).toBe('interrupted');
    expect(s.todos.list(chat.id)).toHaveLength(1);
    recoverInterrupted(s);
    expect(s.todos.list(chat.id)).toHaveLength(1);
    expect(s.events.since(accepted.run.id, 0).filter(e => e.data.type === 'run.finished')).toHaveLength(1);
  } finally { s.close(); }
});
```

Run: `pnpm exec vitest run apps/server/test/recovery.test.ts`; FAIL до recovery.

- [ ] **Step 2: Реализовать фактическое восстановление, без повторного исполнения.**

Для каждого persisted running run внутри transaction: найти assistant toolCall blocks, сопоставить с tool_results по run/call ID. Если есть журнал успеха и нет canonical ToolResultMessage, создать сообщение из сохранённого result_json: role toolResult, toolCallId, toolName, content=[text JSON], isError=false, timestamp=created_at. Назначить стабильный восстановленный messageId; повторный startup не создаёт второй result. UI получает tool.completed с фактическим result и todos.changed; если public assistant отсутствует, восстановить его из сохранённого canonical assistant с тем же ID до tool event.

Затем сохранить interrupted/process_restart и единственное run.finished. Не создавать успешный результат для вызова без журнала. Не «доделывать» tools, не вызывать model. Missing-result/aborted assistant tail исключить из следующего контекста вместе с его несогласованными toolResults; видимый UI transcript сохраняется. Если все результаты достоверны, сохранять согласованную canonical последовательность. Следующий run устанавливает requireTodoRefresh; before mutation агент обязан получить актуальный todo_list.

- [ ] **Step 3: Проверить реальный остановленный процесс.**

Fixture запускает createRunManager с TodoPort wrapper: вызвать исходный storage.todos.apply, после его возврата послать родителю IPC «committed» и завершить процесс до передачи результата агенту. Родитель использует временную файловую DB, открывает её новым createApp и читает snapshot. Проверить: interrupted; задача одна; output карточки показывает сохранённый результат; нет второго provider call после restart; context не содержит orphan toolResult. Затем новый run с faux script todo_list→update→final text работает и не повторяет create.

Отдельные сценарии: crash до commit→задачи нет; после tool_execution_end до message_end→один результат; частичный assistant text→виден interrupted в UI и не подаётся как завершённый ответ модели; два диалога с незавершёнными runs→оба помечены interrupted. Повтор recovery идемпотентен. Контекст восстановления проверить на Anthropic/OpenAI-compatible message constraints через канонические типы и faux transcript inspection.

- [ ] **Step 4: Проверить и commit.**

Run: `pnpm exec vitest run apps/server/test/recovery.test.ts`, `pnpm test`, `pnpm typecheck`; PASS. В браузере reload после восстановления показывает interrupted и сохраняет реально созданную задачу.

`git add apps/server/src apps/server/test/recovery.test.ts apps/server/test/fixtures/crash-after-tool.ts`

`git commit -m "fix: recover committed tool results after interrupted runs"`

## Task 10: Сквозные проверки, Docker и инструкции запуска

**Files:** Create `Dockerfile`, `.dockerignore`, `.docker/node-image.txt`, `compose.yaml`, `.github/workflows/check.yml`, `README.md`, `scripts/{pin-node-image,docker-smoke,verify-ui-provenance}.mjs`, `tests/e2e/{cancel,reconnect,recovery,responsive}.spec.ts`; modify `package.json`, `playwright.config.ts`, `apps/server/src/app.ts`, `main.ts`.

**Interfaces:** Production `pnpm build` выдаёт dist server/agent/contracts и `apps/web/dist`. Fastify static plugin обслуживает web dist, `/api/*` всегда остаётся API и unknown API route возвращает JSON404, а не index.html. `CREWBUS_DATA_DIR=/data`, `HOST=0.0.0.0`, `PORT=3000` в контейнере.

- [ ] **Step 1: Закрепить Node image по digest.**

```bash
docker buildx imagetools inspect node:24.21.0-bookworm-slim --format '{{json .Manifest}}' > /tmp/crewbus-node-manifest.json
```

`pin-node-image.mjs` читает JSON descriptor, требует digest формата sha256 +64 hex, записывает одну строку `node:24.21.0-bookworm-slim@` + digest в `.docker/node-image.txt`. При отсутствии manifest или неправильном digest прекращает работу; не подставляет изменяемый tag. Проверить platform исполнителя, digest manifest index фиксируется для сборки. Другие base images не добавлять.

- [ ] **Step 2: Написать Docker persistence smoke, получить FAIL до Dockerfile.**

`docker-smoke.mjs` через spawn запускает build с pinned NODE_IMAGE, контейнер с временным volume и localhost port. Через API создаёт chat и задачу вручную без внешнего model call, затем удаляет/пересоздаёт контейнер с тем же volume и проверяет сохранённые chat/todo IDs. Script требует health ready, проверяет non-root UID внутри контейнера, завершает child processes и удаляет только свой тестовый volume в finally. Ошибка readiness, неизвестный API route или потеря задачи делает exitCode1. Не использовать данные владельца.

Run: `node scripts/docker-smoke.mjs`; ожидается FAIL до Dockerfile.

- [ ] **Step 3: Собрать multi-stage image и Compose.**

Dockerfile начинается:

```dockerfile
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY . .
RUN node scripts/bootstrap-pnpm.mjs /opt/crewbus-pnpm
ENV PATH="/opt/crewbus-pnpm/bin:${PATH}"
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @crewbus/server deploy --prod --legacy /out/server
RUN cp -R apps/web/dist /out/server/public

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /out/server /app
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production CREWBUS_DATA_DIR=/data HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
```

Проверить pinned pnpm deploy --legacy: production tree содержит server→agent→contracts и pi, без dangling workspace symlinks; output root — /out/server. Manifests files:[dist] из Task1 обеспечивают включение compiled packages. Static root server — `new URL('../public/', import.meta.url)` относительно dist/app.js; в dev без public frontend обслуживает Vite. Если pinned deploy не поддерживает указанное поведение, остановить упаковку, исправить deploy step с проверкой layout и smoke, не менять entrypoint на предположение.

Создать `/data` с владельцем непривилегированного пользователя, USER node, env/data/host/port, EXPOSE3000. Healthcheck использует встроенный fetch Node, без curl package. .dockerignore исключает .git, .research, node_modules, локальные DB/ключи и test artifacts. При shutdown graceful close менеджера предшествует storage.close.

Compose service crewbus: build.args.NODE_IMAGE —обязательный env из pinned файла; ports `127.0.0.1:3000:3000`; named volume `crewbus-data:/data`; одна реплика. Запуск:

```bash
export NODE_IMAGE="$(cat .docker/node-image.txt)"
docker compose up --build
```

- [ ] **Step 4: Завершить browser/E2E и CI проверки.**

Прогнать E2E на faux server: создание/чтение/завершение/удаление задачи агентом; API-key сохранение/замена/удаление; reload во время stream; disconnected EventSource reconnect; double-send; abort и timeout; process restart; узкий viewport; клавиатура; попытки исполнить HTML модели. Для faux update/delete response factory извлекает task ID из реального предыдущего toolResult, не угадывает ID. Сравнить количество model calls до/после reload и reconnect через тестовый harness, без публичного production debug endpoint.

`verify-ui-provenance.mjs` пересчитывает upstream/local hashes по manifests, проверяет pinned URL и наличие license, возвращает1 при незаписанном изменении. Обновление локального hash выполняется осознанно вместе с source diff.

CI использует Node24.21.0, verified pnpm12.6.0, frozen install, typecheck, tests, build, provenance verification, pnpm audit --prod --audit-level=high и Playwright Chromium. Проверенные GitHub Actions refs: checkout `11d5960a326750d5838078e36cf38b85af677262`, setup-node `49933ea5288caeca8642d1e84afbd3f7d6820020`. YAML закрепляет эти SHA, не mutable tags; pnpm устанавливается scripts/bootstrap-pnpm.mjs, PATH добавляется через GITHUB_PATH. Chromium ставится через local `pnpm exec playwright install --with-deps chromium` после locked npm install. Production dependency installation проверяется clean Docker build; не считать успешный локальный node_modules доказательством clean install.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node scripts/verify-ui-provenance.mjs
pnpm audit --prod --audit-level=high
pnpm exec playwright test
node scripts/docker-smoke.mjs
```

Ожидается exit0 каждого шага; не продолжать к completion при failed audit/install/test. После этого дополнительный прогон нужен только при изменениях или выявленных проблемах.

- [ ] **Step 5: Написать README и живую проверку.**

README содержит prerequisites Node24/pnpm12, политику14дней, две команды dev сервер/web, production build/start, Compose с pinned image, расположение данных и секретов, backup при остановленном сервере, выбор провайдера и ключа, лимиты, отсутствие auto-resume и границы будущих subagents. Отдельно описать, что AI Elements не заменяют pi и не требуют useChat.

Если пользователь уже предоставил ключ или настроил его в UI, один короткий live test с выбранным провайдером: создать задачу через чат, увидеть результат и reload persistence. Ключ не запрашивать через shell args, не выводить. Если ключа нет, автоматическая готовность подтверждается faux tests; явно отметить live compatibility как непроверенную, не создавать видимость внешнего теста.

- [ ] **Step 6: Review и commit.**

Исполнитель применяет requesting-code-review и verification-before-completion; проверяет фактический diff, результаты CI и Docker smoke. Полный результат не считать готовым до прохождения обязательных проверок. Integration ветки —отдельный этап после готовности.

`git add Dockerfile .dockerignore .docker compose.yaml .github README.md scripts tests/e2e package.json playwright.config.ts apps/server/src`

`git commit -m "build: package and verify Crewbus MVP"`

## Сверка плана со спецификацией

| Требование | Реализация и проверка |
| --- | --- |
| Node24, pnpm14дней, trust/build policies, frozen lockfile | Task1 установка/clean install; Task10 CI/Docker |
| React/Vite, shadcn/AI Elements, provenance | Task1 фиксированные UI snapshots; Task8 композиция; Task10 hashes |
| pi providers и секреты только на сервере | Task4 CredentialStore/catalog/response schemas; Task8 form clearing; Task10 live smoke |
| Каноническая история и один system message | Task5 Agent factory; Task6 identity/context; Task9 recovery |
| Один run на чат, idempotency | Task3 UNIQUE indexes/accept; Task6 active map/provider lock; Task7 HTTP409 |
| Четыре todo-tools и ручная панель | Task3 общий service; Task5 tools; Task7 routes; Task8 panel |
| Стриминг, snapshot/cursor, reconnect без model replay | Task2 reducer; Task6 persisted events; Task7 SSE; Task8 lifecycle; Task10 E2E |
| Abort, таймаут, turn limit, ошибки | Task5 лимит; Task6 settlement/reasons; Task8 состояния; Task10 E2E |
| Сбой после изменения задачи, без повторения | Task3 атомарный journal; Task9 process crash tests |
| Локальный Docker, non-root, volume, health | Task10 smoke/Compose/README; Task3 SQL health |
| Клавиатура, узкий экран, прокрутка, безопасный Markdown | Task8 browser tests; Task10 E2E |
| Основа для гипервизора без расширения MVP | TodoPort, RunManager и events отделены; tools других агентов отсутствуют |

## Состояние плана

План написан 2026-10-12 после одобрения спецификации. Во время подготовки прочитаны контракты pi и metadata кандидатов зависимостей; dependencies приложения не устанавливались, tests/build не выполнялись. Команды и ожидаемые результаты выше предназначены для этапа реализации и не являются отчётом об уже выполненных проверках.

Самопроверка плана: все разделы спецификации сопоставлены с задачами; public types, repository signatures и dependencies between tasks согласованы. При исполнении ошибки совместимости конкретного lockfile решаются в Task1 в рамках14-дневной политики, без замены pi на свежий API.

Режим исполнения выбирается при передаче плана: subagent-driven с review каждой задачи либо inline executing-plans с checkpoints. Подготовка этого плана не запускает реализацию.
