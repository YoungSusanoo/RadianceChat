# План нагрузочного и стресс-тестирования

Тестирование строится вокруг ключевых бизнес-транзакций, а не вокруг полного перебора всех endpoints. Auth-запросы включены в цепочки как подготовительный шаг, потому что основные операции требуют access token.

## Сценарии

| Сценарий | Количество запросов в 1 итерации | Плановая интенсивность | Цепочка вызовов |
|---|---:|---:|---|
| Создание комнаты | 3 + подготовка пользователя | 4 VU на плато | подготовка host -> `POST /rooms` -> `GET /rooms/{roomId}` -> `POST /rooms/{roomId}/end` |
| Подключение к комнате | 6 + подготовка пользователей | 4 VU на плато | подготовка host/guest -> `POST /rooms` -> `POST /invites/{inviteToken}/join` -> `GET /rooms/{roomId}` -> `POST /rooms/{roomId}/media-token` -> `POST /rooms/{roomId}/leave` -> `POST /rooms/{roomId}/end` |
| Чат в комнате | 4 + подготовка пользователя | 8 VU на плато | подготовка user -> `POST /rooms` -> `POST /rooms/{roomId}/messages` -> `GET /rooms/{roomId}/messages` -> `POST /rooms/{roomId}/end` |

## Методика

Плановая нагрузка:

- инструмент: k6;
- файл: `tests/load/load_core.js`;
- длительность: 20 минут;
- ramp-up: 5 минут;
- plateau: 10 минут;
- ramp-down: 5 минут;
- допустимый error rate: меньше 10%;
- целевой p95 HTTP API: меньше 3000 мс.

Стресс-тест:

- файл: `tests/load/stress_core.js`;
- стартует с плановой нагрузки;
- за 5 минут выходит на плановый уровень;
- затем в течение теста увеличивает VU на 10% каждые 10 секунд;
- точка деградации фиксируется при error rate больше 25%;
- превышение 25% в стресс-тесте не считается ошибкой методики, а является целевым результатом поиска breaking point.

Усиленный stress-прогон:

- файл: `tests/load/stress_breakpoint.js`;
- используется, если базовый stress-прогон не достиг error rate 25%;
- стартовые VU увеличены в 2 раза;
- рост продолжается 120 шагов по 10 секунд;
- ориентировочный пик: 56 VU для создания комнат, 56 VU для подключения и 112 VU для чата.

Нагрузка x10:

- файл: `tests/load/x10_core.js`;
- использует те же сценарии, но с VU x10;
- результат фиксируется как выдержала/не выдержала, с указанием p95, error rate и предполагаемого узкого места;
- для x10 допускается более мягкий технический порог: error rate меньше 25% и p95 меньше 5000 мс.

## Команды

```bash
env GOCACHE=/tmp/radiance-go-cache go test ./...
docker compose --env-file deployments/.env -f deployments/docker-compose.yml up --build
curl -fsS http://localhost:8080/health/ready
k6 run tests/load/http_smoke.js
k6 run tests/load/load_core.js
k6 run tests/load/stress_core.js
k6 run tests/load/stress_breakpoint.js
k6 run tests/load/x10_core.js
```

Для запуска против другого адреса:

```bash
BASE_URL=http://localhost:8080 k6 run tests/load/load_core.js
```

Для отделения прогонов друг от друга можно задать `TEST_RUN_ID`:

```bash
TEST_RUN_ID=report-01 BASE_URL=http://localhost:8080 k6 run tests/load/load_core.js
```

Сценарии переиспользуют load-test пользователей внутри VU и закрывают созданные комнаты через `/end` или `/leave` + `/end`. Для очистки данных, накопленных старыми прогонами, можно выполнить:

```bash
docker compose --env-file deployments/.env -f deployments/docker-compose.yml exec -T postgres psql -U radiance -d radiance < tests/load/cleanup_load_data.sql
```
