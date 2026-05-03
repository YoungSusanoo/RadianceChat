package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"radiance/models"

	"github.com/google/uuid"
)

type ChatHandler struct {
	db *sql.DB
}

func NewChatHandler(db *sql.DB) *ChatHandler {
	return &ChatHandler{db: db}
}

func (h *ChatHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	roomID := r.PathValue("id")

	var req models.SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Content == "" {
		http.Error(w, "Content required", http.StatusBadRequest)
		return
	}

	messageID := uuid.New().String()

	_, err := h.db.Exec(
		"INSERT INTO messages (id, room_id, user_id, content) VALUES ($1, $2, $3, $4)",
		messageID, roomID, userID, req.Content,
	)
	if err != nil {
		http.Error(w, "Failed to send message", http.StatusInternalServerError)
		return
	}

	var username string
	h.db.QueryRow("SELECT email FROM users WHERE id = $1", userID).Scan(&username)

	message := models.Message{
		ID:        messageID,
		RoomID:    roomID,
		UserID:    userID,
		Username:  username,
		Content:   req.Content,
		IsEdited:  false,
		IsDeleted: false,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(message)
}

func (h *ChatHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("id")

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	rows, err := h.db.Query(
		"SELECT m.id, m.room_id, m.user_id, m.content, m.created_at, m.is_edited, m.is_deleted, u.email FROM messages m JOIN users u ON m.user_id = u.id WHERE m.room_id = $1 AND m.is_deleted = false ORDER BY m.created_at DESC LIMIT $2 OFFSET $3",
		roomID, limit, offset,
	)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.RoomID, &m.UserID, &m.Content, &m.CreatedAt, &m.IsEdited, &m.IsDeleted, &m.Username); err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		messages = append(messages, m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}
