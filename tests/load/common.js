import http from "k6/http";
import { check, group, sleep } from "k6";

export const BASE_URL = __ENV.BASE_URL || "http://144.31.156.17:8080";
export const DEFAULT_PASSWORD = "test1234";
export const TEST_RUN_ID = __ENV.TEST_RUN_ID || "k6";

const accounts = {};

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
  return registerUserWithEmail(prefix, `User ${suffix}`, `${suffix}@example.com`);
}

export function registerUserWithEmail(prefix, name, email) {
  const response = http.post(`${BASE_URL}/api/v1/auth/register`, JSON.stringify({
    name,
    email,
    password: DEFAULT_PASSWORD,
  }), requestParams(null, "POST /api/v1/auth/register"));

  check(response, {
    [`${prefix}: register status is 201 or already exists`]: (r) => r.status === 201 || r.status === 409,
    [`${prefix}: register returns token when created`]: (r) => r.status === 409 || Boolean(jsonValue(r, "token")),
  });

  return {
    response,
    token: jsonValue(response, "token"),
    userId: jsonValue(response, "user.id"),
  };
}

export function loginUser(prefix, email) {
  const response = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({
    email,
    password: DEFAULT_PASSWORD,
  }), requestParams(null, "POST /api/v1/auth/login"));

  check(response, {
    [`${prefix}: login status is 200`]: (r) => r.status === 200,
    [`${prefix}: login returns token`]: (r) => Boolean(jsonValue(r, "token")),
  });

  return {
    response,
    token: jsonValue(response, "token"),
    userId: jsonValue(response, "user.id"),
  };
}

export function loadUser(prefix) {
  if (accounts[prefix]?.token) {
    return accounts[prefix];
  }

  const safePrefix = prefix.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const safeRunID = TEST_RUN_ID.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const email = `${safeRunID}-${safePrefix}-vu${__VU}@load.radiance.local`;
  const name = `Load ${safeRunID} ${safePrefix} ${__VU}`;
  const registered = registerUserWithEmail(prefix, name, email);
  accounts[prefix] = registered.token ? registered : loginUser(prefix, email);
  return accounts[prefix];
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

export function leaveRoom(token, roomId, prefix = "room") {
  const response = http.post(`${BASE_URL}/api/v1/rooms/${roomId}/leave`, "{}", requestParams(token, "POST /api/v1/rooms/{roomId}/leave"));
  check(response, {
    [`${prefix}: room left`]: (r) => r.status === 200,
  });
  return response;
}

export function endRoom(token, roomId, prefix = "room") {
  const response = http.post(`${BASE_URL}/api/v1/rooms/${roomId}/end`, "{}", requestParams(token, "POST /api/v1/rooms/{roomId}/end"));
  check(response, {
    [`${prefix}: room ended`]: (r) => r.status === 200,
  });
  return response;
}

export function createRoomScenario() {
  group("create room transaction", () => {
    const host = loadUser("create-host");
    const room = createRoom(host.token, "create-room");
    getRoom(host.token, room.roomId, "create-room");
    endRoom(host.token, room.roomId, "create-room");
    sleep(1);
  });
}

export function joinRoomScenario() {
  group("join room transaction", () => {
    const host = loadUser("join-host");
    const room = createRoom(host.token, "join-room");
    const guest = loadUser("join-guest");
    const joined = joinInvite(guest.token, room.inviteToken, "join-room");
    getRoom(guest.token, joined.roomId, "join-room");
    issueMediaToken(guest.token, joined.roomId, "join-room");
    leaveRoom(guest.token, joined.roomId, "join-room");
    endRoom(host.token, room.roomId, "join-room");
    sleep(1);
  });
}

export function chatScenario() {
  group("chat transaction", () => {
    const user = loadUser("chat-user");
    const room = createRoom(user.token, "chat-room");
    sendMessage(user.token, room.roomId, "hello from k6 core chat scenario", "chat-room");
    getMessages(user.token, room.roomId, "chat-room");
    endRoom(user.token, room.roomId, "chat-room");
    sleep(1);
  });
}

export function coreThresholds(failedRate = "rate<0.10", duration = "p(95)<3000") {
  return {
    http_req_failed: [failedRate],
    http_req_duration: [duration],
    checks: ["rate>0.90"],
  };
}

export function arrivalStages(targetRatePerMinute, steps = 0) {
  const stages = [{ duration: "5m", target: targetRatePerMinute }];
  if (steps > 0) {
    for (let index = 1; index <= steps; index += 1) {
      stages.push({ duration: "10s", target: Math.ceil(targetRatePerMinute * (1 + index * 0.1)) });
    }
  } else {
    stages.push({ duration: "10m", target: targetRatePerMinute });
  }
  stages.push({ duration: "5m", target: 0 });
  return stages;
}

export function arrivalScenario(exec, targetRatePerMinute, preAllocatedVUs, maxVUs, steps = 0) {
  return {
    executor: "ramping-arrival-rate",
    exec,
    startRate: 0,
    timeUnit: "1m",
    preAllocatedVUs,
    maxVUs,
    stages: arrivalStages(targetRatePerMinute, steps),
  };
}

export function coreLoadScenarios(multiplier = 1) {
  return {
    create_room: arrivalScenario("createRoomTransaction", 4 * multiplier, 4 * multiplier, 20 * multiplier),
    join_room: arrivalScenario("joinRoomTransaction", 65 * multiplier, 20 * multiplier, 120 * multiplier),
    chat: arrivalScenario("chatTransaction", 45 * multiplier, 12 * multiplier, 80 * multiplier),
  };
}

export function x10Scenarios() {
  return {
    create_room: arrivalScenario("createRoomTransaction", 40, 40, 120),
    join_room: arrivalScenario("joinRoomTransaction", 450, 120, 500),
    chat: arrivalScenario("chatTransaction", 195, 80, 300),
  };
}

export function stressScenarios(steps = 60) {
  return {
    create_room_stress: arrivalScenario("createRoomTransaction", 4, 4, 80, steps),
    join_room_stress: arrivalScenario("joinRoomTransaction", 65, 20, 500, steps),
    chat_stress: arrivalScenario("chatTransaction", 45, 12, 300, steps),
  };
}

export function stressBreakpointScenarios(steps = 120) {
  return {
    create_room_breakpoint: arrivalScenario("createRoomTransaction", 8, 8, 160, steps),
    join_room_breakpoint: arrivalScenario("joinRoomTransaction", 90, 30, 800, steps),
    chat_breakpoint: arrivalScenario("chatTransaction", 70, 20, 500, steps),
  };
}
