# Managed Sbx Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel delegation is not required.

**Goal:** Один управляемый runtime sbx с обязательными квотами и ownership для прямого запуска Crewbus на Windows и обращения из sandbox через Windows-хост.

**Architecture:** `@crewbus/sbx` определяет публичный `SandboxRuntime` и внутренний `SbxClient`. Оркестратор на хосте проверяет профили, ownership, durable квоты и lifecycle до вызова CLI. `sbx-host` публикует только управляемый контракт; HTTP не обходит оркестратор. Текущий агент и UI пока не подключаются.

**Tech Stack:** Node 24.21.0, pnpm 12.6.0, strict TypeScript/ESM, TypeBox 1.3.27, Fastify 5.12.5, Node spawn/fetch, Vitest 5.0.2.

**Spec:** [Общий клиент sbx](../specs/2026-10-16-sbx-client-design.md).

**Status:** Черновик плана для обсуждения. Код не реализован. Задача 1 требует реального Windows-хоста и является проверкой предпосылок; все следующие шаги опираются на её результаты. Успех fake-тестов не заменяет эту проверку.

**Cloud scope:** В общей модели учитываются временные Cloud среды, передача файлов и URL pod/service со слов пользователя. Этот план реализует local backend и host bridge, без Cloud adapter. File transfer/service URL требуют отдельного проверенного дополнения к контракту и задачам; не выдавать текущий lifecycle/exec интерфейс за полную совместимость local/Cloud.

## Global Constraints

- Основная хостовая платформа: **Windows**. Linux проверяет контракт/fake CLI, совместимость с настоящим Windows sbx подтверждается отдельно.
- Node **24.21.0**, pnpm **12.6.0**, выдержка зависимостей **14 дней**. Не ослаблять `pnpm-workspace.yaml` и сохранять точные версии.
- Никаких host shell, `.cmd/.bat`, cloud SDK, прямого sandboxd socket API, автоматических повторов мутаций или общей команды raw CLI.
- Данные владельца, текущая SQLite, модельные ключи и работающий Crewbus не используются для тестирования и не меняются.
- Все ограничения, namespace, profiles/aliases, ownership, durable квоты, error/outcome и stream semantics из spec обязательны для обоих клиентов.
- Оркестратор входит в этот срез. Агент не получает raw CLI/SbxClient, bridge token или право задавать свой runId. Runtime работает на хосте и в прямом, и в HTTP-режиме.
- Общий lifecycle — временный lease с конечным deadline. Mount остаётся локальной настройкой профиля; host port mapping и вечная VM не являются обязательными возможностями общего контракта. Bridge — транспорт к local backend, не отдельный backend.
- Предлагаемые defaults до согласования: 2 занятых sandbox-слота, 1 allocation на run, 10 попыток create за скользящий час, TTL 30 минут, exec максимум 5 минут и оставшегося TTL. Настраивает только владелец.
- Исполнение плана проводить на отдельной ветке. Не переключать ветку checkout, из которого работает production Crewbus. Существующий корневой `AGENTS.md` не перезаписывать.

## Карта файлов

```text
packages/sbx/
  package.json, tsconfig.json
  src/contract.ts          SandboxRuntime, TypeBox schemas и лимиты
  src/driver-contract.ts   внутренний SbxClient
  src/errors.ts            SbxError и безопасная сериализация
  src/driver.ts            внутренние методы SbxClient и CLI argv
  src/local.ts             createLocalRuntime, init/close реестра
  src/orchestrator.ts      profiles, ownership, квоты, lifecycle
  src/registry.ts          node:sqlite, атомарные reservations и single-owner lock
  src/process.ts           bounded stdout/stderr/stdin, cleanup
  src/http.ts              fetch, handshake, ответы и NDJSON
  src/supported-cli.ts     точная проверенная версия, зафиксированная после probe
  test/contract.test.ts
  test/local.test.ts
  test/orchestrator.test.ts
  test/registry.test.ts
  test/process.test.ts
  test/http.test.ts
  test/fixtures/fake-sbx.cjs
  test/fixtures/windows-cli.json
apps/sbx-host/
  package.json, tsconfig.json
  src/app.ts               authenticated routes -> SandboxRuntime
  src/config.ts            доверенные host aliases/token/binary/bind
  src/main.ts              запуск и shutdown
  test/app.test.ts
  test/parity.test.ts
scripts/sbx-live-smoke.mjs
  opt-in реальная проверка только собственной среды
```

