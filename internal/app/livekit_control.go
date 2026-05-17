package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type MediaControl interface {
	RemoveParticipant(ctx context.Context, roomID, userID string) error
	DeleteRoom(ctx context.Context, roomID string) error
	MuteAudio(ctx context.Context, roomID, userID string) error
}

type noopMediaControl struct{}

func (noopMediaControl) RemoveParticipant(context.Context, string, string) error { return nil }
func (noopMediaControl) DeleteRoom(context.Context, string) error                { return nil }
func (noopMediaControl) MuteAudio(context.Context, string, string) error         { return nil }

type liveKitControl struct {
	baseURL   string
	apiKey    string
	apiSecret string
	client    *http.Client
}

func NewLiveKitControl(cfg Config) MediaControl {
	baseURL := liveKitHTTPURL(cfg)
	if baseURL == "" || strings.TrimSpace(cfg.LiveKitAPIKey) == "" || strings.TrimSpace(cfg.LiveKitAPISecret) == "" {
		return noopMediaControl{}
	}
	return &liveKitControl{
		baseURL:   strings.TrimRight(baseURL, "/"),
		apiKey:    strings.TrimSpace(cfg.LiveKitAPIKey),
		apiSecret: strings.TrimSpace(cfg.LiveKitAPISecret),
		client:    &http.Client{Timeout: 5 * time.Second},
	}
}

func liveKitHTTPURL(cfg Config) string {
	if strings.TrimSpace(cfg.LiveKitAPIURL) != "" {
		return strings.TrimSpace(cfg.LiveKitAPIURL)
	}
	url := strings.TrimSpace(cfg.LiveKitURL)
	url = strings.TrimPrefix(url, "ws://")
	if url != strings.TrimSpace(cfg.LiveKitURL) {
		return "http://" + url
	}
	url = strings.TrimPrefix(url, "wss://")
	if url != strings.TrimSpace(cfg.LiveKitURL) {
		return "https://" + url
	}
	return url
}

func (c *liveKitControl) RemoveParticipant(ctx context.Context, roomID, userID string) error {
	return c.post(ctx, "RemoveParticipant", roomID, map[string]interface{}{
		"room":     roomID,
		"identity": userID,
	}, nil)
}

func (c *liveKitControl) DeleteRoom(ctx context.Context, roomID string) error {
	return c.post(ctx, "DeleteRoom", roomID, map[string]interface{}{
		"room": roomID,
	}, nil)
}

func (c *liveKitControl) MuteAudio(ctx context.Context, roomID, userID string) error {
	var participant liveKitParticipant
	if err := c.post(ctx, "GetParticipant", roomID, map[string]interface{}{
		"room":     roomID,
		"identity": userID,
	}, &participant); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		return err
	}

	for _, track := range participant.Tracks {
		if !track.isAudio() || track.Muted {
			continue
		}
		if err := c.post(ctx, "MutePublishedTrack", roomID, map[string]interface{}{
			"room":     roomID,
			"identity": userID,
			"trackSid": track.SID,
			"muted":    true,
		}, nil); err != nil {
			return err
		}
	}
	return nil
}

func (c *liveKitControl) post(ctx context.Context, method, roomID string, payload interface{}, dst interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/twirp/livekit.RoomService/"+method, bytes.NewReader(body))
	if err != nil {
		return err
	}
	token, err := signLiveKitAdminToken(c.apiKey, c.apiSecret, roomID)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	res, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var twirpErr struct {
			Code string `json:"code"`
			Msg  string `json:"msg"`
		}
		if err := json.NewDecoder(res.Body).Decode(&twirpErr); err == nil {
			if twirpErr.Code == "not_found" {
				return ErrNotFound
			}
			if twirpErr.Msg != "" {
				return fmt.Errorf("livekit %s failed: %s", method, twirpErr.Msg)
			}
		}
		return fmt.Errorf("livekit %s failed: %s", method, res.Status)
	}
	if dst == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(dst)
}

type liveKitParticipant struct {
	Tracks []liveKitTrack `json:"tracks"`
}

type liveKitTrack struct {
	SID    string      `json:"sid"`
	Type   interface{} `json:"type"`
	Source interface{} `json:"source"`
	Muted  bool        `json:"muted"`
}

func (t liveKitTrack) isAudio() bool {
	switch value := t.Type.(type) {
	case string:
		return value == "AUDIO"
	case float64:
		return value == 0
	}
	switch value := t.Source.(type) {
	case string:
		return value == "MICROPHONE"
	case float64:
		return value == 2
	}
	return false
}
