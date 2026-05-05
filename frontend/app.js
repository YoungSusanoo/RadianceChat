const API_URL = window.location.origin + '/api'; 
const tokenKey = 'radiance_token';
const userIdKey = 'radiance_user_id';

let currentRoom = null;
let currentUser = null;
let localStream = null;
let isMicOn = false;
let socket = null;
let peerConnection = null;

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const getToken = () => localStorage.getItem(tokenKey);
const setToken = (token) => localStorage.setItem(tokenKey, token);
const setUserId = (id) => localStorage.setItem(userIdKey, id);


const getEl = (id) => document.getElementById(id);
const joinByInviteBtn = getEl('joinByInviteBtn');
if (joinByInviteBtn) {
    joinByInviteBtn.onclick = joinByCode;
}

const elements = {
    authScreen: getEl('authScreen'),
    appScreen: getEl('appScreen'),
    loginForm: getEl('loginForm'),
    registerForm: getEl('registerForm'),
    loginEmail: getEl('loginEmail'),
    loginPassword: getEl('loginPassword'),
    regEmail: getEl('regEmail'),
    regPassword: getEl('regPassword'),
    loginBtn: getEl('loginBtn'),
    registerBtn: getEl('registerBtn'),
    roomNameInput: getEl('roomNameInput'),
    createRoomBtn: getEl('createRoomBtn'),
    roomsList: getEl('roomsList'),
    messagesList: getEl('messagesList'),
    messageInput: getEl('messageInput'),
    sendMessageBtn: getEl('sendMessageBtn'),
    logoutBtn: getEl('logoutBtn'),
    authError: getEl('authError'),
    notification: getEl('notifications'), 
    toggleMicBtn: getEl('toggleMicBtn'),   
    callBtn: getEl('callBtn'),
    leaveRoomBtn: getEl('leaveRoomBtn')
};

function showScreen(screenName) {
    if (screenName === 'app') {
        elements.authScreen?.classList.remove('active');
        elements.appScreen?.classList.add('active');
    } else {
        elements.appScreen?.classList.remove('active');
        elements.authScreen?.classList.add('active');
    }
}

function showNotification(message, type = 'success') {
    if (elements.notification) {
        const note = document.createElement('div');
        note.className = `notification ${type}`;
        note.textContent = message;
        elements.notification.appendChild(note);
        setTimeout(() => note.remove(), 3000);
    }
}

async function login() {
    const email = elements.loginEmail?.value;
    const password = elements.loginPassword?.value;

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
            showScreen('app');
            // УДАЛЕНО: connectSocket(data.token); - Нельзя подключаться без RoomID
            await loadRooms();
        } else {
            showAuthError(data.error || 'Ошибка входа');
        }
    } catch (err) {
        showAuthError('Сервер недоступен');
    }
}

async function register() {
    const email = elements.regEmail?.value;
    const password = elements.regPassword?.value;

    if (!email || !password) {
        return showAuthError('Введите email и пароль');
    }

    try {
        const response = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }) // Поля должны совпадать с моделями в Go
        });

        const data = await response.json();
        if (response.ok) {
            setToken(data.token);
            setUserId(data.user.id);
            currentUser = data.user;
            showScreen('app');
            await loadRooms();
            showNotification('Регистрация успешна!');
        } else {
            showAuthError(data.error || 'Ошибка регистрации');
        }
    } catch (err) {
        showAuthError('Сервер недоступен');
    }
}

if (elements.registerBtn) elements.registerBtn.onclick = register;

