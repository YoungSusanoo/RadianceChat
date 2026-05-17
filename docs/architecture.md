# Radiance Architecture

Report-ready diagrams are collected in [`docs/diagrams.md`](diagrams.md): high-level design, low-level design and data schema. Non-functional requirement compliance is described in [`docs/nfr-compliance.md`](nfr-compliance.md).

## Decision

Use Go for the backend and keep the first implementation as a modular monolith.

The prototype avoids Kafka because the system requirements are mostly synchronous and realtime-room oriented. Kafka would add deployment and testing complexity without improving the core demo. The architecture leaves an event boundary, so Kafka or Redpanda can be introduced later for analytics, audit logs, notifications and cross-service integration.

## Containers

```text
Browser Client: React + TypeScript + LiveKit client
  -> nginx: web application, REST API and SSE
  -> LiveKit SFU: public signaling and WebRTC audio/video

Go Backend
  -> PostgreSQL: users, rooms, messages, participants, calls
  -> LiveKit API: room/token management

LiveKit SFU
  -> exposed media ports for WebRTC
```

The current repository implements `Browser Client -> nginx -> Go Backend -> PostgreSQL`, SQL migrations, LiveKit token issuing and browser-side LiveKit connection. LiveKit is not proxied through nginx in the server deployment; browsers connect to the public LiveKit signaling URL returned by the Media API. If LiveKit is not running, the UI falls back to local camera/microphone preview.

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

The physical PostgreSQL schema is in `migrations/001_init.sql`.

## Availability Preference

The system should prefer availability for realtime interaction. Strong consistency is important for authentication and room ownership, but participant presence, chat delivery and media state may be eventually consistent under failures.

## Scaling Path

1. Replace SSE with WebSocket for bidirectional realtime control.
2. Add Redis Pub/Sub for room presence and realtime fan-out across multiple Go replicas.
3. Add multiple Go backend replicas behind a load balancer.
4. Add Kafka/Redpanda only for durable asynchronous events.

## Load Testing Strategy

- HTTP API: k6 scenarios for login, room creation, join, messages and moderation.
- Realtime control plane: k6 SSE/WebSocket scenarios for participant and chat event latency.
- Media plane: synthetic WebRTC clients against LiveKit, measuring RTT, jitter, packet loss, CPU and bandwidth.
- Stress tests: increase virtual users until p95 API latency, event delivery or SFU CPU crosses target thresholds.

## Bottlenecks and Workarounds

- SFU bandwidth: shard rooms across LiveKit nodes and use simulcast/adaptive stream.
- NAT/firewall failures: enable LiveKit TURN when LAN/media tests show direct ICE is not enough.
- Presence fan-out: move from in-process broker to Redis Pub/Sub when backend replicas are introduced.
- Hot rooms: cap participants at 15 according to requirements, then introduce multiple SFU nodes for larger meetings.
- Chat write bursts: keep PostgreSQL writes direct for the course prototype; add queueing only if load tests show it is needed.
