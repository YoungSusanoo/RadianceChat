/**
 * full_load_test.js — Полный нагрузочный тест Radiance
 *
 * Запускает все 4 сценария одновременно с общим профилем нагрузки:
 *   - Сценарий A: создание встреч  (0.16 RPS)
 *   - Сценарий B: вход в звонок    (0.46 RPS)
 *   - Сценарий C: чат              (3.0 RPS write, 15 RPS read)
 *   - Сценарий D: WS-сигнализация  (5 постоянных соединений)
 *
 * Профиль:
 *   0–5 мин   — рост нагрузки (ramp-up)
 *   5–15 мин  — плато
 *   15–20 мин — спад (ramp-down)
 *
 * Запуск:
 *   k6 run full_load_test.js
 *   k6 run --env BASE_URL=http://your-server:8080 full_load_test.js
 *
 * С выводом в Grafana (через k6 cloud или локальный InfluxDB):
 *   k6 run --out influxdb=http://localhost:8086/k6 full_load_test.js
 */

import http from 'k6/http';
import ws   from 'k6/ws';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate, Gauge } from 'k6/metrics';

// ─── Конфигурация ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// ─── Кастомные метрики ───────────────────────────────────────────────────────

const metrics = {
  createRoomMs:    new Trend('radiance_create_room_ms',      true),
  joinScenarioMs:  new Trend('radiance_join_scenario_ms',    true),
  sendMsgMs:       new Trend('radiance_send_message_ms',     true),
  getMsgMs:        new Trend('radiance_get_messages_ms',     true),
  wsConnectMs:     new Trend('radiance_ws_connect_ms',       true),
  wsSessionMs:     new Trend('radiance_ws_session_ms',       true),

  createErrors:    new Counter('radiance_create_errors'),
  joinErrors:      new Counter('radiance_join_errors'),
  chatErrors:      new Counter('radiance_chat_errors'),
  wsErrors:        new Counter('radiance_ws_errors'),

  wsMsgSent:       new Counter('radiance_ws_msg_sent'),
  wsMsgReceived:   new Counter('radiance_ws_msg_received'),
  wsDelivery:      new Rate('radiance_ws_delivery_rate'),
  roomStateOk:     new Rate('radiance_room_state_ok'),
  msgDelivery:     new Rate('radiance_msg_delivery_rate'),

  activeWs:        new Gauge('radiance_active_ws_connections'),
};

// ─── Конфигурация сценариев ──────────────────────────────────────────────────

