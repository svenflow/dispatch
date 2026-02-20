'use strict';

/**
 * Deals Skill - Store Configurations
 *
 * Each store has:
 * - name: Display name
 * - type: 'api' or 'scrape'
 * - searchUrl: URL template for search (scrape stores)
 * - apiSearch: function(query, options) -> results (API stores)
 * - selectors: CSS selector extraction config (scrape stores)
 * - textFallback: true if text extraction should be tried as fallback
 * - sponsoredFilter: CSS selector to exclude sponsored results
 */

const https = require('https');
const http = require('http');

// ============================================================
// API HELPERS
// ============================================================

/**
 * Simple HTTP GET that returns JSON.
 */
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ============================================================
// BEST BUY (Products API - FREE)
// ============================================================

// API key stored in env or config file
const BB_API_KEY = process.env.BESTBUY_API_KEY || '';

/**
 * Search Best Buy Products API.
 * Docs: https://bestbuyapis.github.io/api-reference/
 *
 * Returns structured product data. NOTE: The API does NOT reflect
 * event/promo pricing (e.g. Presidents' Day sales). Use scrapeVerifyBestBuy()
 * to get real storefront prices for top results.
 */
/**
 * Build WxHxD dimensions string from Best Buy API fields.
 * Returns e.g. "48.4\"x28.1\"x2.2\"" or null if data missing.
 */
function buildDimensions(p) {
  // width comes as "48.4 inches" string, others are numeric
  let w = null;
  if (p.width) {
    const m = String(p.width).match(/([\d.]+)/);
    if (m) w = parseFloat(m[1]);
  }
  const h = p.heightWithoutStandIn || null;
  const d = p.depthWithoutStandIn || null;
  if (w && h && d) {
    return `${w}\u2033x${h}\u2033x${d}\u2033`;
  }
  return null;
}

/** Map query patterns to Best Buy categoryPath filters */
const BB_CATEGORY_MAP = [
  { pattern: /\b(mac mini|mac studio|mac pro|imac|desktop|pc|nuc|mini pc)\b/i, filter: 'categoryPath.name=Desktops*' },
  { pattern: /\b(macbook|laptop|notebook|chromebook)\b/i, filter: 'categoryPath.name=Laptops*' },
  { pattern: /\b(tv|television)\b/i, filter: 'categoryPath.name=TVs*' },
  { pattern: /\b(monitor|display)\b/i, filter: 'categoryPath.name=Monitors*' },
  { pattern: /\b(camera|mirrorless|dslr)\b/i, filter: 'categoryPath.name=Cameras*' },
  { pattern: /\b(headphones?|earbuds?|airpods?)\b/i, filter: 'categoryPath.name=Headphones*' },
  { pattern: /\b(ipad|tablet)\b/i, filter: 'categoryPath.name=Tablets*' },
  { pattern: /\b(iphone|smartphone|phone)\b/i, filter: 'categoryPath.name=Cell Phones*' },
  { pattern: /\b(hard drive|ssd|external drive|storage)\b/i, filter: 'categoryPath.name=Hard Drives*' },
];

