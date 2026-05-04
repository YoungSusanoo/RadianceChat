const API_URL = '/api';
const tokenKey = 'radiance_token';

const authSection = document.getElementById('authSection');
const appSection = document.getElementById('appSection');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const responseBox = document.getElementById('server-response');
const roomNameInput = document.getElementById('roomName');
const createRoomBtn = document.getElementById('createRoomBtn');
const refreshRoomsBtn = document.getElementById('refreshRoomsBtn');
const roomsList = document.getElementById('roomsList');
const inviteCodeInput = document.getElementById('inviteCode');
const joinByInviteBtn = document.getElementById('joinByInviteBtn');
const currentRoomName = document.getElementById('currentRoomName');
const currentInvite = document.getElementById('currentInvite');
const messagesList = document.getElementById('messagesList');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const loadMessagesBtn = document.getElementById('loadMessagesBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const deleteRoomBtn = document.getElementById('deleteRoomBtn');

let currentRoom = null;

function token() { return localStorage.getItem(tokenKey); }
function showResponse(data, isError = false) {
  responseBox.classList.remove('hidden');
  responseBox.style.color = isError ? '#ef4444' : '#10b981';
  responseBox.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || 'Invalid response' }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderAuthState() {
  const loggedIn = Boolean(token());
  authSection.classList.toggle('hidden', loggedIn);
  appSection.classList.toggle('hidden', !loggedIn);
}

async function auth(endpoint) {
  try {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) throw new Error('Введите email и пароль');
    const data = await request(endpoint, { method: 'POST', body: JSON.stringify({ email, password }) });
    localStorage.setItem(tokenKey, data.token);
    renderAuthState();
    await loadRooms();
    showResponse('Успешный вход');
  } catch (e) { showResponse(e.message, true); }
}

async function loadRooms() {
  try {
    const rooms = await request('/rooms');
    roomsList.innerHTML = '';
    rooms.forEach(room => {
      const li = document.createElement('li');
      li.innerHTML = `${room.name} (${room.type}) <button data-id="${room.id}">Войти</button>`;
      li.querySelector('button').onclick = () => joinRoom(room.id);
      roomsList.appendChild(li);
    });
  } catch (e) { showResponse(e.message, true); }
}

async function createRoom() {
  try {
    const room = await request('/rooms', { method: 'POST', body: JSON.stringify({ name: roomNameInput.value.trim(), type: 'public' }) });
    await joinRoom(room.id);
    await loadRooms();
  } catch (e) { showResponse(e.message, true); }
}

async function joinRoom(roomID) {
  try {
    await request(`/rooms/${roomID}/join`, { method: 'POST', body: '{}' });
    currentRoom = await request(`/rooms/${roomID}`);
    currentRoomName.textContent = currentRoom.name;
    currentInvite.textContent = currentRoom.invite_link;
    await loadMessages();
  } catch (e) { showResponse(e.message, true); }
}

async function joinByInvite() {
  try {
    const invite = inviteCodeInput.value.trim();
    await request(`/rooms/join/${invite}`, { method: 'POST', body: '{}' });
    await loadRooms();
    showResponse('Вошли по приглашению');
  } catch (e) { showResponse(e.message, true); }
}

async function loadMessages() {
  if (!currentRoom) return;
  try {
    const messages = await request(`/rooms/${currentRoom.id}/messages`);
    messagesList.innerHTML = '';
    [...messages].reverse().forEach(m => {
      const li = document.createElement('li');
      li.textContent = `${m.username}: ${m.content}`;
      messagesList.appendChild(li);
    });
  } catch (e) { showResponse(e.message, true); }
}

async function sendMessage() {
  if (!currentRoom) return showResponse('Сначала войдите в комнату', true);
  try {
    await request(`/rooms/${currentRoom.id}/messages`, { method: 'POST', body: JSON.stringify({ content: messageInput.value }) });
    messageInput.value = '';
    await loadMessages();
  } catch (e) { showResponse(e.message, true); }
}

async function leaveRoom() {
  if (!currentRoom) return;
  await request(`/rooms/${currentRoom.id}/leave`, { method: 'POST', body: '{}' });
  currentRoom = null;
  currentRoomName.textContent = '-';
  currentInvite.textContent = '-';
  messagesList.innerHTML = '';
}

async function deleteRoom() {
  if (!currentRoom) return;
  try {
    await request(`/rooms/${currentRoom.id}`, { method: 'DELETE' });
    await leaveRoom();
    await loadRooms();
    showResponse('Комната удалена');
  } catch (e) { showResponse(e.message, true); }
}

loginBtn.onclick = () => auth('/auth/login');
registerBtn.onclick = () => auth('/auth/register');
createRoomBtn.onclick = createRoom;
refreshRoomsBtn.onclick = loadRooms;
joinByInviteBtn.onclick = joinByInvite;
loadMessagesBtn.onclick = loadMessages;
sendMessageBtn.onclick = sendMessage;
leaveRoomBtn.onclick = leaveRoom;
deleteRoomBtn.onclick = deleteRoom;

renderAuthState();
if (token()) loadRooms();
