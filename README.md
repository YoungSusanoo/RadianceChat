# Radiance

Radiance is a course-work prototype for an audio and video calls application.

The implementation is intentionally compact: one Go backend serves the API and static frontend. The architecture keeps clear boundaries for future extraction into services: auth, rooms, participants, moderation, chat, realtime events, and media token issuing.

## Stack

- Backend: Go, standard library HTTP server
- Frontend: static HTML/CSS/JavaScript
- Realtime prototype: Server-Sent Events
- Media prototype: browser `getUserMedia`
- Target production media layer: LiveKit SFU + coturn
- Target storage: PostgreSQL + Redis
- Load tests: k6

Kafka is not used in the prototype because the current requirements do not need durable event streaming. For scale-out, Redis Pub/Sub can first replace the in-process event broker. Kafka/Redpanda becomes useful later for audit events, analytics, notifications, and long-lived asynchronous workflows.

## Run

```bash
go run ./cmd/radiance
```

Open:

```text
http://localhost:8080
```

The app stores data in memory, so restarting the process clears users, rooms and messages.

## Covered Requirements

- Register, login, logout
- Public and private rooms
- Invite links
- Join, leave and reconnect to rooms
- Up to 15 participants per room
- Local microphone and camera controls
- Participant list during a call
- Host role visibility
- Host can mute or kick participants
- Host can end the room
- In-call chat and message history
- Health endpoints for deployment and tests

## API

### Auth

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

### Rooms

```http
GET  /api/v1/rooms
POST /api/v1/rooms
GET  /api/v1/rooms/{roomId}
POST /api/v1/rooms/{roomId}/join
POST /api/v1/rooms/{roomId}/leave
POST /api/v1/rooms/{roomId}/end
PATCH /api/v1/rooms/{roomId}/device
```

### Invites

```http
GET  /api/v1/invites/{inviteToken}
POST /api/v1/invites/{inviteToken}/join
```

### Participants

```http
POST   /api/v1/rooms/{roomId}/participants/{userId}
DELETE /api/v1/rooms/{roomId}/participants/{userId}
```

`POST` mutes a participant, `DELETE` removes the participant from the room.

### Chat

```http
GET  /api/v1/rooms/{roomId}/messages
POST /api/v1/rooms/{roomId}/messages
```

### Realtime Events

```http
GET /api/v1/rooms/{roomId}/events?access_token={token}
```

Events:

- `participant.joined`
- `participant.left`
- `participant.device_changed`
- `participant.muted`
- `participant.kicked`
- `room.ended`
- `chat.message`

### Media Token

```http
POST /api/v1/rooms/{roomId}/media-token
```

For now this returns a placeholder response. In the production design this endpoint issues a signed LiveKit access token after checking that the user can join the room.

