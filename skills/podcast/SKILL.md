---
name: podcast
description: Manage the Dispatch Podcast feed on GCS. Use when asked to publish podcast episodes, update the feed, or manage podcast content.
allowed-tools: Bash(gsutil:*), Bash(uv:*), Bash(curl:*)
---

# Dispatch Podcast Management

Private podcast feed hosted on Google Cloud Storage. Add it to Apple Podcasts or any podcast app.

## Feed URLs

**RSS Feed (for adding to podcast apps):**
```
https://storage.googleapis.com/YOUR-PODCAST-BUCKET/podcast.xml
```

**Spotify Show:**
```
https://open.spotify.com/show/02AHAA8OkEGu3Sv
```

**Spotify Episode Link Format:**
```
https://open.spotify.com/episode/<episode_id>
```
Episodes sync automatically from the RSS feed (usually within 2 hours, max 24 hours).

## One-Time Setup: Spotify for Podcasters

**This was already done once. Only needed if creating a new podcast feed.**

To submit the RSS feed to Spotify:

1. Go to [Spotify for Podcasters](https://creators.spotify.com)
2. Log in with Spotify account
3. Select "I already have a podcast"
4. Paste the RSS feed URL: `https://storage.googleapis.com/YOUR-PODCAST-BUCKET/podcast.xml`
5. Verify ownership via email code (sent to the email in the RSS feed's `itunes:owner` field)
6. Add category, language, and country details
7. Submit

**Requirements:**
- At least one episode published in the feed
- Audio must be MP3 format (96-320 kbps)
- RSS feed must have valid email in `itunes:owner` tag

**Timeline:**
- Usually shows up in a few hours, max 5 days
- Once submitted, Spotify automatically checks the RSS feed for new episodes

After setup, Spotify pulls episodes automatically from the GCS bucket whenever the RSS feed is updated.

## Adding to Apple Podcasts

1. Open Apple Podcasts app
2. Go to Library tab
3. Tap the menu (three dots or "..." in top right)
4. Select "Add Show by URL" or "Follow a Show by URL"
5. Paste the feed URL above
6. The podcast "Dispatch Podcast" should appear

## Publishing a New Episode

### Step 1: Convert Document to Podcast Script

**IMPORTANT:** Always convert documents to a natural spoken script first. Raw text with markdown, tables, and special characters sounds terrible when read by TTS.

```bash
# Convert document to natural spoken script
cd ~/.claude/skills/tts && uv run python scripts/to_podcast_script.py --file /path/to/document.txt -o /tmp/script.txt

# For docx files, extract text first with pandoc
pandoc /path/to/document.docx -t plain -o /tmp/raw.txt
cd ~/.claude/skills/tts && uv run python scripts/to_podcast_script.py --file /tmp/raw.txt -o /tmp/script.txt
```

This uses Gemini to rewrite the content as a natural monologue:
- Converts tables to flowing prose
- Removes all markdown and special characters
- Adds conversational transitions
- Makes numbers speakable ("$100 to $250 per hour" not "$100-250/hr")

### Step 2: Create Audio Content

Use the TTS skill to convert the script to audio:

```bash
# From the processed script
cd ~/.claude/skills/tts && uv run python scripts/tts.py --file /tmp/script.txt -o /tmp/episode.mp3
```

### Step 2: Upload Audio to GCS

```bash
# Upload with proper headers
gsutil -h "Content-Type:audio/mpeg" -h "Cache-Control:public, max-age=86400" \
  cp /tmp/episode.mp3 gs://YOUR-PODCAST-BUCKET/episodes/episode-name.mp3

# Make it publicly readable
gsutil acl ch -u AllUsers:R gs://YOUR-PODCAST-BUCKET/episodes/episode-name.mp3
```

### Step 3: Get File Size and Duration

```bash
# Get file size in bytes
ls -la /tmp/episode.mp3 | awk '{print $5}'

# Get duration in seconds (for itunes:duration)
afinfo /tmp/episode.mp3 | grep duration
# Returns: "estimated duration: 1102.920000 sec" - use integer part
```

### Step 4: Update the Feed XML

Download current feed, add new episode, and re-upload:

```bash
# Download current feed
gsutil cat gs://YOUR-PODCAST-BUCKET/podcast.xml > /tmp/podcast.xml

# Edit /tmp/podcast.xml to add new <item> (see XML Structure below)

# Upload updated feed
gsutil -h "Content-Type:application/rss+xml" \
  -h "Cache-Control:no-cache, no-store, max-age=0" \
  cp /tmp/podcast.xml gs://YOUR-PODCAST-BUCKET/podcast.xml
```

## XML Structure

### Full Feed Template

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Dispatch Podcast</title>
    <description>Private podcast feed for audio content</description>
    <link>https://storage.googleapis.com/YOUR-PODCAST-BUCKET</link>
    <atom:link href="https://storage.googleapis.com/YOUR-PODCAST-BUCKET/podcast.xml" rel="self" type="application/rss+xml"/>
    <language>en-us</language>
    <itunes:author>Dispatch</itunes:author>
    <itunes:owner>
      <itunes:name>Dispatch</itunes:name>
      <itunes:email>YOUR_EMAIL</itunes:email>  <!-- from config.local.yaml podcast.email -->
    </itunes:owner>
    <itunes:category text="Technology"/>
    <itunes:explicit>false</itunes:explicit>
    <itunes:image href="https://storage.googleapis.com/YOUR-PODCAST-BUCKET/artwork.png"/>

    <!-- Episodes go here, newest first -->
    <item>
      <title>Episode Title</title>
      <description>Episode description here.</description>
      <enclosure url="https://storage.googleapis.com/YOUR-PODCAST-BUCKET/episodes/filename.mp3" length="FILE_SIZE_BYTES" type="audio/mpeg"/>
      <guid>https://storage.googleapis.com/YOUR-PODCAST-BUCKET/episodes/filename.mp3</guid>
      <pubDate>DAY, DD MON YYYY HH:MM:SS -0500</pubDate>
      <itunes:duration>SECONDS</itunes:duration>
    </item>

  </channel>
</rss>
```

### Episode Item Template

Add new episodes at the TOP of the item list (before older episodes):

```xml
<item>
  <title>Episode Title</title>
  <description>Episode description.</description>
  <enclosure url="https://storage.googleapis.com/YOUR-PODCAST-BUCKET/episodes/FILENAME.mp3" length="FILE_SIZE_IN_BYTES" type="audio/mpeg"/>
  <guid>https://storage.googleapis.com/YOUR-PODCAST-BUCKET/episodes/FILENAME.mp3</guid>
  <pubDate>Sat, 25 Jan 2026 14:20:00 -0500</pubDate>
  <itunes:duration>DURATION_IN_SECONDS</itunes:duration>
</item>
```

**Required fields:**
- `title`: Episode name
- `description`: Short summary
- `enclosure url`: Full URL to MP3 file
- `enclosure length`: File size in bytes (use `ls -la` to get)
- `enclosure type`: Always `audio/mpeg`
- `guid`: Unique ID (use the MP3 URL)
- `pubDate`: RFC 2822 format date (e.g., "Sat, 25 Jan 2026 14:20:00 -0500")
- `itunes:duration`: Length in seconds

## Bucket Contents

```
gs://YOUR-PODCAST-BUCKET/
├── podcast.xml          # The RSS feed
├── artwork.png          # Cover art (1500x1500)
└── episodes/
    └── *.mp3            # Audio files
```

## Listing Current Episodes

```bash
gsutil ls gs://YOUR-PODCAST-BUCKET/episodes/
```

## Viewing Current Feed

```bash
curl -s https://storage.googleapis.com/YOUR-PODCAST-BUCKET/podcast.xml
```

## Updating Cover Art

1. Generate new image (1400x1400 minimum, 3000x3000 max):
   ```bash
   cd ~/code/nano-banana && uv run python main.py "your prompt" -o /tmp/cover.png
   ```

2. Resize if needed:
   ```bash
   sips -z 1500 1500 /tmp/cover.png --out /tmp/cover-resized.png
   ```

3. Upload:
   ```bash
   gsutil -h "Content-Type:image/png" -h "Cache-Control:no-cache" \
     cp /tmp/cover-resized.png gs://YOUR-PODCAST-BUCKET/artwork.png
   gsutil acl ch -u AllUsers:R gs://YOUR-PODCAST-BUCKET/artwork.png
   ```

## Troubleshooting

### Feed not updating in podcast app
- GCS caches aggressively - use `Cache-Control:no-cache, no-store` headers
- Podcast apps also cache - may need to remove and re-add the podcast
- Check the feed directly: `curl -s https://storage.googleapis.com/YOUR-PODCAST-BUCKET/podcast.xml`

### Image not updating
- Create new image with different filename to bypass cache
- Update `itunes:image` href in the feed XML

### Apple Podcasts requirements
- Cover art: 1400x1400 to 3000x3000 pixels, JPEG or PNG
- Audio: MP3 format recommended
- Feed must be valid RSS 2.0 with iTunes namespace

### Spotify requirements
- **itunes:owner with email is REQUIRED** - Spotify will reject feeds without it
- Submit at: https://creators.spotify.com → "Find an existing show" → "Somewhere else" → paste RSS URL
- Verification email sent to the itunes:email address
- Takes a few hours to appear after submission

## Companion: PDF Generation

When publishing podcast episodes, you often want a PDF companion. Use Chrome headless mode (macOS native, no dependencies):

```bash
# Convert markdown to HTML first
pandoc /path/to/document.md -o /tmp/report.html --standalone --metadata title="Document Title"

# Then convert HTML to PDF using Chrome headless
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless --disable-gpu \
  --print-to-pdf=/tmp/output.pdf \
  /tmp/report.html
```

**Why Chrome headless?**
- No external dependencies (weasyprint needs libgobject, pandoc needs LaTeX)
- Produces clean, professional PDFs
- Handles CSS styling properly
- Already installed on the system
