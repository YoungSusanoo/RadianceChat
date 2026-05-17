# Deployment

Radiance is configured for a single Linux server deployment. The server runs nginx, the Go backend, PostgreSQL and LiveKit in Docker Compose.

## Network Model

- nginx publishes TCP `8080` for the web application, REST API and SSE.
- LiveKit uses host networking and listens on TCP `7880` for public WebSocket signaling, TCP `7881` for ICE/TCP fallback and UDP `50000-50100` for WebRTC media.
- The Go backend is available only inside Docker Compose and is proxied by nginx.
- PostgreSQL is available only inside the Docker `backend` network.

## Run

Create an env file:

```bash
cp deployments/.env.example deployments/.env
```

For a local/demo server, the default LiveKit credentials are enough. For a real server, replace `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` with your own values.

Set `LIVEKIT_NODE_IP` to the public IPv4 address of the server:

```env
LIVEKIT_URL=ws://144.31.156.17:7880
LIVEKIT_NODE_IP=144.31.156.17
```

`LIVEKIT_URL` is the WebSocket signaling endpoint used by browsers. `LIVEKIT_NODE_IP` is the address LiveKit advertises in WebRTC ICE candidates. The deployment does not rely on automatic external IP discovery because it can fail on VPS/docker hosts.

Start the stack:

```bash
docker compose --env-file deployments/.env -f deployments/docker-compose.yml up --build
```

Open the app:

```text
http://<server-host>:8080
```

## Firewall

Allow inbound traffic to:

| Purpose | Port |
|---|---:|
| Web app, API and SSE through nginx | TCP 8080 |
| LiveKit WebSocket signaling | TCP 7880 |
| LiveKit ICE/TCP fallback | TCP 7881 |
| LiveKit WebRTC media | UDP 50000-50100 |

LiveKit signaling is intentionally exposed directly on `7880`; nginx no longer rewrites LiveKit paths.

## Browser Security Note

For real camera and microphone access from browsers, prefer HTTPS with a trusted certificate. Plain HTTP is acceptable for localhost and may work for local demos, but browsers can block media permissions on non-secure origins.
