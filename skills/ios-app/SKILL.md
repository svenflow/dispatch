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

## Development Workflow (MUST FOLLOW)

**CRITICAL: Always test in simulator and get user approval BEFORE deploying to TestFlight.**

### The Golden Rule: Simulator First, TestFlight Last

1. **Build for Simulator** - fast iteration, no signing required
2. **Test all CUJs manually** - walk through every critical user journey
3. **Screenshot each CUJ** - capture evidence of working features
4. **Send screenshots to user** - get explicit approval before proceeding
5. **Only then deploy to TestFlight** - after user confirms everything works

### Why This Matters

- TestFlight builds take 10-30 min to process
- Each TestFlight upload creates a new build number (can't reuse)
- Users have to wait for install + trust the app
- Bugs found in TestFlight waste everyone's time
- Simulator catches 90% of issues instantly

### CUJ Testing Checklist

Before ANY TestFlight upload, manually verify:

```
[ ] App launches without crash
[ ] Main screen renders correctly (screenshot)
[ ] All buttons/interactions work (screenshot each)
[ ] Navigation flows work (screenshot each screen)
[ ] Data displays correctly
[ ] Error states handled gracefully
[ ] Console logs show no errors
```

**Send ALL screenshots to user with `--image` flag and wait for approval.**

```bash
# Take screenshot
xcrun simctl io booted screenshot /tmp/cuj-main-screen.png
# Send to user for review
~/.claude/skills/sms-assistant/scripts/send-sms "CHAT_ID" "Main screen ready for review" --image /tmp/cuj-main-screen.png
```

### Example Workflow

```
1. User: "Build me a todo app"
2. You: Create app, build for simulator
3. You: Test adding a todo → screenshot → send to user
4. You: Test completing a todo → screenshot → send to user
5. You: Test deleting a todo → screenshot → send to user
6. User: "Looks good, ship it!"
7. You: NOW archive and upload to TestFlight
```

**Never skip to TestFlight. Always get user sign-off on simulator screenshots first.**

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

# Launch (basic)
xcrun simctl launch booted com.dispatch.AppName

# Launch with console output (captures print() statements)
xcrun simctl launch --console-pty booted com.dispatch.AppName
```

**Tip:** Use `--console-pty` to see `print()` output directly in your terminal. This is the easiest way to debug.

### Screenshot the Simulator
```bash
xcrun simctl io booted screenshot ~/Desktop/screenshot.png
```

### Stream Logs
```bash
# Easiest: launch with --console-pty to see print() output
xcrun simctl launch --console-pty booted com.dispatch.AppName

# All logs from simulator (verbose)
xcrun simctl spawn booted log stream --level debug

# Filter to your app by process name
xcrun simctl spawn booted log stream --level debug --predicate 'processImagePath contains "AppName"'

# Filter by subsystem (if using os.Logger)
xcrun simctl spawn booted log stream --level debug --predicate 'subsystem == "com.dispatch.AppName"'

# Show recent logs (not streaming)
xcrun simctl spawn booted log show --last 5m --predicate 'processImagePath contains "AppName"'
```

**Logging best practices:**
- Use `print()` for quick debugging - captured by `--console-pty`
- Use `os.Logger` for structured logging - captured by `log stream`
- Example Logger setup:
```swift
import os
extension Logger {
    static let app = Logger(subsystem: "com.dispatch.AppName", category: "app")
}
// Usage: Logger.app.info("Something happened")
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
# Best method: Look up from keychain after signing in to Xcode
security find-certificate -c "Apple Development" -p 2>/dev/null | openssl x509 -text | grep -oE 'OU=[A-Z0-9]+' | head -1 | cut -d= -f2

# Or via App Store Connect > Membership > Team ID
```

Store it in `~/.dispatch.env` as `APPLE_DEV_TEAM_ID=XXXXXXXXXX` for reuse.

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

**⚠️ IMPORTANT: Apple Login Requires Manual Intervention**

Apple's login form uses a cross-origin iframe (`idmsa.apple.com`) that cannot be automated via Chrome extension. If the session expires, you MUST ask the user to log in manually. The Chrome extension's `key` and `type` commands cannot reach inside Apple's auth iframe.

Once logged in, you can automate everything else in App Store Connect.

If this is the first upload for an app, you need to:
1. **Register the Bundle ID** in Apple Developer Portal
2. **Create the App** in App Store Connect
3. Then upload will work

#### Registering Bundle ID (automated via Chrome)

Navigate to https://developer.apple.com/account/resources/identifiers/add/bundleId and fill the form with JS:

```javascript
// On developer.apple.com/account/resources/identifiers/add/bundleId
// FIRST: Click "App IDs" > "App" > Continue to get to the form
// Then run this JS:

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

// Get text inputs by position (form doesn't have name attributes)
// First input = Description, Second input = Bundle ID
const inputs = Array.from(document.querySelectorAll("input[type=text]"));
const descInput = inputs[0];
const bundleInput = inputs[1];

// Fill Description
nativeInputValueSetter.call(descInput, "App Name");
descInput.dispatchEvent(new Event("input", {bubbles: true}));

// Fill Bundle ID (use com.sven.AppName format)
nativeInputValueSetter.call(bundleInput, "com.sven.AppName");
bundleInput.dispatchEvent(new Event("input", {bubbles: true}));

// Explicit is already selected by default
// Click Continue when ready (scroll to top first)
// document.querySelector("button").innerText === "Continue" && document.querySelector("button[type=button]").click()
```

**Note:** Refresh page after registering bundle ID to see it in the dropdown when creating the app.

#### Creating App in App Store Connect (automated via Chrome/JS)

Navigate to https://appstoreconnect.apple.com/apps, click "+" > "New App", then fill with JS:

```javascript
// Fill New App form in App Store Connect (run via chrome js <tab_id>)
// Must have React native value setter for text inputs

// Check iOS
document.getElementById("platformsById.IOS").click();

// Set name (React input requires native setter)
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
const nameInput = document.getElementById("name");
nativeInputValueSetter.call(nameInput, "App Name Here");
nameInput.dispatchEvent(new Event("input", {bubbles: true}));

// Set language
document.getElementById("primaryLocale").value = "en-US";
document.getElementById("primaryLocale").dispatchEvent(new Event("change", {bubbles: true}));

// Set bundle ID (must be registered first!) - use com.sven.AppName format
document.getElementById("bundleId").value = "com.sven.AppName";
document.getElementById("bundleId").dispatchEvent(new Event("change", {bubbles: true}));

// Set SKU
const skuInput = document.getElementById("sku");
nativeInputValueSetter.call(skuInput, "appname-sku");
skuInput.dispatchEvent(new Event("input", {bubbles: true}));

// Select Full Access
document.getElementById("userAccessFull").click();

// Then click Create button
```

**Key insight:** React text inputs need the native value setter trick. Regular `.value = x` doesn't trigger React's state update.

**contentEditable divs:** Some form fields (like Beta App Description) use `contentEditable="true"` divs instead of textareas:
```javascript
// For contentEditable divs:
const editableDiv = document.querySelector('[contenteditable="true"]');
editableDiv.focus();
editableDiv.innerText = 'Your description here';
editableDiv.dispatchEvent(new Event('input', {bubbles: true}));
editableDiv.dispatchEvent(new Event('blur', {bubbles: true}));
```

4. The uploaded build will appear in TestFlight tab after processing (10-30 min)

### Step 6: Handle Encryption Compliance

After upload, the build may show "Missing Compliance" status. This must be resolved before testing:

1. Click "Manage" next to the compliance warning
2. For apps that don't use custom encryption (only HTTPS): Select "No"
3. This unlocks the build for testing

Most simple apps only use standard HTTPS, which counts as "No" for encryption compliance.

### Step 7: Enable TestFlight Testing

**Internal testing** (up to 100 people on your team - FASTEST, NO REVIEW):
- App Store Connect > TestFlight > Internal Testing > "New Group"
- Add testers from your team (they must be in Users and Access first)
- Testers get an email invite and app appears in their TestFlight app
- No Apple review required - ready immediately

**Pre-configured internal testers (already in Users and Access):**
- nsthorat@gmail.com (Nikhil) - Admin
- nicklaudethorat@gmail.com (Sven) - Account Holder

For new apps, just add these users to an internal testing group - they're already set up.

**To add NEW internal testers (not yet in Users and Access):**
1. First add them to Users and Access:
   - Go to Users and Access > People > "+" button
   - Fill in First Name, Last Name, Email
   - Select role (Developer is good for testers - NOT Admin)
   - Click Next, select apps, click Invite
   - **IMPORTANT:** They must accept the email invitation BEFORE they appear in TestFlight
2. Once they've accepted the App Store Connect invitation:
   - Go to TestFlight > Internal Testing group > Testers tab > "+" or Add Testers
   - They will now appear in the list of available testers
   - Select them and click Add
3. They receive TestFlight invite via email automatically

**Note:** Internal testers MUST accept their App Store Connect invitation first. They won't appear in the "Add Testers" dialog until they've accepted. This is different from external testing where you can invite anyone by email directly.

**To add existing internal testers to a new app:**
1. Go to Internal Testing group > Testers tab > Add Testers
2. Select team members (must already be in Users and Access AND have accepted)
3. They receive invite via email automatically

**Note on invite links:** Internal tester invite links are generated by Apple and only delivered via email. The App Store Connect API (`POST /v1/betaTesterInvitations`) can resend emails but cannot retrieve the link. For shareable links, use external testing with public link (requires one-time review).

**External testing** (up to 10,000 people):
- App Store Connect > TestFlight > External Testing > "New Group"
- First external build requires Apple review (~24-48 hours)
- Must fill out: Beta App Description, Contact Info, Sign-in info (or uncheck if no login)
- contentEditable divs for text fields need `.innerText = value` (not .value)

**Public link** (after external review):
- External Testing group > Settings > Enable Public Link
- Share the link with anyone - no email invite needed

### Step 8: Send TestFlight Invite

**CRITICAL: Always send invite link/info as a STANDALONE message for easy copy-paste.**

For internal testers:
```bash
# They get email automatically, but confirm:
~/.claude/skills/sms-assistant/scripts/send-sms "CHAT_ID" "$(cat <<'ENDMSG'
added you as internal tester. check your email for TestFlight invite, or open TestFlight app directly - should appear there.
ENDMSG
)"
```

For public link (external):
```bash
# Send JUST the link on its own line:
~/.claude/skills/sms-assistant/scripts/send-sms "CHAT_ID" "https://testflight.apple.com/join/XXXXXX"
```

Don't embed the link in a paragraph - send it standalone so they can tap/copy easily.

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

## App Icons (Required for TestFlight)

TestFlight uploads REQUIRE app icons. Icons must:
- Be PNG format with NO alpha/transparency
- Include all required sizes in an asset catalog

### Generate Solid Color Icons (Quick)

```bash
# Generate solid blue icons with Pillow
uv run --with Pillow python3 << 'EOF'
from PIL import Image

