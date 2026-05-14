/**
 * helpers.js — общие утилиты и конфигурация для всех K6-сценариев Radiance
 */

import http from 'k6/http';
import { check, fail } from 'k6';

// ─── Конфигурация ────────────────────────────────────────────────────────────

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const THRESHOLDS = {
  // Глобальный порог ошибок из НФТ
  http_req_failed: [{ threshold: 'rate<0.10', abortOnFail: false }],

  // НФТ №1: создание встречи < 2 сек
  'http_req_duration{scenario:create_room}': ['p(95)<2000'],

  // НФТ №2: вход в комнату < 3 сек (суммарно по сценарию)
  'http_req_duration{scenario:join_call}':   ['p(95)<3000'],

  // Чат — произвольный порог, адаптируйте под ваши НФТ
  'http_req_duration{scenario:chat}':        ['p(95)<1000'],
};

// ─── Хелперы ─────────────────────────────────────────────────────────────────

/**
 * Регистрирует нового пользователя с уникальным email и возвращает { token, userId }.
 * Используется в setup() или в начале VU-итерации.
 */
export function registerUser() {
  const uid   = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const email = `load_user_${uid}@radiance.test`;

  const res = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password: 'Load1234!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (!check(res, { 'register 200': (r) => r.status === 200 })) {
    fail(`registerUser failed: status=${res.status} body=${res.body}`);
  }

  const body = res.json();
  return { token: body.token, userId: body.user.id, email };
}

/**
 * Логинит существующего пользователя и возвращает JWT-токен.
 */
export function login(email, password = 'Load1234!') {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(res, { 'login 200': (r) => r.status === 200 });
  return res.json().token;
}

/**
 * Возвращает заголовки авторизации для всех защищённых запросов.
 */
export function authHeaders(token) {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

/**
 * Создаёт комнату и возвращает { roomId, inviteLink }.
 */
export function createRoom(token, name = 'Load Test Room', type = 'video') {
  const res = http.post(
    `${BASE_URL}/rooms`,
    JSON.stringify({ name, type }),
    { headers: authHeaders(token) },
  );

  check(res, { 'createRoom 200': (r) => r.status === 200 });
  const body = res.json();
  return { roomId: body.id, inviteLink: body.invite_link };
}

/**
 * Мягкая пауза: sleep с лёгким случайным джиттером ±10% от base.
 * Используется чтобы избежать thundering herd в тестах.
 */
export function jitteredSleep(base) {
  // k6 импортирует sleep сам в сценариях, поэтому возвращаем число секунд
  const jitter = base * 0.1;
  return base + (Math.random() * 2 - 1) * jitter;
}
