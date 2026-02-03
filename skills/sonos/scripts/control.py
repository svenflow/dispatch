#!/usr/bin/env -S uv run --script
"""
Sonos control script using SoCo library (UPnP-based local control).

Usage:
    uv run control.py list                           # List all speakers
    uv run control.py status [speaker]               # Get status (all or specific)
    uv run control.py play [speaker]                 # Start playback
    uv run control.py pause [speaker]                # Pause playback
    uv run control.py stop [speaker]                 # Stop playback
    uv run control.py next [speaker]                 # Next track
    uv run control.py prev [speaker]                 # Previous track
    uv run control.py volume [speaker] [level]       # Set volume (0-100) or get current
    uv run control.py mute [speaker]                 # Toggle mute
    uv run control.py unmute [speaker]               # Unmute
    uv run control.py group [coordinator] [member]   # Add member to coordinator's group
    uv run control.py ungroup [speaker]              # Remove speaker from group
    uv run control.py playuri [speaker] [uri]        # Play a URI
    uv run control.py say [speaker] "text"           # Text to speech (uses Google TTS)

EQ Commands:
    uv run control.py eq [speaker]                   # Show all EQ settings
    uv run control.py bass [speaker] [level]         # Get/set bass (-10 to +10)
    uv run control.py treble [speaker] [level]       # Get/set treble (-10 to +10)
    uv run control.py loudness [speaker] [on|off]    # Get/set loudness compensation
    uv run control.py nightmode [speaker] [on|off]   # Get/set night mode (soundbars)
    uv run control.py dialog [speaker] [on|off]      # Get/set dialog/speech enhance (soundbars)
    uv run control.py subgain [speaker] [level]      # Get/set subwoofer gain (-15 to +15)
"""

import sys
import warnings
warnings.filterwarnings("ignore")

import soco
from soco.discovery import by_name

def find_speaker(name: str):
    """Find speaker by name (case-insensitive partial match)."""
    speakers = list(soco.discover(timeout=3))
    name_lower = name.lower()

    # Exact match first
    for speaker in speakers:
        if speaker.player_name.lower() == name_lower:
            return speaker

    # Partial match
    for speaker in speakers:
        if name_lower in speaker.player_name.lower():
            return speaker

    return None

def list_speakers():
    """List all Sonos speakers on the network."""
    speakers = list(soco.discover(timeout=5))
    if not speakers:
        print("No Sonos speakers found")
        return

    print(f"Found {len(speakers)} speaker(s):\n")
    for speaker in sorted(speakers, key=lambda s: s.player_name):
        info = speaker.get_speaker_info()
        transport = speaker.get_current_transport_info()
        state = transport['current_transport_state']

        # Get group info
        group_members = [m.player_name for m in speaker.group.members if m != speaker]
        group_info = f" (grouped with: {', '.join(group_members)})" if group_members else ""

        print(f"  {speaker.player_name}")
        print(f"    IP: {speaker.ip_address}")
        print(f"    Model: {info.get('model_name', 'Unknown')}")
        print(f"    Volume: {speaker.volume}% | State: {state}{group_info}")
        print()

def get_status(name: str = None):
    """Get status of speaker(s)."""
    if name:
        speaker = find_speaker(name)
        if not speaker:
            print(f"Speaker '{name}' not found")
            return
        speakers = [speaker]
    else:
        speakers = list(soco.discover(timeout=3))

    for speaker in speakers:
        info = speaker.get_speaker_info()
        transport = speaker.get_current_transport_info()
        track = speaker.get_current_track_info()

        print(f"\n=== {speaker.player_name} ===")
        print(f"  Model: {info.get('model_name', 'Unknown')}")
        print(f"  IP: {speaker.ip_address}")
        print(f"  Volume: {speaker.volume}%")
        print(f"  Muted: {speaker.mute}")
        print(f"  State: {transport['current_transport_state']}")

        if track.get('title'):
            print(f"  Now Playing:")
            print(f"    Artist: {track.get('artist', 'Unknown')}")
            print(f"    Title: {track.get('title', 'Unknown')}")
            print(f"    Album: {track.get('album', 'Unknown')}")
            if track.get('position') and track.get('duration'):
                print(f"    Position: {track['position']} / {track['duration']}")

def control_playback(name: str, action: str):
    """Control playback on a speaker."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    # Get coordinator for group operations
    coordinator = speaker.group.coordinator

    if action == 'play':
        coordinator.play()
        print(f"Playing on {coordinator.player_name}")
    elif action == 'pause':
        coordinator.pause()
        print(f"Paused {coordinator.player_name}")
    elif action == 'stop':
        coordinator.stop()
        print(f"Stopped {coordinator.player_name}")
    elif action == 'next':
        coordinator.next()
        print(f"Skipped to next track on {coordinator.player_name}")
    elif action == 'prev':
        coordinator.previous()
        print(f"Skipped to previous track on {coordinator.player_name}")

def set_volume(name: str, level: int = None):
    """Set or get volume."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    if level is not None:
        level = max(0, min(100, level))
        speaker.volume = level
        print(f"Set {speaker.player_name} volume to {level}%")
    else:
        print(f"{speaker.player_name} volume: {speaker.volume}%")