sizes = [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024]
output_dir = "HelloWorld/Assets.xcassets/AppIcon.appiconset"

for size in sizes:
    img = Image.new('RGB', (size, size), color=(0, 122, 255))  # Apple blue
    img.save(f"{output_dir}/icon_{size}.png", "PNG")
EOF
```

### Asset Catalog Contents.json

Create `Assets.xcassets/AppIcon.appiconset/Contents.json`:

```json
{
  "images": [
    {"filename": "icon_40.png", "idiom": "iphone", "scale": "2x", "size": "20x20"},
    {"filename": "icon_60.png", "idiom": "iphone", "scale": "3x", "size": "20x20"},
    {"filename": "icon_58.png", "idiom": "iphone", "scale": "2x", "size": "29x29"},
    {"filename": "icon_87.png", "idiom": "iphone", "scale": "3x", "size": "29x29"},
    {"filename": "icon_80.png", "idiom": "iphone", "scale": "2x", "size": "40x40"},
    {"filename": "icon_120.png", "idiom": "iphone", "scale": "3x", "size": "40x40"},
    {"filename": "icon_120.png", "idiom": "iphone", "scale": "2x", "size": "60x60"},
    {"filename": "icon_180.png", "idiom": "iphone", "scale": "3x", "size": "60x60"},
    {"filename": "icon_20.png", "idiom": "ipad", "scale": "1x", "size": "20x20"},
    {"filename": "icon_40.png", "idiom": "ipad", "scale": "2x", "size": "20x20"},
    {"filename": "icon_29.png", "idiom": "ipad", "scale": "1x", "size": "29x29"},
    {"filename": "icon_58.png", "idiom": "ipad", "scale": "2x", "size": "29x29"},
    {"filename": "icon_40.png", "idiom": "ipad", "scale": "1x", "size": "40x40"},
    {"filename": "icon_80.png", "idiom": "ipad", "scale": "2x", "size": "40x40"},
    {"filename": "icon_76.png", "idiom": "ipad", "scale": "1x", "size": "76x76"},
    {"filename": "icon_152.png", "idiom": "ipad", "scale": "2x", "size": "76x76"},
    {"filename": "icon_167.png", "idiom": "ipad", "scale": "2x", "size": "83.5x83.5"},
    {"filename": "icon_1024.png", "idiom": "ios-marketing", "scale": "1x", "size": "1024x1024"}
  ],
  "info": {"author": "xcode", "version": 1}
}
```

### Adding Assets to project.pbxproj

The project file needs:
1. File reference for Assets.xcassets
2. Build file entry for Assets.xcassets in Resources
3. PBXResourcesBuildPhase in the target's build phases
4. Assets.xcassets in the HelloWorld group's children

See the HelloWorld project at `~/code/ios-apps/HelloWorld/` for a working example.

### Generate Custom Icons with Gemini (nano-banana skill)

For nicer icons, use the nano-banana skill to generate an app icon image, then resize it to all required sizes.

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

All apps use: `com.sven.AppName` (using assistant name from identity CLI)

```bash
# Get the correct prefix dynamically:
~/dispatch/bin/identity assistant.name  # Returns "Sven"
# Bundle ID format: com.sven.AppName (lowercase)
```

**Note:** Legacy apps may still use `com.dispatch.*` or `com.nicklaude.*`. New apps should use `com.sven.*`

## Complete Build-Run-Debug Workflow

Here's the full workflow to build, install, run, and debug an app:

```bash
# 1. Build for simulator
xcodebuild \
  -project ~/code/ios-apps/AppName/AppName.xcodeproj \
  -scheme AppName \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -configuration Debug \
  CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO \
  build

