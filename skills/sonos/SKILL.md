---
name: sonos
description: Control Sonos speakers on the local network - play/pause, volume, grouping, text-to-speech. Use when asked about music, speakers, or audio playback.
allowed-tools: Bash(uv:*)
---

# Sonos Control

Control Sonos speakers using the local UPnP API via SoCo library. No hardcoded IPs - uses SSDP discovery.

## Quick Reference

```bash
SONOS="uv run ~/.claude/skills/sonos/scripts/control.py"
```

## Commands

### Discovery & Status

```bash
# List all speakers (with IP, model, volume, state)
$SONOS list

# Get detailed status of all speakers
$SONOS status

# Get status of specific speaker
$SONOS status "Kitchen"
```

### Playback Control

```bash
# Play/pause/stop (speaker name is case-insensitive partial match)
$SONOS play "Kitchen"
$SONOS pause "Kitchen"
$SONOS stop "Kitchen"

# Skip tracks
$SONOS next "Kitchen"
$SONOS prev "Kitchen"
```

### Volume

```bash
# Get current volume
$SONOS volume "Kitchen"

# Set volume (0-100)
$SONOS volume "Kitchen" 50

# Mute/unmute
$SONOS mute "Kitchen"
$SONOS unmute "Kitchen"
```

### Grouping

```bash
# Add speaker to another speaker's group (synced playback)
$SONOS group "Kitchen" "Family Room"   # Family Room joins Kitchen's group

# Remove speaker from group
$SONOS ungroup "Family Room"
```

### Play Content

```bash
# Play a URI (web streams, radio, etc.)
$SONOS playuri "Kitchen" "http://stream.example.com/radio.mp3"

# Text-to-speech announcement
$SONOS say "Kitchen" "Dinner is ready"
```

### EQ Control

```bash
# Show all EQ settings
$SONOS eq "Family Room"

# Bass (-10 to +10)
$SONOS bass "Family Room"       # Get current
$SONOS bass "Family Room" 5     # Set to +5

# Treble (-10 to +10)
$SONOS treble "Family Room" -2

# Loudness compensation (on/off)
$SONOS loudness "Family Room" on

# Night mode - reduces bass & dynamics (soundbars only)
$SONOS nightmode "Family Room" on

# Dialog/speech enhancement (soundbars only)
$SONOS dialog "Family Room" on

# Subwoofer gain (-15 to +15)
$SONOS subgain "Family Room" 10
```

## Speaker Names

Speaker names support partial, case-insensitive matching:

- `"Kitchen"` matches "Kitchen"
- `"family"` matches "Family Room" or "Family Room 2"
- `"base"` matches "Basement Sonos"

## Current Speakers

Discovered via SSDP (run `$SONOS list` for current state):

| Name | Model | Location |
|------|-------|----------|
| Family Room | Arc Ultra | Main living area |
| Family Room 2 | Era 100 | Near Family Room |
| Kitchen | Era 300 | Kitchen |
| Basement Sonos | Arc | Basement |
| Bathroom | One SL | Bathroom |

(Subs are paired with their soundbars, not standalone)

## Examples

### Play music on Kitchen

```bash
$SONOS play "Kitchen"
```

### Set up whole-home audio

```bash
# Group all speakers with Kitchen as coordinator
$SONOS group "Kitchen" "Family Room"
$SONOS group "Kitchen" "Bathroom"
$SONOS group "Kitchen" "Basement"
```

### Make an announcement

```bash
$SONOS say "Kitchen" "The timer is done"
```

### Check what's playing everywhere

```bash
$SONOS status
```

## Technical Notes

- Uses SoCo library for UPnP/SOAP communication
- Discovery uses SSDP multicast (239.255.255.250:1900)
- Control port is 1400 on each speaker
- Grouped speakers share playback state via coordinator
- Volume is per-speaker even when grouped
