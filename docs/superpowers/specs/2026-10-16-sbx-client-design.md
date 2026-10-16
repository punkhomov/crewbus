# Управляемый runtime sbx для Crewbus

Дата: 2026-10-16. Статус: **черновик для обсуждения**, реализация не начата.
Основная хостовая платформа: **Windows**, подтверждено пользователем.

## Цель и границы

Один контракт для управления локальным sbx в двух размещениях Crewbus:

1. На Windows-хосте: Node-процесс вызывает `sbx.exe` напрямую.
2. Внутри sandbox: Node-процесс обращается к нашему сервису на Windows-хосте; сервис использует тот же локальный адаптер.

Будущие агентные инструменты получают узкий порт задач. Доверенный backend обращается к `SandboxRuntime`, а внутренний `SbxClient` доступен только оркестратору. Вызовы асинхронные в обоих режимах. Общую модель проектируем с учётом локального sbx и Cloud; первый реализуемый backend — локальный sbx. Cloud SDK `@docker/sandboxes` в этот срез не устанавливается, недокументированный протокол sandboxd не используется.

Рассмотренные варианты: общий управляемый runtime локально и через HTTP (выбран); проверки только в инструментах агента (обходятся через HTTP и не защищают общий хост); обязательный отдельный HTTP-процесс даже на хосте (лишний процесс для локального случая). Публичной спецификации управления sandboxd не найдено.

## Состав

- `packages/sbx`, пакет `@crewbus/sbx`: контракт runtime/TypeBox-схемы, оркестратор с реестром, внутренний CLI-драйвер и HTTP-клиент. Subpath exports `./contract`, `./local`, `./http`; импорт контракта не загружает `child_process` или SQLite. Отдельного workspace-пакета для оркестратора пока не нужно.
- `apps/sbx-host`: маленький Fastify-сервис, конфигурация, авторизация и вызовы **оркестратора**, без публичных raw CLI endpoints. Прямой запуск Node 24 на Windows под учётной записью владельца sbx.
- Текущие `packages/contracts`, `packages/agent`, `apps/server` и web UI в первом срезе не меняют поведения. Пакет не зависит от pi, React или Crewbus RunManager; реестр использует встроенный `node:sqlite` в отдельном host data directory, не текущую БД Crewbus.

Используются Node **24.21.0**, pnpm **12.6.0**, strict TypeScript, существующие точные версии TypeBox/Fastify. Политики pnpm, включая выдержку **14 дней**, сохраняются. Новых сторонних библиотек не требуется.

## Общая модель local/Cloud и граница транспорта

Уточнения пользователя от 2026-10-16: Cloud поддерживает передачу файлов в обе стороны, не имеет host mounts и проброса портов, предоставляет прямую ссылку на pod; среды всегда временные. Это требования к общей модели со слов пользователя, а не результат проверки Cloud API в этой сессии.

- **Backend** определяет, где создаётся среда: локальный sbx либо Cloud. **HTTP bridge** определяет, как доверенный Crewbus достигает локального оркестратора на настоящем хосте. Bridge не является третьим видом sandbox и не требует вложенной виртуализации.
- Базовая единица — временный lease с конечным `expiresAt`, а не постоянно работающая VM. В Cloud эффективный deadline — наиболее ранний из нашего TTL и срока провайдера. Продление, вечная сессия, pause/resume не входят в общий обязательный контракт.
- Переносимый поток работы: выделить среду → загрузить входные файлы → выполнить задачу → скачать нужные результаты → освободить среду. Загрузка и скачивание — отдельные операции, без обещания общего каталога или постоянной синхронизации. Результаты нужно забрать до release/expiry; после удаления среды восстановление файлов не обещается.
- `workspaceId`/mount — локальная настройка профиля. В Cloud профиль использует передачу файлов; нельзя трактовать host path как удалённый mount или незаметно копировать весь workspace.
- Сетевой контракт — получить URL сервиса/pod при поддержке backend, без требования host port mapping. URL возвращает backend; он не собирается из sandbox ID и выдуманного hostname. Формат, авторизация, срок действия ссылки и адресация сервисов требуют проверки API. Ссылка не делает среду постоянной.
- File transfer и service URL — возможности backend, которые нужно явно объявлять. Отсутствующая возможность даёт явный отказ, а не фиктивный URL или скрытый host shell/proxy. Количество/объём файлов и доступ к URL также проходят через оркестратор с ownership и лимитами.

Точный wire/API для file transfer и service URL фиксируется отдельным дополнением после проверки обеих сторон: нельзя придумать локальные CLI-команды на основании возможностей Cloud. Текущие интерфейсы ниже реализуют общее ядро lifecycle/exec; не заявляют уже готовую совместимость file/network API. Cloud adapter и эти операции пока не являются выполненной или полностью распланированной частью первого среза.

