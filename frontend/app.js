const API_URL = '/api';

if (!window.location.protocol.startsWith('http')) {
    console.warn('Frontend должен запускаться через HTTP(S) сервер (например, nginx), иначе запросы к /api не будут работать.');
}

const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const responseBox = document.getElementById('server-response');

function showResponse(data, isError = false) {
    responseBox.classList.remove('hidden');
    responseBox.style.color = isError ? '#ef4444' : '#10b981';
    responseBox.textContent = JSON.stringify(data, null, 2);
}

async function sendRequest(endpoint) {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        showResponse({ error: 'Пожалуйста, введите логин и пароль' }, true);
        return;
    }

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json().catch(() => ({ error: 'Некорректный ответ сервера' }));

        if (!response.ok) {
            throw new Error(data.error || `Ошибка сервера (${response.status})`);
        }

        showResponse(data);
    } catch (error) {
        showResponse({ error: error.message }, true);
    }
}

registerBtn.addEventListener('click', () => sendRequest('/auth/register'));
loginBtn.addEventListener('click', () => sendRequest('/auth/login'));
