package app

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sort"
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
	users        map[string]User
	usersByEmail map[string]string
	sessions     map[string]Session
	rooms        map[string]Room
	invites      map[string]string
	participants map[string]map[string]Participant
	messages     map[string][]Message
}

func NewStore() *Store {
	return &Store{
		users:        map[string]User{},
		usersByEmail: map[string]string{},
		sessions:     map[string]Session{},
		rooms:        map[string]Room{},
		invites:      map[string]string{},
		participants: map[string]map[string]Participant{},
		messages:     map[string][]Message{},
	}
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

	user := User{ID: token(12), Name: name, Email: email, Password: password, CreatedAt: time.Now().UTC()}
	s.users[user.ID] = user
	s.usersByEmail[email] = user.ID
	session := s.createSessionLocked(user.ID)
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
	if user.Password != password {
		return User{}, "", ErrUnauthorized
	}
	session := s.createSessionLocked(user.ID)
	return user, session.Token, nil
}

func (s *Store) Logout(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
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
		if len(s.participants[roomID]) >= 15 {
			return Room{}, Participant{}, nil, ErrConflict
		}
		p = Participant{RoomID: roomID, UserID: user.ID, Name: user.Name, Role: "participant", JoinedAt: now}
	}
	p.LastSeen = now
	p.Connected = true
	s.participants[roomID][user.ID] = p
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
	return room, nil
}

func (s *Store) AddMessage(roomID string, user User, text string) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(text) == "" {
		return Message{}, ErrBadRequest
	}
	if _, ok := s.rooms[roomID]; !ok {
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
	return msg, nil
}

func (s *Store) Messages(roomID string) ([]Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.rooms[roomID]; !ok {
		return nil, ErrNotFound
	}
	out := append([]Message(nil), s.messages[roomID]...)
	return out, nil
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
