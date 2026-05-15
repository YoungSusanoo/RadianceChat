package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"radiance/middleware"
	"radiance/models"

	"github.com/google/uuid"
)

type UserStore interface {
	CreateUser(user models.User, passwordHash string) error
	FindUserByEmail(email string) (models.User, string, error)
	FindUserByID(id string) (models.User, error)
}

type SQLUserStore struct {
	db *sql.DB
}

func NewSQLUserStore(db *sql.DB) *SQLUserStore {
	return &SQLUserStore{db: db}
}

func (s *SQLUserStore) CreateUser(user models.User, passwordHash string) error {
	_, err := s.db.Exec(
		"INSERT INTO users (id, username, email, password_hash, status) VALUES ($1, $2, $3, $4, $5)",
		user.ID, user.Username, user.Email, passwordHash, user.Status,
	)
	return err
}

func (s *SQLUserStore) FindUserByEmail(email string) (models.User, string, error) {
	var user models.User
	var passwordHash string
	err := s.db.QueryRow(
		"SELECT id, username, email, password_hash, status FROM users WHERE email = $1",
		email,
	).Scan(&user.ID, &user.Username, &user.Email, &passwordHash, &user.Status)
	return user, passwordHash, err
}

func (s *SQLUserStore) FindUserByID(id string) (models.User, error) {
	var user models.User
	err := s.db.QueryRow(
		"SELECT id, username, email, status FROM users WHERE id = $1",
		id,
	).Scan(&user.ID, &user.Username, &user.Email, &user.Status)
	return user, err
}

type AuthHandler struct {
	users     UserStore
	jwtSecret string
}

func NewAuthHandler(db *sql.DB, jwtSecret string) *AuthHandler {
	return NewAuthHandlerWithStore(NewSQLUserStore(db), jwtSecret)
}

func NewAuthHandlerWithStore(users UserStore, jwtSecret string) *AuthHandler {
	return &AuthHandler{users: users, jwtSecret: jwtSecret}
}

func hashPassword(password string) (string, error) {
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		return "", err
	}
	salt := base64.StdEncoding.EncodeToString(saltBytes)
	hash := sha256Hex(salt + ":" + password)
	return fmt.Sprintf("%s$%s", salt, hash), nil
}

func sha256Hex(input string) string {
	sum := sha256.Sum256([]byte(input))
	return hex.EncodeToString(sum[:])
}

func verifyPassword(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 2 {
		return false
	}
	expected := sha256Hex(parts[0] + ":" + password)
	return expected == parts[1]
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req models.AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request")
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "Email and password required")
		return
	}

	passwordHash, err := hashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to process password")
		return
	}

	user := models.User{
		ID:       uuid.New().String(),
		Username: strings.Split(req.Email, "@")[0],
		Email:    req.Email,
		Status:   "offline",
	}

	if err := h.users.CreateUser(user, passwordHash); err != nil {
		writeError(w, http.StatusConflict, "User already exists")
		return
	}

	token, err := middleware.GenerateToken(user.ID, h.jwtSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate token")
		return
	}

	writeJSON(w, http.StatusCreated, models.AuthResponse{Token: token, User: &user})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request")
		return
	}

	user, passwordHash, err := h.users.FindUserByEmail(strings.TrimSpace(req.Email))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "Invalid credentials")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "Database error")
		return
	}

	if !verifyPassword(passwordHash, req.Password) {
		writeError(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	token, err := middleware.GenerateToken(user.ID, h.jwtSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate token")
		return
	}

	writeJSON(w, http.StatusOK, models.AuthResponse{Token: token, User: &user})
}

func (h *AuthHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	user, err := h.users.FindUserByID(userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}

	writeJSON(w, http.StatusOK, user)
}

func (h *AuthHandler) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		token, err := middleware.ExtractToken(authHeader)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}

		claims, err := middleware.VerifyToken(token, h.jwtSecret)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Invalid token")
			return
		}

		r.Header.Set("X-User-ID", claims.UserID)
		next.ServeHTTP(w, r)
	})
}
