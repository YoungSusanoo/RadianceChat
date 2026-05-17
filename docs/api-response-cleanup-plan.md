# API Response Cleanup Plan

## Problem

Some API endpoints currently return more data than the client needs. Command-like operations such as leaving a room, ending a room, muting a participant and kicking a participant can be represented as successful state transitions without returning full room or participant objects.

Public responses should also avoid leaking room invite tokens. A user should receive `inviteToken` only after creating or joining a room, not from the public room list or invite preview.

## Target Contract

- Use response DTOs instead of returning domain models directly.
- Return `204 No Content` for successful command endpoints with no useful response body.
- Return `RoomState` only when the client needs the current room plus participant list.
- Return `RoomSummary` for public room lists without `inviteToken`.
- Return `InvitePreview` for invite resolution without repeating the invite token.

## Deferred Backend Work

The backend implementation is not changed before the defense. The OpenAPI contract documents the cleaner target behavior, and the runtime code can be aligned with this contract after the defense.
