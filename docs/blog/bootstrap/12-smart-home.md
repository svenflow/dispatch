# 12: Smart Home Integration

## Goal

Give Claude control over your smart home - lights (Hue, Lutron), speakers (Sonos), and more.

## Philips Hue

**GitHub:** [`skills/hue/`](https://github.com/jsmith/dispatch/tree/main/skills/hue)

### Setup

1. Get your Hue bridge IP (check your router or the Hue app)
2. Create an API token by pressing the bridge button and calling:
   ```bash
   curl -X POST "http://<bridge-ip>/api" -d '{"devicetype":"dispatch#assistant"}'
   ```
3. Save credentials:
   ```bash
   mkdir -p ~/.hue
   echo '{"ip": "10.0.0.10", "token": "your-token"}' > ~/.hue/home.json
   ```

### Usage

```bash
HUE=~/dispatch/skills/hue/scripts/control.py

# List lights
uv run $HUE list

# Control lights
uv run $HUE on "Living Room"
uv run $HUE off "Living Room"
uv run $HUE brightness "Living Room" 128    # 0-254
uv run $HUE color "Living Room" 10000 254   # hue, saturation
```

### Multi-Bridge Support

For multiple locations (home, office):
```bash
# ~/.hue/office.json - second bridge
uv run $HUE list office
uv run $HUE on "Desk Lamp" --bridge office
```

---

## Lutron Caseta

**GitHub:** [`skills/lutron/`](https://github.com/jsmith/dispatch/tree/main/skills/lutron)

### Setup

Lutron uses TLS with client certificates:

1. Get bridge IP from router or Lutron app
2. Pair and extract certificates:
   ```bash
   # Follow Lutron pairing flow to get certs
   mkdir -p ~/.config/pylutron_caseta
   # Place: ca.crt, client.crt, client.key
   ```

### Usage

```bash
LUTRON=~/dispatch/skills/lutron/scripts/control.py

# List devices
uv run $LUTRON list

# Control lights (dimmers)
uv run $LUTRON light "Kitchen" on
uv run $LUTRON light "Kitchen" 50        # 0-100%

# Control shades
uv run $LUTRON shade "Bedroom" open
uv run $LUTRON shade "Bedroom" close
uv run $LUTRON shade "Bedroom" 50        # 50% open

# Room control
uv run $LUTRON room "Living Room" off    # All lights in room
```

---

## Sonos

**GitHub:** [`skills/sonos/`](https://github.com/jsmith/dispatch/tree/main/skills/sonos)

### Setup

Sonos uses SSDP discovery - no configuration needed! Just ensure your Mac is on the same network as the speakers.

### Usage

```bash
SONOS=~/dispatch/skills/sonos/scripts/control.py

# List speakers
uv run $SONOS list

# Playback
uv run $SONOS play "Kitchen"
uv run $SONOS pause "Kitchen"
uv run $SONOS volume "Kitchen" 30        # 0-100

# Grouping
uv run $SONOS group "Living Room" "Kitchen"   # Add Kitchen to Living Room group
uv run $SONOS ungroup "Kitchen"               # Remove from group

# Text-to-speech (announcements)
uv run $SONOS say "Kitchen" "Dinner is ready"

# EQ controls
uv run $SONOS bass "Living Room" 5       # -10 to +10
uv run $SONOS treble "Living Room" -2
uv run $SONOS loudness "Living Room" on
```

---

## Symlink for Skills

```bash
ln -sf ~/dispatch/skills/hue ~/.claude/skills/hue
ln -sf ~/dispatch/skills/lutron ~/.claude/skills/lutron
ln -sf ~/dispatch/skills/sonos ~/.claude/skills/sonos
```

## Combined Control

Claude can orchestrate across systems:

> "Turn off all the lights and play some jazz in the living room"

Claude will:
1. Call Hue to turn off lights
2. Call Lutron to turn off dimmers
3. Call Sonos to play music

## Verification Checklist

- [ ] Hue: `control.py list` shows your lights
- [ ] Hue: Can turn lights on/off
- [ ] Lutron: `control.py list` shows devices (if you have Lutron)
- [ ] Sonos: `control.py list` discovers speakers
- [ ] Sonos: Can play/pause and adjust volume
- [ ] Skills symlinked to `~/.claude/skills/`

## What's Next

`13-open-source.md` covers sanitizing the system for public release.
