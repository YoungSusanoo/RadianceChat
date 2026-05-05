package signaling

import (
	"database/sql"
	"log"
	"net/http"
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
	Type   string      `json:"type"` // offer, answer, candidate, join, leave
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

    // ИСПОЛЬЗУЕМ token: Простая проверка на наличие
    if token == "" {
        log.Printf("Rejecting connection: No token provided for room %s", roomID)
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
        return
    }

    username := r.URL.Query().Get("username")
    if username == "" {
        username = "Участник"
    }

    // ... (код проверки token и roomID остается прежним) ...

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

    // 2. Формируем список участников для нового пользователя
    room.PeersMu.RLock()
    var participants []map[string]string
    for id := range room.Peers {
        participants = append(participants, map[string]string{
            "id":       id,
            "username": "Участник", 
        })
    }
    room.PeersMu.RUnlock()

    // 3. Регистрируем пира
    room.PeersMu.Lock()
    room.Peers[peerID] = peer
    room.PeersMu.Unlock()

    // 4. Отправляем состояние комнаты новому пользователю
    peer.Send <- &Message{
        Type: "room_state",
        Data: map[string]interface{}{
            "participants": participants,
        },
    }

    // 5. Уведомляем остальных (теперь 'username' определен выше)
    room.Broadcast <- &Message{
        Type:   "user_joined",
        From:   peerID,
        Data:   map[string]string{"userId": peerID, "username": username},
        RoomID: roomID,
    }

    log.Printf("User %s connected to room %s as peer %s", userID, roomID, peerID)

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
		log.Printf("Peer %s disconnected from room %s", peer.ID, room.ID)
	}()

	for {
		var msg Message
		if err := peer.Conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		msg.From = peer.ID
		msg.RoomID = room.ID

		// Если указан конкретный получатель (To), шлем ему. Иначе — всем в комнате.
		if msg.To != "" {
			room.PeersMu.RLock()
			if target, exists := room.Peers[msg.To]; exists {
				target.Send <- &msg
			}
			room.PeersMu.RUnlock()
		} else {
			room.Broadcast <- &msg
		}
	}
}

func (s *SignalingServer) broadcastLoop(room *Room) {
	for msg := range room.Broadcast {
		room.PeersMu.RLock()
		for _, peer := range room.Peers {
			// Не шлем сообщение самому себе
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
			return
		}
	}
}