const API_URL = '/api';

if (!window.location.protocol.startsWith('http')) {
    console.warn('Frontend должен запускаться через HTTP(S) сервер (например, nginx), иначе запросы к /api не будут работать.');
}

const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const responseBox = document.getElementById('server-response');

function showResponse(data, isError = false) {
    responseBox.classList.remove('hidden');
    responseBox.style.color = isError ? '#ef4444' : '#10b981';
    responseBox.textContent = JSON.stringify(data, null, 2);
}

async function parseResponse(response) {
    const text = await response.text();
    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch {
        return { error: text.trim() || 'Некорректный ответ сервера' };
    }
}

async function sendRequest(endpoint) {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        showResponse({ error: 'Пожалуйста, введите email и пароль' }, true);
        return;
    }

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await parseResponse(response);

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
