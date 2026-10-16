# Встроенный поиск Exa и Parallel

Дата: 2026-10-16. Цель — поиск в интернете для одного агента Crewbus по примеру OpenCode.

## Решение

Один инструмент `web_search`: `query` (1–4000 символов, не пустой после trim), `provider` (`exa` по умолчанию либо `parallel`). Агент выбирает провайдера; пользователь может назвать его в сообщении. Инструмент добавлен рядом с четырьмя todo-инструментами, включая восстановленные диалоги: pi сам объявляет изменение набора tools. Результат содержит `provider`, `query`, `text` и сохраняется в обычной истории вызовов. TodoPort и журнал изменений задач для поиска не используются.

Используем `fetch` Node 24 и фиксированные HTTPS endpoints, без новых зависимостей, stdio-процессов, произвольных URL или универсального MCP registry. Это stateless HTTP JSON-RPC `tools/call` по образцу OpenCode, а не полная реализация MCP lifecycle/discovery.

| Провайдер | Endpoint | MCP tool | Аргументы |
| --- | --- | --- | --- |
| Exa | `https://mcp.exa.ai/mcp` | `web_search_exa` | `{query, numResults: 8}` |
| Parallel | `https://search.parallel.ai/mcp` | `web_search` | `{objective: query, search_queries: [query]}` |

`Accept: application/json, text/event-stream`; поддерживаются JSON и SSE, включая уведомления перед ответом. Чтение прекращается сразу после SSE-ответа. Текст MCP возвращается с исходными URL; Parallel structured results поддерживаются, если текст отсутствует. Изображения не загружаются.

## Ограничения и безопасность

Анонимный доступ поддерживают оба сервиса, но его квоты и доступность определяют их владельцы. Поисковые ключи/OAuth, платные режимы, `web_fetch`, автоматические повторы и provider cooldown не добавлены. OpenRouter/API-ключ модели остаётся у модельного провайдера: поисковикам передаётся только поисковый запрос. Запрос не должен содержать секретов.

Таймаут 25 секунд охватывает HTTP и чтение тела; остановка запуска отменяет запрос. Лимит 256 KiB применяется при чтении потока, redirects запрещены. Вход и MCP envelope проверяются. В ошибках не сохраняются тела HTTP/диагностика транспорта. Инструкция агента требует ссылаться на источники, считать найденный текст недоверенными данными и сообщать о сбое вместо выдуманных результатов. Это инструкция модели, а не гарантия защиты от prompt injection.

Проверка из этой sbx: по одному запросу к каждому hosted endpoint; оба вернули HTTP 403, Cloudflare error 1010 (`browser_signature_banned`). Успешный живой поиск **не подтверждён**; повторов с подменой клиента не выполнялось. Автоматические проверки используют локальные MCP-ответы и faux model, проверяют протокол, ошибки, отмену, сохранение и браузерное отображение.

## Источники

OpenCode закреплён на commit [`180fd9d622c6855ef6ea36fd81314de6406af054`](https://github.com/anomalyco/opencode/tree/180fd9d622c6855ef6ea36fd81314de6406af054):

- [Exa provider](https://github.com/anomalyco/opencode/blob/180fd9d622c6855ef6ea36fd81314de6406af054/packages/core/src/plugin/websearch/exa.ts), [Parallel provider](https://github.com/anomalyco/opencode/blob/180fd9d622c6855ef6ea36fd81314de6406af054/packages/core/src/plugin/websearch/parallel.ts).
- [MCP transport](https://github.com/anomalyco/opencode/blob/180fd9d622c6855ef6ea36fd81314de6406af054/packages/core/src/plugin/websearch/mcp.ts), [tool](https://github.com/anomalyco/opencode/blob/180fd9d622c6855ef6ea36fd81314de6406af054/packages/core/src/tool/plugin/websearch.ts).
- [Exa MCP README](https://github.com/exa-labs/exa-mcp-server#readme).
- [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp).

OpenCode также поддерживает другие поисковики, fallback и cooldown. Эти возможности не нужны для текущего минимального расширения Crewbus.
