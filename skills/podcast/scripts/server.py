#!/usr/bin/env python3
"""
Podcast feed server with ngrok tunnel.

Starts a local HTTP server and ngrok tunnel, then generates the RSS feed
with the public ngrok URL. The feed URL is saved to url.txt for easy access.
"""

import http.server
import socketserver
import subprocess
import threading
import time
import json
import signal
import sys
from pathlib import Path

PODCAST_DIR = Path.home() / "code" / "podcast-feed"
PORT = 8765
NGROK_API = "http://127.0.0.1:4040/api/tunnels"

# Store processes for cleanup
ngrok_process = None
httpd = None

def get_ngrok_url(retries=10, delay=1):
    """Get the public ngrok URL from the local API."""
    import urllib.request

    for i in range(retries):
        try:
            with urllib.request.urlopen(NGROK_API) as response:
                data = json.loads(response.read().decode())
                tunnels = data.get("tunnels", [])
                for tunnel in tunnels:
                    if tunnel.get("proto") == "https":
                        return tunnel.get("public_url")
        except Exception as e:
            if i < retries - 1:
                time.sleep(delay)
            continue
    return None

def start_ngrok():
    """Start ngrok tunnel."""
    global ngrok_process
    # Kill any existing ngrok
    subprocess.run(["pkill", "-f", "ngrok"], capture_output=True)
    time.sleep(1)

    ngrok_process = subprocess.Popen(
        ["ngrok", "http", str(PORT), "--log=stdout"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    return ngrok_process

def start_http_server():
    """Start the HTTP server."""
    global httpd

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(PODCAST_DIR), **kwargs)

        def log_message(self, format, *args):
            # Quieter logging
            pass

    httpd = socketserver.TCPServer(("", PORT), Handler)
    httpd.serve_forever()

def generate_feed(base_url):
    """Generate the RSS feed with the given base URL."""
    from generate_feed import generate_feed as gen
    gen(base_url)

def cleanup(signum=None, frame=None):
    """Clean up processes on exit."""
    global ngrok_process, httpd
    print("\nShutting down...")

    if ngrok_process:
        ngrok_process.terminate()
        ngrok_process.wait()

    if httpd:
        httpd.shutdown()

    sys.exit(0)

def main():
    global httpd

    # Set up signal handlers
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    print("Starting podcast feed server...")

    # Start ngrok
    print("Starting ngrok tunnel...")
    start_ngrok()

    # Wait for ngrok to be ready and get URL
    print("Waiting for ngrok URL...")
    ngrok_url = get_ngrok_url()

    if not ngrok_url:
        print("ERROR: Could not get ngrok URL. Is ngrok installed and authenticated?")
        cleanup()
        return

    print(f"Ngrok URL: {ngrok_url}")

    # Save URL to file
    url_file = PODCAST_DIR / "url.txt"
    url_file.write_text(ngrok_url)
    print(f"URL saved to: {url_file}")

    # Generate feed with ngrok URL
    print("Generating RSS feed...")
    sys.path.insert(0, str(PODCAST_DIR / "scripts"))
    generate_feed(ngrok_url)

    feed_url = f"{ngrok_url}/feed.xml"
    print(f"\n{'='*50}")
    print(f"Podcast feed URL (add to Apple Podcasts):")
    print(f"  {feed_url}")
    print(f"{'='*50}\n")

    # Start HTTP server in main thread
    print(f"Starting HTTP server on port {PORT}...")
    print("Press Ctrl+C to stop\n")

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(PODCAST_DIR), **kwargs)

        def log_message(self, format, *args):
            print(f"[HTTP] {args[0]}")

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()

if __name__ == "__main__":
    main()
