#!/usr/bin/env -S uv run --script
"""
Philips Hue control script.
Usage:
    python3 control.py on <light_name>
    python3 control.py off <light_name>
    python3 control.py brightness <light_name> <0-254>
    python3 control.py color <light_name> <hue 0-65535> <sat 0-254>
    python3 control.py list [bridge]
"""

import sys
import json
import os
import urllib.request
import urllib.error

# Load bridge configurations
CONFIG_DIR = os.path.expanduser("~/.hue")

BRIDGES = {}
for config_file in ["office.json", "home.json"]:
    config_path = os.path.join(CONFIG_DIR, config_file)
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)
            bridge_key = config_file.replace(".json", "")
            BRIDGES[bridge_key] = config

def get_all_lights():
    """Get all lights from all bridges."""
    all_lights = {}
    for bridge_key, config in BRIDGES.items():
        url = f"http://{config['bridge_ip']}/api/{config['username']}/lights"
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                lights = json.loads(response.read())
                for light_id, light in lights.items():
                    all_lights[f"{bridge_key}:{light_id}"] = {
                        "id": light_id,
                        "name": light["name"],
                        "bridge": bridge_key,
                        "bridge_ip": config["bridge_ip"],
                        "username": config["username"],
                        "state": light["state"]
                    }
        except Exception as e:
            print(f"Error connecting to {bridge_key}: {e}")
    return all_lights

def find_light(name):
    """Find a light by name (case-insensitive partial match)."""
    all_lights = get_all_lights()
    name_lower = name.lower()

    # First try exact match
    for key, light in all_lights.items():
        if light["name"].lower() == name_lower:
            return light

    # Then try partial match
    for key, light in all_lights.items():
        if name_lower in light["name"].lower():
            return light

    return None

def set_light_state(light, state):
    """Set the state of a light."""
    url = f"http://{light['bridge_ip']}/api/{light['username']}/lights/{light['id']}/state"
    data = json.dumps(state).encode()

    req = urllib.request.Request(url, data=data, method='PUT')
    req.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            result = json.loads(response.read())
            return any("success" in r for r in result)
    except Exception as e:
        print(f"Error: {e}")
        return False

def list_lights(bridge_filter=None):
    """List all lights."""
    all_lights = get_all_lights()

    by_bridge = {}
    for key, light in all_lights.items():
        bridge = light["bridge"]
        if bridge_filter and bridge_filter.lower() != bridge.lower():
            continue
        if bridge not in by_bridge:
            by_bridge[bridge] = []
        state = "ON" if light["state"]["on"] else "OFF"
        bri = light["state"].get("bri", "N/A")
        by_bridge[bridge].append(f"  {light['id']:>2}: {light['name']} [{state}] bri={bri}")

    for bridge, lights in sorted(by_bridge.items()):
        print(f"\n{bridge.upper()} BRIDGE ({BRIDGES[bridge]['bridge_name']}):")
        print("\n".join(sorted(lights, key=lambda x: int(x.split(":")[0].strip()))))

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "list":
        bridge_filter = sys.argv[2] if len(sys.argv) > 2 else None
        list_lights(bridge_filter)
        return

    if command == "on" and len(sys.argv) >= 3:
        name = " ".join(sys.argv[2:])
        light = find_light(name)
        if not light:
            print(f"Light '{name}' not found")
            sys.exit(1)
        if set_light_state(light, {"on": True}):
            print(f"OK: {light['name']} -> ON")
        else:
            print("FAILED")
            sys.exit(1)

    elif command == "off" and len(sys.argv) >= 3:
        name = " ".join(sys.argv[2:])
        light = find_light(name)
        if not light:
            print(f"Light '{name}' not found")
            sys.exit(1)
        if set_light_state(light, {"on": False}):
            print(f"OK: {light['name']} -> OFF")
        else:
            print("FAILED")
            sys.exit(1)

    elif command == "brightness" and len(sys.argv) >= 4:
        name = " ".join(sys.argv[2:-1])
        try:
            bri = max(0, min(254, int(sys.argv[-1])))
        except ValueError:
            print("Brightness must be 0-254")
            sys.exit(1)

        light = find_light(name)
        if not light:
            print(f"Light '{name}' not found")
            sys.exit(1)
        if set_light_state(light, {"on": True, "bri": bri}):
            print(f"OK: {light['name']} -> brightness {bri}")
        else:
            print("FAILED")
            sys.exit(1)

    elif command == "color" and len(sys.argv) >= 5:
        name = " ".join(sys.argv[2:-2])
        try:
            hue = max(0, min(65535, int(sys.argv[-2])))
            sat = max(0, min(254, int(sys.argv[-1])))
        except ValueError:
            print("Hue must be 0-65535, sat must be 0-254")
            sys.exit(1)

        light = find_light(name)
        if not light:
            print(f"Light '{name}' not found")
            sys.exit(1)
        if set_light_state(light, {"on": True, "hue": hue, "sat": sat}):
            print(f"OK: {light['name']} -> hue={hue} sat={sat}")
        else:
            print("FAILED")
            sys.exit(1)

    else:
        print(__doc__)
        sys.exit(1)

if __name__ == "__main__":
    main()
