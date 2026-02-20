'use strict';

/**
 * Deals Skill - HTTP Scraper (No Browser Required)
 *
 * Uses native fetch() + Cheerio to extract prices from server-side rendered stores.
 * 10-20x faster than Playwright since no browser launch or JS rendering needed.
 *
 * Stores handled here: Amazon, Walmart, Newegg, Micro Center, eBay
 * Stores that still need Playwright: Target, B&H Photo
 * Home Depot uses its own GraphQL API (also in this file).
 */

const cheerio = require('cheerio');
const { parsePrice, cleanProductName, calcDiscount, extractSpecsFromName, guessCategory } = require('./utils.cjs');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ============================================================
// HTTP FETCH HELPERS
// ============================================================

/** Status codes worth retrying (transient errors) */
const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Fetch a URL and return the HTML body as text.
 * Uses native Node.js fetch (undici-based, zero deps).
 * Retries once on transient errors (429/5xx) with a 2s backoff.
 */
async function fetchHtml(url, options = {}) {
  const { timeout = 15000, headers = {}, maxRetries = 1 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          ...headers,
        },
        redirect: 'follow',
      });

      if (!res.ok) {
        if (attempt < maxRetries && RETRYABLE_CODES.has(res.status)) {
          clearTimeout(timer);
          const delay = (attempt + 1) * 2000; // 2s first retry
          process.stderr.write(`    [retry] ${res.status} from ${new URL(url).hostname}, retrying in ${delay / 1000}s...\n`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const html = await res.text();

      // Check for bot detection (no size limit -- regex is cheap, CAPTCHA pages can be 40KB+)
      // Only trigger if page is SHORT (< 50KB) -- real product pages with incidental
      // "verify" text in footer/scripts should not be rejected
      const isBotPage = /captcha|verify you are human|access denied|robot check|pardon our interruption|please verify|unusual traffic/i.test(html);
      if (isBotPage && html.length < 50000) {
        if (attempt < maxRetries) {
          clearTimeout(timer);
          process.stderr.write(`    [retry] Bot detection on ${new URL(url).hostname}, retrying in 3s...\n`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw new Error('Bot detection triggered');
      }

      return html;
    } catch (e) {
      clearTimeout(timer);
      // Retry on network errors (ECONNRESET, ETIMEDOUT, abort)
      if (attempt < maxRetries && (e.name === 'AbortError' || /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(e.message))) {
        const delay = (attempt + 1) * 2000;
        process.stderr.write(`    [retry] ${e.message} from ${new URL(url).hostname}, retrying in ${delay / 1000}s...\n`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Decode common HTML entities that appear in data attributes.
 */
function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Normalize a result object to the standard format.
 */
function normalizeResult(raw, storeName, storeKey) {
  const price = parsePrice(raw.price);
  const originalPrice = parsePrice(raw.originalPrice);
  const discount = calcDiscount(price, originalPrice);

  return {
    store: storeName,
    storeKey,
    source: raw.source || 'http',
    name: cleanProductName(decodeEntities(raw.name || '')),
    price,
    originalPrice,
    discountPercent: discount.percent,
    discountAmount: discount.amount,
    url: raw.url || null,
    sku: raw.sku || null,
    reviewScore: raw.reviewScore || null,
    reviewCount: raw.reviewCount || 0,
    image: raw.image || null,
    brand: raw.brand || null,
    model: raw.model || null,
    specs: raw.specs || {},
    description: null,
    category: raw.category || null,
  };
}

// ============================================================
// AMAZON
// ============================================================

function parseAmazon(html, query) {
  const $ = cheerio.load(html);
  const results = [];

  $('[data-component-type="s-search-result"]').each((i, el) => {
    if (i >= 15) return false;
    const $el = $(el);
    const asin = $el.attr('data-asin');
    if (!asin) return;

    // Skip sponsored
    if ($el.find('[data-component-type="sp-sponsored-result"]').length) return;

    // Name + Link: title is in a.s-line-clamp (NOT h2 a)
    const titleLink = $el.find('a[class*="s-line-clamp"]').first();
    let name = titleLink.text().trim();
    // Fallback to older selector
    if (!name) name = $el.find('h2 a span, h2 span.a-text-normal').first().text().trim();
    if (!name || name.length < 10) return;

    let href = titleLink.attr('href') || $el.find('h2 a').first().attr('href') || '';
    if (href && !href.startsWith('http')) href = 'https://www.amazon.com' + href;
    const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/);
    if (asinMatch) href = `https://www.amazon.com/dp/${asinMatch[1]}`;
    else if (asin) href = `https://www.amazon.com/dp/${asin}`;

    // Detect Subscribe & Save / Prime-only pricing
    const elText = $el.text();
    const isSubscribeSave = /subscribe\s*&?\s*save|auto-?delivery|subscription/i.test(elText);
    const isPrimeOnly = /prime\s+(?:price|only|exclusive|member)/i.test(elText)
      || $el.find('[data-a-badge-type="prime-exclusive"]').length > 0;

    // Price: .a-offscreen has the full "$xxx.xx" string (most reliable)
    const price = $el.find('.a-price:not([data-a-strike]) .a-offscreen').first().text().trim();

    // Original price (strikethrough)
    const origText = $el.find('.a-price[data-a-strike] .a-offscreen').first().text().trim();

    // Coupon detection
    const couponText = $el.find('.s-coupon-unclipped, [data-component-type="s-coupon-component"]').first().text();
    const couponMatch = couponText.match(/save\s+(\d+)%|(\$[\d.]+)\s+coupon/i);
    let couponNote = null;
    if (couponMatch) {
      couponNote = couponMatch[0].trim();
    }

    // Rating (multiple fallback selectors for stability)
    let reviewScore = null;
    const ratingSelectors = [
      '.a-icon-star-small .a-icon-alt',
      'i.a-icon-star span.a-icon-alt',
      'i.a-icon-star-mini .a-icon-alt',
      '[data-cy="reviews-ratings-count"]',
      '[data-cy="reviews-block"] .a-icon-alt',
      'a[title*="out of 5"]',
    ];
    for (const sel of ratingSelectors) {
      const ratingEl = $el.find(sel).first();
      const ratingText = ratingEl.text() || ratingEl.attr('title') || '';
      const ratingMatch = ratingText.match(/([\d.]+)\s*out/);
      if (ratingMatch) { reviewScore = parseFloat(ratingMatch[1]); break; }
    }

    // Review count (multiple fallback selectors)
    let reviewCount = 0;
    const countSelectors = [
      'a .a-size-base.s-underline-text',
      'span.a-size-base.s-underline-text',
      '[data-cy="reviews-block"] span.a-size-base',
      'a[href*="customerReviews"] span',
    ];
    for (const sel of countSelectors) {
      const countText = $el.find(sel).first().text();
      const countMatch = countText.match(/([\d,]+)/);
      if (countMatch) { reviewCount = parseInt(countMatch[1].replace(/,/g, '')); break; }
    }

    const image = $el.find('.s-image').first().attr('src') || null;

    if (price) {
      // Add pricing context to name so user knows about conditions
      let pricingNote = '';
      if (isSubscribeSave) pricingNote = ' [Subscribe & Save price]';
      else if (isPrimeOnly) pricingNote = ' [Prime price]';
      if (couponNote && !isSubscribeSave) pricingNote += ` [${couponNote}]`;

      results.push({
        name: name + pricingNote, price, originalPrice: origText || null,
        url: href, reviewScore, reviewCount, image,
        _primeOnly: isPrimeOnly,
        _subscribeSave: isSubscribeSave,
      });
    }
  });

  return results.map(r => normalizeResult(r, 'Amazon', 'amazon'));
}

// ============================================================
// WALMART (__NEXT_DATA__ JSON parsing)
// ============================================================

function parseWalmart(html, query) {
  const results = [];

  // Extract __NEXT_DATA__ JSON (may have nonce or other attributes)
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch) {
    // Fallback to cheerio
    return parseWalmartCheerio(html, query);
  }

  try {
    const data = JSON.parse(nextDataMatch[1]);

    // Navigate to search results
    const searchData = data?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items
      || data?.props?.pageProps?.initialData?.searchResult?.items
      || [];

    for (let i = 0; i < Math.min(searchData.length, 15); i++) {
      const item = searchData[i];
      if (!item || item.__typename === 'AdPlaceholder' || item.isSponsoredFlag) continue;

      const name = item.name || item.title || '';
      if (!name || name.length < 5) continue;

      const priceStr = item.priceInfo?.linePriceDisplay
        || item.priceInfo?.linePrice
        || item.priceInfo?.currentPrice?.priceString
        || null;
      // Skip price ranges (e.g. "$299.99 - $399.99", "$299.99-$399.99", en/em dashes)
      if (priceStr && (/\d\s*[-\u2013\u2014]+\s*\$?\d/.test(priceStr) || priceStr.includes(' to '))) continue;
      const currentPrice = priceStr ? priceStr.replace(/[^0-9.]/g, '') : null;
      const wasPriceStr = item.priceInfo?.wasPrice || '';
      const wasPrice = wasPriceStr && wasPriceStr.length > 1 ? wasPriceStr.replace(/[^0-9.]/g, '') : null;

      let url = item.canonicalUrl || item.productPageUrl || '';
      if (url && !url.startsWith('http')) url = 'https://www.walmart.com' + url;

      const reviewScore = item.averageRating || null;
      const reviewCount = item.numberOfReviews || 0;
      const image = item.imageInfo?.thumbnailUrl || item.image || null;

      if (currentPrice) {
        results.push(normalizeResult({
          name,
          price: `$${currentPrice}`,
          originalPrice: wasPrice ? `$${wasPrice}` : null,
          url,
          reviewScore,
          reviewCount,
          image,
        }, 'Walmart', 'walmart'));
      }
    }
  } catch (e) {
    // JSON parse failed, fallback
    return parseWalmartCheerio(html, query);
  }

  return results;
}

function parseWalmartCheerio(html, query) {
  const $ = cheerio.load(html);
  const results = [];

  $('[data-item-id]').each((i, el) => {
    if (i >= 15) return false;
    const $el = $(el);
    const name = $el.find('[data-automation-id="product-title"], span[data-automation-id="product-title"]').first().text().trim();
    const price = $el.find('[data-automation-id="product-price"] span, [itemprop="price"]').first().text().trim();
    let href = $el.find('a[link-identifier]').first().attr('href') || '';
    if (href && !href.startsWith('http')) href = 'https://www.walmart.com' + href;

    if (name && price) {
      results.push(normalizeResult({ name, price, url: href }, 'Walmart', 'walmart'));
    }
  });

  return results;
}

// ============================================================
// NEWEGG
// ============================================================

function parseNewegg(html, query) {
  const $ = cheerio.load(html);
  const results = [];

  $('.item-cell, .item-container').each((i, el) => {
    if (i >= 15) return false;
    const $el = $(el);

    // Skip sponsored
    if ($el.find('.item-sponsored-box').length) return;

    const name = $el.find('.item-title').first().text().trim();
    if (!name || name.length < 10) return;

    // Price: combine strong (dollars) and sup (cents)
    const priceDollars = $el.find('.price-current strong').first().text().trim();
    const priceCents = $el.find('.price-current sup').first().text().trim();
    const price = priceDollars ? `$${priceDollars}${priceCents}` : null;

    const wasPrice = $el.find('.price-was-data').first().text().trim() || null;

    let href = $el.find('.item-title').first().attr('href') || '';

    // Rating
    const ratingEl = $el.find('.item-rating');
    let reviewScore = null;
    const ratingTitle = ratingEl.attr('title') || '';
    const ratingMatch = ratingTitle.match(/([\d.]+)\s*out/);
    if (ratingMatch) reviewScore = parseFloat(ratingMatch[1]);

    const countText = $el.find('.item-rating-num').first().text();
    const countMatch = countText.match(/\(([\d,]+)\)/);
    const reviewCount = countMatch ? parseInt(countMatch[1].replace(/,/g, '')) : 0;

    const image = $el.find('.item-img img').first().attr('src') || null;

    if (price) {
      results.push(normalizeResult({
        name, price, originalPrice: wasPrice, url: href,
        reviewScore, reviewCount, image,
      }, 'Newegg', 'newegg'));
    }
  });

  return results;
}

// ============================================================
// MICRO CENTER
// ============================================================

function parseMicroCenter(html, query) {
  const $ = cheerio.load(html);
  const results = [];

  $('.product_wrapper').each((i, el) => {
    if (i >= 15) return false;
    const $el = $(el);

    // Best source: data attributes on a.productClickItemV2
    const productLink = $el.find('a.productClickItemV2').first();
    const name = productLink.attr('data-name') || '';
    if (!name || name.length < 10) return;

    const dataPrice = productLink.attr('data-price');
    const brand = productLink.attr('data-brand') || null;
    const category = productLink.attr('data-category') || null;

    let href = productLink.attr('href') || '';
    if (href && !href.startsWith('http')) href = 'https://www.microcenter.com' + href;

    // Price from data attribute (most reliable), fallback to itemprop
    let priceText = dataPrice ? `$${dataPrice}` : null;
    if (!priceText) {
      const priceEl = $el.find('[itemprop="price"]').first().clone();
      priceEl.find('.sr-only').remove();
      priceText = priceEl.text().trim().replace(/^Our price\s*/i, '');
    }

    const origText = $el.find('.price del, .price .original, .was-price').first().text().trim();

    const image = $el.find('img.SearchResultProductImage').first().attr('src') || null;

    // SKU
    const skuRaw = $el.find('.sku').first().text().trim();
    const skuMatch = skuRaw.match(/SKU:\s*(\d+)/);
    const sku = skuMatch ? skuMatch[1] : null;

    // In-store only detection
    const elText = $el.text().toLowerCase();
    const isInStoreOnly = /\bin[- ]store\s+only\b/i.test(elText)
      || $el.find('.in-store-only, .inStoreOnly, [data-availability="inStoreOnly"]').length > 0
      || (/\bin[- ]store\b/.test(elText) && !/\bonline\b/.test(elText) && /\bpick\s*up\b/.test(elText));

    // Review data
    const reviewEl = $el.find('.reviewInfo, .review-info, [itemprop="ratingValue"]');
    let reviewScore = null;
    let reviewCount = 0;
    const mcRatingVal = reviewEl.find('[itemprop="ratingValue"]').attr('content') || reviewEl.text().match(/([\d.]+)\s*(?:out|\/)/)?.[1];
    if (mcRatingVal) reviewScore = parseFloat(mcRatingVal);
    const mcCountMatch = $el.text().match(/(\d+)\s*review/i);
    if (mcCountMatch) reviewCount = parseInt(mcCountMatch[1]);

    if (priceText) {
      const storeSuffix = isInStoreOnly ? ' [In-Store Only]' : '';
      results.push(normalizeResult({
        name: name + storeSuffix, price: priceText, originalPrice: origText || null, url: href,
        image, sku, brand, category, reviewScore, reviewCount,
      }, 'Micro Center', 'microcenter'));
    }
  });

  return results;
}

// ============================================================
// APPLE STORE (pageLevelData JSON extraction)
// ============================================================

function parseApple(html, query) {
  const results = [];

  // Apple embeds structured product data in pageLevelData.searchResults.searchData
  const match = html.match(/window\.pageLevelData\.searchResults\.searchData\s*=\s*({[\s\S]*?});/);
  if (!match) {
    // Fallback: try to extract product links + prices from HTML directly
    return parseAppleCheerio(html, query);
  }

  try {
    const data = JSON.parse(match[1]);

    // Navigate to tiles: results.accessories.accessories.tiles.items
    // Structure may vary by search category (accessories, mac, ipad, etc.)
    const sections = data.results || {};
    let allTiles = [];

    for (const [sectionKey, sectionVal] of Object.entries(sections)) {
      const tiles = sectionVal?.[sectionKey]?.tiles?.items
        || sectionVal?.tiles?.items
        || [];
      allTiles.push(...tiles);
    }

    if (allTiles.length === 0) return [];

    const seenParts = new Set(); // dedup color variants by base part number
    for (let i = 0; i < allTiles.length; i++) {
      const v = allTiles[i].value;
      if (!v || !v.title) continue;

      const title = v.title;
      const price = v.productPrice;
      const priceCurrent = price?.priceCurrent || null;
      const pricePrevious = price?.pricePrevious || null;

      if (!priceCurrent) continue;

      // Dedup color variants: use basePartNumber to collapse
      const basePart = v.basePartNumber || v.partNumber || '';
      if (basePart && seenParts.has(basePart)) continue;
      if (basePart) seenParts.add(basePart);

      let url = v.link?.url || '';
      if (url) {
        // Strip fnode tracking param, build full URL
        url = url.split('?')[0];
        if (!url.startsWith('http')) url = 'https://www.apple.com' + url;
      }

      const image = v.productImages?.items?.[0]?.value?.sources?.[0]?.srcSet || null;

      results.push(normalizeResult({
        name: title.replace(/\s*—\s*/g, ' - '), // normalize em dashes
        price: priceCurrent,
        originalPrice: pricePrevious,
        url: url || null,
        sku: v.partNumber || null,
        image,
        brand: /\b(beats|airpods|apple|earpods)\b/i.test(title) ? 'Apple' : null,
        source: 'http',
      }, 'Apple', 'apple'));
    }
  } catch (e) {
    process.stderr.write(`  [Apple] JSON parse error: ${e.message}\n`);
    return parseAppleCheerio(html, query);
  }

  return results;
}

function parseAppleCheerio(html, query) {
  const $ = cheerio.load(html);
  const results = [];

  // Fallback: extract from product links in the page
  $('a[href*="/shop/product/"], a[href*="/shop/buy-"]').each((i, el) => {
    if (results.length >= 15) return false;
    const $a = $(el);
    const name = $a.text().trim();
    if (!name || name.length < 5) return;

    let href = $a.attr('href') || '';
    if (href && !href.startsWith('http')) href = 'https://www.apple.com' + href.split('?')[0];

    // Price is not in static HTML for Apple (JS-rendered), skip priceless items
    results.push(normalizeResult({
      name,
      price: null,
      url: href,
      brand: 'Apple',
      source: 'http',
    }, 'Apple', 'apple'));
  });

  return results.filter(r => r.price);
}

// ============================================================
// EBAY
// ============================================================

function parseEbay(html, query) {
  const $ = cheerio.load(html);
  const results = [];

  // eBay redesigned DOM in late 2024: .s-item -> .s-card
  $('li.s-card').each((i, el) => {
    if (results.length >= 15) return false;
    const $el = $(el);

    // Name: .s-card__title (strip "Opens in a new window or tab" suffix)
    let name = $el.find('.s-card__title').first().text().trim();
    if (!name || name.length < 10 || name === 'Shop on eBay') return;
    name = name.replace(/Opens in a new window or tab$/i, '').trim();

    // Price: .s-card__price
    const price = $el.find('.s-card__price').first().text().trim();
    if (!price) return;
    if (price.includes(' to ')) return; // skip ranges

    // Link: <a> pointing to ebay.com/itm/
    let href = $el.find('a[href*="ebay.com/itm"]').first().attr('href') || '';
    if (href.includes('?')) href = href.split('?')[0];

    // Original price (strikethrough)
    const origPrice = $el.find('[class*="strikethrough"], .STRIKETHROUGH').first().text().trim() || null;

    // Image
    const image = $el.find('img').first().attr('src') || null;

    // Condition detection (new/refurb/used/open box)
    const conditionEl = $el.find('.s-card__subtitle, [class*="condition"], .SECONDARY_INFO').first().text().toLowerCase();
    let condition = 'New'; // default for Buy It Now
    if (/refurbished|refurb|renewed|certified\s+refurb/i.test(conditionEl) || /refurbished|refurb|renewed/i.test(name.toLowerCase())) {
      condition = 'Refurbished';
    } else if (/open\s*box/i.test(conditionEl) || /open\s*box/i.test(name.toLowerCase())) {
      condition = 'Open Box';
    } else if (/\bused\b|pre-?owned/i.test(conditionEl) || /\bused\b|pre-?owned/i.test(name.toLowerCase())) {
      condition = 'Used';
    } else if (/\bparts\b|for parts|not working/i.test(conditionEl)) {
      condition = 'For Parts';
    }

    // "Best Offer" detection - skip these as price is not firm
    const isBestOffer = /\bbest\s+offer\b|or\s+best\s+offer\b/i.test($el.text());

    if (price && !isBestOffer) {
      const conditionTag = condition !== 'New' ? ` [${condition}]` : '';
      results.push(normalizeResult({
        name: name + conditionTag, price, originalPrice: origPrice, url: href, image,
      }, 'eBay', 'ebay'));
    }
  });

  // Fallback to old .s-item selectors if .s-card found nothing
  if (results.length === 0) {
    $('.s-item').each((i, el) => {
      if (results.length >= 15) return false;
      const $el = $(el);
      if ($el.hasClass('s-item--ad')) return;
      let name = $el.find('.s-item__title span, .s-item__title').first().text().trim();
      if (!name || name.length < 10 || name === 'Shop on eBay') return;
      const price = $el.find('.s-item__price').first().text().trim();
      if (!price || price.includes(' to ')) return;
      let href = $el.find('.s-item__link').first().attr('href') || '';
      if (href.includes('?')) href = href.split('?')[0];
      const image = $el.find('.s-item__image-img').first().attr('src') || null;

      // Condition detection (legacy selectors)
      const condText = $el.find('.SECONDARY_INFO, .s-item__subtitle').first().text().toLowerCase();
      let condition = 'New';
      if (/refurbished|refurb|renewed/i.test(condText) || /refurbished|refurb|renewed/i.test(name.toLowerCase())) condition = 'Refurbished';
      else if (/open\s*box/i.test(condText)) condition = 'Open Box';
      else if (/\bused\b|pre-?owned/i.test(condText)) condition = 'Used';
      const conditionTag = condition !== 'New' ? ` [${condition}]` : '';

      // Skip best offer
      if (/\bbest\s+offer\b/i.test($el.text())) return;

      results.push(normalizeResult({ name: name + conditionTag, price, url: href, image }, 'eBay', 'ebay'));
    });
  }

  return results;
}

// ============================================================
// HOME DEPOT (GraphQL API)
// ============================================================

async function searchHomeDepot(query, limit = 5) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    // Home Depot GraphQL endpoint
    const url = 'https://apionline.homedepot.com/federation-gateway/graphql?opname=searchModel';

    const graphqlQuery = {
      operationName: 'searchModel',
      variables: {
        keyword: query,
        navParam: '',
        storefilter: 'ALL',
        itemCount: limit,
        startIndex: 0,
      },
      query: `query searchModel($keyword: String!, $navParam: String, $storefilter: StoreFilter, $itemCount: Int, $startIndex: Int) {
        searchModel(keyword: $keyword, navParam: $navParam, storefilter: $storefilter, itemCount: $itemCount, startIndex: $startIndex) {
          products {
            itemId
            dataSources
            identifiers {
              brandName
              modelNumber
              productLabel
              canonicalUrl
            }
            pricing {
              value
              original
              percentageOff
              promotion {
                dollarOff
                percentOff
              }
            }
            media {
              images {
                url
              }
            }
            reviews {
              ratingsReviews {
                averageRating
                totalReviews
              }
            }
          }
        }
      }`
    };

    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'Origin': 'https://www.homedepot.com',
        'Referer': 'https://www.homedepot.com/',
        'x-experience-name': 'general-merchandise',
        'x-current-url': `/s/${encodeURIComponent(query)}`,
      },
      body: JSON.stringify(graphqlQuery),
    });

    if (!res.ok) {
      throw new Error(`GraphQL HTTP ${res.status}`);
    }

    const data = await res.json();
    const products = data?.data?.searchModel?.products || [];

    return products.slice(0, limit).map(p => {
      const price = p.pricing?.value;
      const originalPrice = p.pricing?.original;
      let productUrl = p.identifiers?.canonicalUrl || '';
      if (productUrl && !productUrl.startsWith('http')) {
        productUrl = 'https://www.homedepot.com' + productUrl;
      }

      return normalizeResult({
        name: p.identifiers?.productLabel || '',
        price: price ? `$${price}` : null,
        originalPrice: originalPrice ? `$${originalPrice}` : null,
        url: productUrl,
        sku: p.itemId || null,
        reviewScore: p.reviews?.ratingsReviews?.averageRating || null,
        reviewCount: p.reviews?.ratingsReviews?.totalReviews || 0,
        brand: p.identifiers?.brandName || null,
        model: p.identifiers?.modelNumber || null,
        image: p.media?.images?.[0]?.url || null,
        source: 'graphql',
      }, 'Home Depot', 'homedepot');
    }).filter(r => r.price != null);

  } catch (e) {
    console.error(`[Home Depot] GraphQL error: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// MAIN: SEARCH ALL HTTP STORES IN PARALLEL
// ============================================================

/**
 * Store configs for HTTP scraping.
 * Maps store key -> { searchUrl, parser }
 */
const HTTP_STORES = {
  amazon: {
    name: 'Amazon',
    searchUrl: (q, opts = {}) => {
      let url = `https://www.amazon.com/s?k=${encodeURIComponent(q)}`;
      // Amazon price range filter uses cents: rh=p_36:min-max
      if (opts.minPrice || opts.maxPrice) {
        const lo = opts.minPrice ? Math.round(opts.minPrice * 100) : '';
        const hi = opts.maxPrice ? Math.round(opts.maxPrice * 100) : '';
        url += `&rh=p_36:${lo}-${hi}`;
      }
      return url;
    },
    parser: parseAmazon,
  },
  walmart: {
    name: 'Walmart',
    searchUrl: (q, opts = {}) => {
      let url = `https://www.walmart.com/search?q=${encodeURIComponent(q)}`;
      if (opts.minPrice) url += `&min_price=${opts.minPrice}`;
      if (opts.maxPrice) url += `&max_price=${opts.maxPrice}`;
      return url;
    },
    parser: parseWalmart,
  },
  newegg: {
    name: 'Newegg',
    searchUrl: (q, opts = {}) => {
      let url = `https://www.newegg.com/p/pl?d=${encodeURIComponent(q)}`;
      if (opts.minPrice || opts.maxPrice) {
        const lo = opts.minPrice || 0;
        const hi = opts.maxPrice || 999999;
        url += `&PriceRange=${lo}+${hi}`;
      }
      return url;
    },
    parser: parseNewegg,
  },
  microcenter: {
    name: 'Micro Center',
    searchUrl: (q, opts = {}) => `https://www.microcenter.com/search/search_results.aspx?Ntt=${encodeURIComponent(q)}`,
    parser: parseMicroCenter,
  },
  apple: {
    name: 'Apple',
    searchUrl: (q, opts = {}) => `https://www.apple.com/shop/search/${encodeURIComponent(q)}`,
    parser: parseApple,
  },
  // ebay: moved to Playwright (bot detection blocks HTTP requests)
};

