#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Test Signal integration without full daemon.

Usage: Set SIGNAL_ACCOUNT env var or pass as argument.
"""
import os
import sys
import time
import queue
import subprocess
from pathlib import Path

# Add assistant to path dynamically
ASSISTANT_DIR = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(ASSISTANT_DIR))

def main():
    account = os.environ.get("SIGNAL_ACCOUNT") or (sys.argv[1] if len(sys.argv) > 1 else None)
    if not account:
        print("Usage: SIGNAL_ACCOUNT=+1234567890 ./test-integration.py")
        print("   or: ./test-integration.py +1234567890")
        sys.exit(1)

    print(f"Testing Signal integration with account: {account}")

    # Import the SignalListener
    from assistant.manager import SignalListener, SIGNAL_SOCKET

    # Start signal daemon
    print("Starting signal-cli daemon...")
    proc = subprocess.Popen(
        ["/opt/homebrew/bin/signal-cli", "-a", account, "daemon", "--socket", "/tmp/signal-cli.sock"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Wait for socket
    for i in range(30):
        if SIGNAL_SOCKET.exists():
            print("Socket ready!")
            break
        time.sleep(0.1)
    else:
        print("ERROR: Socket not ready")
        proc.kill()
        return

    # Create queue and listener
    msg_queue = queue.Queue()
    listener = SignalListener(msg_queue)
    listener.start()
    print("Listener started, waiting for messages...")
    print(f"Send a Signal message to {account} to test")
    print("(Ctrl+C to stop)")

    try:
        while True:
            try:
                msg = msg_queue.get(timeout=1)
                print(f"\n=== RECEIVED MESSAGE ===")
                print(f"Source: {msg.get('source')}")
                print(f"Phone: {msg.get('phone')}")
                print(f"Text: {msg.get('text')}")
                print(f"Is Group: {msg.get('is_group')}")
                print(f"Chat ID: {msg.get('chat_identifier')}")
                print("========================\n")
            except queue.Empty:
                pass
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        listener.stop()
        proc.terminate()
        proc.wait()

if __name__ == "__main__":
    main()
