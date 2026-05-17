# Backend Tests

| Тест | Что проверяет | План |
|---|---|---|
| `TestHappyPath` | Основной пользовательский сценарий: регистрация, создание комнаты, роль host, отправка сообщения, выход из комнаты и запрет читать сообщения после выхода. | Выполнить цепочку HTTP-вызовов через `httptest`: `POST /api/v1/auth/register` -> `POST /api/v1/rooms` -> `POST /api/v1/rooms/{roomId}/messages` -> `POST /api/v1/rooms/{roomId}/leave` -> `GET /api/v1/rooms/{roomId}/messages`. Проверить статусы, наличие токена, комнаты, host participant и `403` после выхода. |
| `TestHealthEndpoints` | Корректность health-check endpoints для контейнерного запуска и readiness probe. | Вызвать `GET /health/live` и `GET /health/ready`, ожидать `200 OK`. Затем выполнить readiness-запрос с отмененным context и проверить `503 Service Unavailable`. |
| `TestEventsRequireRoomParticipant` | Защиту SSE-событий комнаты: события доступны только участникам комнаты. | Зарегистрировать host и guest, создать комнату host-пользователем, проверить `403` для guest на `GET /api/v1/rooms/{roomId}/events`. После выхода host из комнаты проверить, что events для него также возвращают `403`. |
| `TestMemoryStoreAuthAndMessages` | Базовые операции store: регистрация, создание комнаты, логин, список публичных комнат и чтение сообщений участником. | Через store создать пользователя, комнату и сообщение, затем выполнить login, получить список публичных комнат и историю сообщений. Проверить идентификаторы и текст сообщения. |
| `TestLeaveRoomTransfersHost` | Передачу роли host при выходе текущего владельца комнаты. | Создать host и guest, добавить guest в комнату, выполнить выход host. Проверить, что guest стал новым host и может завершить комнату. |
| `TestLeaveRoomEndsEmptyRoom` | Завершение комнаты, если из нее вышел последний участник. | Создать комнату с одним host, выполнить leave, проверить `active=false` и пустой список участников. |
| `TestPublicLiveKitURLFromForwardedHeaders` | Формирование публичного LiveKit URL по reverse-proxy headers. | Создать HTTP-запрос с `X-Forwarded-Proto=https` и `X-Forwarded-Host=calls.example.com`, проверить результат `wss://calls.example.com/livekit`. |
| `TestPublicLiveKitURLPrefersExplicitConfig` | Приоритет явно заданного `LIVEKIT_URL` над вычислением из HTTP-запроса. | Создать server config с `LiveKitURL=wss://rtc.example.com`, выполнить расчет публичного URL и проверить, что возвращается значение из конфигурации. |
| `TestPublicLiveKitURLAvoidsInternalDockerHost` | Защиту от выдачи клиенту внутреннего Docker-host вроде `app:8080`. | Передать внутренний `X-Forwarded-Host=app:8080` и публичный `Forwarded host`, проверить, что клиенту возвращается публичный адрес. |
| `TestLiveKitControlRemoveParticipant` | Корректность вызова LiveKit RoomService API для удаления участника. | Подменить HTTP transport, вызвать `RemoveParticipant`, проверить Twirp path, наличие Bearer JWT и тело запроса с room/identity. |
| `TestLiveKitControlMuteAudio` | Корректность mute-flow через LiveKit RoomService API. | Подменить HTTP transport, вернуть участнику audio/video tracks, вызвать `MuteAudio`, проверить последовательность `GetParticipant` -> `MutePublishedTrack` и mute только audio track. |

Команда запуска:

```bash
env GOCACHE=/tmp/radiance-go-cache go test ./...
```
