---
name: security-scan
description: Scan for supply chain attacks and npm/package vulnerabilities. Check lockfiles, node_modules, filesystem IOCs, and C2 connections. Trigger words - security scan, supply chain, npm vulnerability, compromised package, malicious package, CVE, IOC.
---

# Security Scan Skill

Systematic scanning for supply chain attacks and known package vulnerabilities across all projects.

## How We Learn About Vulnerabilities

### Primary Sources (watch these)
1. **Socket Security** (@socket_dev, socket.dev) — automated supply chain monitoring, often first to catch malicious npm packages. Feross Aboukhadijeh posts high-severity findings on X (@feross)
2. **GitHub Security Advisories** — https://github.com/advisories — browse by ecosystem (npm, PyPI, etc.)
3. **npm advisories** — `npm audit` in any project, or https://www.npmjs.com/advisories
4. **Elastic Security** (elastic.co/security-labs) — publishes deep malware analysis
5. **CISA KEV** — https://www.cisa.gov/known-exploited-vulnerabilities — known exploited CVEs

### What to Watch For
- X posts from @feross, @socket_dev about live attacks
- Sudden new transitive dependencies in popular packages (like `plain-crypto-js` appearing in `axios`)
- GitHub issues/PRs on popular repos asking "why was this dependency added?"
- npm package with `postinstall` script doing unexpected network calls

---

## Quick Scan

### For a Specific Attack (given package name + version)

```bash
# Example: axios supply chain attack 2026-03-31
~/.claude/skills/security-scan/scripts/scan --package axios --bad-version 1.14.1 --ioc-file "/Library/Caches/com.apple.act.mond" --c2 "sfrclak.com"
```

### Manual Scan Checklist

When a new supply chain attack is reported, run through this:

**1. Identify Affected Packages**
From the advisory, note:
- Package name(s): e.g. `axios`
- Malicious version(s): e.g. `1.14.1`, `0.30.4`
- Safe versions: e.g. `≤1.14.0`
- Malicious transitive dep: e.g. `plain-crypto-js`

**2. Scan Lockfiles**
```bash
# Find all package.json files (excluding node_modules)
find ~/code ~/dispatch -name "package.json" -not -path "*/node_modules/*"

# Check which use the affected package
grep -r 'axios' ~/code ~/dispatch --include="package.json" -l | grep -v node_modules

# Check installed version in lockfile
grep 'axios' /path/to/package-lock.json | head -5
```

**3. Scan node_modules for Malicious Transitive Package**
```bash
find ~/code ~/dispatch -path "*/node_modules/plain-crypto-js" -type d 2>/dev/null
# (empty output = clean)
```

**4. Check Filesystem IOCs (macOS)**
```bash
# Check for dropped binary disguised as Apple daemon
ls -la /Library/Caches/com.apple.act.mond 2>/dev/null && echo "COMPROMISED" || echo "clean"
# Linux dropper
ls /tmp/ld.py 2>/dev/null
```

**5. Check Network Connections**
```bash
lsof -i | grep sfrclak
```

**6. Check npm Cache**
```bash
# Malicious tarballs can survive node_modules deletion
find ~/.npm -name "*plain-crypto*" 2>/dev/null
# If found: npm cache clean --force
```

---

## Known Attacks Log

| Date | Package | Bad Versions | IOC File (macOS) | C2 | Status |
|------|---------|-------------|-------------------|----|--------|
| 2026-03-31 | `axios` + `plain-crypto-js` | axios@1.14.1, 0.30.4 | `/Library/Caches/com.apple.act.mond` | `sfrclak.com:8000` | **Scanned — clean** |

---

## If Compromised

1. **Disconnect from network** immediately
2. **Rotate all credentials** — API keys, tokens, SSH keys, anything on the machine
3. **Nuke node_modules** and re-install from pinned safe versions
4. **Clear npm cache**: `npm cache clean --force`
5. **Report to npm security**: security@npmjs.com

---

## Adding New Attacks to Track

When a new attack is discovered, add it to the Known Attacks Log above.
