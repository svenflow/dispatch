---
name: sonos
description: Control Sonos speakers - make announcements, play audio, TTS, volume, grouping. Trigger words - sonos, announcement, speakers, play on speakers, house-wide.
---

# Sonos Control

Control Sonos speakers using the unified `sonos` CLI. Plays on **all speakers by default** with **60% volume**.

## ⚠️ Access Control

**Announcements are ADMIN-ONLY.** Only users with `admin` or `wife` tier can make Sonos announcements. For non-admin users requesting announcements, politely decline and explain this is restricted to household admins for security/privacy reasons.

## Quick Reference

```bash
SONOS="~/.claude/skills/sonos/scripts/sonos"
```

## Main Commands

### Play Text (TTS)

```bash
# Announce on all speakers (default: 60% volume)
$SONOS play "Dinner is ready"

# Specify volume
$SONOS play "Wake up!" --volume 80

# Specific speakers only
$SONOS play "Hello" --speakers "Kitchen,Family Room"

# Different TTS voice
$SONOS play "Good morning" --voice af_nova
```

### Play Audio File

```bash
# Play an audio file on all speakers
$SONOS play --file ~/music/song.wav

# Play on specific speaker at specific volume
$SONOS play --file ~/music/alert.wav --speakers Kitchen --volume 70
```

**Note:** Sonos only supports common formats (WAV, MP3, etc). For Apple formats like CAF (voice memos, iMessage audio), convert first:

```bash
# Convert CAF to WAV using macOS afconvert
afconvert input.caf output.wav -d LEI16 -f WAVE

# Then play
$SONOS play --file output.wav
```

### List Speakers

```bash
$SONOS list
```

Output:
```
Available speakers:
  Basement Sonos: 10.10.10.53
  Bathroom: 10.10.10.47
  Family Room 2: 10.10.10.38
  Family Room: 10.10.10.152
  Kitchen: 10.10.10.162
```

### Check Status

```bash
$SONOS status
```

Output:
```
Basement Sonos: STOPPED (volume: 30)
Bathroom: STOPPED (volume: 25)
Family Room 2: STOPPED (volume: 40)
Family Room: PLAYING (volume: 35)
Kitchen: STOPPED (volume: 50)
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--volume` | 60 | Announcement volume (0-100) |
| `--speakers` | all | Comma-separated speaker names |
| `--voice` | bm_lewis | Kokoro TTS voice |
| `--file` | - | Audio file instead of TTS |

## TTS Voices

Available Kokoro voices:
- `bm_lewis` (default) - British male
- `af_nova` - American female
- `am_adam` - American male
- `bf_emma` - British female

## Speaker Names

Speaker names support partial, case-insensitive matching:

- `"Kitchen"` matches "Kitchen"
- `"family"` matches "Family Room" or "Family Room 2"
- `"base"` matches "Basement Sonos"
- `"Kitchen,Family Room"` matches multiple speakers

## How It Works

1. **Snapshots** current state of all speakers (volume, playback, position)
2. **Groups** all selected speakers together (for synchronized playback)
3. **Generates audio** via Kokoro TTS (if text) or uses provided file
4. **Serves audio** via local HTTP server
5. **Plays** announcement on grouped speakers
6. **Restores** all speakers to their previous state

## Examples

### Make a house-wide announcement
```bash
$SONOS play "Dinner is ready!"
```

### Kitchen-only alert
```bash
$SONOS play "Timer done" --speakers Kitchen --volume 70
```

### Play a sound file everywhere
```bash
$SONOS play --file ~/sounds/doorbell.wav
```

### Quiet morning announcement
```bash
$SONOS play "Good morning" --volume 40 --voice bf_emma
```

## Important: Audio Messages

**When a user sends an audio attachment (voice memo, iMessage audio), play the ACTUAL AUDIO FILE, not TTS of the transcription.** Only use TTS if the user explicitly asks for text-to-speech.

```bash
# User sends audio message → play the audio file
afconvert "/path/to/Audio Message.caf" /tmp/message.wav -d LEI16 -f WAVE
$SONOS play --file /tmp/message.wav --volume 75
```

## Technical Notes

- Uses curl for SOAP/UPnP calls (bypasses macOS Local Network permission issues)
- Groups speakers dynamically for synchronized playback
- Restores previous playback state after announcement
- HTTP server serves audio to Sonos speakers
- Hardcoded speaker IPs (from Sonos System Info)

## Legacy Scripts

The old `announce` script still works for backwards compatibility:

```bash
~/.claude/skills/sonos/scripts/announce "Hello world"
```

But prefer the new unified `sonos` CLI.
