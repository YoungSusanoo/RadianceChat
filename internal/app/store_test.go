package app

import "testing"

func TestMemoryStoreAuthAndMessages(t *testing.T) {
	store := NewMemoryStore()
	user, _, err := store.Register("Demo", "demo@example.com", "test1234")
	if err != nil {
		t.Fatal(err)
	}
	room, _, err := store.CreateRoom(user, "Persistent call", "", "public")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(room.ID, user, "hello after restart"); err != nil {
		t.Fatal(err)
	}

	loggedIn, _, err := store.Login("demo@example.com", "test1234")
	if err != nil {
		t.Fatal(err)
	}
	if loggedIn.ID != user.ID {
		t.Fatalf("expected user %s, got %s", user.ID, loggedIn.ID)
	}
	rooms := store.PublicRooms()
	if len(rooms) != 1 || rooms[0].ID != room.ID {
		t.Fatalf("expected room, got %+v", rooms)
	}
	messages, err := store.MessagesForUser(room.ID, loggedIn)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].Text != "hello after restart" {
		t.Fatalf("expected message, got %+v", messages)
	}
}

func TestLeaveRoomTransfersHost(t *testing.T) {
	store := NewMemoryStore()
	host, _, err := store.Register("Host", "host@example.com", "test1234")
	if err != nil {
		t.Fatal(err)
	}
	guest, _, err := store.Register("Guest", "guest@example.com", "test1234")
	if err != nil {
		t.Fatal(err)
	}
	room, _, err := store.CreateRoom(host, "Team call", "", "public")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.JoinRoom(room.ID, guest); err != nil {
		t.Fatal(err)
	}

	room, _, participants, err := store.LeaveRoom(room.ID, host)
	if err != nil {
		t.Fatal(err)
	}
	if room.HostID != guest.ID {
		t.Fatalf("expected host transfer to %s, got %s", guest.ID, room.HostID)
	}
	if len(participants) != 1 || participants[0].UserID != guest.ID || participants[0].Role != "host" {
		t.Fatalf("expected guest to become host, got %+v", participants)
	}
	if _, err := store.EndRoom(room.ID, guest); err != nil {
		t.Fatalf("new host should be able to end room: %v", err)
	}
}

func TestLeaveRoomEndsEmptyRoom(t *testing.T) {
	store := NewMemoryStore()
	host, _, err := store.Register("Host", "host@example.com", "test1234")
	if err != nil {
		t.Fatal(err)
	}
	room, _, err := store.CreateRoom(host, "Empty call", "", "public")
	if err != nil {
		t.Fatal(err)
	}

	room, _, participants, err := store.LeaveRoom(room.ID, host)
	if err != nil {
		t.Fatal(err)
	}
	if room.Active {
		t.Fatalf("expected empty room to end: %+v", room)
	}
	if len(participants) != 0 {
		t.Fatalf("expected no participants, got %+v", participants)
	}
}
