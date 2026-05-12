const API_URL = window.location.origin + '/api';
const tokenKey = 'radiance_token';
const userIdKey = 'radiance_user_id';

// State management
let currentRoom = null;
let currentUser = null;
let localStream = null;
let videoStream = null; // Separate stream for video to prevent memory leaks
let socket = null;
let peerConnections = new Map(); // Map of peerID -> RTCPeerConnection
let activeParticipants = new Map(); // Map of peerID -> {username, userId}
let isCallActive = false;
let isMicOn = false;
let isVideoOn = false;
let currentRoomHostId = null;
let currentRoomName = '';

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Utility functions
const getToken = () => localStorage.getItem(tokenKey);
const setToken = (token) => localStorage.setItem(tokenKey, token);
const setUserId = (id) => localStorage.setItem(userIdKey, id);
const getUserId = () => localStorage.getItem(userIdKey);
const getEl = (id) => document.getElementById(id);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
}[char]));

// Screen management
function showScreen(screenName) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  
  switch(screenName) {
    case 'auth':
      getEl('authScreen')?.classList.add('active');
      break;
    case 'rooms':
      getEl('roomsScreen')?.classList.add('active');
      break;
    case 'chat':
      getEl('chatScreen')?.classList.add('active');
      break;
  }
}

function showNotification(message, type = 'success') {
  const notifications = getEl('notifications');
  if (!notifications) return;
  
  const note = document.createElement('div');
  note.className = `notification ${type}`;
  note.textContent = message;
  notifications.appendChild(note);
  setTimeout(() => note.remove(), 3000);
}

function showAuthError(message) {
  const errorEl = getEl('authError');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    setTimeout(() => errorEl.classList.add('hidden'), 5000);
  }
}

// Authentication
async function login() {
  const email = getEl('loginEmail')?.value;
  const password = getEl('loginPassword')?.value;

  if (!email || !password) {
    return showAuthError('Введите email и пароль');
  }

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (response.ok) {
      setToken(data.token);
      setUserId(data.user.id);
      currentUser = data.user;
      showScreen('rooms');
      await loadRooms();
      updateUserInfo();
    } else {
      showAuthError(data.error || 'Ошибка входа');
    }
  } catch (err) {
    showAuthError('Сервер недоступен');
  }
}

async function register() {
  const email = getEl('regEmail')?.value;
  const password = getEl('regPassword')?.value;
  const passwordConfirm = getEl('regPasswordConfirm')?.value;

  if (!email || !password) {
    return showAuthError('Введите email и пароль');
  }

  if (password !== passwordConfirm) {
    return showAuthError('Пароли не совпадают');
  }

  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (response.ok) {
      setToken(data.token);
      setUserId(data.user.id);
      currentUser = data.user;
      showScreen('rooms');
      await loadRooms();
      updateUserInfo();
      showNotification('Регистрация успешна!');
    } else {
      showAuthError(data.error || 'Ошибка регистрации');
    }
  } catch (err) {
    showAuthError('Сервер недоступен');
  }
}

function logout() {
  cleanup();
  localStorage.clear();
  location.reload();
}

function updateUserInfo() {
  const userInfo = getEl('roomsUserInfo');
  if (userInfo && currentUser) {
    userInfo.textContent = currentUser.email || currentUser.username || 'Пользователь';
  }
}