# 2. Find the built .app
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -name "AppName.app" -path "*/Debug-iphonesimulator/*" 2>/dev/null | head -1)

# 3. Install on booted simulator
xcrun simctl install booted "$APP_PATH"

# 4. Launch with console output (to see print() logs)
xcrun simctl launch --console-pty booted com.dispatch.AppName

# 5. Screenshot the simulator
xcrun simctl io booted screenshot ~/Desktop/app-screenshot.png

# 6. Send screenshot to user via iMessage (MUST use --image flag!)
~/.claude/skills/sms-assistant/scripts/send-sms "CHAT_ID" --image ~/Desktop/app-screenshot.png
```

## Sending Screenshots to Users

**CRITICAL: ALWAYS use the `--image` flag to send screenshots. NEVER use raw AppleScript.**

```bash
# ✅ CORRECT - use send-sms CLI with --image flag
~/.claude/skills/sms-assistant/scripts/send-sms "CHAT_ID" --image /tmp/screenshot.png

# ✅ With caption
~/.claude/skills/sms-assistant/scripts/send-sms "CHAT_ID" "Here's the app running" --image /tmp/screenshot.png

# ❌ WRONG - raw AppleScript fails silently for images
# osascript -e 'tell application "Messages"...'
```

The send-sms CLI handles the macOS quirks (copying to ~/Pictures, proper file references) automatically.

**One-liner for rebuild + run:**
```bash
xcodebuild -project ~/code/ios-apps/AppName/AppName.xcodeproj -scheme AppName -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO build 2>&1 | tail -5 && xcrun simctl install booted $(find ~/Library/Developer/Xcode/DerivedData -name "AppName.app" -path "*/Debug-iphonesimulator/*" 2>/dev/null | head -1) && xcrun simctl launch --console-pty booted com.dispatch.AppName
```

## XCUITest - Automated UI Testing (REQUIRED FOR ALL CUJs)

**XCUITest is Apple's official UI testing framework.** Use it to automate all user journeys, capture screenshots as proof, and send results to the user.

### Why XCUITest?

- `simctl` has NO tap command - you cannot interact with UI elements via simulator commands
- XCUITest is the ONLY supported way to automate UI interactions on iOS
- Even cross-platform tools like Appium use XCUITest under the hood
- Tests run in a separate process via accessibility APIs (no app code duplication)

### Project Structure with UI Tests

```
~/code/ios-apps/AppName/
├── AppName.xcodeproj/
│   ├── project.pbxproj          # Must include UITests target
│   └── xcshareddata/xcschemes/
│       └── AppName.xcscheme     # Must configure TestAction
├── AppName/
│   ├── AppNameApp.swift
│   └── ContentView.swift
└── AppNameUITests/
    └── AppNameUITests.swift     # XCUITest test cases