Также меняются root `package.json`, lockfile, `.github/workflows/check.yml`, README и индекс docs. `pnpm-workspace.yaml` и Vitest glob уже находят новые каталоги. Dockerfile копирует весь репозиторий; runtime deploy по-прежнему включает только зависимости `@crewbus/server`, host service в образ не добавляется.

## Task 1: Зафиксировать Windows CLI и маршрут к хосту

**Files:**
- Create: `docs/research/2026-10-16-sbx-windows-compatibility.md`.
- Create: `packages/sbx/test/fixtures/windows-cli.json` с обезличенными реальными выводами.

**Interfaces:**
- Consumes: установленный и авторизованный sbx.exe на Windows, без новых API-ключей в репозитории.
- Produces: точный release, реальные JSON поля/status, exit/stdin/cancel observations, подтверждённый bind/URL. Эти данные — основание для static parser и `SUPPORTED_SBX_VERSION`.

- [ ] Сначала выполнить только `sbx.exe version`, `sbx.exe ls --json`, `sbx.exe exec --help`, `sbx.exe create --help`, `sbx.exe stop --help`, `sbx.exe rm --help`. Проверить соответствие argv из spec установленной версии. Не придумывать JSON по таблицам документации.
- [ ] В отдельной mountless shell-среде проверить argv с пробелами, кавычками, кириллицей и `&`, stdin, оба потока, ненулевой exit, stop → exec auto-start. Основа ручного smoke в PowerShell:

```powershell
$sbxBinary = (Get-Command sbx.exe -ErrorAction Stop).Source
$probeName = 'crewbus-probe-' + [guid]::NewGuid().ToString('N')
try {
  & $sbxBinary create --name $probeName --no-progress shell
  if ($LASTEXITCODE -ne 0) { throw 'Probe create failed' }
  & $sbxBinary ls --json
  & $sbxBinary exec $probeName -- /bin/sh -c 'printf out; printf err >&2; exit 7'
  Write-Output "Observed exec exit: $LASTEXITCODE"
  & $sbxBinary stop --json $probeName
  & $sbxBinary exec $probeName -- /bin/echo resumed
} finally {
  # Только уникальное имя этого прогона, никогда rm --all/reset/prune.
  & $sbxBinary rm --force --json $probeName
}
```

- [ ] Проверить долгий exec и завершение его CLI-процесса через Node: записать, продолжает ли workload работу внутри VM. После наблюдения остановить/удалить только probe. Не подменять отсутствие exit событием «успешно отменено». Проверить документированную возможность CPU/RAM/disk limits; если её нет, не обещать жёсткий ресурсный бюджет по одной квоте количества VM.
- [ ] С временным Node HTTP-listener на Windows `127.0.0.1:4317` проверить доступ к тестовому `/health` из sandbox через host bridge. Применить только адресное разрешение network policy. Не расширять bind/firewall на основании предположения.
- [ ] В research-файле записать ОС, версию, команды и фактические результаты. Fixtures содержат только probe, пути заменяются валидными тестовыми Windows-путями. Не сохранять bearer tokens, usernames и пользовательские environments.
- [ ] Если argv/JSON/маршрут отличаются, скорректировать spec и этот план до реализации. Если Windows-хост недоступен, явно оставить host compatibility неподтверждённой; fake реализацию можно подготовить, но поддержку реальной версии не объявлять.
- [ ] Commit: `docs: record Windows sbx compatibility probe`.

