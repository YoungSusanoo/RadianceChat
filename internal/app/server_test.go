package app

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHappyPath(t *testing.T) {
	server := NewServer(Config{StaticDir: "../../web/static"}, slog.Default())
	handler := server.Routes()

	register := post(t, handler, "/api/v1/auth/register", "", map[string]string{
		"name":     "Demo",
		"email":    "demo@example.com",
		"password": "test1234",
	})
	if register.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", register.Code, register.Body.String())
	}
	var auth struct {
		Token string `json:"token"`
		User  User   `json:"user"`
	}
	decodeTest(t, register, &auth)
	if auth.Token == "" || auth.User.ID == "" {
		t.Fatalf("expected token and user id: %+v", auth)
	}

	createRoom := post(t, handler, "/api/v1/rooms", auth.Token, map[string]string{
		"name":       "Daily call",
		"visibility": "public",
	})
	if createRoom.Code != http.StatusCreated {
		t.Fatalf("create room status = %d, body = %s", createRoom.Code, createRoom.Body.String())
	}
	var roomPayload struct {
		Room         Room          `json:"room"`
		Participants []Participant `json:"participants"`
	}
	decodeTest(t, createRoom, &roomPayload)
	if roomPayload.Room.ID == "" {
		t.Fatal("expected room id")
	}
	if len(roomPayload.Participants) != 1 || roomPayload.Participants[0].Role != "host" {
		t.Fatalf("expected host participant in create room response: %+v", roomPayload.Participants)
	}

	message := post(t, handler, "/api/v1/rooms/"+roomPayload.Room.ID+"/messages", auth.Token, map[string]string{
		"text": "hello",
	})
	if message.Code != http.StatusCreated {
		t.Fatalf("message status = %d, body = %s", message.Code, message.Body.String())
	}

	leave := post(t, handler, "/api/v1/rooms/"+roomPayload.Room.ID+"/leave", auth.Token, map[string]string{})
	if leave.Code != http.StatusOK {
		t.Fatalf("leave status = %d, body = %s", leave.Code, leave.Body.String())
	}

	messagesAfterLeave := get(t, handler, "/api/v1/rooms/"+roomPayload.Room.ID+"/messages", auth.Token)
	if messagesAfterLeave.Code != http.StatusForbidden {
		t.Fatalf("messages after leave status = %d, body = %s", messagesAfterLeave.Code, messagesAfterLeave.Body.String())
	}
}

func TestEventsRequireRoomParticipant(t *testing.T) {
	server := NewServer(Config{StaticDir: "../../web/static"}, slog.Default())
	handler := server.Routes()

	hostRegister := post(t, handler, "/api/v1/auth/register", "", map[string]string{
		"name":     "Host",
		"email":    "host@example.com",
		"password": "test1234",
	})
	var hostAuth struct {
		Token string `json:"token"`
		User  User   `json:"user"`
	}
	decodeTest(t, hostRegister, &hostAuth)

	guestRegister := post(t, handler, "/api/v1/auth/register", "", map[string]string{
		"name":     "Guest",
		"email":    "guest@example.com",
		"password": "test1234",
	})
	var guestAuth struct {
		Token string `json:"token"`
		User  User   `json:"user"`
	}
	decodeTest(t, guestRegister, &guestAuth)

	createRoom := post(t, handler, "/api/v1/rooms", hostAuth.Token, map[string]string{
		"name":       "SSE room",
		"visibility": "public",
	})
	var roomPayload struct {
		Room Room `json:"room"`
	}
	decodeTest(t, createRoom, &roomPayload)

	guestEvents := get(t, handler, "/api/v1/rooms/"+roomPayload.Room.ID+"/events", guestAuth.Token)
	if guestEvents.Code != http.StatusForbidden {
		t.Fatalf("guest events status = %d, body = %s", guestEvents.Code, guestEvents.Body.String())
	}

	leave := post(t, handler, "/api/v1/rooms/"+roomPayload.Room.ID+"/leave", hostAuth.Token, map[string]string{})
	if leave.Code != http.StatusOK {
		t.Fatalf("leave status = %d, body = %s", leave.Code, leave.Body.String())
	}

	hostEventsAfterLeave := get(t, handler, "/api/v1/rooms/"+roomPayload.Room.ID+"/events", hostAuth.Token)
	if hostEventsAfterLeave.Code != http.StatusForbidden {
		t.Fatalf("host events after leave status = %d, body = %s", hostEventsAfterLeave.Code, hostEventsAfterLeave.Body.String())
	}
}

func post(t *testing.T, handler http.Handler, path, token string, payload interface{}) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

func get(t *testing.T, handler http.Handler, path, token string) *httptest.ResponseRecorder {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

func decodeTest(t *testing.T, res *httptest.ResponseRecorder, dst interface{}) {
	t.Helper()
	if err := json.NewDecoder(res.Body).Decode(dst); err != nil {
		t.Fatal(err)
	}
}
