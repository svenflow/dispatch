#!/usr/bin/env -S uv run --script
"""
Podcast RSS feed generator and manager.
Creates a private podcast feed for TTS-generated audio.
"""

import argparse
import json
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.dom import minidom

PODCAST_DIR = Path(__file__).parent.parent / "podcast"
EPISODES_FILE = PODCAST_DIR / "episodes.json"
FEED_FILE = PODCAST_DIR / "feed.xml"

# Podcast metadata
PODCAST_TITLE = os.environ.get("PODCAST_TITLE", "Audio Articles")
PODCAST_DESCRIPTION = "Text articles and PDFs converted to audio"
PODCAST_AUTHOR = "Dispatch TTS"
PODCAST_EMAIL = os.environ.get("PODCAST_EMAIL", "")
PODCAST_IMAGE = ""  # Optional: URL to podcast artwork


def load_episodes() -> list:
    """Load episodes from JSON file."""
    if EPISODES_FILE.exists():
        with open(EPISODES_FILE) as f:
            return json.load(f)
    return []


def save_episodes(episodes: list):
    """Save episodes to JSON file."""
    EPISODES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(EPISODES_FILE, "w") as f:
        json.dump(episodes, f, indent=2)


def add_episode(title: str, audio_path: str, description: str = "", base_url: str = "") -> dict:
    """Add a new episode to the podcast."""
    episodes = load_episodes()
    
    # Copy audio file to podcast directory
    audio_file = Path(audio_path)
    episode_id = str(uuid.uuid4())[:8]
    new_filename = f"{episode_id}_{audio_file.name}"
    dest_path = PODCAST_DIR / "episodes" / new_filename
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(audio_file, dest_path)
    
    # Get file size
    file_size = dest_path.stat().st_size
    
    episode = {
        "id": episode_id,
        "title": title,
        "description": description or title,
        "filename": new_filename,
        "file_size": file_size,
        "pub_date": datetime.now().isoformat(),
        "duration": "0:00",  # Would need ffprobe to get actual duration
    }
    
    episodes.insert(0, episode)  # Newest first
    save_episodes(episodes)
    
    # Regenerate feed
    if base_url:
        generate_feed(base_url)
    
    return episode


def generate_feed(base_url: str):
    """Generate podcast RSS feed XML."""
    episodes = load_episodes()
    
    # Create RSS structure
    rss = ET.Element("rss", {
        "version": "2.0",
        "xmlns:itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
        "xmlns:content": "http://purl.org/rss/1.0/modules/content/",
    })
    
    channel = ET.SubElement(rss, "channel")
    
    # Channel metadata
    ET.SubElement(channel, "title").text = PODCAST_TITLE
    ET.SubElement(channel, "description").text = PODCAST_DESCRIPTION
    ET.SubElement(channel, "language").text = "en-us"
    ET.SubElement(channel, "link").text = base_url
    ET.SubElement(channel, "{http://www.itunes.com/dtds/podcast-1.0.dtd}author").text = PODCAST_AUTHOR
    ET.SubElement(channel, "{http://www.itunes.com/dtds/podcast-1.0.dtd}explicit").text = "false"
    
    if PODCAST_IMAGE:
        image = ET.SubElement(channel, "{http://www.itunes.com/dtds/podcast-1.0.dtd}image", href=PODCAST_IMAGE)
    
    # Add episodes
    for ep in episodes:
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = ep["title"]
        ET.SubElement(item, "description").text = ep.get("description", "")
        
        # Parse and format date
        pub_date = datetime.fromisoformat(ep["pub_date"])
        ET.SubElement(item, "pubDate").text = pub_date.strftime("%a, %d %b %Y %H:%M:%S +0000")
        
        ET.SubElement(item, "guid", isPermaLink="false").text = ep["id"]
        
        # Audio enclosure
        audio_url = f"{base_url.rstrip('/')}/episodes/{ep['filename']}"
        ET.SubElement(item, "enclosure", {
            "url": audio_url,
            "length": str(ep.get("file_size", 0)),
            "type": "audio/mpeg",
        })
        
        ET.SubElement(item, "{http://www.itunes.com/dtds/podcast-1.0.dtd}duration").text = ep.get("duration", "0:00")
    
    # Pretty print XML
    xml_str = ET.tostring(rss, encoding="unicode")
    dom = minidom.parseString(xml_str)
    pretty_xml = dom.toprettyxml(indent="  ")
    # Remove extra blank lines
    lines = [line for line in pretty_xml.split('\n') if line.strip()]
    pretty_xml = '\n'.join(lines)
    
    with open(FEED_FILE, "w") as f:
        f.write(pretty_xml)
    
    print(f"Feed generated: {FEED_FILE}")
    return FEED_FILE


def list_episodes():
    """List all episodes."""
    episodes = load_episodes()
    for i, ep in enumerate(episodes):
        print(f"{i+1}. [{ep['id']}] {ep['title']} ({ep['pub_date'][:10]})")


def main():
    parser = argparse.ArgumentParser(description="Podcast RSS manager")
    subparsers = parser.add_subparsers(dest="command")
    
    # Add episode
    add_parser = subparsers.add_parser("add", help="Add new episode")
    add_parser.add_argument("title", help="Episode title")
    add_parser.add_argument("audio", help="Path to audio file")
    add_parser.add_argument("--desc", default="", help="Episode description")
    add_parser.add_argument("--url", default="", help="Base URL for feed")
    
    # Generate feed
    gen_parser = subparsers.add_parser("generate", help="Generate RSS feed")
    gen_parser.add_argument("url", help="Base URL for hosting")
    
    # List episodes
    subparsers.add_parser("list", help="List episodes")
    
    args = parser.parse_args()
    
    if args.command == "add":
        ep = add_episode(args.title, args.audio, args.desc, args.url)
        print(f"Added episode: {ep['title']} ({ep['id']})")
    elif args.command == "generate":
        generate_feed(args.url)
    elif args.command == "list":
        list_episodes()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