def set_mute(name: str, mute: bool):
    """Mute or unmute speaker."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    speaker.mute = mute
    print(f"{'Muted' if mute else 'Unmuted'} {speaker.player_name}")

def group_speakers(coordinator_name: str, member_name: str):
    """Add a speaker to another speaker's group."""
    coordinator = find_speaker(coordinator_name)
    member = find_speaker(member_name)

    if not coordinator:
        print(f"Coordinator '{coordinator_name}' not found")
        return
    if not member:
        print(f"Member '{member_name}' not found")
        return

    member.join(coordinator)
    print(f"Added {member.player_name} to {coordinator.player_name}'s group")

def ungroup_speaker(name: str):
    """Remove a speaker from its group."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    speaker.unjoin()
    print(f"Removed {speaker.player_name} from group")

def play_uri(name: str, uri: str):
    """Play a URI on a speaker."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    coordinator = speaker.group.coordinator
    coordinator.play_uri(uri)
    print(f"Playing {uri} on {coordinator.player_name}")

def say(name: str, text: str, lang: str = 'en'):
    """Text to speech using Google TTS."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    # Save current state
    current_volume = speaker.volume
    transport = speaker.get_current_transport_info()
    was_playing = transport['current_transport_state'] == 'PLAYING'

    # Play TTS at reasonable volume
    speaker.volume = min(current_volume, 50)

    try:
        # SoCo has built-in Google TTS support
        speaker.play_uri(
            f"https://translate.google.com/translate_tts?ie=UTF-8&q={text}&tl={lang}&client=tw-ob",
            force_radio=True
        )
        import time
        time.sleep(len(text) * 0.1 + 1)  # Rough estimate of speech duration
    finally:
        speaker.volume = current_volume

    print(f"Said '{text}' on {speaker.player_name}")

def get_eq(name: str):
    """Get all EQ settings for a speaker."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    print(f"\n=== EQ Settings for {speaker.player_name} ===")
    print(f"  Bass: {speaker.bass} (-10 to +10)")
    print(f"  Treble: {speaker.treble} (-10 to +10)")
    print(f"  Loudness: {'On' if speaker.loudness else 'Off'}")

    # Soundbar-specific settings
    try:
        print(f"  Night Mode: {'On' if speaker.night_mode else 'Off'}")
    except:
        pass

    try:
        dialog = speaker.dialog_mode or speaker.speech_enhance_enabled
        print(f"  Dialog/Speech Enhance: {'On' if dialog else 'Off'}")
    except:
        pass

    # Subwoofer settings
    try:
        if speaker.has_subwoofer:
            print(f"  Subwoofer: {'Enabled' if speaker.sub_enabled else 'Disabled'}")
            print(f"  Sub Gain: {speaker.sub_gain} (-15 to +15)")
    except:
        pass

def set_bass(name: str, level: int = None):
    """Get or set bass level (-10 to +10)."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    if level is not None:
        level = max(-10, min(10, level))
        speaker.bass = level
        print(f"Set {speaker.player_name} bass to {level}")
    else:
        print(f"{speaker.player_name} bass: {speaker.bass}")

def set_treble(name: str, level: int = None):
    """Get or set treble level (-10 to +10)."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    if level is not None:
        level = max(-10, min(10, level))
        speaker.treble = level
        print(f"Set {speaker.player_name} treble to {level}")
    else:
        print(f"{speaker.player_name} treble: {speaker.treble}")

def set_loudness(name: str, enabled: bool = None):
    """Get or set loudness compensation."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    if enabled is not None:
        speaker.loudness = enabled
        print(f"{'Enabled' if enabled else 'Disabled'} loudness on {speaker.player_name}")
    else:
        print(f"{speaker.player_name} loudness: {'On' if speaker.loudness else 'Off'}")

def set_night_mode(name: str, enabled: bool = None):
    """Get or set night mode (soundbars only)."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    try:
        if enabled is not None:
            speaker.night_mode = enabled
            print(f"{'Enabled' if enabled else 'Disabled'} night mode on {speaker.player_name}")
        else:
            print(f"{speaker.player_name} night mode: {'On' if speaker.night_mode else 'Off'}")
    except Exception as e:
        print(f"Night mode not supported on {speaker.player_name}")

