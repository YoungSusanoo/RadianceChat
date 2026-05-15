package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWithCORSHandlesPreflightAndOrigin(t *testing.T) {
	nextCalled := false
	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusTeapot)
	}))

	preflight := httptest.NewRequest(http.MethodOptions, "/rooms", nil)
	preflight.Header.Set("Origin", "http://localhost:3000")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, preflight)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rr.Code)
	}
	if nextCalled {
		t.Fatalf("preflight should not call next handler")
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("unexpected allow-origin header: %q", got)
	}
	if got := rr.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("unexpected credentials header: %q", got)
	}

	request := httptest.NewRequest(http.MethodGet, "/rooms", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, request)
	if rr.Code != http.StatusTeapot || !nextCalled {
		t.Fatalf("expected next handler response, code=%d nextCalled=%v", rr.Code, nextCalled)
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("unexpected wildcard header: %q", got)
	}
}
