'use strict';

/**
 * Deals Skill - Search Result Cache
 *
 * Caches search results in SQLite so repeat queries return instantly.
 * TTL varies by source: API=15min, HTTP=30min, Playwright=60min.
 */

const db = require('./db.cjs');

// Default TTLs in minutes
const TTL = {
  api: 15,
  http: 30,
  graphql: 30,
  playwright: 60,
  default: 30,
};

/**
 * Ensure cache table exists.
 */
let _cacheInitialized = false;
function initCache() {
  if (_cacheInitialized) return;
  const conn = db.getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS search_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_normalized TEXT NOT NULL,
      store TEXT NOT NULL,
      results_json TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      UNIQUE(query_normalized, store)
    );
    CREATE INDEX IF NOT EXISTS idx_cache_query ON search_cache(query_normalized, expires_at);
  `);
  _cacheInitialized = true;
}

/**
 * Normalize a query for cache key matching.
 */
function normalizeQuery(query) {
  return (query || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Get cached results for a query + store.
 * Returns parsed results array or null if cache miss/expired.
 */
function getCached(query, store) {
  try {
    initCache();
    const conn = db.getDb();
    const row = conn.prepare(`
      SELECT results_json FROM search_cache
      WHERE query_normalized = ? AND store = ?
      AND expires_at > datetime('now')
    `).get(normalizeQuery(query), store);

    if (!row) return null;
    return JSON.parse(row.results_json);
  } catch (e) {
    return null;
  }
}

/**
 * Get all cached results for a query across all stores.
 * Returns { results: [], stores: [] } where stores lists which stores had cache hits.
 */
function getCachedAll(query) {
  try {
    initCache();
    const conn = db.getDb();
    const rows = conn.prepare(`
      SELECT store, results_json FROM search_cache
      WHERE query_normalized = ?
      AND expires_at > datetime('now')
    `).all(normalizeQuery(query));

    const results = [];
    const stores = [];
    for (const row of rows) {
      stores.push(row.store);
      results.push(...JSON.parse(row.results_json));
    }
    return { results, stores };
  } catch (e) {
    return { results: [], stores: [] };
  }
}

/**
 * Store results in cache.
 * @param {string} query
 * @param {string} store - store key
 * @param {object[]} results - search results to cache
 * @param {string} [source='http'] - source type for TTL selection
 */
function setCache(query, store, results, source = 'http') {
  try {
    initCache();
    const conn = db.getDb();
    const ttlMinutes = TTL[source] || TTL.default;

    conn.prepare(`
      INSERT INTO search_cache (query_normalized, store, results_json, expires_at)
      VALUES (?, ?, ?, datetime('now', '+' || ? || ' minutes'))
      ON CONFLICT(query_normalized, store) DO UPDATE SET
        results_json = excluded.results_json,
        cached_at = datetime('now'),
        expires_at = excluded.expires_at
    `).run(normalizeQuery(query), store, JSON.stringify(results), ttlMinutes);
  } catch (e) {
    // Cache write failure is non-fatal
  }
}

/**
 * Clear expired cache entries.
 */
function clearExpired() {
  try {
    initCache();
    const conn = db.getDb();
    const result = conn.prepare(`DELETE FROM search_cache WHERE expires_at <= datetime('now')`).run();
    return result.changes;
  } catch (e) {
    return 0;
  }
}

/**
 * Clear all cache entries.
 */
function clearAll() {
  try {
    initCache();
    const conn = db.getDb();
    const result = conn.prepare('DELETE FROM search_cache').run();
    return result.changes;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  getCached,
  getCachedAll,
  setCache,
  clearExpired,
  clearAll,
  normalizeQuery,
  TTL,
};
