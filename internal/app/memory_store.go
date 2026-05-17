package app

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"radiance/internal/security"
)

type MemoryStore struct {
	mu           sync.RWMutex
	users        map[string]User
	usersByEmail map[string]string
	sessions     map[string]Session
	rooms        map[string]Room
	invites      map[string]string
	participants map[string]map[string]Participant
	messages     map[string][]Message
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		users:        map[string]User{},
		usersByEmail: map[string]string{},
		sessions:     map[string]Session{},
		rooms:        map[string]Room{},
		invites:      map[string]string{},
		participants: map[string]map[string]Participant{},
		messages:     map[string][]Message{},
	}
}

func (s *MemoryStore) Ping(ctx context.Context) error {
	return ctx.Err()
}

func (s *MemoryStore) Register(name, email, password string) (User, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	name = strings.TrimSpace(name)
	email = strings.ToLower(strings.TrimSpace(email))
	if name == "" || email == "" || len(password) < 4 {
		return User{}, "", ErrBadRequest
	}
	if _, ok := s.usersByEmail[email]; ok {
		return User{}, "", ErrConflict
	}

	passwordHash, err := security.HashPassword(password)
	if err != nil {
		return User{}, "", err
	}
	user := User{ID: security.Token(12), Name: name, Email: email, PasswordHash: passwordHash, CreatedAt: time.Now().UTC()}
	session := newMemorySession(user.ID)
	s.users[user.ID] = user
	s.usersByEmail[email] = user.ID
	s.sessions[session.Token] = session
	return user, session.Token, nil
}

func (s *MemoryStore) Login(email, password string) (User, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id, ok := s.usersByEmail[strings.ToLower(strings.TrimSpace(email))]
	if !ok {
		return User{}, "", ErrUnauthorized
	}
	user := s.users[id]
	if !security.VerifyPassword(password, user.PasswordHash) {
		return User{}, "", ErrUnauthorized
	}
	session := newMemorySession(user.ID)
	s.sessions[session.Token] = session
	return user, session.Token, nil
}

func (s *MemoryStore) Logout(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
}

