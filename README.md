# 🎙️ Radiance Voice Chat

Голосовой чат в реальном времени с поддержкой аудио/видео звонков и текстовых сообщений.

## ✨ Возможности

- 🎥 Аудио/видео звонки в реальном времени
- 💬 Текстовый чат в комнатах
- 🏠 Создание и управление комнатами
- 🔗 Присоединение по коду приглашения
- 👥 Поддержка нескольких участников в комнате
- 🎨 Современный темный интерфейс
- 📱 Адаптивный дизайн для мобильных устройств

## 🚀 Быстрый старт с Docker Compose

### Требования

- Docker
- Docker Compose

### Установка и запуск

1. **Клонируйте репозиторий:**
```bash
git clone <repository-url>
cd RadianceChat
```

2. **Запустите приложение:**
```bash
docker compose up -d
```

Это запустит все три сервиса:
- PostgreSQL база данных
- Go backend сервер
- Nginx frontend сервер

3. **Откройте приложение в браузере:**
```
http://localhost:8080
```

### Управление сервисами

```bash
# Запустить все сервисы
docker compose up -d

# Остановить все сервисы
docker compose down

# Посмотреть логи
docker compose logs -f

# Перезапустить сервисы
docker compose restart

# Остановить и удалить тома (включая базу данных)
docker compose down -v
```

## 📦 Структура проекта

```
RadianceChat/
├── frontend/           # Frontend (HTML, CSS, JavaScript)
│   ├── index.html     # Главный HTML файл
│   ├── style.css      # Стили
│   ├── app.js         # JavaScript логика
│   └── nginx.conf     # Nginx конфигурация
├── handlers/          # HTTP обработчики
│   ├── auth.go        # Аутентификация
│   ├── room.go        # Управление комнатами
│   └── chat.go        # Чат
├── signaling/         # WebSocket сервер для WebRTC
│   └── signaling.go
├── models/            # Модели данных
├── db/                # Миграции базы данных
├── config/            # Конфигурация
└── docker-compose.yml # Docker Compose конфигурация
```

## 🔧 Ручной запуск (без Docker)

### Требования

- Go 1.22+
- PostgreSQL 17+
- Node.js (для разработки фронтенда)

### Шаги

1. **Настройте базу данных PostgreSQL:**
```bash
# Создайте базу данных
createdb radiance_chat
```

2. **Настройте переменные окружения:**
```bash
cp .env.example .env
# Отредактируйте .env с вашими настройками БД
```

3. **Запустите backend:**
```bash
go run main.go
```

4. **Запустите frontend (в отдельном терминале):**
```bash
cd frontend
python3 -m http.server 3000
```

5. **Откройте в браузере:**
```
http://localhost:3000
```

## 📖 Использование

### Регистрация и вход

1. Откройте приложение
2. Нажмите "Зарегистрироваться"
3. Введите email и пароль
4. После регистрации вы автоматически войдете в систему

### Создание комнаты

1. На экране управления комнатами введите название комнаты
2. Нажмите "Создать комнату"
3. Код приглашения будет автоматически скопирован в буфер обмена
4. Поделитесь кодом с друзьями

### Присоединение к комнате

**По коду:**
1. Введите код приглашения в поле "Код приглашения"
2. Нажмите "Войти в комнату"

**Из списка:**
1. Нажмите "Войти" на карточке комнаты

### Начало звонка

1. Войдите в комнату
2. Нажмите кнопку "Начать звонок"
3. Разрешите доступ к микрофону и камере
4. Другие участники увидят ваш видеопоток

### Управление звонком

- 🎙️ **Микрофон** - включить/выключить микрофон
- 📹 **Камера** - включить/выключить камеру
- ❌ **Завершить звонок** - выйти из звонка

### Текстовый чат

1. Введите сообщение в поле ввода
2. Нажмите "Отправить" или Enter
3. Сообщения видны всем участникам комнаты

## 🔐 API

### Аутентификация

```bash
# Регистрация
POST /api/auth/register
Content-Type: application/json
{
  "email": "user@example.com",
  "password": "password123"
}

# Вход
POST /api/auth/login
Content-Type: application/json
{
  "email": "user@example.com",
  "password": "password123"
}

# Получить текущего пользователя
GET /api/auth/me
Authorization: Bearer <token>
```

### Комнаты

```bash
# Создать комнату
POST /api/rooms
Authorization: Bearer <token>
Content-Type: application/json
{
  "name": "Моя комната",
  "type": "public"
}

# Получить список комнат
GET /api/rooms
Authorization: Bearer <token>

# Присоединиться к комнате
POST /api/rooms/{id}/join
Authorization: Bearer <token>

# Выйти из комнаты
POST /api/rooms/{id}/leave
Authorization: Bearer <token>

# Присоединиться по коду
POST /api/invites/{code}
Authorization: Bearer <token>
```

### Чат

```bash
# Получить сообщения
GET /api/rooms/{id}/messages
Authorization: Bearer <token>

# Отправить сообщение
POST /api/rooms/{id}/messages
Authorization: Bearer <token>
Content-Type: application/json
{
  "content": "Привет всем!"
}
```

### WebSocket

```javascript
// Подключение к WebSocket
const ws = new WebSocket('ws://localhost:8080/ws/chat/{room_id}/?token={token}&username={username}');

// Сообщения
{
  "type": "offer|answer|candidate|user_joined|user_left|room_state|chat_message",
  "from": "peer_id",
  "to": "target_peer_id",
  "room_id": "room_id",
  "data": {}
}
```

## 🛠️ Технологии

- **Backend:** Go 1.22
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Database:** PostgreSQL 17
- **WebRTC:** Real-time audio/video
- **WebSocket:** Signaling server
- **Web Server:** Nginx
- **Containerization:** Docker & Docker Compose

## 📝 Конфигурация

Переменные окружения в `.env`:

```env
DATABASE_URL=postgres://user:password@host:port/dbname?sslmode=disable
JWT_SECRET=your-secret-key-min-32-chars
STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
PORT=8080
```

## 🐛 Troubleshooting

### Проблемы с Docker

```bash
# Проверьте статус контейнеров
docker compose ps

# Посмотрите логи
docker compose logs -f [service_name]

# Пересоберите контейнеры
docker compose up -d --build
```

### Проблемы с WebRTC

- Убедитесь, что используете HTTPS или localhost
- Проверьте настройки брандмауэра
- Убедитесь, что STUN серверы доступны

### Проблемы с базой данных

```bash
# Перезапустите базу данных
docker compose restart db

# Удалите и пересоздайте базу данных
docker compose down -v
docker compose up -d
```

## 📄 Лицензия

MIT License - см. файл LICENSE

## 🤝 Вклад

Вклады приветствуются! Пожалуйста, создайте Pull Request или откройте Issue.

## 📞 Поддержка

Если у вас есть вопросы или проблемы, пожалуйста, откройте Issue в репозитории.
