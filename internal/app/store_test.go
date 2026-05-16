package app

import (
	"path/filepath"
	"testing"
)

func TestStorePersistsSnapshot(t *testing.T) {
	dataFile := filepath.Join(t.TempDir(), "radiance.json")
	store := NewStore(dataFile)

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

	reloaded := NewStore(dataFile)
	loggedIn, _, err := reloaded.Login("demo@example.com", "test1234")
	if err != nil {
		t.Fatal(err)
	}
	if loggedIn.ID != user.ID {
		t.Fatalf("expected user %s, got %s", user.ID, loggedIn.ID)
	}
	rooms := reloaded.PublicRooms()
	if len(rooms) != 1 || rooms[0].ID != room.ID {
		t.Fatalf("expected persisted room, got %+v", rooms)
	}
	messages, err := reloaded.MessagesForUser(room.ID, loggedIn)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].Text != "hello after restart" {
		t.Fatalf("expected persisted message, got %+v", messages)
	}
}