func (s *MemoryStore) UserByToken(token string) (User, error) {
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

func (s *MemoryStore) PublicRooms() []PublicRoom {
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

func (s *MemoryStore) CreateRoom(host User, name, description, visibility string) (Room, Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(name) == "" {
		return Room{}, Participant{}, ErrBadRequest
	}
	if visibility != "private" {
		visibility = "public"
	}
	now := time.Now().UTC()
	room := Room{
		ID:          security.Token(10),
		Name:        strings.TrimSpace(name),
		Description: strings.TrimSpace(description),
		Visibility:  visibility,
		HostID:      host.ID,
		InviteToken: security.Token(16),
		Active:      true,
		CreatedAt:   now,
	}
	participant := Participant{
		RoomID: room.ID, UserID: host.ID, Name: host.Name, Role: "host",
		Muted: false, CameraOn: false, JoinedAt: now, LastSeen: now, Connected: true,
	}
	s.rooms[room.ID] = room
	s.invites[room.InviteToken] = room.ID
	s.participants[room.ID] = map[string]Participant{host.ID: participant}
	return room, participant, nil
}

func (s *MemoryStore) Room(id string) (Room, []Participant, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	room, ok := s.rooms[id]
	if !ok {
		return Room{}, nil, ErrNotFound
	}
	return room, s.participantsLocked(id), nil
}

func (s *MemoryStore) RoomForUser(id string, user User) (Room, []Participant, error) {
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

func (s *MemoryStore) RoomByInvite(invite string) (Room, error) {
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

func (s *MemoryStore) JoinRoom(roomID string, user User) (Room, Participant, []Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.joinRoomLocked(roomID, user, false)
}

func (s *MemoryStore) JoinRoomByInvite(roomID string, user User) (Room, Participant, []Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.joinRoomLocked(roomID, user, true)
}

func (s *MemoryStore) joinRoomLocked(roomID string, user User, viaInvite bool) (Room, Participant, []Participant, error) {
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
		p = Participant{RoomID: roomID, UserID: user.ID, Name: user.Name, Role: "participant", Muted: true, CameraOn: false, JoinedAt: now}
	}
	p.LastSeen = now
	p.Connected = true
	s.participants[roomID][user.ID] = p
	return room, p, s.participantsLocked(roomID), nil
}

func (s *MemoryStore) LeaveRoom(roomID string, user User) (Room, Participant, []Participant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	room, ok := s.rooms[roomID]
	if !ok {
		return Room{}, Participant{}, nil, ErrNotFound
	}
	p, ok := s.participants[roomID][user.ID]
	if !ok {
		return Room{}, Participant{}, nil, ErrNotFound
	}
	p.Connected = false
	p.LastSeen = time.Now().UTC()
	delete(s.participants[roomID], user.ID)
	if p.Role == "host" {
		room = s.transferHostLocked(roomID, room)
	}
	return room, p, s.participantsLocked(roomID), nil
}

func (s *MemoryStore) EndRoom(roomID string, actor User) (Room, error) {
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
	return room, nil
}

func (s *MemoryStore) SetDevice(roomID string, user User, muted, cameraOn bool) (Participant, error) {
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
	return p, nil
}

func (s *MemoryStore) MuteParticipant(roomID, targetID string, actor User) (Participant, error) {
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
	return p, nil
}

func (s *MemoryStore) KickParticipant(roomID, targetID string, actor User) (Participant, error) {
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
	return p, nil
}

func (s *MemoryStore) IsParticipant(roomID, userID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.participants[roomID][userID]
	return ok
}

func (s *MemoryStore) AddMessage(roomID string, user User, text string) (Message, error) {
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
	msg := Message{ID: security.Token(10), RoomID: roomID, UserID: user.ID, UserName: user.Name, Text: strings.TrimSpace(text), CreatedAt: time.Now().UTC()}
	s.messages[roomID] = append(s.messages[roomID], msg)
	if len(s.messages[roomID]) > 200 {
		s.messages[roomID] = s.messages[roomID][len(s.messages[roomID])-200:]
	}
	return msg, nil
}

func (s *MemoryStore) Messages(roomID string) ([]Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.rooms[roomID]; !ok {
		return nil, ErrNotFound
	}
	if s.messages[roomID] == nil {
		return []Message{}, nil
	}
	return append([]Message(nil), s.messages[roomID]...), nil
}

func (s *MemoryStore) MessagesForUser(roomID string, user User) ([]Message, error) {
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

func (s *MemoryStore) participantsLocked(roomID string) []Participant {
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

func (s *MemoryStore) isHostLocked(roomID, userID string) bool {
	p, ok := s.participants[roomID][userID]
	return ok && p.Role == "host"
}

func (s *MemoryStore) transferHostLocked(roomID string, room Room) Room {
	nextHostID := ""
	var nextJoinedAt time.Time
	for userID, participant := range s.participants[roomID] {
		if nextHostID == "" || participant.JoinedAt.Before(nextJoinedAt) {
			nextHostID = userID
			nextJoinedAt = participant.JoinedAt
		}
	}
	if nextHostID == "" {
		room.Active = false
		room.EndedAt = time.Now().UTC()
		s.rooms[roomID] = room
		return room
	}
	for userID, participant := range s.participants[roomID] {
		if userID == nextHostID {
			participant.Role = "host"
			room.HostID = userID
		} else {
			participant.Role = "participant"
		}
		s.participants[roomID][userID] = participant
	}
	s.rooms[roomID] = room
	return room
}

func newMemorySession(userID string) Session {
	return Session{Token: security.Token(32), UserID: userID, ExpiresAt: time.Now().UTC().Add(24 * time.Hour)}
}
