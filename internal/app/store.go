package app

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrConflict     = errors.New("conflict")
	ErrForbidden    = errors.New("forbidden")
	ErrBadRequest   = errors.New("bad request")
)

type Store struct {
	mu           sync.RWMutex
	dataFile     string
	users        map[string]User
	usersByEmail map[string]string
	sessions     map[string]Session
	rooms        map[string]Room
	invites      map[string]string
	participants map[string]map[string]Participant
	messages     map[string][]Message
}

func NewStore(dataFile string) *Store {
	store := &Store{
		dataFile:     dataFile,
		users:        map[string]User{},
		usersByEmail: map[string]string{},
		sessions:     map[string]Session{},
		rooms:        map[string]Room{},
		invites:      map[string]string{},
		participants: map[string]map[string]Participant{},
		messages:     map[string][]Message{},
	}
	_ = store.load()
	return store
}

func (s *Store) Register(name, email, password string) (User, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	email = strings.ToLower(strings.TrimSpace(email))
	if name == "" || email == "" || len(password) < 4 {
		return User{}, "", ErrBadRequest
	}
	if _, ok := s.usersByEmail[email]; ok {
		return User{}, "", ErrConflict
	}

	passwordHash, err := hashPassword(password)
	if err != nil {
		return User{}, "", err
	}
	user := User{ID: token(12), Name: name, Email: email, PasswordHash: passwordHash, CreatedAt: time.Now().UTC()}
	s.users[user.ID] = user
	s.usersByEmail[email] = user.ID
	session := s.createSessionLocked(user.ID)
	_ = s.saveLocked()
	return user, session.Token, nil
}

func (s *Store) Login(email, password string) (User, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id, ok := s.usersByEmail[strings.ToLower(strings.TrimSpace(email))]
	if !ok {
		return User{}, "", ErrUnauthorized
	}
	user := s.users[id]
	if !verifyPassword(password, user.PasswordHash) {
		return User{}, "", ErrUnauthorized
	}
	session := s.createSessionLocked(user.ID)
	_ = s.saveLocked()
	return user, session.Token, nil
}

func (s *Store) Logout(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
	_ = s.saveLocked()
}

func (s *Store) UserByToken(token string) (User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.sessions[token]
	if !ok || time.Now().UTC().After(session.ExpiresAt) {
		return User{}, ErrUnauthorized
	}
	user, ok := s.users[session.UserID]
	if !ok {
		return User{}, ErrUnauthorized
	}
	return user, nil
}

func (s *Store) CreateRoom(host User, name, description, visibility string) (Room, Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(name) == "" {
		return Room{}, Participant{}, ErrBadRequest
	}
	if visibility != "private" {
		visibility = "public"
	}
	room := Room{
		ID:          token(10),
		Name:        strings.TrimSpace(name),
		Description: strings.TrimSpace(description),
		Visibility:  visibility,
		HostID:      host.ID,
		InviteToken: token(16),
		Active:      true,
		CreatedAt:   time.Now().UTC(),
	}
	participant := Participant{
		RoomID: room.ID, UserID: host.ID, Name: host.Name, Role: "host",
		Muted: false, CameraOn: true, JoinedAt: room.CreatedAt, LastSeen: room.CreatedAt, Connected: true,
	}
	s.rooms[room.ID] = room
	s.invites[room.InviteToken] = room.ID
	s.participants[room.ID] = map[string]Participant{host.ID: participant}
	_ = s.saveLocked()
	return room, participant, nil
}

func (s *Store) PublicRooms() []PublicRoom {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rooms := make([]PublicRoom, 0, len(s.rooms))
	for _, room := range s.rooms {
		if room.Visibility == "public" && room.Active {
			rooms = append(rooms, PublicRoom{Room: room, Participants: len(s.participants[room.ID])})
		}
	}
	sort.Slice(rooms, func(i, j int) bool { return rooms[i].CreatedAt.After(rooms[j].CreatedAt) })
	return rooms
}

func (s *Store) Room(id string) (Room, []Participant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	room, ok := s.rooms[id]
	if !ok {
		return Room{}, nil, ErrNotFound
	}
	return room, s.participantsLocked(id), nil
}

func (s *Store) RoomForUser(id string, user User) (Room, []Participant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	room, ok := s.rooms[id]
	if !ok {
		return Room{}, nil, ErrNotFound
	}
	if room.Visibility == "private" {
		if _, ok := s.participants[id][user.ID]; !ok {
			return Room{}, nil, ErrForbidden
		}
	}
	return room, s.participantsLocked(id), nil
}

func (s *Store) RoomByInvite(invite string) (Room, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.invites[invite]
	if !ok {
		return Room{}, ErrNotFound
	}
	room, ok := s.rooms[id]
	if !ok {
		return Room{}, ErrNotFound
	}
	return room, nil
}

func (s *Store) JoinRoom(roomID string, user User) (Room, Participant, []Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.joinRoomLocked(roomID, user, false)
}

