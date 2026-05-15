package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"radiance/models"

	"github.com/google/uuid"
)

type RoomStore interface {
	CreateRoomWithHost(room models.Room, participantID string) error
	FindRoomByID(roomID string) (models.Room, error)
	ListActiveRoomsForUser(userID string) ([]models.Room, error)
	ActiveRoomExists(roomID string) (bool, error)
	IsUserActiveParticipant(roomID, userID string) (bool, error)
	ActiveParticipantCount(roomID string) (int, error)
	AddParticipant(participant models.Participant) error
	LeaveRoom(roomID, userID string) error
	ActiveParticipants(roomID string) ([]models.Participant, error)
	RoomIDByInvite(invite string) (string, error)
	HostID(roomID string) (string, error)
	EndRoomAndLeaveParticipants(roomID string) error
}

type SQLRoomStore struct {
	db *sql.DB
}

func NewSQLRoomStore(db *sql.DB) *SQLRoomStore {
	return &SQLRoomStore{db: db}
}

func (s *SQLRoomStore) CreateRoomWithHost(room models.Room, participantID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		"INSERT INTO rooms (id, name, type, host_id, invite_link, status) VALUES ($1, $2, $3, $4, $5, 'active')",
		room.ID, room.Name, room.Type, room.HostID, room.InviteLink,
	)
	if err != nil {
		return err
	}

	_, err = tx.Exec(
		"INSERT INTO participants (id, room_id, user_id, role) VALUES ($1, $2, $3, 'host')",
		participantID, room.ID, room.HostID,
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (h *RoomHandler) GetRoom(w http.ResponseWriter, r *http.Request) {
    roomID := r.PathValue("id")
    var room models.Room

    err := h.db.QueryRow("SELECT id, name, type, host_id FROM rooms WHERE id = $1", roomID).
        Scan(&room.ID, &room.Name, &room.Type, &room.HostID)
    
    if err != nil {
        http.Error(w, "Room not found", http.StatusNotFound)
        return
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(room)
}

func (h *RoomHandler) ListRooms(w http.ResponseWriter, r *http.Request) {
    userID := r.Header.Get("X-User-ID")

    rows, err := h.db.Query(
        `SELECT r.id, r.name, r.type, r.host_id, r.invite_link, r.created_at, r.status,
                (r.host_id = $1) AS is_host
         FROM rooms r
         JOIN participants p ON r.id = p.room_id
         WHERE r.status = 'active' AND p.user_id = $1 AND p.left_at IS NULL
         ORDER BY r.created_at DESC`,
        userID,
    )
    if err != nil {
        http.Error(w, "Database error", http.StatusInternalServerError)
        return
    }
    defer rows.Close()

    rooms := make([]models.Room, 0)
    for rows.Next() {
        var room models.Room
        if err := rows.Scan(&room.ID, &room.Name, &room.Type, &room.HostID, &room.InviteLink, &room.CreatedAt, &room.Status, &room.IsHost); err != nil {
            http.Error(w, "Database error", http.StatusInternalServerError)
            return
        }
        rooms = append(rooms, room)
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(rooms)
}

func (s *SQLRoomStore) IsUserActiveParticipant(roomID, userID string) (bool, error) {
	var exists bool
	err := s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM participants WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL)", roomID, userID).Scan(&exists)
	return exists, err
}

func (s *SQLRoomStore) ActiveParticipantCount(roomID string) (int, error) {
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM participants WHERE room_id = $1 AND left_at IS NULL", roomID).Scan(&count)
	return count, err
}

func (s *SQLRoomStore) AddParticipant(participant models.Participant) error {
	_, err := s.db.Exec(
		"INSERT INTO participants (id, room_id, user_id, role) VALUES ($1, $2, $3, $4)",
		participant.ID, participant.RoomID, participant.UserID, participant.Role,
	)
	return err
}

func (s *SQLRoomStore) LeaveRoom(roomID, userID string) error {
	_, err := s.db.Exec(
		"UPDATE participants SET left_at = NOW() WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL",
		roomID, userID,
	)
	return err
}

func (s *SQLRoomStore) ActiveParticipants(roomID string) ([]models.Participant, error) {
	rows, err := s.db.Query(
		"SELECT p.id, p.room_id, p.user_id, p.role, p.joined_at, p.left_at, u.email FROM participants p JOIN users u ON p.user_id = u.id WHERE p.room_id = $1 AND p.left_at IS NULL",
		roomID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	participants := make([]models.Participant, 0)
	for rows.Next() {
		var p models.Participant
		var leftAt sql.NullTime
		if err := rows.Scan(&p.ID, &p.RoomID, &p.UserID, &p.Role, &p.JoinedAt, &leftAt, &p.Username); err != nil {
			return nil, err
		}
		if leftAt.Valid {
			p.LeftAt = &leftAt.Time
		}
		participants = append(participants, p)
	}
	return participants, rows.Err()
}

func (s *SQLRoomStore) RoomIDByInvite(invite string) (string, error) {
	var roomID string
	err := s.db.QueryRow("SELECT id FROM rooms WHERE invite_link = $1 AND status = 'active'", invite).Scan(&roomID)
	return roomID, err
}

func (s *SQLRoomStore) HostID(roomID string) (string, error) {
	var hostID string
	err := s.db.QueryRow("SELECT host_id FROM rooms WHERE id = $1", roomID).Scan(&hostID)
	return hostID, err
}

func (s *SQLRoomStore) EndRoomAndLeaveParticipants(roomID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec("UPDATE rooms SET status = 'ended', ended_at = NOW() WHERE id = $1", roomID); err != nil {
		return err
	}
	if _, err = tx.Exec("UPDATE participants SET left_at = NOW() WHERE room_id = $1 AND left_at IS NULL", roomID); err != nil {
		return err
	}
	return tx.Commit()
}

type RoomHandler struct {
	rooms RoomStore
}

func NewRoomHandler(db *sql.DB) *RoomHandler {
	return NewRoomHandlerWithStore(NewSQLRoomStore(db))
}

func NewRoomHandlerWithStore(rooms RoomStore) *RoomHandler {
	return &RoomHandler{rooms: rooms}
}

func (h *RoomHandler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var req models.CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Bad Request")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "Room name required")
		return
	}
	if req.Type == "" {
		req.Type = "public"
	}
	if req.Type != "public" && req.Type != "private" {
		writeError(w, http.StatusBadRequest, "Invalid room type")
		return
	}

	room := models.Room{ID: uuid.New().String(), Name: req.Name, Type: req.Type, HostID: userID, InviteLink: uuid.New().String(), Status: "active"}
	if err := h.rooms.CreateRoomWithHost(room, uuid.New().String()); err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": room.ID, "invite_link": room.InviteLink})
}

func (h *RoomHandler) GetRoom(w http.ResponseWriter, r *http.Request) {
	room, err := h.rooms.FindRoomByID(r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Room not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}
	writeJSON(w, http.StatusOK, room)
}

func (h *RoomHandler) ListRooms(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	rooms, err := h.rooms.ListActiveRoomsForUser(userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}
	writeJSON(w, http.StatusOK, rooms)
}

func (h *RoomHandler) JoinRoom(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	roomID := r.PathValue("id")

	exists, err := h.rooms.ActiveRoomExists(roomID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "Room not found or already ended")
		return
	}

	alreadyJoined, err := h.rooms.IsUserActiveParticipant(roomID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if alreadyJoined {
		writeJSON(w, http.StatusOK, map[string]string{"status": "already_joined"})
		return
	}

	activeCount, err := h.rooms.ActiveParticipantCount(roomID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if activeCount >= 100 {
		writeError(w, http.StatusBadRequest, "Room is full")
		return
	}

	participant := models.Participant{ID: uuid.New().String(), RoomID: roomID, UserID: userID, Role: "participant"}
	if err := h.rooms.AddParticipant(participant); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to join room")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "joined"})
}

func (h *RoomHandler) LeaveRoom(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	if err := h.rooms.LeaveRoom(r.PathValue("id"), userID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to leave room")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "left"})
}

func (h *RoomHandler) GetParticipants(w http.ResponseWriter, r *http.Request) {
	participants, err := h.rooms.ActiveParticipants(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}
	writeJSON(w, http.StatusOK, participants)
}

func (h *RoomHandler) JoinByInvite(w http.ResponseWriter, r *http.Request) {
	invite := r.PathValue("invite")
	if invite == "" {
		writeError(w, http.StatusBadRequest, "Invite required")
		return
	}

	roomID, err := h.rooms.RoomIDByInvite(invite)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Invite not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}

	r.SetPathValue("id", roomID)
	h.JoinRoom(w, r)
}

func (h *RoomHandler) DeleteRoom(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	roomID := r.PathValue("id")

	hostID, err := h.rooms.HostID(roomID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Room not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}
	if hostID != userID {
		writeError(w, http.StatusForbidden, "Only host can delete room")
		return
	}

	if err := h.rooms.EndRoomAndLeaveParticipants(roomID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to delete room")
		return
	}
	_, _ = h.db.Exec("UPDATE participants SET left_at = NOW() WHERE room_id = $1 AND left_at IS NULL", roomID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}
