package main

import (
	"bufio"
	"log"
	"net/http"
	"os"
	"strings"

	"radiance/config"
	"radiance/db"
	"radiance/handlers"
	"radiance/signaling"
)

func init() {
	if err := loadEnv(); err != nil {
		log.Printf("Note: No .env file found (OK in Docker), using environment variables")
	}
}

func loadEnv() error {
	file, err := os.Open(".env")
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		os.Setenv(key, value)
	}

	return scanner.Err()
}

func main() {
	// 1. Загрузка конфигурации
	cfg := config.Load()

	// 2. Подключение к БД
	database, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	// 3. Запуск миграций
	migrationSQL, err := os.ReadFile("db/migrations.sql")
	if err != nil {
		log.Printf("Warning: Could not read migrations.sql: %v", err)
	} else {
		if err := db.InitDB(database, string(migrationSQL)); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
	}

	// 4. Инициализация обработчиков
	authHandler := handlers.NewAuthHandler(database, cfg.JWTSecret)
	roomHandler := handlers.NewRoomHandler(database)
	chatHandler := handlers.NewChatHandler(database)
	signalingServer := signaling.NewSignalingServer(database, cfg.JWTSecret)

	// 5. Настройка роутера
	mux := http.NewServeMux()

	// --- Публичные маршруты ---
	mux.HandleFunc("POST /auth/register", authHandler.Register)
	mux.HandleFunc("POST /auth/login", authHandler.Login)

	// --- Защищенные маршруты (требуют JWT) ---
	// Оборачиваем роуты, требующие авторизации, в AuthMiddleware
	
	// Профиль пользователя
	mux.Handle("GET /auth/me", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.GetMe)))

	// Работа с комнатами
	mux.Handle("POST /rooms", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.CreateRoom)))
	mux.Handle("GET /rooms", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.ListRooms)))
	mux.Handle("POST /rooms/{id}/join", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.JoinRoom)))
	mux.Handle("POST /rooms/{id}/leave", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.LeaveRoom)))
	mux.Handle("DELETE /rooms/{id}", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.DeleteRoom)))
	mux.Handle("GET /rooms/{id}/participants", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.GetParticipants)))
	mux.Handle("POST /invites/{invite}", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.JoinByInvite)))

	// Чат
	mux.Handle("GET /rooms/{id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(chatHandler.GetMessages)))
	mux.Handle("POST /rooms/{id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(chatHandler.SendMessage)))

	mux.HandleFunc("/signaling", signalingServer.HandleWebSocket)
	mux.Handle("GET /rooms/{id}", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.GetRoom)))

	// 6. Запуск сервера
	addr := ":" + cfg.Port
	log.Printf("🎙️  Radiance server starting on http://localhost:%s", cfg.Port)
	log.Printf("Database status: Connected")

	// Оборачиваем весь mux в CORS для работы с фронтендом
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// withCORS добавляет необходимые заголовки для взаимодействия с фронтендом
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		} else {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}

		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, Authorization, X-User-ID")
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
