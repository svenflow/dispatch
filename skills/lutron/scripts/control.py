#!/usr/bin/env -S uv run --script
"""
Lutron Caseta control script.
Usage:
    python3 control.py light <name> <on|off|0-100>
    python3 control.py shade <name> <open|close|0-100>
    python3 control.py room <room> <on|off>
    python3 control.py room-shades <room> <open|close>
    python3 control.py all-lights <on|off>
    python3 control.py list [room]
"""

import sys
import ssl
import json
import socket
import os

# Configuration
BRIDGE_IP = os.environ.get("LUTRON_BRIDGE_IP", "")  # Set via config.local.yaml lutron.bridge_ip
if not BRIDGE_IP:
    # Try loading from config.local.yaml
    _config_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "config.local.yaml")
    if os.path.exists(_config_path):
        import yaml
        with open(_config_path) as _f:
            _cfg = yaml.safe_load(_f) or {}
        BRIDGE_IP = (_cfg.get("lutron") or {}).get("bridge_ip", "")
    if not BRIDGE_IP:
        raise RuntimeError("LUTRON_BRIDGE_IP not set and config.local.yaml missing lutron.bridge_ip")
BRIDGE_PORT = 8081
CERT_DIR = os.path.expanduser("~/.config/pylutron_caseta")

# Device database (zone_id -> device info)
DEVICES = {
    # Lights/Dimmers
    1: {"name": "Main Lights 1", "room": "main Bedroom", "type": "light"},
    2: {"name": "Main Lights 2", "room": "main Bedroom", "type": "light"},
    3: {"name": "Main Lights", "room": "Living Room", "type": "light"},
    4: {"name": "Sink Lights", "room": "front Bathroom", "type": "light"},
    5: {"name": "hallway", "room": "main Bedroom", "type": "light"},
    21: {"name": "Deck Lights", "room": "Outside Patio", "type": "switch"},
    23: {"name": "Hallway", "room": "Master Bedroom", "type": "light"},
    24: {"name": "Cove Lights", "room": "Master Bedroom", "type": "light"},
    25: {"name": "Overhead", "room": "Master Bedroom", "type": "light"},
    26: {"name": "Bathroom Overhead", "room": "Master Bedroom", "type": "light"},
    27: {"name": "Bathroom Mirror", "room": "Master Bedroom", "type": "light"},
    28: {"name": "Closet", "room": "Master Bedroom", "type": "light"},
    29: {"name": "Bathroom Sconce", "room": "Master Bedroom", "type": "light"},
    # Shades
    7: {"name": "Shades 2 near stairs", "room": "Living Room", "type": "shade"},
    8: {"name": "Shades 1 near stairs", "room": "Living Room", "type": "shade"},
    9: {"name": "Shades 3 near piano", "room": "Living Room", "type": "shade"},
    10: {"name": "Shades 4 near piano", "room": "Living Room", "type": "shade"},
    11: {"name": "Shades 5 near projector", "room": "Living Room", "type": "shade"},
    12: {"name": "Shades 6 near projector", "room": "Living Room", "type": "shade"},
    13: {"name": "Shades 2 bathroom", "room": "front Bathroom", "type": "shade"},
    14: {"name": "Shades 1 bathroom", "room": "front Bathroom", "type": "shade"},
    16: {"name": "Shades 2 bedroom", "room": "Master Bedroom", "type": "shade"},
    17: {"name": "Shades 3 bedroom", "room": "Master Bedroom", "type": "shade"},
    18: {"name": "left shade", "room": "Guest Bedroom", "type": "shade"},
    19: {"name": "right shade", "room": "Guest Bedroom", "type": "shade"},
    20: {"name": "bed shade", "room": "Guest Bedroom", "type": "shade"},
}

def get_ssl_context():
    """Create SSL context with Lutron certificates."""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_cert_chain(
        certfile=os.path.join(CERT_DIR, f"{BRIDGE_IP}.crt"),
        keyfile=os.path.join(CERT_DIR, f"{BRIDGE_IP}.key")
    )
    context.load_verify_locations(
        cafile=os.path.join(CERT_DIR, f"{BRIDGE_IP}-bridge.crt")
    )
    return context

