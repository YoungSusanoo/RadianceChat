package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"time"

	"radiance/internal/app"
	"radiance/internal/storage/postgres"
)

func main() {
	cfg := app.Config{
		Addr:             env("RADIANCE_ADDR", ":8080"),
		StaticDir:        env("RADIANCE_STATIC_DIR", "web/app/dist"),
		LiveKitURL:       env("LIVEKIT_URL", ""),
		LiveKitAPIURL:    env("LIVEKIT_API_URL", ""),
		LiveKitAPIKey:    env("LIVEKIT_API_KEY", "devkey"),
		LiveKitAPISecret: env("LIVEKIT_API_SECRET", "secret"),
	}
	databaseURL := env("DATABASE_URL", "postgres://radiance:radiance@localhost:5432/radiance?sslmode=disable")
	migrationsDir := env("RADIANCE_MIGRATIONS_DIR", "migrations")

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	startupCtx, startupCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer startupCancel()
	if err := postgres.Migrate(startupCtx, databaseURL, migrationsDir); err != nil {
		logger.Error("database migration failed", "error", err)
		os.Exit(1)
	}
	store, err := postgres.Open(startupCtx, databaseURL)
	if err != nil {
		logger.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	server := app.NewServerWithStore(cfg, logger, store)

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("radiance server started", "addr", cfg.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}

func env(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
