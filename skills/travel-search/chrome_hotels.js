#!/usr/bin/env node
/**
 * Chrome-based Google Hotels Scraper
 *
 * Uses chrome-control CLI to scrape Google Hotels with the user's session,
 * focusing on 4+ star luxury hotels.
 *
 * Part of the hybrid scraping approach:
 * - Google Flights: headless puppeteer
 * - Airbnb: Chrome with user session
 * - Google Hotels: Chrome with user session (new)
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');

const CHROME_CLI = path.join(process.env.HOME, '.claude/skills/chrome-control/scripts/chrome');

// Configuration
const CONFIG = {
  maxListings: 10,
  pageLoadWait: 5000,
  scrollWait: 1500,
  maxScrolls: 2,
  timeout: 30000,
  minStars: 4  // Only 4+ star hotels
};

/**
 * Execute a chrome-control command and return the result
 */
function chrome(args) {
  const result = spawnSync(CHROME_CLI, args, {
    encoding: 'utf8',
    timeout: CONFIG.timeout,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    console.error(`[Hotels] stderr: ${result.stderr}`);
    throw new Error(`Chrome command failed: ${args.join(' ')}`);
  }

  return result.stdout.trim();
}

/**
 * Open Google Hotels search in Chrome
 */
function openHotelsSearch(destination, checkin, checkout, guests) {
  // Google Hotels URL - using the dates as query parameters
  const url = `https://www.google.com/travel/hotels/${encodeURIComponent(destination)}?q=${encodeURIComponent(destination)}+4+star+hotels&hl=en&gl=us&dates=${checkin}%2C${checkout}&guests=${guests}`;

  console.error(`[Hotels] Opening: ${url}`);

  const result = chrome(['open', url]);
  const match = result.match(/Opened tab (\d+)/);
  if (!match) {
    throw new Error(`Failed to open tab: ${result}`);
  }

  return match[1];
}

/**
 * Close a Chrome tab
 */
function closeTab(tabId) {
  try {
    chrome(['close', tabId]);
    console.error(`[Hotels] Closed tab ${tabId}`);
  } catch (e) {
    console.error(`[Hotels] Failed to close tab: ${e.message}`);
  }
}

/**
 * Sleep for ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Dismiss modals
 */
function dismissModals(tabId) {
  try {
    chrome(['key', tabId, 'Escape']);
  } catch (e) {
    // Ignore
  }
}

/**
 * Scroll down to load more hotels
 */
function scrollPage(tabId) {
  try {
    chrome(['scroll', tabId, 'down', '3']);
  } catch (e) {
    console.error(`[Hotels] Scroll failed: ${e.message}`);
  }
}

/**
 * Extract hotel data from the page using JavaScript
 * Based on observed Google Hotels DOM structure (Feb 2026)
 */
function extractHotels(tabId, nights) {
  // Simpler extraction script that matches the observed DOM
  const jsCode = `
(function() {
  try {
    const hotels = [];

    // Look for hotel name elements - they use specific classes
    // Names appear in links with hrefs containing /entity/
    const nameLinks = document.querySelectorAll('a[href*="/entity/"]');
    const seen = new Set();

    nameLinks.forEach(link => {
      try {
        const name = link.textContent.trim();
        if (!name || name.length < 3 || name.length > 80 || seen.has(name.toLowerCase())) return;
        seen.add(name.toLowerCase());

        // Find the parent container with price info
        let container = link.closest('[data-hveid]') || link.parentElement?.parentElement?.parentElement;
        if (!container) return;

        const text = container.textContent || '';

        // Skip sponsored results at the top (they're in a carousel)
        if (container.closest('[aria-label*="Sponsored"]')) return;

        // Extract price - look for $XXX patterns
        let price = 0;
        const priceMatches = text.match(/\\$(\\d{1,4})(?![\\d,])/g);
        if (priceMatches && priceMatches.length > 0) {
          // Take the first reasonable price (not thousands)
          for (const pm of priceMatches) {
            const p = parseInt(pm.replace('$', ''));
            if (p >= 30 && p <= 2000) {
              price = p;
              break;
            }
          }
        }

        // Extract rating - look for X.X/5 or X.X followed by star
        let rating = 0;
        const ratingMatch = text.match(/(\\d\\.\\d)\\/5/) || text.match(/(\\d\\.\\d)\\s*★/);
        if (ratingMatch) {
          rating = parseFloat(ratingMatch[1]);
        }

        // Extract review count - look for (X.XK) or (XXX)
        let reviews = 0;
        const reviewMatch = text.match(/\\((\\d+\\.?\\d*)K\\)/i);
        if (reviewMatch) {
          reviews = Math.round(parseFloat(reviewMatch[1]) * 1000);
        } else {
          const reviewMatch2 = text.match(/\\((\\d{2,5})\\)/);
          if (reviewMatch2) {
            reviews = parseInt(reviewMatch2[1]);
          }
        }

        // Check for 4-star or 5-star
        let starClass = 0;
        if (/5-star/i.test(text)) starClass = 5;
        else if (/4-star/i.test(text)) starClass = 4;
        else if (/3-star/i.test(text)) starClass = 3;

        // Check for deal badge
        const hasDiscount = /GREAT DEAL|DEAL|less than usual/i.test(text);
        let discountPct = null;
        const discountMatch = text.match(/(\\d+)%\\s*less/i);
        if (discountMatch) {
          discountPct = parseInt(discountMatch[1]);
        }

        // Check for amenities
        const amenities = [];
        if (/pool/i.test(text)) amenities.push('Pool');
        if (/spa/i.test(text)) amenities.push('Spa');
        if (/gym|fitness/i.test(text)) amenities.push('Gym');
        if (/restaurant/i.test(text)) amenities.push('Restaurant');
        if (/breakfast/i.test(text)) amenities.push('Breakfast');
        if (/parking/i.test(text)) amenities.push('Parking');
        if (/wi-fi|wifi/i.test(text)) amenities.push('WiFi');

        // Free cancellation
        const freeCancellation = /free cancellation/i.test(text);

        // Get URL
        const url = link.href || '';

        // Only add if we have minimum data
        if (price > 0 && (starClass >= 4 || rating >= 4.0)) {
          hotels.push({
            name: name.substring(0, 60),
            price,
            rating,
            reviews,
            starClass,
            hasDiscount,
            discountPct,
            amenities,
            freeCancellation,
            url
          });
        }
      } catch (e) {
        // Skip this element
      }
    });

    return JSON.stringify(hotels.slice(0, 15));
  } catch (e) {
    return JSON.stringify([]);
  }
})();
`;

  try {
    const result = chrome(['js', tabId, jsCode]);

    // Handle potential wrapper or empty result
    if (!result || result === 'undefined' || result === 'null') {
      console.error('[Hotels] Empty JS result');
      return [];
    }

    let hotels;
    try {
      hotels = JSON.parse(result);
    } catch (parseErr) {
      console.error(`[Hotels] JSON parse error: ${parseErr.message}`);
      console.error(`[Hotels] Raw result (first 200 chars): ${result.substring(0, 200)}`);
      return [];
    }

    if (!Array.isArray(hotels)) {
      console.error('[Hotels] Result is not an array');
      return [];
    }

    // Add per-night price (Google shows per-night already) and total calculation
    return hotels.map(h => ({
      ...h,
      pricePerNight: h.price,
      priceTotal: h.price * nights
    }));
  } catch (e) {
    console.error(`[Hotels] Failed to extract hotels: ${e.message}`);
    return [];
  }
}

/**
 * Main scrape function
 */
async function scrapeHotels(destination, checkin, checkout, guests) {
  // Calculate nights
  const checkinDate = new Date(checkin);
  const checkoutDate = new Date(checkout);
  const nights = Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));

  console.error(`[Hotels] Scraping ${destination} | ${checkin} to ${checkout} | ${guests} guests | ${nights} nights`);

  let tabId = null;

  try {
    // Open Google Hotels search
    tabId = openHotelsSearch(destination, checkin, checkout, guests);

    // Wait for page to load
    await sleep(CONFIG.pageLoadWait);

    // Dismiss any modals
    dismissModals(tabId);
    await sleep(500);

    // Extract initial hotels
    let hotels = extractHotels(tabId, nights);
    console.error(`[Hotels] Initial extraction: ${hotels.length} hotels`);

    // Scroll to load more if needed
    for (let i = 0; i < CONFIG.maxScrolls && hotels.length < CONFIG.maxListings; i++) {
      scrollPage(tabId);
      await sleep(CONFIG.scrollWait);
      hotels = extractHotels(tabId, nights);
      console.error(`[Hotels] After scroll ${i + 1}: ${hotels.length} hotels`);
    }

    // Filter to valid hotels with prices
    const validHotels = hotels.filter(h => h.priceTotal > 0);
    console.error(`[Hotels] Valid hotels: ${validHotels.length}`);

    // Close the tab
    closeTab(tabId);
    tabId = null;

    // Sort: deals first, then by rating
    validHotels.sort((a, b) => {
      if (a.hasDiscount && !b.hasDiscount) return -1;
      if (!a.hasDiscount && b.hasDiscount) return 1;
      return b.rating - a.rating;
    });

    // Add IDs and return
    return validHotels.slice(0, CONFIG.maxListings).map((h, idx) => ({
      ...h,
      id: `H${idx + 1}`
    }));

  } catch (error) {
    console.error(`[Hotels] Scrape failed: ${error.message}`);

    // Clean up tab if still open
    if (tabId) {
      closeTab(tabId);
    }

    // Return error object with fallback URL
    return [{
      id: 'H1',
      error: true,
      message: error.message,
      fallbackUrl: `https://www.google.com/travel/hotels?q=${encodeURIComponent(destination)}+hotels`
    }];
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.error('Usage: chrome_hotels.js <destination> <checkin> <checkout> <guests>');
    console.error('Example: chrome_hotels.js "Amsterdam" 2026-04-17 2026-04-26 4');
    process.exit(1);
  }

  const [destination, checkin, checkout, guests] = args;

  const startTime = Date.now();
  const hotels = await scrapeHotels(destination, checkin, checkout, parseInt(guests));
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.error(`[Hotels] Completed in ${elapsed}s`);

  // Output as JSON
  console.log(JSON.stringify(hotels, null, 2));
}

// Export for use as module
module.exports = { scrapeHotels };

// Run if called directly
if (require.main === module) {
  main().catch(e => {
    console.error(`Fatal error: ${e.message}`);
    process.exit(1);
  });
}
