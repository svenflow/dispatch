#!/usr/bin/env node
/**
 * Chrome-based Airbnb Scraper
 *
 * Uses chrome-control CLI to scrape Airbnb with the user's logged-in session,
 * avoiding bot detection and captchas.
 *
 * This is part of the hybrid scraping approach:
 * - Google Flights: headless puppeteer (less blocking)
 * - Airbnb: Chrome with user session (avoids blocks)
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_CLI = path.join(process.env.HOME, '.claude/skills/chrome-control/scripts/chrome');
const EXTRACT_JS = path.join(__dirname, 'extract_airbnb.js');

// Configuration
const CONFIG = {
  maxListings: 10,
  pageLoadWait: 4000,     // Wait for page to load
  scrollWait: 1000,       // Wait between scrolls
  maxScrolls: 3,          // Number of scrolls to get more listings
  timeout: 30000,
  amenityPageWait: 3000,  // Wait for individual listing page
  maxAmenityListings: 5   // How many listings to fetch full amenities for
};

// Premium amenities that boost ranking
const PREMIUM_AMENITIES = [
  'pool', 'hot tub', 'waterfront', 'game room', 'resort',
  'beachfront', 'lake access', 'ocean view', 'private pool',
  'heated pool', 'infinity pool', 'jacuzzi', 'spa'
];

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
    console.error(`[Chrome] stderr: ${result.stderr}`);
    throw new Error(`Chrome command failed: ${args.join(' ')}`);
  }

  return result.stdout.trim();
}

/**
 * Open Airbnb search in Chrome
 */
function openAirbnbSearch(destination, checkin, checkout, guests) {
  const destSlug = destination.replace(/\s+/g, '-').replace(/,/g, '');
  const minBedrooms = Math.ceil(guests / 2);

  const url = `https://www.airbnb.com/s/${encodeURIComponent(destSlug)}/homes?adults=${guests}&checkin=${checkin}&checkout=${checkout}&min_bedrooms=${minBedrooms}`;

  console.error(`[Airbnb] Opening: ${url}`);

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
    console.error(`[Airbnb] Closed tab ${tabId}`);
  } catch (e) {
    console.error(`[Airbnb] Failed to close tab: ${e.message}`);
  }
}

/**
 * Sleep for ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Dismiss modals (cookie banners, login prompts, verify identity)
 */
function dismissModals(tabId) {
  try {
    chrome(['key', tabId, 'Escape']);
  } catch (e) {
    // Ignore
  }
}

/**
 * Scroll down to load more listings
 */
function scrollPage(tabId) {
  try {
    chrome(['scroll', tabId, 'down', '3']);
  } catch (e) {
    console.error(`[Airbnb] Scroll failed: ${e.message}`);
  }
}

/**
 * Extract listing data from the page using JavaScript
 */
function extractListings(tabId, nights) {
  // Read the extraction script
  const jsCode = fs.readFileSync(EXTRACT_JS, 'utf8');

  try {
    const result = chrome(['js', tabId, jsCode]);
    const listings = JSON.parse(result);

    // Add per-night price calculation
    return listings.map(l => ({
      ...l,
      pricePerNight: l.priceTotal > 0 ? Math.round(l.priceTotal / nights) : 0,
      url: `https://www.airbnb.com/rooms/${l.id}`
    }));
  } catch (e) {
    console.error(`[Airbnb] Failed to extract listings: ${e.message}`);
    return [];
  }
}

/**
 * Main scrape function
 */
async function scrapeAirbnb(destination, checkin, checkout, guests) {
  // Calculate nights
  const checkinDate = new Date(checkin);
  const checkoutDate = new Date(checkout);
  const nights = Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));

  console.error(`[Airbnb] Scraping ${destination} | ${checkin} to ${checkout} | ${guests} guests | ${nights} nights`);

  let tabId = null;

  try {
    // Open Airbnb search
    tabId = openAirbnbSearch(destination, checkin, checkout, guests);

    // Wait for page to load
    await sleep(CONFIG.pageLoadWait);

    // Dismiss any modals
    dismissModals(tabId);
    await sleep(500);

    // Extract initial listings
    let listings = extractListings(tabId, nights);
    console.error(`[Airbnb] Initial extraction: ${listings.length} listings`);

    // Scroll to load more if needed
    for (let i = 0; i < CONFIG.maxScrolls && listings.length < CONFIG.maxListings; i++) {
      scrollPage(tabId);
      await sleep(CONFIG.scrollWait);
      listings = extractListings(tabId, nights);
      console.error(`[Airbnb] After scroll ${i + 1}: ${listings.length} listings`);
    }

    // Filter out listings with $0 price (parsing failures)
    const validListings = listings.filter(l => l.priceTotal > 0);
    console.error(`[Airbnb] Valid listings (with prices): ${validListings.length}`);

    // Close the tab
    closeTab(tabId);
    tabId = null;

    // Add IDs and return
    return validListings.map((l, idx) => ({
      ...l,
      id: `A${idx + 1}`,
      listingId: l.id
    }));

  } catch (error) {
    console.error(`[Airbnb] Scrape failed: ${error.message}`);

    // Clean up tab if still open
    if (tabId) {
      closeTab(tabId);
    }

    // Return error object
    return [{
      id: 'A1',
      error: true,
      message: error.message,
      fallbackUrl: `https://www.airbnb.com/s/${encodeURIComponent(destination)}/homes?adults=${guests}&checkin=${checkin}&checkout=${checkout}`
    }];
  }
}