## Task 2: Контракт, ошибки и упаковка пакета

**Files:** Create `packages/sbx/package.json`, `tsconfig.json`, `src/contract.ts`, `src/driver-contract.ts`, `src/errors.ts`, `test/contract.test.ts`; modify root `package.json`, `pnpm-lock.yaml`.

**Interfaces:**
- Produces: публичные `RuntimeContext`, `SandboxLease`, `SandboxRuntime`, `CallOptions`, `ExecRequest`, `ExecEvent` из spec; внутренние `Sandbox`, `CreateSandbox`, `SbxClient` в driver-contract, без публичного subpath для драйвера. Schemas без Node process imports.
- Produces: `SbxError(code, outcome, leaseId?)`, `encodeSbxError(error)`; неизвестные исключения сериализуются как общий `sbx_failed` с консервативным outcome `unknown`, без исходного message/stack.

- [ ] Добавить пакет с subpath exports contract/local/http; TypeBox — единственная production dependency. Использовать структуру tsconfig существующих shared packages. В `build:packages` добавить build `@crewbus/sbx`; обновить lockfile обычным pnpm без security exceptions.
- [ ] До implementation schemas написать проверки trust boundary:

```ts
import { expect, test } from 'vitest';
import { Value } from 'typebox/value';
import { acquireSchema, execSchema } from '../src/contract.js';
import { createSchema } from '../src/driver-contract.js';

test('accepts aliases, rejects remote host paths and raw CLI flags', () => {
  expect(Value.Check(createSchema, {
    name: 'crewbus-test-123', kitId: 'shell', workspaceId: 'project',
  })).toBe(true);
  expect(Value.Check(createSchema, {
    name: 'crewbus-test-123', kitId: 'shell', workspacePath: 'C:\\private',
  })).toBe(false);
  expect(Value.Check(execSchema, { args: ['echo', 'a&b'] })).toBe(true);
  expect(Value.Check(execSchema, { args: [], privileged: true })).toBe(false);
  expect(Value.Check(acquireSchema, { profileId: 'shell' })).toBe(true);
  expect(Value.Check(acquireSchema, {
    profileId: 'shell', kitId: 'arbitrary', maxSandboxes: 999,
  })).toBe(false);
});
```

- [ ] Run `pnpm exec vitest run packages/sbx/test/contract.test.ts`, подтвердить fail от отсутствующего поведения.
- [ ] Реализовать strict objects, UTF-8 size checks, NUL checks, limits из spec и безопасные ошибки. Для runtime acquire wire принимает только profileId; имя, kitId, workspaceId, principal и TTL в нём запрещены. Пример createSchema выше проверяет только внутренний driver contract. AbortSignal передаётся только в `CallOptions` и не сериализуется. Prefix/alias/host path проверки находятся в драйвере, не в wire данных.
- [ ] Проверить round-trip всех ExecEvent/error wire вариантов; неизвестный error code, лишние поля и неверный protocol version отвергаются.
- [ ] Run contract tests и `pnpm typecheck`. Commit: `feat: define shared sbx client contract`.

## Task 3: CLI-адаптер и ограниченный процесс

**Files:** Create `src/driver.ts`, `src/process.ts`, `src/supported-cli.ts`, `test/local.test.ts`, `test/process.test.ts`, `test/fixtures/fake-sbx.cjs` в `packages/sbx`.

**Interfaces:**
- Consumes: контракт/лимиты/ошибки Task 2 и реальные fixtures Task 1.
- Produces: `createLocalSbx(config: LocalSbxConfig): Promise<SbxClient>` из spec; internal `runProcess(binary, args, options)` и stream cleanup не входят в публичный API.

