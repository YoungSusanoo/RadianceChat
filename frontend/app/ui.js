import { userIdKey } from './api.js';

export const micBtn = () => document.getElementById('toggleMicBtn') || document.getElementById('toggleAudioBtn');
export const videoBtn = () => document.getElementById('toggleVideoBtn');
export const getEl = (id) => document.getElementById(id);

// Временный объект, будет заполнен после загрузки DOM
export const elements = {};

export function refreshElements() {
    elements.authScreen = getEl('authScreen');
    elements.appScreen = getEl('appScreen');
    elements.loginForm = getEl('loginForm');
    elements.registerForm = getEl('registerForm');
    elements.loginEmail = getEl('loginEmail');
    elements.loginPassword = getEl('loginPassword');
    elements.regEmail = getEl('regEmail');
    elements.regPassword = getEl('regPassword');
    elements.loginBtn = getEl('loginBtn');
    elements.registerBtn = getEl('registerBtn');
    elements.roomNameInput = getEl('roomNameInput');
    elements.createRoomBtn = getEl('createRoomBtn');
    elements.roomsList = getEl('roomsList');
    elements.messagesList = getEl('messagesList');
    elements.messageInput = getEl('messageInput');
    elements.sendMessageBtn = getEl('sendMessageBtn');
    elements.logoutBtn = getEl('logoutBtn');
    elements.authError = getEl('authError');
    elements.notification = getEl('notifications');
    elements.toggleMicBtn = getEl('toggleAudioBtn');
    elements.callBtn = getEl('callBtn');
    elements.leaveRoomBtn = getEl('leaveRoomBtn');
}

export function showScreen(screenName) {
    if (!elements.authScreen || !elements.appScreen) return;
    if (screenName === 'app') {
        elements.authScreen.classList.remove('active');
        elements.appScreen.classList.add('active');
    } else {
        elements.appScreen.classList.remove('active');
        elements.authScreen.classList.add('active');
    }
}

export function showNotification(message, type = 'success') {
    if (!elements.notification) return;
    const note = document.createElement('div');
    note.className = `notification ${type}`;
    note.textContent = message;
    elements.notification.appendChild(note);
    setTimeout(() => note.remove(), 3000);
}

export function updateHostControls(isHost) {
    const controls = ['endCallForAllBtn', 'copyInviteBtn', 'participantActions'];
    controls.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            isHost ? el.classList.remove('hidden') : el.classList.add('hidden');
        } else {
            console.warn(`Element with id "${id}" not found`);
        }
    });
}

export function showAuthError(message) {
    if (!elements.authError) return;
    elements.authError.textContent = message;
    elements.authError.classList.remove('hidden');
    setTimeout(() => elements.authError?.classList.add('hidden'), 5000);
}

export function updateParticipantList(activeParticipants, hostId) {
    const list = document.getElementById('participant-list');
    const count = document.getElementById('participant-count');
    if (!list || !count) return;

    list.innerHTML = '<li id="list-local">Вы</li>';
    activeParticipants.forEach((username, userId) => {
        const li = document.createElement('li');
        li.id = `list-user-${userId}`;
        li.innerText = username;
        if (userId === hostId) {
            li.innerHTML += ' 👑';
        }
        list.appendChild(li);
    });
    count.innerText = activeParticipants.size + 1;
}

export function appendMessage(msg) {
    if (!elements.messagesList) return;

    const isMe = msg.user_id == localStorage.getItem(userIdKey);
    const msgHtml = `
        <div class="message ${isMe ? 'own' : ''}">
            <div class="message-content">${msg.content || msg.text}</div>
            <div class="message-time">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
        </div>
    `;
    elements.messagesList.insertAdjacentHTML('beforeend', msgHtml);
    elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
}