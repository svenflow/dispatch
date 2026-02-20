'use strict';

/**
 * Deals Skill - Playwright Scraper
 *
 * Handles browser-based price extraction for stores without APIs.
 * Three-tier extraction: CSS selectors -> fallback selectors -> text parsing.
 */

const { chromium } = require('playwright');
const { parsePrice, cleanProductName, calcDiscount } = require('./utils.cjs');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ============================================================
// BROWSER MANAGEMENT
// ============================================================

let _browser = null;

/**
 * Launch browser (reuse if already open).
 */
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;

  _browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });
  return _browser;
}

/**
 * Create a fresh browser context (isolated cookies/state).
 */
async function newContext(browser) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: true,
  });
  // Mask webdriver flag
  await context.addInitScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})");
  return context;
}

/**
 * Close the browser.
 */
async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

// ============================================================
// CSS SELECTOR EXTRACTION
// ============================================================

/**
 * Extract products from a page using CSS selectors.
 * @param {Page} page - Playwright page
 * @param {object} selectors - store selector config
 * @param {string} sponsoredFilter - CSS selector for sponsored items to exclude
 * @returns {Array} extracted products
 */
async function extractWithSelectors(page, selectors, sponsoredFilter) {
  return page.evaluate(({ sel, sponsored }) => {
    const results = [];
    const containers = document.querySelectorAll(sel.container);

    containers.forEach(item => {
      // Skip sponsored results
      if (sponsored && item.matches(sponsored)) return;
      if (sponsored && item.querySelector(sponsored)) return;

      const nameEl = item.querySelector(sel.name);
      if (!nameEl) return;

      const name = nameEl.textContent.trim();
      if (!name || name.length < 5) return;

      const priceEl = item.querySelector(sel.price);
      const price = priceEl ? priceEl.textContent.trim() : '';

      const origEl = sel.originalPrice ? item.querySelector(sel.originalPrice) : null;
      const originalPrice = origEl ? origEl.textContent.trim() : '';

      const savingsEl = sel.savings ? item.querySelector(sel.savings) : null;
      const savings = savingsEl ? savingsEl.textContent.trim() : '';

      const linkEl = sel.link ? item.querySelector(sel.link) : nameEl;
      const href = linkEl ? linkEl.getAttribute('href') : '';

      const skuEl = sel.sku ? item.querySelector(sel.sku) : null;
      const sku = skuEl && sel.skuAttr ? skuEl.getAttribute(sel.skuAttr) : '';

      // Rating
      let reviewScore = null;
      let reviewCount = 0;
      if (sel.rating) {
        const ratingEl = item.querySelector(sel.rating);
        if (ratingEl) {
          const ratingText = ratingEl.textContent || ratingEl.getAttribute('aria-label') || '';
          const ratingMatch = ratingText.match(/([\d.]+)\s*(?:out\s+of\s+5|stars?)/i);
          if (ratingMatch) reviewScore = parseFloat(ratingMatch[1]);
        }
      }
      if (sel.reviewCount) {
        const rcEl = item.querySelector(sel.reviewCount);
        if (rcEl) {
          const rcText = rcEl.textContent || '';
          const rcMatch = rcText.match(/([\d,]+)\s*(?:reviews?|ratings?)?/i);
          if (rcMatch) reviewCount = parseInt(rcMatch[1].replace(/,/g, ''));
        }
      }

      results.push({ name, price, originalPrice, savings, href, sku, reviewScore, reviewCount });
    });

    return results;
  }, { sel: selectors, sponsored: sponsoredFilter || null });
}

// ============================================================
// TEXT FALLBACK EXTRACTION
// ============================================================

/**
 * Extract products from page text as a last resort.
 */
async function extractFromText(page) {
  return page.evaluate(() => {
    const results = [];
    const text = document.body.innerText;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const priceRe = /\$[\d,]+\.?\d*/;
    const seen = new Set();

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Look for product-like lines (long, contain relevant keywords)
      if (line.length > 20 && line.length < 300 && !priceRe.test(line)) {
        // Check next few lines for a price
        for (let j = 1; j < Math.min(6, lines.length - i); j++) {
          const nextLine = lines[i + j];
          const priceMatch = nextLine.match(/\$[\d,]+\.?\d*/);
          if (priceMatch) {
            const key = line.substring(0, 50).toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);

              let originalPrice = '';
              let savings = '';
              // Look for was/save in nearby lines
              for (let k = j; k < Math.min(j + 4, lines.length - i); k++) {
                const check = lines[i + k];
                if (/was|reg|msrp|list|compare/i.test(check)) {
                  const opMatch = check.match(/\$[\d,]+\.?\d*/);
                  if (opMatch) originalPrice = opMatch[0];
                }
                if (/save/i.test(check)) {
                  savings = check;
                }
              }

              results.push({
                name: line.substring(0, 150),
                price: priceMatch[0],
                originalPrice,
                savings,
                href: '',
                sku: '',
                reviewScore: null,
                reviewCount: 0,
              });
            }
            break;
          }
        }
      }
      i++;
    }

    return results.slice(0, 10);
  });
}

