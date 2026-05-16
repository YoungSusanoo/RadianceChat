const dom = {};

const state = {
  token: localStorage.getItem("radiance.token") || "",
  user: null,
  rooms: [],
  room: null,
  participants: [],
  messages: [],
  events: null,
  authMode: "login",
  visibility: "public",
  pendingInvite: new URLSearchParams(location.search).get("invite") || "",
  media: {
    localStream: null,
    livekitRoom: null,
    livekitLoading: null,
    remoteTiles: new Map(),
    micOn: false,
    cameraOn: false,
  },
};

const ids = [
  "authCard", "profileCard", "loginTab", "registerTab", "nameField", "nameInput", "emailInput",
  "passwordInput", "authButton", "profileName", "profileEmail", "logoutButton", "roomNameInput",
  "roomDescriptionInput", "publicRoomButton", "privateRoomButton", "createRoomButton",
  "refreshRoomsButton", "roomsList", "roomTitle", "roomMeta", "copyInviteButton", "leaveRoomButton",
  "endRoomButton", "localVideo", "localState", "remoteTiles", "micButton", "cameraButton",
  "joinMediaButton", "participantCount", "participantsList", "messagesList", "messageForm",
  "messageInput", "toast",
];

const initDom = () => {
  for (const id of ids) dom[id] = document.getElementById(id);
};

const api = async (path, options = {}) => {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("Сервер недоступен. Проверьте, что приложение запущено.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
};

const normalizeList = (value) => Array.isArray(value) ? value : [];

const showToast = (message) => {
  dom.toast.textContent = message;
  dom.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => dom.toast.classList.add("hidden"), 3200);
};

const setBusy = (button, busy) => {
  button.disabled = busy;
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[char]));

const formatTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

const setAuthMode = (mode) => {
  state.authMode = mode;
  dom.loginTab.classList.toggle("active", mode === "login");
  dom.registerTab.classList.toggle("active", mode === "register");
  dom.nameField.classList.toggle("hidden", mode === "login");
  dom.authButton.textContent = mode === "login" ? "Войти" : "Создать аккаунт";
};

const setVisibility = (visibility) => {
  state.visibility = visibility;
  dom.publicRoomButton.classList.toggle("active", visibility === "public");
  dom.privateRoomButton.classList.toggle("active", visibility === "private");
};

const render = () => {
  renderAuth();
  renderRooms();
  renderRoomHeader();
  renderParticipants();
  renderMessages();
  renderMediaControls();
};

const renderAuth = () => {
  const loggedIn = Boolean(state.user);
  dom.authCard.classList.toggle("hidden", loggedIn);
  dom.profileCard.classList.toggle("hidden", !loggedIn);
  dom.profileName.textContent = state.user?.name || "-";
  dom.profileEmail.textContent = state.user?.email || "-";
  dom.createRoomButton.disabled = !loggedIn;
  dom.refreshRoomsButton.disabled = !loggedIn;
};

const renderRooms = () => {
  const rooms = normalizeList(state.rooms);
  dom.roomsList.innerHTML = "";
  if (!state.user) {
    dom.roomsList.innerHTML = `<div class="empty">Войдите, чтобы увидеть комнаты</div>`;
    return;
  }
  if (rooms.length === 0) {
    dom.roomsList.innerHTML = `<div class="empty">Публичных комнат пока нет</div>`;
    return;
  }
  for (const room of rooms) {
    const card = document.createElement("article");
    card.className = `room-card${state.room?.id === room.id ? " active" : ""}`;
    card.innerHTML = `
      <strong>${escapeHtml(room.name)}</strong>
      <div class="room-meta">
        <span>${Number(room.participants || 0)} участников</span>
        <span>${room.visibility === "private" ? "private" : "public"}</span>
      </div>
      <button class="button quiet" type="button">Войти</button>
    `;
    card.querySelector("button").addEventListener("click", () => runAction(() => joinRoom(room.id)));
    dom.roomsList.append(card);
  }
};

const renderRoomHeader = () => {
  const room = state.room;
  const me = currentParticipant();
  dom.roomTitle.textContent = room?.name || "Комната не выбрана";
  dom.roomMeta.textContent = room
    ? `${room.visibility === "private" ? "Приватная" : "Публичная"} комната · ${state.participants.length} участников`
    : "Создайте комнату или войдите в существующую.";
  dom.copyInviteButton.classList.toggle("hidden", !room);
  dom.leaveRoomButton.classList.toggle("hidden", !room);
  dom.endRoomButton.classList.toggle("hidden", !room || me?.role !== "host");
  dom.messageInput.disabled = !room;
  dom.messageForm.querySelector("button").disabled = !room;
};

