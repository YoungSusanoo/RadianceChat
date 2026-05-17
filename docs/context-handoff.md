# Radiance Context Handoff

## Project

Курсовая работа по предмету **"Архитектура программных систем"**.

Тема: **приложение для аудио- и видеозвонков**.

Изначально в проекте лежали:

- `Лабораторная_работа_для_студентов_3_2026.docx` — задание;
- `Требования_домены_ресурсы_доступность — копия.xlsx` — требования, домены, расчеты.

## Requirements

Ключевые требования из Excel:

- регистрация, вход, выход;
- создание публичных и приватных комнат;
- invite-ссылка;
- вход, выход и повторное подключение к комнате;
- до 15 участников в комнате;
- аудио/видео в реальном времени;
- включение/выключение микрофона и камеры;
- список участников;
- роль хоста;
- хост может mute/kick/end room;
- чат во время звонка;
- в дальнейшем нужны функциональные, нагрузочные и стресс-тесты.

## Architecture Decisions

Выбранный стек:

- Backend: **Go**
- Frontend: **React + TypeScript + Vite**
- Realtime control plane: **SSE** на текущем этапе, позже можно заменить на WebSocket
- Media plane: **LiveKit SFU**
- TURN/STUN: `coturn`
- Storage: PostgreSQL через `DATABASE_URL`
- Future scale-out: Redis Pub/Sub для presence/realtime fan-out
- Media/runtime: LiveKit + coturn

Kafka решили не использовать в прототипе, потому что она избыточна для текущих требований. Ее можно оставить как будущее расширение для audit/analytics/events.

## Backend State

Реализовано:

- Go backend: `cmd/radiance/main.go`
- HTTP API: `internal/app/server.go`
- Store interface + in-memory реализация для быстрых unit-тестов: `internal/app/store.go`, `internal/app/memory_store.go`
- PostgreSQL adapter: `internal/storage/postgres/`
- Модели: `internal/app/models.go`
- LiveKit JWT issuing: `internal/app/media.go`
- SSE broker: `internal/realtime/broker.go`
- PostgreSQL physical schema: `migrations/001_init.sql`
- Тесты:
  - `internal/app/server_test.go`
  - `internal/app/store_test.go`

Основные API:

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me

GET  /api/v1/rooms
POST /api/v1/rooms
GET  /api/v1/rooms/{roomId}
POST /api/v1/rooms/{roomId}/join
POST /api/v1/rooms/{roomId}/leave
POST /api/v1/rooms/{roomId}/end
PATCH /api/v1/rooms/{roomId}/device

GET  /api/v1/rooms/{roomId}/messages
POST /api/v1/rooms/{roomId}/messages

GET  /api/v1/rooms/{roomId}/events?access_token={token}
POST /api/v1/rooms/{roomId}/media-token

