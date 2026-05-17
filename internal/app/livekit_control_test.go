package app

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestLiveKitControlRemoveParticipant(t *testing.T) {
	var gotPath string
	var gotAuth string
	var gotBody struct {
		Room     string `json:"room"`
		Identity string `json:"identity"`
	}
	control := &liveKitControl{
		baseURL:   "http://livekit",
		apiKey:    "key",
		apiSecret: "secret",
		client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			gotPath = r.URL.Path
			gotAuth = r.Header.Get("Authorization")
			if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
				t.Fatal(err)
			}
			return liveKitTestResponse(http.StatusOK, `{}`), nil
		})},
	}
	if err := control.RemoveParticipant(t.Context(), "room-1", "user-1"); err != nil {
		t.Fatal(err)
	}

	if gotPath != "/twirp/livekit.RoomService/RemoveParticipant" {
		t.Fatalf("path = %s", gotPath)
	}
	if !strings.HasPrefix(gotAuth, "Bearer ") {
		t.Fatalf("authorization = %s", gotAuth)
	}
	if gotBody.Room != "room-1" || gotBody.Identity != "user-1" {
		t.Fatalf("body = %+v", gotBody)
	}
}

func TestLiveKitControlMuteAudio(t *testing.T) {
	var called []string
	var mutedTrack string
	control := &liveKitControl{
		baseURL:   "http://livekit",
		apiKey:    "key",
		apiSecret: "secret",
		client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			called = append(called, r.URL.Path)
			switch r.URL.Path {
			case "/twirp/livekit.RoomService/GetParticipant":
				return liveKitTestResponse(http.StatusOK, `{
				"tracks": [
					{"sid": "audio-track", "type": "AUDIO", "source": "MICROPHONE", "muted": false},
					{"sid": "video-track", "type": "VIDEO", "source": "CAMERA", "muted": false}
				]
			}`), nil
			case "/twirp/livekit.RoomService/MutePublishedTrack":
				var body struct {
					TrackSID string `json:"trackSid"`
					Muted    bool   `json:"muted"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if !body.Muted {
					t.Fatal("expected muted=true")
				}
				mutedTrack = body.TrackSID
				return liveKitTestResponse(http.StatusOK, `{}`), nil
			default:
				t.Fatalf("unexpected path %s", r.URL.Path)
			}
			return nil, nil
		})},
	}
	if err := control.MuteAudio(t.Context(), "room-1", "user-1"); err != nil {
		t.Fatal(err)
	}

	if len(called) != 2 {
		t.Fatalf("called = %+v", called)
	}
	if mutedTrack != "audio-track" {
		t.Fatalf("muted track = %s", mutedTrack)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return fn(r)
}

func liveKitTestResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Body:       io.NopCloser(bytes.NewBufferString(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}
}