func (s *Store) JoinRoomByInvite(roomID string, user User) (Room, Participant, []Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.joinRoomLocked(roomID, user, true)
}

func (s *Store) joinRoomLocked(roomID string, user User, viaInvite bool) (Room, Participant, []Participant, error) {
	room, ok := s.rooms[roomID]
	if !ok || !room.Active {
		return Room{}, Participant{}, nil, ErrNotFound
	}
	if s.participants[roomID] == nil {
		s.participants[roomID] = map[string]Participant{}
	}
	now := time.Now().UTC()
	p, ok := s.participants[roomID][user.ID]
	if !ok {
		if room.Visibility == "private" && !viaInvite {
			return Room{}, Participant{}, nil, ErrForbidden
		}
		if len(s.participants[roomID]) >= 15 {
			return Room{}, Participant{}, nil, ErrConflict
		}
		p = Participant{RoomID: roomID, UserID: user.ID, Name: user.Name, Role: "participant", JoinedAt: now}
	}
	p.LastSeen = now
	p.Connected = true
	s.participants[roomID][user.ID] = p
	_ = s.saveLocked()
	return room, p, s.participantsLocked(roomID), nil
}

func (s *Store) LeaveRoom(roomID string, user User) (Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.participants[roomID][user.ID]
	if !ok {
		return Participant{}, ErrNotFound
	}
	p.Connected = false
	p.LastSeen = time.Now().UTC()
	s.participants[roomID][user.ID] = p
	_ = s.saveLocked()
	return p, nil
}

func (s *Store) SetDevice(roomID string, user User, muted, cameraOn bool) (Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.participants[roomID][user.ID]
	if !ok {
		return Participant{}, ErrNotFound
	}
	p.Muted = muted
	p.CameraOn = cameraOn
	p.LastSeen = time.Now().UTC()
	s.participants[roomID][user.ID] = p
	_ = s.saveLocked()
	return p, nil
}

func (s *Store) MuteParticipant(roomID, targetID string, actor User) (Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.isHostLocked(roomID, actor.ID) {
		return Participant{}, ErrForbidden
	}
	p, ok := s.participants[roomID][targetID]
	if !ok {
		return Participant{}, ErrNotFound
	}
	p.Muted = true
	p.LastSeen = time.Now().UTC()
	s.participants[roomID][targetID] = p
	_ = s.saveLocked()
	return p, nil
}

func (s *Store) KickParticipant(roomID, targetID string, actor User) (Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.isHostLocked(roomID, actor.ID) {
		return Participant{}, ErrForbidden
	}
	p, ok := s.participants[roomID][targetID]
	if !ok {
		return Participant{}, ErrNotFound
	}
	delete(s.participants[roomID], targetID)
	_ = s.saveLocked()
	return p, nil
}

func (s *Store) EndRoom(roomID string, actor User) (Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.isHostLocked(roomID, actor.ID) {
		return Room{}, ErrForbidden
	}
	room, ok := s.rooms[roomID]
	if !ok {
		return Room{}, ErrNotFound
	}
	room.Active = false
	room.EndedAt = time.Now().UTC()
	s.rooms[roomID] = room
	_ = s.saveLocked()
	return room, nil
}

func (s *Store) AddMessage(roomID string, user User, text string) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(text) == "" {
		return Message{}, ErrBadRequest
	}
	room, ok := s.rooms[roomID]
	if !ok {
		return Message{}, ErrNotFound
	}
	if !room.Active {
		return Message{}, ErrNotFound
	}
	if _, ok := s.participants[roomID][user.ID]; !ok {
		return Message{}, ErrForbidden
	}
	msg := Message{ID: token(10), RoomID: roomID, UserID: user.ID, UserName: user.Name, Text: strings.TrimSpace(text), CreatedAt: time.Now().UTC()}
	s.messages[roomID] = append(s.messages[roomID], msg)
	if len(s.messages[roomID]) > 200 {
		s.messages[roomID] = s.messages[roomID][len(s.messages[roomID])-200:]
	}
	_ = s.saveLocked()
	return msg, nil
}

func (s *Store) Messages(roomID string) ([]Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.rooms[roomID]; !ok {
		return nil, ErrNotFound
	}
	if s.messages[roomID] == nil {
		return []Message{}, nil
	}
	out := append([]Message(nil), s.messages[roomID]...)
	return out, nil
}

func (s *Store) MessagesForUser(roomID string, user User) ([]Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.rooms[roomID]; !ok {
		return nil, ErrNotFound
	}
	if _, ok := s.participants[roomID][user.ID]; !ok {
		return nil, ErrForbidden
	}
	if s.messages[roomID] == nil {
		return []Message{}, nil
	}
	return append([]Message(nil), s.messages[roomID]...), nil
}

func (s *Store) IsParticipant(roomID, userID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.participants[roomID][userID]
	return ok
}

func (s *Store) createSessionLocked(userID string) Session {
	session := Session{Token: token(32), UserID: userID, ExpiresAt: time.Now().UTC().Add(24 * time.Hour)}
	s.sessions[session.Token] = session
	return session
}

