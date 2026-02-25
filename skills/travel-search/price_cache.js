#!/usr/bin/env node
/**
 * Price Cache Module v1.0
 *
 * SQLite-based price history tracking for:
 * - Storing search results
 * - "vs 7-day avg" comparisons
 * - Price drop alerts
 *
 * Table: price_history(id, destination, checkin, checkout, guests, price_type, price, timestamp)
 */

const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database path
const DB_DIR = path.join(process.env.HOME, '.claude', 'skills', 'travel-search', 'data');
const DB_PATH = path.join(DB_DIR, 'price_cache.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initialize database
let db = null;

function getDb() {
  if (!db) {
    db = new sqlite3(DB_PATH);
    initializeSchema();
  }
  return db;
}

function initializeSchema() {
  const db = getDb();

  // Main price history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      checkin TEXT NOT NULL,
      checkout TEXT NOT NULL,
      guests INTEGER NOT NULL,
      price_type TEXT NOT NULL,
      price REAL NOT NULL,
      listing_id TEXT,
      listing_name TEXT,
      airline TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(destination, checkin, checkout, guests, price_type, listing_id, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_lookup
    ON price_history(destination, checkin, checkout, guests, price_type);

    CREATE INDEX IF NOT EXISTS idx_price_history_timestamp
    ON price_history(timestamp);
  `);

  // Price alerts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      checkin TEXT NOT NULL,
      checkout TEXT NOT NULL,
      guests INTEGER NOT NULL,
      target_price REAL,
      threshold_pct REAL DEFAULT 10,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_checked TEXT,
      UNIQUE(destination, checkin, checkout, guests)
    );
  `);

  // Daily price summary for faster avg lookups
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_price_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      checkin TEXT NOT NULL,
      checkout TEXT NOT NULL,
      guests INTEGER NOT NULL,
      price_type TEXT NOT NULL,
      min_price REAL,
      max_price REAL,
      avg_price REAL,
      sample_count INTEGER,
      date TEXT NOT NULL,
      UNIQUE(destination, checkin, checkout, guests, price_type, date)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_summary_lookup
    ON daily_price_summary(destination, checkin, checkout, guests, price_type, date);
  `);
}

/**
 * Record a price observation
 */
function recordPrice(params) {
  const {
    destination,
    checkin,
    checkout,
    guests,
    priceType,  // 'flight', 'airbnb', 'total'
    price,
    listingId = null,
    listingName = null,
    airline = null
  } = params;

  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO price_history
    (destination, checkin, checkout, guests, price_type, price, listing_id, listing_name, airline, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  stmt.run(
    destination.toLowerCase(),
    checkin,
    checkout,
    guests,
    priceType,
    price,
    listingId,
    listingName,
    airline
  );
}

/**
 * Record multiple prices from a search result
 */
function recordSearchResults(result) {
  const { params, flights, airbnbs } = result;
  const { destination, checkin, checkout, guests } = params;

  const db = getDb();

  // Use a transaction for bulk insert
  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_history
    (destination, checkin, checkout, guests, price_type, price, listing_id, listing_name, airline, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const transaction = db.transaction(() => {
    // Record flights
    for (const flight of flights) {
      if (!flight.error && flight.price > 0) {
        insertPrice.run(
          destination.toLowerCase(),
          checkin,
          checkout,
          guests,
          'flight',
          flight.price,
          flight.id,
          null,
          flight.airline
        );
      }
    }

    // Record Airbnbs
    for (const airbnb of airbnbs) {
      if (!airbnb.error && airbnb.priceTotal > 0) {
        insertPrice.run(
          destination.toLowerCase(),
          checkin,
          checkout,
          guests,
          'airbnb',
          airbnb.priceTotal,
          airbnb.listingId,
          airbnb.name,
          null
        );
      }
    }

    // Record best total
    const validFlights = flights.filter(f => !f.error && f.price > 0);
    const validAirbnbs = airbnbs.filter(a => !a.error && a.priceTotal > 0);

    if (validFlights.length > 0 && validAirbnbs.length > 0) {
      const cheapestFlight = Math.min(...validFlights.map(f => f.price));
      const cheapestAirbnb = Math.min(...validAirbnbs.map(a => a.priceTotal));
      const total = cheapestFlight + cheapestAirbnb;

      insertPrice.run(
        destination.toLowerCase(),
        checkin,
        checkout,
        guests,
        'total',
        total,
        null,
        null,
        null
      );
    }
  });

  transaction();
}

/**
 * Get average price over last N days
 */
function getAveragePrice(params, days = 7) {
  const { destination, checkin, checkout, guests, priceType } = params;

  const db = getDb();

  const stmt = db.prepare(`
    SELECT
      AVG(price) as avg_price,
      MIN(price) as min_price,
      MAX(price) as max_price,
      COUNT(*) as sample_count
    FROM price_history
    WHERE destination = ?
      AND checkin = ?
      AND checkout = ?
      AND guests = ?
      AND price_type = ?
      AND timestamp >= datetime('now', ?)
  `);

  const result = stmt.get(
    destination.toLowerCase(),
    checkin,
    checkout,
    guests,
    priceType,
    `-${days} days`
  );

  return result;
}

/**
 * Get price comparison vs 7-day average
 */
function getPriceComparison(params, currentPrice) {
  const avgData = getAveragePrice(params, 7);

  if (!avgData || !avgData.avg_price || avgData.sample_count < 2) {
    return null;  // Not enough historical data
  }

  const avgPrice = avgData.avg_price;
  const pctDiff = ((currentPrice - avgPrice) / avgPrice) * 100;

  return {
    currentPrice,
    avgPrice: Math.round(avgPrice),
    minPrice: Math.round(avgData.min_price),
    maxPrice: Math.round(avgData.max_price),
    sampleCount: avgData.sample_count,
    pctDiff: Math.round(pctDiff),
    isBelowAvg: pctDiff < 0,
    isGoodDeal: pctDiff <= -10,
    isExceptionalDeal: pctDiff <= -25,
    description: formatPriceComparison(currentPrice, avgPrice, pctDiff)
  };
}

/**
 * Format price comparison for display
 */
function formatPriceComparison(current, avg, pctDiff) {
  const roundedAvg = Math.round(avg);
  const sign = pctDiff >= 0 ? '+' : '';
  const pct = Math.round(pctDiff);

  if (pctDiff <= -25) {
    return `vs 7d avg $${roundedAvg}: ${sign}${pct}% EXCEPTIONAL`;
  } else if (pctDiff <= -10) {
    return `vs 7d avg $${roundedAvg}: ${sign}${pct}% GOOD DEAL`;
  } else if (pctDiff >= 10) {
    return `vs 7d avg $${roundedAvg}: ${sign}${pct}% ABOVE AVG`;
  } else {
    return `vs 7d avg $${roundedAvg}: ${sign}${pct}%`;
  }
}

/**
 * Get price history for a search
 */
function getPriceHistory(params, days = 30) {
  const { destination, checkin, checkout, guests, priceType = 'total' } = params;

  const db = getDb();

  const stmt = db.prepare(`
    SELECT
      date(timestamp) as date,
      MIN(price) as min_price,
      AVG(price) as avg_price,
      MAX(price) as max_price,
      COUNT(*) as sample_count
    FROM price_history
    WHERE destination = ?
      AND checkin = ?
      AND checkout = ?
      AND guests = ?
      AND price_type = ?
      AND timestamp >= datetime('now', ?)
    GROUP BY date(timestamp)
    ORDER BY date DESC
  `);

  return stmt.all(
    destination.toLowerCase(),
    checkin,
    checkout,
    guests,
    priceType,
    `-${days} days`
  );
}

/**
 * Create or update a price alert
 */
function createPriceAlert(params) {
  const { destination, checkin, checkout, guests, targetPrice = null, thresholdPct = 10 } = params;

  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO price_alerts
    (destination, checkin, checkout, guests, target_price, threshold_pct, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `);

  stmt.run(
    destination.toLowerCase(),
    checkin,
    checkout,
    guests,
    targetPrice,
    thresholdPct
  );
}

