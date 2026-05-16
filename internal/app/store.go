package app

import "errors"

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrConflict     = errors.New("conflict")
	ErrForbidden    = errors.New("forbidden")
	ErrBadRequest   = errors.New("bad request")
)

type Store interface {
	Register(name, email, password string) (User, string, error)
	Login(email, password string) (User, string, error)
	Logout(token string)
	UserByToken(token string) (User, error)

	PublicRooms() []PublicRoom
	CreateRoom(host User, name, description, visibility string) (Room, Participant, error)
	Room(id string) (Room, []Participant, error)
	RoomForUser(id string, user User) (Room, []Participant, error)
	RoomByInvite(invite string) (Room, error)
	JoinRoom(roomID string, user User) (Room, Participant, []Participant, error)
	JoinRoomByInvite(roomID string, user User) (Room, Participant, []Participant, error)
	LeaveRoom(roomID string, user User) (Room, Participant, []Participant, error)
	EndRoom(roomID string, actor User) (Room, error)

	SetDevice(roomID string, user User, muted, cameraOn bool) (Participant, error)
	MuteParticipant(roomID, targetID string, actor User) (Participant, error)
	KickParticipant(roomID, targetID string, actor User) (Participant, error)
	IsParticipant(roomID, userID string) bool

	AddMessage(roomID string, user User, text string) (Message, error)
	Messages(roomID string) ([]Message, error)
	MessagesForUser(roomID string, user User) ([]Message, error)
}
