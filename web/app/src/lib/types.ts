export type User = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type Room = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  hostId: string;
  inviteToken: string;
  active: boolean;
  createdAt: string;
  endedAt?: string;
};

export type PublicRoom = Room & {
  participants: number;
};

export type Participant = {
  roomId: string;
  userId: string;
  name: string;
  role: "host" | "participant";
  muted: boolean;
  cameraOn: boolean;
  joinedAt: string;
  lastSeen: string;
  connected: boolean;
};

export type Message = {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
};

export type AuthResponse = {
  user: User;
  token: string;
};

export type RoomPayload = {
  room: Room;
  participant?: Participant;
  participants: Participant[];
};

export type MediaToken = {
  mode: "livekit";
  livekitUrl: string;
  token: string;
};

export type RoomEvent<T = unknown> = {
  type: string;
  data: T;
  at: string;
};

