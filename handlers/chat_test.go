package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"radiance/models"
)

type fakeChatStore struct {
	active           bool
	activeErr        error
	username         string
	usernameErr      error
	createdMessage   models.Message
	createErr        error
	messages         []models.Message
	messagesErr      error
	lastLimit        int
	lastOffset       int
	lastMessagesRoom string
}

func (s *fakeChatStore) IsUserActiveParticipant(roomID, userID string) (bool, error) {
	return s.active, s.activeErr
}
func (s *fakeChatStore) CreateMessage(message models.Message) error {
	s.createdMessage = message
	return s.createErr
}
func (s *fakeChatStore) UsernameByID(userID string) (string, error) { return s.username, s.usernameErr }
func (s *fakeChatStore) MessagesByRoom(roomID string, limit, offset int) ([]models.Message, error) {
	s.lastMessagesRoom = roomID
	s.lastLimit = limit
	s.lastOffset = offset
	return s.messages, s.messagesErr
}

func TestSendMessageRequiresAuthenticatedActiveParticipant(t *testing.T) {
	tests := []struct {
		name  string
		store *fakeChatStore
		user  string
		body  string
		want  int
	}{
		{name: "unauthorized", store: &fakeChatStore{}, body: `{"content":"hello"}`, want: http.StatusUnauthorized},
		{name: "invalid json", store: &fakeChatStore{active: true}, user: "u1", body: `{`, want: http.StatusBadRequest},
		{name: "blank content", store: &fakeChatStore{active: true}, user: "u1", body: `{"content":"   "}`, want: http.StatusBadRequest},
		{name: "not participant", store: &fakeChatStore{active: false}, user: "u1", body: `{"content":"hello"}`, want: http.StatusForbidden},
		{name: "active lookup error", store: &fakeChatStore{activeErr: errors.New("db")}, user: "u1", body: `{"content":"hello"}`, want: http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewChatHandlerWithStore(tt.store)
			req := httptest.NewRequest(http.MethodPost, "/rooms/room-1/messages", strings.NewReader(tt.body))
			req.SetPathValue("id", "room-1")
			if tt.user != "" {
				req.Header.Set("X-User-ID", tt.user)
			}
			rr := httptest.NewRecorder()
			h.SendMessage(rr, req)
			if rr.Code != tt.want {
				t.Fatalf("expected %d, got %d: %s", tt.want, rr.Code, rr.Body.String())
			}
		})
	}
}

func TestSendMessageCreatesTrimmedMessage(t *testing.T) {
	store := &fakeChatStore{active: true, username: "alice"}
	h := NewChatHandlerWithStore(store)
	req := httptest.NewRequest(http.MethodPost, "/rooms/room-1/messages", strings.NewReader(`{"content":"  hello world  "}`))
	req.SetPathValue("id", "room-1")
	req.Header.Set("X-User-ID", "u1")
	rr := httptest.NewRecorder()

	h.SendMessage(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	if store.createdMessage.ID == "" || store.createdMessage.RoomID != "room-1" || store.createdMessage.UserID != "u1" || store.createdMessage.Username != "alice" || store.createdMessage.Content != "hello world" {
		t.Fatalf("unexpected created message: %+v", store.createdMessage)
	}
	var resp models.Message
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.ID != store.createdMessage.ID || resp.Content != "hello world" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestGetMessagesDefaultsAndBoundsPagination(t *testing.T) {
	store := &fakeChatStore{messages: []models.Message{{ID: "m1", CreatedAt: time.Now()}}}
	h := NewChatHandlerWithStore(store)

	req := httptest.NewRequest(http.MethodGet, "/rooms/room-1/messages?limit=250&offset=-1", nil)
	req.SetPathValue("id", "room-1")
	req.Header.Set("X-User-ID", "u1")
	rr := httptest.NewRecorder()
	h.GetMessages(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if store.lastMessagesRoom != "room-1" || store.lastLimit != 50 || store.lastOffset != 0 {
		t.Fatalf("unexpected pagination room=%q limit=%d offset=%d", store.lastMessagesRoom, store.lastLimit, store.lastOffset)
	}

	req = httptest.NewRequest(http.MethodGet, "/rooms/room-1/messages?limit=25&offset=10", nil)
	req.SetPathValue("id", "room-1")
	req.Header.Set("X-User-ID", "u1")
	rr = httptest.NewRecorder()
	h.GetMessages(rr, req)
	if rr.Code != http.StatusOK || store.lastLimit != 25 || store.lastOffset != 10 {
		t.Fatalf("valid pagination not applied: code=%d limit=%d offset=%d", rr.Code, store.lastLimit, store.lastOffset)
	}
}

func TestGetMessagesRequiresUserAndMapsStoreError(t *testing.T) {
	h := NewChatHandlerWithStore(&fakeChatStore{})
	req := httptest.NewRequest(http.MethodGet, "/rooms/room-1/messages", nil)
	req.SetPathValue("id", "room-1")
	rr := httptest.NewRecorder()
	h.GetMessages(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}

	h = NewChatHandlerWithStore(&fakeChatStore{messagesErr: errors.New("db")})
	req = httptest.NewRequest(http.MethodGet, "/rooms/room-1/messages", nil)
	req.SetPathValue("id", "room-1")
	req.Header.Set("X-User-ID", "u1")
	rr = httptest.NewRecorder()
	h.GetMessages(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
}