/**
 * Check for price drops that trigger alerts
 */
function checkPriceAlerts() {
  const db = getDb();

  // Get active alerts
  const alerts = db.prepare(`
    SELECT * FROM price_alerts WHERE active = 1
  `).all();

  const triggeredAlerts = [];

  for (const alert of alerts) {
    const avgData = getAveragePrice({
      destination: alert.destination,
      checkin: alert.checkin,
      checkout: alert.checkout,
      guests: alert.guests,
      priceType: 'total'
    }, 7);

    if (!avgData || !avgData.avg_price) continue;

    // Get most recent price
    const latestPrice = db.prepare(`
      SELECT price FROM price_history
      WHERE destination = ?
        AND checkin = ?
        AND checkout = ?
        AND guests = ?
        AND price_type = 'total'
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(
      alert.destination,
      alert.checkin,
      alert.checkout,
      alert.guests
    );

    if (!latestPrice) continue;

    const pctDrop = ((avgData.avg_price - latestPrice.price) / avgData.avg_price) * 100;

    // Check threshold
    if (pctDrop >= alert.threshold_pct) {
      triggeredAlerts.push({
        destination: alert.destination,
        checkin: alert.checkin,
        checkout: alert.checkout,
        guests: alert.guests,
        currentPrice: Math.round(latestPrice.price),
        avgPrice: Math.round(avgData.avg_price),
        pctDrop: Math.round(pctDrop)
      });
    }

    // Check target price
    if (alert.target_price && latestPrice.price <= alert.target_price) {
      triggeredAlerts.push({
        destination: alert.destination,
        checkin: alert.checkin,
        checkout: alert.checkout,
        guests: alert.guests,
        currentPrice: Math.round(latestPrice.price),
        targetPrice: alert.target_price,
        hitTarget: true
      });
    }

    // Update last checked
    db.prepare(`
      UPDATE price_alerts SET last_checked = datetime('now') WHERE id = ?
    `).run(alert.id);
  }

  return triggeredAlerts;
}

/**
 * Get destination statistics
 */
function getDestinationStats(destination, days = 30) {
  const db = getDb();

  const stmt = db.prepare(`
    SELECT
      price_type,
      AVG(price) as avg_price,
      MIN(price) as min_price,
      MAX(price) as max_price,
      COUNT(*) as sample_count
    FROM price_history
    WHERE destination = ?
      AND timestamp >= datetime('now', ?)
    GROUP BY price_type
  `);

  return stmt.all(destination.toLowerCase(), `-${days} days`);
}

/**
 * Clean up old data (older than N days)
 */
function cleanupOldData(days = 90) {
  const db = getDb();

  const result = db.prepare(`
    DELETE FROM price_history WHERE timestamp < datetime('now', ?)
  `).run(`-${days} days`);

  return result.changes;
}

/**
 * Export functions
 */
module.exports = {
  getDb,
  initializeSchema,
  recordPrice,
  recordSearchResults,
  getAveragePrice,
  getPriceComparison,
  getPriceHistory,
  createPriceAlert,
  checkPriceAlerts,
  getDestinationStats,
  cleanupOldData,
  formatPriceComparison,
  DB_PATH
};

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      initializeSchema();
      console.log(`Database initialized at ${DB_PATH}`);
      break;

    case 'stats':
      const dest = args[1] || 'paris';
      const stats = getDestinationStats(dest);
      console.log(`Stats for ${dest}:`, JSON.stringify(stats, null, 2));
      break;

    case 'cleanup':
      const days = parseInt(args[1]) || 90;
      const deleted = cleanupOldData(days);
      console.log(`Cleaned up ${deleted} old records`);
      break;

    case 'alerts':
      const alerts = checkPriceAlerts();
      if (alerts.length > 0) {
        console.log('Triggered alerts:', JSON.stringify(alerts, null, 2));
      } else {
        console.log('No price alerts triggered');
      }
      break;

    default:
      console.log(`
Price Cache CLI

Usage:
  node price_cache.js init              Initialize database
  node price_cache.js stats [dest]      Show stats for destination
  node price_cache.js cleanup [days]    Clean up old data (default: 90 days)
  node price_cache.js alerts            Check price alerts
      `);
  }
}
