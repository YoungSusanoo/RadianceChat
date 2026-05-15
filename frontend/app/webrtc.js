import { getEl, showNotification } from './ui.js';

export const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export async function startCall(currentRoom, socket, localStream, peerConnection, setLocalStream, setPeerConnection) {
    if (!currentRoom || !socket) {
        return showNotification('Сначала войдите в комнату', 'error');
    }

    peerConnection = new RTCPeerConnection(rtcConfig);

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        const localVideo = getEl('local-video');
        if (localVideo) localVideo.srcObject = localStream;

        setLocalStream(localStream);
        setPeerConnection(peerConnection);

        peerConnection.ontrack = (event) => {
            addRemoteVideo(event.streams[0], 'remote-user', 'Собеседник');
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'candidate',
                    room_id: currentRoom,
                    data: event.candidate
                }));
            }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.send(JSON.stringify({ type: 'offer', room_id: currentRoom, data: offer }));
    } catch (err) {
        console.error('Ошибка при старте звонка:', err);
        showNotification('Не удалось получить доступ к медиа', 'error');
    }
}

export async function handleOffer(msg, currentRoom, socket, localStream, peerConnection,
                                  setPeerConnection, setLocalStream) {
    if (!peerConnection) {
        peerConnection = new RTCPeerConnection(rtcConfig);
        setPeerConnection(peerConnection);
    }

    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            setLocalStream(localStream);
            const localVideo = getEl('local-video');
            if (localVideo) localVideo.srcObject = localStream;
        } catch (e) {
            console.error('Не удалось получить медиа при входящем звонке', e);
            showNotification('Не удалось получить доступ к медиа', 'error');
            return;
        }
    }

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        addRemoteVideo(event.streams[0], msg.userId || 'remote', 'Участник');
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'candidate',
                room_id: currentRoom,
                data: event.candidate
            }));
        }
    };

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.send(JSON.stringify({
            type: 'answer',
            to: msg.from,
            room_id: currentRoom,
            data: answer
        }));
    } catch (e) {
        console.error('Ошибка обработки offer:', e);
    }
}

export function toggleMic(localStream, micBtn) {
    if (!localStream || !micBtn) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        micBtn.classList.toggle('active', !audioTrack.enabled);
        micBtn.textContent = audioTrack.enabled ? '🎙️' : '🔇';
    }
}

export function toggleVideo(localStream, videoBtn) {
    if (!localStream || !videoBtn) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        videoBtn.classList.toggle('active', !videoTrack.enabled);
        videoBtn.textContent = videoTrack.enabled ? '📹' : '📷'; // или другие эмодзи
    }
}

export function addRemoteVideo(stream, userId, username) {
    if (document.getElementById(`wrapper-${userId}`)) return;
    const grid = getEl('participantsGrid');
    if (!grid) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = `wrapper-${userId}`;
    wrapper.innerHTML = `
        <video id="video-${userId}" autoplay playsinline></video>
        <span class="user-label">${username}</span>
    `;
    grid.appendChild(wrapper);
    const video = document.getElementById(`video-${userId}`);
    if (video) video.srcObject = stream;
}

export function removeRemoteVideo(userId) {
    document.getElementById(`wrapper-${userId}`)?.remove();
}