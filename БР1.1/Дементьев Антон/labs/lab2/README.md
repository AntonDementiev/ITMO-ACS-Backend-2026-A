# ЛР 2. Микросервисы сайта поиска работы

Монолит из ЛР 1 разделён на 7 микросервисов и API Gateway по документу ДЗ 4 (database-per-service).
Публичное API не изменилось: те же 50 операций, что в ДЗ 2 (`services/gateway/openapi.json`).

| Сервис | Порт | БД | Что делает |
|---|---|---|---|
| api-gateway | 8080 (наружу) | нет | единая точка входа: маршрутизация, проверка JWT, лимит запросов, X-Request-Id, `/docs`, `/api/v1/health` |
| identity-service | 8001 | identity_db | регистрация, вход, токены (RS256), профиль; сервисные токены, JWKS |
| reference-service | 8002 | reference_db | отрасли и навыки |
| vacancy-service | 8003 | vacancy_db | компании, вакансии, поиск, избранное |
| resume-service | 8004 | resume_db | резюме, опыт, образование, навыки |
| application-service | 8005 | application_db | отклики и статусы |
| recommendation-service | 8006 | recommendation_db | подбор вакансий и кандидатов по собственному индексу |
| notification-service | 8007 | notification_db | «отправка» писем с кодами (в лог сервиса) |

Все базы находятся в одном контейнере PostgreSQL, но это 7 отдельных БД с отдельными пользователями (`postgres/init.sql`): сервис видит только свою базу.

## Запуск

Сначала остановить ЛР 1, если она запущена (занят порт 15432): в папке `lab1` выполнить `docker compose down`.

```bash
cd lab2
docker compose up -d --build
docker compose ps            # 9 контейнеров в статусе Up
```

Первая сборка занимает несколько минут. Проверка:

- http://localhost:8080/api/v1/health — `{"status":"ok","version":"1.0.0"}`
- http://localhost:8080/docs — Swagger UI (кнопка Authorize для токена)
- Postman: импортировать из папки `postman/` коллекцию и окружение «JobSearch gateway (ЛР 2)», запустить коллекцию целиком.

Письма с кодами: `GET /api/v1/dev/mailbox?email=...` (только при `MAIL_DEBUG=true`) или `docker compose logs notification-service`.

Логи сервиса: `docker compose logs -f vacancy-service`. Остановка: `docker compose down`. Полный сброс данных: `docker compose down`, затем удалить папку `dbs/`.

## Как устроено

- **Общая библиотека** `packages/common`: ошибки, проверка JWT по JWKS, клиент межсервисных вызовов (сервисный токен, тайм-аут 2 с, повторы для GET, circuit breaker), outbox/inbox, запуск сервиса.
- **Токены.** Identity подписывает JWT ключом RS256 (ключ хранится в томе `identity-keys`), остальные проверяют подпись по `GET /internal/v1/.well-known/jwks.json`. Для вызовов между сервисами выдаются сервисные токены (`POST /internal/v1/auth/service-token`, 5 минут, привязаны к сервису-получателю).
- **Внутреннее API** `/internal/v1/**` доступно только с сервисным токеном и не маршрутизируется шлюзом (описано в ДЗ 4, `openapi-internal.yaml`).
- **Целостность без внешних ключей между БД.** Удаление вакансии: сначала закрыть, затем спросить Application Service (`applications/exists`), затем удалить; удаление резюме проверяется так же; Application раз в час сверяет отклики с существующими вакансиями и резюме.
- **События** (`identity.email_requested`, `vacancy.*`, `resume.*`) пишутся в таблицу `outbox_events` в одной транзакции с изменением данных и доставляются получателям с повторами; получатели идемпотентны (`inbox_events`). Сейчас доставка идёт по HTTP (`POST /internal/v1/events`); замена на RabbitMQ запланирована в следующем ДЗ, обработчики событий при этом не меняются.
- **Деградация.** Recommendation и Notification можно остановить: остальные функции работают, события накапливаются и доставляются после запуска. Справочники кешируются на 10 минут (`packages/common/src/refs.ts`).
- Индекс Recommendation заполняется автоматически при первом запуске и может быть перестроен `POST /internal/v1/index/rebuild`.

## Отличия от ДЗ 4

- Схема БД создаётся автоматически TypeORM (`synchronize`), миграции не подключены.
- Счётчики лимита запросов хранятся в памяти шлюза, без Redis.
- События идут по HTTP, RabbitMQ будет в следующем ДЗ.

## Запуск без Docker (для отладки)

Нужны PostgreSQL с базами из `postgres/init.sql`, Node 22 и `npm install`. Каждый сервис запускается командой `npx tsx services/<имя>/src/app.ts` с переменными окружения из `docker-compose.yml` (для запуска на одном хосте задать `URL_IDENTITY=http://localhost:8001` и аналогичные `URL_*`).
