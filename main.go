package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"radiance/config"
	"radiance/db"
	"radiance/handlers"
	"radiance/signaling"
)

func init() {
	if err := loadEnv(); err != nil {
		log.Printf("Warning: could not load .env file: %v", err)
	}
}

func loadEnv() error {
	file, err := os.Open(".env")
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := os.Environ()
	for _, env := range scanner {
		os.Setenv(env[:len(env)], env)
	}
	return nil
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
	mux.Handle("POST /rooms/{id}/leave", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.LeaveRoom)))
	mux.Handle("GET /rooms/{id}/participants", authHandler.AuthMiddleware(http.HandlerFunc(roomHandler.GetParticipants)))

	mux.Handle("GET /rooms/{id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(chatHandler.GetMessages)))
	mux.Handle("POST /rooms/{id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(chatHandler.SendMessage)))

	mux.Handle("/signaling", authHandler.AuthMiddleware(http.HandlerFunc(signalingServer.HandleWebSocket)))

	fmt.Printf("🎙️  Radiance server running on http://localhost:%s\n", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
