# Radiance Architecture

## Decision

Use Go for the backend and keep the first implementation as a modular monolith.

The prototype avoids Kafka because the system requirements are mostly synchronous and realtime-room oriented. Kafka would add deployment and testing complexity without improving the core demo. The architecture leaves an event boundary, so Kafka or Redpanda can be introduced later for analytics, audit logs, notifications and cross-service integration.

## Containers

```text
Browser Client
  -> Go Backend: REST API, SSE/WebSocket gateway, LiveKit token issuer
  -> LiveKit SFU: WebRTC audio/video

Go Backend
  -> PostgreSQL: users, rooms, messages, participants, calls
  -> Redis: sessions, room presence, pub/sub for realtime events
  -> LiveKit API: room/token management

LiveKit SFU
  -> Redis: SFU cluster coordination
  -> coturn: TURN relay for NAT/firewall cases
```

The current repository implements `Browser Client -> Go Backend` and local camera/microphone preview. LiveKit integration is represented by `/api/v1/rooms/{roomId}/media-token`.

## Domains

- Identity and access: users, sessions, auth
- Rooms: public/private rooms, invite links, room lifecycle
- Participants: join, leave, reconnect, role, device state
- Moderation: host mute, kick, end room
- Chat: in-call messages and recent history
- Media: LiveKit SFU tokens and WebRTC connection
- Observability: health checks and metrics endpoint

## Data Model

```text
users(id, name, email, password_hash, created_at)
sessions(token, user_id, expires_at)
rooms(id, name, description, visibility, host_id, invite_token, active, created_at, ended_at)
room_participants(room_id, user_id, role, muted, camera_on, joined_at, last_seen, connected)
messages(id, room_id, user_id, text, created_at)
calls(id, room_id, started_at, ended_at)
call_participants(call_id, user_id, joined_at, left_at)
audit_events(id, actor_id, room_id, type, payload, created_at)
```

## Availability Preference

The system should prefer availability for realtime interaction. Strong consistency is important for authentication and room ownership, but participant presence, chat delivery and media state may be eventually consistent under failures.

## Scaling Path

1. Replace in-memory store with PostgreSQL.
2. Replace in-process sessions and event broker with Redis.
3. Replace SSE with WebSocket for bidirectional realtime control.
4. Add LiveKit SFU and coturn for real audio/video across clients.
5. Add multiple Go backend replicas behind a load balancer.
6. Add Kafka/Redpanda only for durable asynchronous events.

## Load Testing Strategy

- HTTP API: k6 scenarios for login, room creation, join, messages and moderation.
- Realtime control plane: k6 SSE/WebSocket scenarios for participant and chat event latency.
- Media plane: synthetic WebRTC clients against LiveKit, measuring RTT, jitter, packet loss, CPU and bandwidth.
- Stress tests: increase virtual users until p95 API latency, event delivery or SFU CPU crosses target thresholds.

## Bottlenecks and Workarounds

- SFU bandwidth: shard rooms across LiveKit nodes and use simulcast/adaptive stream.
- NAT/firewall failures: provide coturn and monitor TURN relay bandwidth.
- Presence fan-out: move from in-process broker to Redis Pub/Sub.
- Hot rooms: cap participants at 15 according to requirements, then introduce multiple SFU nodes for larger meetings.
- Chat write bursts: batch writes or use Redis queue before PostgreSQL.

