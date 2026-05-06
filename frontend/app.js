const API_URL = window.location.origin + '/api';
const tokenKey = 'radiance_token';
const userIdKey = 'radiance_user_id';

// State management
let currentRoom = null;
let currentUser = null;
let localStream = null;
let socket = null;
let peerConnections = new Map(); // Map of peerID -> RTCPeerConnection
let activeParticipants = new Map(); // Map of peerID -> {username, userId}
let isCallActive = false;
let isMicOn = false;
let isVideoOn = false;

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
        <div class="room-card" data-id="${room.id}" data-invite="${room.invite_link || ''}" data-name="${room.name}">
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
          </div>
        </div>
      `).join('');

      // Add event listeners
      roomsList.querySelectorAll('.room-card').forEach(card => {
        const joinBtn = card.querySelector('.join-room-btn');
        const copyBtn = card.querySelector('.copy-code-btn');
        
        joinBtn?.addEventListener('click', () => {
          const roomId = card.getAttribute('data-id');
          enterRoom(roomId, card.getAttribute('data-name'), card.getAttribute('data-invite'));
        });
        
        copyBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          const code = card.getAttribute('data-invite');
          copyToClipboard(code);
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

async function enterRoom(roomId, roomName, inviteCode) {
  try {
    await fetch(`${API_URL}/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    currentRoom = roomId;
    window.currentRoomInvite = inviteCode;
    
    // Update UI
    getEl('chatRoomName').textContent = roomName;
    getEl('chatRoomInfo').textContent = `Код: ${inviteCode}`;
    
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
    
    showNotification(`Вы вошли в комнату "${roomName}"`);
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
  window.currentRoomInvite = null;
  
  // Update call UI to hide interface (will be called by updateCallUI)
  updateCallUI();
  
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

function updateParticipantList() {
  const count = getEl('participantCount');
  if (count) {
    count.textContent = activeParticipants.size + 1; // +1 for local user
  }
}

// WebRTC functions
async function startCall() {
  if (!currentRoom) {
    return showNotification('Сначала войдите в комнату', 'error');
  }

  if (isCallActive) {
    return showNotification('Звонок уже активен', 'error');
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
}

function toggleMic() {
  if (!localStream) {
    showNotification('Сначала начните звонок', 'error');
    return;
  }
  
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    isMicOn = audioTrack.enabled;
    updateCallUI();
    showNotification(isMicOn ? 'Микрофон включен' : 'Микрофон выключен');
  }
}

function toggleVideo() {
  if (!localStream) return;
  
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    isVideoOn = videoTrack.enabled;
    updateCallUI();
  }
}

function updateCallUI() {
  const callInterface = getEl('callInterface');
  const startCallBtn = getEl('startCallBtn');
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
  
  // Update buttons based on call state
  if (startCallBtn) {
    startCallBtn.classList.toggle('hidden', isCallActive);
  }
  if (endCallBtn) {
    endCallBtn.classList.toggle('hidden', !isCallActive);
  }

  // Update mic button - show when in room, but only active during call
  if (toggleMicBtn) {
    // Always show mic button when in a room (currentRoom is set)
    toggleMicBtn.classList.toggle('hidden', !currentRoom);
    // Only show as active (red/disabled) when mic is off during call
    toggleMicBtn.classList.toggle('active', isCallActive && !isMicOn);
  }

  // Hide video button for voice-only calls
  if (toggleVideoBtn) {
    toggleVideoBtn.classList.add('hidden');
  }

  // Hide video elements for voice-only calls
  if (localParticipant) {
    const videoElement = localParticipant.querySelector('video');
    const placeholder = localParticipant.querySelector('.no-video-placeholder');
    if (videoElement) {
      videoElement.classList.add('hidden');
    }
    if (placeholder) {
      placeholder.classList.remove('hidden');
    }
  }

  // Update status text
  if (localStatus) {
    localStatus.textContent = isMicOn ? 'Микрофон вкл.' : 'Микрофон выкл.';
  }

  if (callStatus) {
    callStatus.textContent = isCallActive ? 'Голосовой звонок активен' : 'Готов к звонку';
  }
}

function addRemoteVideo(stream, peerId, username) {
  if (document.getElementById(`wrapper-${peerId}`)) return;
  
  const grid = getEl('participantsGrid');
  if (!grid) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'participant-card';
  wrapper.id = `wrapper-${peerId}`;
  wrapper.innerHTML = `
    <div class="participant-video">
      <video id="video-${peerId}" autoplay playsinline class="hidden"></video>
      <div class="no-video-placeholder">
        <span>🎙️</span>
        <p>Голосовой участник</p>
      </div>
    </div>
    <div class="participant-info">
      <span class="participant-name">${username}</span>
    </div>
  `;
  grid.appendChild(wrapper);
  
  const video = document.getElementById(`video-${peerId}`);
  if (video) {
    video.srcObject = stream;
  }
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

  // End call
  if (isCallActive) {
    endCall();
  }

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

  // Reset participant count
  const count = getEl('participantCount');
  if (count) {
    count.textContent = '0';
  }

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
  getEl('leaveRoomBtn')?.addEventListener('click', leaveRoom);
  getEl('copyInviteBtn')?.addEventListener('click', () => {
    if (window.currentRoomInvite) {
      copyToClipboard(window.currentRoomInvite);
    } else {
      showNotification('Нет кода приглашения', 'error');
    }
  });

  // Call
  getEl('startCallBtn')?.addEventListener('click', startCall);
  getEl('endCallBtn')?.addEventListener('click', endCall);
  getEl('toggleMicBtn')?.addEventListener('click', toggleMic);

  // Messages
  getEl('sendMessageBtn')?.addEventListener('click', sendMessage);
  getEl('messageInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Incoming call modal
  getEl('acceptCallBtn')?.addEventListener('click', async () => {
    getEl('incomingCallModal')?.classList.add('hidden');
    // Start the call when accepting
    if (!isCallActive && currentRoom) {
      await startCall();
    }
  });
  getEl('rejectCallBtn')?.addEventListener('click', () => {
    getEl('incomingCallModal')?.classList.add('hidden');
    showNotification('Вызов отклонен');
  });

  // Initialize app
  init();
});