async function searchBestBuy(query, options = {}) {
  if (!BB_API_KEY) {
    console.error('[Best Buy] No API key. Set BESTBUY_API_KEY env var.');
    return [];
  }

  const pageSize = options.limit || 10;
  // Best Buy API wants the search term URL-encoded in the path
  // but NOT double-encoded. Use encodeURI for the full URL later.
  const safeQuery = query.replace(/[()&]/g, ' ').trim();

  // Detect category to filter API results (prevents AppleCare/gift cards dominating)
  let categoryFilter = '';
  for (const { pattern, filter } of BB_CATEGORY_MAP) {
    if (pattern.test(query)) {
      categoryFilter = `&${filter}`;
      break;
    }
  }

  // Use the search endpoint with show fields
  const fields = [
    'sku', 'name', 'salePrice', 'regularPrice', 'percentSavings',
    'onSale', 'url', 'categoryPath', 'customerReviewAverage',
    'customerReviewCount', 'image', 'shortDescription',
    'modelNumber', 'manufacturer',
    // TV/monitor specs (validated API fields)
    'screenSizeIn', 'verticalResolution', 'displayType',
    'screenRefreshRateHz',
    // Physical specs
    'shippingWeight', 'color',
    'width', 'heightWithoutStandIn', 'depthWithoutStandIn',
    // General
    'condition', 'active'
  ].join(',');

  // Price range filter for Best Buy API
  let priceFilter = '';
  if (options.minPrice) priceFilter += `&salePrice>=${options.minPrice}`;
  if (options.maxPrice) priceFilter += `&salePrice<=${options.maxPrice}`;

  const url = encodeURI(`https://api.bestbuy.com/v1/products((search=${safeQuery})${categoryFilter}${priceFilter}&active=true)?apiKey=${BB_API_KEY}&format=json&show=${fields}&pageSize=${pageSize}&sort=bestSellingRank.asc`);

  try {
    // Retry with backoff on 403/429/5xx (Best Buy API is intermittently flaky)
    let status, data;
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const resp = await fetchJson(url);
      status = resp.status;
      data = resp.data;
      if (status === 200) break;
      if (attempt < maxRetries && (status === 403 || status === 429 || status >= 500)) {
        const delay = (attempt + 1) * 1500; // 1.5s, 3s
        process.stderr.write(`[Best Buy] API returned ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...\n`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (status !== 200) {
      console.error(`[Best Buy] API returned ${status} after ${maxRetries + 1} attempts`);
      return [];
    }

    if (!data.products || data.products.length === 0) {
      return [];
    }

    return data.products.map(p => ({
      store: 'Best Buy',
      storeKey: 'bestbuy',
      source: 'api',
      name: p.name,
      price: p.salePrice,
      originalPrice: p.onSale ? p.regularPrice : null,
      discountPercent: p.onSale ? Math.round(p.percentSavings) : 0,
      discountAmount: p.onSale ? Math.round((p.regularPrice - p.salePrice) * 100) / 100 : 0,
      url: p.sku ? `https://www.bestbuy.com/site/-/${p.sku}.p` : (p.url ? p.url.split('?')[0] : null),
      sku: String(p.sku),
      reviewScore: p.customerReviewAverage || null,
      reviewCount: p.customerReviewCount || 0,
      image: p.image || null,
      brand: p.manufacturer || null,
      model: p.modelNumber || null,
      weight: p.shippingWeight || null,
      color: p.color || null,
      dimensions: buildDimensions(p),
      specs: {
        screenSize: p.screenSizeIn ? String(Math.round(p.screenSizeIn)) : null,
        screenSizeExact: p.screenSizeIn ? String(p.screenSizeIn) : null,
        resolution: p.verticalResolution ? `${p.verticalResolution}p` : null,
        displayType: p.displayType || null,
        refreshRate: p.screenRefreshRateHz ? `${p.screenRefreshRateHz}Hz` : null,
      },
      description: p.shortDescription || null,
      category: guessCategoryFromBBPath(p.categoryPath),
    })).filter(p => {
      // Post-filter: remove AppleCare, service plans, gift cards from API results
      const nameLower = (p.name || '').toLowerCase();
      if (/applecare|geek squad|gift card|protection plan/i.test(nameLower)) return false;
      // Remove monthly/annual plans
      if (/\b(monthly|annual|yearly)\s+plan\b/i.test(nameLower)) return false;
      return true;
    });
  } catch (e) {
    console.error(`[Best Buy] API error: ${e.message}`);
    return [];
  }
}

/**
 * Guess category from Best Buy category path.
 */
function guessCategoryFromBBPath(categoryPath) {
  if (!categoryPath) return null;
  const names = categoryPath.map(c => (c.name || '').toLowerCase());
  const joined = names.join(' ');
  if (joined.includes('tv') || joined.includes('television')) return 'tv';
  if (joined.includes('camera')) return 'camera';
  if (joined.includes('monitor')) return 'monitor';
  if (joined.includes('laptop') || joined.includes('notebook')) return 'laptop';
  if (joined.includes('headphone')) return 'headphones';
  return null;
}

// ============================================================
// BEST BUY PRICE VERIFICATION (scrape actual product pages)
// ============================================================

/**
 * Scrape the actual Best Buy product page to get the real storefront price.
 * The API misses event/promo pricing (Presidents' Day, Black Friday, etc.).
 * This function takes API results and verifies/corrects the prices.
 *
 * @param {object[]} apiResults - results from searchBestBuy()
 * @param {number} [maxVerify=3] - how many top results to verify
 * @returns {object[]} same results with corrected prices
 */
async function verifyBestBuyPrices(apiResults, maxVerify = 8) {
  if (apiResults.length === 0) return apiResults;

  let scraper;
  try {
    scraper = require('./scraper.cjs');
  } catch (e) {
    console.error('[Best Buy] Scraper not available for price verification');
    return apiResults;
  }

  const browser = await scraper.getBrowser();
  const { chromium } = require('playwright');

  const toVerify = apiResults.slice(0, maxVerify).filter(r => r.url);

  // Verify all pages in PARALLEL (not sequential)
  const verifyOne = async (result) => {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})");
    const page = await context.newPage();

    try {
      const productUrl = result.url || `https://www.bestbuy.com/site/${result.sku}.p?skuId=${result.sku}`;
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Wait for price content to appear instead of hard sleeping
      try {
        await page.waitForSelector('.priceView-hero-price, [data-testid="customer-price"]', { timeout: 6000 });
      } catch {
        // Price container not found, proceed with text fallback
      }

      const pagePrice = await page.evaluate(() => {
        // Target specific Best Buy price containers instead of scanning full page text
        const priceBlock = document.querySelector('.priceView-hero-price, [data-testid="customer-price"]');
        const currentPrice = priceBlock
          ? (priceBlock.querySelector('span[aria-hidden="true"]')?.textContent?.trim()
            || priceBlock.querySelector('span')?.textContent?.trim())
          : null;

        const wasBlock = document.querySelector('.pricing-price__regular-price, [data-testid="was-price"]');
        const wasPrice = wasBlock?.textContent?.trim()?.match(/\$[\d,]+\.?\d*/)?.[0] || null;

        const savingsBlock = document.querySelector('.pricing-price__savings, [data-testid="savings-price"]');
        const savings = savingsBlock?.textContent?.trim() || null;

        // Fallback: if CSS selectors miss, try text scanning with stricter rules
        if (!currentPrice) {
          const text = document.body.innerText;
          const lines = text.split('\n').map(l => l.trim()).filter(l => l);
          let foundPrice = null, foundWas = null, foundSavings = null;
          for (const line of lines) {
            if (!foundPrice && /^\$[\d,]+\.?\d*$/.test(line)) foundPrice = line;
            if (!foundWas && /^\$[\d,]+\.?\d*$/.test(line) && foundPrice && line !== foundPrice) foundWas = line;
            if (!foundSavings && /^Save \$[\d,]+/.test(line)) foundSavings = line;
          }
          return { currentPrice: foundPrice, wasPrice: foundWas, savings: foundSavings };
        }

        return { currentPrice, wasPrice, savings };
      });

      if (pagePrice.currentPrice) {
        const { parsePrice, calcDiscount } = require('./utils.cjs');
        const scrapedPrice = parsePrice(pagePrice.currentPrice);
        const scrapedOriginal = parsePrice(pagePrice.wasPrice);

        if (scrapedPrice && scrapedPrice !== result.price) {
          process.stderr.write(`  [Best Buy] Price corrected: ${result.name.substring(0, 40)}... API=${result.price} -> actual=${scrapedPrice}\n`);
          result.price = scrapedPrice;
          result.source = 'api+verified';
          if (scrapedOriginal) {
            result.originalPrice = scrapedOriginal;
            const disc = calcDiscount(scrapedPrice, scrapedOriginal);
            result.discountPercent = disc.percent;
            result.discountAmount = disc.amount;
          }
        } else if (scrapedPrice) {
          result.source = 'api+verified';
        }
      }
    } catch (e) {
      process.stderr.write(`  [Best Buy] Verify failed for SKU ${result.sku}: ${e.message}\n`);
    } finally {
      await context.close();
    }
  };

  // Run all verifications concurrently
  await Promise.allSettled(toVerify.map(r => verifyOne(r)));

  return apiResults;
}

