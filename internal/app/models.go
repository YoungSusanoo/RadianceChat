package app

import "time"

type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Session struct {
	Token     string
	UserID    string
	ExpiresAt time.Time
}

type Room struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Visibility  string    `json:"visibility"`
	HostID      string    `json:"hostId"`
	InviteToken string    `json:"inviteToken"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"createdAt"`
	EndedAt     time.Time `json:"endedAt,omitempty"`
}

type Participant struct {
	RoomID    string    `json:"roomId"`
	UserID    string    `json:"userId"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	Muted     bool      `json:"muted"`
	CameraOn  bool      `json:"cameraOn"`
	JoinedAt  time.Time `json:"joinedAt"`
	LastSeen  time.Time `json:"lastSeen"`
	Connected bool      `json:"connected"`
}

type Message struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"roomId"`
	UserID    string    `json:"userId"`
	UserName  string    `json:"userName"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

type Event struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
	At   time.Time   `json:"at"`
}

type PublicRoom struct {
	Room
	Participants int `json:"participants"`
}
