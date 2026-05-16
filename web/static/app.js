const state = {
  token: localStorage.getItem("radiance.token") || "",
  user: null,
  room: null,
  participants: [],
  messages: [],
  stream: null,
  events: null,
  authMode: "login",
  visibility: "public",
  muted: false,
  cameraOn: false,
};

const $ = (id) => document.getElementById(id);

const api = async (path, options = {}) => {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...options, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "request failed");
  return payload;
};

const toast = (message) => {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), 2600);
};

const setAuthMode = (mode) => {
  state.authMode = mode;
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
  $("nameInput").parentElement.classList.toggle("hidden", mode === "login");
  $("authButton").textContent = mode === "login" ? "Войти" : "Создать аккаунт";
};

const renderAuth = () => {
  const logged = Boolean(state.user);
  $("authPanel").classList.toggle("hidden", logged);
  $("profilePanel").classList.toggle("hidden", !logged);
  if (logged) {
    $("profileName").textContent = state.user.name;
    $("profileEmail").textContent = state.user.email;
  }
};

const renderRooms = (rooms = []) => {
  $("roomsList").innerHTML = rooms.length ? "" : `<p>Публичных комнат пока нет.</p>`;
  for (const room of rooms) {
    const item = document.createElement("article");
    item.className = "list-item";
    item.innerHTML = `
      <strong>${escapeHtml(room.name)}</strong>
      <span>${room.participants} участников</span>
      <button class="ghost" type="button">Войти</button>
    `;
    item.querySelector("button").addEventListener("click", () => joinRoom(room.id));
    $("roomsList").append(item);
  }
};

const renderRoom = () => {
  const room = state.room;
  $("roomTitle").textContent = room ? room.name : "Выберите или создайте комнату";
  $("roomMeta").textContent = room ? `${room.visibility === "private" ? "Приватная" : "Публичная"} комната` : "До 15 участников, чат и базовая модерация.";
  $("copyInviteButton").classList.toggle("hidden", !room);
  $("leaveRoomButton").classList.toggle("hidden", !room);
  const me = state.participants.find((p) => p.userId === state.user?.id);
  $("endRoomButton").classList.toggle("hidden", !room || me?.role !== "host");
  renderParticipants();
  renderMessages();
};