export const options = {
  scenarios: {
    // ── A: Создание встреч ──────────────────────────────────────────────
    create_room: {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '5m',  target: 3 },
        { duration: '10m', target: 3 },
        { duration: '5m',  target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'scenarioA',
      tags: { scenario: 'create_room' },
    },

    // ── B: Вход в звонок ────────────────────────────────────────────────
    join_call: {
      executor:    'ramping-vus',
      startVUs:    0,
      stages: [
        { duration: '5m',  target: 5 },
        { duration: '10m', target: 5 },
        { duration: '5m',  target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'scenarioB',
      tags: { scenario: 'join_call' },
    },

    // ── C: Чат ──────────────────────────────────────────────────────────
    chat: {
      executor:         'ramping-arrival-rate',
      startRate:        1,
      timeUnit:         '1s',
      preAllocatedVUs:  10,
      maxVUs:           30,
      stages: [
        { duration: '5m',  target: 3 },
        { duration: '10m', target: 3 },
        { duration: '5m',  target: 0 },
      ],
      exec: 'scenarioC',
      tags: { scenario: 'chat' },
    },

    // ── D: WebSocket сигнализация ────────────────────────────────────────
    ws_signaling: {
      executor:   'constant-vus',
      vus:        5,
      duration:   '20m',
      exec:       'scenarioD',
      tags:       { scenario: 'ws_signaling' },
    },
  },

  thresholds: {
    // НФТ #1: создание встречи < 2 сек
    'http_req_duration{scenario:create_room}':  ['p(95)<2000'],
    'radiance_create_room_ms':                  ['p(95)<2000'],

    // НФТ #2: вход в звонок < 3 сек
    'http_req_duration{scenario:join_call}':    ['p(95)<3000'],
    'radiance_join_scenario_ms':                ['p(95)<3000'],
    'radiance_ws_connect_ms':                   ['p(95)<1000'],

    // НФТ #6: чат работает независимо
    'http_req_duration{scenario:chat}':         ['p(95)<1000'],
    'radiance_send_message_ms':                 ['p(95)<500'],
    'radiance_get_messages_ms':                 ['p(95)<800'],
    'radiance_msg_delivery_rate':               ['rate>0.95'],

    // WS-сигнализация
    'radiance_ws_delivery_rate':                ['rate>0.90'],
    'radiance_ws_errors':                       ['count<100'],

    // Глобальный порог ошибок из задания: < 10%
    'http_req_failed':                          ['rate<0.10'],
  },
};

// ─── Вспомогательные функции ─────────────────────────────────────────────────

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function jSleep(base) {
  const j = base * 0.1;
  return base + (Math.random() * 2 - 1) * j;
}

function registerUser() {
  const email = `load_${uid()}@test.local`;
  const res = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password: 'Load1234!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { '[auth] register 200': (r) => r.status === 200 });
  const body = res.json();
  return { token: body.token, userId: body.user?.id };
}

function authH(token) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// ─── setup: создать общие тестовые данные ────────────────────────────────────

export function setup() {
  // Комната для сценариев B и D
  const host = registerUser();
  const roomRes = http.post(
    `${BASE_URL}/rooms`,
    JSON.stringify({ name: 'FullLoad SharedRoom', type: 'video' }),
    { headers: authH(host.token) },
  );
  check(roomRes, { '[setup] room created': (r) => r.status === 200 });

  const room = roomRes.json();

  // Комната для чата (сценарий C)
  const chatRoomRes = http.post(
    `${BASE_URL}/rooms`,
    JSON.stringify({ name: 'FullLoad ChatRoom', type: 'video' }),
    { headers: authH(host.token) },
  );
  const chatRoom = chatRoomRes.json();

  // Предзаполняем чат 5 сообщениями
  for (let i = 0; i < 5; i++) {
    http.post(
      `${BASE_URL}/rooms/${chatRoom.id}/messages`,
      JSON.stringify({ content: `Seed ${i + 1}` }),
      { headers: authH(host.token) },
    );
  }

  console.log(`[setup] SharedRoom: ${room.id}  ChatRoom: ${chatRoom.id}`);

  return {
    hostToken:        host.token,
    sharedRoomId:     room.id,
    sharedInvite:     room.invite_link,
    chatRoomId:       chatRoom.id,
    chatInvite:       chatRoom.invite_link,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  СЦЕНАРИЙ A — Создание встречи
// ═══════════════════════════════════════════════════════════════════════════

export function scenarioA() {
  group('A: создание встречи', () => {
    const { token } = registerUser();
    sleep(jSleep(0.3));

    // POST /rooms
    const t0 = Date.now();
    const res = http.post(
      `${BASE_URL}/rooms`,
      JSON.stringify({ name: `Load_${__VU}_${__ITER}`, type: 'video' }),
      { headers: authH(token), tags: { step: 'create_room' } },
    );
    metrics.createRoomMs.add(Date.now() - t0);

    const ok = check(res, {
      'A: POST /rooms → 200':     (r) => r.status === 200,
      'A: has room id':           (r) => !!r.json('id'),
      'A: has invite_link':       (r) => !!r.json('invite_link'),
      'A: создание < 2000 мс':    () => (Date.now() - t0) < 2000,
    });
    if (!ok) { metrics.createErrors.add(1); sleep(2); return; }

    const roomId = res.json('id');
    sleep(jSleep(0.5));

    // GET /rooms/{id}
    const getRes = http.get(
      `${BASE_URL}/rooms/${roomId}`,
      { headers: authH(token), tags: { step: 'get_room' } },
    );
    check(getRes, {
      'A: GET /rooms/{id} → 200': (r) => r.status === 200,
      'A: status = active':       (r) => r.json('status') === 'active',
    });
  });

  sleep(jSleep(6));
}

// ═══════════════════════════════════════════════════════════════════════════
//  СЦЕНАРИЙ B — Вход в звонок (HTTP + WebSocket)
// ═══════════════════════════════════════════════════════════════════════════

export function scenarioB(data) {
  const scenStart = Date.now();

  group('B: вход в звонок', () => {
    const { token } = registerUser();
    sleep(jSleep(0.2));

    // POST /invites/{invite}
    const joinRes = http.post(
      `${BASE_URL}/rooms/${data.sharedRoomId}/join`,
      null,
      { headers: authH(token), tags: { step: 'join_invite' } },
    );
    const joinOk = check(joinRes, {
      'B: join → 200':  (r) => r.status === 200,
      'B: joined':      (r) => ['joined', 'already_joined'].includes(r.json('status')),
    });
    if (!joinOk) { metrics.joinErrors.add(1); return; }

    sleep(jSleep(0.3));

    // GET /rooms/{id}/participants
    const pRes = http.get(
      `${BASE_URL}/rooms/${data.sharedRoomId}/participants`,
      { headers: authH(token), tags: { step: 'get_participants' } },
    );
    check(pRes, {
      'B: participants → 200':  (r) => r.status === 200,
      'B: list not empty':      (r) => Array.isArray(r.json()) && r.json().length > 0,
    });

    // WebSocket
    const wsUrl = `${BASE_URL.replace('http', 'ws')}/ws/chat/${data.sharedRoomId}/?token=${token}&username=BVU${__VU}`;
    const wsT0 = Date.now();
    let gotRoomState = false;

    metrics.activeWs.add(1);
    const wsRes = ws.connect(wsUrl, {}, (socket) => {
      socket.on('open',    () => { metrics.wsConnectMs.add(Date.now() - wsT0); });
      socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'room_state') { gotRoomState = true; }
        } catch (_) {}
      });
      socket.on('error', () => metrics.wsErrors.add(1));
      socket.setTimeout(() => socket.close(), 30000);
    });
    metrics.activeWs.add(-1);

    metrics.roomStateOk.add(gotRoomState);
    check(wsRes, { 'B: WS 101': (r) => r && r.status === 101 });
  });

  metrics.joinScenarioMs.add(Date.now() - scenStart);
  sleep(jSleep(2));
}