const renderParticipants = () => {
  const participants = normalizeList(state.participants);
  dom.participantCount.textContent = String(participants.length);
  dom.participantsList.innerHTML = "";
  if (!state.room) {
    dom.participantsList.innerHTML = `<div class="empty">Нет активной комнаты</div>`;
    renderRemotePlaceholders();
    return;
  }
  if (participants.length === 0) {
    dom.participantsList.innerHTML = `<div class="empty">Участников пока нет</div>`;
    renderRemotePlaceholders();
    return;
  }
  const me = currentParticipant();
  for (const participant of participants) {
    const row = document.createElement("div");
    row.className = "participant-row";
    row.innerHTML = `
      <div class="participant-main">
        <strong>${escapeHtml(participant.name)}</strong>
        <span>${participant.role}${participant.connected ? "" : " · offline"}${participant.muted ? " · mic off" : ""}${participant.cameraOn ? " · cam on" : ""}</span>
      </div>
    `;
    if (me?.role === "host" && participant.userId !== state.user?.id) {
      const mute = document.createElement("button");
      mute.className = "button quiet";
      mute.type = "button";
      mute.textContent = "Mute";
      mute.addEventListener("click", () => runAction(() => moderate(participant.userId, "mute")));
      const kick = document.createElement("button");
      kick.className = "button danger";
      kick.type = "button";
      kick.textContent = "Kick";
      kick.addEventListener("click", () => runAction(() => moderate(participant.userId, "kick")));
      row.append(mute, kick);
    } else {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = participant.userId === state.user?.id ? "you" : participant.role;
      row.append(badge);
    }
    dom.participantsList.append(row);
  }
  renderRemotePlaceholders();
};

const renderRemotePlaceholders = () => {
  const remoteVideos = state.media.remoteTiles;
  dom.remoteTiles.innerHTML = "";
  const visibleIds = new Set();
  for (const participant of normalizeList(state.participants)) {
    if (participant.userId === state.user?.id) continue;
    visibleIds.add(participant.userId);
    const videoTile = remoteVideos.get(participant.userId);
    if (videoTile) {
      dom.remoteTiles.append(videoTile);
      continue;
    }
    const placeholder = document.createElement("article");
    placeholder.className = "placeholder-tile";
    placeholder.innerHTML = `<span>${escapeHtml(participant.name)}${participant.muted ? " · mic off" : ""}</span>`;
    dom.remoteTiles.append(placeholder);
  }
  for (const [identity, tile] of remoteVideos.entries()) {
    if (!visibleIds.has(identity)) {
      tile.remove();
      remoteVideos.delete(identity);
    }
  }
};

const renderMessages = () => {
  const messages = normalizeList(state.messages);
  dom.messagesList.innerHTML = "";
  if (!state.room) {
    dom.messagesList.innerHTML = `<div class="empty">Чат появится после входа в комнату</div>`;
    return;
  }
  if (messages.length === 0) {
    dom.messagesList.innerHTML = `<div class="empty">Сообщений пока нет</div>`;
    return;
  }
  for (const message of messages) {
    const node = document.createElement("article");
    node.className = `message${message.userId === state.user?.id ? " mine" : ""}`;
    node.innerHTML = `
      <strong>${escapeHtml(message.userName)}</strong>
      <div>${escapeHtml(message.text)}</div>
      <time>${formatTime(message.createdAt)}</time>
    `;
    dom.messagesList.append(node);
  }
  dom.messagesList.scrollTop = dom.messagesList.scrollHeight;
};

const renderMediaControls = () => {
  const micOn = state.media.micOn;
  const cameraOn = state.media.cameraOn;
  dom.micButton.textContent = micOn ? "Mic on" : "Mic off";
  dom.cameraButton.textContent = cameraOn ? "Cam on" : "Cam off";
  dom.localState.textContent = `${micOn ? "mic on" : "mic off"} · ${cameraOn ? "camera on" : "camera off"}`;
  dom.joinMediaButton.textContent = state.media.livekitRoom ? "LiveKit подключен" : "Подключить звонок";
  dom.joinMediaButton.disabled = !state.room;
  dom.micButton.disabled = !state.room;
  dom.cameraButton.disabled = !state.room;
};

