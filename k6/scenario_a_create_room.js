/**
 * scenario_a_create_room.js — Сценарий A: «Создание встречи»
 *
 * Шаги одной итерации (3 HTTP-запроса):
 *   1. POST /auth/register  — новый пользователь
 *   2. POST /rooms          — создать комнату
 *   3. GET  /rooms/{id}     — убедиться, что комната доступна
 *
 * Плановая интенсивность: ~0.16 RPS (1 итерация каждые ~6 сек при 1 VU)
 * НФТ: p95 создания комнаты < 2 000 мс, error rate < 10%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { BASE_URL, registerUser, authHeaders, jitteredSleep } from './helpers.js';

// ─── Кастомные метрики ───────────────────────────────────────────────────────

const createRoomDuration = new Trend('radiance_create_room_ms', true);
const createRoomErrors   = new Counter('radiance_create_room_errors');

// ─── Конфигурация теста ──────────────────────────────────────────────────────

export const options = {
  scenarios: {
    create_room: {
      executor:          'ramping-vus',
      startVUs:          0,
      stages: [
        { duration: '5m',  target: 3  },  // разогрев до 3 VU
        { duration: '10m', target: 3  },  // плато
        { duration: '5m',  target: 0  },  // спад
      ],
      gracefulRampDown: '30s',
      tags: { scenario: 'create_room' },
    },
  },
  thresholds: {
    'http_req_failed{scenario:create_room}':        ['rate<0.10'],
    'http_req_duration{scenario:create_room}':      ['p(95)<2000'],
    // Метрика именно на шаг POST /rooms
    'radiance_create_room_ms':                      ['p(95)<2000'],
  },
};

// ─── Основная функция ────────────────────────────────────────────────────────

export default function () {
  // ── Шаг 1: регистрация ──────────────────────────────────────────────────
  const { token } = registerUser();

  sleep(jitteredSleep(0.3));

  // ── Шаг 2: создать комнату ──────────────────────────────────────────────
  const startCreate = Date.now();

  const createRes = http.post(
    `${BASE_URL}/rooms`,
    JSON.stringify({ name: `LoadRoom_${__VU}_${__ITER}`, type: 'video' }),
    { headers: authHeaders(token), tags: { step: 'create_room' } },
  );

  const createDuration = Date.now() - startCreate;
  createRoomDuration.add(createDuration);

  const createOk = check(createRes, {
    'POST /rooms → 200':          (r) => r.status === 200,
    'response has room id':       (r) => r.json('id') !== undefined,
    'response has invite_link':   (r) => r.json('invite_link') !== undefined,
    'создание < 2 000 мс':        () => createDuration < 2000,
  });

  if (!createOk) {
    createRoomErrors.add(1);
    console.warn(`[VU ${__VU}] POST /rooms failed: ${createRes.status} ${createRes.body}`);
    sleep(1);
    return;
  }

  const roomId = createRes.json('id');

  sleep(jitteredSleep(0.5));

  // ── Шаг 3: проверить доступность комнаты ────────────────────────────────
  const getRes = http.get(
    `${BASE_URL}/rooms/${roomId}`,
    { headers: authHeaders(token), tags: { step: 'get_room' } },
  );

  check(getRes, {
    'GET /rooms/{id} → 200':  (r) => r.status === 200,
    'room id совпадает':      (r) => r.json('id') === roomId,
    'room status = active':   (r) => r.json('status') === 'active',
  });

  // Пауза чтобы выйти на целевые ~0.16 RPS
  sleep(jitteredSleep(6));
}
