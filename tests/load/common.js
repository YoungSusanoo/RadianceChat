import http from "k6/http";
import { check, group, sleep } from "k6";

export const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
export const DEFAULT_PASSWORD = "test1234";

export function jsonHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function requestParams(token, name) {
  const params = { headers: jsonHeaders(token) };
  if (name) {
    params.tags = { name };
  }
  return params;
}

export function uniqueSuffix(prefix) {
  return `${prefix}-${__VU}-${__ITER}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

export function jsonValue(response, path) {
  try {
    return path === undefined ? response.json() : response.json(path);
  } catch {
    return undefined;
  }
}

export function registerUser(prefix = "load") {
  const suffix = uniqueSuffix(prefix);
  const response = http.post(`${BASE_URL}/api/v1/auth/register`, JSON.stringify({
    name: `User ${suffix}`,
    email: `${suffix}@example.com`,
    password: DEFAULT_PASSWORD,
  }), requestParams(null, "POST /api/v1/auth/register"));

  check(response, {
    [`${prefix}: register status is 201`]: (r) => r.status === 201,
    [`${prefix}: register returns token`]: (r) => Boolean(jsonValue(r, "token")),
  });

  return {
    response,
    token: jsonValue(response, "token"),
    userId: jsonValue(response, "user.id"),
  };
}

export function createRoom(token, prefix = "room") {
  const suffix = uniqueSuffix(prefix);
  const response = http.post(`${BASE_URL}/api/v1/rooms`, JSON.stringify({
    name: `Room ${suffix}`,
    description: `Load test room ${suffix}`,
    visibility: "public",
  }), requestParams(token, "POST /api/v1/rooms"));

  check(response, {
    [`${prefix}: room created`]: (r) => r.status === 201,
    [`${prefix}: room id exists`]: (r) => Boolean(jsonValue(r, "room.id")),
    [`${prefix}: invite token exists`]: (r) => Boolean(jsonValue(r, "room.inviteToken")),
  });

  return {
    response,
    roomId: jsonValue(response, "room.id"),
    inviteToken: jsonValue(response, "room.inviteToken"),
  };
}

export function getRoom(token, roomId, prefix = "room") {
  const response = http.get(`${BASE_URL}/api/v1/rooms/${roomId}`, requestParams(token, "GET /api/v1/rooms/{roomId}"));
  check(response, {
    [`${prefix}: get room status is 200`]: (r) => r.status === 200,
    [`${prefix}: participants returned`]: (r) => Array.isArray(jsonValue(r, "participants")),
  });
  return response;
}

export function joinInvite(token, inviteToken, prefix = "join") {
  const response = http.post(`${BASE_URL}/api/v1/invites/${inviteToken}/join`, "{}", requestParams(token, "POST /api/v1/invites/{inviteToken}/join"));
  check(response, {
    [`${prefix}: invite join status is 200`]: (r) => r.status === 200,
    [`${prefix}: joined room id exists`]: (r) => Boolean(jsonValue(r, "room.id")),
  });
  return {
    response,
    roomId: jsonValue(response, "room.id"),
  };
}

export function issueMediaToken(token, roomId, prefix = "media") {
  const response = http.post(`${BASE_URL}/api/v1/rooms/${roomId}/media-token`, "{}", requestParams(token, "POST /api/v1/rooms/{roomId}/media-token"));
  check(response, {
    [`${prefix}: media token status is 200`]: (r) => r.status === 200,
    [`${prefix}: media token exists`]: (r) => Boolean(jsonValue(r, "token")),
  });
  return response;
}

export function sendMessage(token, roomId, text, prefix = "chat") {
  const response = http.post(`${BASE_URL}/api/v1/rooms/${roomId}/messages`, JSON.stringify({ text }), requestParams(token, "POST /api/v1/rooms/{roomId}/messages"));
  check(response, {
    [`${prefix}: message sent`]: (r) => r.status === 201,
    [`${prefix}: message id exists`]: (r) => Boolean(jsonValue(r, "id")),
  });
  return response;
}

export function getMessages(token, roomId, prefix = "chat") {
  const response = http.get(`${BASE_URL}/api/v1/rooms/${roomId}/messages`, requestParams(token, "GET /api/v1/rooms/{roomId}/messages"));
  check(response, {
    [`${prefix}: messages status is 200`]: (r) => r.status === 200,
    [`${prefix}: messages list returned`]: (r) => Array.isArray(jsonValue(r)),
  });
  return response;
}

export function createRoomScenario() {
  group("create room transaction", () => {
    const host = registerUser("create-host");
    const room = createRoom(host.token, "create-room");
    getRoom(host.token, room.roomId, "create-room");
    sleep(1);
  });
}

export function joinRoomScenario() {
  group("join room transaction", () => {
    const host = registerUser("join-host");
    const room = createRoom(host.token, "join-room");
    const guest = registerUser("join-guest");
    const joined = joinInvite(guest.token, room.inviteToken, "join-room");
    getRoom(guest.token, joined.roomId, "join-room");
    issueMediaToken(guest.token, joined.roomId, "join-room");
    sleep(1);
  });
}

export function chatScenario() {
  group("chat transaction", () => {
    const user = registerUser("chat-user");
    const room = createRoom(user.token, "chat-room");
    sendMessage(user.token, room.roomId, "hello from k6 core chat scenario", "chat-room");
    getMessages(user.token, room.roomId, "chat-room");
    sleep(1);
  });
}

export function coreThresholds(failedRate = "rate<0.10", duration = "p(95)<1000") {
  return {
    http_req_failed: [failedRate],
    http_req_duration: [duration],
    checks: ["rate>0.90"],
  };
}

export function coreLoadScenarios(multiplier = 1) {
  return {
    create_room: {
      executor: "ramping-vus",
      exec: "createRoomTransaction",
      stages: [
        { duration: "5m", target: 4 * multiplier },
        { duration: "10m", target: 4 * multiplier },
        { duration: "5m", target: 0 },
      ],
    },
    join_room: {
      executor: "ramping-vus",
      exec: "joinRoomTransaction",
      stages: [
        { duration: "5m", target: 4 * multiplier },
        { duration: "10m", target: 4 * multiplier },
        { duration: "5m", target: 0 },
      ],
    },
    chat: {
      executor: "ramping-vus",
      exec: "chatTransaction",
      stages: [
        { duration: "5m", target: 8 * multiplier },
        { duration: "10m", target: 8 * multiplier },
        { duration: "5m", target: 0 },
      ],
    },
  };
}

export function stressStages(baseTarget, steps = 30) {
  const stages = [{ duration: "5m", target: baseTarget }];
  for (let index = 1; index <= steps; index += 1) {
    stages.push({ duration: "10s", target: Math.ceil(baseTarget * (1 + index * 0.1)) });
  }
  stages.push({ duration: "5m", target: 0 });
  return stages;
}
