#!/usr/bin/env -S uv run --script
"""
Serve podcast files via HTTP with public tunnel.
Uses localhost.run for free tunneling (SSH-based, no install needed).
"""

import http.server
import os
import socketserver
import subprocess
import sys
import threading
from pathlib import Path

PODCAST_DIR = Path(__file__).parent.parent / "podcast"
PORT = 8765


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler that suppresses most logging."""
    
    def log_message(self, format, *args):
        # Only log actual requests, not every access
        if "GET" in format % args:
            print(f"  -> {args[0]}")
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PODCAST_DIR), **kwargs)


def start_server():
    """Start HTTP server in background."""
    with socketserver.TCPServer(("", PORT), QuietHandler) as httpd:
        print(f"Serving podcast at http://localhost:{PORT}")
        httpd.serve_forever()


def start_tunnel():
    """Start SSH tunnel to localhost.run."""
    print("Starting public tunnel...")
    print("(This creates a public URL for your podcast feed)\n")
    
    # localhost.run provides free SSH tunneling
    cmd = f"ssh -R 80:localhost:{PORT} localhost.run"
    
    process = subprocess.Popen(
        cmd,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    
    # Read output to get the public URL
    for line in process.stdout:
        print(line.strip())
        if "tunneled" in line.lower() or "https://" in line:
            # Extract URL
            if "https://" in line:
                parts = line.split()
                for part in parts:
                    if part.startswith("https://"):
                        url = part.strip()
                        print(f"\n{'='*50}")
                        print(f"PUBLIC PODCAST URL: {url}/feed.xml")
                        print(f"{'='*50}")
                        print("\nAdd this URL to Apple Podcasts:")
                        print("  1. Open Podcasts app")
                        print("  2. Library -> ... menu -> Follow a Show by URL")
                        print(f"  3. Paste: {url}/feed.xml")
                        print("\nPress Ctrl+C to stop serving.")
                        break


def main():
    # Ensure podcast directory exists
    PODCAST_DIR.mkdir(parents=True, exist_ok=True)
    (PODCAST_DIR / "episodes").mkdir(exist_ok=True)
    
    # Check if feed exists
    feed_file = PODCAST_DIR / "feed.xml"
    if not feed_file.exists():
        print("No feed.xml found. Creating empty feed...")
        # Create minimal feed
        feed_content = '''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Audio Articles</title>
    <description>Text articles and PDFs converted to audio</description>
    <language>en-us</language>
    <itunes:explicit>false</itunes:explicit>
  </channel>
</rss>'''
        feed_file.write_text(feed_content)
    
    # Start server in background thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # Start tunnel (blocks)
    try:
        start_tunnel()
    except KeyboardInterrupt:
        print("\nStopping server...")
        sys.exit(0)


if __name__ == "__main__":
    main()