const currentParticipant = () => state.participants.find((item) => item.userId === state.user?.id);

const runAction = async (action, button = null) => {
  try {
    if (button) setBusy(button, true);
    await action();
  } catch (err) {
    showToast(err.message || "Не удалось выполнить действие");
  } finally {
    if (button) setBusy(button, false);
  }
};

const bootstrap = async () => {
  initDom();
  bindEvents();
  setAuthMode("login");
  setVisibility("public");
  render();
  if (state.pendingInvite && !state.token) {
    showToast("Войдите или зарегистрируйтесь, чтобы открыть приглашение");
  }
  await runAction(async () => {
    await loadMe();
    await loadRooms();
    await checkInvite();
  });
};

const loadMe = async () => {
  if (!state.token) {
    state.user = null;
    render();
    return;
  }
  try {
    state.user = await api("/api/v1/auth/me");
  } catch {
    state.token = "";
    state.user = null;
    localStorage.removeItem("radiance.token");
  }
  render();
};

const loadRooms = async () => {
  if (!state.user) {
    state.rooms = [];
    render();
    return;
  }
  state.rooms = normalizeList(await api("/api/v1/rooms"));
  renderRooms();
};

const authenticate = async () => {
  const payload = await api(state.authMode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: dom.nameInput.value.trim(),
      email: dom.emailInput.value.trim(),
      password: dom.passwordInput.value,
    }),
  });
  state.token = payload.token || "";
  state.user = payload.user || null;
  localStorage.setItem("radiance.token", state.token);
  await loadRooms();
  await checkInvite();
  render();
};

