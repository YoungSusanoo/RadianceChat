/**
 * scenario_c_chat.js — Сценарий C: «Нагрузка на чат»
 *
 * Имитирует активный чат в комнате: отправка и чтение сообщений.
 * Соотношение write:read = 1:5 (из расчётов в документе).
 *
 * Шаги одной итерации (1 write + 5 read):
 *   1. POST /rooms/{id}/messages  — отправить сообщение
 *   2-6. GET /rooms/{id}/messages — прочитать историю (5 раз)
 *
 * Плановая интенсивность: ~3 RPS write, ~15 RPS read
 * НФТ: p95 < 1 000 мс, error rate < 10%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { BASE_URL, registerUser, authHeaders, createRoom, jitteredSleep } from './helpers.js';

// ─── Кастомные метрики ───────────────────────────────────────────────────────

const sendMsgDuration = new Trend('radiance_send_message_ms', true);
const getMsgDuration  = new Trend('radiance_get_messages_ms', true);
const sendErrors      = new Counter('radiance_send_message_errors');
const msgDeliveryRate = new Rate('radiance_msg_delivery_success');

const MESSAGES = [
  'Привет всем!',
  'Слышно меня?',
  'Отличный звонок 🎉',
  'Когда следующее совещание?',
  'Поделитесь экраном, пожалуйста',
  'Да, согласен с этим предложением',
  'Нужно уточнить детали',
  'Всё понял, спасибо',
  'Подождите, у меня вопрос',
  'Отлично, договорились!',
];

// ─── Конфигурация теста ──────────────────────────────────────────────────────

export const options = {
  scenarios: {
    chat: {
      executor:          'ramping-arrival-rate',  // постоянный RPS, не VU
      startRate:         1,
      timeUnit:          '1s',
      preAllocatedVUs:   10,
      maxVUs:            30,
      stages: [
        { duration: '5m',  target: 3  },   // разогрев до 3 итераций/сек
        { duration: '10m', target: 3  },   // плато (3 write RPS = 15 read RPS)
        { duration: '5m',  target: 0  },   // спад
      ],
      tags: { scenario: 'chat' },
    },
  },
  thresholds: {
    'http_req_failed{scenario:chat}':       ['rate<0.10'],
    'http_req_duration{scenario:chat}':     ['p(95)<1000'],
    'radiance_send_message_ms':             ['p(95)<500'],
    'radiance_get_messages_ms':             ['p(95)<800'],
    'radiance_msg_delivery_success':        ['rate>0.95'],
  },
};

// ─── setup ───────────────────────────────────────────────────────────────────

export function setup() {
  // Создаём одну комнату и одного «постоянного» участника для чтения сообщений
  const host = registerUser();
  const room = createRoom(host.token, 'LoadTest ChatRoom', 'video');

  // Предзаполняем комнату 5 сообщениями, чтобы GET сразу возвращал данные
  for (let i = 0; i < 5; i++) {
    http.post(
      `${BASE_URL}/rooms/${room.roomId}/messages`,
      JSON.stringify({ content: `Seed message ${i + 1}` }),
      { headers: authHeaders(host.token) },
    );
  }

  console.log(`[setup] Создана чат-комната: ${room.roomId}`);
  return { roomId: room.roomId, hostToken: host.token };
}

// ─── Основная функция ────────────────────────────────────────────────────────

export default function (data) {
  // Каждый VU регистрируется как участник (в реальном тесте это делается 1 раз,
  // но k6 не имеет per-VU init с data из setup, поэтому регистрируемся при нужде)
  const { token } = registerUser();

  // Сначала войти в комнату (иначе isActiveParticipant вернёт false)
  http.post(
    `${BASE_URL}/rooms/${data.roomId}/join`,
    null,
    { headers: authHeaders(token) },
  );

  sleep(jitteredSleep(0.1));

  // ── Write: отправить 1 сообщение ────────────────────────────────────────
  const msgText = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
  const sendStart = Date.now();

  const sendRes = http.post(
    `${BASE_URL}/rooms/${data.roomId}/messages`,
    JSON.stringify({ content: `[VU ${__VU} iter ${__ITER}] ${msgText}` }),
    { headers: authHeaders(token), tags: { step: 'send_message' } },
  );

  sendMsgDuration.add(Date.now() - sendStart);

  const sendOk = check(sendRes, {
    'POST /messages → 201':       (r) => r.status === 201,
    'response has message id':    (r) => r.json('id') !== undefined,
    'content совпадает':          (r) => r.json('content') !== undefined,
  });

  if (!sendOk) {
    sendErrors.add(1);
    msgDeliveryRate.add(false);
    console.warn(`[VU ${__VU}] send failed: ${sendRes.status}`);
  } else {
    msgDeliveryRate.add(true);
  }

  sleep(jitteredSleep(0.1));

  // ── Read: прочитать историю 5 раз (соотношение 1:5) ─────────────────────
  for (let i = 0; i < 5; i++) {
    const getStart = Date.now();

    const getRes = http.get(
      `${BASE_URL}/rooms/${data.roomId}/messages?limit=50&offset=0`,
      { headers: authHeaders(token), tags: { step: 'get_messages' } },
    );

    getMsgDuration.add(Date.now() - getStart);

    check(getRes, {
      'GET /messages → 200':       (r) => r.status === 200,
      'список сообщений - массив': (r) => Array.isArray(r.json()),
    });

    sleep(jitteredSleep(0.05));
  }

  // Общая пауза для выхода на целевой RPS
  sleep(jitteredSleep(0.3));
}

// ─── teardown ────────────────────────────────────────────────────────────────

export function teardown(data) {
  const res = http.del(
    `${BASE_URL}/rooms/${data.roomId}`,
    null,
    { headers: authHeaders(data.hostToken) },
  );
  console.log(`[teardown] Удаление чат-комнаты: ${res.status}`);
}
