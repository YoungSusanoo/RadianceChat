import { userIdKey } from './api.js';

export const micBtn = document.getElementById('toggleMicBtn') || document.getElementById('toggleAudioBtn');
export const videoBtn = document.getElementById('toggleVideoBtn');
export const getEl = (id) => document.getElementById(id);

export const elements = {
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
    toggleMicBtn: getEl('toggleAudioBtn'),
    callBtn: getEl('callBtn'),
    leaveRoomBtn: getEl('leaveRoomBtn')
};

export function showScreen(screenName) {
    if (screenName === 'app') {
        elements.authScreen?.classList.remove('active');
        elements.appScreen?.classList.add('active');
    } else {
        elements.appScreen?.classList.remove('active');
        elements.authScreen?.classList.add('active');
    }
}

export function showNotification(message, type = 'success') {
    if (elements.notification) {
        const note = document.createElement('div');
        note.className = `notification ${type}`;
        note.textContent = message;
        elements.notification.appendChild(note);
        setTimeout(() => note.remove(), 3000);
    }
}

export function showAuthError(message) {
    if (elements.authError) {
        elements.authError.textContent = message;
        elements.authError.classList.remove('hidden');
        setTimeout(() => elements.authError?.classList.add('hidden'), 5000);
    }
}

export function updateParticipantList(activeParticipants) {
    const list = document.getElementById('participant-list');
    const count = document.getElementById('participant-count');
    if (!list || !count) return;

    list.innerHTML = '<li id="list-local">Вы</li>';

    activeParticipants.forEach((username, userId) => {
        const li = document.createElement('li');
        li.id = `list-user-${userId}`;
        li.innerText = username;
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