/**
 * Extract amenities from individual listing page
 */
function extractAmenitiesFromPage(tabId) {
  const jsCode = `
    (() => {
      const amenities = [];

      // Look for amenity items in the page
      // Airbnb uses various selectors for amenities
      const selectors = [
        '[data-testid="amenity-item"]',
        '[data-section-id="AMENITIES_DEFAULT"] div',
        '.l1nqfsv9 div', // Common amenity container class
        '[aria-label*="amenity"]',
        'div[role="listitem"]' // Amenity list items
      ];

      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        elements.forEach(el => {
          const text = el.textContent?.trim().toLowerCase();
          if (text && text.length > 2 && text.length < 50) {
            // Check if it looks like an amenity (not a description)
            if (!text.includes('show all') && !text.includes('reviews') &&
                !text.includes('\\$') && !text.includes('per night')) {
              amenities.push(text);
            }
          }
        });
        if (amenities.length > 5) break;
      }

      // Also look for specific amenity keywords in page content
      const pageText = document.body.innerText.toLowerCase();
      const premiumKeywords = ['pool', 'hot tub', 'waterfront', 'game room', 'resort',
                               'beachfront', 'lake access', 'ocean view', 'jacuzzi', 'spa'];

      premiumKeywords.forEach(kw => {
        if (pageText.includes(kw) && !amenities.includes(kw)) {
          amenities.push(kw);
        }
      });

      return [...new Set(amenities)].slice(0, 15);
    })();
  `;

  try {
    const result = chrome(['js', tabId, jsCode]);
    return JSON.parse(result);
  } catch (e) {
    console.error(`[Airbnb] Failed to extract amenities: ${e.message}`);
    return [];
  }
}

/**
 * Fetch full amenities for top listings by visiting each page
 */
async function fetchFullAmenities(listings, maxListings = 5) {
  console.error(`[Airbnb] Fetching full amenities for top ${Math.min(listings.length, maxListings)} listings...`);

  const enhancedListings = [];
  const toFetch = listings.slice(0, maxListings);

  for (let i = 0; i < toFetch.length; i++) {
    const listing = toFetch[i];
    let tabId = null;

    try {
      // Open the listing page
      const url = listing.url || `https://www.airbnb.com/rooms/${listing.listingId || listing.id}`;
      console.error(`[Airbnb] Fetching amenities for listing ${i + 1}/${toFetch.length}: ${url}`);

      const result = chrome(['open', url]);
      const match = result.match(/Opened tab (\\d+)/);
      if (!match) {
        enhancedListings.push(listing);
        continue;
      }

      tabId = match[1];
      await sleep(CONFIG.amenityPageWait);

      // Dismiss any modals
      dismissModals(tabId);
      await sleep(500);

      // Extract amenities
      const amenities = extractAmenitiesFromPage(tabId);

      // Calculate premium amenity count for ranking boost
      const premiumCount = amenities.filter(a =>
        PREMIUM_AMENITIES.some(pa => a.includes(pa))
      ).length;

      enhancedListings.push({
        ...listing,
        amenities,
        premiumAmenityCount: premiumCount,
        amenitiesSource: 'full_page'
      });

      // Close the tab
      closeTab(tabId);
      tabId = null;

    } catch (e) {
      console.error(`[Airbnb] Error fetching amenities: ${e.message}`);
      enhancedListings.push(listing);
      if (tabId) closeTab(tabId);
    }
  }

  // Add remaining listings without enhanced amenities
  for (let i = maxListings; i < listings.length; i++) {
    enhancedListings.push(listings[i]);
  }

  return enhancedListings;
}

/**
 * Re-rank listings based on premium amenities
 */
function rankByAmenities(listings, requiredAmenities = []) {
  return listings.sort((a, b) => {
    // First priority: required amenities
    if (requiredAmenities.length > 0) {
      const aHasRequired = requiredAmenities.every(req =>
        (a.amenities || []).some(am => am.includes(req.toLowerCase()))
      );
      const bHasRequired = requiredAmenities.every(req =>
        (b.amenities || []).some(am => am.includes(req.toLowerCase()))
      );
      if (aHasRequired && !bHasRequired) return -1;
      if (!aHasRequired && bHasRequired) return 1;
    }

    // Second priority: premium amenity count
    const aPremium = a.premiumAmenityCount || 0;
    const bPremium = b.premiumAmenityCount || 0;
    if (aPremium !== bPremium) return bPremium - aPremium;

    // Third priority: rating
    return (b.rating || 0) - (a.rating || 0);
  });
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.error('Usage: chrome_airbnb.js <destination> <checkin> <checkout> <guests>');
    console.error('Example: chrome_airbnb.js "Paris, France" 2026-04-17 2026-04-23 4');
    process.exit(1);
  }

  const [destination, checkin, checkout, guests] = args;

  const startTime = Date.now();
  const listings = await scrapeAirbnb(destination, checkin, checkout, parseInt(guests));
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.error(`[Airbnb] Completed in ${elapsed}s`);

  // Output as JSON
  console.log(JSON.stringify(listings, null, 2));
}

// Export for use as module
module.exports = {
  scrapeAirbnb,
  fetchFullAmenities,
  rankByAmenities,
  PREMIUM_AMENITIES,
  CONFIG
};

// Run if called directly
if (require.main === module) {
  main().catch(e => {
    console.error(`Fatal error: ${e.message}`);
    process.exit(1);
  });
}