## Обязательный слой оркестрации

Цепочка вызова: агент → порт задач доверенного backend → `SandboxRuntime` → внутренний `SbxClient` → `sbx.exe`. В удалённом режиме HTTP находится **перед runtime на хосте**, поэтому его нельзя использовать в обход квот. Модель и рабочие агенты не получают bridge token, host config, CLI или управление сетью хоста. Если агенту дадут shell, его среда не должна содержать эти полномочия.

Первый срез — временная эксклюзивная среда на run. Backend подставляет существующий `runId` из серверного контекста, как сейчас `ToolContext` для todo; модель его не выбирает. Principal определяется хостом из настроенного credential, а не JSON body. Агент позже сможет запросить задачу и разрешённый профиль, но не sandbox name, host path, произвольный kit или повышение лимитов. Raw `exec` не становится инструментом агента автоматически.

```ts
export interface RuntimeContext { runId: string; } // задаёт доверенный backend
export interface SandboxLease {
  id: string;
  profileId: string;
  state: 'provisioning' | 'ready' | 'releasing' | 'released' | 'failed' | 'uncertain' | 'cleanup_failed';
  expiresAt: number; // Unix milliseconds, задаёт хост
}
export interface SandboxRuntime {
  acquire(context: RuntimeContext, input: { profileId: string }, options?: CallOptions): Promise<SandboxLease>;
  get(context: RuntimeContext, leaseId: string, options?: CallOptions): Promise<SandboxLease | null>;
  exec(context: RuntimeContext, leaseId: string, input: ExecRequest, options?: CallOptions): AsyncIterable<ExecEvent>;
  release(context: RuntimeContext, leaseId: string, options?: CallOptions): Promise<void>;
}
```

`createLocalRuntime(config): Promise<SandboxRuntime & { close(): Promise<void> }>` встраивает оркестратор в доверенный процесс на Windows; close нужен владельцу процесса для shutdown, не агенту. `createHttpRuntime({baseUrl, token}): SandboxRuntime` обращается к такому же оркестратору внутри sbx-host. Локальная конфигурация содержит CLI config, защищённый `dataDir`, principal и разрешённые профили `{kitId, workspaceId?}`. Профили — конфигурация владельца, не материал для свободной генерации моделью.

Начальные значения ниже — **предлагаемые defaults**, численные значения ещё не согласованы:

- Не более **2 занятых sandbox-слотов** на установку, включая остановленные среды, создание, очистку и неизвестный исход; не только работающие exec.
- Одна выдача среды на `(principal, runId)`. Повторный acquire возвращает ту же запись, включая её ошибочное/закрытое состояние; другой профиль даёт `conflict`. Освобождение среды не разрешает заново создать её в том же run.
- Не более **10 попыток создания за скользящий час** на установку. Считаются попытки dispatch, даже если CLI завершился ошибкой; освобождение sandbox не возвращает бюджет. Так новые runId не обходят ограничение последовательного создания.
- Максимальный срок среды **30 минут**, exec не более **5 минут** и оставшегося срока среды. Пользовательский timeout может только сократить этот срок. Политика не продлевается вызовами агента.

Проверка квот, reservation и запись намерения create проходят атомарно **до spawn**. Реестр хранит principal/run/lease/name/profile, deadline, попытку dispatch и исход; имени с prefix недостаточно для доказательства владения. Только backend может работать со своими lease; чужой lease отвергается до CLI. На один namespace/dataDir допускается один управляющий процесс; второй запуск отклоняется эксклюзивным lock-файлом. После аварии stale lock снимает оператор, автоматического захвата нет.

После потери ответа/перезапуска runtime сверяет реестр с `sbx ls --json` до admission. Неизвестный исход удерживает слот, пока наличие или отсутствие среды не подтверждено. Найденные в namespace среды без записи считаются препятствием для нового admission; автоматически присваивать или удалять их нельзя. Недоступный CLI/повреждённый реестр запрещает новые создания.

`release` и истечение срока — явная политика остановки/удаления **только принадлежащей runtime временной среды**. Сначала запрещаются новые exec и завершаются собственные CLI-сессии, затем выполняется cleanup; успех фиксируется после проверки отсутствия sandbox. Сбой означает `cleanup_failed`, слот остаётся занят и ошибка видна оператору. Timer проверяет просроченные записи минимум раз в минуту; get/exec проверяют expiry сразу. Выключенный хост не может гарантировать точную остановку по TTL; просроченные записи обрабатываются при восстановлении. Host workspace директории cleanup не удаляет.