// ============================================================
// STORE REGISTRY
// ============================================================

/**
 * Store registry -- single source of truth for all supported stores.
 *
 * API stores have an `apiSearch` function.
 * Playwright-only stores have `searchUrl` and `selectors` (used by scraper.cjs).
 * HTTP stores are defined in http-scraper.cjs (they use Cheerio, not Playwright selectors).
 *
 * Stores listed here:
 *   - bestbuy: API + Playwright verification
 *   - target, bhphoto: Playwright-only (need JS rendering)
 *
 * Stores in http-scraper.cjs (Cheerio):
 *   - amazon, walmart, newegg, microcenter, ebay, homedepot (GraphQL)
 */
const STORES = {
  bestbuy: {
    name: 'Best Buy',
    type: BB_API_KEY ? 'api' : 'scrape',
    apiSearch: searchBestBuy,
    searchUrl: 'https://www.bestbuy.com/site/searchpage.jsp?st={}',
    selectors: {
      container: '.sku-item',
      name: '.sku-title a, .sku-header a, h4.sku-title a',
      price: '[data-testid="customer-price"] span, .priceView-customer-price span',
      originalPrice: '.pricing-price__regular-price, [data-testid="was-price"]',
      savings: '.pricing-price__savings, [data-testid="savings-price"]',
      link: '.sku-title a, .sku-header a',
      sku: '[data-sku-id]',
      skuAttr: 'data-sku-id',
      rating: '.c-ratings-reviews-v4 .c-stars',
      reviewCount: '.c-ratings-reviews-v4 .c-reviews',
    },
    sponsoredFilter: '.sponsored-product',
    textFallback: true,
  },

  target: {
    name: 'Target',
    type: 'scrape',
    searchUrl: 'https://www.target.com/s?searchTerm={}',
    selectors: {
      container: '[data-test="@web/site-top-of-funnel/ProductCardWrapper"]',
      name: '[data-test="product-title"] a, a[data-test="product-title"]',
      price: '[data-test="current-price"] span',
      originalPrice: '[data-test="comparison-price"] span',
      link: '[data-test="product-title"] a, a[data-test="product-title"]',
      rating: '[data-test="ratings"] span, [data-test="rating"], .RatingStars, [aria-label*="out of 5"]',
      reviewCount: '[data-test="rating-count"], [data-test="reviewCount"], .RatingCount',
    },
    textFallback: true,
  },

  bhphoto: {
    name: 'B&H Photo',
    type: 'scrape',
    searchUrl: 'https://www.bhphotovideo.com/c/search?q={}',
    selectors: {
      container: '[data-selenium="miniProductPage"]',
      name: '[data-selenium="miniProductPageProductName"]',
      price: '[data-selenium="uppedDecimalPriceFirst"]',
      originalPrice: '[data-selenium="miniProductPagePricingContainer"] del',
      link: '[data-selenium="miniProductPageProductNameLink"], [data-selenium="miniProductPageProductImgLink"]',
      rating: '[data-selenium="ratingContainer"]',
      reviewCount: '[data-selenium="miniProductPageProductReviews"]',
    },
    textFallback: true,
  },

  ebay: {
    name: 'eBay',
    type: 'scrape',
    searchUrl: 'https://www.ebay.com/sch/i.html?_nkw={}&_sop=15&rt=nc&LH_BIN=1',
    selectors: {
      container: 'li.s-card, .s-item:not(.s-item--ad)',
      name: '.s-card__title, .s-item__title span',
      price: '.s-card__price, .s-item__price',
      originalPrice: '[class*="strikethrough"], .STRIKETHROUGH',
      link: 'a[href*="ebay.com/itm"]',
    },
    textFallback: true,
  },
};