```

### Creating a UI Test Target

1. Add test file at `AppNameUITests/AppNameUITests.swift`:

```swift
import XCTest

final class AppNameUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testExampleUserJourney() throws {
        let app = XCUIApplication()
        app.launch()

        // Find and interact with elements
        let button = app.buttons["Button Label"]
        XCTAssertTrue(button.exists, "Button should exist")
        button.tap()

        // Verify expected state
        let label = app.staticTexts["Expected Text"]
        XCTAssertTrue(label.exists, "Label should show expected text")

        // CRITICAL: Take screenshot and save to /tmp for sending to user
        let screenshot = app.screenshot()
        let data = screenshot.pngRepresentation
        try? data.write(to: URL(fileURLWithPath: "/tmp/test-screenshot.png"))
        print("Screenshot saved to /tmp/test-screenshot.png")
    }
}
```

2. Add UITests target to `project.pbxproj` (see HelloWorld example for reference)

3. Create `xcshareddata/xcschemes/AppName.xcscheme` with TestAction configured:
   - BlueprintIdentifier must match the UITests target ID from project.pbxproj

### Running UI Tests

```bash
# Run all UI tests
xcodebuild test \
  -project ~/code/ios-apps/AppName/AppName.xcodeproj \
  -scheme AppName \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'

