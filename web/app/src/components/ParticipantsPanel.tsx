import type { Participant, User } from "../lib/types";

type Props = {
  participants: Participant[];
  user: User | null;
  onMute: (userId: string) => void;
  onKick: (userId: string) => void;
};

export function ParticipantsPanel({ participants, user, onMute, onKick }: Props) {
  const me = participants.find((participant) => participant.userId === user?.id);
  const isHost = me?.role === "host";

  return (
    <section className="surface participants-surface">
      <div className="section-title">
        <h2>Участники</h2>
        <span>{participants.length}</span>
      </div>
      <div className="participants-list">
        {participants.length === 0 && <div className="empty">Нет активной комнаты</div>}
        {participants.map((participant) => (
          <div className="participant-row" key={participant.userId}>
            <div className="participant-main">
              <strong>{participant.name}</strong>
              <span>
                {participant.role}
                {participant.connected ? "" : " · offline"}
                {participant.muted ? " · mic off" : ""}
                {participant.cameraOn ? " · cam on" : ""}
              </span>
            </div>
            {isHost && participant.userId !== user?.id ? (
              <>
                <button className="button quiet" type="button" onClick={() => onMute(participant.userId)}>
                  Mute
                </button>
                <button className="button danger" type="button" onClick={() => onKick(participant.userId)}>
                  Kick
                </button>
              </>
            ) : (
              <span className="badge">{participant.userId === user?.id ? "you" : participant.role}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