Это минимальная оркестрация жизненного цикла и доступа. Планировщик задач, граф делегирования и протокол pi-workload остаются следующим этапом. CPU/RAM/disk-квоты нельзя обещать по одному числу sandbox: возможность жёстких лимитов нужно отдельно проверить в Windows CLI/kit.

## Внутренний контракт CLI-драйвера

Следующий `SbxClient` нужен оркестратору и низкоуровневым тестам. Он не публикуется по HTTP и не передаётся агентным инструментам.

```ts
export interface CallOptions { signal?: AbortSignal; }
export interface Sandbox {
  name: string;
  status: string; // исходный status из проверенной версии CLI, без догадок о состояниях
}
export interface CreateSandbox {
  name: string;
  kitId: string;
  workspaceId?: string;
}
export interface ExecRequest {
  args: string[];
  cwd?: string; // абсолютный POSIX-путь ВНУТРИ Linux sandbox
  stdin?: string; // один конечный UTF-8 ввод, не интерактивная сессия
  timeoutMs?: number;
}
export type ExecEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number };
export interface SbxClient {
  list(options?: CallOptions): Promise<Sandbox[]>;
  get(name: string, options?: CallOptions): Promise<Sandbox | null>;
  create(input: CreateSandbox, options?: CallOptions): Promise<Sandbox>;
  stop(name: string, options?: CallOptions): Promise<Sandbox>;
  remove(name: string, input: { force: true }, options?: CallOptions): Promise<void>;
  exec(name: string, input: ExecRequest, options?: CallOptions): AsyncIterable<ExecEvent>;
}
```

`create` создаёт конфигурацию/среду, но **не обещает постоянно работающую VM**: после `sbx create` среда может остановиться без активных сессий. `exec` автоматически запускает остановленную среду — это документированное поведение CLI. Отдельного `start` пока нет: `sbx run --detach` меняет режим жизненного цикла, поэтому его нельзя незаметно подставить вместо обычного старта.

`get` строится из `list`, без выдуманного `sbx inspect`. `status` остаётся исходной строкой; enum для UI можно добавить после фиксации реальных состояний. Ненулевой штатный код `exec` передаётся событием `exit`, а не считается сетевой ошибкой. Это код завершения CLI: при обычном выполнении он соответствует коду команды, но сам по себе не отличает отказ запуска sbx от ошибки workload. Нормальный поток имеет ровно одно последнее событие `exit`; обрыв/отмена завершают iterator ошибкой, без искусственного успешного `exit`.

## Локальный адаптер

Внутренняя фабрика `createLocalSbx(config): Promise<SbxClient>` проверяет CLI и создаёт драйвер. Конфигурация доверенная, задаётся владельцем:

```ts
interface LocalSbxConfig {
  binary: string;                 // путь к sbx.exe на Windows, не .cmd/.bat
  namePrefix?: string;            // по умолчанию crewbus-
  kits: Record<string, string>;   // alias -> установленный built-in / закреплённый kit
  workspaces: Record<string, string>; // alias -> абсолютный существующий путь хоста
}
```

Клиент запрашивает `kitId: 'pi'`, `workspaceId: 'crewbus'`; только Windows-хост знает, что это `C:\Users\...\crewbus` и конкретная ссылка на kit. Отсутствующий workspace означает mountless sandbox. Raw-пути хоста, произвольные kit URL, CLI-флаги и пути к исполняемому файлу в запросах не принимаются. При прямом запуске на хосте действуют те же правила.

Имена ограничены настроенным prefix, полная длина 2–100, допустимы ASCII буквы/цифры/дефисы, начало — буква/цифра. Клиент создаёт уникальное имя с UUID до запроса и сохраняет его для сверки результата. `list/get/stop/remove/exec` видят только этот namespace. Это разграничение нашего клиента, не отдельная гарантия изоляции со стороны sbx.

Команды строятся из фиксированных аргументов через `spawn(binary, argv, { shell: false, windowsHide: true })`. Никаких `cmd /c`, PowerShell, строковой склейки, `windowsVerbatimArguments: true` или host shell. `args` у `exec` — команда **внутри** sandbox; намеренный `/bin/sh -c ...` внутри него остаётся возможностью доверенного вызывающего кода.

| Метод | Документированная команда |
| --- | --- |
| list/get | `sbx ls --json`, проверка JSON и фильтр namespace |
| create | `sbx create --name NAME --no-progress KIT [WORKSPACE]`, затем list/get |
| stop | `sbx stop --json NAME`, затем list/get |
| remove | `sbx rm --force --json NAME`, затем проверка отсутствия |
| exec | `sbx exec [-i] [--workdir CWD] NAME -- PROGRAM ARG...` |

