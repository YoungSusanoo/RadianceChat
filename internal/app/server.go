package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"radiance/internal/realtime"
)

type Config struct {
	Addr             string
	StaticDir        string
	LiveKitURL       string
	LiveKitAPIKey    string
	LiveKitAPISecret string
}

type Server struct {
	cfg    Config
	log    *slog.Logger
	store  Store
	broker *realtime.Broker
}

func NewServer(cfg Config, logger *slog.Logger) *Server {
	return NewServerWithStore(cfg, logger, NewMemoryStore())
}

func NewServerWithStore(cfg Config, logger *slog.Logger, store Store) *Server {
	return &Server{cfg: cfg, log: logger, store: store, broker: realtime.NewBroker()}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", s.health)
	mux.HandleFunc("GET /health/ready", s.health)
	mux.HandleFunc("GET /metrics", s.metrics)

	mux.HandleFunc("POST /api/v1/auth/register", s.register)
	mux.HandleFunc("POST /api/v1/auth/login", s.login)
	mux.HandleFunc("POST /api/v1/auth/logout", s.logout)
	mux.HandleFunc("GET /api/v1/auth/me", s.me)

	mux.HandleFunc("GET /api/v1/rooms", s.listRooms)
	mux.HandleFunc("POST /api/v1/rooms", s.createRoom)
	mux.HandleFunc("GET /api/v1/rooms/", s.roomSubroutes)
	mux.HandleFunc("POST /api/v1/rooms/", s.roomSubroutes)
	mux.HandleFunc("PATCH /api/v1/rooms/", s.roomSubroutes)
	mux.HandleFunc("DELETE /api/v1/rooms/", s.roomSubroutes)
	mux.HandleFunc("GET /api/v1/invites/", s.inviteSubroutes)
	mux.HandleFunc("POST /api/v1/invites/", s.inviteSubroutes)

	mux.Handle("/", s.staticHandler())
	return s.withMiddleware(mux)
}

func (s *Server) staticHandler() http.Handler {
	files := http.FileServer(http.Dir(s.cfg.StaticDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, ErrNotFound)
			return
		}
		path := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		if path == "." {
			path = "index.html"
		}
		fullPath := filepath.Join(s.cfg.StaticDir, path)
		if _, err := os.Stat(fullPath); err != nil {
			http.ServeFile(w, r, filepath.Join(s.cfg.StaticDir, "index.html"))
			return
		}
		files.ServeHTTP(w, r)
	})
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
		s.log.Info("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
	})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	_, _ = fmt.Fprintln(w, "# HELP radiance_up Radiance service availability")
	_, _ = fmt.Fprintln(w, "# TYPE radiance_up gauge")
	_, _ = fmt.Fprintln(w, "radiance_up 1")
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &req) {
		return
	}
	user, token, err := s.store.Register(req.Name, req.Email, req.Password)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{"user": user, "token": token})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &req) {
		return
	}
	user, token, err := s.store.Login(req.Email, req.Password)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"user": user, "token": token})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.store.Logout(bearer(r))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user, err := s.user(r)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) listRooms(w http.ResponseWriter, r *http.Request) {
	if _, err := s.user(r); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.store.PublicRooms())
}

func (s *Server) createRoom(w http.ResponseWriter, r *http.Request) {
	user, err := s.user(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Visibility  string `json:"visibility"`
	}
	if !decode(w, r, &req) {
		return
	}
	room, participant, err := s.store.CreateRoom(user, req.Name, req.Description, req.Visibility)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"room":         room,
		"participant":  participant,
		"participants": []Participant{participant},
	})
}

