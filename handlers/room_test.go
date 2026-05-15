package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"radiance/models"
)

type fakeRoomStore struct {
	createdRoom        models.Room
	createdParticipant string
	createErr          error
	rooms              map[string]models.Room
	roomsForUser       []models.Room
	activeRoom         bool
	activeRoomErr      error
	alreadyJoined      bool
	alreadyJoinedErr   error
	activeCount        int
	activeCountErr     error
	addedParticipant   models.Participant
	addErr             error
	leaveCalled        bool
	leaveErr           error
	participants       []models.Participant
	participantsErr    error
	inviteRoomID       string
	inviteErr          error
	hostID             string
	hostErr            error
	endCalled          bool
	endErr             error
}

func (s *fakeRoomStore) CreateRoomWithHost(room models.Room, participantID string) error {
	s.createdRoom = room
	s.createdParticipant = participantID
	return s.createErr
}
func (s *fakeRoomStore) FindRoomByID(roomID string) (models.Room, error) {
	if room, ok := s.rooms[roomID]; ok {
		return room, nil
	}
	return models.Room{}, sql.ErrNoRows
}
func (s *fakeRoomStore) ListActiveRoomsForUser(userID string) ([]models.Room, error) {
	return s.roomsForUser, nil
}
func (s *fakeRoomStore) ActiveRoomExists(roomID string) (bool, error) {
	return s.activeRoom, s.activeRoomErr
}
func (s *fakeRoomStore) IsUserActiveParticipant(roomID, userID string) (bool, error) {
	return s.alreadyJoined, s.alreadyJoinedErr
}
func (s *fakeRoomStore) ActiveParticipantCount(roomID string) (int, error) {
	return s.activeCount, s.activeCountErr
}
func (s *fakeRoomStore) AddParticipant(participant models.Participant) error {
	s.addedParticipant = participant
	return s.addErr
}
func (s *fakeRoomStore) LeaveRoom(roomID, userID string) error {
	s.leaveCalled = true
	return s.leaveErr
}
func (s *fakeRoomStore) ActiveParticipants(roomID string) ([]models.Participant, error) {
	return s.participants, s.participantsErr
}
func (s *fakeRoomStore) RoomIDByInvite(invite string) (string, error) {
	return s.inviteRoomID, s.inviteErr
}
func (s *fakeRoomStore) HostID(roomID string) (string, error) { return s.hostID, s.hostErr }
func (s *fakeRoomStore) EndRoomAndLeaveParticipants(roomID string) error {
	s.endCalled = true
	return s.endErr
}

func TestCreateRoomValidatesAndCreatesHostParticipant(t *testing.T) {
	store := &fakeRoomStore{}
	h := NewRoomHandlerWithStore(store)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/rooms", strings.NewReader(`{"name":" Team sync ","type":"private"}`))
	req.Header.Set("X-User-ID", "host-1")
	h.CreateRoom(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	if store.createdRoom.Name != "Team sync" || store.createdRoom.Type != "private" || store.createdRoom.HostID != "host-1" || store.createdRoom.Status != "active" {
		t.Fatalf("unexpected room: %+v", store.createdRoom)
	}
	if store.createdRoom.ID == "" || store.createdRoom.InviteLink == "" || store.createdParticipant == "" {
		t.Fatalf("expected generated room and participant identifiers")
	}
}

func TestCreateRoomRejectsUnauthorizedAndInvalidType(t *testing.T) {
	h := NewRoomHandlerWithStore(&fakeRoomStore{})

	rr := httptest.NewRecorder()
	h.CreateRoom(rr, httptest.NewRequest(http.MethodPost, "/rooms", strings.NewReader(`{"name":"x"}`)))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/rooms", strings.NewReader(`{"name":"x","type":"secret"}`))
	req.Header.Set("X-User-ID", "host-1")
	h.CreateRoom(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected bad request, got %d", rr.Code)
	}
}

func TestJoinRoomCoversPrimaryOutcomes(t *testing.T) {
	tests := []struct {
		name  string
		store *fakeRoomStore
		user  string
		want  int
		body  string
	}{
		{name: "unauthorized", store: &fakeRoomStore{}, want: http.StatusUnauthorized},
		{name: "missing room", user: "user-1", store: &fakeRoomStore{activeRoom: false}, want: http.StatusNotFound},
		{name: "already joined", user: "user-1", store: &fakeRoomStore{activeRoom: true, alreadyJoined: true}, want: http.StatusOK, body: "already_joined"},
		{name: "full", user: "user-1", store: &fakeRoomStore{activeRoom: true, activeCount: 100}, want: http.StatusBadRequest},
		{name: "joined", user: "user-1", store: &fakeRoomStore{activeRoom: true, activeCount: 5}, want: http.StatusOK, body: "joined"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewRoomHandlerWithStore(tt.store)
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/rooms/room-1/join", nil)
			req.SetPathValue("id", "room-1")
			if tt.user != "" {
				req.Header.Set("X-User-ID", tt.user)
			}
			h.JoinRoom(rr, req)
			if rr.Code != tt.want {
				t.Fatalf("expected %d, got %d: %s", tt.want, rr.Code, rr.Body.String())
			}
			if tt.body != "" && !strings.Contains(rr.Body.String(), tt.body) {
				t.Fatalf("response %q does not contain %q", rr.Body.String(), tt.body)
			}
		})
	}
}

