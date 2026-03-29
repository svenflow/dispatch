# Dispatch App

Expo/React Native app (iOS + web) for the dispatch-api backend.

## Development Flow — Decision Tree

**Always ask: "Does this change need a native rebuild?"**

```
Changed files?
├── JS/TS only (components, screens, hooks, styles)
│   ├── Metro running? → Save file, hot reload happens automatically ✨
│   └── Metro not running? → `scripts/metro start`, then save
│
├── Native config (app.config.ts, app.yaml, Podfile, plugins/*)
│   └── Full rebuild: `scripts/deploy-ios`
│
├── New native dependency (npm install <package-with-native-code>)
│   └── Full rebuild: `scripts/deploy-ios` (reinstalls pods)
│
└── JS-only dependency (npm install <pure-js-package>)
    └── Restart Metro: `scripts/metro restart --clear`
```

### Metro-First Development (Hot Reload)

**For JS/TS changes, Metro hot reload is the fastest path.** No rebuild needed.

```bash
# Start Metro (binds to Tailscale IP from app.yaml)
scripts/metro start

# Check status / health
scripts/metro status

# Restart if stuck
scripts/metro restart --clear

# Stop when done
scripts/metro stop
```

Metro auto-binds to `metroHost` from `app.yaml` so the phone can reach it over Tailscale.
The app on the phone connects to Metro automatically when it's running.

### Native Deploys (When Rebuild Is Required)

```bash
# Quick rebuild (JS changed + need fresh bundle baked in, no pod changes)
scripts/deploy-ios --quick

# Full rebuild (native config/dependency changes)
scripts/deploy-ios

# Deploy + start Metro after (for continued hot-reload dev)
scripts/deploy-ios --quick --metro
```

**deploy-ios always:**
1. Stops Metro (build uses pre-exported bundle, not live Metro)
2. Exports a fresh JS bundle
3. Builds Release config with `--no-bundler`
4. Deploys to connected iPhone

### When NOT to Rebuild

- Changing component styles → Metro hot reload
- Adding a new screen/route → Metro hot reload
- Updating API calls → Metro hot reload
- Fixing a bug in JS → Metro hot reload

### When You MUST Rebuild

- Changed `app.config.ts` or `app.yaml`
- Changed `Podfile` or native plugins
- Added a package with native code (check for `ios/` dir in node_modules)
- Changed `expo-*` SDK version

## Linting

**ALWAYS run `npm run lint` before committing or creating PRs.** Fix all errors before pushing.

```bash
npm run lint          # Run oxlint on src/ and app/
npx oxlint src/ app/  # Direct invocation
```

## Building

```bash
# Web (served by dispatch-api at /app/)
npx expo export --platform web

# iOS (dev build to device)
APP_VARIANT=sven npx expo run:ios --device "DEVICE_UDID"

# iOS (clean rebuild — needed after native config changes)
APP_VARIANT=sven npx expo prebuild --clean --platform ios
APP_VARIANT=sven npx expo run:ios --device "DEVICE_UDID"
```

## App Variants

- `dispatch` (default) — bundle ID `com.dispatch.app`, display name "Dispatch"
- `sven` — bundle ID `com.nikhil.sven`, display name "Sven"

Set via `APP_VARIANT=sven` env var. Config in `app.config.ts` + `config.default.json`.

## Key Architecture

- **Polling-based** — no WebSocket. Chat list polls every 3s, messages every 1.5s
- **Device token auth** — UUID generated on first launch, registered via POST /register
- **Platform storage** — iOS uses Keychain (expo-secure-store), web uses localStorage
- **API URL configurable** at runtime via Settings tab (persisted in storage)
- **ATS disabled** — `NSAllowsArbitraryLoads: true` in app.config.ts for Tailscale HTTP

## Important Notes

- After `expo prebuild --clean`, ATS settings are applied from `app.config.ts` automatically
- The `sven-icon.png` must exist in `assets/images/` for the sven variant to build
- Push notifications require Apple Developer Portal setup (aps-environment entitlement)
- Metro log at `.metro.log` in the app directory
