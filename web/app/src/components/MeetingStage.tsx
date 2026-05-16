import { useEffect, useRef } from "react";
import type { MediaController, MediaControllerState } from "../lib/media";
import type { Participant, Room, User } from "../lib/types";

type Props = {
  room: Room | null;
  user: User | null;
  participants: Participant[];
  media: MediaControllerState;
  controller: MediaController;
  onCopyInvite: () => void;
  onConnectCall: (localVideo: HTMLVideoElement | null) => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeaveRoom: () => void;
  onEndRoom: () => void;
};

export function MeetingStage({
  room,
  user,
  participants,
  media,
  controller,
  onCopyInvite,
  onConnectCall,
  onToggleMic,
  onToggleCamera,
  onLeaveRoom,
  onEndRoom
}: Props) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLDivElement | null>(null);
  const autoConnectedRoomRef = useRef("");
  const me = participants.find((participant) => participant.userId === user?.id);
  const isHost = me?.role === "host";

  useEffect(() => {
    if (!room?.id) {
      autoConnectedRoomRef.current = "";
      return;
    }
    if (autoConnectedRoomRef.current === room.id) return;
    autoConnectedRoomRef.current = room.id;
    onConnectCall(localVideoRef.current);
  }, [onConnectCall, room?.id]);

  useEffect(() => {
    if (!remoteRef.current) return;
    remoteRef.current.querySelectorAll("[data-livekit-remote]").forEach((element) => element.remove());
    for (const tile of media.remoteTiles) {
      const wrapper = document.createElement("article");
      wrapper.className = "video-tile";
      wrapper.dataset.livekitRemote = tile.identity;
      wrapper.append(tile.element);
      const caption = document.createElement("div");
      caption.className = "tile-caption";
      caption.innerHTML = `<strong>${escapeHtml(controller.participantName(participants, tile.identity))}</strong><span>LiveKit</span>`;
      wrapper.append(caption);
      remoteRef.current.append(wrapper);
    }
  }, [controller, media.remoteTiles, participants]);

  const remoteParticipants = participants.filter((participant) => participant.userId !== user?.id);

  return (
    <section className="meeting">
      <header className="meeting-header">
        <div>
          <h2>{room?.name || "Комната не выбрана"}</h2>
          <p>
            {room
              ? `${room.visibility === "private" ? "Приватная" : "Публичная"} комната · ${participants.length} участников`
              : "Создайте комнату или войдите в существующую."}
          </p>
        </div>
        <div className="header-actions">
          <button className="button quiet" type="button" onClick={onCopyInvite} disabled={!room}>
            Ссылка
          </button>
          <button className="button quiet" type="button" onClick={onLeaveRoom} disabled={!room}>
            Выйти
          </button>
          <button className="button danger" type="button" onClick={onEndRoom} disabled={!room || !isHost}>
            Завершить
          </button>
        </div>
      </header>

      <section className="stage">
        <div className="media-grid">
          <article className="video-tile local">
            <video ref={localVideoRef} data-local-video muted autoPlay playsInline />
            <div className="tile-caption">
              <strong>Вы</strong>
              <span>{media.statusText}</span>
            </div>
          </article>

          <div className="remote-grid" ref={remoteRef}>
            {media.remoteTiles.length === 0 && remoteParticipants.map((participant) => (
              <article className="placeholder-tile" key={participant.userId}>
                <span>
                  {participant.name}
                  {participant.muted ? " · mic off" : ""}
                </span>
              </article>
            ))}
          </div>
        </div>

        <footer className="callbar">
          <button
            className="button control"
            type="button"
            disabled={!room || !media.audioTrack}
            onClick={onToggleMic}
          >
            {media.micOn ? "Mic on" : "Mic off"}
          </button>
          <button
            className="button control"
            type="button"
            disabled={!room || !media.videoTrack}
            onClick={onToggleCamera}
          >
            {media.cameraOn ? "Cam on" : "Cam off"}
          </button>
        </footer>
      </section>
    </section>
  );
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char] || char));
}