// ═══════════════════════════════════════════════════════════════════════════
//  СЦЕНАРИЙ C — Чат
// ═══════════════════════════════════════════════════════════════════════════

const MSGS = ['Привет!', 'Слышно?', 'Окей', 'Поняли', 'Отлично 👍', 'Вопрос есть', 'Договорились'];

export function scenarioC(data) {
  group('C: чат', () => {
    const { token } = registerUser();

    // Войти в комнату
    http.post(`${BASE_URL}/invites/${data.chatInvite}`, null, { headers: authH(token) });
    sleep(jSleep(0.1));

    // Write ×1
    const text = MSGS[Math.floor(Math.random() * MSGS.length)];
    const t0 = Date.now();
    const sendRes = http.post(
      `${BASE_URL}/rooms/${data.chatRoomId}/messages`,
      JSON.stringify({ content: `[VU${__VU}:${__ITER}] ${text}` }),
      { headers: authH(token), tags: { step: 'send_msg' } },
    );
    metrics.sendMsgMs.add(Date.now() - t0);

    const sendOk = check(sendRes, {
      'C: POST /messages → 201': (r) => r.status === 201,
      'C: has id':               (r) => !!r.json('id'),
    });
    metrics.msgDelivery.add(sendOk);
    if (!sendOk) metrics.chatErrors.add(1);

    sleep(jSleep(0.1));

    // Read ×5 (соотношение 1:5)
    for (let i = 0; i < 5; i++) {
      const gt0 = Date.now();
      const getRes = http.get(
        `${BASE_URL}/rooms/${data.chatRoomId}/messages?limit=50`,
        { headers: authH(token), tags: { step: 'get_msgs' } },
      );
      metrics.getMsgMs.add(Date.now() - gt0);
      check(getRes, { 'C: GET /messages → 200': (r) => r.status === 200 });
      sleep(jSleep(0.05));
    }
  });

  sleep(jSleep(0.3));
}

// ═══════════════════════════════════════════════════════════════════════════
//  СЦЕНАРИЙ D — WebSocket сигнализация
// ═══════════════════════════════════════════════════════════════════════════

export function scenarioD(data) {
  const { token } = registerUser();

  http.post(`${BASE_URL}/invites/${data.sharedInvite}`, null, { headers: authH(token) });

  const wsUrl = `${BASE_URL.replace('http', 'ws')}/ws/chat/${data.sharedRoomId}/?token=${token}&username=DVU${__VU}`;

  let sent = 0;
  let received = 0;
  const sessStart = Date.now();

  metrics.activeWs.add(1);

  const wsRes = ws.connect(wsUrl, {}, (socket) => {
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (['offer', 'answer', 'candidate', 'user_left', 'user_joined'].includes(msg.type)) {
          received++;
          metrics.wsMsgReceived.add(1);
        }
      } catch (_) {}
    });

    socket.on('error', () => metrics.wsErrors.add(1));

    // Отправка candidate каждые 2 сек
    const iv = socket.setInterval(() => {
      socket.send(JSON.stringify({
        type: 'candidate',
        data: { candidate: `rtp:${Math.random()}`, sdpMid: '0', sdpMLineIndex: 0 },
      }));
      sent++;
      metrics.wsMsgSent.add(1);
    }, 2000);

    socket.setTimeout(() => {
      socket.clearInterval(iv);
      socket.close();
    }, 60000);
  });

  metrics.activeWs.add(-1);
  metrics.wsSessionMs.add(Date.now() - sessStart);

  // Оцениваем доставку для этого VU
  // 5 VU → каждое сообщение должно дойти до 4 других
  const expectedMin = sent * 2 * 0.90;
  metrics.wsDelivery.add(received >= expectedMin);

  check(wsRes, { 'D: WS 101': (r) => r && r.status === 101 });

  sleep(5);
}

// ─── teardown ────────────────────────────────────────────────────────────────

export function teardown(data) {
  for (const roomId of [data.sharedRoomId, data.chatRoomId]) {
    const r = http.del(
      `${BASE_URL}/rooms/${roomId}`,
      null,
      { headers: authH(data.hostToken) },
    );
    console.log(`[teardown] Удаление комнаты ${roomId}: ${r.status}`);
  }
}
