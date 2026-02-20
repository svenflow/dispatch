'use strict';

/**
 * Deals Skill - Database Layer
 * SQLite via better-sqlite3. WAL mode for safe concurrent access.
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'deals.db');

let _db = null;

/**
 * Get or create the database connection.
 */
function getDb() {
  if (_db) return _db;

  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  migrate(_db);
  return _db;
}

/**
 * Close the database connection.
 */
function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Run schema migrations.
 */
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      brand TEXT,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      query TEXT,
      url TEXT,
      store TEXT,
      target_price REAL,
      notify_contact TEXT DEFAULT 'user@example.com',
      notify_chat_id TEXT,
      active INTEGER DEFAULT 1,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      watchlist_id INTEGER REFERENCES watchlist(id),
      store TEXT NOT NULL,
      price REAL NOT NULL,
      original_price REAL,
      discount_percent REAL,
      discount_amount REAL,
      product_name_raw TEXT,
      product_url TEXT,
      sku TEXT,
      review_score REAL,
      review_count INTEGER,
      source TEXT DEFAULT 'search',
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watchlist_id INTEGER REFERENCES watchlist(id),
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      price REAL,
      sent_to TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS store_health (
      store TEXT PRIMARY KEY,
      consecutive_failures INTEGER DEFAULT 0,
      last_failure_at TEXT,
      last_success_at TEXT,
      disabled_until TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_store ON price_history(store, checked_at);
    CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, checked_at);
    CREATE INDEX IF NOT EXISTS idx_price_history_query ON price_history(product_name_raw);
    CREATE INDEX IF NOT EXISTS idx_watchlist_active ON watchlist(active);
    CREATE INDEX IF NOT EXISTS idx_alert_log_watchlist ON alert_log(watchlist_id, sent_at);
  `);

  // v2 migration: add match_key and search_query columns for precise history matching
  const cols = db.prepare("PRAGMA table_info(price_history)").all().map(c => c.name);
  if (!cols.includes('match_key')) {
    db.exec(`
      ALTER TABLE price_history ADD COLUMN match_key TEXT;
      ALTER TABLE price_history ADD COLUMN search_query TEXT;
      CREATE INDEX IF NOT EXISTS idx_price_history_match_key ON price_history(match_key, checked_at);
    `);
  }
}

// ============================================================
// PRICE HISTORY
// ============================================================

/**
 * Save a price observation.
 */
function savePrice(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO price_history (product_id, watchlist_id, store, price, original_price,
      discount_percent, discount_amount, product_name_raw, product_url, sku,
      review_score, review_count, source, match_key, search_query)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    data.productId || null,
    data.watchlistId || null,
    data.store,
    data.price,
    data.originalPrice || null,
    data.discountPercent || null,
    data.discountAmount || null,
    data.productNameRaw || null,
    data.productUrl || null,
    data.sku || null,
    data.reviewScore || null,
    data.reviewCount || null,
    data.source || 'search',
    data.matchKey || null,
    data.searchQuery || null
  );
}

/**
 * Save multiple price observations in a transaction.
 */
function savePrices(prices) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO price_history (product_id, watchlist_id, store, price, original_price,
      discount_percent, discount_amount, product_name_raw, product_url, sku,
      review_score, review_count, source, match_key, search_query)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const d of items) {
      stmt.run(
        d.productId || null, d.watchlistId || null, d.store, d.price,
        d.originalPrice || null, d.discountPercent || null, d.discountAmount || null,
        d.productNameRaw || null, d.productUrl || null, d.sku || null,
        d.reviewScore || null, d.reviewCount || null, d.source || 'search',
        d.matchKey || null, d.searchQuery || null
      );
    }
  });

  insertMany(prices);
}

/**
 * Get price history for a query.
 * Uses match_key for precise matching, falls back to fuzzy LIKE on product_name_raw.
 */
function getPriceHistory(query, limit = 30, matchKeyVal = null) {
  const db = getDb();
  if (matchKeyVal) {
    const rows = db.prepare(`
      SELECT store, price, original_price, discount_percent, product_name_raw, product_url, checked_at
      FROM price_history
      WHERE match_key = ?
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(matchKeyVal, limit);
    if (rows.length > 0) return rows;
  }
  // Fallback to fuzzy match
  return db.prepare(`
    SELECT store, price, original_price, discount_percent, product_name_raw, product_url, checked_at
    FROM price_history
    WHERE product_name_raw LIKE ?
    ORDER BY checked_at DESC
    LIMIT ?
  `).all(`%${query}%`, limit);
}