async function loadRooms() {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (!response.ok) return;
        const rooms = await response.json();
        
        if (elements.roomsList) {
            // Если комнат нет, показываем заглушку
            if (rooms.length === 0) {
                elements.roomsList.innerHTML = '<li class="empty-list">У вас пока нет активных комнат</li>';
                return;
            }

            elements.roomsList.innerHTML = rooms.map(room => `
                <li class="room-item" data-id="${room.id}" data-invite="${room.invite_link || ''}">
                    <div class="room-item-title">${room.name}</div>
                    <div class="room-item-info">Код: ${room.invite_link}</div>
                </li>
            `).join('');

            elements.roomsList.querySelectorAll('.room-item').forEach(item => {
                item.onclick = () => {
                    const roomId = item.getAttribute('data-id');
                    window.currentRoomInvite = item.getAttribute('data-invite');
                    
                    // Визуально выделяем активную комнату
                    elements.roomsList.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                    
                    joinRoom(roomId);
                };
            });
        }
    } catch (err) { console.error("Ошибка загрузки комнат", err); }
}

async function joinRoom(roomId) {
    await fetch(`${API_URL}/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    currentRoom = roomId;

    console.log(`Присоединение к комнате: ${roomId}`);
    currentRoom = roomId;
    
    if (elements.messagesList) elements.messagesList.innerHTML = '';

    getEl('noChatSelected')?.classList.add('hidden');
    getEl('chatContainer')?.classList.remove('hidden');
    
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

    const token = getToken();
    // ПРАВИЛЬНО: Подключаем сокет только здесь, передавая roomId
    if (token && roomId) {
        connectSocket(token, roomId);
    }
}

function connectSocket(token, roomId) { 
    if (socket) socket.close();

    const userId = localStorage.getItem('radiance_user_id'); // Берем ID пользователя
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    

    const wsUrl = `${protocol}//${window.location.host}/api/signaling?token=${token}&room=${roomId}&user_id=${userId}`;
    
    console.log("Попытка подключения к:", wsUrl);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log("WebSocket успешно подключен к комнате:", roomId);
    };

    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
            case 'offer': 
                await handleOffer(msg); 
                break;
            case 'answer': 
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data));
                }
                break;
            case 'candidate': 
                if (peerConnection && msg.data) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data)); 
                }
               break;
        }
    };

    socket.onerror = (error) => {
        console.error("Ошибка WebSocket:", error);
        showNotification('Ошибка связи с сервером', 'error');
    };
}

async function createRoom() {
    const name = elements.roomNameInput?.value.trim();
    if (!name) return;

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
            elements.roomNameInput.value = '';
            await loadRooms();
            
            // Автоматическое копирование в буфер обмена
            if (data.invite_link) {
                await navigator.clipboard.writeText(data.invite_link);
                showNotification(`Комната создана! Код ${data.invite_link} скопирован.`);
            }
        }
    } catch (error) {
        showNotification('Ошибка сети', 'error');
    }
}

function logout() {
    localStorage.clear();
    location.reload();
}

// --- ИНИЦИАЛИЗАЦИЯ И СОБЫТИЯ ---

// Переключение между Входом и Регистрацией
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

if (elements.loginBtn) elements.loginBtn.onclick = login;
if (elements.createRoomBtn) elements.createRoomBtn.onclick = createRoom;
if (elements.logoutBtn) elements.logoutBtn.onclick = logout;

async function toggleMic() {
    try {
        if (!localStream) {
            // Запрашиваем доступ к микрофону, если еще нет потока
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isMicOn = true;
            showNotification('Микрофон включен');
        } else {
            // Переключаем активность аудио-дорожки
            isMicOn = !isMicOn;
            localStream.getAudioTracks().forEach(track => track.enabled = isMicOn);
            showNotification(isMicOn ? 'Микрофон включен' : 'Микрофон выключен');
        }

        // Визуальное обновление кнопки
        elements.toggleMicBtn?.classList.toggle('active', isMicOn);
    } catch (err) {
        console.error("Ошибка доступа к микрофону:", err);
        showNotification('Нет доступа к микрофону', 'error');
    }
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

getEl('copyInviteBtn')?.addEventListener('click', copyCurrentInvite);

function leaveRoom() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    currentRoom = null;
    isMicOn = false;
    
    getEl('chatContainer')?.classList.add('hidden');
    getEl('noChatSelected')?.classList.remove('hidden');
    
    elements.roomsList.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    
    showNotification('Вы вышли из комнаты');
}

