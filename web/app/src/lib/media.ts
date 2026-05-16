import {
  LocalAudioTrack,
  LocalVideoTrack,
  Room as LiveKitRoom,
  RoomEvent,
  Track,
  createLocalAudioTrack
} from "livekit-client";
import { api } from "./api";
import type { Participant } from "./types";

export type MediaStatus =
  | "idle"
  | "requesting-permission"
  | "preview"
  | "connecting"
  | "connected"
  | "fallback"
  | "error";

export type RemoteMediaTile = {
  identity: string;
  name: string;
  element: HTMLVideoElement;
};

export type MediaControllerState = {
  status: MediaStatus;
  statusText: string;
  micOn: boolean;
  cameraOn: boolean;
  room: LiveKitRoom | null;
  localStream: MediaStream | null;
  audioTrack: LocalAudioTrack | null;
  videoTrack: LocalVideoTrack | null;
  remoteTiles: RemoteMediaTile[];
};

type Listener = (state: MediaControllerState) => void;

type ConnectOptions = {
  micOn?: boolean;
  cameraOn?: boolean;
};

export class MediaController {
  private state: MediaControllerState = {
    status: "idle",
    statusText: "Медиа не подключено",
    micOn: false,
    cameraOn: false,
    room: null,
    localStream: null,
    audioTrack: null,
    videoTrack: null,
    remoteTiles: []
  };

  private listeners = new Set<Listener>();

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): MediaControllerState {
    return {
      ...this.state,
      remoteTiles: [...this.state.remoteTiles]
    };
  }

  async connect(roomId: string, localVideo: HTMLVideoElement | null, options: ConnectOptions = {}) {
    if (this.state.room) return;
    const micOn = options.micOn ?? false;
    const cameraOn = options.cameraOn ?? false;
    await this.requestPermission(localVideo, { micOn, cameraOn });
    await api.setDevice(roomId, { muted: !this.state.micOn, cameraOn: this.state.cameraOn });

    try {
      this.patch({ status: "connecting", statusText: "Подключаемся к LiveKit..." });
      const mediaToken = await api.mediaToken(roomId);
      const room = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
      this.bindLiveKitEvents(room);
      await room.connect(mediaToken.livekitUrl, mediaToken.token);

      if (this.state.audioTrack) {
        await room.localParticipant.publishTrack(this.state.audioTrack, { source: Track.Source.Microphone });
      }
      if (this.state.videoTrack) {
        await room.localParticipant.publishTrack(this.state.videoTrack, { source: Track.Source.Camera });
      }

      this.patch({
        room,
        status: "connected",
        statusText: this.state.micOn || this.state.cameraOn
          ? "LiveKit подключен"
          : "LiveKit подключен, микрофон и камера выключены"
      });
    } catch (error) {
      console.warn("LiveKit connection failed", error);
      this.patch({ status: "fallback", statusText: "LiveKit недоступен, работает локальный preview" });
    }
  }

  async requestPermission(localVideo: HTMLVideoElement | null, options: Required<ConnectOptions> = { micOn: true, cameraOn: true }) {
    if (this.state.localStream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.patch({ status: "error", statusText: "Браузер не поддерживает доступ к микрофону" });
      throw new Error("Браузер не поддерживает доступ к микрофону");
    }
    this.patch({ status: "requesting-permission", statusText: "Запрашиваем микрофон и камеру..." });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        this.patch({ status: "error", statusText: "Доступ к микрофону не разрешен" });
        throw new Error("Разрешите доступ к микрофону, чтобы подключить звонок");
      }
    }

    const audioSource = stream.getAudioTracks()[0];
    const videoSource = stream.getVideoTracks()[0];
    const audioTrack = audioSource ? new LocalAudioTrack(audioSource) : await createLocalAudioTrack();
    const videoTrack = videoSource ? new LocalVideoTrack(videoSource) : null;
    audioTrack.mediaStreamTrack.enabled = options.micOn;
    if (videoTrack) {
      videoTrack.mediaStreamTrack.enabled = options.cameraOn;
    }
    const localStream = new MediaStream();
    localStream.addTrack(audioTrack.mediaStreamTrack);
    if (videoTrack) localStream.addTrack(videoTrack.mediaStreamTrack);

    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      await localVideo.play().catch(() => {});
    }

    this.patch({
      localStream,
      audioTrack,
      videoTrack,
      micOn: options.micOn,
      cameraOn: Boolean(videoTrack) && options.cameraOn,
      status: "preview",
      statusText: videoTrack
        ? "Медиа разрешено, микрофон и камера выключены"
        : "Микрофон разрешен и выключен, камера недоступна"
    });
  }

  async setMic(roomId: string, enabled: boolean) {
    if (!this.state.audioTrack) return;
    this.state.audioTrack.mediaStreamTrack.enabled = enabled;
    await api.setDevice(roomId, { muted: !enabled, cameraOn: this.state.cameraOn });
    this.patch({ micOn: enabled, statusText: enabled ? "Микрофон включен" : "Микрофон выключен" });
  }

  async setCamera(roomId: string, enabled: boolean) {
    if (!this.state.videoTrack) {
      this.patch({ statusText: "Камера недоступна, звук продолжает работать" });
      return;
    }
    this.state.videoTrack.mediaStreamTrack.enabled = enabled;
    await api.setDevice(roomId, { muted: !this.state.micOn, cameraOn: enabled });
    this.patch({ cameraOn: enabled, statusText: enabled ? "Камера включена" : "Камера выключена" });
  }

  async disconnect(roomId?: string) {
    if (this.state.room) {
      this.state.room.disconnect();
    }
    this.state.audioTrack?.stop();
    this.state.videoTrack?.stop();
    this.state.localStream?.getTracks().forEach((track) => track.stop());
    this.state.remoteTiles.forEach((tile) => tile.element.remove());
    if (roomId) {
      await api.setDevice(roomId, { muted: true, cameraOn: false }).catch(() => {});
    }
    this.patch({
      status: "idle",
      statusText: "Медиа не подключено",
      micOn: false,
      cameraOn: false,
      room: null,
      localStream: null,
      audioTrack: null,
      videoTrack: null,
      remoteTiles: []
    });
  }

  participantName(participants: Participant[], identity: string): string {
    return participants.find((participant) => participant.userId === identity)?.name || identity;
  }

  private bindLiveKitEvents(room: LiveKitRoom) {
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      const element = track.attach();
      element.autoplay = true;
      if (element instanceof HTMLVideoElement) {
        element.playsInline = true;
      }
      if (track.kind === Track.Kind.Audio) {
        document.body.append(element);
        return;
      }
      const video = element as HTMLVideoElement;
      const remoteTiles = this.state.remoteTiles.filter((tile) => tile.identity !== participant.identity);
      remoteTiles.push({ identity: participant.identity, name: participant.name || participant.identity, element: video });
      this.patch({ remoteTiles });
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      track.detach().forEach((element) => element.remove());
      this.patch({ remoteTiles: this.state.remoteTiles.filter((tile) => tile.identity !== participant.identity) });
    });

    room.on(RoomEvent.Disconnected, () => {
      this.patch({ room: null, status: "fallback", statusText: "LiveKit отключился, локальный preview остался" });
    });
  }

  private patch(next: Partial<MediaControllerState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener(this.snapshot()));
  }
}
