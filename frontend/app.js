// Конфигурация
const API_URL = window.location.origin + '/api'; 
const tokenKey = 'radiance_token';
const userIdKey = 'radiance_user_id';

let currentRoom = null;
let currentUser = null;
let localStream = null;
let isMicOn = false;

const getToken = () => localStorage.getItem(tokenKey);
const setToken = (token) => localStorage.setItem(tokenKey, token);
const setUserId = (id) => localStorage.setItem(userIdKey, id);

const getEl = (id) => document.getElementById(id);

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
    notification: getEl('notifications'), // Проверьте запятую здесь!
    toggleMicBtn: getEl('toggleMicBtn'),   // И здесь
    callBtn: getEl('callBtn'),
    leaveRoomBtn: getEl('leaveRoomBtn')
};

// --- УПРАВЛЕНИЕ ИНТЕРФЕЙСОМ ---

// ИСПРАВЛЕНО: Теперь используем класс 'active' согласно вашему CSS
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
    } else {
        alert(message);
    }
}

function showAuthError(msg) {
    if (elements.authError) {
        elements.authError.textContent = msg;
        elements.authError.classList.remove('hidden');
    }
}

// --- АВТОРИЗАЦИЯ ---

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
            showScreen('app'); // Переключаем на приложение
            await loadRooms();
        } else {
            showAuthError(data.error || 'Ошибка входа');
        }
    } catch (err) {
        showAuthError('Сервер недоступен');
    }
}

// --- КОМНАТЫ ---

async function loadRooms() {
    try {
        const response = await fetch(`${API_URL}/rooms`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getToken()}` 
            }
        });
        
        if (!response.ok) {
            if (response.status === 401) logout();
            return;
        }

        const rooms = await response.json();
        
        if (elements.roomsList) {
            // Очищаем список перед рендером
            elements.roomsList.innerHTML = '';

            if (!rooms || rooms.length === 0) {
                elements.roomsList.innerHTML = '<li class="p-2 text-gray-500">Нет доступных комнат</li>';
                return;
            }

            // Рендерим комнаты согласно вашим стилям в style.css[cite: 28]
            elements.roomsList.innerHTML = rooms.map(room => `
                <li class="room-item" data-id="${room.id}">
                    <div class="room-item-title">${room.name}</div>
                    <div class="room-item-meta">Нажмите, чтобы войти</div>
                </li>
            `).join('');

            // Навешиваем обработчики клика
            elements.roomsList.querySelectorAll('.room-item').forEach(item => {
                item.onclick = () => joinRoom(item.getAttribute('data-id'));
            });
        }
    } catch (err) {
        console.error("Ошибка загрузки комнат", err);
    }
}

async function joinRoom(roomId) {
    console.log(`Присоединение к комнате: ${roomId}`);
    currentRoom = roomId;
    
    // Сбрасываем список сообщений перед загрузкой новых
    if (elements.messagesList) elements.messagesList.innerHTML = '';

    elements.roomsList.querySelectorAll('.room-item').forEach(el => {
        el.classList.remove('active');
        if (el.getAttribute('data-id') === roomId) el.classList.add('active');
    });

    getEl('noChatSelected')?.classList.add('hidden');
    getEl('chatContainer')?.classList.remove('hidden');
    
    // ЗАГРУЗКА ИСТОРИИ
    try {
        const response = await fetch(`${API_URL}/rooms/${roomId}/messages`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (response.ok) {
            const messages = await response.json();
            messages.forEach(msg => appendMessage(msg));
        }
    } catch (err) {
        console.error("Не удалось загрузить историю чата", err);
    }
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
            elements.roomNameInput.value = '';
            await loadRooms();
            showNotification('Комната создана');
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

if (elements.toggleMicBtn) elements.toggleMicBtn.onclick = toggleMic;
if (elements.leaveRoomBtn) elements.leaveRoomBtn.onclick = leaveRoom;
if (elements.callBtn) {
    elements.callBtn.onclick = () => {
        showNotification('Функция звонка в разработке (WebRTC)');
    };
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
        } else {
            logout();
        }
    } catch (e) {
        showScreen('auth');
    }
}

window.onload = init;