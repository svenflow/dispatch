---
name: ios-app
description: Build, test, and deploy iOS apps to Simulator and TestFlight. Use when working with Xcode projects, iOS development, simulator, archiving, or TestFlight distribution.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# iOS App Development Skill

Build, test, and deploy iOS apps from the command line. All iOS projects live in `~/code/ios-apps/`.

## Prerequisites

- Xcode installed (verify: `xcodebuild -version`)
- Apple Developer Program membership ($99/yr) for TestFlight
- Xcode license accepted: `sudo xcodebuild -license accept`
- First launch setup: `sudo xcodebuild -runFirstLaunch` (installs CoreSimulator framework)
- iOS simulator runtime: `xcodebuild -downloadPlatform iOS` (~8.4 GB download)
- Apple ID signed into Xcode (Settings > Accounts) for code signing - requires 2FA approval

## Critical First-Time Setup Notes

**After installing Xcode from App Store, you MUST run these in order:**
1. `sudo xcodebuild -license accept` (needs Terminal with sudo)
2. `sudo xcodebuild -runFirstLaunch` (installs CoreSimulator and other frameworks)
3. `xcodebuild -downloadPlatform iOS` (downloads simulator runtime, ~8.4 GB)
4. Open Xcode and click "Download & Install" if component installer dialog appears
5. Sign into Xcode with Apple ID (Settings > Accounts > "+") for signing certificates

**First simulator boot is VERY slow** (5-10+ minutes for iOS 26.x). The simulator will show the Apple logo with a progress bar for a long time. Be patient. Use `xcrun simctl io booted screenshot /tmp/check.png` to check progress without relying on the Simulator.app window.

