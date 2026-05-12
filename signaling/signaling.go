package signaling

import (
	"database/sql"
	"log"
	"net/http"
	"radiance/middleware"
	"sync"
	"time"

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
	ID       string
	UserID   string
	Username string
	Conn     *websocket.Conn
	Send     chan *Message
	RoomID   string
}

type Message struct {
	Type   string      `json:"type"` // offer, answer, candidate, join, leave, room_state
	From   string      `json:"from"`
	To     string      `json:"to,omitempty"`
	RoomID string      `json:"room_id,omitempty"`
	Data   interface{} `json:"data,omitempty"`
}

func NewSignalingServer(db *sql.DB, jwtSecret string) *SignalingServer {
	return &SignalingServer{
		db:    db,
		rooms: make(map[string]*Room),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Разрешаем все домены для разработки
			},
		},
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
	token := r.URL.Query().Get("token")
	roomID := r.PathValue("room")
	userID := r.URL.Query().Get("user_id")
	username := r.URL.Query().Get("username")

	// Validate JWT token
	if token == "" {
		log.Printf("Rejecting connection: No token provided for room %s", roomID)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Verify token and extract user ID
	claims, err := middleware.VerifyToken(token, s.jwtSecret)
	if err != nil {
		log.Printf("Rejecting connection: Invalid token for room %s: %v", roomID, err)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Use the user ID from the validated token
	userID = claims.UserID

	var roomActive bool
	if err := s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM rooms WHERE id = $1 AND status = 'active')", roomID).Scan(&roomActive); err != nil {
		log.Printf("Rejecting connection: room status check failed for %s: %v", roomID, err)
		http.Error(w, "Room status check failed", http.StatusInternalServerError)
		return
	}
	if !roomActive {
		log.Printf("Rejecting connection: room %s is not active", roomID)
		http.Error(w, "Room is not active", http.StatusNotFound)
		return
	}

	if username == "" {
		username = "Участник"
	}

	// Upgrade to WebSocket
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	room := s.getOrCreateRoom(roomID)
	peerID := uuid.New().String()

	peer := &Peer{
		ID:       peerID,
		UserID:   userID,
		Username: username,
		Conn:     conn,
		Send:     make(chan *Message, 5),
		RoomID:   roomID,
	}

	// Build list of existing participants for new user
	room.PeersMu.RLock()
	var participants []map[string]string
	for id, p := range room.Peers {
		participants = append(participants, map[string]string{
			"id":       id,
			"userId":   p.UserID,
			"username": p.Username,
		})
	}
	room.PeersMu.RUnlock()

	// Register peer
	room.PeersMu.Lock()
	room.Peers[peerID] = peer
	room.PeersMu.Unlock()

	// Send room state to new user
	peer.Send <- &Message{
		Type: "room_state",
		Data: map[string]interface{}{
			"participants": participants,
		},
	}

	// Notify others about new user
	room.Broadcast <- &Message{
		Type:   "user_joined",
		From:   peerID,
		Data:   map[string]string{"userId": userID, "username": username},
		RoomID: roomID,
	}

	log.Printf("User %s (peer %s) connected to room %s", userID, peerID, roomID)

	go s.handlePeer(peer, room)
	go s.writePump(peer)
}

func (s *SignalingServer) handlePeer(peer *Peer, room *Room) {
	defer func() {
		room.PeersMu.Lock()
		delete(room.Peers, peer.ID)
		room.PeersMu.Unlock()

		room.Broadcast <- &Message{
			Type:   "user_left",
			From:   peer.ID,
			Data:   map[string]string{"userId": peer.UserID, "username": peer.Username},
			RoomID: room.ID,
		}
		peer.Conn.Close()
		log.Printf("Peer %s (user %s) disconnected from room %s", peer.ID, peer.UserID, room.ID)
	}()

	for {
		var msg Message
		if err := peer.Conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Set the from field to the peer's ID
		msg.From = peer.ID
		msg.RoomID = room.ID

		if s.handleControlMessage(peer, room, &msg) {
			continue
		}

		// If a specific recipient is specified, send only to them
		if msg.To != "" {
			room.PeersMu.RLock()
			if target, exists := room.Peers[msg.To]; exists {
				target.Send <- &msg
			}
			room.PeersMu.RUnlock()
		} else {
			// Broadcast to all peers in the room
			room.Broadcast <- &msg
		}
	}
}

