package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"radiance/models"

	"github.com/google/uuid"
)

type ChatStore interface {
	IsUserActiveParticipant(roomID, userID string) (bool, error)
	CreateMessage(message models.Message) error
	UsernameByID(userID string) (string, error)
	MessagesByRoom(roomID string, limit, offset int) ([]models.Message, error)
}

type SQLChatStore struct {
	db *sql.DB
}

func NewSQLChatStore(db *sql.DB) *SQLChatStore {
	return &SQLChatStore{db: db}
}

func (s *SQLChatStore) IsUserActiveParticipant(roomID, userID string) (bool, error) {
	var exists bool
	err := s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM participants WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL)", roomID, userID).Scan(&exists)
	return exists, err
}

func (s *SQLChatStore) CreateMessage(message models.Message) error {
	_, err := s.db.Exec(
		"INSERT INTO messages (id, room_id, user_id, content) VALUES ($1, $2, $3, $4)",
		message.ID, message.RoomID, message.UserID, message.Content,
	)
	return err
}

func (s *SQLChatStore) UsernameByID(userID string) (string, error) {
	var username string
	err := s.db.QueryRow("SELECT username FROM users WHERE id = $1", userID).Scan(&username)
	return username, err
}

func (s *SQLChatStore) MessagesByRoom(roomID string, limit, offset int) ([]models.Message, error) {
	rows, err := s.db.Query(
		"SELECT m.id, m.room_id, m.user_id, m.content, m.created_at, m.is_edited, m.is_deleted, u.username FROM messages m JOIN users u ON m.user_id = u.id WHERE m.room_id = $1 AND m.is_deleted = false ORDER BY m.created_at DESC LIMIT $2 OFFSET $3",
		roomID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]models.Message, 0)
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.RoomID, &m.UserID, &m.Content, &m.CreatedAt, &m.IsEdited, &m.IsDeleted, &m.Username); err != nil {
			return nil, err
		}
		messages = append(messages, m)
	}
	return messages, rows.Err()
}

type ChatHandler struct {
	chat ChatStore
}

func NewChatHandler(db *sql.DB) *ChatHandler {
	return NewChatHandlerWithStore(NewSQLChatStore(db))
}

func NewChatHandlerWithStore(chat ChatStore) *ChatHandler {
	return &ChatHandler{chat: chat}
}

func (h *ChatHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	roomID := r.PathValue("id")

	var req models.SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request")
		return
	}
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "Content required")
		return
	}

	active, err := h.chat.IsUserActiveParticipant(roomID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if !active {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	username, err := h.chat.UsernameByID(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}

	message := models.Message{ID: uuid.New().String(), RoomID: roomID, UserID: userID, Username: username, Content: req.Content, IsEdited: false, IsDeleted: false}
	if err := h.chat.CreateMessage(message); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to send message")
		return
	}

	writeJSON(w, http.StatusCreated, message)
}

func (h *ChatHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	if _, ok := currentUserID(r); !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

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

	messages, err := h.chat.MessagesByRoom(r.PathValue("id"), limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}
	writeJSON(w, http.StatusOK, messages)
}
