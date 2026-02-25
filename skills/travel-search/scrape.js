#!/usr/bin/env node
/**
 * Travel Search Puppeteer Scraper v3.14
 *
 * v3.14 changes:
 * - Fetch full amenities from individual Airbnb listing pages
 * - Display premium amenities (pool, hot tub, waterfront, game room, resort)
 * - Re-rank listings by premium amenities
 * - Add --amenities filter for required amenities (e.g., --amenities "pool,hot tub")
 * - Use --no-amenities to skip individual page scraping for faster results
 *
 * v3.13 changes:
 * - Shorter centered section separators (10/8 chars)
 *
 * v3.12 changes:
 * - Remove ✅ checkmarks from RECOMMENDED section
 * - Add ═══ double line after RECOMMENDED
 * - Add ─── single lines between each section (flights, hotels, airbnbs)
 *
 * v3.11 changes:
 * - Exclude long flights (>14h) from Best Deal recommendations
 * - Flag long flights with ⚠️LONG warning
 * - Tax-adjusted budget calc (~20% estimate)
 * - Limit Airbnbs to 5 (was 6)
 *
 * v3.10 changes:
 * - Per-night pricing on Airbnbs: "$2,972 ($495/n)"
 * - Tax disclaimer: Flights include taxes, hotels/Airbnbs don't
 *
 * Improvements from v2.0:
 * 1. puppeteer-extra with stealth plugin for bot detection avoidance
 * 2. Retry logic with exponential backoff for transient failures
 * 3. Price validation and filtering for invalid/excessive prices
 * 4. Bidirectional flexible dates (-N to +N days)
 * 5. Parallel window searches (2-3 concurrent browser contexts)
 * 6. Comprehensive IATA airport code lookup from JSON
 * 7. Validation warnings for fallback selectors
 *
 * Target: 15-30 seconds total execution time
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

// Apply stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());

// Price caching module (optional - fails gracefully if not available)
let priceCache = null;
try {
  priceCache = require('./price_cache.js');
} catch (e) {
  console.error('[Cache] Price cache module not available, running without caching');
}

// Chrome-based Airbnb scraper (hybrid approach - uses user's logged-in session)
let chromeAirbnb = null;
try {
  chromeAirbnb = require('./chrome_airbnb.js');
  console.error('[Airbnb] Chrome scraper loaded (hybrid mode enabled)');
} catch (e) {
  console.error('[Airbnb] Chrome scraper not available, using puppeteer fallback');
}

// Puppeteer-based Google Hotels scraper (4+ star luxury hotels)
let puppeteerHotels = null;
try {
  puppeteerHotels = require('./puppeteer_hotels.js');
  console.error('[Hotels] Puppeteer scraper loaded');
} catch (e) {
  console.error('[Hotels] Hotels scraper not available');
}

// Transportation recommendations module
let transportModule = null;
try {
  transportModule = require('./transportation.js');
  console.error('[Transport] Transportation module loaded');
} catch (e) {
  console.error('[Transport] Transportation module not available');
}

// Load comprehensive airport codes
let airportData = { cities: {}, airports: {} };
try {
  const airportPath = path.join(__dirname, 'airport_codes.json');
  airportData = JSON.parse(fs.readFileSync(airportPath, 'utf8'));
  console.error(`[Airports] Loaded ${Object.keys(airportData.cities).length} cities, ${Object.keys(airportData.airports).length} airports`);
} catch (e) {
  console.error('[Airports] Could not load airport_codes.json, using fallback lookup');
}

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  headless: 'new',
  timeout: 30000,
  userAgents: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ],
  flights: {
    maxResults: 5,
    waitTimeout: 12000
  },
  airbnb: {
    maxResults: 10,
    waitTimeout: 10000
  },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'TimeoutError', 'net::ERR_']
  },
  flexibleSearch: {
    maxConcurrent: 3,         // Max concurrent browser contexts for flex search
    staggerDelayMs: 2000      // Delay between starting searches
  },
  selectors: {
    fallbackThreshold: 3      // Log warning when using selector at index >= this
  }
};

// =============================================================================
// Retry Logic with Exponential Backoff
// =============================================================================

function isRetryableError(error) {
  const errorString = error.message || error.toString();

  // Check for retryable error patterns
  for (const pattern of CONFIG.retry.retryableErrors) {
    if (errorString.includes(pattern)) {
      return true;
    }
  }

  // Check for HTTP status codes in error
  for (const code of CONFIG.retry.retryableStatusCodes) {
    if (errorString.includes(`${code}`) || errorString.includes(`HTTP ${code}`)) {
      return true;
    }
  }

  return false;
}

function calculateBackoff(attempt) {
  const delay = CONFIG.retry.baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * delay;  // Add up to 30% jitter
  return Math.min(delay + jitter, CONFIG.retry.maxDelayMs);
}

async function withRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts || CONFIG.retry.maxAttempts;
  const name = options.name || 'operation';

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !isRetryableError(error)) {
        throw error;
      }

      const backoffMs = calculateBackoff(attempt);
      console.error(`[Retry:${name}] Attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
      console.error(`[Retry:${name}] Waiting ${Math.round(backoffMs)}ms before retry...`);

      await sleep(backoffMs);
    }
  }

  throw lastError;
}

// =============================================================================
// Utility Functions
// =============================================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getRandomUA() {
  return CONFIG.userAgents[Math.floor(Math.random() * CONFIG.userAgents.length)];
}

function parsePrice(text) {
  if (!text) return 0;
  const match = text.match(/[\d,]+\.?\d*/);
  return match ? parseFloat(match[0].replace(/,/g, '')) : 0;
}

function formatDuration(minutes) {
  if (!minutes) return 'N/A';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
}

function getAirportCode(destination) {
  const destLower = destination.toLowerCase().split(',')[0].trim();

  // Check comprehensive airport data first
  if (airportData.cities[destLower]) {
    const codes = airportData.cities[destLower];
    const code = Array.isArray(codes) ? codes[0] : codes;
    console.error(`[Airports] Found ${destLower} -> ${code}`);
    return code;
  }

  // Check if it's already an airport code
  if (destLower.length === 3 && airportData.airports[destLower.toUpperCase()]) {
    return destLower.toUpperCase();
  }

  // Fallback: use first 3 letters (with warning)
  const fallback = destination.toUpperCase().slice(0, 3);
  console.error(`[Airports] WARNING: Using fallback for "${destination}" -> ${fallback}. Consider adding to airport_codes.json`);
  return fallback;
}

function validateAirportCode(code) {
  if (airportData.airports[code]) {
    return { valid: true, airport: airportData.airports[code] };
  }
  console.error(`[Airports] WARNING: Airport code "${code}" not found in database, may be invalid`);
  return { valid: false, airport: null };
}

// =============================================================================
// Price Validation
// =============================================================================

const PRICE_LIMITS = {
  flight: {
    min: 1,           // Minimum valid flight price ($1)
    max: 50000,       // Maximum valid flight price ($50k)
    warnAbove: 10000  // Warn if flight price exceeds this
  },
  airbnb: {
    min: 1,           // Minimum valid per-night price ($1)
    maxPerNight: 10000, // Maximum valid per-night price ($10k)
    maxTotal: 50000,  // Maximum valid total price ($50k)
    warnAbove: 10000  // Warn if total exceeds this
  },
  total: {
    max: 50000,       // Maximum valid total trip cost
    warnAbove: 10000  // Warn if total exceeds this
  }
};

/**
 * Validate and filter flight results
 * Removes obviously invalid prices ($0, >$50k)
 * Warns on suspiciously high prices (>$10k)
 */
function validateFlightResults(flights) {
  const validFlights = [];
  let filtered = 0;

  for (const flight of flights) {
    // Skip error entries
    if (flight.error) {
      validFlights.push(flight);
      continue;
    }

    // Filter out $0 or negative prices
    if (!flight.price || flight.price <= 0) {
      console.error(`[Validation] Filtered flight with invalid price: $${flight.price} (${flight.airline})`);
      filtered++;
      continue;
    }

    // Filter out unreasonably high prices
    if (flight.price > PRICE_LIMITS.flight.max) {
      console.error(`[Validation] Filtered flight with excessive price: $${flight.price} (${flight.airline})`);
      filtered++;
      continue;
    }

    // Warn on high but valid prices
    if (flight.price > PRICE_LIMITS.flight.warnAbove) {
      console.error(`[Validation] WARNING: High flight price: $${flight.price} (${flight.airline})`);
    }

    validFlights.push(flight);
  }

  if (filtered > 0) {
    console.error(`[Validation] Filtered ${filtered} flights with invalid prices`);
  }

  return validFlights;
}