GET  /api/v1/invites/{inviteToken}
POST /api/v1/invites/{inviteToken}/join
```

## Frontend History

Сначала был vanilla frontend:

- `web/static/index.html`
- `web/static/styles.css`
- `web/static/app.js`

Он работал, но были проблемы:

- `state.messages is null`;
- кнопки микрофона/камеры могли ломать отображение комнат;
- LiveKit SDK грузился через CDN;
- browser permission prompt на микрофон мог не появляться, потому что flow сначала пытался подключить LiveKit.

После этого начали перенос на:

- **React**
- **TypeScript**
- **Vite**
- `livekit-client` как npm dependency, без CDN.

Новый frontend находится в:

```text
web/app/
```

Ключевые файлы:

```text
web/app/package.json
web/app/vite.config.ts
web/app/src/App.tsx
web/app/src/main.tsx
web/app/src/lib/api.ts
web/app/src/lib/media.ts
web/app/src/lib/types.ts
web/app/src/lib/useMediaController.ts
web/app/src/components/AuthPanel.tsx
web/app/src/components/RoomPanel.tsx
web/app/src/components/MeetingStage.tsx
web/app/src/components/ParticipantsPanel.tsx
web/app/src/components/ChatPanel.tsx
web/app/src/styles/app.css
```

Важно: React frontend пока визуально похож на старый интерфейс. Это был **технический перенос на React**, а не полноценный visual redesign.

## Media Flow

Новый media-flow в React frontend:

1. Пользователь входит в комнату.
2. Frontend автоматически вызывает browser permission prompt через `navigator.mediaDevices.getUserMedia`.
3. Пробуем `audio + video`.
4. Если камера недоступна, пробуем audio-only.
5. Локальные треки показываются в preview.
6. Затем запрашивается `/media-token`.
7. Frontend подключается к LiveKit.
8. Audio/video tracks публикуются в LiveKit выключенными по умолчанию.

Это было нужно, чтобы исправить проблему: "браузер не спрашивает доступ к микрофону".

## Docker

Добавлен multi-stage Dockerfile:

```text
deployments/Dockerfile
```

Он:

1. собирает React frontend через `node:20-alpine`;
2. собирает Go backend через `golang:1.24`;
3. кладет Go binary и React `dist` в final image.

`deployments/docker-compose.yml` теперь использует:

```yaml
build:
  context: ..
  dockerfile: deployments/Dockerfile
```

Приложение больше не использует JSON snapshot и `app_data`. Данные приложения хранятся в PostgreSQL volume:

```yaml
volumes:
  - postgres_data:/var/lib/postgresql/data
```

Go теперь по умолчанию отдает React build из:

```text
web/app/dist
```

В `cmd/radiance/main.go`:

```go
StaticDir: env("RADIANCE_STATIC_DIR", "web/app/dist")
```

В Docker:

```yaml
RADIANCE_STATIC_DIR: "/app/web"
```

## Verification

Проверки, которые проходили:

```bash
cd web/app
npm run build
```

```bash
env GOCACHE=/tmp/radiance-go-cache go test ./...
```

```bash
cd deployments
docker compose build app
```

Все проходило. Был warning Vite про большой chunk из-за `livekit-client`, это не ошибка.

## Current State

- Backend рабочий.
- React frontend собран и отдается Go.
- Docker image `deployments-app:latest` собирался успешно.
- Пользователь увидел, что "код новый, но интерфейс остался старым".
- Объяснение: React frontend пока сохраняет старую трехколоночную компоновку.
- Следующий логичный шаг: сделать **визуальный редизайн React UI**, чтобы он реально выглядел новым и современным.

## Planned Next Steps

1. Сделать visual redesign поверх React:
   - верхняя панель;
   - sidebar комнат;
   - центральная meeting-сцена;
   - правая панель чата/участников;
   - аккуратные кнопки звонка;
   - явные статусы медиа: "запрашиваем микрофон", "микрофон разрешен", "LiveKit подключен", "audio-only".

2. Проверить реальные звонки:
   - два пользователя или два окна;
   - browser permission prompt;
   - публикация audio track;
   - remote audio playback;
   - LiveKit logs.

3. После завершения приложения перейти к тестированию:
   - функциональные сценарии;
   - k6 HTTP tests;
   - SSE/realtime tests;
   - нагрузочные/стресс-тесты;
   - отчет для курсовой.

## Run Commands

Локально:

```bash
cd web/app
npm install
npm run build
cd ../..
go run ./cmd/radiance
```

Docker:

```bash
cd deployments
docker compose down --remove-orphans
docker compose up -d --build --force-recreate
```

## Debugging Old UI

Если старый интерфейс все еще виден:

```bash
view-source:http://localhost:8080/
```

Новый React build должен содержать:

```html
<div id="root"></div>
<script type="module" crossorigin src="/assets/index-....js"></script>
```

Если видна старая полная HTML-разметка с `<main class="app">`, значит отдается старый vanilla frontend или старый контейнер/browser cache.

Дополнительные команды:

```bash
docker compose ps
docker compose logs --tail=80 app
curl -s http://localhost:8080/ | head -30
```
