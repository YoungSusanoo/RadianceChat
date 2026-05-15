package handlers

import (
	"encoding/json"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	http.Error(w, message, status)
}

func currentUserID(r *http.Request) (string, bool) {
	userID := r.Header.Get("X-User-ID")
	return userID, userID != ""
}
