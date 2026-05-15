import { elements, 
	 showNotification,
	 showAuthError,
	 appendMessage,
	 getEl,
	 showScreen } from './ui.js';

export const API_URL = location.origin + '/api';
export const tokenKey = 'radiance_token';
export const userIdKey = 'radiance_user_id';

export const getToken = () => localStorage.getItem(tokenKey);
export const setToken = (token) => localStorage.setItem(tokenKey, token);
export const setUserId = (id) => localStorage.setItem(userIdKey, id);
export let rooms = [];

let currentUser = null;
export const getCurrentUser = () => currentUser;

export async function login() {
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
      await loadRooms();
    } else {
      showAuthError(data.error || 'Ошибка входа');
    }
  } catch (err) {
    showAuthError('Сервер недоступен');
  }
}

export async function register() {
  const email = elements.regEmail?.value;
  const password = elements.regPassword?.value;

  if (!email || !password) {
    return showAuthError('Введите email и пароль');
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

export async function loadRooms() {
  try {
    const response = await fetch(`${API_URL}/rooms`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (!response.ok) return;
    rooms = await response.json();

    if (elements.roomsList) {
      if (rooms.length === 0) {
        elements.roomsList.innerHTML = '<li class="empty-list">У вас пока нет активных комнат</li>';
        return;
      }
      // Добавляем data-is-host для каждой комнаты
      elements.roomsList.innerHTML = rooms.map(room => `
        <li class="room-item" data-id="${room.id}" data-invite="${room.invite_link || ''}" data-is-host="${room.is_host || false}">
          <div class="room-item-title">${room.name}</div>
          <div class="room-item-info">Код: ${room.invite_link}</div>
        </li>`).join('');

      elements.roomsList.querySelectorAll('.room-item').forEach(item => {
        item.onclick = () => {
          const roomId = item.getAttribute('data-id');
          const invite = item.getAttribute('data-invite');
          const isHost = item.getAttribute('data-is-host') === 'true';
          if (typeof window.__onRoomSelected === 'function') {
            window.__onRoomSelected(roomId, invite, isHost);
          }
        };
      });
    }
  } catch (err) { console.error(err); }
}

export async function joinRoom(roomId) {
  await fetch(`${API_URL}/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  return roomId;
}

export async function fetchMessages(roomId) {
  const res = await fetch(`${API_URL}/rooms/${roomId}/messages`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  if (res.ok) {
    const messages = await res.json();
    if (Array.isArray(messages)) return messages;
  }
  return [];
}

export async function createRoom() {
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

      if (data.invite_link) {
        await navigator.clipboard.writeText(data.invite_link);
        showNotification(`Комната создана! Код ${data.invite_link} скопирован.`);
      }
    }
  } catch (error) {
    showNotification('Ошибка сети', 'error');
  }
}

export async function joinByCode() {
  const code = prompt('Введите код приглашения:');
  if (!code) return;

  try {
    const response = await fetch(`${API_URL}/invites/${code}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });

    if (response.ok) {
      const data = await response.json();
      showNotification('Вы успешно вошли в комнату!');
      await loadRooms(); // обновляем список комнат

      // Находим комнату в обновлённом списке, чтобы узнать is_host
      const joinedRoom = rooms.find(r => r.id === data.room_id);
      const isHost = joinedRoom ? joinedRoom.is_host : false;
      if (typeof window.__onRoomSelected === 'function') {
        window.__onRoomSelected(data.room_id, data.invite_link || code, isHost);
      }
    } else {
      showNotification('Неверный код или комната полна', 'error');
    }
  } catch (err) {
    showNotification('Ошибка сервера', 'error');
  }
}

export async function sendMessage(currentRoom) {
  const text = elements.messageInput?.value.trim();
  if (!text || !currentRoom) return;

  try {
    const response = await fetch(`${API_URL}/rooms/${currentRoom}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
      },
      body: JSON.stringify({ content: text, text: text })
    });

    if (response.ok) {
      elements.messageInput.value = '';

      appendMessage({
        user_id: localStorage.getItem(userIdKey),
        content: text,
        created_at: new Date().toISOString()
      });
    } else {
      const errorData = await response.json();
      console.error('Ошибка сервера:', errorData);
      showNotification(
        'Ошибка отправки: ' + (errorData.error || response.status),
        'error'
      );
    }
  } catch (err) {
    console.error('Ошибка сети:', err);
  }
}

export function setCurrentUser(user) {
    currentUser = user;
    if (user && user.id) {
        setUserId(user.id);
    }
}

// getRoom больше не используется для определения прав хоста, но может понадобиться для других целей
export async function getRoom(roomId) {
    try {
        const response = await fetch(`${API_URL}/rooms/${roomId}`, {
            headers: {
                'Authorization': `Bearer ${getToken()}`
            }
        });
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (err) {
        console.error("Ошибка при получении данных комнаты:", err);
        return null;
    }
}