- [ ] Написать failing tests метода list/get по реальному JSON fixture, alias resolution, create conflict, remove force, namespace отказа до spawn, запрета лишних флагов, неизвестной версии и safe errors. Fake CLI моделирует state в отдельном tempdir, не использует owner sbx.
- [ ] Fake CLI запускать настоящим дочерним Node-процессом. Для полного adapter теста перехват `spawn` в тесте перенаправляет executable на `process.execPath` и `fake-sbx.cjs`, сохраняя созданные production argv. Не добавлять test-only флаги в публичную конфигурацию.
- [ ] Отдельным child fixture проверить настоящий OS argv/stdin/stdout/stderr/close, а не только `mock.calls`:

```js
// fake-sbx.cjs, отдельный режим для проверки process runner
if (process.argv[2] === 'echo-argv') {
  process.stdout.write(JSON.stringify(process.argv.slice(3)));
  process.stderr.write('diagnostic');
  process.exitCode = 7;
}
```

В `process.test.ts` вызвать process runner с `process.execPath`, fixture и аргументами `['C:\\Project With Spaces\\тест', 'a&b', '$(touch impossible)', '"quoted"']`; сравнить JSON stdout с исходным массивом, stderr и close code 7. Никакого host shell или исполнения этих строк.

- [ ] Run `pnpm exec vitest run packages/sbx/test/local.test.ts packages/sbx/test/process.test.ts`, подтвердить fail.
- [ ] Реализовать фиксированные argv из spec, `shell:false`, `windowsHide:true`, executable .exe на Windows, отдельные streams. Версию брать из Task 1 и проверять точно. Не разбирать localized tables/errors; mutations проверять через JSON и postcondition list/get.
- [ ] Покрыть delayed chunks/UTF-8 boundaries, nonzero exit, spawn ENOENT, pre-aborted signal, abort после dispatch, timeout, EPIPE stdin, oversized input/output, consumer `return()`, slow consumer/backpressure и child close до снятия busy lock. Не выдавать `exit:0` при kill/error.
- [ ] Проверить именованные lifecycle locks в обе стороны (exec против stop/remove и наоборот), лимит exec, отказ от массовых операций и отсутствие повторного create после неизвестного исхода. `stop/remove` не прерывают активный exec этого клиента скрытым действием. Общий deadline включает все subprocess/postcondition шаги, stdout и stderr управляющих команд ограничены суммарно.
- [ ] Run package tests и `pnpm typecheck`. Commit: `feat: implement local sbx CLI client`.

## Task 4: Обязательный оркестратор и устойчивый учёт квот

**Files:** Create `packages/sbx/src/local.ts`, `src/orchestrator.ts`, `src/registry.ts`, `test/orchestrator.test.ts`, `test/registry.test.ts`.

**Interfaces:**
- Consumes: внутренний `SbxClient` Task 3 и публичный `SandboxRuntime` Task 2.
- Produces: `createLocalRuntime(config): Promise<SandboxRuntime & { close(): Promise<void> }>`; config включает CLI config из spec, absolute dataDir, доверенный principal и profiles.
- Оркестратор не знает pi/чаты/SQLite Crewbus. Его реестр — отдельный файл в host dataDir, используя встроенный node:sqlite, без новой зависимости.

