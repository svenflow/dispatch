#!/usr/bin/env python3
"""
Publish podcast episodes to GCS.

Uploads MP3s and updates the RSS feed on Google Cloud Storage.
"""

import subprocess
import sys
from pathlib import Path

PODCAST_DIR = Path.home() / "code" / "podcast-feed"
EPISODES_DIR = PODCAST_DIR / "episodes"
FEED_FILE = PODCAST_DIR / "feed.xml"
BUCKET = "gs://jsmith-podcast"
BASE_URL = "https://storage.googleapis.com/jsmith-podcast"

def run(cmd, check=True):
    """Run a shell command."""
    print(f"  $ {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"Error: {result.stderr}")
        return False
    if result.stdout.strip():
        print(result.stdout.strip())
    return True

def publish():
    """Publish all episodes to GCS."""
    print("Publishing podcast to GCS...")

    # Ensure episodes directory exists
    EPISODES_DIR.mkdir(parents=True, exist_ok=True)

    # Upload all MP3s
    mp3s = list(EPISODES_DIR.glob("*.mp3"))
    if mp3s:
        print(f"\nUploading {len(mp3s)} episode(s)...")
        for mp3 in mp3s:
            run(f'gcloud storage cp "{mp3}" {BUCKET}/episodes/{mp3.name}')
    else:
        print("\nNo episodes to upload yet.")

    # Generate feed with GCS URL
    print("\nGenerating RSS feed...")
    sys.path.insert(0, str(PODCAST_DIR / "scripts"))
    from generate_feed import generate_feed
    generate_feed(BASE_URL)

    # Upload feed
    print("\nUploading feed.xml...")
    run(f'gcloud storage cp "{FEED_FILE}" {BUCKET}/feed.xml')

    # Set content type for feed
    run(f'gcloud storage objects update {BUCKET}/feed.xml --content-type="application/rss+xml"')

    feed_url = f"{BASE_URL}/feed.xml"
    print(f"\n{'='*50}")
    print("Podcast published!")
    print(f"\nFeed URL (add to Apple Podcasts):")
    print(f"  {feed_url}")
    print(f"{'='*50}")

    return feed_url

def add_episode(mp3_path: str, title: str | None = None):
    """Add a single episode and publish."""
    mp3 = Path(mp3_path)
    if not mp3.exists():
        print(f"Error: File not found: {mp3_path}")
        return None

    # Copy to episodes directory
    dest = EPISODES_DIR / mp3.name
    if mp3 != dest:
        import shutil
        shutil.copy(mp3, dest)
        print(f"Copied {mp3.name} to episodes/")

    # Publish
    return publish()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Add specific episode
        add_episode(sys.argv[1])
    else:
        # Just publish current episodes
        publish()
