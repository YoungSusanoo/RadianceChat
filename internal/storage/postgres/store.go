package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/lib/pq"

	"radiance/internal/app"
	"radiance/internal/security"
)

type Store struct {
	db *sql.DB
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, err
	}
	if err := waitForDB(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *Store) Register(name, email, password string) (app.User, string, error) {
	name = strings.TrimSpace(name)
	email = strings.ToLower(strings.TrimSpace(email))
	if name == "" || email == "" || len(password) < 4 {
		return app.User{}, "", app.ErrBadRequest
	}
	passwordHash, err := security.HashPassword(password)
	if err != nil {
		return app.User{}, "", err
	}
	now := time.Now().UTC()
	user := app.User{ID: security.Token(12), Name: name, Email: email, PasswordHash: passwordHash, CreatedAt: now}
	session := app.Session{Token: security.Token(32), UserID: user.ID, ExpiresAt: now.Add(24 * time.Hour)}

	tx, err := s.db.Begin()
	if err != nil {
		return app.User{}, "", err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		"INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
		user.ID, user.Name, user.Email, user.PasswordHash, user.CreatedAt,
	); err != nil {
		if isUniqueViolation(err) {
			return app.User{}, "", app.ErrConflict
		}
		return app.User{}, "", err
	}
	if _, err := tx.Exec(
		"INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
		session.Token, session.UserID, session.ExpiresAt,
	); err != nil {
		return app.User{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return app.User{}, "", err
	}
	return user, session.Token, nil
}

func (s *Store) Login(email, password string) (app.User, string, error) {
	user, err := s.userByEmail(strings.ToLower(strings.TrimSpace(email)))
	if err != nil {
		return app.User{}, "", app.ErrUnauthorized
	}
	if !security.VerifyPassword(password, user.PasswordHash) {
		return app.User{}, "", app.ErrUnauthorized
	}
	session := app.Session{Token: security.Token(32), UserID: user.ID, ExpiresAt: time.Now().UTC().Add(24 * time.Hour)}
	if _, err := s.db.Exec(
		"INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
		session.Token, session.UserID, session.ExpiresAt,
	); err != nil {
		return app.User{}, "", err
	}
	return user, session.Token, nil
}

func (s *Store) Logout(token string) {
	_, _ = s.db.Exec("DELETE FROM sessions WHERE token = $1", token)
}

func (s *Store) UserByToken(token string) (app.User, error) {
	var user app.User
	err := s.db.QueryRow(`
		SELECT u.id, u.name, u.email, u.password_hash, u.created_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token = $1 AND s.expires_at > now()
	`, token).Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return app.User{}, app.ErrUnauthorized
	}
	return user, err
}

