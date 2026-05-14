# Нагрузочные тесты Radiance — K6

## Структура

```
k6/
├── helpers.js                 # Общие утилиты и константы
├── scenario_a_create_room.js  # A: Создание встречи
├── scenario_b_join_call.js    # B: Вход в звонок (HTTP + WebSocket)
├── scenario_c_chat.js         # C: Нагрузка на чат
├── scenario_d_ws_signaling.js # D: WebSocket сигнализация
└── full_load_test.js          # Все сценарии одновременно
```

## Требования

```bash
# Установка K6 (Ubuntu/Debian)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# macOS
brew install k6
```

## Запуск

### Запустить один сценарий

```bash
# Задать адрес сервера (по умолчанию localhost:8080)
export BASE_URL=http://localhost:8080

# A: создание встреч
k6 run k6/scenario_a_create_room.js

# B: вход в звонок
k6 run k6/scenario_b_join_call.js

# C: чат
k6 run k6/scenario_c_chat.js

# D: WebSocket сигнализация
k6 run k6/scenario_d_ws_signaling.js
```

### Запустить полный нагрузочный тест (все сценарии)

```bash
k6 run --env BASE_URL=http://localhost:8080 k6/full_load_test.js
```

### С выводом результатов в JSON-файл

```bash
k6 run --out json=results.json k6/full_load_test.js
```

### С мониторингом через InfluxDB + Grafana

```bash
# Запустить InfluxDB локально
docker run -d -p 8086:8086 --name influxdb \
  -e INFLUXDB_DB=k6 influxdb:1.8

# Запустить тест с отправкой метрик
k6 run --out influxdb=http://localhost:8086/k6 k6/full_load_test.js
```

## Профиль нагрузки

| Фаза      | Время    | VU (A/B) | RPS (C) | WS (D) |
|-----------|----------|----------|---------|--------|
| Разогрев  | 0–5 мин  | 0→3 / 0→5 | 1→3    | 5      |
| Плато     | 5–15 мин | 3 / 5    | 3       | 5      |
| Спад      | 15–20 мин | 3→0 / 5→0 | 3→0  | 5      |

## Целевые метрики (НФТ)

| Метрика                             | Порог     |
|-------------------------------------|-----------|
| p95 `POST /rooms`                   | < 2 000 мс |
| p95 сценария «вход в звонок»        | < 3 000 мс |
| p95 `POST /rooms/{id}/messages`     | < 500 мс  |
| p95 `GET /rooms/{id}/messages`      | < 800 мс  |
| WS доставка сообщений               | > 90%     |
| Глобальный error rate               | < 10%     |

## Анализ результатов

После запуска K6 выводит итоговый отчёт. На что смотреть:

- **`http_req_failed`** — если > 10%, тест провален.
- **`radiance_create_room_ms{p(95)}`** — должно быть < 2 000 мс.
- **`radiance_join_scenario_ms{p(95)}`** — < 3 000 мс.
- **`radiance_ws_errors`** — много ошибок = нестабильность WS.
- **Логи сервера** — искать строку `Buffer full for peer` (переполнение канала сигнализации).

## Известные узкие места в коде

1. **`GET /rooms` / `GET /participants`** — JOIN-запросы без индексов по `room_id`.
   Исправление: добавить в `migrations.sql`:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_participants_room_id ON participants(room_id);
   CREATE INDEX IF NOT EXISTS idx_participants_user_room ON participants(room_id, user_id);
   CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
   ```

2. **Буфер WS-канала = 5** в `signaling.go` — при 5+ участниках возможны потери.
   Исправление: увеличить буфер `make(chan *Message, 50)`.

3. **Тройной SELECT в `JoinRoom`** — не обёрнут в транзакцию, гонка при параллельных входах.