// Room management
async function loadRooms() {
  try {
    const response = await fetch(`${API_URL}/rooms`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    
    if (!response.ok) return;
    const rooms = await response.json();
    
    const roomsList = getEl('roomsList');
    const noRooms = getEl('noRooms');
    const roomCount = getEl('roomCount');
    
    if (roomsList) {
      if (rooms.length === 0) {
        roomsList.innerHTML = '';
        noRooms?.classList.remove('hidden');
        if (roomCount) roomCount.textContent = '0 комнат';
        return;
      }

      noRooms?.classList.add('hidden');
      if (roomCount) roomCount.textContent = `${rooms.length} комнат`;

      roomsList.innerHTML = rooms.map(room => `
        <div class="room-card" data-id="${room.id}" data-invite="${room.invite_link || ''}" data-name="${room.name}" data-host="${room.host_id}">
          <div class="room-card-header">
            <div class="room-card-title">${room.name}</div>
            <div class="room-card-code">${room.invite_link}</div>
          </div>
          <div class="room-card-info">
            Создана: ${new Date(room.created_at).toLocaleDateString('ru-RU')}
          </div>
          <div class="room-card-actions">
            <button class="btn-primary join-room-btn">Войти</button>
            <button class="btn-secondary copy-code-btn">Копировать код</button>
            <button class="btn-icon btn-danger delete-room-btn" title="Удалить комнату">🗑️</button>
          </div>
        </div>
      `).join('');

      // Add event listeners
      roomsList.querySelectorAll('.room-card').forEach(card => {
        const joinBtn = card.querySelector('.join-room-btn');
        const copyBtn = card.querySelector('.copy-code-btn');
        const deleteBtn = card.querySelector('.delete-room-btn');
        
        joinBtn?.addEventListener('click', () => {
          const roomId = card.getAttribute('data-id');
          enterRoom(roomId, card.getAttribute('data-name'), card.getAttribute('data-invite'));
        });
        
        copyBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          const code = card.getAttribute('data-invite');
          copyToClipboard(code);
        });

        deleteBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          const roomId = card.getAttribute('data-id');
          const roomName = card.getAttribute('data-name');
          const hostId = card.getAttribute('data-host');
          showDeleteRoomModal(roomId, roomName, hostId);
        });
      });
    }
  } catch (err) {
    console.error("Ошибка загрузки комнат", err);
    showNotification('Ошибка загрузки комнат', 'error');
  }
}

