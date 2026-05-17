package app

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicLiveKitURLFromForwardedHeaders(t *testing.T) {
	server := NewServer(Config{}, slog.Default())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rooms/room/media-token", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "calls.example.com")

	got := server.publicLiveKitURL(req)
	if got != "wss://calls.example.com/livekit" {
		t.Fatalf("publicLiveKitURL = %q", got)
	}
}

func TestPublicLiveKitURLPrefersExplicitConfig(t *testing.T) {
	server := NewServer(Config{LiveKitURL: "wss://rtc.example.com"}, slog.Default())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rooms/room/media-token", nil)
	req.Host = "calls.example.com"

	got := server.publicLiveKitURL(req)
	if got != "wss://rtc.example.com" {
		t.Fatalf("publicLiveKitURL = %q", got)
	}
}

func TestPublicLiveKitURLAvoidsInternalDockerHost(t *testing.T) {
	server := NewServer(Config{}, slog.Default())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rooms/room/media-token", nil)
	req.Header.Set("X-Forwarded-Proto", "http")
	req.Header.Set("X-Forwarded-Host", "app:8080")
	req.Header.Set("Forwarded", `for=192.0.2.10;proto=http;host=144.31.156.17:8080`)

	got := server.publicLiveKitURL(req)
	if got != "ws://144.31.156.17:8080/livekit" {
		t.Fatalf("publicLiveKitURL = %q", got)
	}
}
