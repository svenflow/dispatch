# Find My GPS Unlock — One-Time Setup

This unlocks **real-time GPS coordinates** from Find My location sharing.
Without this, you only get city-level ("San Francisco, CA • Now").

**Time required**: ~20 minutes  
**Physical access required**: Yes (you must be at the Mac)  
**Do this once**: Key is stable across reboots forever

---

## Step 1 — Disable SIP (Recovery Mode)

### Apple Silicon Mac
1. Shut down completely
2. Hold the **power button** until "Loading startup options" appears
3. Click **Options** → Continue
4. Open **Terminal** from the Utilities menu
5. Run: `csrutil disable`
6. Reboot normally

### Intel Mac
1. Restart and immediately hold **Cmd+R** until Apple logo appears
2. Open **Terminal** from the Utilities menu
3. Run: `csrutil disable`
4. Reboot normally

---

## Step 2 — Disable AMFI

After rebooting into normal macOS:

```bash
sudo nvram boot-args="amfi_get_out_of_my_way=1"
```

Reboot again.

Verify both are off:
```bash
csrutil status        # → "System Integrity Protection status: disabled."
nvram boot-args       # → "boot-args	amfi_get_out_of_my_way=1"
```

---

## Step 3 — Extract the Key

```bash
cd ~/code/findmy-key-extractor
pip3 install -r requirements.txt   # first time only
./extract.sh
```

Takes ~10 seconds. Expected output:
```
  🔑  Find My Key Extractor
  ─────────────────────────

  ⏳  Extracting keys (~10s)...

  ── Extraction ──

  ✅  LocalStorage.key (32 bytes)
  ✅  FMFDataManager.bplist (171 bytes)
  ✅  FMIPDataManager.bplist (171 bytes)

  ── Verification ──

  ✅  LocalStorage.key verified [LocalStorage.db]
  ...

  💾 Saved to ./keys/
```

Key is saved to `~/code/findmy-key-extractor/keys/LocalStorage.key`.  
**Keep this file** — losing it means repeating the full SIP disable process.

---

## Step 4 — Re-enable SIP (Recovery Mode again)

Boot back into Recovery Mode (same as Step 1), open Terminal:

```bash
csrutil enable
```

Reboot into normal macOS, then:

```bash
sudo nvram -d boot-args
```

Reboot one final time. Mac is back to full security. Key still works.

Verify:
```bash
csrutil status   # → "System Integrity Protection status: enabled."
```

---

## Step 5 — Test It

```bash
cd ~/code/findmy-key-extractor
python3 verify_key.py keys/LocalStorage.key
# → ✅  LocalStorage.key verified

python3 decrypt_localstorage.py keys/LocalStorage.key
# → LocalStorage_decrypted.sqlite

sqlite3 LocalStorage_decrypted.sqlite ".tables"
# → should show tables including one with friend location data
```

---

## After Setup — What Works

```bash
# Decrypt on demand and query GPS
cd ~/code/findmy-key-extractor
python3 decrypt_localstorage.py keys/LocalStorage.key
sqlite3 LocalStorage_decrypted.sqlite \
  "SELECT * FROM sqlite_master WHERE type='table';"
```

From here we can build:
- Real-time GPS queries (sub-100m precision)
- GPS-level geofencing (e.g. alert when within 500m of home)
- Speed + motion state (walking, driving, stationary)
- Full location history from the WAL

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `error: attach failed` | SIP/AMFI not fully disabled — repeat Steps 1-2 |
| Extraction hangs >30s | Kill Find My: `pkill -9 FindMy` then re-run |
| Key verification fails | Open Find My app, wait 30s for refresh, re-run extract |
| `pip3: command not found` | `brew install python3` |

---

## Why This Is Necessary

Find My stores location updates in `LocalStorage.db` using Apple's custom AES-256 cipher. The decryption key lives in Keychain but is locked to Apple-signed system binaries at the kernel level — no third-party app can read it while SIP is on. The extraction works by attaching a debugger (`lldb`) to the `findmylocateagent` process and reading the key from registers at the moment it's passed to SQLite.

Source: [manonstreet/findmy-key-extractor](https://github.com/manonstreet/findmy-key-extractor)
