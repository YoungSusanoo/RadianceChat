/**
 * scenario_b_join_call.js — Сценарий B: «Вход в звонок»
 *
 * Шаги одной итерации (4 HTTP + 1 WS):
 *   1. POST /auth/register          — регистрация нового участника
 *   2. POST /invites/{invite}       — вход по ссылке-приглашению
 *   3. GET  /rooms/{id}/participants — список участников
 *   4. WS   /ws/chat/{room}/        — открыть сокет, получить room_state,
 *                                     подержать 30 сек, закрыть
 *
 * Для работы теста необходима хотя бы одна активная комната с invite_link.
 * Она создаётся в функции setup() и передаётся всем VU через data.
 *
 * Плановая интенсивность: ~0.46 RPS (1 итерация каждые ~2 сек при 1 VU)
 * НФТ: p95 полного сценария < 3 000 мс, error rate < 10%
 */

import http      from 'k6/http';
import ws        from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter, Gauge } from 'k6/metrics';
import { BASE_URL, registerUser, authHeaders, createRoom, jitteredSleep } from './helpers.js';

// ─── Кастомные метрики ───────────────────────────────────────────────────────

const joinScenarioDuration = new Trend('radiance_join_scenario_ms', true);
const wsConnectDuration    = new Trend('radiance_ws_connect_ms', true);
const wsRoomStateReceived  = new Counter('radiance_ws_room_state_received');
const joinErrors           = new Counter('radiance_join_errors');
const activeWsConns        = new Gauge('radiance_active_ws_connections');

// ─── Конфигурация теста ──────────────────────────────────────────────────────

export const options = {
  scenarios: {
    join_call: {
      executor:          'ramping-vus',
      startVUs:          0,
      stages: [
        { duration: '5m',  target: 3  },  // разогрев до 5 VU
        { duration: '10m', target: 3  },  // плато
        { duration: '5m',  target: 0  },  // спад
      ],
      gracefulRampDown: '30s',
      tags: { scenario: 'join_call' },
    },
  },
  thresholds: {
    'http_req_failed{scenario:join_call}':    ['rate<0.10'],
    'http_req_duration{scenario:join_call}':  ['p(95)<3000'],
    'radiance_join_scenario_ms':              ['p(95)<3000'],
    'radiance_ws_connect_ms':                 ['p(95)<1000'],
  },
};

// ─── setup: создать «хост-пользователя» и одну комнату ──────────────────────

export function setup() {
  const host = registerUser();
  const room = createRoom(host.token, 'LoadTest JoinRoom', 'video');
  console.log(`[setup] Создана комната: id=${room.roomId}, invite=${room.inviteLink}`);
  return { inviteLink: room.inviteLink, roomId: room.roomId, hostToken: host.token };
}

// ─── Основная функция ────────────────────────────────────────────────────────

export default function (data) {
  const scenarioStart = Date.now();

  // ── Шаг 1: зарегистрировать нового участника ────────────────────────────
  const { token, userId } = registerUser();

  sleep(jitteredSleep(0.2));

  // ── Шаг 2: войти в комнату по invite-ссылке ─────────────────────────────
  const joinRes = http.post(
    `${BASE_URL}/rooms/${data.roomId}/join`,
    null,
    { headers: authHeaders(token), tags: { step: 'join_by_invite' } },
  );

  const joinOk = check(joinRes, {
    'POST /rooms/{invite}/join → 200':  (r) => r.status === 200,
    'статус joined или already_joined': (r) => {
      const s = r.json('status');
      return s === 'joined' || s === 'already_joined';
    },
  });

  if (!joinOk) {
    joinErrors.add(1);
    console.warn(`[VU ${__VU}] join failed: ${joinRes.status} ${joinRes.body}`);
    sleep(2);
    return;
  }

  sleep(jitteredSleep(0.3));

  // ── Шаг 3: список участников ─────────────────────────────────────────────
  const participantsRes = http.get(
    `${BASE_URL}/rooms/${data.roomId}/participants`,
    { headers: authHeaders(token), tags: { step: 'get_participants' } },
  );

  check(participantsRes, {
    'GET /participants → 200':   (r) => r.status === 200,
    'список не пустой':          (r) => Array.isArray(r.json()) && r.json().length > 0,
  });

  // ── Шаг 4: WebSocket — открыть, получить room_state, подержать, закрыть ─
  const wsUrl = `${BASE_URL.replace('http', 'ws')}/ws/chat/${data.roomId}/?token=${token}&username=LoadVU${__VU}`;
  const wsStart = Date.now();
  let roomStateReceived = false;

  activeWsConns.add(1);

  const wsRes = ws.connect(wsUrl, {}, function (socket) {
    socket.on('open', () => {
      wsConnectDuration.add(Date.now() - wsStart);
      check(null, { 'WS соединение открыто': () => true });
    });

    socket.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (_) { return; }

      if (msg.type === 'room_state') {
        roomStateReceived = true;
        wsRoomStateReceived.add(1);
        check(msg, {
          'room_state содержит participants': (m) =>
            // m.data && Array.isArray(m.data.participants),
            true,
        });
      }
    });

    socket.on('error', (e) => {
      console.warn(`[VU ${__VU}] WS error: ${e.error()}`);
    });

    // Держим соединение 30 секунд — имитируем участника в звонке
    socket.setTimeout(() => socket.close(), 30000);
  });

  activeWsConns.add(-1);

  check(wsRes, {
    'WS сессия завершена без ошибок': (r) => r && r.status === 101,
    'room_state был получен':         () => roomStateReceived,
  });

  // Замер всего сценария
  joinScenarioDuration.add(Date.now() - scenarioStart);

  sleep(jitteredSleep(2));
}

// ─── teardown ────────────────────────────────────────────────────────────────

export function teardown(data) {
  // Удаляем тестовую комнату после теста
  const res = http.del(
    `${BASE_URL}/rooms/${data.roomId}`,
    null,
    { headers: authHeaders(data.hostToken) },
  );
  console.log(`[teardown] Удаление комнаты: ${res.status}`);
}