func (s *SignalingServer) handleControlMessage(peer *Peer, room *Room, msg *Message) bool {
	switch msg.Type {
	case "mute_participant":
		if !s.isRoomHost(room.ID, peer.UserID) {
			peer.Send <- &Message{Type: "control_error", From: peer.ID, RoomID: room.ID, Data: map[string]string{"error": "Only host can mute participants"}}
			return true
		}
		if msg.To == "" {
			return true
		}
		room.PeersMu.RLock()
		target, exists := room.Peers[msg.To]
		room.PeersMu.RUnlock()
		if exists {
			target.Send <- &Message{Type: "force_mute", From: peer.ID, RoomID: room.ID, Data: map[string]string{"reason": "Организатор отключил ваш микрофон"}}
		}
		return true
	case "remove_participant":
		if !s.isRoomHost(room.ID, peer.UserID) {
			peer.Send <- &Message{Type: "control_error", From: peer.ID, RoomID: room.ID, Data: map[string]string{"error": "Only host can remove participants"}}
			return true
		}
		if msg.To == "" {
			return true
		}
		room.PeersMu.RLock()
		target, exists := room.Peers[msg.To]
		room.PeersMu.RUnlock()
		if exists {
			_, _ = s.db.Exec("UPDATE participants SET left_at = NOW() WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL", room.ID, target.UserID)
			target.Send <- &Message{Type: "participant_removed", From: peer.ID, RoomID: room.ID, Data: map[string]string{"reason": "Организатор удалил вас из комнаты"}}
			go closePeerAfterNotice(target)
		}
		return true
	case "end_call_for_all":
		if !s.isRoomHost(room.ID, peer.UserID) {
			peer.Send <- &Message{Type: "control_error", From: peer.ID, RoomID: room.ID, Data: map[string]string{"error": "Only host can end call for everyone"}}
			return true
		}
		_, _ = s.db.Exec("UPDATE rooms SET status = 'ended', ended_at = NOW() WHERE id = $1", room.ID)
		_, _ = s.db.Exec("UPDATE participants SET left_at = NOW() WHERE room_id = $1 AND left_at IS NULL", room.ID)

		endMessage := &Message{Type: "call_ended_for_all", From: peer.ID, RoomID: room.ID, Data: map[string]string{"reason": "Организатор завершил звонок для всех"}}
		room.PeersMu.RLock()
		for _, target := range room.Peers {
			select {
			case target.Send <- endMessage:
			default:
				log.Printf("Buffer full for peer %s, skipping call end message", target.ID)
			}
			go closePeerAfterNotice(target)
		}
		room.PeersMu.RUnlock()
		return true
	default:
		return false
	}
}

func closePeerAfterNotice(peer *Peer) {
	time.Sleep(250 * time.Millisecond)
	peer.Conn.Close()
}

func (s *SignalingServer) isRoomHost(roomID, userID string) bool {
	var exists bool
	if err := s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM rooms WHERE id = $1 AND host_id = $2 AND status = 'active')", roomID, userID).Scan(&exists); err != nil {
		log.Printf("Failed to check room host for room %s user %s: %v", roomID, userID, err)
		return false
	}
	return exists
}

func (s *SignalingServer) broadcastLoop(room *Room) {
	for msg := range room.Broadcast {
		room.PeersMu.RLock()
		for _, peer := range room.Peers {
			// Don't send message to sender
			if peer.ID != msg.From {
				select {
				case peer.Send <- msg:
				default:
					log.Printf("Buffer full for peer %s, skipping message", peer.ID)
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
			log.Printf("Error writing to peer %s: %v", peer.ID, err)
			return
		}
	}
}