/**
 * Search a single HTTP store.
 * @returns {{ results: object[], error: string|null }}
 */
async function searchHttpStore(storeKey, query, limit = 5, priceOpts = {}) {
  const config = HTTP_STORES[storeKey];
  if (!config) return { results: [], error: `Unknown HTTP store: ${storeKey}` };

  const t0 = Date.now();
  try {
    const url = config.searchUrl(query, priceOpts);
    const html = await fetchHtml(url);
    const results = config.parser(html, query).slice(0, limit);
    const elapsed = Date.now() - t0;
    process.stderr.write(`  ${config.name}: ${results.length} results (${elapsed}ms)\n`);
    return { results, error: null };
  } catch (e) {
    const elapsed = Date.now() - t0;
    process.stderr.write(`  ${config.name}: error (${elapsed}ms) - ${e.message}\n`);
    return { results: [], error: e.message };
  }
}

/**
 * Search all HTTP stores + Home Depot GraphQL in parallel.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {string[]} [options.stores] - specific store keys to search (default: all)
 * @param {number} [options.limit=5] - max results per store
 * @returns {{ results: object[], errors: object[] }}
 */
async function searchAllHttp(query, options = {}) {
  const { stores: storeFilter, limit = 5, minPrice, maxPrice } = options;
  const priceOpts = {};
  if (minPrice) priceOpts.minPrice = minPrice;
  if (maxPrice) priceOpts.maxPrice = maxPrice;

  // Determine which HTTP stores to search
  let httpKeys = Object.keys(HTTP_STORES);
  if (storeFilter) {
    httpKeys = httpKeys.filter(k => storeFilter.includes(k));
  }

  // Build promises
  const promises = [];
  const promiseLabels = [];

  for (const key of httpKeys) {
    promises.push(searchHttpStore(key, query, limit, priceOpts));
    promiseLabels.push(key);
  }

  // Home Depot: DISABLED -- Akamai Bot Manager blocks both GraphQL API and Playwright.
  // Their anti-bot requires solving JS sensor challenges that headless Chrome cannot pass.
  // Re-enable if/when a bypass is found (e.g., residential proxy, eBay Browse API pattern).
  // const hdIncluded = storeFilter ? storeFilter.includes('homedepot') : true;

  // Fire all in parallel
  const t0 = Date.now();
  process.stderr.write(`\n  [HTTP] Searching ${promises.length} stores in parallel...\n`);
  const settled = await Promise.allSettled(promises);
  const totalElapsed = Date.now() - t0;
  process.stderr.write(`  [HTTP] All done in ${totalElapsed}ms\n`);

  // Collect results and errors
  const allResults = [];
  const allErrors = [];

  settled.forEach((outcome, i) => {
    const label = promiseLabels[i];
    if (outcome.status === 'fulfilled') {
      const { results, error } = outcome.value;
      allResults.push(...results);
      if (error) allErrors.push({ store: HTTP_STORES[label]?.name || 'Home Depot', storeKey: label, error });
    } else {
      allErrors.push({ store: HTTP_STORES[label]?.name || 'Home Depot', storeKey: label, error: outcome.reason?.message || 'Unknown error' });
    }
  });

  return { results: allResults, errors: allErrors };
}

