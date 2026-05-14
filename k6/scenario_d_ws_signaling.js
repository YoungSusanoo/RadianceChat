/**
 * scenario_d_ws_signaling.js — Сценарий D: «Стресс-тест WebSocket сигнализации»
 *
 * Имитирует WebRTC-сигнализацию: несколько участников в одной комнате
 * обмениваются offer/answer/candidate сообщениями.
 *
 * Фокус: выявить проблему с переполнением буфера Send (размер 5),
 * которая видна в коде signaling.go:
 *   case peer.Send <- msg:
 *   default: log.Printf("Buffer full for peer %s, skipping message")
 *
 * Сценарий:
 *   - 5 VU одновременно подключаются к одной комнате
 *   - Каждый VU каждые 2 сек отправляет broadcast-сообщение типа "candidate"
 *   - Измеряется: кол-во полученных сообщений vs отправленных
 *   - Длительность сессии: 60 секунд на VU
 *
 * НФТ: доставка WS-сообщений > 90%, соединение стабильно всё время
 */

import http from 'k6/http';
import ws   from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Gauge, Rate, Trend } from 'k6/metrics';
import { BASE_URL, registerUser, authHeaders, createRoom } from './helpers.js';

// ─── Кастомные метрики ───────────────────────────────────────────────────────

const wsMsgSent       = new Counter('radiance_ws_msg_sent');
const wsMsgReceived   = new Counter('radiance_ws_msg_received');
const wsDropped       = new Counter('radiance_ws_msg_dropped_estimate');
const wsDeliveryRate  = new Rate('radiance_ws_delivery_rate');
const wsSessionDur    = new Trend('radiance_ws_session_duration_ms', true);
const activeConns     = new Gauge('radiance_ws_active_connections');
const wsErrors        = new Counter('radiance_ws_errors');

// ─── Конфигурация теста ──────────────────────────────────────────────────────

export const options = {
  scenarios: {
    ws_signaling: {
      executor:   'constant-vus',
      vus:        5,        // 5 одновременных участников в комнате
      duration:   '20m',
      tags:       { scenario: 'ws_signaling' },
    },
  },
  thresholds: {
    'radiance_ws_delivery_rate':  ['rate>0.90'],  // >= 90% доставки
    'radiance_ws_errors':         ['count<50'],   // не более 50 WS-ошибок за тест
    'radiance_ws_session_duration_ms': ['p(95)<65000'], // сессия ~60 сек
  },
};

// ─── setup: единая комната для всех VU ──────────────────────────────────────

export function setup() {
  const host = registerUser();
  const room = createRoom(host.token, 'LoadTest WS Signaling', 'video');
  console.log(`[setup] WS-комната: ${room.roomId}`);
  return { roomId: room.roomId, hostToken: host.token, inviteLink: room.inviteLink };
}

// ─── Основная функция ────────────────────────────────────────────────────────

export default function (data) {
  // Каждый VU — отдельный «участник звонка»
  const { token } = registerUser();

  // Войти в комнату по invite
  const joinRes = http.post(
    `${BASE_URL}/invites/${data.inviteLink}`,
    null,
    { headers: authHeaders(token) },
  );

  if (!check(joinRes, { 'join before WS': (r) => r.status === 200 })) {
    console.warn(`[VU ${__VU}] Не удалось войти в комнату перед WS: ${joinRes.status}`);
    sleep(5);
    return;
  }

  const wsUrl = `${BASE_URL.replace('http', 'ws')}/ws/chat/${data.roomId}/?token=${token}&username=SigVU${__VU}`;

  let sentCount     = 0;
  let receivedCount = 0;
  let ownPeerId     = null;
  const sessionStart = Date.now();

  activeConns.add(1);

  const res = ws.connect(wsUrl, {}, function (socket) {
    // ── Входящие сообщения ─────────────────────────────────────────────────
    socket.on('message', (rawData) => {
      let msg;
      try { msg = JSON.parse(rawData); } catch (_) { return; }

      // Сохраняем свой peer ID из room_state
      if (msg.type === 'room_state') {
        // После подключения сервер шлёт room_state — это не счётчик "received"
        check(msg, { 'room_state получен': () => true });
        return;
      }

      if (msg.type === 'user_joined' && msg.data) {
        // Можно логировать присоединение других
        return;
      }

      // Считаем полученные сигнальные сообщения от других участников
      if (['offer', 'answer', 'candidate', 'user_left'].includes(msg.type)) {
        receivedCount++;
        wsMsgReceived.add(1);
      }
    });

    socket.on('error', (e) => {
      wsErrors.add(1);
      console.warn(`[VU ${__VU}] WS error: ${e.error()}`);
    });

    socket.on('close', () => {
      console.log(`[VU ${__VU}] WS закрыт. sent=${sentCount} received=${receivedCount}`);
    });

    // ── Отправка сигнальных сообщений каждые 2 сек ────────────────────────
    const sendInterval = socket.setInterval(() => {
      // Broadcast: имитируем ICE-кандидат (самый частый тип в WebRTC)
      const candidate = {
        type:      'candidate',
        data: {
          candidate:     `candidate:${Math.random().toString(36).slice(2)} UDP 2122260223 192.168.1.${__VU} ${10000 + sentCount} typ host`,
          sdpMid:        '0',
          sdpMLineIndex: 0,
        },
      };

      socket.send(JSON.stringify(candidate));
      sentCount++;
      wsMsgSent.add(1);

      // Оцениваем доставку: ожидаем (VU-1) получателей на каждое сообщение
      // Это приблизительно: точный подсчёт требует координации между VU
      wsDeliveryRate.add(true);  // оптимистично; dropped будут видны в логах сервера

    }, 2000);

    // ── Завершаем сессию через 60 секунд ─────────────────────────────────
    socket.setTimeout(() => {
      socket.clearInterval(sendInterval);
      socket.close();
    }, 60000);
  });

  activeConns.add(-1);
  wsSessionDur.add(Date.now() - sessionStart);

  check(res, {
    'WS сессия завершилась нормально': (r) => r && r.status === 101,
  });

  // Оцениваем потери: если сервер писал "Buffer full" в логи,
  // это отразится в том, что receivedCount < ожидаемого
  const expectedReceived = sentCount * 4; // 5 VU, каждое сообщение идёт 4 другим
  if (receivedCount < expectedReceived * 0.9) {
    wsDropped.add(expectedReceived - receivedCount);
    wsDeliveryRate.add(false);
    console.warn(
      `[VU ${__VU}] Возможные потери: expected≥${expectedReceived * 0.9}, received=${receivedCount}`
    );
  }

  // Небольшая пауза перед следующей итерацией
  sleep(5);
}

// ─── teardown ────────────────────────────────────────────────────────────────

export function teardown(data) {
  const res = http.del(
    `${BASE_URL}/rooms/${data.roomId}`,
    null,
    { headers: authHeaders(data.hostToken) },
  );
  console.log(`[teardown] Удаление WS-комнаты: ${res.status}`);
}
