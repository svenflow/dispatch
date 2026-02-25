#!/usr/bin/env node
/**
 * Puppeteer-based Google Hotels Scraper
 *
 * Uses puppeteer-extra with stealth plugin to scrape Google Hotels,
 * focusing on 4+ star luxury hotels with deals.
 *
 * Puppeteer bypasses Trusted Types restrictions that block chrome-control JS.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// Configuration
const CONFIG = {
  headless: 'new',
  timeout: 30000,
  maxListings: 10,
  minStars: 4
};

/**
 * Extract hotels from Google Hotels page
 * Based on observed structure: hotel names appear with $XX prices and X.X/5 ratings
 */
async function extractHotels(page, nights) {
  return await page.evaluate((nights, minStars) => {
    const hotels = [];
    const seen = new Set();

    // Get body text and parse hotel entries
    // Format: "Hotel Name\n$XXX\n Booking Site\nX.X/5\n(X.XK)\n · X-star hotel\nAmenity · Amenity"
    const text = document.body.innerText;

    // Find patterns that look like hotel entries:
    // Hotel Name followed by price and rating
    // Regex to find "Name\n$123" patterns
    const hotelPattern = /([A-Z][A-Za-z0-9\s\-'&]+(?:Hotel|Inn|Suites?|Hilton|Marriott|Amsterdam|Courtyard|DoubleTree|Waldorf|Hampton|Westin|Sheraton|Hyatt|Radisson|Novotel|Ibis|NH |W |citizenM|Kimpton|Andaz|Pulitzer|Conservatorium|De L'Europe|Intercontinental|Sofitel|Park Plaza)[A-Za-z0-9\s\-'&]*)\n\$(\d{2,4})\n([^\n]+)\n(\d\.\d)\/5\n\(([0-9.]+K?)\)/gi;

    let match;
    while ((match = hotelPattern.exec(text)) !== null) {
      const name = match[1].trim();
      const price = parseInt(match[2]);
      const bookingSite = match[3].trim();
      const rating = parseFloat(match[4]);
      let reviews = match[5];

      // Skip if already seen
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      // Parse review count
      let reviewCount = 0;
      if (reviews.endsWith('K')) {
        reviewCount = Math.round(parseFloat(reviews) * 1000);
      } else {
        reviewCount = parseInt(reviews);
      }

      // Check star class - look in surrounding text
      const idx = text.indexOf(name);
      const surroundingText = text.substring(idx, idx + 200);
      let starClass = 0;
      if (/5-star/i.test(surroundingText)) starClass = 5;
      else if (/4-star/i.test(surroundingText)) starClass = 4;
      else if (/3-star/i.test(surroundingText)) starClass = 3;

      // Check for deals
      const hasDiscount = /GREAT DEAL|less than usual/i.test(surroundingText);
      let discountPct = null;
      const discountMatch = surroundingText.match(/(\d+)%\s*less/i);
      if (discountMatch) discountPct = parseInt(discountMatch[1]);

      // Check amenities
      const amenities = [];
      if (/Pool/i.test(surroundingText)) amenities.push('Pool');
      if (/Spa/i.test(surroundingText)) amenities.push('Spa');
      if (/Restaurant/i.test(surroundingText)) amenities.push('Restaurant');
      if (/Breakfast/i.test(surroundingText)) amenities.push('Breakfast');
      if (/Kid-friendly/i.test(surroundingText)) amenities.push('Kid-friendly');

      // Free cancellation
      const freeCancellation = /free cancellation/i.test(surroundingText);

      // Clean up name (remove stray prefixes from regex capture)
      let cleanName = name
        .replace(/^(Restaurant|Kid-friendly|Spa|Pool|Pet-friendly|Amsterdam hotels)\n/gi, '')
        .replace(/\n/g, ' ')
        .trim();

      // Only include 4+ star or high-rated hotels
      if (price > 0 && (starClass >= minStars || rating >= 4.0)) {
        hotels.push({
          name: cleanName.substring(0, 60),
          pricePerNight: price,
          priceTotal: price * nights,
          rating,
          reviews: reviewCount,
          starClass,
          hasDiscount,
          discountPct,
          amenities,
          freeCancellation,
          bookingSite
          // URL will be constructed in post-processing with destination context
        });
      }
    }

    return hotels;
  }, nights, CONFIG.minStars);
}

/**
 * Main scrape function
 */
async function scrapeHotels(destination, checkin, checkout, guests) {
  const checkinDate = new Date(checkin);
  const checkoutDate = new Date(checkout);
  const nights = Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));

  console.error(`[Hotels] Scraping ${destination} | ${checkin} to ${checkout} | ${guests} guests | ${nights} nights`);

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: CONFIG.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Google Hotels URL with 4-star filter
    const url = `https://www.google.com/travel/hotels/${encodeURIComponent(destination)}?q=${encodeURIComponent(destination)}+4+star+hotels&hl=en&gl=us&dates=${checkin},${checkout}&guests=${guests}`;

    console.error(`[Hotels] Loading: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.timeout });

    // Wait for results
    await page.waitForSelector('[data-hveid]', { timeout: 10000 }).catch(() => {
      console.error('[Hotels] No results selector found, trying anyway');
    });

    // Wait a bit for dynamic content
    await new Promise(r => setTimeout(r, 2000));

    // Extract hotels
    let hotels = await extractHotels(page, nights);
    console.error(`[Hotels] Initial extraction: ${hotels.length} hotels`);

    // Scroll for more
    if (hotels.length < CONFIG.maxListings) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await new Promise(r => setTimeout(r, 1500));
      hotels = await extractHotels(page, nights);
      console.error(`[Hotels] After scroll: ${hotels.length} hotels`);
    }

    // Sort: deals first, then by rating
    hotels.sort((a, b) => {
      if (a.hasDiscount && !b.hasDiscount) return -1;
      if (!a.hasDiscount && b.hasDiscount) return 1;
      return b.rating - a.rating;
    });

    // Add IDs and construct Google Hotels search URLs
    return hotels.slice(0, CONFIG.maxListings).map((h, idx) => ({
      ...h,
      id: `H${idx + 1}`,
      url: `https://www.google.com/travel/hotels?q=${encodeURIComponent(h.name + ' ' + destination)}&dates=${checkin},${checkout}&guests=${guests}`
    }));

  } catch (error) {
    console.error(`[Hotels] Scrape failed: ${error.message}`);
    return [{
      id: 'H1',
      error: true,
      message: error.message,
      fallbackUrl: `https://www.google.com/travel/hotels?q=${encodeURIComponent(destination)}+hotels`
    }];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.error('Usage: puppeteer_hotels.js <destination> <checkin> <checkout> <guests>');
    console.error('Example: puppeteer_hotels.js "Amsterdam" 2026-04-17 2026-04-26 4');
    process.exit(1);
  }

  const [destination, checkin, checkout, guests] = args;

  const startTime = Date.now();
  const hotels = await scrapeHotels(destination, checkin, checkout, parseInt(guests));
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.error(`[Hotels] Completed in ${elapsed}s`);
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
