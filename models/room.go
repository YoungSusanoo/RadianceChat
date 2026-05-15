package models

import "time"

type Room struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Type       string    `json:"type"` // public, private
	HostID     string    `json:"host_id"`
	InviteLink string    `json:"invite_link"`
	CreatedAt  time.Time `json:"created_at"`
	Status     string    `json:"status"` // active, ended
        IsHost     bool      `json:"is_host"`
}

type CreateRoomRequest struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type Participant struct {
	ID       string     `json:"id"`
	RoomID   string     `json:"room_id"`
	UserID   string     `json:"user_id"`
	Role     string     `json:"role"` // host, participant
	JoinedAt time.Time  `json:"joined_at"`
	LeftAt   *time.Time `json:"left_at,omitempty"`
	Username string     `json:"username"`
}
