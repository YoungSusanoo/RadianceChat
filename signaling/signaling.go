package signaling

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type SignalingServer struct {
	db        *sql.DB
	rooms     map[string]*Room
	roomsMu   sync.RWMutex
	upgrader  websocket.Upgrader
	jwtSecret string
}

type Room struct {
	ID        string
	Peers     map[string]*Peer
	PeersMu   sync.RWMutex
	Broadcast chan *Message
}

type Peer struct {
	ID     string
	UserID string
	Conn   *websocket.Conn
	Send   chan *Message
	RoomID string
}

type Message struct {
	Type   string      `json:"type"` // offer, answer, ice-candidate, join, leave
	From   string      `json:"from"`
	To     string      `json:"to,omitempty"`
	RoomID string      `json:"room_id,omitempty"`
	Data   interface{} `json:"data,omitempty"`
}

func NewSignalingServer(db *sql.DB, jwtSecret string) *SignalingServer {
	allowedOrigins := map[string]struct{}{}
	for _, origin := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			allowedOrigins[origin] = struct{}{}
		}
	}
	return &SignalingServer{
		db:    db,
		rooms: make(map[string]*Room),
		upgrader: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
			if len(allowedOrigins) == 0 {
				return false
			}
			_, ok := allowedOrigins[r.Header.Get("Origin")]
			return ok
		}},
		jwtSecret: jwtSecret,
	}
}

func (s *SignalingServer) getOrCreateRoom(roomID string) *Room {
	s.roomsMu.Lock()
	defer s.roomsMu.Unlock()

	if room, exists := s.rooms[roomID]; exists {
		return room
	}

	room := &Room{
		ID:        roomID,
		Peers:     make(map[string]*Peer),
		Broadcast: make(chan *Message, 10),
	}

	s.rooms[roomID] = room
	go s.broadcastLoop(room)

	return room
}

func (s *SignalingServer) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	roomID := r.URL.Query().Get("room")

	if userID == "" || roomID == "" {
		http.Error(w, "Missing user or room", http.StatusBadRequest)
		return
	}
	if !s.isActiveParticipant(roomID, userID) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	room := s.getOrCreateRoom(roomID)
	peerID := uuid.New().String()

	peer := &Peer{
		ID:     peerID,
		UserID: userID,
		Conn:   conn,
		Send:   make(chan *Message, 5),
		RoomID: roomID,
	}

	room.PeersMu.Lock()
	room.Peers[peerID] = peer
	room.PeersMu.Unlock()

	// Notify others about join
	room.Broadcast <- &Message{
		Type:   "join",
		From:   peerID,
		RoomID: roomID,
	}

	go s.handlePeer(peer, room)
	go s.writePump(peer)
}

func (s *SignalingServer) handlePeer(peer *Peer, room *Room) {
	defer func() {
		room.PeersMu.Lock()
		delete(room.Peers, peer.ID)
		room.PeersMu.Unlock()

		room.Broadcast <- &Message{
			Type:   "leave",
			From:   peer.ID,
			RoomID: room.ID,
		}

		peer.Conn.Close()
	}()

	for {
		var msg Message
		if err := peer.Conn.ReadJSON(&msg); err != nil {
			return
		}

		msg.From = peer.ID
		msg.RoomID = room.ID

		if msg.To != "" {
			// Direct message to specific peer
			room.PeersMu.RLock()
			if target, exists := room.Peers[msg.To]; exists {
				target.Send <- &msg
			}
			room.PeersMu.RUnlock()
		} else {
			// Broadcast to all
			room.Broadcast <- &msg
		}
	}
}

func (s *SignalingServer) broadcastLoop(room *Room) {
	for msg := range room.Broadcast {
		room.PeersMu.RLock()
		for _, peer := range room.Peers {
			if peer.ID != msg.From {
				select {
				case peer.Send <- msg:
				default:
					log.Printf("Failed to send to peer %s", peer.ID)
				}
			}
		}
		room.PeersMu.RUnlock()
	}
}

func (s *SignalingServer) writePump(peer *Peer) {
	defer peer.Conn.Close()

	for msg := range peer.Send {
		if err := peer.Conn.WriteJSON(msg); err != nil {
			return
		}
	}
}

func (s *SignalingServer) isActiveParticipant(roomID, userID string) bool {
	var exists bool
	if err := s.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM participants WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL)",
		roomID, userID,
	).Scan(&exists); err != nil {
		return false
	}
	return exists
}