**The `mas` CLI can install from App Store** but needs sudo: `brew install mas && mas install 497799835` (Xcode's App Store ID)

## Project Structure

```
~/code/ios-apps/
├── AppName/
│   ├── AppName.xcodeproj/
│   │   └── project.pbxproj
│   └── AppName/
│       ├── AppNameApp.swift      # @main entry point
│       ├── ContentView.swift     # Main UI
│       └── Assets.xcassets/      # (optional) App icons, colors
```

## Simulator Workflow

### List Available Simulators
```bash
xcrun simctl list devices available
```

### Boot a Simulator
```bash
xcrun simctl boot "iPhone 16 Pro"

# Open Simulator.app to see it
open -a Simulator
```

### Build for Simulator
```bash
xcodebuild \
  -project ~/code/ios-apps/AppName/AppName.xcodeproj \
  -scheme AppName \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -configuration Debug \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  build
```

The built .app will be in DerivedData:
```bash
# Find it
find ~/Library/Developer/Xcode/DerivedData -name "AppName.app" -path "*/Debug-iphonesimulator/*" 2>/dev/null
```

### Install and Launch on Simulator
```bash
# Install
xcrun simctl install booted /path/to/AppName.app

# Launch
xcrun simctl launch booted com.dispatch.AppName
```

### Screenshot the Simulator
```bash
xcrun simctl io booted screenshot ~/Desktop/screenshot.png
```

### Stream Logs
```bash
# All logs from simulator
xcrun simctl spawn booted log stream --level debug

# Filter to your app
xcrun simctl spawn booted log stream --level debug --predicate 'processImagePath contains "AppName"'
```

### Other Useful Simulator Commands
```bash
# Shutdown simulator
xcrun simctl shutdown booted

# Erase all content (factory reset)
xcrun simctl erase "iPhone 16 Pro"

# Open a URL in simulator
xcrun simctl openurl booted "https://example.com"

# Set dark/light mode
xcrun simctl ui booted appearance dark
xcrun simctl ui booted appearance light

# Uninstall app
xcrun simctl uninstall booted com.dispatch.AppName

# Get app container path (to inspect files)
xcrun simctl get_app_container booted com.dispatch.AppName
```

## TestFlight Deployment Workflow

### Step 1: Find Your Team ID

```bash
# After signing in to Xcode at least once, your team ID is in:
security find-certificate -c "Apple Distribution" -p 2>/dev/null | openssl x509 -text | grep OU=
# Or check App Store Connect > Membership > Team ID
```

### Step 2: Archive the App

```bash
xcodebuild archive \
  -project ~/code/ios-apps/AppName/AppName.xcodeproj \
  -scheme AppName \
  -configuration Release \
  -archivePath ~/code/ios-apps/AppName/build/AppName.xcarchive \
  -allowProvisioningUpdates
```

### Step 3: Create ExportOptions.plist

```bash
cat > ~/code/ios-apps/AppName/build/ExportOptions.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>destination</key>
    <string>upload</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>uploadSymbols</key>
    <true/>
</dict>
</plist>
EOF
```

### Step 4: Export and Upload IPA

```bash
xcodebuild -exportArchive \
  -archivePath ~/code/ios-apps/AppName/build/AppName.xcarchive \
  -exportPath ~/code/ios-apps/AppName/build \
  -exportOptionsPlist ~/code/ios-apps/AppName/build/ExportOptions.plist \
  -allowProvisioningUpdates
```

With `destination: upload`, this exports AND uploads to App Store Connect in one step.

### Alternative Upload Method (if exporting separately)

```bash
# Upload with altool using API key
xcrun altool --upload-app \
  --file ~/code/ios-apps/AppName/build/AppName.ipa \
  --apiKey YOUR_API_KEY_ID \
  --apiIssuer YOUR_ISSUER_ID
```

### Step 5: App Store Connect Setup

If this is the first upload for an app:
1. Go to https://appstoreconnect.apple.com
2. My Apps > "+" > New App
3. Fill in: Platform (iOS), Name, Language, Bundle ID, SKU
4. The uploaded build will appear in TestFlight tab after processing (10-30 min)

### Step 6: Enable TestFlight Testing

**Internal testing** (up to 100 people on your team):
- App Store Connect > TestFlight > select build > add internal testers

**External testing** (up to 10,000 people):
- App Store Connect > TestFlight > External Testing > create group > add testers
- First external build requires Apple review (~24-48 hours)

**Public link** (easiest):
- App Store Connect > TestFlight > External Testing > Enable Public Link
- Share the link with anyone

## API Key Setup (for CI/automation)

1. Go to App Store Connect > Users and Access > Integrations > App Store Connect API
2. Generate API Key with "App Manager" role
3. Download the .p8 key file (one-time download)
4. Note the Key ID and Issuer ID
5. Store the .p8 file at `~/.private_keys/AuthKey_{KEY_ID}.p8`
   (altool looks here by default)

## Quick Reference: Full Build-to-TestFlight Script

```bash
#!/bin/bash
set -e

APP_NAME="$1"
PROJECT_DIR=~/code/ios-apps/$APP_NAME
BUILD_DIR=$PROJECT_DIR/build

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "==> Archiving $APP_NAME..."
xcodebuild archive \
  -project "$PROJECT_DIR/$APP_NAME.xcodeproj" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -archivePath "$BUILD_DIR/$APP_NAME.xcarchive" \
  -allowProvisioningUpdates

cat > "$BUILD_DIR/ExportOptions.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>destination</key>
    <string>upload</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>uploadSymbols</key>
    <true/>
</dict>
</plist>
PLIST

echo "==> Exporting and uploading to App Store Connect..."
xcodebuild -exportArchive \
  -archivePath "$BUILD_DIR/$APP_NAME.xcarchive" \
  -exportPath "$BUILD_DIR" \
  -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
  -allowProvisioningUpdates

echo "==> Done! Check App Store Connect for the build."
```

Usage: `bash deploy.sh HelloWorld`

## Common Issues

| Problem | Solution |
|---------|----------|
| "Not agreed to license" | Run `sudo xcodebuild -license accept` |
| "required plugin failed to load" / CoreSimulator missing | Run `sudo xcodebuild -runFirstLaunch` |
| No simulator runtimes / `simctl list runtimes` empty | Run `xcodebuild -downloadPlatform iOS` |
| Simulator stuck on Apple logo | First boot takes 5-10+ min. Be patient. Check with `xcrun simctl io booted screenshot` |
| "No profiles found" | Add `-allowProvisioningUpdates` flag |
| "Signing requires a development team" | Sign into Xcode with Apple ID (Settings > Accounts), set DEVELOPMENT_TEAM in project |
| "0 valid identities found" | Must sign into Xcode with Apple Developer account first |
| Build not appearing in TestFlight | Wait 10-30 min for processing; check email for errors |
| "Code signing identity not found" | Sign into Xcode with Apple ID first, or install distribution cert |
| Archive fails for simulator-only build | Use `-sdk iphoneos` (not `iphonesimulator`) for archives |
| Duplicate version error | Bump `CURRENT_PROJECT_VERSION` or `MARKETING_VERSION` in build settings |
| `simctl install` hangs | Simulator might still be booting. Wait for home screen first. Check with screenshot. |
| Xcode component installer dialog on first open | Click "Download & Install" or use axctl to click it |

## Bundle ID Convention

All Dispatch apps use: `com.dispatch.AppName`