def send_command(zone_id, level):
    """Send a command to set zone level (0-100)."""
    context = get_ssl_context()

    command = {
        "CommuniqueType": "CreateRequest",
        "Header": {"Url": f"/zone/{zone_id}/commandprocessor"},
        "Body": {
            "Command": {
                "CommandType": "GoToLevel",
                "Parameter": [{"Type": "Level", "Value": level}]
            }
        }
    }

    import time
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10)
        ssl_sock = context.wrap_socket(sock, server_hostname=BRIDGE_IP)
        ssl_sock.connect((BRIDGE_IP, BRIDGE_PORT))

        msg = json.dumps(command) + "\r\n"
        ssl_sock.send(msg.encode())

        # Read responses (LEAP is async, may get multiple messages)
        ssl_sock.setblocking(False)
        time.sleep(0.5)

        responses = ""
        try:
            while True:
                data = ssl_sock.recv(4096).decode()
                if data:
                    responses += data
                else:
                    break
        except:
            pass

        ssl_sock.close()

        # Check for success (201 Created or 200 OK)
        return "201" in responses or "200 OK" in responses
    except Exception as e:
        print(f"Error: {e}")
        return False

def find_zone_by_name(name, device_type=None):
    """Find zone ID by device name (case-insensitive partial match)."""
    name_lower = name.lower()
    for zone_id, info in DEVICES.items():
        if name_lower in info["name"].lower():
            if device_type is None or info["type"] == device_type or (device_type == "light" and info["type"] == "switch"):
                return zone_id
    return None

def find_zones_by_room(room, device_type=None):
    """Find all zone IDs in a room."""
    room_lower = room.lower()
    zones = []
    for zone_id, info in DEVICES.items():
        if room_lower in info["room"].lower():
            if device_type is None or info["type"] == device_type or (device_type == "light" and info["type"] == "switch"):
                zones.append(zone_id)
    return zones

def parse_level(value, is_shade=False):
    """Parse level value from command argument."""
    if value.lower() in ["on", "open"]:
        return 100
    elif value.lower() in ["off", "close"]:
        return 0
    else:
        try:
            return max(0, min(100, int(value)))
        except ValueError:
            return None

def list_devices(room_filter=None):
    """List all devices, optionally filtered by room."""
    lights = []
    shades = []

    for zone_id, info in sorted(DEVICES.items()):
        if room_filter and room_filter.lower() not in info["room"].lower():
            continue

        entry = f"  - {info['name']} ({info['room']}) [zone {zone_id}]"
        if info["type"] in ["light", "switch"]:
            lights.append(entry)
        else:
            shades.append(entry)

    if lights:
        print("LIGHTS:")
        print("\n".join(lights))
    if shades:
        print("\nSHADES:")
        print("\n".join(shades))

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "list":
        room_filter = sys.argv[2] if len(sys.argv) > 2 else None
        list_devices(room_filter)
        return

    if command == "light" and len(sys.argv) >= 4:
        name = sys.argv[2]
        level = parse_level(sys.argv[3])
        zone_id = find_zone_by_name(name, "light")

        if zone_id is None:
            print(f"Light '{name}' not found")
            sys.exit(1)

        if send_command(zone_id, level):
            print(f"OK: {DEVICES[zone_id]['name']} -> {level}%")
        else:
            print("FAILED")
            sys.exit(1)

    elif command == "shade" and len(sys.argv) >= 4:
        name = sys.argv[2]
        level = parse_level(sys.argv[3], is_shade=True)
        zone_id = find_zone_by_name(name, "shade")

        if zone_id is None:
            print(f"Shade '{name}' not found")
            sys.exit(1)

        if send_command(zone_id, level):
            print(f"OK: {DEVICES[zone_id]['name']} -> {level}%")
        else:
            print("FAILED")
            sys.exit(1)

    elif command == "room" and len(sys.argv) >= 4:
        room = sys.argv[2]
        level = parse_level(sys.argv[3])
        zones = find_zones_by_room(room, "light")

        if not zones:
            print(f"No lights found in '{room}'")
            sys.exit(1)

        for zone_id in zones:
            if send_command(zone_id, level):
                print(f"OK: {DEVICES[zone_id]['name']} -> {level}%")
            else:
                print(f"FAILED: {DEVICES[zone_id]['name']}")

    elif command == "room-shades" and len(sys.argv) >= 4:
        room = sys.argv[2]
        level = parse_level(sys.argv[3], is_shade=True)
        zones = find_zones_by_room(room, "shade")

        if not zones:
            print(f"No shades found in '{room}'")
            sys.exit(1)

        for zone_id in zones:
            if send_command(zone_id, level):
                print(f"OK: {DEVICES[zone_id]['name']} -> {level}%")
            else:
                print(f"FAILED: {DEVICES[zone_id]['name']}")

    elif command == "all-lights" and len(sys.argv) >= 3:
        level = parse_level(sys.argv[2])
        zones = [z for z, i in DEVICES.items() if i["type"] in ["light", "switch"]]

        for zone_id in zones:
            if send_command(zone_id, level):
                print(f"OK: {DEVICES[zone_id]['name']} -> {level}%")
            else:
                print(f"FAILED: {DEVICES[zone_id]['name']}")

    else:
        print(__doc__)
        sys.exit(1)

if __name__ == "__main__":
    main()
