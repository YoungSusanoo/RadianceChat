# Radiance Diagrams

Report diagrams are split into standalone Mermaid files so they can be exported to PNG/SVG and inserted into the final document.

## High-Level Design

File: [`docs/diagrams/high-level.mmd`](diagrams/high-level.mmd)

This diagram intentionally stays implementation-light. It shows only the main system blocks:

- Frontend
- API Gateway / Reverse Proxy
- Backend Services
- LiveKit SFU
- PostgreSQL

In the current prototype, the API Gateway role is implemented by nginx reverse proxy. Calling it `API Gateway / Reverse Proxy` is more accurate than showing a separate full-featured API gateway product.

## Low-Level Design

File: [`docs/diagrams/low-level.mmd`](diagrams/low-level.mmd)

This diagram shows the implementation composition:

- client: React + TypeScript web application and LiveKit client SDK;
- gateway: nginx as API Gateway / Reverse Proxy;
- backend API: Auth API, Rooms API, Participants API, Messages API, Realtime API and Media API;
- backend services: Auth, Room, Participant, Chat, Realtime Event and Media Control services;
- media plane: LiveKit SFU, with optional embedded TURN for restrictive networks;
- storage: PostgreSQL.

## Data Schema

File: [`docs/diagrams/data-schema.mmd`](diagrams/data-schema.mmd)

This ER diagram follows the physical schema from [`migrations/001_init.sql`](../migrations/001_init.sql):

- `users`
- `sessions`
- `rooms`
- `room_participants`
- `messages`
- `calls`
- `call_participants`
- `audit_events`

Main relationship notes:

- `users.email` and `rooms.invite_token` are unique.
- `room_participants` uses `(room_id, user_id)` as the primary key.
- `call_participants` uses `(call_id, user_id, joined_at)` as the primary key.
- `rooms.host_id` references `users.id`.
- `messages` belong to both a room and an author.

## Export

Example export commands:

```bash
mmdc -i docs/diagrams/high-level.mmd -o docs/diagrams/high-level.png -b white
mmdc -i docs/diagrams/low-level.mmd -o docs/diagrams/low-level.png -b white
mmdc -i docs/diagrams/data-schema.mmd -o docs/diagrams/data-schema.png -b white
```