async function joinByCode() {
    const code = prompt("Введите код приглашения:");
    if (!code) return;

    try {
        const response = await fetch(`${API_URL}/invites/${code}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        if (response.ok) {
            const data = await response.json(); // Предполагаем, что бэкенд вернет {room_id: "..."}
            showNotification('Вы успешно вошли в комнату!');
            
            await loadRooms();
            
            if (data.room_id) {
                joinRoom(data.room_id); 
            }
        } else {
            showNotification('Неверный код или комната полна', 'error');
        }
    } catch (err) {
        showNotification('Ошибка сервера', 'error');
    }
}

if (elements.toggleMicBtn) elements.toggleMicBtn.onclick = toggleMic;
if (elements.leaveRoomBtn) elements.leaveRoomBtn.onclick = leaveRoom;
if (elements.callBtn) {
    elements.callBtn.onclick = startCall;
}

async function sendMessage() {
    const text = elements.messageInput?.value.trim();
    if (!text || !currentRoom) return;

    try {
        const response = await fetch(`${API_URL}/rooms/${currentRoom}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            // ИЗМЕНЕНО: Пробуем отправить 'content', так как многие API используют это имя поля
            body: JSON.stringify({ content: text, text: text }) 
        });

        if (response.ok) {
            const newMessage = await response.json();
            elements.messageInput.value = '';
            
            // Добавляем сообщение на экран сразу
            appendMessage({
                user_id: localStorage.getItem(userIdKey),
                content: text,
                created_at: new Date().toISOString()
            });
        } else {
            const errorData = await response.json();
            console.error("Ошибка сервера:", errorData);
            showNotification('Ошибка отправки: ' + (errorData.error || response.status), 'error');
        }
    } catch (err) {
        console.error("Ошибка сети:", err);
    }
}

// Вспомогательная функция для отрисовки сообщения в списке
function appendMessage(msg) {
    if (!elements.messagesList) return;
    
    const isMe = msg.user_id == localStorage.getItem(userIdKey);
    const msgHtml = `
        <div class="message ${isMe ? 'own' : ''}">
            <div class="message-content">${msg.content || msg.text}</div>
            <div class="message-time">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
        </div>
    `;
    elements.messagesList.insertAdjacentHTML('beforeend', msgHtml);
    
    // Прокрутка вниз
    elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
}

// Привязка к кнопке
if (elements.sendMessageBtn) elements.sendMessageBtn.onclick = sendMessage;

// Отправка по Enter
elements.messageInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function startCall() {
    if (!currentRoom) return showNotification('Сначала войдите в комнату', 'error');

    peerConnection = new RTCPeerConnection(rtcConfig);
    
    if (!localStream) {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    if (!socket || socket.readyState !== WebSocket.OPEN) {
    	return showNotification('Ошибка связи с сервером. Попробуйте обновить страницу.', 'error');
    }
    // Слушаем собеседника
    peerConnection.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };

    // Отправка ICE-кандидатов
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'candidate',
                room_id: currentRoom,
                candidate: event.candidate
            }));
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.send(JSON.stringify({
        type: 'offer',
        room_id: currentRoom,
        data: offer
    }));
}

async function handleOffer(message) {
    if (!message.data) return;

    peerConnection = new RTCPeerConnection(rtcConfig);

    // 1. Добавляем свой микрофон в соединение
    if (!localStream) {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // 2. Настраиваем обработчики (такие же, как в startCall)
    peerConnection.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'candidate',
                room_id: currentRoom,
                data: event.candidate // Используем поле 'data'
            }));
        }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.send(JSON.stringify({
        type: 'answer',
        room_id: currentRoom,
        data: answer 
    }));
}

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
            showScreen('app');
            await loadRooms();
            // УДАЛЕНО: connectSocket(token); - Ждем, пока пользователь выберет комнату
        } else {
            logout();
        }
    } catch (e) {
        showScreen('auth');
    }
}

window.onload = init;