# Deployment

Radiance has two LAN-oriented Docker Compose profiles. Both expose one HTTP entrypoint for the web application, REST API, SSE and LiveKit signaling. LiveKit handles WebRTC media directly, so its media ports must also be reachable from client machines.

## Linux LAN Profile

Use this profile when Docker runs directly on Linux. LiveKit uses host networking, so it sees the host network interfaces and does not need a manually configured LAN IP.

```bash
cp deployments/.env.linux.example deployments/.env.linux
docker compose --env-file deployments/.env.linux -f deployments/docker-compose.linux.yml up --build
```

Open the app from another device:

```text
http://<linux-lan-host>:8080
```

Required inbound firewall ports on the Linux host:

| Purpose | Port |
|---|---:|
| Web app, API, SSE, LiveKit signaling through nginx | TCP 8080 |
| LiveKit ICE/TCP fallback | TCP 7881 |
| LiveKit WebRTC media | UDP 50000-50100 |

## Docker Desktop / WSL Profile

Use this profile for Windows, WSL or macOS Docker Desktop. Containers cannot reliably infer the LAN address of the host, so `LAN_HOST` is required.

```bash
cp deployments/.env.desktop.example deployments/.env.desktop
```

Set `LAN_HOST` to the LAN IP address of the PC that runs Docker:

```env
LAN_HOST=192.168.1.50
```

Start the stack:

```bash
docker compose --env-file deployments/.env.desktop -f deployments/docker-compose.desktop.yml up --build
```

The default `deployments/docker-compose.yml` is the same Docker Desktop profile, so this also works:

```bash
docker compose --env-file deployments/.env -f deployments/docker-compose.yml up --build
```

Open the app from another device:

```text
http://<LAN_HOST>:8080
```

Required inbound firewall rules on Windows/macOS:

| Purpose | Port |
|---|---:|
| Web app, API, SSE, LiveKit signaling through nginx | TCP 8080 |
| LiveKit ICE/TCP fallback | TCP 7881 |
| LiveKit WebRTC media | UDP 50000-50100 |

## Public URL Rules

`LIVEKIT_URL` is optional. If it is empty, the backend derives the signaling URL from `X-Forwarded-Proto` and `X-Forwarded-Host`:

```text
http://host:8080  -> ws://host:8080/livekit
https://host      -> wss://host/livekit
```

Set `LIVEKIT_URL` only when a reverse proxy or load balancer rewrites host or scheme in a way that the backend cannot infer.

## Browser Security Note

This LAN profile intentionally stays on HTTP. Modern browsers may block camera and microphone access on non-localhost HTTP origins. If that happens, the next infrastructure step is a local HTTPS profile with a trusted certificate.