async function createRoom() {
  const name = getEl('roomNameInput')?.value.trim();
  if (!name) {
    return showNotification('Введите название комнаты', 'error');
  }

  try {
    const response = await fetch(`${API_URL}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ name, type: 'public' })
    });

    if (response.ok) {
      const data = await response.json();
      getEl('roomNameInput').value = '';
      await loadRooms();
      
      if (data.invite_link) {
        await copyToClipboard(data.invite_link);
        showNotification(`Комната "${name}" создана! Код скопирован.`);
      }
    } else {
      const errorData = await response.json();
      showNotification(errorData.error || 'Ошибка создания комнаты', 'error');
    }
  } catch (error) {
    showNotification('Ошибка сети', 'error');
  }
}

async function joinByCode() {
  const code = getEl('inviteCodeInput')?.value.trim();
  if (!code) {
    return showNotification('Введите код приглашения', 'error');
  }

  try {
    const response = await fetch(`${API_URL}/invites/${code}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (response.ok) {
      const data = await response.json();
      showNotification('Вы успешно вошли в комнату!');
      getEl('inviteCodeInput').value = '';
      await loadRooms();
      
      if (data.room_id) {
        // Get room details
        const roomResponse = await fetch(`${API_URL}/rooms/${data.room_id}`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (roomResponse.ok) {
          const room = await roomResponse.json();
          enterRoom(room.id, room.name, room.invite_link);
        }
      }
    } else {
      const errorData = await response.json();
      showNotification(errorData.error || 'Неверный код или комната полна', 'error');
    }
  } catch (err) {
    showNotification('Ошибка сервера', 'error');
  }
}

// Room deletion functions
let roomToDelete = null;

function showDeleteRoomModal(roomId, roomName, hostId) {
  // Check if current user is the host
  if (hostId !== getUserId()) {
    showNotification('Только создатель комнаты может её удалить', 'error');
    return;
  }

  roomToDelete = roomId;
  const deleteRoomInfo = getEl('deleteRoomInfo');
  if (deleteRoomInfo) {
    deleteRoomInfo.textContent = `Вы уверены, что хотите удалить комнату "${roomName}"? Это действие нельзя отменить.`;
  }
  getEl('deleteRoomModal')?.classList.remove('hidden');
}

async function deleteRoom() {
  if (!roomToDelete) return;

  try {
    const response = await fetch(`${API_URL}/rooms/${roomToDelete}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (response.ok) {
      showNotification('Комната успешно удалена');
      getEl('deleteRoomModal')?.classList.add('hidden');
      roomToDelete = null;
      await loadRooms();
    } else {
      const errorData = await response.json();
      showNotification(errorData.error || 'Ошибка удаления комнаты', 'error');
    }
  } catch (err) {
    console.error("Error deleting room:", err);
    showNotification('Ошибка сети', 'error');
  }
}

function cancelDeleteRoom() {
  getEl('deleteRoomModal')?.classList.add('hidden');
  roomToDelete = null;
}

async function enterRoom(roomId, roomName, inviteCode) {
  try {
    const joinResponse = await fetch(`${API_URL}/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (!joinResponse.ok) {
      const errorText = await joinResponse.text();
      throw new Error(errorText || 'Join failed');
    }

    let resolvedRoomName = roomName;
    let resolvedInviteCode = inviteCode;
    currentRoomHostId = null;

    const roomResponse = await fetch(`${API_URL}/rooms/${roomId}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (roomResponse.ok) {
      const room = await roomResponse.json();
      resolvedRoomName = room.name || resolvedRoomName;
      resolvedInviteCode = room.invite_link || resolvedInviteCode;
      currentRoomHostId = room.host_id;
    }

    currentRoom = roomId;
    currentRoomName = resolvedRoomName || '';
    window.currentRoomInvite = resolvedInviteCode;
    
    // Update UI
    getEl('chatRoomName').textContent = resolvedRoomName;
    getEl('chatRoomInfo').textContent = `Код: ${resolvedInviteCode}`;
    updateParticipantList();
    
    // Clear messages
    const messagesList = getEl('messagesList');
    if (messagesList) messagesList.innerHTML = '';
    
    // Load message history
    await loadMessages(roomId);
    
    // Show chat screen
    showScreen('chat');
    
    // Initialize call UI
    updateCallUI();
    
    // Connect WebSocket
    const token = getToken();
    if (token && roomId) {
      connectSocket(token, roomId);
    }
    
    // Automatically start the call when entering the room
    await startCall();
    
    showNotification(`Вы вошли в комнату "${resolvedRoomName}"`);
  } catch (err) {
    console.error("Ошибка входа в комнату", err);
    showNotification('Ошибка входа в комнату', 'error');
  }
}

async function leaveRoom() {
  // Call backend API to leave the room
  if (currentRoom) {
    try {
      await fetch(`${API_URL}/rooms/${currentRoom}/leave`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
    } catch (err) {
      console.error("Error leaving room:", err);
      // Continue with cleanup even if API call fails
    }
  }

  // Cleanup WebSocket and connections
  cleanup();
  currentRoom = null;
  currentRoomHostId = null;
  currentRoomName = '';
  window.currentRoomInvite = null;
  
  // Update call UI and participants panel after leaving
  updateCallUI();
  updateParticipantList();
  
  showScreen('rooms');
  showNotification('Вы вышли из комнаты');
}

async function loadMessages(roomId) {
  try {
    const response = await fetch(`${API_URL}/rooms/${roomId}/messages`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    
    if (response.ok) {
      const messages = await response.json();
      if (messages && Array.isArray(messages)) {
        messages.forEach(msg => appendMessage(msg));
      }
    }
  } catch (err) {
    console.error("Не удалось загрузить историю чата", err);
  }
}

// WebSocket connection
let socketRetryCount = 0;
const MAX_SOCKET_RETRIES = 5;
const BASE_RETRY_DELAY = 3000;

async function connectSocket(token, roomId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws/chat/${roomId}/?token=${token}&username=${encodeURIComponent(currentUser?.username || currentUser?.email || 'User')}`;
  
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log("Connected to WebSocket");
    showNotification("Соединение установлено");
    // Reset retry count on successful connection
    socketRetryCount = 0;
  };

  socket.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      
      switch (msg.type) {
        case 'room_state':
          handleRoomState(msg);
          break;

        case 'user_joined':
          handleUserJoined(msg);
          break;

        case 'user_left':
          handleUserLeft(msg);
          break;

        case 'offer':
          await handleOffer(msg);
          break;

        case 'answer':
          await handleAnswer(msg);
          break;

        case 'candidate':
          await handleCandidate(msg);
          break;

        case 'chat_message':
          appendMessage(msg);
          break;

        case 'video_state_changed':
          handleVideoStateChanged(msg);
          break;

        case 'force_mute':
          handleForceMute();
          break;

        case 'participant_removed':
          handleParticipantRemoved(msg);
          break;

        case 'call_ended_for_all':
          handleCallEndedForAll(msg);
          break;

        case 'control_error':
          showNotification(msg.data?.error || 'Действие недоступно', 'error');
          break;
      }
    } catch (err) {
      console.error("Error handling WebSocket message:", err);
    }
  };

  socket.onclose = () => {
    console.log("WebSocket connection closed");
    showNotification("Соединение потеряно", "error");
    // Attempt to reconnect with exponential backoff
    if (socketRetryCount < MAX_SOCKET_RETRIES && currentRoom) {
      socketRetryCount++;
      const delay = BASE_RETRY_DELAY * Math.pow(2, socketRetryCount - 1);
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${socketRetryCount}/${MAX_SOCKET_RETRIES})`);
      setTimeout(() => {
        if (currentRoom) {
          connectSocket(token, currentRoom);
        }
      }, delay);
    } else if (socketRetryCount >= MAX_SOCKET_RETRIES) {
      showNotification("Не удалось восстановить соединение. Пожалуйста, обновите страницу.", "error");
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

function handleRoomState(msg) {
  activeParticipants.clear();
  const parts = msg.data?.participants || [];
  parts.forEach(p => {
    activeParticipants.set(p.id, { username: p.username, userId: p.userId });
  });
  updateParticipantList();
}

function handleUserJoined(msg) {
  const userId = msg.data?.userId || msg.userId;
  const username = msg.data?.username || msg.username;
  const peerId = msg.from;
  
  if (peerId) {
    activeParticipants.set(peerId, { username, userId });
    updateParticipantList();
    showNotification(`${username} присоединился к комнате`);
  }
}

function handleUserLeft(msg) {
  const peerId = msg.from;
  if (peerId) {
    activeParticipants.delete(peerId);
    updateParticipantList();
    removeRemoteVideo(peerId);
    
    // Close peer connection
    const pc = peerConnections.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.delete(peerId);
    }
  }
}

function handleVideoStateChanged(msg) {
  const peerId = msg.from;
  const videoEnabled = msg.data?.video_enabled;
  
  if (!peerId) return;
  
  const wrapper = document.getElementById(`wrapper-${peerId}`);
  if (!wrapper) return;
  
  const video = wrapper.querySelector('video');
  const placeholder = wrapper.querySelector('.no-video-placeholder');
  const status = wrapper.querySelector('.participant-status');
  
  if (videoEnabled) {
    // Video should be visible
    video.classList.remove('hidden');
    placeholder.classList.add('hidden');
    if (status) status.textContent = 'Видеозвонок';
  } else {
    // Video should be hidden
    video.classList.add('hidden');
    placeholder.classList.remove('hidden');
    if (status) status.textContent = 'Голосовой участник';
  }
}

function isCurrentUserHost() {
  return Boolean(currentRoomHostId && currentRoomHostId === getUserId());
}

function getDisplayName(participant) {
  return participant?.username || participant?.email || 'Участник';
}

function updateParticipantList() {
  const totalParticipants = activeParticipants.size + (currentRoom ? 1 : 0);
  const count = getEl('participantCount');
  const sidebarCount = getEl('sidebarParticipantCount');
  const list = getEl('participantsList');
  const hint = getEl('participantsPanelHint');
  const endForAllBtn = getEl('endCallForAllBtn');
  const isHost = isCurrentUserHost();

  if (count) count.textContent = totalParticipants;
  if (sidebarCount) sidebarCount.textContent = totalParticipants;
  if (hint) hint.textContent = isHost ? 'Вы управляете комнатой' : 'Текущий звонок';
  if (endForAllBtn) endForAllBtn.classList.toggle('hidden', !currentRoom || !isHost);

  if (!list) return;

  if (!currentRoom) {
    list.innerHTML = '<div class="participants-empty">Войдите в комнату, чтобы увидеть участников</div>';
    return;
  }

  const localName = getDisplayName(currentUser) || 'Вы';
  const rows = [`
    <div class="participant-row local">
      <div class="participant-avatar">${escapeHtml(localName.charAt(0).toUpperCase() || 'Я')}</div>
      <div class="participant-row-main">
        <span class="participant-row-name">${escapeHtml(localName)} <span class="self-label">вы</span></span>
        <span class="participant-row-meta">${isHost ? 'Организатор' : 'Участник'} • ${isMicOn ? 'микрофон включен' : 'микрофон выключен'}</span>
      </div>
    </div>
  `];

  activeParticipants.forEach((participant, peerId) => {
    const name = getDisplayName(participant);
    const role = participant.userId === currentRoomHostId ? 'Организатор' : 'Участник';
    const controls = isHost ? `
      <div class="participant-row-actions">
        <button class="btn-icon participant-action" data-action="mute" data-peer="${escapeHtml(peerId)}" title="Отключить микрофон">🔇</button>
        <button class="btn-icon btn-danger participant-action" data-action="remove" data-peer="${escapeHtml(peerId)}" title="Удалить участника">✕</button>
      </div>
    ` : '';

    rows.push(`
      <div class="participant-row">
        <div class="participant-avatar">${escapeHtml(name.charAt(0).toUpperCase() || 'У')}</div>
        <div class="participant-row-main">
          <span class="participant-row-name">${escapeHtml(name)}</span>
          <span class="participant-row-meta">${role}</span>
        </div>
        ${controls}
      </div>
    `);
  });

  list.innerHTML = rows.join('');
}

function sendRoomControl(type, peerId = '', data = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !currentRoom) {
    showNotification('Нет соединения с комнатой', 'error');
    return false;
  }

  socket.send(JSON.stringify({
    type,
    to: peerId,
    room_id: currentRoom,
    data
  }));
  return true;
}

function muteParticipant(peerId) {
  const participant = activeParticipants.get(peerId);
  if (!participant) return;

  if (sendRoomControl('mute_participant', peerId)) {
    showNotification(`Запрос на отключение микрофона отправлен: ${getDisplayName(participant)}`);
  }
}

function removeParticipant(peerId) {
  const participant = activeParticipants.get(peerId);
  if (!participant) return;

  if (!confirm(`Удалить участника "${getDisplayName(participant)}" из комнаты?`)) return;

  if (sendRoomControl('remove_participant', peerId)) {
    showNotification(`Участник удаляется: ${getDisplayName(participant)}`);
  }
}

function endCallForAll() {
  if (!confirm(`Завершить звонок для всех участников комнаты "${currentRoomName}"?`)) return;

  if (sendRoomControl('end_call_for_all')) {
    showNotification('Звонок завершается для всех участников');
  }
}

function handleForceMute() {
  const audioTrack = localStream?.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = false;
  }
  isMicOn = false;
  updateCallUI();
  showNotification('Организатор отключил ваш микрофон', 'error');
}

function handleParticipantRemoved(msg) {
  showNotification(msg.data?.reason || 'Организатор удалил вас из комнаты', 'error');
  leaveRoom();
}

function handleCallEndedForAll(msg) {
  showNotification(msg.data?.reason || 'Организатор завершил звонок для всех', 'error');
  leaveRoom();
}

// WebRTC functions
async function startCall() {
  if (!currentRoom) {
    return showNotification('Сначала войдите в комнату', 'error');
  }

  if (isCallActive) {
    return; // Call is already active, no need to start again
  }

  try {
    // Get local media stream - audio only for voice calling
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: true,
      video: false
    });
    
    // Update UI
    isCallActive = true;
    isMicOn = true;
    isVideoOn = false; // Video is disabled for voice-only calls
    updateCallUI();
    
    // Create peer connections for all existing participants
    activeParticipants.forEach((participant, peerId) => {
      createPeerConnection(peerId);
    });
    
    showNotification('Голосовой звонок начат');
  } catch (err) {
    console.error("Error starting call:", err);
    showNotification('Не удалось начать звонок. Проверьте разрешения микрофона.', 'error');
  }
}

function createPeerConnection(peerId) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(peerId, pc);

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Handle incoming tracks
  pc.ontrack = (event) => {
    const participant = activeParticipants.get(peerId);
    const username = participant?.username || 'Участник';
    addRemoteVideo(event.streams[0], peerId, username);
  };

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'candidate',
        from: getUserId(),
        to: peerId,
        room_id: currentRoom,
        data: event.candidate
      }));
    }
  };

  // Handle connection state changes
  pc.onconnectionstatechange = () => {
    console.log(`Peer connection state for ${peerId}:`, pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      removeRemoteVideo(peerId);
    }
  };

  // Create and send offer
  pc.createOffer()
    .then(offer => pc.setLocalDescription(offer))
    .then(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'offer',
          from: getUserId(),
          to: peerId,
          room_id: currentRoom,
          data: pc.localDescription
        }));
      }
    })
    .catch(err => {
      console.error("Error creating offer:", err);
    });

  return pc;
}

async function handleOffer(msg) {
  const peerId = msg.from;
  if (!peerId) return;

  let pc = peerConnections.get(peerId);
  if (!pc) {
    pc = new RTCPeerConnection(rtcConfig);
    peerConnections.set(peerId, pc);

    // Add local tracks if available
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      const participant = activeParticipants.get(peerId);
      const username = participant?.username || 'Участник';
      addRemoteVideo(event.streams[0], peerId, username);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'candidate',
          from: getUserId(),
          to: peerId,
          room_id: currentRoom,
          data: event.candidate
        }));
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Peer connection state for ${peerId}:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        removeRemoteVideo(peerId);
      }
    };
  }

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'answer',
        from: getUserId(),
        to: peerId,
        room_id: currentRoom,
        data: answer
      }));
    }
  } catch (err) {
    console.error("Error handling offer:", err);
  }
}

async function handleAnswer(msg) {
  const peerId = msg.from;
  if (!peerId) return;

  const pc = peerConnections.get(peerId);
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
    } catch (err) {
      console.error("Error handling answer:", err);
    }
  }
}

async function handleCandidate(msg) {
  const peerId = msg.from;
  if (!peerId || !msg.data) return;

  const pc = peerConnections.get(peerId);
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(msg.data));
    } catch (err) {
      console.error("Error adding ICE candidate:", err);
    }
  }
}

function endCall() {
  // Close all peer connections
  peerConnections.forEach((pc, peerId) => {
    pc.close();
    removeRemoteVideo(peerId);
  });
  peerConnections.clear();

  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Clear local video
  const localVideo = getEl('local-video');
  if (localVideo) {
    localVideo.srcObject = null;
  }

  // Update state
  isCallActive = false;
  isMicOn = false;
  isVideoOn = false;
  updateCallUI();

  showNotification('Звонок завершен');
  
  // Leave the room after ending the call
  leaveRoom();
}

function toggleMic() {
  if (!localStream) {
    return; // No stream available, nothing to toggle
  }
  
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    isMicOn = audioTrack.enabled;
    updateCallUI();
    updateParticipantList();
    showNotification(isMicOn ? 'Микрофон включен' : 'Микрофон выключен');
  }
}

async function toggleVideo() {
  if (!localStream) return;
  
  if (isVideoOn) {
    // Turn OFF video
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.stop();
      localStream.removeTrack(videoTrack);
    }
    
    // Stop the video stream to prevent memory leak
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }
    
    // Remove video track from all peer connections
    peerConnections.forEach((pc, peerId) => {
      const senders = pc.getSenders();
      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'video') {
          pc.removeTrack(sender);
        }
      });
      // Trigger renegotiation
      renegotiateWithPeer(peerId);
    });
    
    isVideoOn = false;
    showNotification('Камера выключена');
  } else {
    // Turn ON video
    try {
      // Stop existing video stream if any to prevent memory leak
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
      }
      
      videoStream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });
      
      const videoTrack = videoStream.getVideoTracks()[0];
      localStream.addTrack(videoTrack);
      
      // Add video track to all peer connections
      peerConnections.forEach((pc, peerId) => {
        pc.addTrack(videoTrack, localStream);
        // Trigger renegotiation
        renegotiateWithPeer(peerId);
      });
      
      isVideoOn = true;
      showNotification('Камера включена');
    } catch (err) {
      console.error("Error enabling video:", err);
      showNotification('Не удалось включить камеру', 'error');
      return;
    }
  }
  
  updateCallUI();
  notifyVideoStateChange();
}

async function renegotiateWithPeer(peerId) {
  const pc = peerConnections.get(peerId);
  if (!pc) return;
  
  // Check if connection is in a stable state to avoid race conditions
  if (pc.signalingState !== 'stable') {
    console.log(`Skipping renegotiation for ${peerId}: not in stable state (${pc.signalingState})`);
    return;
  }
  
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'offer',
        from: getUserId(),
        to: peerId,
        room_id: currentRoom,
        data: pc.localDescription
      }));
    }
  } catch (err) {
    console.error("Error renegotiating with peer:", peerId, err);
    showNotification('Ошибка при обновлении видеосвязи', 'error');
  }
}

function notifyVideoStateChange() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'video_state_changed',
      from: getUserId(),
      to: 'all',
      room_id: currentRoom,
      data: {
        video_enabled: isVideoOn
      }
    }));
  }
}

function updateCallUI() {
  const callInterface = getEl('callInterface');
  const endCallBtn = getEl('endCallBtn');
  const toggleMicBtn = getEl('toggleMicBtn');
  const toggleVideoBtn = getEl('toggleVideoBtn');
  const localStatus = getEl('localStatus');
  const callStatus = getEl('callStatus');
  const localParticipant = getEl('localParticipant');

  // Call interface is always visible when in a room
  if (callInterface) {
    callInterface.classList.toggle('hidden', !currentRoom);
  }
  
  // End call button is always visible when in a room (call is always active)
  if (endCallBtn) {
    endCallBtn.classList.toggle('hidden', !currentRoom);
  }

  // Update mic button - show when in room
  if (toggleMicBtn) {
    toggleMicBtn.classList.toggle('hidden', !currentRoom);
    // Show as active (red/disabled) when mic is off
    toggleMicBtn.classList.toggle('active', isCallActive && !isMicOn);
  }

  // Show video button
  if (toggleVideoBtn) {
    toggleVideoBtn.classList.toggle('hidden', !currentRoom);
    toggleVideoBtn.classList.toggle('active', isVideoOn);
  }
  
  // Update local video display
  if (localParticipant) {
    const videoElement = localParticipant.querySelector('video');
    const placeholder = localParticipant.querySelector('.no-video-placeholder');
    
    if (isVideoOn && localStream) {
      videoElement.srcObject = localStream;
      videoElement.classList.remove('hidden');
      placeholder.classList.add('hidden');
    } else {
      videoElement.classList.add('hidden');
      placeholder.classList.remove('hidden');
    }
  }

  // Update status text
  if (localStatus) {
    const status = [];
    if (isMicOn) status.push('Микрофон вкл.');
    if (isVideoOn) status.push('Камера вкл.');
    localStatus.textContent = status.join(' • ') || 'Микрофон выкл.';
  }

  if (callStatus) {
    callStatus.textContent = isVideoOn 
      ? 'Видеозвонок активен' 
      : 'Голосовой звонок активен';
  }
}

function addRemoteVideo(stream, peerId, username) {
  const grid = getEl('participantsGrid');
  if (!grid) return;

  const wrapper = document.getElementById(`wrapper-${peerId}`);
  
  if (wrapper) {
    // Update existing video element
    const video = wrapper.querySelector('video');
    if (video) {
      video.srcObject = stream;
      // Check if stream has video track
      const hasVideo = stream.getVideoTracks().length > 0;
      if (hasVideo) {
        video.classList.remove('hidden');
        wrapper.querySelector('.no-video-placeholder').classList.add('hidden');
        wrapper.querySelector('.participant-status').textContent = 'Видеозвонок';
      } else {
        video.classList.add('hidden');
        wrapper.querySelector('.no-video-placeholder').classList.remove('hidden');
        wrapper.querySelector('.participant-status').textContent = 'Голосовой участник';
      }
    }
    return;
  }
  
  // Create new video element
  const newWrapper = document.createElement('div');
  newWrapper.className = 'participant-card';
  newWrapper.id = `wrapper-${peerId}`;
  newWrapper.innerHTML = `
    <div class="participant-video">
      <video id="video-${peerId}" autoplay playsinline class="hidden"></video>
      <div class="no-video-placeholder">
        <span>🎙️</span>
        <p>Голосовой участник</p>
      </div>
    </div>
    <div class="participant-info">
      <span class="participant-name">${username}</span>
      <span class="participant-status" id="status-${peerId}">Голосовой участник</span>
    </div>
  `;
  grid.appendChild(newWrapper);
  
  const video = document.getElementById(`video-${peerId}`);
  if (video) {
    video.srcObject = stream;
    // Check if stream has video track
    const hasVideo = stream.getVideoTracks().length > 0;
    if (hasVideo) {
      video.classList.remove('hidden');
      newWrapper.querySelector('.no-video-placeholder').classList.add('hidden');
      newWrapper.querySelector('.participant-status').textContent = 'Видеозвонок';
    }
  }
  
  updateGridLayout();
}

function updateGridLayout() {
  const grid = getEl('participantsGrid');
  if (!grid) return;
  
  const count = grid.querySelectorAll('.participant-card').length;
  grid.setAttribute('data-count', count);
}

function removeRemoteVideo(peerId) {
  document.getElementById(`wrapper-${peerId}`)?.remove();
}

// Chat functions
async function sendMessage() {
  const text = getEl('messageInput')?.value.trim();
  if (!text || !currentRoom) return;

  try {
    const response = await fetch(`${API_URL}/rooms/${currentRoom}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ content: text })
    });

    if (response.ok) {
      getEl('messageInput').value = '';
      
      // Add message to UI immediately
      appendMessage({
        user_id: getUserId(),
        content: text,
        created_at: new Date().toISOString()
      });
    } else {
      const errorData = await response.json();
      showNotification('Ошибка отправки: ' + (errorData.error || response.status), 'error');
    }
  } catch (err) {
    console.error("Ошибка сети:", err);
    showNotification('Ошибка сети', 'error');
  }
}