/**
 * Get latest price for a query at a specific store.
 * Uses match_key for precise matching when available.
 */
function getLatestPrice(query, store = null, matchKeyVal = null) {
  const db = getDb();
  // Try match_key first
  if (matchKeyVal) {
    const row = store
      ? db.prepare(`SELECT price, original_price, store, product_name_raw, checked_at FROM price_history WHERE match_key = ? AND store = ? ORDER BY checked_at DESC LIMIT 1`).get(matchKeyVal, store)
      : db.prepare(`SELECT price, original_price, store, product_name_raw, checked_at FROM price_history WHERE match_key = ? ORDER BY checked_at DESC LIMIT 1`).get(matchKeyVal);
    if (row) return row;
  }
  // Fallback to fuzzy
  if (store) {
    return db.prepare(`
      SELECT price, original_price, store, product_name_raw, checked_at
      FROM price_history
      WHERE product_name_raw LIKE ? AND store = ?
      ORDER BY checked_at DESC LIMIT 1
    `).get(`%${query}%`, store);
  }
  return db.prepare(`
    SELECT price, original_price, store, product_name_raw, checked_at
    FROM price_history
    WHERE product_name_raw LIKE ?
    ORDER BY checked_at DESC LIMIT 1
  `).get(`%${query}%`);
}

/**
 * Get price stats for deal analysis.
 * Uses match_key for precise matching when available.
 */
function getPriceStats(query, matchKeyVal = null) {
  const db = getDb();

  // Try match_key first
  if (matchKeyVal) {
    const stats = db.prepare(`
      SELECT MIN(price) as low, MAX(price) as high, AVG(price) as avg, COUNT(*) as checks,
        MIN(checked_at) as first_check, MAX(checked_at) as last_check
      FROM price_history WHERE match_key = ?
    `).get(matchKeyVal);
    if (stats && stats.checks > 0) {
      const lowest = db.prepare(`SELECT store, price, checked_at FROM price_history WHERE match_key = ? ORDER BY price ASC LIMIT 1`).get(matchKeyVal);
      return { ...stats, lowestStore: lowest };
    }
  }

  // Fallback to fuzzy
  const stats = db.prepare(`
    SELECT
      MIN(price) as low,
      MAX(price) as high,
      AVG(price) as avg,
      COUNT(*) as checks,
      MIN(checked_at) as first_check,
      MAX(checked_at) as last_check
    FROM price_history
    WHERE product_name_raw LIKE ?
  `).get(`%${query}%`);

  const lowest = db.prepare(`
    SELECT store, price, checked_at
    FROM price_history
    WHERE product_name_raw LIKE ?
    ORDER BY price ASC LIMIT 1
  `).get(`%${query}%`);

  return { ...stats, lowestStore: lowest };
}

// ============================================================
// WATCHLIST
// ============================================================

/**
 * Add an item to the watchlist.
 */
function addWatch(data) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO watchlist (product_id, query, url, store, target_price, notify_contact, notify_chat_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.productId || null,
    data.query,
    data.url || null,
    data.store || null,
    data.targetPrice || null,
    data.notifyContact || 'user@example.com',
    data.notifyChatId || null,
    data.notes || null
  );
}

/**
 * List all active watchlist items.
 */
function listWatch() {
  const db = getDb();
  return db.prepare(`
    SELECT id, product_id, query, url, store, target_price, notify_contact, added_at, notes
    FROM watchlist WHERE active = 1 ORDER BY added_at DESC
  `).all();
}

/**
 * Get a single watchlist item by ID.
 */
function getWatch(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM watchlist WHERE id = ?').get(id);
}

/**
 * Remove (deactivate) a watchlist item.
 */
function removeWatch(id) {
  const db = getDb();
  return db.prepare('UPDATE watchlist SET active = 0 WHERE id = ?').run(id);
}

/**
 * Remove by query match.
 */