`-i` добавляется только для переданного конечного stdin; TTY не используется. Код и output `exec` проверяются на реальном Windows-хосте до объявления совместимости. При одновременно пришедших lifecycle-операциях на одно имя второй вызов получает `busy`; remove/stop также не выполняются при активном exec, созданном этим экземпляром адаптера. Начало exec при lifecycle-операции на то же имя также возвращает `busy`. Создание уже существующего имени возвращает `conflict` и не переиспользует среду. Межпроцессной блокировки внешнего sbx CLI этот механизм не обещает.

## HTTP-клиент и хостовый сервис

`createHttpRuntime({ baseUrl, token }): SandboxRuntime` реализует управляемый контракт через `fetch`. Нет автоматического обнаружения режима и fallback на локальный CLI. Сервер создаёт `createLocalRuntime`; алгоритм политик и работы с sbx существует в одном месте.

| HTTP | Метод |
| --- | --- |
| GET `/v1/health` | protocolVersion=1, готовность и проверенная версия sbx; требует token |
| POST `/v1/runs/:runId/leases` | acquire, body `{profileId}` |
| GET `/v1/runs/:runId/leases/:leaseId` | get, JSON null для отсутствующей записи |
| DELETE `/v1/runs/:runId/leases/:leaseId` | release, 204 после подтверждённой очистки |
| POST `/v1/runs/:runId/leases/:leaseId/exec` | exec, `application/x-ndjson` |

Управляющие ответы JSON. NDJSON использует те же stdout/stderr/exit события; terminal wire-событие `error` содержит только код/исход ошибки и превращается в исключение HTTP-клиента. EOF без exit/error считается `connection_lost`. Порядок байтов сохраняется внутри stdout и stderr; общего временного порядка между двумя OS pipes не обещаем.

Хостовый сервис слушает `127.0.0.1` по умолчанию, отдельный порт (предлагается 4317), Bearer token из защищённой конфигурации; не использует OpenRouter-ключ. Запрос проходит авторизацию до запуска CLI. Нет cookie-auth, открытого CORS, debug endpoints и endpoint для чтения секрета. В логах только method, код и operation ID; без request bodies, argv, stdout/stderr или токена. При запуске вне доверенного loopback/host bridge требуется TLS. HTTP-клиент запрещает redirects и не отправляет token по произвольным адресам из ответа.

Из Crewbus-sandbox предполагается доступ через `host.docker.internal:4317` и host network policy sbx. Этот адрес и привязку loopback необходимо проверить на Windows, а не считать доказанными для этой установки. В первой проверке не открывать сервис на 0.0.0.0 и не ослаблять firewall без отдельной необходимости.

## Ошибки, отмена, ограничения

`SbxError` содержит стабильный `code`, `outcome: 'not_started' | 'unknown'` и необязательный `leaseId`. Коды: `invalid_input`, `unauthorized`, `forbidden`, `busy`, `conflict`, `quota_exceeded`, `lease_expired`, `cleanup_failed`, `unavailable`, `unsupported_version`, `sbx_failed`, `protocol_error`, `timeout`, `aborted`, `connection_lost`, `output_limit`. Имя среды остаётся во внутреннем реестре.

- Validation/auth/namespace-отказ до dispatch: `not_started`. После dispatch мутации или exec при недостоверном завершении: `unknown`. Не классифицировать ошибки парсингом локализованного stderr.
- HTTP/CLI timeout и AbortSignal останавливают ожидание и завершают принадлежащий нам CLI-процесс. **На Windows это не доказательство остановки команды внутри VM.** Никаких `taskkill /IM`, убийства sandboxd, остановки всей VM или удаления среды как скрытого способа отмены.
- Разрыв HTTP-соединения и досрочное закрытие iterator требуют cleanup и best-effort отмены CLI. Для HTTP использовать реальное закрытие response/aborted request, а не обычный request `close`, который может означать полностью прочитанное тело.
- Автоматических повторов create/exec/remove/stop на уровне драйвера нет. После неизвестного исхода create/remove оркестратор сначала сверяет list/get; результат exec без протокола самого workload восстановить нельзя. Повторный acquire не вызывает новый create. Exactly-once и rollback не обещаем.
- Default управляющий deadline 120 s на всю операцию, включая handshake и проверку postcondition, exec 5 min; runtime дополнительно ограничивает его политикой lease. Graceful shutdown прекращает admission, закрывает принадлежащие сервису CLI-процессы, ждёт до 5 s, сохраняет незавершённую очистку для восстановления. Низкоуровневый abort сам по себе не удаляет среды.
- JSON response — до 1 MiB; stdout/stderr управляющего CLI — до 1 MiB суммарно; request — до 256 KiB; stdin — до 64 KiB; args — 1–128 элементов, суммарно до 32 KiB UTF-8; запрет NUL. Вывод exec — до 8 MiB суммарно, chunk до 8 KiB, wire line до 64 KiB, wire body до 64 MiB. Лимиты одинаковы для обоих клиентов.
- Максимум 4 активных exec и 1 lifecycle-операция на имя; глобально до 32 управляющих запросов. Очередь не накапливается: `busy`. Поток учитывает backpressure, промежуточная очередь не более 256 KiB; прекращение чтения не приводит к неограниченному буферу.

