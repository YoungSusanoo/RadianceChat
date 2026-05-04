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
	cfg := config.Load()

	database, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	migrationSQL, err := os.ReadFile("db/migrations.sql")
	if err != nil {
		log.Fatalf("Failed to read migrations: %v", err)
	}

	if err := db.InitDB(database, string(migrationSQL)); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	authHandler := handlers.NewAuthHandler(database, cfg.JWTSecret)
	roomHandler := handlers.NewRoomHandler(database)
	chatHandler := handlers.NewChatHandler(database)
	signalingServer := signaling.NewSignalingServer(database, cfg.JWTSecret)

	mux := http.NewServeMux()

	// Public routes
	mux.HandleFunc("POST /auth/register", authHandler.Register)
	mux.HandleFunc("POST /auth/login", authHandler.Login)
	mux.HandleFunc("GET /rooms", roomHandler.ListRooms)
	mux.HandleFunc("GET /rooms/{id}", roomHandler.GetRoom)

	// Protected routes
	mux.Handle("GET /auth/me", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.GetMe)))
	mux.Handle("POST /rooms", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.CreateRoom)))
	mux.Handle("POST /rooms/{id}/join", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.JoinRoom)))
	mux.Handle("POST /rooms/join/{invite}", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.JoinByInvite)))
	mux.Handle("POST /rooms/{id}/leave", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.LeaveRoom)))
	mux.Handle("GET /rooms/{id}/participants", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.GetParticipants)))
	mux.Handle("DELETE /rooms/{id}", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.DeleteRoom)))

	mux.Handle("GET /rooms/{id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(chatHandler.GetMessages)))
	mux.Handle("POST /rooms/{id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(chatHandler.SendMessage)))

	mux.Handle("/signaling", authHandler.AuthMiddleware(http.HandlerFunc(signalingServer.HandleWebSocket)))

	addr := ":" + cfg.Port
	log.Printf("🎙️  Radiance server starting on http://localhost:%s", cfg.Port)
	log.Printf("Database: %s", cfg.DatabaseURL)

	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
