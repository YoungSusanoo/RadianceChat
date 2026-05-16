import type { FormEvent } from "react";
import type { PublicRoom, Room } from "../lib/types";

type Props = {
  rooms: PublicRoom[];
  activeRoom: Room | null;
  visibility: "public" | "private";
  authenticated: boolean;
  busy: boolean;
  onVisibilityChange: (visibility: "public" | "private") => void;
  onCreateRoom: (payload: { name: string; description: string; visibility: "public" | "private" }) => void;
  onJoinRoom: (roomId: string) => void;
  onRefresh: () => void;
};

export function RoomPanel({
  rooms,
  activeRoom,
  visibility,
  authenticated,
  busy,
  onVisibilityChange,
  onCreateRoom,
  onJoinRoom,
  onRefresh
}: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onCreateRoom({
      name: String(form.get("name") || "Новая комната"),
      description: String(form.get("description") || ""),
      visibility
    });
    event.currentTarget.reset();
  }

  return (
    <>
      <section className="surface">
        <div className="section-title">
          <h2>Создать комнату</h2>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label>
            Название
            <input name="name" placeholder="Командный созвон" disabled={!authenticated} />
          </label>
          <label>
            Описание
            <input name="description" placeholder="Короткая встреча" disabled={!authenticated} />
          </label>
          <div className="switch">
            <button className={visibility === "public" ? "active" : ""} type="button" onClick={() => onVisibilityChange("public")}>
              Публичная
            </button>
            <button className={visibility === "private" ? "active" : ""} type="button" onClick={() => onVisibilityChange("private")}>
              Приватная
            </button>
          </div>
          <button className="button primary" type="submit" disabled={!authenticated || busy}>
            Создать комнату
          </button>
        </form>
      </section>

      <section className="surface rooms-surface">
        <div className="section-title">
          <h2>Публичные комнаты</h2>
          <button className="button icon" type="button" title="Обновить" onClick={onRefresh} disabled={!authenticated || busy}>
            R
          </button>
        </div>
        <div className="rooms-list">
          {!authenticated && <div className="empty">Войдите, чтобы увидеть комнаты</div>}
          {authenticated && rooms.length === 0 && <div className="empty">Публичных комнат пока нет</div>}
          {authenticated && rooms.map((room) => (
            <article className={`room-card${activeRoom?.id === room.id ? " active" : ""}`} key={room.id}>
              <strong>{room.name}</strong>
              <div className="room-meta">
                <span>{room.participants} участников</span>
                <span>{room.visibility}</span>
              </div>
              <button className="button quiet" type="button" onClick={() => onJoinRoom(room.id)} disabled={busy}>
                Войти
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