// ============================================================
// MAIN SCRAPE FUNCTION
// ============================================================

/**
 * Scrape search results from a single store.
 *
 * @param {string} query - search query
 * @param {object} storeConfig - store config from stores.cjs
 * @param {object} [options]
 * @param {number} [options.limit=5] - max results
 * @param {number} [options.timeout=45000] - page load timeout
 * @returns {Array} normalized product results
 */
async function scrapeStore(query, storeConfig, options = {}) {
  const { limit = 5, timeout = 45000 } = options;
  const browser = await getBrowser();
  const context = await newContext(browser);
  const page = await context.newPage();

  try {
    const encodedQuery = encodeURIComponent(query);
    const url = storeConfig.searchUrl.replace('{}', encodedQuery);

    // Navigate
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    // Wait for content
    if (storeConfig.selectors && storeConfig.selectors.container) {
      try {
        await page.waitForSelector(storeConfig.selectors.container, { timeout: 8000 });
      } catch (e) {
        // Selector might not match but page could still have content
      }
    }

    // Wait for actual content to load instead of hard sleeping
    try {
      await page.waitForFunction(
        (sel) => document.querySelectorAll(sel).length >= 2,
        storeConfig.selectors?.container || 'body',
        { timeout: 8000 }
      );
    } catch {
      // Content did not populate in time, proceed with what we have
    }

    // Check for CAPTCHA/bot detection
    // Only flag as bot-detected if the page is SHORT and contains bot keywords.
    // Large pages (>50KB) with bot words in footer/scripts are real product pages.
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    const pageLen = await page.evaluate(() => document.documentElement.outerHTML.length);
    if (/verify you are human|robot|captcha|access denied|blocked/i.test(pageText) && pageLen < 50000) {
      throw new Error('Bot detection triggered');
    }

    // Tier 1: CSS selector extraction
    let rawResults = [];
    if (storeConfig.selectors) {
      rawResults = await extractWithSelectors(page, storeConfig.selectors, storeConfig.sponsoredFilter);
    }

    // Tier 2: Text fallback if selectors got nothing
    if (rawResults.length === 0 && storeConfig.textFallback) {
      rawResults = await extractFromText(page);
    }

    // Normalize results
    const results = rawResults.slice(0, limit).map(r => {
      const price = parsePrice(r.price);
      const originalPrice = parsePrice(r.originalPrice);
      const discount = calcDiscount(price, originalPrice);

      let productUrl = r.href || '';
      if (productUrl && !productUrl.startsWith('http')) {
        // Build absolute URL from store's base domain
        const baseUrl = new URL(url);
        productUrl = `${baseUrl.protocol}//${baseUrl.host}${productUrl}`;
      }

      return {
        store: storeConfig.name,
        storeKey: storeConfig._storeKey || Object.keys(require('./stores.cjs').STORES).find(k =>
          require('./stores.cjs').STORES[k].name === storeConfig.name) || '',
        source: 'scrape',
        name: cleanProductName(r.name),
        price,
        originalPrice,
        discountPercent: discount.percent,
        discountAmount: discount.amount,
        url: productUrl,
        sku: r.sku || null,
        reviewScore: r.reviewScore || null,
        reviewCount: r.reviewCount || 0,
        image: null,
        brand: null,
        model: null,
        specs: {},
        description: null,
        category: null,
      };
    }).filter(r => r.price != null && r.name && r.name.length > 5); // drop items with no price or empty name

    return results;

  } catch (e) {
    console.error(`[${storeConfig.name}] Scrape error: ${e.message}`);
    throw e; // let caller handle (for circuit breaker)
  } finally {
    await context.close();
  }
}

/**
 * Search multiple stores via scraping (in series with delay).
 *
 * @param {string} query
 * @param {object[]} storeConfigs - array of { key, config }
 * @param {object} [options]
 * @returns {Array} all results across stores
 */
async function scrapeStores(query, storeConfigs, options = {}) {
  // Run all Playwright stores concurrently -- they are different domains,
  // no reason to rate-limit between them. Each gets its own browser context.
  const promises = storeConfigs.map(({ key, config }) =>
    scrapeStore(query, config, options)
      .then(results => results)
      .catch(e => [{ _error: true, store: config.name, storeKey: key, error: e.message }])
  );
  const settled = await Promise.all(promises);
  return settled.flat();
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getBrowser,
  closeBrowser,
  scrapeStore,
  scrapeStores,
  extractWithSelectors,
  extractFromText,
};