/**
 * Get list of store keys handled by HTTP scraper.
 */
function getHttpStoreKeys() {
  // homedepot removed: Akamai Bot Manager blocks all scraping methods
  return [...Object.keys(HTTP_STORES)];
}

// ============================================================
// CAMELCAMELCAMEL PRICE HISTORY (Amazon ASINs)
// ============================================================

/**
 * Fetch CamelCamelCamel price history for an Amazon ASIN.
 * Returns { allTimeLow, allTimeHigh, currentVsLow, chartUrl } or null.
 * @param {string} asin - Amazon ASIN (e.g., "B0CVPMF4HQ")
 */
async function fetchCamelHistory(asin) {
  if (!asin || asin.length !== 10) return null;

  try {
    const url = `https://camelcamelcamel.com/product/${asin}`;
    const html = await fetchHtml(url, { timeout: 8000, headers: {
      'User-Agent': UA,
      'Accept': 'text/html',
    }});

    // Extract price data from the page
    // CCC shows "Lowest Price" and "Highest Price" in structured sections
    const lowestMatch = html.match(/Lowest(?:\s+Amazon)?\s+Price[:\s]*\$?([\d,]+\.?\d*)/i);
    const highestMatch = html.match(/Highest(?:\s+Amazon)?\s+Price[:\s]*\$?([\d,]+\.?\d*)/i);
    const currentMatch = html.match(/Current(?:\s+Amazon)?\s+Price[:\s]*\$?([\d,]+\.?\d*)/i);

    if (!lowestMatch && !highestMatch) return null;

    const allTimeLow = lowestMatch ? parseFloat(lowestMatch[1].replace(/,/g, '')) : null;
    const allTimeHigh = highestMatch ? parseFloat(highestMatch[1].replace(/,/g, '')) : null;
    const currentCCC = currentMatch ? parseFloat(currentMatch[1].replace(/,/g, '')) : null;

    return {
      allTimeLow,
      allTimeHigh,
      currentCCC,
      chartUrl: `https://charts.camelcamelcamel.com/us/${asin}/amazon.png?force=1&zero=0&w=400&h=150&desired=false&legend=1&ilt=1&tp=all&fo=0`,
      productUrl: url,
    };
  } catch (e) {
    // CCC may block or rate limit - fail silently
    return null;
  }
}

