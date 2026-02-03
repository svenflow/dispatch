#!/bin/bash
# Install Chrome Control native messaging host

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.dispatch.chrome_control"

# Create native host manifest
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "Chrome Control Native Messaging Host",
  "path": "$SCRIPT_DIR/native_host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://*"
  ]
}
EOF

# Create launcher script
cat > "$SCRIPT_DIR/native_host" << EOF
#!/bin/bash
exec /usr/bin/python3 "$SCRIPT_DIR/native_host.py"
EOF

chmod +x "$SCRIPT_DIR/native_host"
chmod +x "$SCRIPT_DIR/native_host.py"

echo "Native messaging host installed!"
echo "Manifest: $MANIFEST_DIR/$HOST_NAME.json"
echo "Host: $SCRIPT_DIR/native_host"
echo ""
echo "Next steps:"
echo "1. Go to chrome://extensions/"
echo "2. Enable Developer Mode"
echo "3. Click 'Load unpacked' and select: $SCRIPT_DIR"
