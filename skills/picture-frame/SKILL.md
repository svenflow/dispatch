---
name: picture-frame
description: Control Bloomin8 e-ink picture frame - upload photos, show images, check status, wake via Bluetooth. Trigger words - bloomin8, eink frame, picture frame, photo frame.
---

# Bloomin8 E-Ink Picture Frame

Control the Bloomin8 color e-ink display on the local network.

## Device Info

- **IP Address**: `config.local.yaml` → `bloomin8.ip` (DHCP reserved via WiFi MAC)
- **WiFi MAC**: 10:B4:1D:CA:57:A0
- **BT MAC**: F4:90:32:19:2F:50
- **Screen**: 1200x1600 (portrait) or 1600x1200 (landscape when rotated)
- **Model**: EL133UF1 (13.3")
- **Board**: ESP32-S3 based (sps_s3_v6_n16r8_el133uf1)

## Quick Start

```bash
FRAME=~/.claude/skills/picture-frame/scripts/frame

# Check if frame is online
$FRAME status

# Upload a photo (auto-processes orientation)
$FRAME upload /path/to/photo.jpg
```

## IMPORTANT: Python vs Curl

**The Python CLI may fail with "No route to host" due to macOS network permissions.**

uv-managed Python doesn't have Local Network permission in TCC. The workaround is to use curl directly for HTTP operations:

```bash
# Get IP from config
FRAME_IP=$(~/dispatch/bin/identity bloomin8.ip)

# Upload via curl (always works)
curl -X POST "http://${FRAME_IP}/upload?filename=photo.jpg&gallery=default&show_now=true" \
  -F "file=@/path/to/photo.jpg"

# Check status via curl
curl -s http://${FRAME_IP}/deviceInfo

# Show specific image
curl -s -X POST "http://${FRAME_IP}/show" \
  -H "Content-Type: application/json" \
  -d '{"image":"/gallerys/default/photo.jpg"}'
```

To fix Python permanently: grant Local Network permission to `~/.local/share/uv/python/*/bin/python*` in System Settings > Privacy & Security > Local Network.

## CLI Commands

```bash
FRAME=~/.claude/skills/picture-frame/scripts/frame

# Wake device via Bluetooth (only works within ~30ft BLE range)
$FRAME wake

# Check device status
$FRAME status

# Upload and display a photo (auto-detects orientation, pads to fit)
$FRAME upload /path/to/photo.jpg

# Upload forcing specific orientation
$FRAME upload /path/to/photo.jpg --landscape
$FRAME upload /path/to/photo.jpg --portrait

# Upload without displaying
$FRAME upload /path/to/photo.jpg --no-show

# Show a specific image already on device
$FRAME show /gallerys/default/filename.jpg

# Show next image in gallery
$FRAME next

# List images in gallery
$FRAME list

# Clear screen (white)
$FRAME clear

# Put device to sleep
$FRAME sleep

# Reboot device
$FRAME reboot

# Single keep-alive ping
$FRAME whistle
```

## Wake Mechanisms

**Use ESP32 proxy (primary) for remote waking. Direct BLE only works within ~30ft.**

### 1. ESP32 BLE Wake Proxy (Primary — always works)

```bash
$FRAME wake
```

An ESP32-S3 sits near the frame as a WiFi-to-BLE bridge. The `wake` command automatically uses the proxy:
1. Mac sends HTTP request to ESP32 proxy at `PROXY_IP`
2. ESP32 sends BLE GATT write (`0x01` to `0000f001-...`) to the Bloomin8
3. Frame wakes up and reconnects to WiFi

**This works from anywhere on the network** — no BLE range limitations from the Mac.

- **Proxy IP**: `config.local.yaml` → `bloomin8.wake_proxy_ip` (DHCP reserved)
- **Proxy MAC**: E8:F6:0A:D8:35:04
- **Endpoints**: `/wake`, `/status`, `/scan`
- **Firmware source**: `~/code/bloomin8-wake-proxy/bloomin8-wake-proxy.ino`

You can also wake directly via curl:
```bash
curl http://PROXY_IP/wake
curl http://PROXY_IP/status
```

If the proxy is unreachable, `$FRAME wake` falls back to direct BLE (only works within ~30ft).

### 2. Mobile App Wake (Backup)

The Bloomin8 iOS app can also wake the device via BLE from your phone.

### 3. Keep-Alive (Prevent Sleep)

If the device is already awake, `/whistle` keeps it awake. **This does NOT wake a sleeping device.**

The dispatch daemon pings `/whistle` every 60 seconds when `keepalive_enabled: true`.

**With the ESP32 proxy, auto-wake is now possible**: if the keepalive detects the frame is asleep (whistle fails), it can call the proxy to wake it first.

## Cloud Infrastructure

The device connects to Bloomin8's cloud:
- **Server**: `einkshot-349134901638.us-central1.run.app` (Google Cloud Run)
- **Protocol**: Device polls `/eink_pull` every ~2 minutes in low-power mode
- **Auth**: JWT token with device_id baked into device firmware

The mobile app uploads to cloud, device pulls on next poll. But for local control, direct HTTP to device IP is faster.

## Image Processing

The CLI automatically:

0. **Converts HEIC/HEIF** - auto-converts to JPEG via sips
1. **Applies EXIF rotation** - corrects phone camera orientation
2. **Detects landscape vs portrait** - matches image orientation
3. **Pads to 4:3 ratio** - black bars instead of cropping (no content lost)
4. **Resizes to screen resolution** - 1600x1200 or 1200x1600
5. **Rotates landscape for frame** - so you turn the frame sideways to view

### Orientation Behavior

| Image Type | Processing | How to View |
|------------|------------|-------------|
| Landscape photo | Pad to 4:3, rotate 90° CCW | Turn frame clockwise (landscape) |
| Portrait photo | Pad to 3:4 | Keep frame upright (portrait) |

### Manual Image Processing (with curl)

When using curl directly, pre-process images with sips:

```bash
# Convert HEIC to JPG
sips -s format jpeg input.heic --out output.jpg

# Resize (example for landscape 1600x1200)
sips -z 1200 1600 input.jpg --out output.jpg
```

## API Reference

Base URL: `http://FRAME_IP`

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/deviceInfo` | Device status, battery, current image |
| POST | `/upload?filename=X&gallery=default&show_now=true` | Upload image (multipart form) |
| POST | `/show` | Display image: `{"image":"/gallerys/default/X.jpg"}` |
| POST | `/showNext` | Next image in gallery |
| POST | `/sleep` | Enter sleep mode |
| POST | `/reboot` | Reboot device |
| POST | `/clearScreen` | Clear to white |
| POST | `/settings` | Update settings: `{"max_idle": 86400}` |
| GET | `/gallery/list` | List all galleries |
| GET | `/whistle` | Keep-alive ping (only works when already awake!) |
| GET | `/gallerys/default/<filename>` | Download image from device |

### Example: Full Upload Workflow with Curl

```bash
# 1. Check device is online
curl -s http://FRAME_IP/deviceInfo | jq -r '.image'

# 2. Convert HEIC to JPG if needed
sips -s format jpeg ~/photo.heic --out /tmp/photo.jpg

# 3. Resize for frame (landscape example)
sips -z 1200 1600 /tmp/photo.jpg --out /tmp/photo_resized.jpg

# 4. Upload with show_now=true
curl -X POST "http://FRAME_IP/upload?filename=myphoto.jpg&gallery=default&show_now=true" \
  -F "file=@/tmp/photo_resized.jpg"

# 5. Verify it's showing
curl -s http://FRAME_IP/deviceInfo | jq -r '.image'
# Should show: /gallerys/default/myphoto.jpg

# 6. Download back to verify
curl -s "http://FRAME_IP/gallerys/default/myphoto.jpg" -o /tmp/downloaded.jpg
file /tmp/downloaded.jpg
```

## Power Management

- **max_idle**: 86400 seconds (24h) - configured via settings API
- **sleep_duration**: 259200 seconds (3 days) - how long it stays asleep
- Device is plugged in, so battery drain isn't a concern

### Keep-Alive Configuration

The dispatch daemon keeps the frame awake with `/whistle` pings.

**Config** (`~/dispatch/config.local.yaml`):
```yaml
bloomin8:
  ip: "<from config.local.yaml>"
  keepalive_enabled: true
  keepalive_interval: 60  # seconds
```

To enable/disable:
```bash
# Edit config, then:
claude-assistant restart
```

## Troubleshooting

### "No route to host" from Python
Use curl instead (see above). This is a macOS Local Network permission issue with uv-managed Python.

### Frame not responding
1. Check IP is correct: `ping FRAME_IP`
2. If unreachable, IP may have changed - check router DHCP leases for WiFi MAC `10:B4:1D:CA:57:A0`
3. If sleeping, wake via mobile app first

### BLE wake fails
The ESP32 proxy should handle this automatically. If proxy also fails:
1. Check ESP32 proxy: `curl http://PROXY_IP/status`
2. Check if ESP32 can see the frame: `curl http://PROXY_IP/scan`
3. Wake via mobile app as backup
4. ESP32 firmware source: `~/code/bloomin8-wake-proxy/bloomin8-wake-proxy.ino`

### Upload returns status:100
This is normal — Bloomin8 returns `status: 100` for success (not 0). The CLI handles this. Also `show_now=true` on upload is unreliable — the CLI sends an explicit `/show` POST after upload.

### Upload hangs but whistle works
Device is in partial sleep - HTTP server responds but display system is hibernated. Need full BLE wake.

## Notes

- Device auto-sleeps after max_idle seconds (default 2 min, we set 24h)
- E-ink refresh takes a few seconds after upload
- Battery level visible in status (100% when plugged in)
- Always verify IP is FRAME_IP before operations - DHCP can change it