/**
 * Enrich Amazon results with CamelCamelCamel price history.
 * Checks top N Amazon results in parallel.
 * @param {object[]} results - normalized results (must have storeKey='amazon' and url with ASIN)
 * @param {number} [maxCheck=3] - max results to check
 */
async function enrichWithCamelHistory(results, maxCheck = 3) {
  const amazonResults = results
    .filter(r => r.storeKey === 'amazon' && r.url)
    .slice(0, maxCheck);

  if (amazonResults.length === 0) return;

  const promises = amazonResults.map(async (r) => {
    const asinMatch = r.url.match(/\/dp\/([A-Z0-9]{10})/);
    if (!asinMatch) return;
    const asin = asinMatch[1];

    const history = await fetchCamelHistory(asin);
    if (history) {
      r._camelHistory = history;
    }
  });

  await Promise.allSettled(promises);
}

// ============================================================
// NEWEGG REALTIME API (review enrichment)
// ============================================================

/**
 * Fetch Newegg review data via their product realtime API.
 * @param {string} itemNumber - Newegg item number (from URL path)
 */
async function fetchNeweggReviews(itemNumber) {
  if (!itemNumber) return null;

  try {
    const url = `https://www.newegg.com/product/api/ProductRealtime?ItemNumber=${itemNumber}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': `https://www.newegg.com/p/${itemNumber}`,
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();

    const rating = data?.ReviewSummary?.Rating;
    const totalReviews = data?.ReviewSummary?.TotalReviews;

    if (rating != null && totalReviews != null) {
      return { reviewScore: parseFloat(rating), reviewCount: parseInt(totalReviews) };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Enrich Newegg results with review data from their Realtime API.
 * @param {object[]} results - normalized results
 * @param {number} [maxCheck=5] - max results to enrich
 */
async function enrichNeweggReviews(results, maxCheck = 5) {
  const neweggResults = results
    .filter(r => r.storeKey === 'newegg' && r.url && (!r.reviewScore || r.reviewCount === 0))
    .slice(0, maxCheck);

  if (neweggResults.length === 0) return;

  const promises = neweggResults.map(async (r) => {
    // Extract item number from Newegg URL: /p/XXX or /Product/Product.aspx?Item=XXX
    const itemMatch = r.url.match(/\/p\/([A-Z0-9-]+)/i) || r.url.match(/Item=([A-Z0-9-]+)/i);
    if (!itemMatch) return;

    const reviews = await fetchNeweggReviews(itemMatch[1]);
    if (reviews) {
      r.reviewScore = reviews.reviewScore;
      r.reviewCount = reviews.reviewCount;
      process.stderr.write(`  [newegg] Enriched reviews for "${(r.name || '').substring(0, 40)}": ${reviews.reviewScore} (${reviews.reviewCount})\n`);
    }
  });

  await Promise.allSettled(promises);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  fetchHtml,
  parseAmazon,
  parseWalmart,
  parseNewegg,
  parseMicroCenter,
  parseEbay,
  parseApple,
  searchHomeDepot,
  searchHttpStore,
  searchAllHttp,
  getHttpStoreKeys,
  HTTP_STORES,
  fetchCamelHistory,
  enrichWithCamelHistory,
  fetchNeweggReviews,
  enrichNeweggReviews,
};
