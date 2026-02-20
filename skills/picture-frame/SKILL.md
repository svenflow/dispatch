---
name: picture-frame
description: Control Bloomin8 e-ink picture frame - upload photos, show images, check status, wake via Bluetooth. Trigger words - bloomin8, eink frame, picture frame, photo frame.
---

# Bloomin8 E-Ink Picture Frame

Control the Bloomin8 color e-ink display on the local network.

## Device Info

- **IP Address**: 10.10.10.37 (DHCP reserved via WiFi MAC)
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
# Upload via curl (always works)
curl -X POST "http://10.10.10.37/upload?filename=photo.jpg&gallery=default&show_now=true" \
  -F "file=@/path/to/photo.jpg"

# Check status via curl
curl -s http://10.10.10.37/deviceInfo

# Show specific image
curl -s -X POST "http://10.10.10.37/show" \
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

# Upload and display a photo (auto-detects orientation, center crops)
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

### 1. BLE Wake (Bluetooth Low Energy)

```bash
$FRAME wake
```

Sends 0x01 to characteristic `0000f001-0000-1000-8000-00805f9b34fb`. This is the ONLY way to wake a fully sleeping device.

**Requirements:**
- Mac Bluetooth enabled
- Device within BLE range (~30ft line-of-sight, less through walls)
- Mac Mini is currently out of BLE range of the frame

### 2. Mobile App Wake

The Bloomin8 iOS app can wake the device from anywhere via BLE from your phone. This works because the phone is closer to the frame than the Mac Mini.

### 3. Keep-Alive (Prevent Sleep)

If the device is already awake, `/whistle` keeps it awake. **This does NOT wake a sleeping device.**

The dispatch daemon pings `/whistle` every 60 seconds when `keepalive_enabled: true`.

**CRITICAL**: The device must be awake FIRST (via BLE or app) before keepalive will work. If the frame falls asleep, you need BLE/app to wake it before whistle pings will reach it.

## Cloud Infrastructure

The device connects to Bloomin8's cloud:
- **Server**: `einkshot-349134901638.us-central1.run.app` (Google Cloud Run)
- **Protocol**: Device polls `/eink_pull` every ~2 minutes in low-power mode
- **Auth**: JWT token with device_id baked into device firmware

The mobile app uploads to cloud, device pulls on next poll. But for local control, direct HTTP to device IP is faster.

## Image Processing

The CLI automatically:

1. **Applies EXIF rotation** - corrects phone camera orientation
2. **Detects landscape vs portrait** - matches image orientation
3. **Center crops to 4:3** - fills screen without letterboxing
4. **Resizes to screen resolution** - 1600x1200 or 1200x1600
5. **Rotates landscape for frame** - so you turn the frame sideways to view

### Orientation Behavior

| Image Type | Processing | How to View |
|------------|------------|-------------|
| Landscape photo | Crop to 4:3, rotate 90° CCW | Turn frame clockwise (landscape) |
| Portrait photo | Crop to 3:4 | Keep frame upright (portrait) |

### Manual Image Processing (with curl)

When using curl directly, pre-process images with sips:

```bash
# Convert HEIC to JPG
sips -s format jpeg input.heic --out output.jpg

# Resize (example for landscape 1600x1200)
sips -z 1200 1600 input.jpg --out output.jpg
```

## API Reference

Base URL: `http://10.10.10.37`

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
curl -s http://10.10.10.37/deviceInfo | jq -r '.image'

# 2. Convert HEIC to JPG if needed
sips -s format jpeg ~/photo.heic --out /tmp/photo.jpg

# 3. Resize for frame (landscape example)
sips -z 1200 1600 /tmp/photo.jpg --out /tmp/photo_resized.jpg

# 4. Upload with show_now=true
curl -X POST "http://10.10.10.37/upload?filename=myphoto.jpg&gallery=default&show_now=true" \
  -F "file=@/tmp/photo_resized.jpg"

# 5. Verify it's showing
curl -s http://10.10.10.37/deviceInfo | jq -r '.image'
# Should show: /gallerys/default/myphoto.jpg

# 6. Download back to verify
curl -s "http://10.10.10.37/gallerys/default/myphoto.jpg" -o /tmp/downloaded.jpg
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
  ip: "10.10.10.37"
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
1. Check IP is correct: `ping 10.10.10.37`
2. If unreachable, IP may have changed - check router DHCP leases for WiFi MAC `10:B4:1D:CA:57:A0`
3. If sleeping, wake via mobile app first

### BLE wake fails
Mac Mini is out of BLE range. Options:
1. Wake via mobile app (your phone is closer)
2. Move Mac Mini closer (~30ft line-of-sight)
3. Add ESP32 near frame as BLE proxy (~$5)

### Upload hangs but whistle works
Device is in partial sleep - HTTP server responds but display system is hibernated. Need full BLE wake.

## Notes

- Device auto-sleeps after max_idle seconds (default 2 min, we set 24h)
- E-ink refresh takes a few seconds after upload
- Battery level visible in status (100% when plugged in)
- Always verify IP is 10.10.10.37 before operations - DHCP can change it