function appendMessage(msg) {
  const messagesList = getEl('messagesList');
  if (!messagesList) return;
  
  const isMe = msg.user_id === getUserId();
  const msgHtml = `
    <li class="message ${isMe ? 'own' : ''}">
      <div class="message-content">${msg.content || msg.text}</div>
      <div class="message-time">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
    </li>
  `;
  messagesList.insertAdjacentHTML('beforeend', msgHtml);
  
  // Scroll to bottom
  messagesList.scrollTop = messagesList.scrollHeight;
}

// Utility functions
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showNotification('Скопировано в буфер обмена');
  } catch (err) {
    showNotification('Не удалось скопировать', 'error');
  }
}

function cleanup() {
  // Close WebSocket
  if (socket) {
    // Remove onclose handler to prevent reconnection
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    socket = null;
  }

  // Reset retry count
  socketRetryCount = 0;

  // Clear peer connections
  peerConnections.forEach((pc, peerId) => {
    pc.close();
    removeRemoteVideo(peerId);
  });
  peerConnections.clear();

  // Clear participants
  activeParticipants.clear();

  // Clear local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Clear video stream
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }

  // Reset participant count
  const count = getEl('participantCount');
  if (count) {
    count.textContent = '0';
  }

  updateParticipantList();

  // Reset call state
  isCallActive = false;
  isMicOn = false;
  isVideoOn = false;
}