- [ ] Написать failing tests с подставленным driver, fake clock и отдельной временной БД: профиль выбирает только закреплённые kit/workspace; имя генерируется хостом; чужой run/principal/lease запрещён до CLI.
- [ ] Проверить параллельные acquire: два запроса одного run дают один lease и один create; конкурирующие run не превышают 2 reservations. Provisioning, stopped, releasing, uncertain и cleanup_failed удерживают слот. Закрытый/failed lease не разрешает новую allocation того же run.
- [ ] Проверить последовательный churn: после 10 dispatch-попыток за скользящий час новый run получает quota_exceeded без spawn, даже если прошлые VM удалены. Бюджет и связь run/lease сохраняются после переоткрытия реестра.
- [ ] Run `pnpm exec vitest run packages/sbx/test/orchestrator.test.ts packages/sbx/test/registry.test.ts`, подтвердить fail.
- [ ] Реализовать registry transaction: проверить лимит → вставить lease/reservation и попытку dispatch → commit → вызвать driver. Никаких транзакций, открытых на время CLI. Известный отказ до эффекта отмечается failed; неизвестный — uncertain с занятым слотом. Повторный acquire читает сохранённую запись, не повторяет create.
- [ ] Инициализация берёт эксклюзивный lock-файл через atomic create, второй процесс получает unavailable. После аварии stale lock не захватывается автоматически: оператор сверяет процесс и снимает его. До admission сверить реестр с list/get; неизвестные среды namespace блокируют новые создания, без автоматического усыновления/удаления.
- [ ] Реализовать release/expiry: запретить новые exec, отменить собственные CLI-сессии, затем удалить только точное имя из записи владения, проверить отсутствие. Cleanup failure сохраняется и удерживает слот; prefix сам по себе не разрешает удаление. Timer проверяет expiry раз в минуту, get/exec — сразу, shutdown/restart сохраняют pending cleanup. Mount-директории хоста не удаляются.
- [ ] Проверить TTL и max exec timeout без продления клиентом; потерю ответа после create; restart до/после dispatch; недоступный CLI/повреждение registry; orphan namespace; failed remove; повторный release после подтверждённой очистки. Ни один случай не даёт новый create или преждевременное освобождение слота.
- [ ] Run package tests и `pnpm typecheck`. Commit: `feat: enforce sandbox orchestration policies and durable quotas`.

## Task 5: HTTP-сервис и клиент управляемого runtime

**Files:** Create `packages/sbx/src/http.ts`, `packages/sbx/test/http.test.ts`; create `apps/sbx-host/{package.json,tsconfig.json,src/app.ts,src/config.ts,src/main.ts,test/app.test.ts}`; modify root scripts/lockfile.

**Interfaces:**
- Produces: `createHttpRuntime({baseUrl, token}): SandboxRuntime`.
- Produces: `createSbxHost({runtime: SandboxRuntime, token: string}): FastifyInstance`; тесты внедряют runtime, production main получает его из `createLocalRuntime` с principal, привязанным к credential.
- Consumes: contract schemas/errors, обязательный оркестратор Task 4. Production dependencies host — `@crewbus/sbx`, Fastify **5.12.5**.

- [ ] Написать failing tests auth до dispatch, всех managed routes из spec, 204 release, get null, unknown routes, oversized body, method restrictions, error sanitization, protocol mismatch, запрета redirects и credential leakage. Raw `/v1/sandboxes` routes отсутствуют. Principal не берётся из body; runId приходит только от доверенного backend, не от модели.
- [ ] Run `pnpm exec vitest run apps/sbx-host/test/app.test.ts packages/sbx/test/http.test.ts`, подтвердить fail.
- [ ] Реализовать endpoint table из spec. unary errors — `{error:{code,outcome,leaseId?}}`. HTTP statuses: validation 400, auth 401, profile/ownership 403, busy/conflict/lease_expired 409, quota_exceeded 429, CLI unavailable/version 503, timeout 504, другие CLI/protocol/cleanup ошибки 502. Неизвестные внутренние ошибки 500 без диагностики. Ошибка квоты не запускает автоматический retry.
- [ ] До первой remote операции проверить authenticated `/v1/health` и protocolVersion=1, затем кэшировать успешный handshake. Проверка входит в deadline и AbortSignal исходной операции; провал не кэшируется. Во всех fetch `redirect:'error'`; запросы идут только на сконфигурированный origin и фиксированные routes.
- [ ] Exec передаётся NDJSON и читается инкрементально. Frame parser ограничивает line/body/payload, корректно обрабатывает split UTF-8/newline, требует ровно terminal exit/error, EOF без terminal — connection_lost. Wire error становится `SbxError`, а не workload stdout.
- [ ] Host учитывает `write(false)`/drain, закрытие response отменяет iterator/CLI. Fastify request `close` после прочитанного body не считается отменой долгого exec. При медленном клиенте память не растёт без границ.
- [ ] Config: порт 4317 по умолчанию, bind 127.0.0.1, token и путь к JSON с binary/prefix/kits/workspaces/profiles/policy/dataDir из environment владельца. Секрет не находится в CLI argv/config responses и не передаётся workload. Запуск — Node напрямую, без установки Windows Service и Docker.
- [ ] Shutdown вызывает close локального runtime: прекращает admission, отменяет активные calls, ожидает cleanup до 5 s, сохраняет pending lifecycle и освобождает lock при штатном завершении. Отмена transport сама по себе не удаляет sandboxes. Root `pnpm build` включает сборку host, текущий `pnpm start` продолжает запускать только Crewbus. Добавить отдельный `start:sbx-host`.
- [ ] Run host/package tests, `pnpm typecheck`, `pnpm build`. Commit: `feat: proxy sbx client over authenticated HTTP`.

