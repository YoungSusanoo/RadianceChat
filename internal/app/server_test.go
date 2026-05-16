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
		Room Room `json:"room"`
	}
	decodeTest(t, createRoom, &roomPayload)
	if roomPayload.Room.ID == "" {
		t.Fatal("expected room id")
	}

	message := post(t, handler, "/api/v1/rooms/"+roomPayload.Room.ID+"/messages", auth.Token, map[string]string{
		"text": "hello",
	})
	if message.Code != http.StatusCreated {
		t.Fatalf("message status = %d, body = %s", message.Code, message.Body.String())
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

func decodeTest(t *testing.T, res *httptest.ResponseRecorder, dst interface{}) {
	t.Helper()
	if err := json.NewDecoder(res.Body).Decode(dst); err != nil {
		t.Fatal(err)
	}
}
