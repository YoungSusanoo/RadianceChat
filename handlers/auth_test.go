package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"radiance/middleware"
	"radiance/models"
)

type fakeUserStore struct {
	createdUser models.User
	createdHash string
	createErr   error
	byEmail     map[string]struct {
		user models.User
		hash string
	}
	byID map[string]models.User
}

func (s *fakeUserStore) CreateUser(user models.User, passwordHash string) error {
	s.createdUser = user
	s.createdHash = passwordHash
	return s.createErr
}

func (s *fakeUserStore) FindUserByEmail(email string) (models.User, string, error) {
	if entry, ok := s.byEmail[email]; ok {
		return entry.user, entry.hash, nil
	}
	return models.User{}, "", sql.ErrNoRows
}

func (s *fakeUserStore) FindUserByID(id string) (models.User, error) {
	if user, ok := s.byID[id]; ok {
		return user, nil
	}
	return models.User{}, sql.ErrNoRows
}

func TestAuthRegisterCreatesUserAndReturnsVerifiableToken(t *testing.T) {
	store := &fakeUserStore{}
	h := NewAuthHandlerWithStore(store, "test-secret")

	req := httptest.NewRequest(http.MethodPost, "/auth/register", strings.NewReader(`{"email":"alice@example.com","password":"s3cret"}`))
	rr := httptest.NewRecorder()
	h.Register(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected %d, got %d: %s", http.StatusCreated, rr.Code, rr.Body.String())
	}
	if store.createdUser.Email != "alice@example.com" || store.createdUser.Username != "alice" || store.createdUser.Status != "offline" {
		t.Fatalf("unexpected created user: %+v", store.createdUser)
	}
	if store.createdHash == "" || store.createdHash == "s3cret" || !verifyPassword(store.createdHash, "s3cret") {
		t.Fatalf("password was not securely hashed: %q", store.createdHash)
	}

	var resp models.AuthResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	claims, err := middleware.VerifyToken(resp.Token, "test-secret")
	if err != nil {
		t.Fatalf("token should be valid: %v", err)
	}
	if claims.UserID != store.createdUser.ID {
		t.Fatalf("token user id = %q, want %q", claims.UserID, store.createdUser.ID)
	}
}

func TestAuthRegisterValidatesPayloadAndConflicts(t *testing.T) {
	tests := []struct {
		name  string
		body  string
		store *fakeUserStore
		want  int
	}{
		{name: "bad json", body: `{`, store: &fakeUserStore{}, want: http.StatusBadRequest},
		{name: "missing password", body: `{"email":"bob@example.com"}`, store: &fakeUserStore{}, want: http.StatusBadRequest},
		{name: "duplicate", body: `{"email":"bob@example.com","password":"pw"}`, store: &fakeUserStore{createErr: errors.New("duplicate")}, want: http.StatusConflict},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewAuthHandlerWithStore(tt.store, "test-secret")
			rr := httptest.NewRecorder()
			h.Register(rr, httptest.NewRequest(http.MethodPost, "/auth/register", strings.NewReader(tt.body)))
			if rr.Code != tt.want {
				t.Fatalf("expected %d, got %d", tt.want, rr.Code)
			}
		})
	}
}

func TestAuthLoginRejectsInvalidCredentialsAndReturnsToken(t *testing.T) {
	hash, err := hashPassword("correct")
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{ID: "user-1", Username: "alice", Email: "alice@example.com", Status: "offline"}
	store := &fakeUserStore{byEmail: map[string]struct {
		user models.User
		hash string
	}{"alice@example.com": {user: user, hash: hash}}}
	h := NewAuthHandlerWithStore(store, "test-secret")

	rr := httptest.NewRecorder()
	h.Login(rr, httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(`{"email":"alice@example.com","password":"wrong"}`)))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: expected 401, got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	h.Login(rr, httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(`{"email":"alice@example.com","password":"correct"}`)))
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp models.AuthResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	claims, err := middleware.VerifyToken(resp.Token, "test-secret")
	if err != nil || claims.UserID != user.ID {
		t.Fatalf("invalid login token: claims=%+v err=%v", claims, err)
	}
}

func TestAuthMiddlewareSetsCurrentUser(t *testing.T) {
	token, err := middleware.GenerateToken("user-42", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	h := NewAuthHandlerWithStore(&fakeUserStore{}, "test-secret")

	wrapped := h.AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-User-ID"); got != "user-42" {
			t.Fatalf("X-User-ID = %q", got)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	wrapped.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	wrapped.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/auth/me", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("missing token: expected 401, got %d", rr.Code)
	}
}