func (s *Store) participantsLocked(roomID string) []Participant {
	out := make([]Participant, 0, len(s.participants[roomID]))
	for _, p := range s.participants[roomID] {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Role != out[j].Role {
			return out[i].Role == "host"
		}
		return out[i].JoinedAt.Before(out[j].JoinedAt)
	})
	return out
}

func (s *Store) isHostLocked(roomID, userID string) bool {
	p, ok := s.participants[roomID][userID]
	return ok && p.Role == "host"
}

func token(bytes int) string {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

type storeSnapshot struct {
	Users        []persistedUser          `json:"users"`
	Sessions     []Session                `json:"sessions"`
	Rooms        []Room                   `json:"rooms"`
	Participants map[string][]Participant `json:"participants"`
	Messages     map[string][]Message     `json:"messages"`
	SavedAt      time.Time                `json:"savedAt"`
}

type persistedUser struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"passwordHash"`
	CreatedAt    time.Time `json:"createdAt"`
}

func (s *Store) load() error {
	if s.dataFile == "" {
		return nil
	}
	payload, err := os.ReadFile(s.dataFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var snapshot storeSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, persisted := range snapshot.Users {
		user := User{
			ID:           persisted.ID,
			Name:         persisted.Name,
			Email:        strings.ToLower(persisted.Email),
			PasswordHash: persisted.PasswordHash,
			CreatedAt:    persisted.CreatedAt,
		}
		s.users[user.ID] = user
		s.usersByEmail[user.Email] = user.ID
	}
	for _, session := range snapshot.Sessions {
		if now.Before(session.ExpiresAt) {
			s.sessions[session.Token] = session
		}
	}
	for _, room := range snapshot.Rooms {
		s.rooms[room.ID] = room
		s.invites[room.InviteToken] = room.ID
	}
	for roomID, participants := range snapshot.Participants {
		s.participants[roomID] = map[string]Participant{}
		for _, participant := range participants {
			participant.Connected = false
			s.participants[roomID][participant.UserID] = participant
		}
	}
	for roomID, messages := range snapshot.Messages {
		s.messages[roomID] = append([]Message(nil), messages...)
	}
	return nil
}

func (s *Store) saveLocked() error {
	if s.dataFile == "" {
		return nil
	}
	snapshot := storeSnapshot{
		Users:        make([]persistedUser, 0, len(s.users)),
		Sessions:     make([]Session, 0, len(s.sessions)),
		Rooms:        make([]Room, 0, len(s.rooms)),
		Participants: map[string][]Participant{},
		Messages:     map[string][]Message{},
		SavedAt:      time.Now().UTC(),
	}
	for _, user := range s.users {
		snapshot.Users = append(snapshot.Users, persistedUser{
			ID:           user.ID,
			Name:         user.Name,
			Email:        user.Email,
			PasswordHash: user.PasswordHash,
			CreatedAt:    user.CreatedAt,
		})
	}
	for _, session := range s.sessions {
		if time.Now().UTC().Before(session.ExpiresAt) {
			snapshot.Sessions = append(snapshot.Sessions, session)
		}
	}
	for _, room := range s.rooms {
		snapshot.Rooms = append(snapshot.Rooms, room)
	}
	for roomID, participants := range s.participants {
		for _, participant := range participants {
			snapshot.Participants[roomID] = append(snapshot.Participants[roomID], participant)
		}
	}
	for roomID, messages := range s.messages {
		snapshot.Messages[roomID] = append([]Message(nil), messages...)
	}
	sort.Slice(snapshot.Users, func(i, j int) bool { return snapshot.Users[i].CreatedAt.Before(snapshot.Users[j].CreatedAt) })
	sort.Slice(snapshot.Rooms, func(i, j int) bool { return snapshot.Rooms[i].CreatedAt.Before(snapshot.Rooms[j].CreatedAt) })

	payload, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.dataFile), 0o755); err != nil {
		return err
	}
	tmp := s.dataFile + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.dataFile)
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	iterations := 120000
	sum := pbkdf2SHA256([]byte(password), salt, iterations, 32)
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", iterations, b64(salt), b64(sum)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations <= 0 {
		return false
	}
	salt, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	actual := pbkdf2SHA256([]byte(password), salt, iterations, len(expected))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func pbkdf2SHA256(password, salt []byte, iterations, keyLen int) []byte {
	var result []byte
	block := 1
	for len(result) < keyLen {
		mac := hmac.New(sha256.New, password)
		_, _ = mac.Write(salt)
		_, _ = mac.Write([]byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)})
		u := mac.Sum(nil)
		t := append([]byte(nil), u...)
		for i := 1; i < iterations; i++ {
			mac = hmac.New(sha256.New, password)
			_, _ = mac.Write(u)
			u = mac.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		result = append(result, t...)
		block++
	}
	return result[:keyLen]
}