/**
 * Validate and filter Airbnb results
 * Removes obviously invalid prices ($0, >$50k total)
 * Warns on suspiciously high prices (>$10k)
 */
function validateAirbnbResults(listings) {
  const validListings = [];
  let filtered = 0;

  for (const listing of listings) {
    // Skip error entries
    if (listing.error) {
      validListings.push(listing);
      continue;
    }

    // Filter out $0 or negative prices
    if (!listing.priceTotal || listing.priceTotal <= 0) {
      console.error(`[Validation] Filtered Airbnb with invalid price: $${listing.priceTotal} (${listing.name?.substring(0, 30)})`);
      filtered++;
      continue;
    }

    // Filter out unreasonably high total prices
    if (listing.priceTotal > PRICE_LIMITS.airbnb.maxTotal) {
      console.error(`[Validation] Filtered Airbnb with excessive total: $${listing.priceTotal}`);
      filtered++;
      continue;
    }

    // Filter out unreasonably high per-night prices
    if (listing.pricePerNight && listing.pricePerNight > PRICE_LIMITS.airbnb.maxPerNight) {
      console.error(`[Validation] Filtered Airbnb with excessive per-night: $${listing.pricePerNight}/night`);
      filtered++;
      continue;
    }

    // Warn on high but valid prices
    if (listing.priceTotal > PRICE_LIMITS.airbnb.warnAbove) {
      console.error(`[Validation] WARNING: High Airbnb total: $${listing.priceTotal} (${listing.name?.substring(0, 30)})`);
    }

    validListings.push(listing);
  }

  if (filtered > 0) {
    console.error(`[Validation] Filtered ${filtered} Airbnb listings with invalid prices`);
  }

  return validListings;
}

/**
 * Validate total trip cost and warn if excessive
 */
function validateTotalCost(flightPrice, airbnbPrice) {
  const total = (flightPrice || 0) + (airbnbPrice || 0);

  if (total > PRICE_LIMITS.total.max) {
    console.error(`[Validation] WARNING: Total trip cost ($${total}) exceeds maximum ($${PRICE_LIMITS.total.max})`);
    return { valid: false, total, message: 'Total exceeds maximum valid price' };
  }

  if (total > PRICE_LIMITS.total.warnAbove) {
    console.error(`[Validation] WARNING: High total trip cost: $${total}`);
  }

  return { valid: true, total };
}

function offsetDate(dateStr, days) {
  // Use UTC to avoid timezone boundary issues
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Generate bidirectional date windows (-N to +N days)
 * Example: flexDays=3 generates 7 windows: -3, -2, -1, 0, +1, +2, +3
 */
function generateDateWindows(baseCheckin, baseCheckout, flexDays) {
  const baseIn = new Date(baseCheckin);
  const baseOut = new Date(baseCheckout);
  const nights = Math.ceil((baseOut - baseIn) / (1000 * 60 * 60 * 24));

  const windows = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Generate windows from -flexDays to +flexDays
  for (let i = -flexDays; i <= flexDays; i++) {
    const checkin = offsetDate(baseCheckin, i);
    const checkinDate = new Date(checkin);

    // Skip dates in the past
    if (checkinDate < today) {
      continue;
    }

    const checkout = offsetDate(checkin, nights);
    windows.push({
      checkin,
      checkout,
      nights,
      offset: i,
      label: i === 0 ? 'original' : (i < 0 ? `${Math.abs(i)}d earlier` : `${i}d later`)
    });
  }

  return windows;
}

// =============================================================================
// Modal Dismissal Script (Injected into pages)
// =============================================================================

const MODAL_DISMISS_SCRIPT = `
(() => {
  // Dismiss common modals, cookie banners, login prompts
  const dismissPatterns = [
    // Cookie banners
    '[data-testid="cookie-policy-dialog"] button',
    '[aria-label*="cookie"] button[aria-label*="accept"]',
    '[aria-label*="Cookie"] button',
    'button[data-testid*="accept"]',
    '#onetrust-accept-btn-handler',
    '.cookie-banner button',
    '[class*="cookie"] button[class*="accept"]',

    // Login prompts
    '[data-testid="modal-container"] button[aria-label="Close"]',
    '[aria-label="Close"]',
    'button[aria-label="Dismiss"]',
    '[data-testid="close-button"]',
    '.modal-close',
    '[class*="modal"] [class*="close"]',

    // Price alerts / notifications
    '[data-testid="notification-close"]',
    '[aria-label="Close notification"]',
    '.notification-dismiss',

    // Google-specific
    '[aria-label="No thanks"]',
    'button:contains("No thanks")',
    '[jsname="b3VHJd"]', // Google "Got it" button
  ];

  let dismissed = 0;
  for (const selector of dismissPatterns) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (el.offsetParent !== null) { // Is visible
          el.click();
          dismissed++;
        }
      });
    } catch (e) {}
  }

  // Also try to remove overlay elements
  const overlays = document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="modal-bg"]');
  overlays.forEach(el => {
    if (el.style.position === 'fixed' || el.style.position === 'absolute') {
      el.style.display = 'none';
    }
  });

  return dismissed;
})();
`;

// =============================================================================
// Google Flights Scraper
// =============================================================================

async function scrapeGoogleFlights(page, origin, destination, departDate, returnDate, passengers) {
  const flights = [];
  const destCode = getAirportCode(destination);

  // Validate origin code
  validateAirportCode(origin);

  // Build Google Flights URL
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(origin)}+to+${encodeURIComponent(destCode)}+${passengers}+passengers+${departDate}+to+${returnDate}&curr=USD`;

  console.error(`[Flights] Loading: ${url}`);

  // Track which selectors worked (for validation logging)
  let usedFallbackSelectors = false;

  try {
    // Set up network interception
    const apiResponses = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('travel/flights') && url.includes('json')) {
        try {
          const json = await response.json().catch(() => null);
          if (json) apiResponses.push(json);
        } catch (e) {}
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.timeout });

    // Dismiss modals
    await page.evaluate(MODAL_DISMISS_SCRIPT);
    await sleep(500);

    // Wait for flight results with multiple selector strategies
    // Updated Feb 2026: Google Flights now uses div.JMc5Xc with rich aria-labels
    const flightSelectors = [
      'div.JMc5Xc',                                    // Primary: flight card with full aria-label
      'div[role="link"][aria-label*="Select flight"]', // Alternative: role-based
      '[aria-label*="US dollars round trip"]',         // Alternative: price-based
      'div.gvkrdb',                                    // Duration elements (fallback)
      '[jsname="IWWDBc"]'                              // Legacy fallback
    ];

    let found = false;
    let selectorIndex = 0;
    for (const selector of flightSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: CONFIG.flights.waitTimeout });
        found = true;
        if (selectorIndex >= CONFIG.selectors.fallbackThreshold) {
          usedFallbackSelectors = true;
          console.error(`[Flights] WARNING: Using fallback selector (index ${selectorIndex}): ${selector}`);
        }
        break;
      } catch (e) {
        selectorIndex++;
      }
    }

    if (!found) {
      console.error('[Flights] No flight results found within timeout');
    }

    // Batch extract all flight data in single evaluate call
    // Updated Feb 2026: Use div.JMc5Xc aria-labels which contain all flight info
    const extractedFlights = await page.evaluate((maxResults) => {
      const results = [];

      // Primary selector: div.JMc5Xc with comprehensive aria-label
      // Example aria-label: "From 942 US dollars round trip total. Nonstop flight with JetBlue.
      //   Leaves Boston Logan International Airport at 6:15 AM on Sunday, March 15 and
      //   arrives at Los Angeles International Airport at 9:48 AM on Sunday, March 15.
      //   Total duration 6 hr 33 min.  Select flight"
      const cardSelectors = [
        'div.JMc5Xc',
        'div[role="link"][aria-label*="Select flight"]',
        '[aria-label*="US dollars round trip"]'
      ];

      let cards = [];
      for (const sel of cardSelectors) {
        cards = document.querySelectorAll(sel);
        if (cards.length >= 3) break;
      }

      cards.forEach((card, idx) => {
        if (idx >= maxResults) return;

        try {
          const ariaLabel = card.getAttribute('aria-label') || '';
          if (!ariaLabel.includes('US dollars')) return;

          // Parse price: "From 942 US dollars" or "From 1,080 US dollars"
          let price = 0;
          const priceMatch = ariaLabel.match(/From\s+([\d,]+)\s*US dollars/i);
          if (priceMatch) {
            price = parseInt(priceMatch[1].replace(/,/g, ''));
          }

          // Parse airline: "Nonstop flight with JetBlue" or "2 stops flight with Southwest"
          let airline = 'Unknown';
          const airlineMatch = ariaLabel.match(/flight with\s+([A-Za-z0-9\s]+?)(?:\.|Leaves)/);
          if (airlineMatch) {
            airline = airlineMatch[1].trim();
          }

          // Parse duration: "Total duration 6 hr 33 min"
          let duration = '';
          let durationMinutes = 0;
          const durationMatch = ariaLabel.match(/Total duration\s+(\d+)\s*hr?\s*(\d*)\s*m?i?n?/i);
          if (durationMatch) {
            const hrs = parseInt(durationMatch[1]) || 0;
            const mins = parseInt(durationMatch[2]) || 0;
            durationMinutes = hrs * 60 + mins;
            duration = `${hrs}h ${mins}m`;
          }

          // Parse stops: "Nonstop flight" or "2 stops flight"
          let stops = 'Unknown';
          if (ariaLabel.includes('Nonstop flight')) {
            stops = 'Nonstop';
          } else {
            const stopsMatch = ariaLabel.match(/(\d+)\s*stops?\s*flight/i);
            if (stopsMatch) {
              const numStops = parseInt(stopsMatch[1]);
              stops = `${numStops} stop${numStops > 1 ? 's' : ''}`;
            }
          }

          // Parse times: "Leaves ... at 6:15 AM ... arrives ... at 9:48 AM"
          let times = '';
          const leavesMatch = ariaLabel.match(/at\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
          const arrivesMatch = ariaLabel.match(/arrives[^]+?at\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
          if (leavesMatch && arrivesMatch) {
            times = `${leavesMatch[1]} - ${arrivesMatch[1]}`;
          }

          // Fallback: try to extract from child elements if aria-label parsing incomplete
          if (price === 0) {
            const priceEl = card.querySelector('span[aria-label*="US dollars"]');
            if (priceEl) {
              const priceAriaMatch = priceEl.getAttribute('aria-label')?.match(/([\d,]+)\s*US dollars/);
              if (priceAriaMatch) {
                price = parseInt(priceAriaMatch[1].replace(/,/g, ''));
              }
            }
          }

          if (airline === 'Unknown') {
            // Try to find airline from inner spans
            const spans = card.querySelectorAll('span');
            const commonAirlines = ['United', 'Delta', 'American', 'Southwest', 'JetBlue', 'Alaska', 'Spirit', 'Frontier', 'Hawaiian'];
            for (const span of spans) {
              const text = span.textContent?.trim();
              if (text && commonAirlines.includes(text)) {
                airline = text;
                break;
              }
            }
          }

          if (duration === '' || durationMinutes === 0) {
            const durationEl = card.querySelector('div.gvkrdb, .Ak5kof');
            if (durationEl) {
              const durAriaLabel = durationEl.getAttribute('aria-label') || durationEl.textContent || '';
              const durMatch = durAriaLabel.match(/(\d+)\s*hr?\s*(\d*)\s*m?i?n?/i);
              if (durMatch) {
                const hrs = parseInt(durMatch[1]) || 0;
                const mins = parseInt(durMatch[2]) || 0;
                durationMinutes = hrs * 60 + mins;
                duration = `${hrs}h ${mins}m`;
              }
            }
          }

          if (stops === 'Unknown') {
            const stopsEl = card.querySelector('span[aria-label*="stop"], span[aria-label*="Nonstop"]');
            if (stopsEl) {
              const stopsAriaLabel = stopsEl.getAttribute('aria-label') || '';
              if (stopsAriaLabel.includes('Nonstop')) {
                stops = 'Nonstop';
              } else {
                const stMatch = stopsAriaLabel.match(/(\d+)\s*stops?/i);
                if (stMatch) {
                  const numStops = parseInt(stMatch[1]);
                  stops = `${numStops} stop${numStops > 1 ? 's' : ''}`;
                }
              }
            }
          }

          // Get booking link from card (if any clickable elements)
          let bookingUrl = '';

          if (price > 0) {
            results.push({
              airline,
              price,
              duration,
              durationMinutes,
              stops,
              times,
              bookingUrl
            });
          }
        } catch (e) {
          console.error('Error extracting flight:', e);
        }
      });

      return results;
    }, CONFIG.flights.maxResults);

    // Add fallback URL for each flight
    extractedFlights.forEach((flight, idx) => {
      if (!flight.bookingUrl) {
        flight.bookingUrl = url;
      }
      flights.push({
        id: `F${idx + 1}`,
        ...flight
      });
    });

    // Log validation warning if fallback selectors were used
    if (usedFallbackSelectors) {
      console.error('[Flights] WARNING: Fallback selectors were used. Site structure may have changed.');
    }

  } catch (error) {
    console.error(`[Flights] Error: ${error.message}`);
    // Return fallback with search URL
    flights.push({
      id: 'F1',
      error: true,
      message: 'Could not load flight data',
      fallbackUrl: `https://www.google.com/travel/flights?q=${encodeURIComponent(origin)}+to+${encodeURIComponent(destination)}`
    });
  }

  return flights;
}

