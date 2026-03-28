---
name: house-app
description: House-app (Church app) — Expo/React Native smart home controller with FastAPI backend. Hue lights, Lutron Caseta, Vivint cameras. Trigger words - church app, house app, smart home app, lights app.
---

# House App (Church)

Smart home controller app at `~/code/house-app/`. **This is a separate project from dispatch** (which lives at `~/dispatch/`).

Also known as: "Church app", "The Church app"

## Architecture

- **Frontend:** Expo/React Native (expo-router, file-based routing)
- **Backend:** FastAPI on port **9092** (separate from dispatch-api on 9091)
- **LaunchAgent:** `com.house.api` — auto-starts, keeps alive
- **iOS bundle:** `com.church.app`, Xcode project named "Church"

## Config System

3-tier merge: `config.default.json` → `app.yaml` (gitignored) → env vars

Key defaults:
- `appName`: "Church"
- `bundleIdentifier`: "com.church.app"
- `scheme`: "church"
- `accentColor`: "#f59e0b" (amber)
- `splashColor`: "#09090b" (dark)

## Backend (FastAPI)

**Server:** `~/code/house-app/api/server.py` — runs via `uv run` on port 9092

**Auth:** Optional Bearer token via `HOUSE_API_KEY` env var or `~/.claude/config.local.yaml`

**Logs:** `/tmp/house-api.log`

### API Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Health check (no auth) |
| `/api/lights/state` | GET | All devices/rooms state |
| `/api/lights/control` | POST | Control single device |
| `/api/lights/room` | POST | Control all lights in room |
| `/api/lights/all-off` | POST | All-off scene |
| `/api/lights/scene` | POST | Activate scene (movie/night/morning) |
| `/api/cameras` | GET | List all cameras |
| `/api/cameras/{id}/stream` | POST | Start MJPEG stream |
| `/api/cameras/{id}/stream` | DELETE | Stop MJPEG stream |
| `/api/cameras/{id}/snapshot` | GET | JPEG snapshot |
| `/api/cameras/{id}/stream/keepalive` | GET | Keep stream alive |

### LaunchAgent Management

```bash
# Install
cp ~/code/house-app/api/com.house.api.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.house.api.plist

# Start/Stop/Restart
launchctl start com.house.api
launchctl stop com.house.api
launchctl kickstart -k gui/$(id -u)/com.house.api

# Logs
tail -f /tmp/house-api.log

# Status
launchctl list | grep house
```

## Smart Home Integrations

### Philips Hue
- Config: `~/.hue/` (office.json, home.json)
- Multiple bridges via HTTP REST API
- 2-second state cache TTL
- Uses `curl` subprocess (bypasses macOS firewall restrictions on Python)

### Lutron Caseta
- Bridge IP from env var `LUTRON_BRIDGE_IP` or `~/.claude/config.local.yaml`
- LEAP protocol over TLS (port 8081)
- Certs: `~/.config/pylutron_caseta/{IP}.crt`, `.key`, `-bridge.crt`
- 29 zones across 8 rooms: dimmers, switches, shades
- ThreadPoolExecutor for parallel command batching

### Vivint Cameras
- State: `~/.claude/skills/vivint/state/panels.json`
- Snapshots: `~/.claude/skills/vivint/scripts/vivint-snapshot`
- Local: `rtsp://{IP}:8554/Video-{ID}` (LAN only)
- Remote: RTSPS via `v.vivintsky.com`
- MJPEG streaming via Python/OpenCV (ports 9100+, 30min timeout)

## Frontend Tabs

1. **Lights** — Room cards, aggregate state, scenes, all-off button
2. **Cameras** — Grouped by panel, snapshot thumbnails, MJPEG streams
3. **Cats** — Cat photos/tracking
4. **Notes** — Notes management
5. **Settings** — API URL config, connection status, health polling

**Dynamic routes:** `/room/[name]` (room detail), `/camera/[id]` (camera detail)

## Scenes

| Scene | Effect |
|-------|--------|
| `all_off` | All lights off, all shades closed |
| `movie` | Living room lights off + shades down |
| `night` | Everything dimmed to 10% |
| `morning` | Shades open, lights to 70% |

## Rooms

Master Bedroom, Living Room, Front Bathroom, main Bedroom, Guest Bedroom, Outside Patio, Great Room, Office, Front Hallway, Upstairs Loft, Basement

## Development

```bash
cd ~/code/house-app

# Frontend dev
bun install          # Install deps (user prefers bun)
bun start            # Expo dev server
bun run ios          # Build for iOS

# Backend dev
uv run ~/code/house-app/api/server.py --port 9092

# Lint
bun run lint         # oxlint src/ app/
```

## iOS / TestFlight

- Xcode project: `~/code/house-app/ios/Church.xcodeproj`
- Bundle ID: `com.church.app`
- Display name: "Church"
- URL schemes: `church`, `com.church.app`
- Min iOS: 12.0
- CocoaPods for native deps
- FaceID enabled

## Key Files

| File | Purpose |
|------|---------|
| `app.config.ts` | Expo config (3-tier merge) |
| `config.default.json` | Default settings |
| `api/server.py` | FastAPI backend |
| `api/com.house.api.plist` | LaunchAgent |
| `app/(tabs)/_layout.tsx` | Tab navigation config |
| `src/context/` | LightsContext (global state) |
| `src/api/` | API client & types |
| `ios/Church/` | iOS native source |
