---
name: lutron
description: Control Lutron Caseta dimmers and shades (on/off, brightness, open/close). Use together with hue skill when user asks about controlling lights or smart home lighting.
---

# Lutron Caseta Skill

Control Lutron Caseta lights, dimmers, and shades via the LEAP protocol.

## Quick Commands

### Lights

```bash
# Turn on a light (100%)
uv run ~/.claude/skills/lutron/scripts/control.py light "Living Room" on

# Turn off a light
uv run ~/.claude/skills/lutron/scripts/control.py light "Living Room" off

# Set brightness (0-100)
uv run ~/.claude/skills/lutron/scripts/control.py light "Living Room" 50

# Turn on all lights in a room
uv run ~/.claude/skills/lutron/scripts/control.py room "Master Bedroom" on

# Turn off all lights
uv run ~/.claude/skills/lutron/scripts/control.py all-lights off
```

### Shades

```bash
# Open shades (100%)
uv run ~/.claude/skills/lutron/scripts/control.py shade "Shades 1 near stairs" open

# Close shades (0%)
uv run ~/.claude/skills/lutron/scripts/control.py shade "Shades 1 near stairs" close

# Set shade position (0-100, 100=open)
uv run ~/.claude/skills/lutron/scripts/control.py shade "Shades 1 near stairs" 50

# Control all shades in a room
uv run ~/.claude/skills/lutron/scripts/control.py room-shades "Living Room" close
```

### List Devices

```bash
# List all devices
uv run ~/.claude/skills/lutron/scripts/control.py list

# List by room
uv run ~/.claude/skills/lutron/scripts/control.py list "Living Room"
```

## Available Devices

### Lights/Dimmers
| Name | Room | Zone |
|------|------|------|
| Main Lights 1 | main Bedroom | 1 |
| Main Lights 2 | main Bedroom | 2 |
| hallway | main Bedroom | 5 |
| Main Lights | Living Room | 3 |
| Sink Lights | front Bathroom | 4 |
| Hallway | Master Bedroom | 23 |
| Cove Lights | Master Bedroom | 24 |
| Overhead | Master Bedroom | 25 |
| Bathroom Overhead | Master Bedroom | 26 |
| Bathroom Mirror | Master Bedroom | 27 |
| Closet | Master Bedroom | 28 |
| Bathroom Sconce | Master Bedroom | 29 |
| Deck Lights | Outside Patio | 21 |

### Shades
| Name | Room | Zone |
|------|------|------|
| Shades 1 near stairs | Living Room | 8 |
| Shades 2 near stairs | Living Room | 7 |
| Shades 3 near piano | Living Room | 9 |
| Shades 4 near piano | Living Room | 10 |
| Shades 5 near projector | Living Room | 11 |
| Shades 6 near projector | Living Room | 12 |
| Shades 1 bathroom | front Bathroom | 14 |
| Shades 2 bathroom | front Bathroom | 13 |
| Shades 2 bedroom | Master Bedroom | 16 |
| Shades 3 bedroom | Master Bedroom | 17 |
| left shade | Guest Bedroom | 18 |
| right shade | Guest Bedroom | 19 |
| bed shade | Guest Bedroom | 20 |

## Configuration

Bridge IP: see config.local.yaml lutron.bridge_ip
Certificates: ~/.config/pylutron_caseta/
