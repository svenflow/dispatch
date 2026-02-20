'use strict';

/**
 * Deals Skill - Alert System
 *
 * Checks prices against watchlist targets, deduplicates alerts,
 * sends notifications via iMessage.
 */

const { execFileSync } = require('child_process');
const db = require('./db.cjs');
const { formatPrice } = require('./utils.cjs');

// Update this path to your sendMessage.sh location
const SEND_MESSAGE_SH = process.env.SEND_MESSAGE_SH || '/path/to/sendMessage.sh';
const MAX_ALERTS_PER_RUN = 5;

// ============================================================
// ALERT TYPES
// ============================================================

/**
 * Check a product result against watchlist items.
 *
 * @param {object} product - price result { price, originalPrice, discountPercent, name, store, ... }
 * @param {object[]} watchItems - active watchlist items
 * @returns {object[]} triggered alerts
 */
function checkAlerts(product, watchItems) {
  const alerts = [];

  for (const watch of watchItems) {
    // Match by query (fuzzy)
    const queryMatch = watch.query &&
      product.name.toLowerCase().includes(watch.query.toLowerCase());

    // Match by store (if specified)
    const storeMatch = !watch.store ||
      product.storeKey === watch.store ||
      product.store.toLowerCase() === watch.store.toLowerCase();

    if (!queryMatch || !storeMatch) continue;

    // Alert type 1: Target price hit
    if (watch.target_price && product.price <= watch.target_price) {
      alerts.push({
        type: 'target_hit',
        watchlistId: watch.id,
        product,
        message: `Target hit! ${product.name} is ${formatPrice(product.price)} at ${product.store} (target was ${formatPrice(watch.target_price)})`,
        price: product.price,
      });
    }

    // Alert type 2: Price drop from last check
    const latest = db.getLatestPrice(watch.query, watch.store || null);
    if (latest && latest.price && product.price < latest.price) {
      const drop = Math.round((latest.price - product.price) * 100) / 100;
      if (drop >= 50) { // $50+ drop
        alerts.push({
          type: 'price_drop',
          watchlistId: watch.id,
          product,
          message: `Price drop! ${product.name} dropped ${formatPrice(drop)} at ${product.store} (from ${formatPrice(latest.price)} to ${formatPrice(product.price)})`,
          price: product.price,
        });
      }
    }

    // Alert type 3: Big deal (30%+ discount)
    if (product.discountPercent >= 30 && product.originalPrice) {
      alerts.push({
        type: 'big_deal',
        watchlistId: watch.id,
        product,
        message: `Big deal! ${product.name} is ${product.discountPercent}% off at ${product.store} - ${formatPrice(product.price)} (was ${formatPrice(product.originalPrice)}, save ${formatPrice(product.discountAmount)})`,
        price: product.price,
      });
    }
  }

  return alerts;
}

// ============================================================
// DEDUPLICATION
// ============================================================

/**
 * Filter out alerts that were recently sent (same item + price within 24h).
 */
function deduplicateAlerts(alerts) {
  return alerts.filter(alert => {
    return !db.wasAlertSentRecently(alert.watchlistId, alert.price, 24);
  });
}

// ============================================================
// SENDING
// ============================================================

/**
 * Send an alert via iMessage.
 *
 * @param {string} message - alert text
 * @param {string} contact - email or phone to send to
 * @param {string} [chatId] - specific chat ID
 */
function sendAlert(message, contact, chatId) {
  try {
    const target = chatId || contact || 'user@example.com';
    // Use execFileSync to avoid shell injection -- no shell interpolation
    execFileSync(SEND_MESSAGE_SH, [target, message], { timeout: 30000 });
    return true;
  } catch (e) {
    console.error(`Failed to send alert: ${e.message}`);
    return false;
  }
}

/**
 * Process and send all alerts for a set of products against the watchlist.
 *
 * @param {object[]} products - all price results from search/check
 * @returns {object} { sent: number, skipped: number, alerts: object[] }
 */
function processAlerts(products) {
  const watchItems = db.listWatch();
  if (watchItems.length === 0) {
    return { sent: 0, skipped: 0, alerts: [] };
  }

  // Check how many alerts we already sent today
  const todayCount = db.alertsSentToday();
  if (todayCount >= MAX_ALERTS_PER_RUN) {
    console.log(`Already sent ${todayCount} alerts today. Skipping to prevent spam.`);
    return { sent: 0, skipped: 0, alerts: [], capped: true };
  }

  // Collect all triggered alerts
  let allAlerts = [];
  for (const product of products) {
    if (product._error) continue; // skip failed stores
    const triggered = checkAlerts(product, watchItems);
    allAlerts.push(...triggered);
  }

  // Deduplicate
  const unique = deduplicateAlerts(allAlerts);

  // Cap at max per run
  const remaining = MAX_ALERTS_PER_RUN - todayCount;
  const toSend = unique.slice(0, remaining);
  const skipped = unique.length - toSend.length;

  // Send each alert
  let sent = 0;
  for (const alert of toSend) {
    // Look up notification preferences from watchlist item
    const watch = db.getWatch(alert.watchlistId);
    const contact = watch ? (watch.notify_contact || 'user@example.com') : 'user@example.com';
    const chatId = watch ? watch.notify_chat_id : null;

    const success = sendAlert(alert.message, contact, chatId);
    if (success) {
      sent++;
      // Log the alert
      db.logAlert({
        watchlistId: alert.watchlistId,
        alertType: alert.type,
        message: alert.message,
        price: alert.price,
        sentTo: chatId || contact,
      });
    }
  }

  return { sent, skipped, alerts: toSend };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  checkAlerts,
  deduplicateAlerts,
  sendAlert,
  processAlerts,
  MAX_ALERTS_PER_RUN,
};