const logout = async () => {
  await api("/api/v1/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
  closeEventStream();
  await disconnectMedia();
  state.token = "";
  state.user = null;
  state.rooms = [];
  state.room = null;
  state.participants = [];
  state.messages = [];
  localStorage.removeItem("radiance.token");
  render();
};

const createRoom = async () => {
  const payload = await api("/api/v1/rooms", {
    method: "POST",
    body: JSON.stringify({
      name: dom.roomNameInput.value.trim() || "Новая комната",
      description: dom.roomDescriptionInput.value.trim(),
      visibility: state.visibility,
    }),
  });
  await enterRoom(payload);
  dom.roomNameInput.value = "";
  dom.roomDescriptionInput.value = "";
  await loadRooms();
};

const joinRoom = async (roomId) => {
  const payload = await api(`/api/v1/rooms/${roomId}/join`, { method: "POST", body: "{}" });
  await enterRoom(payload);
};

const enterRoom = async (payload) => {
  const room = payload?.room;
  if (!room?.id) throw new Error("Сервер не вернул комнату");
  state.room = room;
  state.participants = normalizeList(payload.participants);
  state.messages = normalizeList(await api(`/api/v1/rooms/${room.id}/messages`));
  openEventStream(room.id);
  render();
};

const refreshActiveRoom = async () => {
  if (!state.room) return;
  const payload = await api(`/api/v1/rooms/${state.room.id}`);
  state.room = payload.room || state.room;
  state.participants = normalizeList(payload.participants);
  renderRoomHeader();
  renderParticipants();
};

const leaveRoom = async () => {
  if (!state.room) return;
  const roomId = state.room.id;
  await disconnectMedia();
  closeEventStream();
  await api(`/api/v1/rooms/${roomId}/leave`, { method: "POST", body: "{}" });
  state.room = null;
  state.participants = [];
  state.messages = [];
  await loadRooms();
  render();
};

const endRoom = async () => {
  if (!state.room) return;
  const roomId = state.room.id;
  await disconnectMedia();
  closeEventStream();
  await api(`/api/v1/rooms/${roomId}/end`, { method: "POST", body: "{}" });
  state.room = null;
  state.participants = [];
  state.messages = [];
  showToast("Комната завершена");
  await loadRooms();
  render();
};

const moderate = async (userId, action) => {
  const method = action === "kick" ? "DELETE" : "POST";
  await api(`/api/v1/rooms/${state.room.id}/participants/${userId}`, { method, body: "{}" });
  await refreshActiveRoom();
};

const sendMessage = async () => {
  const text = dom.messageInput.value.trim();
  if (!state.room || !text) return;
  dom.messageInput.value = "";
  const message = await api(`/api/v1/rooms/${state.room.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  if (!state.messages.some((item) => item.id === message.id)) {
    state.messages.push(message);
    renderMessages();
  }
};

const checkInvite = async () => {
  if (!state.pendingInvite || !state.user) return;
  const payload = await api(`/api/v1/invites/${state.pendingInvite}/join`, { method: "POST", body: "{}" });
  state.pendingInvite = "";
  await enterRoom(payload);
};

const copyInvite = async () => {
  if (!state.room) return;
  const url = `${location.origin}/?invite=${state.room.inviteToken}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast("Ссылка скопирована");
  } catch {
    showToast(url);
  }
};

const openEventStream = (roomId) => {
  closeEventStream();
  state.events = new EventSource(`/api/v1/rooms/${roomId}/events?access_token=${encodeURIComponent(state.token)}`);
  const reload = () => refreshActiveRoom().catch((err) => console.warn("room refresh failed", err));
  for (const type of ["participant.joined", "participant.left", "participant.device_changed", "participant.muted", "participant.kicked"]) {
    state.events.addEventListener(type, reload);
  }
  state.events.addEventListener("chat.message", (event) => {
    const payload = JSON.parse(event.data);
    const message = payload.data;
    if (message && !state.messages.some((item) => item.id === message.id)) {
      state.messages.push(message);
      renderMessages();
    }
  });
  state.events.addEventListener("room.ended", () => {
    showToast("Комната завершена хостом");
    disconnectMedia();
    closeEventStream();
    state.room = null;
    state.participants = [];
    state.messages = [];
    loadRooms().finally(render);
  });
  state.events.onerror = () => console.warn("Realtime stream interrupted; EventSource will retry.");
};

const closeEventStream = () => {
  if (state.events) {
    state.events.close();
    state.events = null;
  }
};

const startMedia = async () => {
  if (!state.room) {
    showToast("Сначала войдите в комнату");
    return;
  }
  try {
    await loadLiveKit();
    await connectLiveKit();
  } catch (err) {
    console.warn("LiveKit unavailable, using local preview", err);
    showToast("LiveKit недоступен, включен локальный preview");
    await startLocalPreview();
  }
};

const loadLiveKit = async () => {
  if (window.LivekitClient) return;
  if (state.media.livekitLoading) return state.media.livekitLoading;
  state.media.livekitLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js";
    script.async = true;
    script.onload = () => window.LivekitClient ? resolve() : reject(new Error("LiveKit SDK did not initialize"));
    script.onerror = () => reject(new Error("LiveKit SDK is unavailable"));
    document.head.append(script);
  }).finally(() => {
    state.media.livekitLoading = null;
  });
  return state.media.livekitLoading;
};

const connectLiveKit = async () => {
  if (state.media.livekitRoom) return;
  const media = await api(`/api/v1/rooms/${state.room.id}/media-token`, { method: "POST", body: "{}" });
  const LK = window.LivekitClient;
  const room = new LK.Room({ adaptiveStream: true, dynacast: true });

  room.on(LK.RoomEvent.TrackSubscribed, (track, publication, participant) => {
    const element = track.attach();
    element.autoplay = true;
    element.playsInline = true;
    if (track.kind === LK.Track.Kind.Audio) {
      element.dataset.remoteAudio = participant.identity;
      document.body.append(element);
      return;
    }
    attachRemoteVideo(participant.identity, participant.name || participant.identity, element);
  });
  room.on(LK.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    track.detach().forEach((element) => element.remove());
    detachRemoteVideo(participant.identity);
  });
  room.on(LK.RoomEvent.ParticipantDisconnected, (participant) => detachRemoteVideo(participant.identity));

  await room.connect(media.livekitUrl, media.token);
  state.media.livekitRoom = room;
  state.media.micOn = true;
  state.media.cameraOn = true;
  await room.localParticipant.setMicrophoneEnabled(true);
  await room.localParticipant.setCameraEnabled(true);
  attachLocalLiveKitVideo(room);
  await syncDeviceState();
};

const startLocalPreview = async () => {
  if (!state.media.localStream) {
    state.media.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    dom.localVideo.srcObject = state.media.localStream;
  }
  state.media.micOn = true;
  state.media.cameraOn = true;
  applyLocalTrackState();
  await syncDeviceState();
};