# Run specific test
xcodebuild test \
  -project ~/code/ios-apps/AppName/AppName.xcodeproj \
  -scheme AppName \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:AppNameUITests/AppNameUITests/testExampleUserJourney
```

### XCUITest Common Patterns

```swift
// Finding elements
app.buttons["Tap Me!"]           // By accessibility label
app.staticTexts["Hello"]         // Text labels
app.textFields["Email"]          // Text input fields
app.switches["Dark Mode"]        // Toggle switches
app.navigationBars["Settings"]   // Navigation bars

// Interactions
element.tap()                    // Tap
element.doubleTap()              // Double tap
element.swipeUp()                // Swipe gestures
textField.typeText("hello")      // Type text

// Assertions
XCTAssertTrue(element.exists)
XCTAssertEqual(element.label, "Expected")

// Waiting for elements
let exists = element.waitForExistence(timeout: 5)
XCTAssertTrue(exists, "Element should appear within 5 seconds")

// Screenshots during test
let screenshot = app.screenshot()
let data = screenshot.pngRepresentation
try? data.write(to: URL(fileURLWithPath: "/tmp/cuj-step-1.png"))
```

### REQUIRED: CUJ Testing Workflow with Screenshots

**For EVERY user journey, you MUST:**

1. Write an XCUITest that performs the user journey
2. Take screenshots at key steps (save to `/tmp/`)
3. Run the test
4. Send screenshots to user via SMS with description of what was tested

**Example: Testing a Todo App**

```swift
func testAddTodo() throws {
    let app = XCUIApplication()
    app.launch()

    // Step 1: Initial state
    let screenshot1 = app.screenshot()
    try? screenshot1.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/todo-1-initial.png"))

    // Step 2: Add a todo
    app.textFields["New todo"].tap()
    app.textFields["New todo"].typeText("Buy groceries")
    app.buttons["Add"].tap()

    // Step 3: Verify and screenshot
    XCTAssertTrue(app.staticTexts["Buy groceries"].exists)
    let screenshot2 = app.screenshot()
    try? screenshot2.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/todo-2-added.png"))
}
```

**After running the test, send screenshots to user:**

```bash
# Run the test
xcodebuild test -project ~/code/ios-apps/TodoApp/TodoApp.xcodeproj -scheme TodoApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | tail -20

# Send screenshots with descriptions
~/.claude/skills/sms-assistant/scripts/send-sms "CHAT_ID" "CUJ: Add Todo - Step 1: Initial empty state" --image /tmp/todo-1-initial.png
~/.claude/skills/sms-assistant/scripts/send-sms "CHAT_ID" "CUJ: Add Todo - Step 2: After adding 'Buy groceries'" --image /tmp/todo-2-added.png
```

### Best Practices

1. **Use accessibility identifiers** - More stable than text labels which can change
2. **Keep tests focused** - One CUJ per test method
3. **Screenshot at every significant state change**
4. **Save screenshots to /tmp/** - Easy to access and send
5. **Always send screenshots to user** - They need to approve before TestFlight
6. **Add small delays if needed** - `Thread.sleep(forTimeInterval: 0.2)` for UI updates
