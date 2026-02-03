#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Signal listener - connects to signal-cli daemon and prints incoming messages.
Usage: ./signal-listener.py

This derisks the push-based message receiving from signal-cli daemon.
"""

import socket
import json
import sys

SOCKET_PATH = "/tmp/signal-cli.sock"

def main():
    print(f"Connecting to {SOCKET_PATH}...")

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(SOCKET_PATH)
    print("Connected! Listening for messages (Ctrl+C to stop)...\n")

    # Subscribe to receive messages
    subscribe_req = json.dumps({
        "jsonrpc": "2.0",
        "method": "subscribeReceive",
        "id": 1,
        "params": {}
    }) + "\n"
    sock.sendall(subscribe_req.encode())

    # Read the subscription confirmation
    buffer = b""
    while True:
        chunk = sock.recv(4096)
        if not chunk:
            print("Connection closed")
            break
        buffer += chunk

        # Process complete JSON lines
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            if not line.strip():
                continue

            try:
                msg = json.loads(line.decode())

                # Check if it's a message notification
                if msg.get("method") == "receive":
                    params = msg.get("params", {})
                    envelope = params.get("envelope", {})

                    source = envelope.get("sourceNumber") or envelope.get("sourceName") or "unknown"
                    data_msg = envelope.get("dataMessage", {})
                    body = data_msg.get("message", "")
                    timestamp = data_msg.get("timestamp", "")
                    group_info = data_msg.get("groupInfo", {})

                    if group_info:
                        group_id = group_info.get("groupId", "")
                        print(f"[GROUP {group_id[:20]}...] {source}: {body}")
                    elif body:
                        print(f"[DM] {source}: {body}")
                    else:
                        # Could be receipt, typing indicator, etc.
                        print(f"[OTHER] {json.dumps(msg, indent=2)[:200]}")
                else:
                    # Response to our subscribe request or other
                    print(f"[RESPONSE] {json.dumps(msg)[:200]}")

            except json.JSONDecodeError as e:
                print(f"[ERROR] Invalid JSON: {e}")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