// =============================================================================
// Airbnb Scraper
// =============================================================================

async function scrapeAirbnb(page, destination, checkin, checkout, guests) {
  const listings = [];

  // Build Airbnb URL
  const destSlug = destination.replace(/\s+/g, '-').replace(/,/g, '');
  const url = `https://www.airbnb.com/s/${encodeURIComponent(destSlug)}/homes?adults=${guests}&checkin=${checkin}&checkout=${checkout}&min_bedrooms=${Math.ceil(guests/2)}`;

  console.error(`[Airbnb] Loading: ${url}`);

  // Track which selectors worked (for validation logging)
  let usedFallbackSelectors = false;

  try {
    // Set up network interception to capture API data
    const apiData = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('api.airbnb.com') || url.includes('Explore') || url.includes('StaysSearch')) {
        try {
          const json = await response.json().catch(() => null);
          if (json) apiData.push(json);
        } catch (e) {}
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.timeout });

    // Dismiss modals (cookie banners, login prompts)
    await page.evaluate(MODAL_DISMISS_SCRIPT);
    await sleep(500);

    // Wait for listing cards with multiple selector strategies
    const listingSelectors = [
      '[itemprop="itemListElement"]',
      '[data-testid="card-container"]',
      '[data-testid="listing-card"]',
      'div[aria-labelledby*="listing"]',
      '.c1l1h97y'
    ];

    let found = false;
    let selectorIndex = 0;
    for (const selector of listingSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: CONFIG.airbnb.waitTimeout });
        found = true;
        if (selectorIndex >= CONFIG.selectors.fallbackThreshold) {
          usedFallbackSelectors = true;
          console.error(`[Airbnb] WARNING: Using fallback selector (index ${selectorIndex}): ${selector}`);
        }
        break;
      } catch (e) {
        selectorIndex++;
      }
    }

    if (!found) {
      console.error('[Airbnb] No listing results found within timeout');
    }

    // Calculate nights
    const checkinDate = new Date(checkin);
    const checkoutDate = new Date(checkout);
    const nights = Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));

    // Batch extract all listing data in single evaluate call
    const extractedListings = await page.evaluate((maxResults, nights) => {
      const results = [];

      // Multiple selector strategies for cards
      const cardSelectors = [
        '[itemprop="itemListElement"]',
        '[data-testid="card-container"]',
        '[data-testid="listing-card"]',
        'div[aria-labelledby*="listing"]',
        '.c1l1h97y'
      ];

      let cards = [];
      for (const sel of cardSelectors) {
        cards = document.querySelectorAll(sel);
        if (cards.length > 0) break;
      }

      cards.forEach((card, idx) => {
        if (idx >= maxResults) return;

        try {
          // Extract listing ID from link
          const linkSelectors = ['a[href*="/rooms/"]', 'a[target="_blank"]'];
          let listingId = '';
          let listingUrl = '';
          for (const sel of linkSelectors) {
            const link = card.querySelector(sel);
            if (link && link.href.includes('/rooms/')) {
              const match = link.href.match(/\/rooms\/(\d+)/);
              if (match) {
                listingId = match[1];
                listingUrl = `https://www.airbnb.com/rooms/${listingId}`;
                break;
              }
            }
          }
          if (!listingId) return;

          // Extract name
          const nameSelectors = [
            '[data-testid="listing-card-title"]',
            '[id*="title"]',
            '[data-testid*="title"]',
            'meta[itemprop="name"]',
            '.t1jojoys'
          ];
          let name = 'Unknown Listing';
          for (const sel of nameSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              name = el.textContent?.trim() || el.getAttribute('content') || '';
              if (name && name.length > 3) break;
            }
          }

          // Extract price
          // Updated selectors based on current Airbnb HTML structure (Feb 2026)
          const priceSelectors = [
            // Total price container - most reliable
            '[data-testid="price-availability-row"]',
            // Total price with "for X nights" text (e.g., "$3,156 for 5 nights")
            'span.a8jt5op',
            // Per-night/total price display
            'span.u174bpcy',
            // Discounted/current price
            'span.u1opajno',
            // Original price (when discounted)
            'span.sjwpj0z',
            // Fallback selectors
            'span[aria-label*="price"]',
            '[data-testid="price"]'
          ];
          let priceTotal = 0;
          let pricePerNight = 0;
          for (const sel of priceSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const priceText = el.textContent || '';

              // Check for "for X nights" pattern (indicates total price)
              const forNightsMatch = priceText.match(/\$([\d,]+)\s*(?:for\s*\d+\s*night|total)/i);
              if (forNightsMatch) {
                priceTotal = parseInt(forNightsMatch[1].replace(/,/g, ''));
                pricePerNight = Math.round(priceTotal / nights);
                break;
              }

              // Look for all price values in the element
              const allPrices = priceText.match(/\$([\d,]+)/g);
              if (allPrices && allPrices.length > 0) {
                // If multiple prices (e.g., "$1,911 $1,717"), take the last one (current/discounted price)
                const prices = allPrices.map(p => parseInt(p.replace(/[$,]/g, '')));
                const extractedPrice = prices[prices.length - 1];

                // Heuristic: if price > nights * 50, it's likely a total, not per-night
                if (extractedPrice > nights * 50) {
                  priceTotal = extractedPrice;
                  pricePerNight = Math.round(priceTotal / nights);
                } else {
                  pricePerNight = extractedPrice;
                  priceTotal = pricePerNight * nights;
                }
                break;
              }
            }
          }

          // Extract rating and review count
          const ratingSelectors = [
            '[aria-label*="rating"]',
            'span[aria-label*="out of 5"]',
            '.r1dxllyb',
            '[data-testid="rating"]'
          ];
          let rating = 0;
          let reviewCount = 0;
          for (const sel of ratingSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const text = el.textContent || el.getAttribute('aria-label') || '';
              const ratingMatch = text.match(/(\d+\.?\d*)/);
              if (ratingMatch) rating = parseFloat(ratingMatch[1]);
              const reviewMatch = text.match(/\((\d+)\)|(\d[\d,]*)\s*review/i);
              if (reviewMatch) {
                reviewCount = parseInt((reviewMatch[1] || reviewMatch[2]).replace(/,/g, ''));
              }
              if (rating > 0) break;
            }
          }

          // Check for superhost
          const superhostSelectors = [
            '[aria-label*="Superhost"]',
            '[data-testid*="superhost"]',
            '.t1mwk1n0',
            'svg[aria-label*="Superhost"]'
          ];
          let superhost = false;
          for (const sel of superhostSelectors) {
            if (card.querySelector(sel)) {
              superhost = true;
              break;
            }
          }

          // Extract neighborhood/location from subtitle
          const subtitleSelectors = [
            '[data-testid="listing-card-subtitle"]',
            '.t1jojoys + div',
            'span[aria-label*="location"]'
          ];
          let neighborhood = '';
          for (const sel of subtitleSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const text = el.textContent || '';
              const match = text.match(/(?:in|near)\s+([^,]+?)(?:,|$)/i);
              if (match) {
                neighborhood = match[1].trim();
                break;
              }
            }
          }

          // Extract amenities
          const cardText = card.textContent || '';
          const amenities = [];
          const amenityPatterns = [
            { pattern: /\bwifi\b/i, name: 'WiFi', emoji: '\u{1F4F6}' },
            { pattern: /\bpool\b/i, name: 'Pool', emoji: '\u{1F3CA}' },
            { pattern: /\bkitchen\b/i, name: 'Kitchen', emoji: '\u{1F373}' },
            { pattern: /\bparking\b/i, name: 'Parking', emoji: '\u{1F17F}' },
            { pattern: /\bwasher\b/i, name: 'Washer', emoji: '\u{1F9FA}' },
            { pattern: /\bac\b|\bair condition/i, name: 'AC', emoji: '\u{2744}' },
            { pattern: /\bhot tub\b|\bjacuzzi\b/i, name: 'HotTub', emoji: '\u{1F6C1}' }
          ];
          for (const ap of amenityPatterns) {
            if (ap.pattern.test(cardText)) amenities.push(ap.name);
          }

          // Check cancellation policy
          let cancelPolicy = '';
          if (/free cancellation/i.test(cardText)) {
            cancelPolicy = 'free';
          } else if (/non-refundable/i.test(cardText)) {
            cancelPolicy = 'non-refundable';
          }

          // Check for discount
          const strikeSelectors = ['[style*="line-through"]', '.c1pk68c3', 'del', 's'];
          let discountPct = null;
          let originalPrice = null;
          for (const sel of strikeSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const origMatch = el.textContent.match(/\$([\d,]+)/);
              if (origMatch) {
                originalPrice = parseInt(origMatch[1].replace(/,/g, ''));
                if (originalPrice > priceTotal && priceTotal > 0) {
                  discountPct = Math.round(100 * (originalPrice - priceTotal) / originalPrice);
                }
                break;
              }
            }
          }

          results.push({
            listingId,
            name,
            priceTotal,
            pricePerNight,
            rating,
            reviewCount,
            superhost,
            neighborhood,
            amenities,
            cancelPolicy,
            discountPct,
            originalPrice,
            url: listingUrl
          });
        } catch (e) {
          console.error('Error extracting listing:', e);
        }
      });

      return results;
    }, CONFIG.airbnb.maxResults, nights);

    // Add IDs and sort by review quality
    extractedListings.forEach((listing, idx) => {
      // Calculate review quality score: rating * log10(reviewCount + 1)
      const reviewScore = listing.reviewCount > 0
        ? listing.rating * Math.log10(listing.reviewCount + 1)
        : 0;

      listings.push({
        id: `A${idx + 1}`,
        reviewScore: Math.round(reviewScore * 100) / 100,
        ...listing
      });
    });

    // Sort by review score
    listings.sort((a, b) => b.reviewScore - a.reviewScore);

    // Re-assign IDs after sorting
    listings.forEach((listing, idx) => {
      listing.id = `A${idx + 1}`;
    });

    // Log validation warning if fallback selectors were used
    if (usedFallbackSelectors) {
      console.error('[Airbnb] WARNING: Fallback selectors were used. Site structure may have changed.');
    }

  } catch (error) {
    console.error(`[Airbnb] Error: ${error.message}`);
    // Return fallback with search URL
    listings.push({
      id: 'A1',
      error: true,
      message: 'Could not load Airbnb data',
      fallbackUrl: `https://www.airbnb.com/s/${encodeURIComponent(destination)}/homes?guests=${guests}`
    });
  }

  return listings;
}