// Initialization
async function init() {
  const token = getToken();
  if (!token) {
    showScreen('auth');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      currentUser = await response.json();
      showScreen('rooms');
      await loadRooms();
      updateUserInfo();
    } else {
      logout();
    }
  } catch (e) {
    console.error("Init error:", e);
    showScreen('auth');
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Auth
  getEl('loginBtn')?.addEventListener('click', login);
  getEl('registerBtn')?.addEventListener('click', register);
  getEl('switchToRegister')?.addEventListener('click', (e) => {
    e.preventDefault();
    getEl('loginForm')?.classList.add('hidden');
    getEl('registerForm')?.classList.remove('hidden');
  });
  getEl('switchToLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    getEl('registerForm')?.classList.add('hidden');
    getEl('loginForm')?.classList.remove('hidden');
  });

  // Rooms
  getEl('createRoomBtn')?.addEventListener('click', createRoom);
  getEl('joinByInviteBtn')?.addEventListener('click', joinByCode);
  getEl('refreshRoomsBtn')?.addEventListener('click', loadRooms);
  getEl('logoutBtn')?.addEventListener('click', logout);

  // Chat
  getEl('backToRoomsBtn')?.addEventListener('click', leaveRoom);
  getEl('copyInviteBtn')?.addEventListener('click', () => {
    if (window.currentRoomInvite) {
      copyToClipboard(window.currentRoomInvite);
    } else {
      showNotification('Нет кода приглашения', 'error');
    }
  });

  // Call
  getEl('endCallBtn')?.addEventListener('click', endCall);
  getEl('toggleMicBtn')?.addEventListener('click', toggleMic);
  getEl('toggleVideoBtn')?.addEventListener('click', toggleVideo);
  getEl('endCallForAllBtn')?.addEventListener('click', endCallForAll);
  getEl('participantsList')?.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('.participant-action');
    if (!actionBtn) return;

    const peerId = actionBtn.getAttribute('data-peer');
    const action = actionBtn.getAttribute('data-action');
    if (action === 'mute') muteParticipant(peerId);
    if (action === 'remove') removeParticipant(peerId);
  });

  // Messages
  getEl('sendMessageBtn')?.addEventListener('click', sendMessage);
  getEl('messageInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Incoming call modal (no longer needed with automatic call starting)
  getEl('acceptCallBtn')?.addEventListener('click', () => {
    getEl('incomingCallModal')?.classList.add('hidden');
  });
  getEl('rejectCallBtn')?.addEventListener('click', () => {
    getEl('incomingCallModal')?.classList.add('hidden');
    showNotification('Вызов отклонен');
  });

  // Delete room modal
  getEl('confirmDeleteBtn')?.addEventListener('click', deleteRoom);
  getEl('cancelDeleteBtn')?.addEventListener('click', cancelDeleteRoom);

  // Initialize app
  init();
});
