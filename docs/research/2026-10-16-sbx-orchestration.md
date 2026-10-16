# Запуск Crewbus и будущая оркестрация sbx

Решения и проверенные источники на 2026-10-16. Оркестрация пока не реализована.

## Принято

- Основной запуск Crewbus — Node.js напрямую. В разработке внутри sbx дополнительный Docker-контейнер не нужен. Docker-образ остаётся дополнительным способом поставки.
- Хранилище остаётся SQLite; текущего требования переходить на PostgreSQL нет.
- Для будущих рабочих сред нужен kit с pi-agent и необходимыми инструментами. Собственный агент можно упаковать как workload kit; конкретный протокол управления агентом ещё не выбран.

## Что выяснили про sbx

- Каждый локальный sbx — microVM с отдельным ядром и собственным Docker Engine. Docker внутри sbx не даёт доступ к хостовому sbx.
- В текущей среде отсутствуют `/dev/kvm` и CPU-флаги vmx/svm. Вложенный локальный sbx здесь не запускали; необходимая аппаратная виртуализация не предоставлена.
- В issue #497 описан именно запуск sbx внутри sbx: установка CLI проходит, запуск внутреннего sandbox падает. Issue открыт. Комментарий сообщает об экспериментальном `--nested` для macOS Apple Silicon M3+, но не подтверждает успешный sbx-in-sbx.
- Linux-sbx внутри VM требует доступного KVM и поддержки nested virtualization внешней средой.

## Обсуждённая схема, ещё не реализована

Если Crewbus работает внутри sbx, небольшой сервис на хосте может управлять соседними средами через хостовый sbx CLI. Crewbus обращается к ограниченному API этого сервиса с авторизацией. Если Crewbus работает непосредственно на хосте, он может вызывать sbx сам.

Сервис на хосте может слушать `127.0.0.1:<порт>`. На хосте разрешают `sbx policy allow network localhost:<порт>`, из sandbox обращаются к `http://host.docker.internal:<порт>`. Публикация порта sandbox для этого направления не нужна. Реальное соединение и запуск дочерних сред ещё не проверены.

## Источники

- [Архитектура и изоляция Docker Engine](https://docs.docker.com/ai/sandboxes/security/isolation/#docker-engine-isolation).
- [Требования Linux/KVM](https://docs.docker.com/ai/sandboxes/install/#linux).
- [sbx внутри sbx, issue #497](https://github.com/docker/sbx-releases/issues/497).
- [Комментарий об экспериментальном --nested](https://github.com/docker/sbx-releases/issues/497#issuecomment-5697061476).
- [Доступ к хостовым сервисам](https://docs.docker.com/ai/sandboxes/workflows/development/#accessing-host-services-from-a-sandbox).
- [Сборка собственного workload kit](https://docs.docker.com/ai/sandboxes/customize/author/build-an-agent/).