/**
 * Display names for HTTP stores (source of truth for names used in output).
 * Parsers and URLs are in http-scraper.cjs.
 */
const HTTP_STORE_NAMES = {
  apple: 'Apple',
  amazon: 'Amazon',
  walmart: 'Walmart',
  newegg: 'Newegg',
  microcenter: 'Micro Center',
  homedepot: 'Home Depot',
};

/**
 * Get store config by key (Playwright/API stores only).
 */
function getStore(key) {
  return STORES[key] || null;
}

/**
 * Get ALL store keys (Playwright/API + HTTP stores).
 */
function getStoreKeys() {
  return [...new Set([...Object.keys(STORES), ...Object.keys(HTTP_STORE_NAMES)])];
}

/**
 * Get display name for any store (Playwright, API, or HTTP).
 */
function getStoreName(key) {
  if (STORES[key]) return STORES[key].name;
  return HTTP_STORE_NAMES[key] || key;
}

/**
 * Get all store configs (Playwright/API stores only).
 */
function getAllStores() {
  return STORES;
}

/**
 * Check if a store uses API or scraping.
 */
function isApiStore(key) {
  const store = STORES[key];
  return store && store.type === 'api' && typeof store.apiSearch === 'function';
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  STORES,
  HTTP_STORE_NAMES,
  getStore,
  getStoreName,
  getStoreKeys,
  verifyBestBuyPrices,
  getAllStores,
  isApiStore,
  searchBestBuy,
  fetchJson,
};