func TestJoinRoomAddsAuthenticatedParticipant(t *testing.T) {
	store := &fakeRoomStore{activeRoom: true, activeCount: 3}
	h := NewRoomHandlerWithStore(store)
	req := httptest.NewRequest(http.MethodPost, "/rooms/room-1/join", nil)
	req.SetPathValue("id", "room-1")
	req.Header.Set("X-User-ID", "user-1")
	rr := httptest.NewRecorder()

	h.JoinRoom(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if store.addedParticipant.RoomID != "room-1" || store.addedParticipant.UserID != "user-1" || store.addedParticipant.Role != "participant" || store.addedParticipant.ID == "" {
		t.Fatalf("unexpected participant: %+v", store.addedParticipant)
	}
}

func TestJoinByInviteResolvesInviteBeforeJoining(t *testing.T) {
	store := &fakeRoomStore{inviteRoomID: "room-from-invite", activeRoom: true}
	h := NewRoomHandlerWithStore(store)
	req := httptest.NewRequest(http.MethodPost, "/invites/invite-1", nil)
	req.SetPathValue("invite", "invite-1")
	req.Header.Set("X-User-ID", "user-1")
	rr := httptest.NewRecorder()

	h.JoinByInvite(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if store.addedParticipant.RoomID != "room-from-invite" {
		t.Fatalf("joined room = %q", store.addedParticipant.RoomID)
	}
}

func TestDeleteRoomRequiresHostAndEndsRoom(t *testing.T) {
	nonHost := &fakeRoomStore{hostID: "host-1"}
	h := NewRoomHandlerWithStore(nonHost)
	req := httptest.NewRequest(http.MethodDelete, "/rooms/room-1", nil)
	req.SetPathValue("id", "room-1")
	req.Header.Set("X-User-ID", "user-1")
	rr := httptest.NewRecorder()
	h.DeleteRoom(rr, req)
	if rr.Code != http.StatusForbidden || nonHost.endCalled {
		t.Fatalf("non-host expected 403 and no end, got %d end=%v", rr.Code, nonHost.endCalled)
	}

	host := &fakeRoomStore{hostID: "host-1"}
	h = NewRoomHandlerWithStore(host)
	req = httptest.NewRequest(http.MethodDelete, "/rooms/room-1", nil)
	req.SetPathValue("id", "room-1")
	req.Header.Set("X-User-ID", "host-1")
	rr = httptest.NewRecorder()
	h.DeleteRoom(rr, req)
	if rr.Code != http.StatusOK || !host.endCalled {
		t.Fatalf("host expected 200 and end, got %d end=%v", rr.Code, host.endCalled)
	}
}

func TestListRoomsAndParticipantsReturnJSONArrays(t *testing.T) {
	store := &fakeRoomStore{roomsForUser: []models.Room{{ID: "room-1", Name: "Daily"}}, participants: []models.Participant{{ID: "p1", UserID: "u1"}}}
	h := NewRoomHandlerWithStore(store)

	req := httptest.NewRequest(http.MethodGet, "/rooms", nil)
	req.Header.Set("X-User-ID", "u1")
	rr := httptest.NewRecorder()
	h.ListRooms(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list rooms expected 200, got %d", rr.Code)
	}
	var rooms []models.Room
	if err := json.NewDecoder(rr.Body).Decode(&rooms); err != nil || len(rooms) != 1 {
		t.Fatalf("invalid rooms json: len=%d err=%v", len(rooms), err)
	}

	req = httptest.NewRequest(http.MethodGet, "/rooms/room-1/participants", nil)
	req.SetPathValue("id", "room-1")
	rr = httptest.NewRecorder()
	h.GetParticipants(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("participants expected 200, got %d", rr.Code)
	}
	var participants []models.Participant
	if err := json.NewDecoder(rr.Body).Decode(&participants); err != nil || len(participants) != 1 {
		t.Fatalf("invalid participants json: len=%d err=%v", len(participants), err)
	}
}

func TestRoomStoreErrorsAreMapped(t *testing.T) {
	h := NewRoomHandlerWithStore(&fakeRoomStore{inviteErr: sql.ErrNoRows})
	req := httptest.NewRequest(http.MethodPost, "/invites/missing", nil)
	req.SetPathValue("invite", "missing")
	req.Header.Set("X-User-ID", "u1")
	rr := httptest.NewRecorder()
	h.JoinByInvite(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("missing invite expected 404, got %d", rr.Code)
	}

	h = NewRoomHandlerWithStore(&fakeRoomStore{activeRoom: true, alreadyJoinedErr: errors.New("db")})
	req = httptest.NewRequest(http.MethodPost, "/rooms/r1/join", nil)
	req.SetPathValue("id", "r1")
	req.Header.Set("X-User-ID", "u1")
	rr = httptest.NewRecorder()
	h.JoinRoom(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("db error expected 500, got %d", rr.Code)
	}
}
