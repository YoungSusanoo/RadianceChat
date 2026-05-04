package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"radiance/models"

	"github.com/google/uuid"
)

type RoomHandler struct {
	db *sql.DB
}

func NewRoomHandler(db *sql.DB) *RoomHandler {
	return &RoomHandler{db: db}
}

func (h *RoomHandler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	roomID := uuid.New().String()
	inviteLink := uuid.New().String()

	_, err := h.db.Exec(
		"INSERT INTO rooms (id, name, type, host_id, invite_link, status) VALUES ($1, $2, $3, $4, $5, $6)",
		roomID, req.Name, req.Type, userID, inviteLink, "active",
	)
	if err != nil {
		http.Error(w, "Failed to create room", http.StatusInternalServerError)
		return
	}

	// Add host as participant
	_, err = h.db.Exec(
		"INSERT INTO participants (id, room_id, user_id, role) VALUES ($1, $2, $3, $4)",
		uuid.New().String(), roomID, userID, "host",
	)
	if err != nil {
		http.Error(w, "Failed to create room participant", http.StatusInternalServerError)
		return
	}

	room := models.Room{
		ID:         roomID,
		Name:       req.Name,
		Type:       req.Type,
		HostID:     userID,
		InviteLink: inviteLink,
		CreatedAt:  time.Now(),
		Status:     "active",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(room)
}

func (h *RoomHandler) GetRoom(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("id")

	var room models.Room
	err := h.db.QueryRow(
		"SELECT id, name, type, host_id, invite_link, created_at, status FROM rooms WHERE id = $1",
		roomID,
	).Scan(&room.ID, &room.Name, &room.Type, &room.HostID, &room.InviteLink, &room.CreatedAt, &room.Status)

	if err == sql.ErrNoRows {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(room)
}

func (h *RoomHandler) ListRooms(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(
		"SELECT id, name, type, host_id, invite_link, created_at, status FROM rooms WHERE status = 'active' ORDER BY created_at DESC LIMIT 50",
	)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var rooms []models.Room
	for rows.Next() {
		var room models.Room
		if err := rows.Scan(&room.ID, &room.Name, &room.Type, &room.HostID, &room.InviteLink, &room.CreatedAt, &room.Status); err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		rooms = append(rooms, room)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rooms)
}

func (h *RoomHandler) JoinRoom(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	roomID := r.PathValue("id")

	// Check if room exists
	var exists bool
	if err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM rooms WHERE id = $1)", roomID).Scan(&exists); err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	if !exists {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	// Check if user already in room
	var activeCount int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM participants WHERE room_id = $1 AND left_at IS NULL", roomID).Scan(&activeCount); err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	if activeCount >= 5 {
		http.Error(w, "Room is full", http.StatusBadRequest)
		return
	}

	_, err := h.db.Exec(
		"INSERT INTO participants (id, room_id, user_id, role) VALUES ($1, $2, $3, $4)",
		uuid.New().String(), roomID, userID, "participant",
	)
	if err != nil {
		http.Error(w, "Failed to join room", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "joined"})
}

func (h *RoomHandler) LeaveRoom(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	roomID := r.PathValue("id")

	_, err := h.db.Exec(
		"UPDATE participants SET left_at = NOW() WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL",
		roomID, userID,
	)
	if err != nil {
		http.Error(w, "Failed to leave room", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "left"})
}

func (h *RoomHandler) GetParticipants(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("id")

	rows, err := h.db.Query(
		"SELECT p.id, p.room_id, p.user_id, p.role, p.joined_at, p.left_at, u.email FROM participants p JOIN users u ON p.user_id = u.id WHERE p.room_id = $1 AND p.left_at IS NULL",
		roomID,
	)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var participants []models.Participant
	for rows.Next() {
		var p models.Participant
		var leftAt sql.NullTime
		if err := rows.Scan(&p.ID, &p.RoomID, &p.UserID, &p.Role, &p.JoinedAt, &leftAt, &p.Username); err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		if leftAt.Valid {
			p.LeftAt = &leftAt.Time
		}
		participants = append(participants, p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(participants)
}

func (h *RoomHandler) JoinByInvite(w http.ResponseWriter, r *http.Request) {
	invite := r.PathValue("invite")
	if invite == "" {
		http.Error(w, "Invite required", http.StatusBadRequest)
		return
	}

	var roomID string
	err := h.db.QueryRow("SELECT id FROM rooms WHERE invite_link = $1 AND status = 'active'", invite).Scan(&roomID)
	if err == sql.ErrNoRows {
		http.Error(w, "Invite not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	r.SetPathValue("id", roomID)
	h.JoinRoom(w, r)
}

func (h *RoomHandler) DeleteRoom(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	roomID := r.PathValue("id")
	var hostID string
	err := h.db.QueryRow("SELECT host_id FROM rooms WHERE id = $1", roomID).Scan(&hostID)
	if err == sql.ErrNoRows {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	if hostID != userID {
		http.Error(w, "Only host can delete room", http.StatusForbidden)
		return
	}

	_, err = h.db.Exec("UPDATE rooms SET status = 'ended', ended_at = NOW() WHERE id = $1", roomID)
	if err != nil {
		http.Error(w, "Failed to delete room", http.StatusInternalServerError)
		return
	}
	_, _ = h.db.Exec("UPDATE participants SET left_at = NOW() WHERE room_id = $1 AND left_at IS NULL", roomID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}
