package realtime

import (
	"sync"
	"time"
)

type Event struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
	At   time.Time   `json:"at"`
}

type Broker struct {
	mu    sync.RWMutex
	rooms map[string]map[chan Event]struct{}
}

func NewBroker() *Broker {
	return &Broker{rooms: map[string]map[chan Event]struct{}{}}
}

func (b *Broker) Subscribe(roomID string) (<-chan Event, func()) {
	ch := make(chan Event, 32)
	b.mu.Lock()
	if b.rooms[roomID] == nil {
		b.rooms[roomID] = map[chan Event]struct{}{}
	}
	b.rooms[roomID][ch] = struct{}{}
	b.mu.Unlock()

	unsubscribe := func() {
		b.mu.Lock()
		if subs, ok := b.rooms[roomID]; ok {
			delete(subs, ch)
			if len(subs) == 0 {
				delete(b.rooms, roomID)
			}
		}
		close(ch)
		b.mu.Unlock()
	}
	return ch, unsubscribe
}

func (b *Broker) Publish(roomID, typ string, data interface{}) {
	event := Event{Type: typ, Data: data, At: time.Now().UTC()}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.rooms[roomID] {
		select {
		case ch <- event:
		default:
		}
	}
}
