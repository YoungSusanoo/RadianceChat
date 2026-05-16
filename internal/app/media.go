package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

func (s *Server) mediaToken(roomID string, user User) (string, error) {
	if strings.TrimSpace(s.cfg.LiveKitAPIKey) == "" || strings.TrimSpace(s.cfg.LiveKitAPISecret) == "" {
		return "", ErrBadRequest
	}
	room, _, err := s.store.Room(roomID)
	if err != nil {
		return "", err
	}
	if !room.Active {
		return "", ErrNotFound
	}
	if !s.store.IsParticipant(roomID, user.ID) {
		return "", ErrForbidden
	}
	return signLiveKitToken(s.cfg.LiveKitAPIKey, s.cfg.LiveKitAPISecret, roomID, user)
}

func signLiveKitToken(apiKey, apiSecret, roomID string, user User) (string, error) {
	now := time.Now().UTC()
	header := map[string]string{
		"alg": "HS256",
		"typ": "JWT",
	}
	claims := map[string]interface{}{
		"iss":  apiKey,
		"sub":  user.ID,
		"name": user.Name,
		"nbf":  now.Unix() - 10,
		"exp":  now.Add(2 * time.Hour).Unix(),
		"video": map[string]interface{}{
			"roomJoin":       true,
			"room":           roomID,
			"canPublish":     true,
			"canSubscribe":   true,
			"canPublishData": true,
		},
	}

	head, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	unsigned := b64(head) + "." + b64(body)
	mac := hmac.New(sha256.New, []byte(apiSecret))
	if _, err := mac.Write([]byte(unsigned)); err != nil {
		return "", err
	}
	signature := b64(mac.Sum(nil))
	if signature == "" {
		return "", errors.New("empty jwt signature")
	}
	return unsigned + "." + signature, nil
}

func b64(payload []byte) string {
	return base64.RawURLEncoding.EncodeToString(payload)
}