Точный sbx release и JSON fixture из него фиксируются после host probe. Поддерживаем только проверенный release; другая версия явно отклоняется до мутации. Изменение JSON в v0.48.0 подтверждает, что диапазон версий нельзя объявить по предположению.

## Последовательность и критерий готовности

1. Windows probe: версия/help, JSON, exec pipes/exit/stdin, отмена, доступ из sandbox. Только отдельная mountless shell-среда с уникальным именем.
2. Контракт и CLI-адаптер с тестами на реальном дочернем Node fixture, без VM/ключей.
3. Обязательный оркестратор: профили, ownership, durable reservation/бюджет, acquire/release, expiry и восстановление после неизвестного исхода.
4. Хостовый HTTP-сервис и клиент **управляемого runtime**; один набор contract/policy-тестов напрямую и через настоящий loopback HTTP.
5. Windows live smoke: acquire → get → exec → release в обоих режимах; stop → exec auto-start отдельно проверяется на уровне драйвера. Удаляется только явно созданная тестовая среда.
6. Отдельная следующая задача: pi-agent kit, протокол заданий/событий и порт инструментов в Crewbus. Даже после подключения агент работает только через оркестратор, без raw SbxClient.

В первом срезе нет UI, реализации Cloud adapter, PostgreSQL/Docker-обёртки сервиса, daemon reverse engineering, PTY, двустороннего интерактивного stdin, долговременных workload jobs, reconnect/replay exec, bulk cleanup, network-policy API и управления секретами sbx. Модель Cloud учитывается в дизайне; file transfer/service URL требуют отдельного дополнения, реестр lease/квот обязателен уже сейчас. Глобальный sbx event stream также не нужен, пока нет потребителя: состояние сверяем через драйвер list/get.

## Источники и пределы проверки

Docker docs закреплены на [`31d174d090fd7111ca2199ed54a3978e0d4ac74d`](https://github.com/docker/docs/tree/31d174d090fd7111ca2199ed54a3978e0d4ac74d):

- [Automation](https://github.com/docker/docs/blob/31d174d090fd7111ca2199ed54a3978e0d4ac74d/content/manuals/ai/sandboxes/workflows/automation.md), [usage](https://github.com/docker/docs/blob/31d174d090fd7111ca2199ed54a3978e0d4ac74d/content/manuals/ai/sandboxes/usage.md).
- [CLI YAML: exec](https://github.com/docker/docs/blob/31d174d090fd7111ca2199ed54a3978e0d4ac74d/data/sbx_cli/sbx_exec.yaml), [create](https://github.com/docker/docs/blob/31d174d090fd7111ca2199ed54a3978e0d4ac74d/data/sbx_cli/sbx_create.yaml), [ls](https://github.com/docker/docs/blob/31d174d090fd7111ca2199ed54a3978e0d4ac74d/data/sbx_cli/sbx_ls.yaml), [stop](https://github.com/docker/docs/blob/31d174d090fd7111ca2199ed54a3978e0d4ac74d/data/sbx_cli/sbx_stop.yaml), [rm](https://github.com/docker/docs/blob/31d174d090fd7111ca2199ed54a3978e0d4ac74d/data/sbx_cli/sbx_rm.yaml).
- [Local SSH/socket transport](https://github.com/docker/docs/blob/31d174d090fd7111ca2199ed54a3978e0d4ac74d/content/manuals/ai/sandboxes/integrations/_index.md), [Cloud SDK scope](https://github.com/docker/docs/blob/31d174d090fd7111ca2199ed54a3978e0d4ac74d/content/manuals/ai/sandboxes-api/_index.md).

В текущей Linux-sbx нет sbx CLI/Windows-хоста/KVM. Источники прочитаны; создание VM, cancel semantics и сетевой маршрут к Windows пока не проверены. Plan допускает fake-contract проверки здесь и требует host smoke перед заявлением о поддержке Windows.