const renderParticipants = () => {
  $("participantsList").innerHTML = "";
  $("participantTiles").innerHTML = "";
  const me = state.participants.find((p) => p.userId === state.user?.id);
  for (const p of state.participants) {
    const row = document.createElement("div");
    row.className = "participant-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <span>${p.role}${p.connected ? "" : " · offline"}${p.muted ? " · muted" : ""}</span>
      </div>
    `;
    if (me?.role === "host" && p.userId !== state.user.id) {
      const mute = document.createElement("button");
      mute.className = "ghost";
      mute.textContent = "Mute";
      mute.addEventListener("click", () => moderate(p.userId, "mute"));
      const kick = document.createElement("button");
      kick.className = "danger";
      kick.textContent = "Kick";
      kick.addEventListener("click", () => moderate(p.userId, "kick"));
      row.append(mute, kick);
    }
    $("participantsList").append(row);

    if (p.userId !== state.user?.id) {
      const tile = document.createElement("article");
      tile.className = "participant-card";
      tile.textContent = `${p.name}${p.muted ? " · muted" : ""}`;
      $("participantTiles").append(tile);
    }
  }
};

const renderMessages = () => {
  $("messagesList").innerHTML = "";
  for (const msg of state.messages) {
    const node = document.createElement("div");
    node.className = "message";
    node.innerHTML = `<strong>${escapeHtml(msg.userName)}</strong>${escapeHtml(msg.text)}`;
    $("messagesList").append(node);
  }
  $("messagesList").scrollTop = $("messagesList").scrollHeight;
};

const loadMe = async () => {
  if (!state.token) return;
  try {
    state.user = await api("/api/v1/auth/me");
  } catch {
    state.token = "";
    localStorage.removeItem("radiance.token");
  }
  renderAuth();
};

const loadRooms = async () => {
  if (!state.user) return;
  renderRooms(await api("/api/v1/rooms"));
};

const auth = async () => {
  const body = {
    name: $("nameInput").value,
    email: $("emailInput").value,
    password: $("passwordInput").value,
  };
  const path = state.authMode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register";
  const payload = await api(path, { method: "POST", body: JSON.stringify(body) });
  state.token = payload.token;
  state.user = payload.user;
  localStorage.setItem("radiance.token", state.token);
  renderAuth();
  await loadRooms();
};

const createRoom = async () => {
  const payload = await api("/api/v1/rooms", {
    method: "POST",
    body: JSON.stringify({
      name: $("roomNameInput").value || "Новая комната",
      description: $("roomDescriptionInput").value,
      visibility: state.visibility,
    }),
  });
  await enterRoom(payload.room.id, payload);
  await loadRooms();
};

const joinRoom = async (roomId) => {
  const payload = await api(`/api/v1/rooms/${roomId}/join`, { method: "POST", body: "{}" });
  await enterRoom(roomId, payload);
};

const enterRoom = async (roomId, payload = null) => {
  if (!payload) payload = await api(`/api/v1/rooms/${roomId}`);
  state.room = payload.room;
  state.participants = payload.participants || [];
  state.messages = await api(`/api/v1/rooms/${roomId}/messages`);
  connectEvents(roomId);
  renderRoom();
};

const connectEvents = (roomId) => {
  if (state.events) state.events.close();
  state.events = new EventSource(`/api/v1/rooms/${roomId}/events?access_token=${encodeURIComponent(state.token)}`, { withCredentials: false });
  const reload = async () => {
    const payload = await api(`/api/v1/rooms/${roomId}`);
    state.room = payload.room;
    state.participants = payload.participants || [];
    renderRoom();
  };
  for (const typ of ["participant.joined", "participant.left", "participant.device_changed", "participant.muted", "participant.kicked"]) {
    state.events.addEventListener(typ, reload);
  }
  state.events.addEventListener("chat.message", (event) => {
    const payload = JSON.parse(event.data);
    state.messages.push(payload.data);
    renderMessages();
  });
  state.events.addEventListener("room.ended", () => {
    toast("Звонок завершен хостом");
    state.room.active = false;
    renderRoom();
  });
};

const leaveRoom = async () => {
  if (!state.room) return;
  await api(`/api/v1/rooms/${state.room.id}/leave`, { method: "POST", body: "{}" });
  if (state.events) state.events.close();
  state.room = null;
  state.participants = [];
  state.messages = [];
  renderRoom();
  await loadRooms();
};

const endRoom = async () => {
  if (!state.room) return;
  await api(`/api/v1/rooms/${state.room.id}/end`, { method: "POST", body: "{}" });
  toast("Комната завершена");
  await loadRooms();
};

const moderate = async (userId, action) => {
  const method = action === "kick" ? "DELETE" : "POST";
  await api(`/api/v1/rooms/${state.room.id}/participants/${userId}`, { method, body: "{}" });
};

const sendMessage = async (event) => {
  event.preventDefault();
  if (!state.room) return;
  const text = $("messageInput").value.trim();
  if (!text) return;
  $("messageInput").value = "";
  await api(`/api/v1/rooms/${state.room.id}/messages`, { method: "POST", body: JSON.stringify({ text }) });
};

const toggleMedia = async (type) => {
  if (type === "mic") state.muted = !state.muted;
  if (type === "camera") state.cameraOn = !state.cameraOn;
  await syncDevice();
};

const startMedia = async () => {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $("localVideo").srcObject = state.stream;
    state.cameraOn = true;
    state.muted = false;
    await syncDevice();
  } catch {
    toast("Браузер не дал доступ к камере или микрофону");
  }
};

const syncDevice = async () => {
  if (state.stream) {
    for (const track of state.stream.getAudioTracks()) track.enabled = !state.muted;
    for (const track of state.stream.getVideoTracks()) track.enabled = state.cameraOn;
  }
  $("micButton").textContent = state.muted ? "Mic off" : "Mic";
  $("cameraButton").textContent = state.cameraOn ? "Cam" : "Cam off";
  $("localState").textContent = `${state.muted ? "mic off" : "mic on"} · ${state.cameraOn ? "camera on" : "camera off"}`;
  if (state.room) {
    await api(`/api/v1/rooms/${state.room.id}/device`, {
      method: "PATCH",
      body: JSON.stringify({ muted: state.muted, cameraOn: state.cameraOn }),
    });
  }
};

const copyInvite = async () => {
  if (!state.room) return;
  const url = `${location.origin}/?invite=${state.room.inviteToken}`;
  await navigator.clipboard.writeText(url);
  toast("Ссылка скопирована");
};

const checkInvite = async () => {
  const invite = new URLSearchParams(location.search).get("invite");
  if (!invite || !state.user) return;
  const payload = await api(`/api/v1/invites/${invite}/join`, { method: "POST", body: "{}" });
  await enterRoom(payload.room.id, payload);
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[char]));

$("loginTab").addEventListener("click", () => setAuthMode("login"));
$("registerTab").addEventListener("click", () => setAuthMode("register"));
$("authButton").addEventListener("click", () => auth().catch((err) => toast(err.message)));
$("logoutButton").addEventListener("click", async () => {
  await api("/api/v1/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
  localStorage.removeItem("radiance.token");
  location.reload();
});
$("publicRoomButton").addEventListener("click", () => {
  state.visibility = "public";
  $("publicRoomButton").classList.add("active");
  $("privateRoomButton").classList.remove("active");
});
$("privateRoomButton").addEventListener("click", () => {
  state.visibility = "private";
  $("privateRoomButton").classList.add("active");
  $("publicRoomButton").classList.remove("active");
});
$("createRoomButton").addEventListener("click", () => createRoom().catch((err) => toast(err.message)));
$("refreshRoomsButton").addEventListener("click", () => loadRooms().catch((err) => toast(err.message)));
$("messageForm").addEventListener("submit", (event) => sendMessage(event).catch((err) => toast(err.message)));
$("leaveRoomButton").addEventListener("click", () => leaveRoom().catch((err) => toast(err.message)));
$("endRoomButton").addEventListener("click", () => endRoom().catch((err) => toast(err.message)));
$("copyInviteButton").addEventListener("click", () => copyInvite().catch((err) => toast(err.message)));
$("joinMediaButton").addEventListener("click", () => startMedia());
$("micButton").addEventListener("click", () => toggleMedia("mic").catch((err) => toast(err.message)));
$("cameraButton").addEventListener("click", () => toggleMedia("camera").catch((err) => toast(err.message)));

setAuthMode("login");
loadMe().then(loadRooms).then(checkInvite);
