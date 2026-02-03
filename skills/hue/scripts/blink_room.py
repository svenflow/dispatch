#!/usr/bin/env -S uv run --script
"""
Blink a Hue room/group - turns off, waits, turns back on.
Usage: python3 blink_room.py <room_name> [delay_seconds]
"""

import sys
import json
import os
import time
import urllib.request

CONFIG_DIR = os.path.expanduser("~/.hue")

# Load bridge configs
BRIDGES = {}
for config_file in ["office.json", "home.json"]:
    config_path = os.path.join(CONFIG_DIR, config_file)
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)
            BRIDGES[config_file.replace(".json", "")] = config

def get_all_groups():
    """Get all groups from all bridges."""
    all_groups = {}
    for bridge_key, config in BRIDGES.items():
        url = f"http://{config['bridge_ip']}/api/{config['username']}/groups"
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                groups = json.loads(response.read())
                for group_id, group in groups.items():
                    all_groups[f"{bridge_key}:{group_id}"] = {
                        "id": group_id,
                        "name": group["name"],
                        "type": group["type"],
                        "lights": group["lights"],
                        "bridge": bridge_key,
                        "bridge_ip": config["bridge_ip"],
                        "username": config["username"]
                    }
        except Exception as e:
            print(f"Error connecting to {bridge_key}: {e}")
    return all_groups

def find_group(name):
    """Find a group by name."""
    all_groups = get_all_groups()
    name_lower = name.lower()

    for key, group in all_groups.items():
        if group["name"].lower() == name_lower:
            return group

    for key, group in all_groups.items():
        if name_lower in group["name"].lower():
            return group

    return None

def set_group_state(group, state):
    """Set state for a group."""
    url = f"http://{group['bridge_ip']}/api/{group['username']}/groups/{group['id']}/action"
    data = json.dumps(state).encode()

    req = urllib.request.Request(url, data=data, method='PUT')
    req.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return True
    except Exception as e:
        print(f"Error: {e}")
        return False

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nAvailable rooms:")
        for key, group in sorted(get_all_groups().items()):
            print(f"  - {group['name']} ({group['bridge']})")
        sys.exit(1)

    room_name = sys.argv[1]
    delay = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0

    group = find_group(room_name)
    if not group:
        print(f"Room '{room_name}' not found")
        sys.exit(1)

    print(f"Blinking {group['name']}...")

    # Turn off
    set_group_state(group, {"on": False})
    print("  OFF")

    # Wait
    time.sleep(delay)

    # Turn on
    set_group_state(group, {"on": True})
    print("  ON")

    print("Done!")

if __name__ == "__main__":
    main()