## Task 6: Доказать одинаковую оркестрацию и Windows process semantics

**Files:** Create `apps/sbx-host/test/parity.test.ts`; modify `.github/workflows/check.yml`; refine fixture tests from Tasks 3–5.

**Interfaces:**
- Consumes: обе фабрики и реальный Fastify TCP listener на port 0.
- Produces: один contract/policy suite для direct local runtime и HTTP client -> host -> того же оркестратора/драйвера. В каждом случае только один owner реестра.

- [ ] Сделать один parameterized suite для `mode: 'local' | 'http'`. Каждый тест получает отдельный tempdir/fake state; HTTP-тест использует `app.listen({host:'127.0.0.1',port:0})`, а не только Fastify inject/mock fetch.
- [ ] В обоих modes проверить acquire → get → exec с конечным stdin → release. Сравнить lease states, payload событий и exit code, включая ненулевой. Auto-start остановленного sandbox отдельно проверяется драйвером Task 3.
- [ ] Проверить validation/auth/ownership failures не вызывают fake CLI; один run не получает второй lease; чужая среда не переиспользуется. Одновременные acquire и последовательный churn не обходят квоты. После restart бюджет сохраняется. Попытки вызвать raw create endpoint не работают.
- [ ] Имитировать потерю ответа после успешного acquire: эффект есть, remote получает unknown outcome, счётчик create равен одному. Повторный acquire того же run возвращает ту же запись; get сверяет состояние. Exec автоматически не повторяется.
- [ ] Проверить TCP disconnect, abort, deadline, oversized output, malformed NDJSON, EOF без terminal и остановку host: CLI fixture закрывается, busy slot освобождается после close, данные/токен не появляются в host logs/errors. Не утверждать, что guest process остановился.
- [ ] Run `pnpm exec vitest run packages/sbx/test apps/sbx-host/test`.
- [ ] Добавить Windows unit job, используя существующие pinned checkout/setup-node actions и bootstrap:

```yaml
runs-on: windows-latest
# После checkout и setup-node 24.21.0:
steps:
  - shell: pwsh
    run: |
      node scripts/bootstrap-pnpm.mjs "$env:RUNNER_TEMP/crewbus-pnpm"
      "$env:RUNNER_TEMP/crewbus-pnpm/bin" | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
  - run: pnpm install --frozen-lockfile
  - run: pnpm typecheck
  - run: pnpm exec vitest run packages/sbx/test apps/sbx-host/test
```

Это фрагмент нового job: скопировать закреплённые action SHAs из существующего job перед показанными steps. VM/live sbx здесь не требуется. Не объявлять Windows live support по успеху Windows fake tests.
- [ ] Run full `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm verify:ui`; подтвердить текущие проверки Crewbus. Commit: `test: verify local and HTTP sbx contract parity`.

