#!/usr/bin/env node
/**
 * Start Metro bundler with remote access support.
 *
 * Reads `metroHost` from app.yaml and sets REACT_NATIVE_PACKAGER_HOSTNAME
 * so the dev server binds to a reachable IP (e.g. Tailscale) instead of localhost.
 *
 * Usage: node scripts/start-metro.js [-- ...expo-start-args]
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Patch dnssd-advertise to prevent "Maximum call stack size exceeded" crash
// that kills Metro. The module has a recursive state machine bug (line ~2628).
// Wrap its advertise() export so crashes are caught and logged, not fatal.
try {
  const dnssdPath = require.resolve("dnssd-advertise");
  const dnssd = require(dnssdPath);
  const originalAdvertise = dnssd.advertise;
  if (originalAdvertise) {
    dnssd.advertise = function safeAdvertise(...args) {
      try {
        const stop = originalAdvertise.apply(this, args);
        // Wrap the returned stop function too
        if (stop && typeof stop.then === "function") {
          return stop.catch((err) => {
            console.warn("[dnssd-advertise] Caught error:", err.message);
          });
        }
        return stop;
      } catch (err) {
        console.warn("[dnssd-advertise] Caught sync error:", err.message);
        return () => Promise.resolve();
      }
    };
  }
} catch {
  // dnssd-advertise not found — no patch needed
}

// Read metroHost from app.yaml
let metroHost = "";
try {
  const YAML = require("yaml");
  const yamlPath = path.join(__dirname, "..", "app.yaml");
  if (fs.existsSync(yamlPath)) {
    const config = YAML.parse(fs.readFileSync(yamlPath, "utf8")) || {};
    metroHost = config.metroHost || "";
  }
} catch {
  // No app.yaml or yaml parse error — use default
}

// Pass through any extra args (e.g. --clear, --port)
const args = ["start", ...process.argv.slice(2)];

const env = { ...process.env };
if (metroHost) {
  env.REACT_NATIVE_PACKAGER_HOSTNAME = metroHost;
  console.log(`Metro binding to ${metroHost} (from app.yaml metroHost)`);
}

const child = spawn("npx", ["expo", ...args], {
  env,
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
});

child.on("exit", (code) => process.exit(code || 0));
