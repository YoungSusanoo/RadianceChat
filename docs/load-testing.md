# План нагрузочного и стресс-тестирования

Тестирование строится вокруг ключевых бизнес-транзакций, а не вокруг полного перебора всех endpoints. Auth-запросы включены в цепочки как подготовительный шаг, потому что основные операции требуют access token.

## Сценарии

| Сценарий | Количество запросов в 1 итерации | Плановая интенсивность | Цепочка вызовов |
|---|---:|---:|---|
| Создание комнаты | 3 | 4 VU на плато | `POST /auth/register` -> `POST /rooms` -> `GET /rooms/{roomId}` |
| Подключение к комнате | 6 | 4 VU на плато | `POST /auth/register` host -> `POST /rooms` -> `POST /auth/register` guest -> `POST /invites/{inviteToken}/join` -> `GET /rooms/{roomId}` -> `POST /rooms/{roomId}/media-token` |
| Чат в комнате | 4 | 8 VU на плато | `POST /auth/register` -> `POST /rooms` -> `POST /rooms/{roomId}/messages` -> `GET /rooms/{roomId}/messages` |

## Методика

Плановая нагрузка:

- инструмент: k6;
- файл: `tests/load/load_core.js`;
- длительность: 20 минут;
- ramp-up: 5 минут;
- plateau: 10 минут;
- ramp-down: 5 минут;
- допустимый error rate: меньше 10%;
- целевой p95 HTTP API: меньше 1000 мс.

Стресс-тест:

- файл: `tests/load/stress_core.js`;
- стартует с плановой нагрузки;
- после выхода на нагрузку увеличивает VU на 10% каждые 10 секунд;
- точка деградации фиксируется при error rate больше 25% или существенном росте p95.

Нагрузка x10:

- файл: `tests/load/x10_core.js`;
- использует те же сценарии, но с VU x10;
- результат фиксируется как выдержала/не выдержала, с указанием p95, error rate и предполагаемого узкого места.

## Команды

```bash
env GOCACHE=/tmp/radiance-go-cache go test ./...
docker compose --env-file deployments/.env.desktop -f deployments/docker-compose.desktop.yml up --build
curl -fsS http://localhost:8080/health/ready
k6 run tests/load/http_smoke.js
k6 run tests/load/load_core.js
k6 run tests/load/stress_core.js
k6 run tests/load/x10_core.js
```

Для запуска против другого адреса:

```bash
BASE_URL=http://localhost:8080 k6 run tests/load/load_core.js
```