func (s *Store) PublicRooms() []app.PublicRoom {
	rows, err := s.db.Query(`
		SELECT r.id, r.name, r.description, r.visibility, r.host_id, r.invite_token, r.active, r.created_at, r.ended_at, COUNT(rp.user_id)
		FROM rooms r
		LEFT JOIN room_participants rp ON rp.room_id = r.id
		WHERE r.visibility = 'public' AND r.active = true
		GROUP BY r.id
		ORDER BY r.created_at DESC
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var rooms []app.PublicRoom
	for rows.Next() {
		room, count, err := scanPublicRoom(rows)
		if err != nil {
			return rooms
		}
		rooms = append(rooms, app.PublicRoom{Room: room, Participants: count})
	}
	return rooms
}

func (s *Store) CreateRoom(host app.User, name, description, visibility string) (app.Room, app.Participant, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return app.Room{}, app.Participant{}, app.ErrBadRequest
	}
	if visibility != "private" {
		visibility = "public"
	}
	now := time.Now().UTC()
	room := app.Room{ID: security.Token(10), Name: name, Description: strings.TrimSpace(description), Visibility: visibility, HostID: host.ID, InviteToken: security.Token(16), Active: true, CreatedAt: now}
	participant := app.Participant{RoomID: room.ID, UserID: host.ID, Name: host.Name, Role: "host", Muted: true, CameraOn: false, JoinedAt: now, LastSeen: now, Connected: true}

	tx, err := s.db.Begin()
	if err != nil {
		return app.Room{}, app.Participant{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		"INSERT INTO rooms (id, name, description, visibility, host_id, invite_token, active, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
		room.ID, room.Name, room.Description, room.Visibility, room.HostID, room.InviteToken, room.Active, room.CreatedAt,
	); err != nil {
		return app.Room{}, app.Participant{}, err
	}
	if _, err := tx.Exec(
		"INSERT INTO room_participants (room_id, user_id, role, muted, camera_on, joined_at, last_seen, connected) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
		participant.RoomID, participant.UserID, participant.Role, participant.Muted, participant.CameraOn, participant.JoinedAt, participant.LastSeen, participant.Connected,
	); err != nil {
		return app.Room{}, app.Participant{}, err
	}
	if err := tx.Commit(); err != nil {
		return app.Room{}, app.Participant{}, err
	}
	return room, participant, nil
}

func (s *Store) Room(id string) (app.Room, []app.Participant, error) {
	room, err := s.roomOnly(id)
	if err != nil {
		return app.Room{}, nil, err
	}
	participants, err := s.participants(id)
	return room, participants, err
}

func (s *Store) RoomForUser(id string, user app.User) (app.Room, []app.Participant, error) {
	room, participants, err := s.Room(id)
	if err != nil {
		return app.Room{}, nil, err
	}
	if room.Visibility == "private" && !hasParticipant(participants, user.ID) {
		return app.Room{}, nil, app.ErrForbidden
	}
	return room, participants, nil
}

func (s *Store) RoomByInvite(invite string) (app.Room, error) {
	var id string
	err := s.db.QueryRow("SELECT id FROM rooms WHERE invite_token = $1", invite).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return app.Room{}, app.ErrNotFound
	}
	if err != nil {
		return app.Room{}, err
	}
	return s.roomOnly(id)
}

func (s *Store) JoinRoom(roomID string, user app.User) (app.Room, app.Participant, []app.Participant, error) {
	return s.joinRoom(roomID, user, false)
}

func (s *Store) JoinRoomByInvite(roomID string, user app.User) (app.Room, app.Participant, []app.Participant, error) {
	return s.joinRoom(roomID, user, true)
}

func (s *Store) joinRoom(roomID string, user app.User, viaInvite bool) (app.Room, app.Participant, []app.Participant, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	defer tx.Rollback()
	room, err := roomOnlyForUpdateTx(tx, roomID)
	if err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	if !room.Active {
		return app.Room{}, app.Participant{}, nil, app.ErrNotFound
	}
	exists, err := participantExistsTx(tx, roomID, user.ID)
	if err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	if !exists {
		if room.Visibility == "private" && !viaInvite {
			return app.Room{}, app.Participant{}, nil, app.ErrForbidden
		}
		count, err := participantCountTx(tx, roomID)
		if err != nil {
			return app.Room{}, app.Participant{}, nil, err
		}
		if count >= 15 {
			return app.Room{}, app.Participant{}, nil, app.ErrConflict
		}
	}
	role := "participant"
	if exists {
		if err := tx.QueryRow("SELECT role FROM room_participants WHERE room_id = $1 AND user_id = $2", roomID, user.ID).Scan(&role); err != nil {
			return app.Room{}, app.Participant{}, nil, err
		}
	}
	now := time.Now().UTC()
	if _, err := tx.Exec(`
		INSERT INTO room_participants (room_id, user_id, role, muted, camera_on, joined_at, last_seen, connected)
		VALUES ($1, $2, $3, true, false, $4, $4, true)
		ON CONFLICT (room_id, user_id)
		DO UPDATE SET last_seen = EXCLUDED.last_seen, connected = true
	`, roomID, user.ID, role, now); err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	participant, err := participantTx(tx, roomID, user.ID)
	if err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	participants, err := participantsTx(tx, roomID)
	if err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	if err := tx.Commit(); err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	return room, participant, participants, nil
}

func (s *Store) LeaveRoom(roomID string, user app.User) (app.Room, app.Participant, []app.Participant, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	defer tx.Rollback()
	room, err := roomOnlyTx(tx, roomID)
	if err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	participant, err := participantTx(tx, roomID, user.ID)
	if err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	if _, err := tx.Exec("DELETE FROM room_participants WHERE room_id = $1 AND user_id = $2", roomID, user.ID); err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	participant.Connected = false
	participant.LastSeen = time.Now().UTC()
	if participant.Role == "host" {
		room, err = transferHostTx(tx, roomID, room)
		if err != nil {
			return app.Room{}, app.Participant{}, nil, err
		}
	}
	participants, err := participantsTx(tx, roomID)
	if err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	if err := tx.Commit(); err != nil {
		return app.Room{}, app.Participant{}, nil, err
	}
	return room, participant, participants, nil
}

func (s *Store) EndRoom(roomID string, actor app.User) (app.Room, error) {
	if !s.isHost(roomID, actor.ID) {
		return app.Room{}, app.ErrForbidden
	}
	var room app.Room
	var endedAt sql.NullTime
	err := s.db.QueryRow(`
		UPDATE rooms SET active = false, ended_at = $1 WHERE id = $2
		RETURNING id, name, description, visibility, host_id, invite_token, active, created_at, ended_at
	`, time.Now().UTC(), roomID).Scan(&room.ID, &room.Name, &room.Description, &room.Visibility, &room.HostID, &room.InviteToken, &room.Active, &room.CreatedAt, &endedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return app.Room{}, app.ErrNotFound
	}
	if endedAt.Valid {
		room.EndedAt = endedAt.Time
	}
	return room, err
}

func (s *Store) SetDevice(roomID string, user app.User, muted, cameraOn bool) (app.Participant, error) {
	result, err := s.db.Exec("UPDATE room_participants SET muted = $1, camera_on = $2, last_seen = $3 WHERE room_id = $4 AND user_id = $5", muted, cameraOn, time.Now().UTC(), roomID, user.ID)
	if err != nil {
		return app.Participant{}, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return app.Participant{}, app.ErrNotFound
	}
	return s.participant(roomID, user.ID)
}

func (s *Store) MuteParticipant(roomID, targetID string, actor app.User) (app.Participant, error) {
	if !s.isHost(roomID, actor.ID) {
		return app.Participant{}, app.ErrForbidden
	}
	result, err := s.db.Exec("UPDATE room_participants SET muted = true, last_seen = $1 WHERE room_id = $2 AND user_id = $3", time.Now().UTC(), roomID, targetID)
	if err != nil {
		return app.Participant{}, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return app.Participant{}, app.ErrNotFound
	}
	return s.participant(roomID, targetID)
}

func (s *Store) KickParticipant(roomID, targetID string, actor app.User) (app.Participant, error) {
	if !s.isHost(roomID, actor.ID) {
		return app.Participant{}, app.ErrForbidden
	}
	if actor.ID == targetID {
		return app.Participant{}, app.ErrBadRequest
	}
	participant, err := s.participant(roomID, targetID)
	if err != nil {
		return app.Participant{}, err
	}
	if _, err := s.db.Exec("DELETE FROM room_participants WHERE room_id = $1 AND user_id = $2", roomID, targetID); err != nil {
		return app.Participant{}, err
	}
	return participant, nil
}

func (s *Store) IsParticipant(roomID, userID string) bool {
	var ok bool
	err := s.db.QueryRow("SELECT EXISTS (SELECT 1 FROM room_participants WHERE room_id = $1 AND user_id = $2)", roomID, userID).Scan(&ok)
	return err == nil && ok
}

func (s *Store) AddMessage(roomID string, user app.User, text string) (app.Message, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return app.Message{}, app.ErrBadRequest
	}
	room, err := s.roomOnly(roomID)
	if err != nil {
		return app.Message{}, err
	}
	if !room.Active {
		return app.Message{}, app.ErrNotFound
	}
	if !s.IsParticipant(roomID, user.ID) {
		return app.Message{}, app.ErrForbidden
	}
	msg := app.Message{ID: security.Token(10), RoomID: roomID, UserID: user.ID, UserName: user.Name, Text: text, CreatedAt: time.Now().UTC()}
	if _, err := s.db.Exec("INSERT INTO messages (id, room_id, user_id, text, created_at) VALUES ($1, $2, $3, $4, $5)", msg.ID, msg.RoomID, msg.UserID, msg.Text, msg.CreatedAt); err != nil {
		return app.Message{}, err
	}
	return msg, nil
}

func (s *Store) Messages(roomID string) ([]app.Message, error) {
	if _, err := s.roomOnly(roomID); err != nil {
		return nil, err
	}
	return s.messages(roomID)
}

func (s *Store) MessagesForUser(roomID string, user app.User) ([]app.Message, error) {
	if _, err := s.roomOnly(roomID); err != nil {
		return nil, err
	}
	if !s.IsParticipant(roomID, user.ID) {
		return nil, app.ErrForbidden
	}
	return s.messages(roomID)
}

func (s *Store) userByEmail(email string) (app.User, error) {
	var user app.User
	err := s.db.QueryRow("SELECT id, name, email, password_hash, created_at FROM users WHERE email = $1", email).
		Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return app.User{}, app.ErrNotFound
	}
	return user, err
}

func (s *Store) roomOnly(id string) (app.Room, error) {
	return roomOnlyQuery(s.db.QueryRow("SELECT id, name, description, visibility, host_id, invite_token, active, created_at, ended_at FROM rooms WHERE id = $1", id))
}

func (s *Store) participant(roomID, userID string) (app.Participant, error) {
	return participantQuery(s.db.QueryRow(`
		SELECT rp.room_id, rp.user_id, u.name, rp.role, rp.muted, rp.camera_on, rp.joined_at, rp.last_seen, rp.connected
		FROM room_participants rp
		JOIN users u ON u.id = rp.user_id
		WHERE rp.room_id = $1 AND rp.user_id = $2
	`, roomID, userID))
}

func (s *Store) participants(roomID string) ([]app.Participant, error) {
	rows, err := s.db.Query(`
		SELECT rp.room_id, rp.user_id, u.name, rp.role, rp.muted, rp.camera_on, rp.joined_at, rp.last_seen, rp.connected
		FROM room_participants rp
		JOIN users u ON u.id = rp.user_id
		WHERE rp.room_id = $1
		ORDER BY CASE WHEN rp.role = 'host' THEN 0 ELSE 1 END, rp.joined_at ASC
	`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanParticipants(rows)
}

func (s *Store) isHost(roomID, userID string) bool {
	var ok bool
	err := s.db.QueryRow("SELECT EXISTS (SELECT 1 FROM room_participants WHERE room_id = $1 AND user_id = $2 AND role = 'host')", roomID, userID).Scan(&ok)
	return err == nil && ok
}

func (s *Store) messages(roomID string) ([]app.Message, error) {
	rows, err := s.db.Query(`
		SELECT m.id, m.room_id, m.user_id, u.name, m.text, m.created_at
		FROM messages m
		JOIN users u ON u.id = m.user_id
		WHERE m.room_id = $1
		ORDER BY m.created_at ASC
	`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var messages []app.Message
	for rows.Next() {
		var msg app.Message
		if err := rows.Scan(&msg.ID, &msg.RoomID, &msg.UserID, &msg.UserName, &msg.Text, &msg.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}
	if messages == nil {
		return []app.Message{}, nil
	}
	return messages, rows.Err()
}

func roomOnlyTx(tx *sql.Tx, id string) (app.Room, error) {
	return roomOnlyQuery(tx.QueryRow("SELECT id, name, description, visibility, host_id, invite_token, active, created_at, ended_at FROM rooms WHERE id = $1", id))
}

func roomOnlyForUpdateTx(tx *sql.Tx, id string) (app.Room, error) {
	return roomOnlyQuery(tx.QueryRow("SELECT id, name, description, visibility, host_id, invite_token, active, created_at, ended_at FROM rooms WHERE id = $1 FOR UPDATE", id))
}

func participantTx(tx *sql.Tx, roomID, userID string) (app.Participant, error) {
	return participantQuery(tx.QueryRow(`
		SELECT rp.room_id, rp.user_id, u.name, rp.role, rp.muted, rp.camera_on, rp.joined_at, rp.last_seen, rp.connected
		FROM room_participants rp
		JOIN users u ON u.id = rp.user_id
		WHERE rp.room_id = $1 AND rp.user_id = $2
	`, roomID, userID))
}

func participantsTx(tx *sql.Tx, roomID string) ([]app.Participant, error) {
	rows, err := tx.Query(`
		SELECT rp.room_id, rp.user_id, u.name, rp.role, rp.muted, rp.camera_on, rp.joined_at, rp.last_seen, rp.connected
		FROM room_participants rp
		JOIN users u ON u.id = rp.user_id
		WHERE rp.room_id = $1
		ORDER BY CASE WHEN rp.role = 'host' THEN 0 ELSE 1 END, rp.joined_at ASC
	`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanParticipants(rows)
}

func transferHostTx(tx *sql.Tx, roomID string, room app.Room) (app.Room, error) {
	var nextHostID string
	err := tx.QueryRow("SELECT user_id FROM room_participants WHERE room_id = $1 ORDER BY joined_at ASC LIMIT 1", roomID).Scan(&nextHostID)
	if errors.Is(err, sql.ErrNoRows) {
		room.Active = false
		room.EndedAt = time.Now().UTC()
		_, err := tx.Exec("UPDATE rooms SET active = false, ended_at = $1 WHERE id = $2", room.EndedAt, roomID)
		return room, err
	}
	if err != nil {
		return app.Room{}, err
	}
	if _, err := tx.Exec("UPDATE room_participants SET role = CASE WHEN user_id = $1 THEN 'host' ELSE 'participant' END WHERE room_id = $2", nextHostID, roomID); err != nil {
		return app.Room{}, err
	}
	if _, err := tx.Exec("UPDATE rooms SET host_id = $1 WHERE id = $2", nextHostID, roomID); err != nil {
		return app.Room{}, err
	}
	room.HostID = nextHostID
	return room, nil
}

func participantExistsTx(tx *sql.Tx, roomID, userID string) (bool, error) {
	var exists bool
	err := tx.QueryRow("SELECT EXISTS (SELECT 1 FROM room_participants WHERE room_id = $1 AND user_id = $2)", roomID, userID).Scan(&exists)
	return exists, err
}

func participantCountTx(tx *sql.Tx, roomID string) (int, error) {
	var count int
	err := tx.QueryRow("SELECT COUNT(*) FROM room_participants WHERE room_id = $1", roomID).Scan(&count)
	return count, err
}

type rowScanner interface {
	Scan(dest ...interface{}) error
}

func roomOnlyQuery(row rowScanner) (app.Room, error) {
	var room app.Room
	var endedAt sql.NullTime
	err := row.Scan(&room.ID, &room.Name, &room.Description, &room.Visibility, &room.HostID, &room.InviteToken, &room.Active, &room.CreatedAt, &endedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return app.Room{}, app.ErrNotFound
	}
	if endedAt.Valid {
		room.EndedAt = endedAt.Time
	}
	return room, err
}

func participantQuery(row rowScanner) (app.Participant, error) {
	var participant app.Participant
	err := row.Scan(&participant.RoomID, &participant.UserID, &participant.Name, &participant.Role, &participant.Muted, &participant.CameraOn, &participant.JoinedAt, &participant.LastSeen, &participant.Connected)
	if errors.Is(err, sql.ErrNoRows) {
		return app.Participant{}, app.ErrNotFound
	}
	return participant, err
}

func scanParticipants(rows *sql.Rows) ([]app.Participant, error) {
	var participants []app.Participant
	for rows.Next() {
		var participant app.Participant
		if err := rows.Scan(&participant.RoomID, &participant.UserID, &participant.Name, &participant.Role, &participant.Muted, &participant.CameraOn, &participant.JoinedAt, &participant.LastSeen, &participant.Connected); err != nil {
			return nil, err
		}
		participants = append(participants, participant)
	}
	if participants == nil {
		return []app.Participant{}, nil
	}
	return participants, rows.Err()
}

func scanPublicRoom(row rowScanner) (app.Room, int, error) {
	var room app.Room
	var endedAt sql.NullTime
	var count int
	err := row.Scan(&room.ID, &room.Name, &room.Description, &room.Visibility, &room.HostID, &room.InviteToken, &room.Active, &room.CreatedAt, &endedAt, &count)
	if endedAt.Valid {
		room.EndedAt = endedAt.Time
	}
	return room, count, err
}

func hasParticipant(participants []app.Participant, userID string) bool {
	for _, participant := range participants {
		if participant.UserID == userID {
			return true
		}
	}
	return false
}

func isUniqueViolation(err error) bool {
	var pgErr *pq.Error
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