def set_dialog_mode(name: str, enabled: bool = None):
    """Get or set dialog/speech enhancement (soundbars only)."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    try:
        if enabled is not None:
            # Try both methods
            try:
                speaker.dialog_mode = enabled
            except:
                speaker.speech_enhance_enabled = enabled
            print(f"{'Enabled' if enabled else 'Disabled'} dialog enhancement on {speaker.player_name}")
        else:
            try:
                dialog = speaker.dialog_mode
            except:
                dialog = speaker.speech_enhance_enabled
            print(f"{speaker.player_name} dialog enhancement: {'On' if dialog else 'Off'}")
    except Exception as e:
        print(f"Dialog enhancement not supported on {speaker.player_name}")

def set_sub_gain(name: str, level: int = None):
    """Get or set subwoofer gain (-15 to +15)."""
    speaker = find_speaker(name)
    if not speaker:
        print(f"Speaker '{name}' not found")
        return

    try:
        if not speaker.has_subwoofer:
            print(f"{speaker.player_name} does not have a subwoofer")
            return

        if level is not None:
            level = max(-15, min(15, level))
            speaker.sub_gain = level
            print(f"Set {speaker.player_name} sub gain to {level}")
        else:
            print(f"{speaker.player_name} sub gain: {speaker.sub_gain}")
    except Exception as e:
        print(f"Subwoofer control not available on {speaker.player_name}")

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    command = sys.argv[1].lower()

    if command == 'list':
        list_speakers()

    elif command == 'status':
        name = sys.argv[2] if len(sys.argv) > 2 else None
        get_status(name)

    elif command in ('play', 'pause', 'stop', 'next', 'prev'):
        if len(sys.argv) < 3:
            print(f"Usage: control.py {command} <speaker_name>")
            return
        control_playback(sys.argv[2], command)

    elif command == 'volume':
        if len(sys.argv) < 3:
            print("Usage: control.py volume <speaker_name> [level]")
            return
        name = sys.argv[2]
        level = int(sys.argv[3]) if len(sys.argv) > 3 else None
        set_volume(name, level)

    elif command == 'mute':
        if len(sys.argv) < 3:
            print("Usage: control.py mute <speaker_name>")
            return
        set_mute(sys.argv[2], True)

    elif command == 'unmute':
        if len(sys.argv) < 3:
            print("Usage: control.py unmute <speaker_name>")
            return
        set_mute(sys.argv[2], False)

    elif command == 'group':
        if len(sys.argv) < 4:
            print("Usage: control.py group <coordinator> <member>")
            return
        group_speakers(sys.argv[2], sys.argv[3])

    elif command == 'ungroup':
        if len(sys.argv) < 3:
            print("Usage: control.py ungroup <speaker_name>")
            return
        ungroup_speaker(sys.argv[2])

    elif command == 'playuri':
        if len(sys.argv) < 4:
            print("Usage: control.py playuri <speaker_name> <uri>")
            return
        play_uri(sys.argv[2], sys.argv[3])

    elif command == 'say':
        if len(sys.argv) < 4:
            print("Usage: control.py say <speaker_name> \"text to say\"")
            return
        say(sys.argv[2], ' '.join(sys.argv[3:]))

    elif command == 'eq':
        if len(sys.argv) < 3:
            print("Usage: control.py eq <speaker_name>")
            return
        get_eq(sys.argv[2])

    elif command == 'bass':
        if len(sys.argv) < 3:
            print("Usage: control.py bass <speaker_name> [level]")
            return
        name = sys.argv[2]
        level = int(sys.argv[3]) if len(sys.argv) > 3 else None
        set_bass(name, level)

    elif command == 'treble':
        if len(sys.argv) < 3:
            print("Usage: control.py treble <speaker_name> [level]")
            return
        name = sys.argv[2]
        level = int(sys.argv[3]) if len(sys.argv) > 3 else None
        set_treble(name, level)

    elif command == 'loudness':
        if len(sys.argv) < 3:
            print("Usage: control.py loudness <speaker_name> [on|off]")
            return
        name = sys.argv[2]
        if len(sys.argv) > 3:
            enabled = sys.argv[3].lower() in ('on', 'true', '1', 'yes')
            set_loudness(name, enabled)
        else:
            set_loudness(name)

    elif command == 'nightmode':
        if len(sys.argv) < 3:
            print("Usage: control.py nightmode <speaker_name> [on|off]")
            return
        name = sys.argv[2]
        if len(sys.argv) > 3:
            enabled = sys.argv[3].lower() in ('on', 'true', '1', 'yes')
            set_night_mode(name, enabled)
        else:
            set_night_mode(name)

    elif command == 'dialog':
        if len(sys.argv) < 3:
            print("Usage: control.py dialog <speaker_name> [on|off]")
            return
        name = sys.argv[2]
        if len(sys.argv) > 3:
            enabled = sys.argv[3].lower() in ('on', 'true', '1', 'yes')
            set_dialog_mode(name, enabled)
        else:
            set_dialog_mode(name)

    elif command == 'subgain':
        if len(sys.argv) < 3:
            print("Usage: control.py subgain <speaker_name> [level]")
            return
        name = sys.argv[2]
        level = int(sys.argv[3]) if len(sys.argv) > 3 else None
        set_sub_gain(name, level)

    else:
        print(f"Unknown command: {command}")
        print(__doc__)

if __name__ == '__main__':
    main()
