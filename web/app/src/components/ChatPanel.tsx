import type { FormEvent } from "react";
import type { Message, Room, User } from "../lib/types";

type Props = {
  room: Room | null;
  messages: Message[];
  user: User | null;
  onSend: (text: string) => void;
};

export function ChatPanel({ room, messages, user, onSend }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = String(form.get("message") || "").trim();
    if (!text) return;
    onSend(text);
    event.currentTarget.reset();
  }

  return (
    <section className="surface chat-surface">
      <div className="section-title">
        <h2>Чат</h2>
      </div>
      <div className="messages-list">
        {!room && <div className="empty">Чат появится после входа в комнату</div>}
        {room && messages.length === 0 && <div className="empty">Сообщений пока нет</div>}
        {messages.map((message) => (
          <article className={`message${message.userId === user?.id ? " mine" : ""}`} key={message.id}>
            <strong>{message.userName}</strong>
            <div>{message.text}</div>
            <time>{formatTime(message.createdAt)}</time>
          </article>
        ))}
      </div>
      <form className="message-form" onSubmit={submit}>
        <input name="message" placeholder="Написать сообщение" autoComplete="off" disabled={!room} />
        <button className="button primary" type="submit" disabled={!room}>
          Отправить
        </button>
      </form>
    </section>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

