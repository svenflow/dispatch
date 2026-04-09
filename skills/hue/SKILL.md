---
name: hue
description: Control Philips Hue lights (on/off, brightness, colors). Use together with lutron skill when user asks about controlling lights or smart home lighting.
---

# Philips Hue Skill

Control Philips Hue lights across multiple bridges.

## Quick Commands

### Individual Lights
```bash
# Turn on/off a light
uv run ~/.claude/skills/hue/scripts/control.py on "Piano Backlight"
uv run ~/.claude/skills/hue/scripts/control.py off "Piano Backlight"

# Set brightness (0-254)
uv run ~/.claude/skills/hue/scripts/control.py brightness "Piano Backlight" 150

# Set color (hue 0-65535, sat 0-254)
uv run ~/.claude/skills/hue/scripts/control.py color "Piano Backlight" 10000 254

# List all lights
uv run ~/.claude/skills/hue/scripts/control.py list
uv run ~/.claude/skills/hue/scripts/control.py list office
```

### Room/Group Control
```bash
# Blink a room (off, wait, on)
uv run ~/.claude/skills/hue/scripts/blink_room.py "Great Room Lamps" 1

# Control rooms via API:
# Turn room on:  curl -X PUT "http://<ip>/api/<user>/groups/<id>/action" -d '{"on":true}'
# Turn room off: curl -X PUT "http://<ip>/api/<user>/groups/<id>/action" -d '{"on":false}'
```

## Rooms/Groups

### Office Bridge
| ID | Name | Type |
|----|------|------|
| 81 | Great Room Lamps | Room |
| 82 | Great Room Floor Lights | Room |
| 83 | Great Room | Zone |
| 84 | Great Room Overhead Spots | Room |
| 85 | Office | Room |

### Home Bridge
| ID | Name | Type |
|----|------|------|
| 84 | Front Hallway | Room |
| 85 | Upstairs Loft | Room |
| 86 | Big Fish Tank | Room |
| 88 | Master Bedroom | Room |
| 89 | Basement | Room |

## Bridges

| Name | IP | Location |
|------|-----|----------|
| Great Office kit | see config.local.yaml hue.bridges.office.ip | office |
| Hue Bridge | see config.local.yaml hue.bridges.home.ip | home |

## Office Bridge Lights (24)
- String Lights Stairs
- Hanging Lamp Wall Laundry Side
- Red Shade Lamp Wall Laundry Side
- Edison Tri Lamp
- Microphone Lamp
- Christmas Tree Lights
- Cylinder Lamp Wood Base
- Salt Lamp
- Floor Lamp Egg Ratan
- Spot Piano
- Overhead Spot Angled Center
- Overhead Spot Straight Wall
- Piano Backlight
- Stair Floor Strip
- Spot Couch Sliding Door
- Incense Center Table Strip
- Top Stairs Office Loft
- Office Overhead Desk 1-3
- Office Overhead Hole 1-3
- Christmas tree

## Home Bridge Lights (44)
- Hallway Center 1-5
- Hallway Front 1-5
- Side A, Side B
- Bedroom ceiling grid (b0,0 - b3,4)
- Bar 1-3
- Closet Corner Overhead
- Closet art light
- Outdoor Strip 1
- Fishtank Light Strip
- Upstairs Light Above Desk
- Vivint Panel
- Smart plug
- Noise Machine Master Bedroom

## Configuration

Credentials stored in: ~/.hue/
- office.json
- home.json

## Entertainment / Light Show (Basement Ceiling Grid)

For beat-synced or animation-driven light shows on the basement ceiling, use the entertainment server:

**Server:** `~/code/hue-latency-tester/entertainment-v2.js`
**Port:** 8788 (HTTP + web UI at `http://localhost:8788`)

Start the server:
```bash
cd ~/code/hue-latency-tester && node entertainment-v2.js
```

### HTTP API

```bash
# Check status (streaming: true/false)
curl http://localhost:8788/api/status

# Reconnect DTLS stream
curl -X POST http://localhost:8788/api/reconnect

# Set all 20 grid lights to a color (r/g/b: 0-255)
curl -X POST http://localhost:8788/api/cmd -H 'Content-Type: application/json' \
  -d '{"action":"setAll","r":255,"g":0,"b":0}'

# Set a single grid cell (row 0-3, col 0-4)
curl -X POST http://localhost:8788/api/cmd -H 'Content-Type: application/json' \
  -d '{"action":"setCell","row":1,"col":2,"r":0,"g":255,"b":0}'

# Run a named animation
curl -X POST http://localhost:8788/api/cmd -H 'Content-Type: application/json' \
  -d '{"action":"anim","name":"rainbow"}'

# Stop animation
curl -X POST http://localhost:8788/api/cmd -H 'Content-Type: application/json' \
  -d '{"action":"anim","name":"stop"}'
```

### Grid Layout (4 rows x 5 cols = 20 lights)

```
col:  0     1     2     3     4
row 0: 55    49    40    43    38
row 1: 56    35    46    41    48
row 2: 39    50    47    42    32
row 3: 37    36    44    45    51
```
Values are Hue light IDs on the home bridge.

**Entertainment group:** 200 (pre-configured on home bridge)

**DTLS channels** (entertainment API, real-time ~25fps): cols 2-4 rows 0-3 (10 lights)
- Channels are ordered as: [43, 41, 42, 45, 38, 48, 32, 51, 40, 46]
- Cols 0-1 rows 0-3 are REST-only (slower but still addressable via setCell)

**Approach:** Hybrid - DTLS for low-latency channels (cols 2-4), REST API for the outer two columns. The server uses phea to do the DTLS handshake and then hijacks the raw socket to send hand-built HueStream packets, bypassing phea's tween system for direct frame control.

### Running on pocket-sven (DJ Beat-Sync)

The entertainment server can run remotely on pocket-sven (the Pi) instead of locally:

```bash
# SSH to pocket-sven and start server
ssh pocket-sven "cd ~/code/hue-latency-tester && node entertainment-v2.js &"

# Check server status
ssh pocket-sven "curl -s http://localhost:8788/api/status"

# Send commands remotely (forward the port or use ssh tunnel)
ssh -L 8788:localhost:8788 pocket-sven &  # tunnel
curl http://localhost:8788/api/status       # now works locally

# Send color command via Pi
curl -X POST http://localhost:8788/api/cmd -H 'Content-Type: application/json' \
  -d '{"action":"setAll","r":255,"g":0,"b":0}'
```

**DTLS runs from the Pi** at ~25fps over 10 lights. The Pi has local network access to the Hue bridge and handles the DTLS handshake. Streaming logs show: "DTLS attempt 1/3... Hue Entertainment streaming ACTIVE (10 lights)"

Stop the server:
```bash
ssh pocket-sven "pkill -f entertainment-v2.js"
```
