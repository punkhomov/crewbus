# Контекст Crewbus

Обновлено: 2026-10-16. MVP реализован; проверки и ограничения описаны в документах ниже.

- [Согласованная спецификация MVP](superpowers/specs/2026-10-09-crewbus-mvp-design.md) — цель, выбранный стек, интеграция с pi, API, хранение, тестовые todo-инструменты и защита зависимостей. Одобрена пользователем 2026-10-12; настройки MVP приняты вместе с документом.
- [План реализации](superpowers/plans/2026-10-12-crewbus-mvp.md) — 10 задач с файлами, интерфейсами, тестами и checkpoints; исходные задачи и checkpoints.
- [Исследование интерфейсов harness’ов](research/2026-10-09-harness-ui-comparison.md) — DeepSeek Harness, OpenCode, Goose, Agent Canvas и Lobe UI; источники закреплены по commit SHA. Включает объяснение ограничений DeepSeek на Tailwind и значение этих решений для Crewbus.
- [Встроенный поиск через MCP](research/2026-10-16-web-search-mcp.md) — Exa и Parallel, протокол OpenCode, лимиты и границы живой проверки.
- [Черновик управляемого runtime sbx](superpowers/specs/2026-10-16-sbx-client-design.md) и [план пакета/Windows host service](superpowers/plans/2026-10-16-sbx-client.md) — обязательная оркестрация с ownership, сохранёнными квотами и TTL; local напрямую/через bridge, требования к Cloud file transfer и URL учтены отдельно. Реализация не начата.
- [Запуск и будущая оркестрация sbx](research/2026-10-16-sbx-orchestration.md) — прямой запуск Crewbus, ограничения вложенных sbx, kits агентов и обращение к хостовому сервису.

Выбранная основа: TypeScript, Node.js 24 LTS, pnpm с выдержкой публикаций 14 дней, Fastify, SQLite, React/Vite, Tailwind 4, shadcn/ui и выборочные AI Elements. pi отвечает за провайдеров и агентный цикл; Crewbus задаёт инструменты и серверный протокол.

MVP — чат с одним агентом и todo-инструментами. Будущее направление — управляющий агент для других агентов. Исследованные интерфейсы служат референсами; смена стека или расширение MVP из этого исследования не следуют.

- [Решения и ограничения реализации](superpowers/2026-10-15-implementation-notes.md) — последовательный ledger решений, причины, стоимость пересмотра и границы проверок.
- [Запуск и проверки](../README.md) — development, production, Docker и backup.
