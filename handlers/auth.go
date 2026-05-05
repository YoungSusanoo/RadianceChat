package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"radiance/middleware"
	"radiance/models"

	"github.com/google/uuid"
)

type AuthHandler struct {
	db        *sql.DB
	jwtSecret string
}

func NewAuthHandler(db *sql.DB, jwtSecret string) *AuthHandler {
	return &AuthHandler{db: db, jwtSecret: jwtSecret}
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

func (h *AuthHandler) hashAndStorePassword(password string) (string, error) {
	passwordHash, err := hashPassword(password)
	if err != nil {
		return "", err
	}
	return passwordHash, nil
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req models.AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" {
		http.Error(w, "Email and password required", http.StatusBadRequest)
		return
	}

	userID := uuid.New().String()
	passwordHash, err := h.hashAndStorePassword(req.Password)
	if err != nil {
		http.Error(w, "Failed to process password", http.StatusInternalServerError)
		return
	}
	username := strings.Split(req.Email, "@")[0]

	_, err = h.db.Exec(
		"INSERT INTO users (id, username, email, password_hash, status) VALUES ($1, $2, $3, $4, $5)",
		userID, username, req.Email, passwordHash, "offline",
	)
	if err != nil {
		http.Error(w, "User already exists", http.StatusConflict)
		return
	}

	token, err := middleware.GenerateToken(userID, h.jwtSecret)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	resp := models.AuthResponse{
		Token: token,
		User: &models.User{
			ID:     userID,
			Email:  req.Email,
			Status: "offline",
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	var user models.User
	var passwordHash string
	err := h.db.QueryRow(
    		"SELECT id, username, email, password_hash FROM users WHERE email = $1", 
    		req.Email,
	).Scan(&user.ID, &user.Username, &user.Email, &passwordHash)

	if err == sql.ErrNoRows {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	} else if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if !verifyPassword(passwordHash, req.Password) {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := middleware.GenerateToken(user.ID, h.jwtSecret)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	resp := models.AuthResponse{
		Token: token,
		User:  &user,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *AuthHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	token, err := middleware.ExtractToken(authHeader)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	claims, err := middleware.VerifyToken(token, h.jwtSecret)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var user models.User
	err = h.db.QueryRow(
		"SELECT id, email, status FROM users WHERE id = $1",
		claims.UserID,
	).Scan(&user.ID, &user.Email, &user.Status)

	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (h *AuthHandler) AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        authHeader := r.Header.Get("Authorization")
        token, err := middleware.ExtractToken(authHeader)
        if err != nil {
            http.Error(w, "Unauthorized", http.StatusUnauthorized)
            return
        }

        claims, err := middleware.VerifyToken(token, h.jwtSecret)
        if err != nil {
            http.Error(w, "Invalid token", http.StatusUnauthorized)
            return
        }

        // Передаем UserID в заголовок для Handler-ов
        r.Header.Set("X-User-ID", claims.UserID)
        next.ServeHTTP(w, r)
    })
}