// =============================================================================
// Main Search Function
// =============================================================================

async function searchTravel(options) {
  const {
    destination,
    checkin,
    checkout,
    guests,
    origin = 'BOS',
    budget = null,
    flexDays = 0,
    noCache = false,
    amenityFilters = [],      // e.g., ['pool', 'hot tub']
    fetchFullAmenities = true // Fetch amenities from individual listings
  } = options;

  const startTime = Date.now();
  console.error(`\n[Search] Starting travel search for ${destination}`);
  console.error(`[Search] Dates: ${checkin} to ${checkout}, Guests: ${guests}, Origin: ${origin}`);
  if (flexDays > 0) {
    console.error(`[Search] Flexible dates enabled: -${flexDays} to +${flexDays} days`);
  }

  let browser;

  try {
    // Launch browser with optimized settings (stealth plugin already applied)
    browser = await puppeteer.launch({
      headless: CONFIG.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-features=IsolateOrigins,site-per-process',
        '--blink-settings=imagesEnabled=false' // Disable images for speed
      ]
    });

    // Create two pages for parallel scraping
    const [flightsPage, airbnbPage] = await Promise.all([
      browser.newPage(),
      browser.newPage()
    ]);

    // Configure pages
    for (const page of [flightsPage, airbnbPage]) {
      await page.setUserAgent(getRandomUA());
      await page.setViewport({ width: 1920, height: 1080 });

      // Block unnecessary resources for speed
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        // Block images, fonts, and some media for speed
        if (['image', 'font', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }

    // Run all scrapers in parallel with retry
    // HYBRID MODE: Puppeteer for flights, Chrome for Airbnb, Puppeteer for Hotels
    console.error('[Search] Scraping flights, Airbnb, and hotels in parallel...');

    const scrapeFlightsWithRetry = () => withRetry(
      () => scrapeGoogleFlights(flightsPage, origin, destination, checkin, checkout, guests),
      { name: 'GoogleFlights' }
    );

    // Use Chrome Airbnb scraper if available, otherwise fall back to Puppeteer
    const scrapeAirbnbHybrid = async () => {
      if (chromeAirbnb) {
        console.error('[Airbnb] Using Chrome scraper (hybrid mode)');
        return await chromeAirbnb.scrapeAirbnb(destination, checkin, checkout, guests);
      } else {
        console.error('[Airbnb] Using Puppeteer scraper (fallback mode)');
        return await withRetry(
          () => scrapeAirbnb(airbnbPage, destination, checkin, checkout, guests),
          { name: 'Airbnb' }
        );
      }
    };

    // Scrape hotels (runs in separate browser instance)
    const scrapeHotelsAsync = async () => {
      if (puppeteerHotels) {
        console.error('[Hotels] Scraping 4+ star hotels...');
        return await puppeteerHotels.scrapeHotels(destination, checkin, checkout, guests);
      }
      return [];
    };

    const [rawFlights, rawAirbnbs, rawHotels] = await Promise.all([
      scrapeFlightsWithRetry().catch(e => [{
        id: 'F1',
        error: true,
        message: e.message,
        fallbackUrl: `https://www.google.com/travel/flights?q=${encodeURIComponent(origin)}+to+${encodeURIComponent(destination)}`
      }]),
      scrapeAirbnbHybrid().catch(e => [{
        id: 'A1',
        error: true,
        message: e.message,
        fallbackUrl: `https://www.airbnb.com/s/${encodeURIComponent(destination)}/homes?guests=${guests}`
      }]),
      scrapeHotelsAsync().catch(e => {
        console.error(`[Hotels] Error: ${e.message}`);
        return [];
      })
    ]);

    // Validate and filter results
    const flights = validateFlightResults(rawFlights);
    let airbnbs = validateAirbnbResults(rawAirbnbs);
    const hotels = rawHotels.filter(h => !h.error && h.priceTotal > 0);

    // Fetch full amenities for Airbnbs if enabled and chromeAirbnb module is available
    if (fetchFullAmenities && chromeAirbnb && chromeAirbnb.fetchFullAmenities) {
      console.error('[Airbnb] Fetching full amenities for top listings...');
      try {
        airbnbs = await chromeAirbnb.fetchFullAmenities(airbnbs, 5);

        // Re-rank by amenities (prioritize premium amenities)
        if (chromeAirbnb.rankByAmenities) {
          airbnbs = chromeAirbnb.rankByAmenities(airbnbs, amenityFilters);
        }
      } catch (e) {
        console.error(`[Airbnb] Amenity fetch failed: ${e.message}`);
      }
    }

    // Re-assign IDs after filtering/ranking
    let flightIdx = 1;
    flights.forEach(f => { if (!f.error) f.id = `F${flightIdx++}`; });
    let airbnbIdx = 1;
    airbnbs.forEach(a => { if (!a.error) a.id = `A${airbnbIdx++}`; });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[Search] Completed in ${elapsed}s`);
    console.error(`[Search] Found ${flights.length} flights, ${airbnbs.length} Airbnbs, ${hotels.length} hotels`);

    // Calculate recommendations (including hotels)
    const recommendations = calculateRecommendations(flights, airbnbs, budget, hotels);

    const nights = Math.ceil((new Date(checkout) - new Date(checkin)) / (1000 * 60 * 60 * 24));

    // Build result object
    const result = {
      success: true,
      params: {
        destination,
        checkin,
        checkout,
        guests,
        origin,
        budget,
        nights
      },
      flights,
      airbnbs,
      hotels,
      recommendations,
      metadata: {
        scrapedAt: new Date().toISOString(),
        durationSeconds: parseFloat(elapsed),
        flightsCount: flights.length,
        airbnbsCount: airbnbs.length,
        hotelsCount: hotels.length
      },
      fallbackUrls: {
        flights: `https://www.google.com/travel/flights?q=${encodeURIComponent(origin)}+to+${encodeURIComponent(destination)}+${guests}+passengers+${checkin}+to+${checkout}`,
        airbnb: `https://www.airbnb.com/s/${encodeURIComponent(destination.replace(/\s+/g, '-'))}/homes?adults=${guests}&checkin=${checkin}&checkout=${checkout}`,
        hotels: `https://www.google.com/travel/hotels?q=${encodeURIComponent(destination)}+hotels&dates=${checkin},${checkout}&guests=${guests}`
      }
    };

    // Store results in price cache (if available)
    if (priceCache && !noCache) {
      try {
        priceCache.recordSearchResults(result);
        console.error('[Cache] Stored search results in price cache');

        // Get price comparison vs 7-day average
        if (recommendations.cheapestCombinationTotal) {
          const comparison = priceCache.getPriceComparison({
            destination,
            checkin,
            checkout,
            guests,
            priceType: 'total'
          }, recommendations.cheapestCombinationTotal);

          if (comparison) {
            result.priceComparison = comparison;
            console.error(`[Cache] ${comparison.description}`);
          }
        }
      } catch (cacheError) {
        console.error(`[Cache] Error: ${cacheError.message}`);
      }
    }

    return result;

  } catch (error) {
    console.error(`[Search] Fatal error: ${error.message}`);
    return {
      success: false,
      error: error.message,
      fallbackUrls: {
        flights: `https://www.google.com/travel/flights?q=${encodeURIComponent(origin)}+to+${encodeURIComponent(destination)}`,
        airbnb: `https://www.airbnb.com/s/${encodeURIComponent(destination)}/homes`
      }
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function calculateRecommendations(flights, airbnbs, budget, hotels = []) {
  const validFlights = flights.filter(f => !f.error && f.price > 0);
  const validAirbnbs = airbnbs.filter(a => !a.error && a.priceTotal > 0);
  const validHotels = hotels.filter(h => !h.error && h.priceTotal > 0);

  if (validFlights.length === 0) {
    return { bestCombination: null, withinBudget: false };
  }

  // Find cheapest flight
  const cheapestFlight = validFlights.reduce((a, b) => a.price < b.price ? a : b);

  // Find best value Airbnb (highest review score with reasonable price)
  const bestAirbnb = validAirbnbs.length > 0 ? validAirbnbs[0] : null;

  // Find cheapest Airbnb
  const cheapestAirbnb = validAirbnbs.length > 0
    ? validAirbnbs.reduce((a, b) => a.priceTotal < b.priceTotal ? a : b)
    : null;

  // Find best hotel (highest rating)
  const bestHotel = validHotels.length > 0
    ? validHotels.reduce((a, b) => b.rating > a.rating ? b : a)
    : null;

  // Find cheapest hotel
  const cheapestHotel = validHotels.length > 0
    ? validHotels.reduce((a, b) => a.priceTotal < b.priceTotal ? a : b)
    : null;

  // Calculate totals
  const airbnbTotal = cheapestAirbnb ? cheapestFlight.price + cheapestAirbnb.priceTotal : null;
  const hotelTotal = cheapestHotel ? cheapestFlight.price + cheapestHotel.priceTotal : null;

  // Find overall cheapest accommodation
  let cheapestAccom = null;
  let cheapestAccomType = null;
  let cheapestCombinationTotal = null;

  if (airbnbTotal && hotelTotal) {
    if (hotelTotal < airbnbTotal) {
      cheapestAccom = cheapestHotel;
      cheapestAccomType = 'hotel';
      cheapestCombinationTotal = hotelTotal;
    } else {
      cheapestAccom = cheapestAirbnb;
      cheapestAccomType = 'airbnb';
      cheapestCombinationTotal = airbnbTotal;
    }
  } else if (airbnbTotal) {
    cheapestAccom = cheapestAirbnb;
    cheapestAccomType = 'airbnb';
    cheapestCombinationTotal = airbnbTotal;
  } else if (hotelTotal) {
    cheapestAccom = cheapestHotel;
    cheapestAccomType = 'hotel';
    cheapestCombinationTotal = hotelTotal;
  }

  const bestCombinationTotal = bestAirbnb
    ? cheapestFlight.price + bestAirbnb.priceTotal
    : (bestHotel ? cheapestFlight.price + bestHotel.priceTotal : null);

  const withinBudget = budget && cheapestCombinationTotal
    ? cheapestCombinationTotal <= budget
    : true;

  return {
    bestFlight: {
      id: cheapestFlight.id,
      airline: cheapestFlight.airline,
      price: cheapestFlight.price
    },
    bestAirbnb: bestAirbnb ? {
      id: bestAirbnb.id,
      name: bestAirbnb.name,
      priceTotal: bestAirbnb.priceTotal,
      rating: bestAirbnb.rating
    } : null,
    cheapestAirbnb: cheapestAirbnb && bestAirbnb && cheapestAirbnb.id !== bestAirbnb.id ? {
      id: cheapestAirbnb.id,
      name: cheapestAirbnb.name,
      priceTotal: cheapestAirbnb.priceTotal
    } : null,
    bestHotel: bestHotel ? {
      id: bestHotel.id,
      name: bestHotel.name,
      priceTotal: bestHotel.priceTotal,
      rating: bestHotel.rating,
      starClass: bestHotel.starClass
    } : null,
    cheapestHotel: cheapestHotel ? {
      id: cheapestHotel.id,
      name: cheapestHotel.name,
      priceTotal: cheapestHotel.priceTotal,
      starClass: cheapestHotel.starClass
    } : null,
    cheapestAccommodation: cheapestAccom ? {
      type: cheapestAccomType,
      id: cheapestAccom.id,
      name: cheapestAccom.name,
      priceTotal: cheapestAccom.priceTotal
    } : null,
    bestCombinationTotal,
    cheapestCombinationTotal,
    withinBudget,
    budgetRemaining: budget ? budget - cheapestCombinationTotal : null
  };
}

// =============================================================================
// Flexible Date Search (Reuses single browser instance)
// =============================================================================

/**
 * Internal function to search a single date window using existing pages
 * Reuses browser context instead of launching new browsers per window
 */
async function searchWindowWithPages(flightsPage, airbnbPage, options) {
  const { destination, checkin, checkout, guests, origin, budget } = options;

  try {
    // Scrape flights and Airbnb in parallel
    const [rawFlights, rawAirbnbs] = await Promise.all([
      withRetry(
        () => scrapeGoogleFlights(flightsPage, origin, destination, checkin, checkout, guests),
        { name: 'GoogleFlights' }
      ).catch(e => [{
        id: 'F1', error: true, message: e.message,
        fallbackUrl: `https://www.google.com/travel/flights?q=${encodeURIComponent(origin)}+to+${encodeURIComponent(destination)}`
      }]),
      withRetry(
        () => scrapeAirbnb(airbnbPage, destination, checkin, checkout, guests),
        { name: 'Airbnb' }
      ).catch(e => [{
        id: 'A1', error: true, message: e.message,
        fallbackUrl: `https://www.airbnb.com/s/${encodeURIComponent(destination)}/homes?guests=${guests}`
      }])
    ]);

    // Validate and filter results
    const flights = validateFlightResults(rawFlights);
    const airbnbs = validateAirbnbResults(rawAirbnbs);

    // Re-assign IDs after filtering
    let flightIdx = 1;
    flights.forEach(f => { if (!f.error) f.id = `F${flightIdx++}`; });
    let airbnbIdx = 1;
    airbnbs.forEach(a => { if (!a.error) a.id = `A${airbnbIdx++}`; });

    // Calculate recommendations
    const recommendations = calculateRecommendations(flights, airbnbs, budget);

    return { success: true, flights, airbnbs, recommendations };
  } catch (error) {
    console.error(`[FlexSearch] Error scraping window: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function searchFlexibleDates(options) {
  const {
    destination,
    checkin,
    checkout,
    guests,
    origin = 'BOS',
    budget = null,
    flexDays = 3,
    noCache = false
  } = options;

  console.error(`\n[FlexSearch] Searching flexible dates: ${checkin} +/- ${flexDays} days`);

  const windows = generateDateWindows(checkin, checkout, flexDays);
  console.error(`[FlexSearch] Generated ${windows.length} date windows to search`);

  const results = [];
  const maxConcurrent = CONFIG.flexibleSearch.maxConcurrent;
  const staggerDelay = CONFIG.flexibleSearch.staggerDelayMs;
  let browser;

  try {
    // Launch a SINGLE browser instance for all windows
    console.error('[FlexSearch] Launching shared browser instance...');
    browser = await puppeteer.launch({
      headless: CONFIG.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-features=IsolateOrigins,site-per-process',
        '--blink-settings=imagesEnabled=false'
      ]
    });

    // Create page pool for concurrent searches (2 pages per window: flights + airbnb)
    const createPagePair = async () => {
      const flightsPage = await browser.newPage();
      const airbnbPage = await browser.newPage();

      for (const page of [flightsPage, airbnbPage]) {
        await page.setUserAgent(getRandomUA());
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const resourceType = req.resourceType();
          if (['image', 'font', 'media'].includes(resourceType)) {
            req.abort();
          } else {
            req.continue();
          }
        });
      }

      return { flightsPage, airbnbPage };
    };

    // Pre-create page pairs for concurrent searches
    const pagePairs = await Promise.all(
      Array(Math.min(maxConcurrent, windows.length)).fill(null).map(() => createPagePair())
    );
    console.error(`[FlexSearch] Created ${pagePairs.length} page pairs for concurrent searches`);

    // Process windows in batches, reusing page pairs
    for (let i = 0; i < windows.length; i += maxConcurrent) {
      const batch = windows.slice(i, i + maxConcurrent);
      console.error(`[FlexSearch] Processing batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(windows.length / maxConcurrent)}`);

      // Launch searches with staggered starts, reusing page pairs
      const batchPromises = batch.map(async (window, batchIdx) => {
        // Stagger start times
        if (batchIdx > 0) {
          await sleep(staggerDelay * batchIdx);
        }

        console.error(`[FlexSearch] Checking window: ${window.checkin} to ${window.checkout} (${window.label})`);

        const pagePair = pagePairs[batchIdx % pagePairs.length];

        try {
          const result = await searchWindowWithPages(
            pagePair.flightsPage,
            pagePair.airbnbPage,
            {
              destination,
              checkin: window.checkin,
              checkout: window.checkout,
              guests,
              origin,
              budget
            }
          );

          if (result.success && result.recommendations.cheapestCombinationTotal) {
            return {
              checkin: window.checkin,
              checkout: window.checkout,
              nights: window.nights,
              offset: window.offset,
              label: window.label,
              totalPrice: result.recommendations.cheapestCombinationTotal,
              flightPrice: result.recommendations.bestFlight?.price || 0,
              airbnbPrice: result.recommendations.cheapestAirbnb?.priceTotal ||
                           result.recommendations.bestAirbnb?.priceTotal || 0,
              bestFlight: result.recommendations.bestFlight,
              bestAirbnb: result.recommendations.bestAirbnb,
              fullResult: result
            };
          }
          // Window search succeeded but no valid results (e.g., no prices found)
          return { _error: true, checkin: window.checkin };
        } catch (error) {
          console.error(`[FlexSearch] Error for ${window.checkin}: ${error.message}`);
          return { _error: true, checkin: window.checkin, message: error.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to avoid rate limiting
      if (i + maxConcurrent < windows.length) {
        console.error(`[FlexSearch] Waiting between batches...`);
        await sleep(staggerDelay);
      }
    }

    // Close page pairs
    for (const pair of pagePairs) {
      await pair.flightsPage.close();
      await pair.airbnbPage.close();
    }

  } finally {
    // Close the single browser instance
    if (browser) {
      await browser.close();
      console.error('[FlexSearch] Closed shared browser instance');
    }
  }

  // Separate errors from valid results
  const errorResults = results.filter(r => r && r._error);
  const validResults = results.filter(r => r && !r._error);

  // Sort valid results by total price
  validResults.sort((a, b) => a.totalPrice - b.totalPrice);

  // Calculate savings vs base date
  const baseResult = validResults.find(r => r.checkin === checkin);
  const cheapest = validResults[0];

  let savings = null;
  if (baseResult && cheapest && baseResult.checkin !== cheapest.checkin) {
    savings = {
      amount: baseResult.totalPrice - cheapest.totalPrice,
      pct: Math.round(100 * (baseResult.totalPrice - cheapest.totalPrice) / baseResult.totalPrice)
    };
  }

  // Build metadata with error count
  const metadata = {
    windowsSearched: windows.length,
    successfulResults: validResults.length,
    scrapedAt: new Date().toISOString()
  };

  // Add windowsWithErrors if any windows failed
  if (errorResults.length > 0) {
    metadata.windowsWithErrors = errorResults.length;
    console.error(`[FlexSearch] ${errorResults.length} window(s) had errors or no results`);
  }

  return {
    success: true,
    flexibleSearch: true,
    params: {
      destination,
      baseCheckin: checkin,
      baseCheckout: checkout,
      guests,
      origin,
      budget,
      flexDays
    },
    dateOptions: validResults,
    cheapest: cheapest || null,
    baseDate: baseResult || null,
    savings,
    metadata
  };
}

// =============================================================================
// Format Output for iMessage
// =============================================================================

function formatFlexibleResults(result) {
  if (!result.success || !result.flexibleSearch) {
    return formatForMessage(result);
  }

  const { params, dateOptions, cheapest, baseDate, savings } = result;
  const lines = [];

  // Header
  lines.push(`FLEXIBLE DATES: ${params.destination}`);
  lines.push(`Base: ${params.baseCheckin} +/- ${params.flexDays} days`);
  lines.push(`${params.guests} guests from ${params.origin}`);
  if (params.budget) lines.push(`Budget: $${params.budget.toLocaleString()}`);
  lines.push('');

  // Best deal
  if (cheapest) {
    lines.push('CHEAPEST WINDOW');
    const checkinDt = new Date(cheapest.checkin);
    const displayDate = checkinDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    lines.push(`${displayDate} (${cheapest.nights}n): $${cheapest.totalPrice.toLocaleString()} [${cheapest.label}]`);
    lines.push(`  Flight: $${cheapest.flightPrice.toLocaleString()}`);
    lines.push(`  Airbnb: $${cheapest.airbnbPrice.toLocaleString()}`);

    if (savings && savings.amount > 0) {
      lines.push(`  SAVE $${savings.amount.toLocaleString()} (-${savings.pct}%) vs original dates`);
    }
    lines.push('');
  }

  // All options ranked
  lines.push(`ALL OPTIONS (${dateOptions.length} windows)`);
  dateOptions.forEach((opt, idx) => {
    const checkinDt = new Date(opt.checkin);
    const displayDate = checkinDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const marker = opt.checkin === cheapest?.checkin ? ' *BEST*' : '';
    const labelStr = opt.label ? ` (${opt.label})` : '';
    lines.push(`${idx + 1}. ${displayDate}: $${opt.totalPrice.toLocaleString()}${marker}${labelStr}`);
  });

  return lines.join('\n');
}

function formatForMessage(result) {
  if (!result.success) {
    return `Travel search failed: ${result.error}\n\nFallback links:\nFlights: ${result.fallbackUrls.flights}\nAirbnb: ${result.fallbackUrls.airbnb}`;
  }

  const { params, flights, airbnbs, hotels, recommendations } = result;
  const lines = [];

  // Find key combos for recommendations
  // Filter out excessively long flights (>14h) for "best value" recommendation
  const validFlights = flights.filter(f => !f.error && f.price > 0);
  const reasonableFlights = validFlights.filter(f => !f.durationMinutes || f.durationMinutes <= 840); // 14h max
  const bestValueFlight = reasonableFlights.length > 0
    ? reasonableFlights.reduce((a, b) => a.price < b.price ? a : b)
    : (validFlights.length > 0 ? validFlights.reduce((a, b) => a.price < b.price ? a : b) : null);
  const cheapestFlight = validFlights.length > 0 ? validFlights.reduce((a, b) => a.price < b.price ? a : b) : null;
  const validHotels = (hotels || []).filter(h => !h.error && h.priceTotal > 0);
  const cheapestHotel = validHotels.length > 0 ? validHotels.reduce((a, b) => a.priceTotal < b.priceTotal ? a : b) : null;
  const validAirbnbs = airbnbs.filter(a => !a.error && a.priceTotal > 0);
  const cheapestAirbnb = validAirbnbs.length > 0 ? validAirbnbs.reduce((a, b) => a.priceTotal < b.priceTotal ? a : b) : null;

  // Tax estimate for budget calc (20% for hotels/Airbnbs)
  const TAX_RATE = 0.20;

  // Build Google Flights URL for booking
  const destCode = params.destination.toUpperCase().slice(0, 3);
  const flightsUrl = `google.com/travel/flights?q=${params.origin}+to+${destCode}+${params.checkin}`;

  // TL;DR - Two recommendations at top (use bestValueFlight to exclude long flights)
  // No checkmarks in this section per v3.12
  lines.push('📌 RECOMMENDED');
  if (bestValueFlight && cheapestHotel) {
    const hotelTaxed = Math.round(cheapestHotel.priceTotal * (1 + TAX_RATE));
    const hotelTotal = bestValueFlight.price + hotelTaxed;
    lines.push(`Hotel: ${bestValueFlight.airline} + ${cheapestHotel.name.substring(0, 20)} = $${hotelTotal.toLocaleString()}`);
  }
  if (bestValueFlight && cheapestAirbnb) {
    const airbnbTaxed = Math.round(cheapestAirbnb.priceTotal * (1 + TAX_RATE));
    const airbnbTotal = bestValueFlight.price + airbnbTaxed;
    lines.push(`Airbnb: ${bestValueFlight.airline} + ${cheapestAirbnb.name.substring(0, 20)} = $${airbnbTotal.toLocaleString()}`);
  }
  lines.push('(prices incl. ~20% tax estimate)');
  lines.push('══════════');

  // Header
  lines.push(`${params.destination.toUpperCase()} ${params.checkin.slice(5)} to ${params.checkout.slice(5)} (${params.nights}n) | ${params.guests} guests | ${params.origin}`);
  if (params.budget) lines.push(`Budget: $${params.budget.toLocaleString()}`);
  lines.push('');

  // Flights - with booking link and duration warnings
  lines.push(`✈️ FLIGHTS (total for ${params.guests} passengers)`);
  flights.slice(0, 5).forEach(f => {
    if (f.error) {
      lines.push(`${f.id}. Error - ${f.fallbackUrl}`);
    } else {
      const stopsStr = f.stops === 'Nonstop' ? 'Nonstop' : f.stops;
      // Flag long flights (>14h) with warning
      const durationWarning = f.durationMinutes && f.durationMinutes > 840 ? ' ⚠️LONG' : '';
      lines.push(`${f.id}. ${f.airline.padEnd(12)} $${f.price.toLocaleString().padStart(5)} | ${f.duration} | ${stopsStr}${durationWarning}`);
    }
  });
  lines.push(`→ Book: ${flightsUrl}`);
  lines.push('────────');

  // Hotels (4+ star) - with links - show ALL hotels (typically 5-7)
  if (hotels && hotels.length > 0) {
    lines.push(`🏨 HOTELS (4+ star, ${params.nights} nights)`);
    hotels.forEach(h => {
      if (h.error) {
        lines.push(`${h.id}. Error`);
      } else {
        // Compact format: H1. Name | ⭐4.5 | $966 ($161/n)
        const ratingStr = h.rating ? `⭐${h.rating}` : '';
        const discountStr = h.discountPct ? ` 🏷️${h.discountPct}% off` : '';
        const amenityStr = h.amenities && h.amenities.includes('Pool') ? ' 🏊' : '';
        lines.push(`${h.id}. ${h.name.substring(0, 30)} | ${ratingStr} | $${h.priceTotal.toLocaleString()} ($${h.pricePerNight}/n)${discountStr}${amenityStr}`);
        if (h.url) lines.push(`→ ${h.url}`);
      }
    });
    lines.push('────────');
  }

  // Airbnbs - with direct links (show up to 10)
  lines.push(`🏠 AIRBNBS (${params.nights} nights, ${params.guests} guests)`);
  const avgPrice = validAirbnbs.reduce((sum, x) => sum + (x.priceTotal || 0), 0) / (validAirbnbs.length || 1);

  airbnbs.slice(0, 10).forEach(a => {
    if (a.error) {
      lines.push(`${a.id}. Error - ${a.fallbackUrl}`);
    } else {
      // Build badges
      const badges = [];
      if (a.superhost) badges.push('🏅');
      if (a.rating >= 4.8 && a.priceTotal < avgPrice) badges.push('💰');
      if (a.discountPct && a.discountPct >= 10) badges.push(`-${a.discountPct}%`);
      const badgeStr = badges.length > 0 ? ' ' + badges.join(' ') : '';

      // Beds info
      const bedsStr = a.beds ? `${a.beds}bd` : '';

      // Line 1: ID + name + badges
      lines.push(`${a.id}. ${a.name.substring(0, 35)}${badgeStr}`);

      // Line 2: beds | location | price (with per-night) | rating
      const parts = [];
      if (bedsStr) parts.push(bedsStr);
      if (a.neighborhood) parts.push(`📍${a.neighborhood.substring(0, 15)}`);
      // Show total + per-night: "$2,972 ($495/n)"
      const perNight = a.pricePerNight || (a.priceTotal > 0 && params.nights > 0 ? Math.round(a.priceTotal / params.nights) : 0);
      if (perNight > 0) {
        parts.push(`$${(a.priceTotal || 0).toLocaleString()} ($${perNight}/n)`);
      } else {
        parts.push(`$${(a.priceTotal || 0).toLocaleString()}`);
      }
      if (a.rating > 0) parts.push(`⭐${a.rating}`);
      lines.push(`    ${parts.join(' | ')}`);

      // Line 3: premium amenities (pool, hot tub, waterfront, etc.)
      if (a.amenities && a.amenities.length > 0) {
        const premiumKeywords = ['pool', 'hot tub', 'waterfront', 'game room', 'resort', 'beachfront', 'lake', 'ocean', 'jacuzzi', 'spa'];
        const premiumAmenities = a.amenities.filter(am =>
          premiumKeywords.some(kw => am.toLowerCase().includes(kw))
        ).slice(0, 4);
        if (premiumAmenities.length > 0) {
          // Use emojis for key amenities
          const amenityIcons = premiumAmenities.map(am => {
            const amLower = am.toLowerCase();
            if (amLower.includes('pool')) return '🏊 Pool';
            if (amLower.includes('hot tub') || amLower.includes('jacuzzi')) return '♨️ Hot Tub';
            if (amLower.includes('waterfront') || amLower.includes('beachfront') || amLower.includes('ocean') || amLower.includes('lake')) return '🌊 Waterfront';
            if (amLower.includes('game room')) return '🎮 Game Room';
            if (amLower.includes('resort')) return '🏨 Resort';
            if (amLower.includes('spa')) return '💆 Spa';
            return am;
          });
          lines.push(`    ${amenityIcons.join(' | ')}`);
        }
      }

      // Line 4: direct link
      if (a.url) lines.push(`    → ${a.url}`);
    }
  });
  lines.push('────────');

  // Transportation recommendation
  if (transportModule) {
    const transportLines = transportModule.formatTransportation(params.destination, params.nights);
    lines.push(...transportLines);
    lines.push('────────');
  }

  // Budget verdict - tax-adjusted (no checkmarks per v3.12)
  if (params.budget && bestValueFlight && (cheapestHotel || cheapestAirbnb)) {
    const cheapestAccom = cheapestHotel && cheapestAirbnb
      ? (cheapestHotel.priceTotal < cheapestAirbnb.priceTotal ? cheapestHotel : cheapestAirbnb)
      : (cheapestHotel || cheapestAirbnb);
    const accomTaxed = Math.round(cheapestAccom.priceTotal * (1 + TAX_RATE));
    const totalWithTax = bestValueFlight.price + accomTaxed;
    const remaining = params.budget - totalWithTax;

    if (remaining >= 0) {
      lines.push(`💰 UNDER BUDGET by ~$${remaining.toLocaleString()} (incl. tax estimate)`);
    } else {
      lines.push(`⚠️ OVER BUDGET by ~$${Math.abs(remaining).toLocaleString()} (incl. tax estimate)`);
    }
  }

  lines.push('');
  lines.push('📝 Flights include taxes. Hotels/Airbnbs shown pre-tax (+~20%).');
  lines.push('');
  lines.push('Want reviews on any listing? Tell me which (e.g., "H3 and A2").');

  return lines.join('\n');
}

// =============================================================================
// CLI Entry Point
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const options = {
    destination: null,
    checkin: null,
    checkout: null,
    guests: 4,
    origin: 'BOS',
    budget: null,
    format: 'json',
    flexDays: 0,
    noCache: false,
    amenityFilters: [],       // Required amenities to prioritize
    fetchFullAmenities: true  // Fetch amenities from individual listing pages
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dest':
      case '-d':
        options.destination = args[++i];
        break;
      case '--checkin':
        options.checkin = args[++i];
        break;
      case '--checkout':
        options.checkout = args[++i];
        break;
      case '--guests':
      case '-g':
        options.guests = parseInt(args[++i]);
        break;
      case '--origin':
      case '-o':
        options.origin = args[++i];
        break;
      case '--budget':
      case '-b':
        options.budget = parseInt(args[++i]);
        break;
      case '--format':
      case '-f':
        options.format = args[++i];
        break;
      case '--flex-days':
      case '--flex':
        options.flexDays = parseInt(args[++i]);
        break;
      case '--no-cache':
        options.noCache = true;
        break;
      case '--amenities':
      case '-a':
        // Comma-separated list of required amenities, e.g., "pool,hot tub"
        options.amenityFilters = args[++i].split(',').map(a => a.trim().toLowerCase());
        break;
      case '--no-amenities':
        options.fetchFullAmenities = false;
        break;
      case '--help':
      case '-h':
        console.log(`
Travel Search Puppeteer Scraper v2.0

Usage:
  node scrape.js --dest "Paris" --checkin "2026-04-17" --checkout "2026-04-23" --guests 4 --origin "BOS" --budget 6000

Options:
  --dest, -d       Destination city (required)
  --checkin        Check-in date YYYY-MM-DD (required)
  --checkout       Check-out date YYYY-MM-DD (required)
  --guests, -g     Number of guests (default: 4)
  --origin, -o     Origin airport code (default: BOS)
  --budget, -b     Total budget in USD (optional)
  --format, -f     Output format: json or message (default: json)
  --flex-days N    Search +/- N days from checkin (bidirectional)
                   Example: --flex-days 3 searches Apr 14-20 through Apr 20-26 (7 windows)
  --no-cache       Skip price caching (don't store or compare prices)
  --help, -h       Show this help

v2.0 Improvements:
  - Stealth mode: puppeteer-extra with stealth plugin avoids bot detection
  - Retry logic: Exponential backoff for transient failures (429, timeouts)
  - Price validation: Filters $0 flights, >$50k totals, warns on >$10k
  - Bidirectional flex dates: --flex-days 3 searches -3 to +3 days (7 windows)
  - Parallel flex search: 2-3 concurrent browser contexts with 2s stagger
  - 300+ airport codes: Comprehensive IATA database with validation warnings

Examples:
  node scrape.js --dest "Paris" --checkin "2026-04-17" --checkout "2026-04-23" --guests 4
  node scrape.js -d "Rome" --checkin "2026-05-01" --checkout "2026-05-08" -g 2 -o "JFK" -b 4000 -f message
  node scrape.js -d "Paris" --checkin "2026-04-17" --checkout "2026-04-23" --flex-days 3 -f message

Price Caching:
  Results are automatically stored in SQLite (~/.claude/skills/travel-search/data/price_cache.db)
  When historical data exists, output includes "vs 7-day avg" comparisons
  Use --no-cache to disable caching

Flexible Dates:
  With --flex-days N, searches all 2N+1 windows (-N to +N days from base date)
  Each window maintains the same number of nights
  Searches run in parallel (up to 3 concurrent) with 2s stagger to avoid rate limiting
  Results ranked by total cost (flight + Airbnb)
        `);
        process.exit(0);
    }
  }

  // Validate required arguments
  if (!options.destination) {
    console.error('Error: --dest is required');
    process.exit(1);
  }
  if (!options.checkin) {
    console.error('Error: --checkin is required');
    process.exit(1);
  }
  if (!options.checkout) {
    console.error('Error: --checkout is required');
    process.exit(1);
  }

  // Run search (flexible or single)
  let result;
  if (options.flexDays > 0) {
    result = await searchFlexibleDates(options);
  } else {
    result = await searchTravel(options);
  }

  // Output result
  if (options.format === 'message') {
    if (result.flexibleSearch) {
      console.log(formatFlexibleResults(result));
    } else {
      console.log(formatForMessage(result));
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for programmatic use
module.exports = {
  searchTravel,
  searchFlexibleDates,
  scrapeGoogleFlights,
  scrapeAirbnb,
  formatForMessage,
  formatFlexibleResults,
  generateDateWindows,
  offsetDate,
  getAirportCode,
  validateAirportCode,
  validateFlightResults,
  validateAirbnbResults,
  validateTotalCost,
  PRICE_LIMITS,
  withRetry,
  CONFIG,
  priceCache,
  airportData
};
