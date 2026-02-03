#!/bin/bash
# Serve podcast files with ngrok tunnel

PODCAST_DIR="$HOME/.claude/skills/tts/podcast"
PORT=8765

# Ensure directories exist
mkdir -p "$PODCAST_DIR/episodes"

# Check if feed exists
if [ ! -f "$PODCAST_DIR/feed.xml" ]; then
    cat > "$PODCAST_DIR/feed.xml" << 'XML'
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Audio Articles</title>
    <description>Text articles and PDFs converted to audio</description>
    <language>en-us</language>
    <itunes:explicit>false</itunes:explicit>
  </channel>
</rss>
XML
fi

echo "Starting podcast server..."
echo "Podcast directory: $PODCAST_DIR"

# Start Python HTTP server in background
cd "$PODCAST_DIR"
python3 -m http.server $PORT &
SERVER_PID=$!
echo "HTTP server started (PID: $SERVER_PID)"

# Give server time to start
sleep 1

# Start ngrok tunnel
echo "Starting ngrok tunnel..."
ngrok http $PORT --log=stdout

# Cleanup on exit
kill $SERVER_PID 2>/dev/null
