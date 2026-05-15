export function connectSocket(token, roomId, state, handlers) {
  if (state.socket) {
    state.socket.close();
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws/chat/${roomId}/?token=${token}&username=${encodeURIComponent(state.currentUser?.username || 'User')}`;
  state.socket = new WebSocket(url);

  state.socket.onopen = () => {
    console.log('WebSocket connected');
    handlers.onOpen?.();
  };

  state.socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handlers.onMessage?.(msg);
  };

  state.socket.onclose = () => {
    handlers.onClose?.();
    setTimeout(() => connectSocket(token, roomId, state, handlers), 3000);
  };
}