const attachLocalLiveKitVideo = (room) => {
  const publications = Array.from(room.localParticipant.videoTrackPublications.values());
  const publication = publications.find((item) => item.track);
  if (!publication?.track) return;
  const old = dom.localVideo;
  const next = publication.track.attach();
  next.id = "localVideo";
  next.muted = true;
  next.autoplay = true;
  next.playsInline = true;
  old.replaceWith(next);
  dom.localVideo = next;
};

const attachRemoteVideo = (identity, name, videoElement) => {
  detachRemoteVideo(identity);
  const tile = document.createElement("article");
  tile.className = "video-tile";
  tile.dataset.identity = identity;
  tile.append(videoElement);
  const caption = document.createElement("div");
  caption.className = "tile-caption";
  caption.innerHTML = `<strong>${escapeHtml(name)}</strong><span>LiveKit</span>`;
  tile.append(caption);
  state.media.remoteTiles.set(identity, tile);
  renderRemotePlaceholders();
};

const detachRemoteVideo = (identity) => {
  const tile = state.media.remoteTiles.get(identity);
  if (tile) tile.remove();
  state.media.remoteTiles.delete(identity);
};

const toggleMic = async () => {
  state.media.micOn = !state.media.micOn;
  await syncDeviceState();
};

const toggleCamera = async () => {
  state.media.cameraOn = !state.media.cameraOn;
  await syncDeviceState();
};

const syncDeviceState = async () => {
  applyLocalTrackState();
  if (state.media.livekitRoom) {
    await state.media.livekitRoom.localParticipant.setMicrophoneEnabled(state.media.micOn);
    await state.media.livekitRoom.localParticipant.setCameraEnabled(state.media.cameraOn);
  }
  renderMediaControls();
  if (state.room) {
    await api(`/api/v1/rooms/${state.room.id}/device`, {
      method: "PATCH",
      body: JSON.stringify({ muted: !state.media.micOn, cameraOn: state.media.cameraOn }),
    });
  }
};

const applyLocalTrackState = () => {
  if (!state.media.localStream) return;
  for (const track of state.media.localStream.getAudioTracks()) track.enabled = state.media.micOn;
  for (const track of state.media.localStream.getVideoTracks()) track.enabled = state.media.cameraOn;
};

const disconnectMedia = async () => {
  if (state.media.livekitRoom) {
    state.media.livekitRoom.disconnect();
    state.media.livekitRoom = null;
  }
  if (state.media.localStream) {
    state.media.localStream.getTracks().forEach((track) => track.stop());
    state.media.localStream = null;
    dom.localVideo.srcObject = null;
  }
  for (const tile of state.media.remoteTiles.values()) tile.remove();
  state.media.remoteTiles.clear();
  state.media.micOn = false;
  state.media.cameraOn = false;
  renderMediaControls();
  renderRemotePlaceholders();
};

const bindEvents = () => {
  dom.loginTab.addEventListener("click", () => setAuthMode("login"));
  dom.registerTab.addEventListener("click", () => setAuthMode("register"));
  dom.publicRoomButton.addEventListener("click", () => setVisibility("public"));
  dom.privateRoomButton.addEventListener("click", () => setVisibility("private"));
  dom.authButton.addEventListener("click", () => runAction(authenticate, dom.authButton));
  dom.logoutButton.addEventListener("click", () => runAction(logout, dom.logoutButton));
  dom.createRoomButton.addEventListener("click", () => runAction(createRoom, dom.createRoomButton));
  dom.refreshRoomsButton.addEventListener("click", () => runAction(loadRooms, dom.refreshRoomsButton));
  dom.copyInviteButton.addEventListener("click", () => runAction(copyInvite, dom.copyInviteButton));
  dom.leaveRoomButton.addEventListener("click", () => runAction(leaveRoom, dom.leaveRoomButton));
  dom.endRoomButton.addEventListener("click", () => runAction(endRoom, dom.endRoomButton));
  dom.joinMediaButton.addEventListener("click", () => runAction(startMedia, dom.joinMediaButton));
  dom.micButton.addEventListener("click", () => runAction(toggleMic, dom.micButton));
  dom.cameraButton.addEventListener("click", () => runAction(toggleCamera, dom.cameraButton));
  dom.messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runAction(sendMessage, dom.messageForm.querySelector("button"));
  });
};

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((err) => showToast(err.message || "Ошибка запуска интерфейса"));
});
