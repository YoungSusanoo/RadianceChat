import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    api_smoke: {
      executor: "constant-vus",
      vus: 20,
      duration: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.02"],
  },
};

const baseUrl = __ENV.BASE_URL || "http://localhost:8080";

export default function () {
  const suffix = `${__VU}-${Date.now()}`;
  const register = http.post(`${baseUrl}/api/v1/auth/register`, JSON.stringify({
    name: `Load ${suffix}`,
    email: `load-${suffix}@example.com`,
    password: "test1234",
  }), { headers: { "Content-Type": "application/json" } });

  check(register, { "register ok": (r) => r.status === 201 });
  const token = register.json("token");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const room = http.post(`${baseUrl}/api/v1/rooms`, JSON.stringify({
    name: `Room ${suffix}`,
    visibility: "public",
  }), { headers });
  check(room, { "room created": (r) => r.status === 201 });

  const roomId = room.json("room.id");
  const message = http.post(`${baseUrl}/api/v1/rooms/${roomId}/messages`, JSON.stringify({
    text: "hello from k6",
  }), { headers });
  check(message, { "message sent": (r) => r.status === 201 });

  const rooms = http.get(`${baseUrl}/api/v1/rooms`, { headers });
  check(rooms, { "rooms listed": (r) => r.status === 200 });

  sleep(1);
}