## Task 7: Opt-in smoke на Windows и инструкции

**Files:** Create `scripts/sbx-live-smoke.mjs`; modify root scripts, README, `docs/README.md`, research evidence Task 1.

**Interfaces:**
- Consumes: production factories, доверенный config/token и установленный sbx release Task 1.
- Produces: воспроизводимая живая проверка каждого режима, без обращений к LLM.

- [ ] Написать opt-in script: `--mode local|http`, config path/baseUrl из environment, token только из environment, отдельный уникальный runId и разрешённый mountless shell profile. Print только стадии и безопасный PASS/FAIL; никаких secrets/argv/env dumps. Smoke потребляет обычный budget, без обхода host policy.
- [ ] Script вызывает acquire/get, `/bin/echo` с кириллицей/пробелами/метасимволами, конечный stdin через `/bin/cat`, stdout/stderr/nonzero exit через явный shell внутри VM. Повторный acquire не создаёт VM; в finally release **только своего** lease и подтверждение released. Не используется owner project mount.
- [ ] Сначала выполнить script на Windows напрямую, затем через запущенный на Windows host из Crewbus-sandbox. Проверить host route отдельно от API/CLI ошибок. Записать Windows version, sbx release, Node version, bind/address и итог в evidence.
- [ ] README: конфигурация profiles/aliases с валидным Windows-путём, установка/авторизация CLI как prerequisite, запуск host, отдельный token, адресное network policy разрешение, два managed клиентских примера, квоты/TTL/ownership, восстановление registry/stale lock и unknown outcome/cancel semantics. Прямой runtime и host service одновременно на одном namespace не запускаются.

```ts
import { createLocalRuntime } from '@crewbus/sbx/local';
import { createHttpRuntime } from '@crewbus/sbx/http';
import type { SandboxRuntime } from '@crewbus/sbx/contract';

// localConfig читается из доверенной host config; baseUrl/token — из backend config.
async function acquireForRun(runtime: SandboxRuntime, runId: string) {
  return runtime.acquire({ runId }, { profileId: 'shell' });
}
// runId подставляет backend, не модель. acquireForRun принимает либо
// await createLocalRuntime(localConfig), либо createHttpRuntime({baseUrl, token}).
```

- [ ] Проверить `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm verify:ui`, существующий Linux/browser CI и Windows unit job. Docker smoke остаётся проверкой текущей поставки Crewbus, без установки sbx внутри контейнера.
- [ ] Если Windows live run недоступен, честно зафиксировать непроверенные пункты и не обозначать этот этап завершённым. Подготовить PR с разделением fake parity, Windows unit и Windows live результатов.
- [ ] Commit: `docs: document and verify Windows sbx host setup`.

## Self-review и следующий этап

Проверить соответствие spec по managed/internal контрактам, profiles/ownership, durable квотам и восстановлению, CLI argv, input/output limits, auth, Windows paths, stream terminal, timeout/cleanup, unknown outcome, parity и границам smoke. Нельзя подменять измеренную совместимость статической ссылкой на docs. Raw SbxClient не публикуется по HTTP и не передаётся инструментам.

Следующий отдельный план — pi-agent workload kit, протокол задач/событий и узкий порт инструментов доверенного backend. Он будет потребителем управляемого `SandboxRuntime`; лимиты и lifecycle уже обязательны в этом плане. Подключение tools к Crewbus и UI пока не входит в срез.

Для расширения на Cloud сначала проверить официальные SDK/API для file upload/download, URL pod/service и максимального lifetime. Затем описать capabilities, bounded transfer, безопасные пути внутри среды, ownership, сроки ссылок и выгрузку результатов до cleanup. Только после этого добавить соответствующие методы/тесты и Cloud adapter; не подменять проверку гипотетическими endpoint/CLI-командами. Квоты должны применяться ко всем backend под управлением одного оркестратора, а срок Cloud lease не может превышать срок, выданный провайдером.
