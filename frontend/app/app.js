import * as Api from './api.js';
import * as RTC from './webrtc.js';
import * as UI from './ui.js';
import { connectSocket } from './socket.js';

const state = {
  currentRoom: null,
  currentUser: null,
  localStream: null,
  isMicOn: false,
  socket: null,
  peerConnection: null,
  activeParticipants: new Map(),
  isHost: false,
  rooms: [],
};

const {
  elements,
  showScreen,
  showNotification,
  showAuthError,
  updateParticipantList,
  appendMessage,
  getEl,
  refreshElements,
} = UI;

// onRoomSelected теперь принимает isHost как третий параметр
async function onRoomSelected(roomId, invite, isHost) {
  const roomItems = document.querySelectorAll('.room-item');
  roomItems.forEach(el => el.classList.remove('active'));
  const activeItem = document.querySelector(`.room-item[data-id="${roomId}"]`);
  if (activeItem) activeItem.classList.add('active');

  window.currentRoomInvite = invite;

  // Устанавливаем флаг хоста сразу из переданного значения
  state.isHost = isHost;
  state.currentRoom = roomId;

  // Показываем/скрываем кнопки хоста
  UI.updateHostControls(isHost);

  // Присоединяемся к комнате (этот вызов просто добавляет участника, если ещё не добавлен)
  await Api.joinRoom(roomId);

  // Очищаем чат и показываем контейнер
  if (elements.messagesList) elements.messagesList.innerHTML = '';
  getEl('noChatSelected')?.classList.add('hidden');
  getEl('chatContainer')?.classList.remove('hidden');

  // Загружаем историю сообщений
  const messages = await Api.fetchMessages(roomId);
  messages.forEach(msg => appendMessage(msg));

  // Подключаем WebSocket
  const token = Api.getToken();
  if (token) {
    connectSocket(token, roomId, state, {
      onOpen: () => showNotification('Соединение установлено'),
      onMessage: (msg) => handleSocketMessage(msg),
      onClose: () => showNotification('Соединение потеряно', 'error'),
    });
  }
}

function handleSocketMessage(msg) {
  switch (msg.type) {
    case 'room_state':
      state.activeParticipants.clear();
      const parts = msg.data.participants || [];
      parts.forEach(p => state.activeParticipants.set(p.id, p.username));
      updateParticipantList(state.activeParticipants);
      break;

    case 'user_joined':
      state.activeParticipants.set(msg.userId, msg.username);
      updateParticipantList(state.activeParticipants);
      break;

    case 'user_left':
      state.activeParticipants.delete(msg.userId);
      updateParticipantList(state.activeParticipants);
      RTC.removeRemoteVideo(msg.userId);
      break;

    case 'offer':
      RTC.handleOffer(
        msg,
        state.currentRoom,
        state.socket,
        state.localStream,
        state.peerConnection,
        (pc) => { state.peerConnection = pc; },
        (stream) => { state.localStream = stream; }
      );
      break;

    case 'answer':
      if (state.peerConnection) {
        state.peerConnection.setRemoteDescription(
          new RTCSessionDescription(msg.data)
        );
      }
      break;

    case 'candidate':
      if (state.peerConnection && msg.data) {
        state.peerConnection
          .addIceCandidate(new RTCIceCandidate(msg.data))
          .catch(console.error);
      }
      break;

    case 'chat_message':
      appendMessage(msg);
      break;
  }
}

function logout() {
  localStorage.clear();
  location.reload();
}

function leaveRoom() {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }

  if (state.localStream) {
    state.localStream.getTracks().forEach(track => track.stop());
    state.localStream = null;
    const localVideo = getEl('local-video');
    if (localVideo) localVideo.srcObject = null;
  }

  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
    state.socket = null;
  }

  const grid = getEl('participantsGrid');
  if (grid) {
    grid.querySelectorAll('.video-wrapper').forEach(w => w.remove());
  }

  state.activeParticipants.clear();
  updateParticipantList(state.activeParticipants);

  state.currentRoom = null;
  state.isMicOn = false;

  getEl('chatContainer')?.classList.add('hidden');
  getEl('noChatSelected')?.classList.remove('hidden');

  if (elements.roomsList) {
    elements.roomsList.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
  }

  showNotification('Вы вышли из комнаты');
}

async function copyCurrentInvite() {
  if (!window.currentRoomInvite) {
    showNotification('Сначала выберите комнату', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(window.currentRoomInvite);
    showNotification('Код приглашения скопирован!');
  } catch (err) {
    showNotification('Не удалось скопировать код', 'error');
  }
}

function bindEvents() {
  refreshElements();

  if (elements.loginBtn) elements.loginBtn.onclick = () => Api.login();
  if (elements.registerBtn) elements.registerBtn.onclick = () => Api.register();
  if (elements.createRoomBtn) elements.createRoomBtn.onclick = () => Api.createRoom();
  if (elements.logoutBtn) elements.logoutBtn.onclick = logout;
  if (elements.sendMessageBtn) {
    elements.sendMessageBtn.onclick = () => Api.sendMessage(state.currentRoom);
  }
  if (elements.messageInput) {
    elements.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') Api.sendMessage(state.currentRoom);
    });
  }
  if (elements.toggleMicBtn) {
    elements.toggleMicBtn.onclick = () => RTC.toggleMic(state.localStream, elements.toggleMicBtn);
  }
  if (elements.leaveRoomBtn) elements.leaveRoomBtn.onclick = leaveRoom;
  if (elements.callBtn) {
    elements.callBtn.onclick = () => RTC.startCall(
      state.currentRoom,
      state.socket,
      state.localStream,
      state.peerConnection,
      (stream) => { state.localStream = stream; },
      (pc) => { state.peerConnection = pc; }
    );
  }

  const copyInviteBtn = getEl('copyInviteBtn');
  if (copyInviteBtn) copyInviteBtn.onclick = copyCurrentInvite;

  const joinByInviteBtn = getEl('joinByInviteBtn');
  if (joinByInviteBtn) joinByInviteBtn.onclick = () => Api.joinByCode();

  getEl('switchToRegister')?.addEventListener('click', (e) => {
    e.preventDefault();
    elements.loginForm?.classList.add('hidden');
    elements.registerForm?.classList.remove('hidden');
  });
  getEl('switchToLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    elements.registerForm?.classList.add('hidden');
    elements.loginForm?.classList.remove('hidden');
  });
}

async function init() {
  const token = Api.getToken();
  if (!token) {
    showScreen('auth');
    return;
  }

  try {
    const response = await fetch(`${Api.API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const user = await response.json();
      state.currentUser = user;
      Api.setCurrentUser(user);
      showScreen('app');
      await Api.loadRooms();
    } else {
      logout();
    }
  } catch (e) {
    console.error('Auth check failed', e);
    showScreen('auth');
  }
}

window.__onRoomSelected = onRoomSelected;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    init();
  });
} else {
  bindEvents();
  init();
}