function removeWatchByQuery(query) {
  const db = getDb();
  return db.prepare('UPDATE watchlist SET active = 0 WHERE query LIKE ? AND active = 1').run(`%${query}%`);
}

// ============================================================
// ALERT LOG
// ============================================================

/**
 * Log a sent alert.
 */
function logAlert(data) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO alert_log (watchlist_id, alert_type, message, price, sent_to)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.watchlistId, data.alertType, data.message, data.price || null, data.sentTo || null);
}

/**
 * Check if a similar alert was sent recently (dedup).
 * Returns true if an alert was sent for this watchlist item at this price within hoursAgo.
 */
function wasAlertSentRecently(watchlistId, price, hoursAgo = 24) {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM alert_log
    WHERE watchlist_id = ? AND price = ?
    AND sent_at > datetime('now', '-' || ? || ' hours')
  `).get(watchlistId, price, hoursAgo);
  return row.cnt > 0;
}

/**
 * Count alerts sent in this run window (prevent spam).
 */
function alertsSentToday() {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM alert_log
    WHERE sent_at > datetime('now', '-1 day')
  `).get();
  return row.cnt;
}

// ============================================================
// STORE HEALTH (circuit breaker)
// ============================================================

/**
 * Record a store success.
 */
function storeSuccess(store) {
  const db = getDb();
  db.prepare(`
    INSERT INTO store_health (store, consecutive_failures, last_success_at)
    VALUES (?, 0, datetime('now'))
    ON CONFLICT(store) DO UPDATE SET
      consecutive_failures = 0,
      last_success_at = datetime('now'),
      disabled_until = NULL
  `).run(store);
}

/**
 * Record a store failure.
 */
function storeFailure(store) {
  const db = getDb();
  db.prepare(`
    INSERT INTO store_health (store, consecutive_failures, last_failure_at)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(store) DO UPDATE SET
      consecutive_failures = consecutive_failures + 1,
      last_failure_at = datetime('now'),
      disabled_until = CASE
        WHEN consecutive_failures + 1 >= 5 THEN datetime('now', '+6 hours')
        ELSE disabled_until
      END
  `).run(store);
}

/**
 * Record a store soft failure (0 results, no error -- possible selector rot).
 * Uses a higher threshold (5) than hard failures (3) before disabling.
 */
function storeSoftFailure(store) {
  const db = getDb();
  db.prepare(`
    INSERT INTO store_health (store, consecutive_failures, last_failure_at)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(store) DO UPDATE SET
      consecutive_failures = consecutive_failures + 1,
      last_failure_at = datetime('now'),
      disabled_until = CASE
        WHEN consecutive_failures + 1 >= 8 THEN datetime('now', '+6 hours')
        ELSE disabled_until
      END
  `).run(store);
}

/**
 * Check if a store is currently disabled.
 */
function isStoreDisabled(store) {
  const db = getDb();
  const row = db.prepare(`
    SELECT disabled_until FROM store_health WHERE store = ?
  `).get(store);
  if (!row || !row.disabled_until) return false;
  return new Date(row.disabled_until + 'Z') > new Date();
}

/**
 * Get health status for all stores.
 */
function getStoreHealth() {
  const db = getDb();
  return db.prepare('SELECT * FROM store_health ORDER BY store').all();
}

// ============================================================
// MAINTENANCE
// ============================================================

/**
 * Prune old price history entries to prevent unbounded growth.
 * @param {number} daysToKeep - keep entries from the last N days (default 90)
 * @returns {number} rows deleted
 */
function pruneOldHistory(daysToKeep = 90) {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM price_history WHERE checked_at < datetime('now', '-' || ? || ' days')
  `).run(daysToKeep);
  return result.changes;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getDb,
  closeDb,
  // Price history
  savePrice,
  savePrices,
  getPriceHistory,
  getLatestPrice,
  getPriceStats,
  // Watchlist
  addWatch,
  listWatch,
  getWatch,
  removeWatch,
  removeWatchByQuery,
  // Alert log
  logAlert,
  wasAlertSentRecently,
  alertsSentToday,
  // Store health
  storeSuccess,
  storeFailure,
  storeSoftFailure,
  isStoreDisabled,
  getStoreHealth,
  // Maintenance
  pruneOldHistory,
};