func (s *Server) roomSubroutes(w http.ResponseWriter, r *http.Request) {
	user, err := s.user(r)
	if err != nil {
		writeError(w, err)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/rooms/")
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, ErrNotFound)
		return
	}
	roomID := parts[0]

	switch {
	case r.Method == http.MethodGet && len(parts) == 1:
		room, participants, err := s.store.RoomForUser(roomID, user)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"room": room, "participants": participants})
	case r.Method == http.MethodPost && len(parts) == 2 && parts[1] == "join":
		room, participant, participants, err := s.store.JoinRoom(roomID, user)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broker.Publish(roomID, "participant.joined", participant)
		writeJSON(w, http.StatusOK, map[string]interface{}{"room": room, "participant": participant, "participants": participants})
	case r.Method == http.MethodPost && len(parts) == 2 && parts[1] == "leave":
		room, participant, participants, err := s.store.LeaveRoom(roomID, user)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broker.Publish(roomID, "participant.left", participant)
		if !room.Active {
			s.broker.Publish(roomID, "room.ended", room)
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"room": room, "participant": participant, "participants": participants})
	case r.Method == http.MethodPatch && len(parts) == 2 && parts[1] == "device":
		var req struct {
			Muted    bool `json:"muted"`
			CameraOn bool `json:"cameraOn"`
		}
		if !decode(w, r, &req) {
			return
		}
		participant, err := s.store.SetDevice(roomID, user, req.Muted, req.CameraOn)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broker.Publish(roomID, "participant.device_changed", participant)
		writeJSON(w, http.StatusOK, participant)
	case r.Method == http.MethodPost && len(parts) == 2 && parts[1] == "end":
		room, err := s.store.EndRoom(roomID, user)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broker.Publish(roomID, "room.ended", room)
		writeJSON(w, http.StatusOK, room)
	case r.Method == http.MethodGet && len(parts) == 2 && parts[1] == "messages":
		messages, err := s.store.MessagesForUser(roomID, user)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, messages)
	case r.Method == http.MethodPost && len(parts) == 2 && parts[1] == "messages":
		var req struct {
			Text string `json:"text"`
		}
		if !decode(w, r, &req) {
			return
		}
		msg, err := s.store.AddMessage(roomID, user, req.Text)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broker.Publish(roomID, "chat.message", msg)
		writeJSON(w, http.StatusCreated, msg)
	case r.Method == http.MethodGet && len(parts) == 2 && parts[1] == "events":
		s.streamEvents(w, r, roomID)
	case r.Method == http.MethodPost && len(parts) == 2 && parts[1] == "media-token":
		token, err := s.mediaToken(roomID, user)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"mode":       "livekit",
			"livekitUrl": s.cfg.LiveKitURL,
			"token":      token,
		})
	case len(parts) == 3 && parts[1] == "participants":
		s.participantAction(w, r, roomID, parts[2], user)
	default:
		writeError(w, ErrNotFound)
	}
}

func (s *Server) participantAction(w http.ResponseWriter, r *http.Request, roomID, targetID string, user User) {
	switch r.Method {
	case http.MethodPost:
		participant, err := s.store.MuteParticipant(roomID, targetID, user)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broker.Publish(roomID, "participant.muted", participant)
		writeJSON(w, http.StatusOK, participant)
	case http.MethodDelete:
		participant, err := s.store.KickParticipant(roomID, targetID, user)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broker.Publish(roomID, "participant.kicked", participant)
		writeJSON(w, http.StatusOK, participant)
	default:
		writeError(w, ErrNotFound)
	}
}

func (s *Server) inviteSubroutes(w http.ResponseWriter, r *http.Request) {
	user, err := s.user(r)
	if err != nil {
		writeError(w, err)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/invites/")
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, ErrNotFound)
		return
	}
	invite := parts[0]
	room, err := s.store.RoomByInvite(invite)
	if err != nil {
		writeError(w, err)
		return
	}
	if r.Method == http.MethodGet && len(parts) == 1 {
		writeJSON(w, http.StatusOK, room)
		return
	}
	if r.Method == http.MethodPost && len(parts) == 2 && parts[1] == "join" {
		room, participant, participants, err := s.store.JoinRoomByInvite(room.ID, user)
		if err != nil {
			writeError(w, err)
			return
		}
		s.broker.Publish(room.ID, "participant.joined", participant)
		writeJSON(w, http.StatusOK, map[string]interface{}{"room": room, "participant": participant, "participants": participants})
		return
	}
	writeError(w, ErrNotFound)
}

func (s *Server) streamEvents(w http.ResponseWriter, r *http.Request, roomID string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, ErrBadRequest)
		return
	}
	ch, unsubscribe := s.broker.Subscribe(roomID)
	defer unsubscribe()

	_, _ = fmt.Fprintf(w, "event: ready\ndata: {\"status\":\"ok\"}\n\n")
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-ch:
			payload, _ := json.Marshal(event)
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, payload)
			flusher.Flush()
		case <-time.After(25 * time.Second):
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func (s *Server) user(r *http.Request) (User, error) {
	token := bearer(r)
	if token == "" {
		token = r.URL.Query().Get("access_token")
	}
	return s.store.UserByToken(token)
}

func bearer(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer ")
	}
	return ""
}

func decode(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, ErrBadRequest)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "internal error"
	switch {
	case errors.Is(err, ErrBadRequest):
		status, message = http.StatusBadRequest, "bad request"
	case errors.Is(err, ErrUnauthorized):
		status, message = http.StatusUnauthorized, "unauthorized"
	case errors.Is(err, ErrForbidden):
		status, message = http.StatusForbidden, "forbidden"
	case errors.Is(err, ErrNotFound):
		status, message = http.StatusNotFound, "not found"
	case errors.Is(err, ErrConflict):
		status, message = http.StatusConflict, "conflict"
	}
	writeJSON(w, status, map[string]string{"error": message})
}
