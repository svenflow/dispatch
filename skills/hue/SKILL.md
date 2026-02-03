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
