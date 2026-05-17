import { useEffect, useState } from "react";
import { AuthPanel } from "./components/AuthPanel";
import { ChatPanel } from "./components/ChatPanel";
import { MeetingStage } from "./components/MeetingStage";
import { ParticipantsPanel } from "./components/ParticipantsPanel";
import { RoomPanel } from "./components/RoomPanel";
import { api, eventSourceUrl, tokenStore } from "./lib/api";
import type { Message, Participant, PublicRoom, Room, RoomEvent, User } from "./lib/types";
import { useMediaController } from "./lib/useMediaController";

type AuthMode = "login" | "register";
type Visibility = "public" | "private";

export function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [user, setUser] = useState<User | null>(null);
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [pendingInvite, setPendingInvite] = useState(() => new URLSearchParams(location.search).get("invite") || "");
  const { controller, media } = useMediaController();

  const currentRoomId = room?.id || "";

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      refreshRooms().catch((error) => console.warn("rooms refresh failed", error));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  useEffect(() => {
    if (!currentRoomId || !tokenStore.get()) return;
    const eventSource = new EventSource(eventSourceUrl(currentRoomId));
    const sync = () => syncRoom(currentRoomId).catch((error) => console.warn("room sync failed", error));
    const syncRooms = () => refreshRooms().catch((error) => console.warn("rooms refresh failed", error));
    const parsePayload = <T,>(event: MessageEvent) => JSON.parse(event.data) as RoomEvent<T>;
    const upsertParticipant = (participant: Participant) => {
      setParticipants((items) => {
        const exists = items.some((item) => item.userId === participant.userId);
        if (!exists) return [...items, participant];
        return items.map((item) => item.userId === participant.userId ? participant : item);
      });
    };
    const removeParticipant = (participant: Participant) => {
      setParticipants((items) => items.filter((item) => item.userId !== participant.userId));
    };
    const onParticipantChanged = (event: MessageEvent) => {
      const payload = parsePayload<Participant>(event);
      if (payload.data?.userId) upsertParticipant(payload.data);
      sync();
      syncRooms();
    };
    const onParticipantLeft = (event: MessageEvent) => {
      const payload = parsePayload<Participant>(event);
      if (payload.data?.userId) removeParticipant(payload.data);
      sync();
      syncRooms();
    };
    const onMessage = (event: MessageEvent) => {
      const payload = parsePayload<Message>(event);
      if (!payload.data?.id) return;
      setMessages((items) => items.some((item) => item.id === payload.data.id) ? items : [...items, payload.data]);
    };
    const onMuted = (event: MessageEvent) => {
      const payload = parsePayload<Participant>(event);
      if (payload.data?.userId) upsertParticipant(payload.data);
      if (payload.data?.userId === user?.id) {
        controller.setMic(currentRoomId, false).catch((error) => console.warn("forced mute failed", error));
      }
      sync();
    };
    const onKicked = (event: MessageEvent) => {
      const payload = parsePayload<Participant>(event);
      if (payload.data?.userId === user?.id) {
        setToast("Хост удалил вас из комнаты");
        closeRoomState().catch((error) => console.warn("room close failed", error));
        refreshRooms().catch((error) => console.warn("rooms refresh failed", error));
        return;
      }
      if (payload.data?.userId) removeParticipant(payload.data);
      sync();
      syncRooms();
    };
    const onEnded = () => {
      setToast("Комната завершена");
      closeRoomState();
      syncRooms();
    };
    eventSource.addEventListener("participant.joined", onParticipantChanged);
    eventSource.addEventListener("participant.device_changed", onParticipantChanged);
    eventSource.addEventListener("participant.left", onParticipantLeft);
    eventSource.addEventListener("participant.muted", onMuted);
    eventSource.addEventListener("participant.kicked", onKicked);
    eventSource.addEventListener("chat.message", onMessage);
    eventSource.addEventListener("room.ended", onEnded);
    eventSource.onerror = () => console.warn("Realtime stream interrupted; browser will retry.");
    return () => eventSource.close();
  }, [controller, currentRoomId, user?.id]);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await action();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось выполнить действие");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function bootstrap() {
    await run(async () => {
      if (!tokenStore.get()) return;
      const me = await api.me();
      setUser(me);
      const loadedRooms = await api.rooms();
      setRooms(normalize(loadedRooms));
      if (pendingInvite) await joinInvite(pendingInvite);
    });
    if (pendingInvite && !tokenStore.get()) {
      setToast("Войдите или зарегистрируйтесь, чтобы открыть приглашение");
    }
  }

  async function refreshRooms() {
    const loadedRooms = await api.rooms();
    setRooms(normalize(loadedRooms));
  }

  async function refreshRoom() {
    if (!room) return;
    await syncRoom(room.id);
  }

  async function syncRoom(roomId: string) {
    const payload = await api.room(roomId);
    if (room?.id && room.id !== roomId) return;
    setRoom(payload.room);
    setParticipants(normalize(payload.participants));
  }

  async function authenticate(payload: { name: string; email: string; password: string }) {
    await run(async () => {
      const response = authMode === "login"
        ? await api.login({ email: payload.email, password: payload.password })
        : await api.register(payload);
      tokenStore.set(response.token);
      setUser(response.user);
      await refreshRooms();
      if (pendingInvite) await joinInvite(pendingInvite);
    });
  }

  async function logout() {
    await run(async () => {
      await api.logout().catch(() => {});
      tokenStore.clear();
      setUser(null);
      setRooms([]);
      await closeRoomState();
    });
  }

  async function createRoom(payload: { name: string; description: string; visibility: Visibility }) {
    await run(async () => {
      const response = await api.createRoom(payload);
      await enterRoom(response.room, response.participants);
      await refreshRooms();
    });
  }

  async function joinRoom(roomId: string) {
    await run(async () => {
      const response = await api.joinRoom(roomId);
      await enterRoom(response.room, response.participants);
    });
  }

  async function joinInvite(inviteToken: string) {
    const response = await api.joinInvite(inviteToken);
    setPendingInvite("");
    await enterRoom(response.room, response.participants);
  }

  async function enterRoom(nextRoom: Room, nextParticipants: Participant[]) {
    if (room?.id && room.id !== nextRoom.id) {
      await controller.disconnect(room.id);
    }
    setRoom(nextRoom);
    setParticipants(normalize(nextParticipants));
    const history = await api.messages(nextRoom.id);
    setMessages(normalize(history));
  }

  async function leaveRoom() {
    if (!room) return;
    await run(async () => {
      const roomId = room.id;
      await controller.disconnect(roomId);
      await api.leaveRoom(roomId);
      await closeRoomState();
      await refreshRooms();
    });
  }

  async function endRoom() {
    if (!room) return;
    await run(async () => {
      const roomId = room.id;
      await controller.disconnect(roomId);
      await api.endRoom(roomId);
      await closeRoomState();
      await refreshRooms();
    });
  }

  async function closeRoomState() {
    if (room?.id) {
      await controller.disconnect(room.id);
    }
    setRoom(null);
    setParticipants([]);
    setMessages([]);
  }

  async function sendMessage(text: string) {
    if (!room) return;
    await run(async () => {
      const message = await api.sendMessage(room.id, text);
      setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
    });
  }

  async function muteParticipant(userId: string) {
    if (!room) return;
    await run(async () => {
      await api.muteParticipant(room.id, userId);
      await refreshRoom();
    });
  }

  async function kickParticipant(userId: string) {
    if (!room) return;
    await run(async () => {
      await api.kickParticipant(room.id, userId);
      await refreshRoom();
    });
  }

  function copyInvite() {
    if (!room) return;
    const invite = `${location.origin}/?invite=${room.inviteToken}`;
    navigator.clipboard.writeText(invite)
      .then(() => setToast("Ссылка скопирована"))
      .catch(() => setToast(invite));
  }

  async function connectCall(localVideo: HTMLVideoElement | null) {
    if (!room) return;
    await run(() => controller.connect(room.id, localVideo, { micOn: false, cameraOn: false }));
  }

  async function toggleMic() {
    if (!room) return;
    await run(() => controller.setMic(room.id, !media.micOn));
  }

  async function toggleCamera() {
    if (!room) return;
    await run(() => controller.setCamera(room.id, !media.cameraOn));
  }

  return (
    <>
      <main className="app">
        <aside className="rail">
          <header className="brand">
            <div className="brand-mark">R</div>
            <div>
              <h1>Radiance</h1>
              <p>Звонки, комнаты и чат</p>
            </div>
          </header>
          <AuthPanel
            mode={authMode}
            user={user}
            busy={busy}
            onModeChange={setAuthMode}
            onSubmit={authenticate}
            onLogout={logout}
          />
          <RoomPanel
            rooms={rooms}
            activeRoom={room}
            visibility={visibility}
            authenticated={Boolean(user)}
            busy={busy}
            onVisibilityChange={setVisibility}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            onRefresh={() => run(refreshRooms)}
          />
        </aside>

        <MeetingStage
          room={room}
          user={user}
          participants={participants}
          media={media}
          controller={controller}
          onCopyInvite={copyInvite}
          onConnectCall={connectCall}
          onToggleMic={toggleMic}
          onToggleCamera={toggleCamera}
          onLeaveRoom={leaveRoom}
          onEndRoom={endRoom}
        />

        <aside className="side">
          <ParticipantsPanel participants={participants} user={user} onMute={muteParticipant} onKick={kickParticipant} />
          <ChatPanel room={room} messages={messages} user={user} onSend={sendMessage} />
        </aside>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function normalize<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
