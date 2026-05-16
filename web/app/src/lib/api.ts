import type { AuthResponse, MediaToken, Message, Participant, PublicRoom, Room, RoomPayload, User } from "./types";

const tokenKey = "radiance.token";

export const tokenStore = {
  get: () => localStorage.getItem(tokenKey) || "",
  set: (token: string) => localStorage.setItem(tokenKey, token),
  clear: () => localStorage.removeItem(tokenKey)
};

type ApiOptions = RequestInit & {
  token?: string;
};

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = options.token ?? tokenStore.get();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("Сервер недоступен. Проверьте, что backend запущен.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

const body = (value: unknown) => JSON.stringify(value);

export const api = {
  register: (payload: { name: string; email: string; password: string }) =>
    request<AuthResponse>("/api/v1/auth/register", { method: "POST", body: body(payload) }),

  login: (payload: { email: string; password: string }) =>
    request<AuthResponse>("/api/v1/auth/login", { method: "POST", body: body(payload) }),

  logout: () => request<{ status: string }>("/api/v1/auth/logout", { method: "POST", body: "{}" }),

  me: () => request<User>("/api/v1/auth/me"),

  rooms: () => request<PublicRoom[]>("/api/v1/rooms"),

  createRoom: (payload: { name: string; description: string; visibility: "public" | "private" }) =>
    request<RoomPayload>("/api/v1/rooms", { method: "POST", body: body(payload) }),

  room: (roomId: string) => request<RoomPayload>(`/api/v1/rooms/${roomId}`),

  joinRoom: (roomId: string) =>
    request<RoomPayload>(`/api/v1/rooms/${roomId}/join`, { method: "POST", body: "{}" }),

  leaveRoom: (roomId: string) =>
    request<Participant>(`/api/v1/rooms/${roomId}/leave`, { method: "POST", body: "{}" }),

  endRoom: (roomId: string) =>
    request<Room>(`/api/v1/rooms/${roomId}/end`, { method: "POST", body: "{}" }),

  messages: (roomId: string) => request<Message[]>(`/api/v1/rooms/${roomId}/messages`),

  sendMessage: (roomId: string, text: string) =>
    request<Message>(`/api/v1/rooms/${roomId}/messages`, { method: "POST", body: body({ text }) }),

  setDevice: (roomId: string, payload: { muted: boolean; cameraOn: boolean }) =>
    request<Participant>(`/api/v1/rooms/${roomId}/device`, { method: "PATCH", body: body(payload) }),

  muteParticipant: (roomId: string, userId: string) =>
    request<Participant>(`/api/v1/rooms/${roomId}/participants/${userId}`, { method: "POST", body: "{}" }),

  kickParticipant: (roomId: string, userId: string) =>
    request<Participant>(`/api/v1/rooms/${roomId}/participants/${userId}`, { method: "DELETE" }),

  joinInvite: (inviteToken: string) =>
    request<RoomPayload>(`/api/v1/invites/${inviteToken}/join`, { method: "POST", body: "{}" }),

  mediaToken: (roomId: string) =>
    request<MediaToken>(`/api/v1/rooms/${roomId}/media-token`, { method: "POST", body: "{}" })
};

export function eventSourceUrl(roomId: string): string {
  const token = encodeURIComponent(tokenStore.get());
  return `/api/v1/rooms/${roomId}/events?access_token=${token}`;
}
