#!/usr/bin/env node
/**
 * Amadeus Flight API Integration
 *
 * Uses Amadeus Self-Service API for flight search
 * Much faster and more reliable than scraping Google Flights
 *
 * Requires: AMADEUS_API_KEY and AMADEUS_API_SECRET in ~/.claude/secrets.env
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// =============================================================================
// Configuration
// =============================================================================

const AMADEUS_BASE_URL = 'api.amadeus.com';
const TOKEN_CACHE_FILE = path.join(__dirname, '.amadeus_token');

// Load credentials from secrets.env
function loadCredentials() {
  const secretsPath = path.join(process.env.HOME, '.claude', 'secrets.env');
  if (!fs.existsSync(secretsPath)) {
    throw new Error('secrets.env not found. Run: echo "AMADEUS_API_KEY=xxx" >> ~/.claude/secrets.env');
  }

  const content = fs.readFileSync(secretsPath, 'utf8');
  const creds = {};

  for (const line of content.split('\n')) {
    const match = line.match(/^(AMADEUS_\w+)=(.+)$/);
    if (match) {
      creds[match[1]] = match[2].trim();
    }
  }

  if (!creds.AMADEUS_API_KEY || !creds.AMADEUS_API_SECRET) {
    throw new Error('AMADEUS_API_KEY and AMADEUS_API_SECRET required in ~/.claude/secrets.env');
  }

  return creds;
}

// =============================================================================
// Token Management
// =============================================================================

async function getAccessToken() {
  // Check cached token
  if (fs.existsSync(TOKEN_CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
      if (cached.expires_at > Date.now() + 60000) { // 1 min buffer
        return cached.access_token;
      }
    } catch (e) {
      // Cache invalid, get new token
    }
  }

  const creds = loadCredentials();

  return new Promise((resolve, reject) => {
    const postData = `grant_type=client_credentials&client_id=${creds.AMADEUS_API_KEY}&client_secret=${creds.AMADEUS_API_SECRET}`;

    const options = {
      hostname: AMADEUS_BASE_URL,
      port: 443,
      path: '/v1/security/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`Amadeus auth error: ${json.error_description || json.error}`));
            return;
          }

          // Cache token
          const tokenData = {
            access_token: json.access_token,
            expires_at: Date.now() + (json.expires_in * 1000)
          };
          fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(tokenData));

          resolve(json.access_token);
        } catch (e) {
          reject(new Error(`Failed to parse Amadeus token response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// =============================================================================
// Flight Search
// =============================================================================

async function searchFlights(origin, destination, departureDate, returnDate, adults = 1) {
  const token = await getAccessToken();

  // Build query parameters
  const params = new URLSearchParams({
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate: departureDate,
    adults: adults.toString(),
    currencyCode: 'USD',
    max: '10'  // Get more options to find best deals
  });

  if (returnDate) {
    params.append('returnDate', returnDate);
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname: AMADEUS_BASE_URL,
      port: 443,
      path: `/v2/shopping/flight-offers?${params.toString()}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    };

    console.error(`[Amadeus] Searching ${origin} → ${destination}, ${departureDate} to ${returnDate}, ${adults} pax`);
    const startTime = Date.now();

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`[Amadeus] Response received in ${elapsed}s`);

        try {
          const json = JSON.parse(data);

          if (json.errors) {
            console.error(`[Amadeus] API error: ${JSON.stringify(json.errors)}`);
            resolve({ flights: [], error: json.errors[0]?.detail || 'API error' });
            return;
          }

          const flights = parseFlightOffers(json.data || [], json.dictionaries || {});
          console.error(`[Amadeus] Found ${flights.length} flight options`);

          resolve({ flights, raw: json });
        } catch (e) {
          console.error(`[Amadeus] Parse error: ${e.message}`);
          resolve({ flights: [], error: e.message });
        }
      });
    });

    req.on('error', (e) => {
      console.error(`[Amadeus] Request error: ${e.message}`);
      resolve({ flights: [], error: e.message });
    });

    req.end();
  });
}

// =============================================================================
// Parse Amadeus Response
// =============================================================================

function parseFlightOffers(offers, dictionaries) {
  const carriers = dictionaries.carriers || {};
  const aircraft = dictionaries.aircraft || {};

  return offers.slice(0, 5).map((offer, index) => {
    try {
      const price = parseFloat(offer.price?.total || 0);
      const itineraries = offer.itineraries || [];

      // Outbound flight
      const outbound = itineraries[0] || {};
      const outboundSegments = outbound.segments || [];
      const outboundFirst = outboundSegments[0] || {};
      const outboundLast = outboundSegments[outboundSegments.length - 1] || {};

      // Return flight (if exists)
      const returnFlight = itineraries[1] || {};
      const returnSegments = returnFlight.segments || [];

      // Calculate total duration
      const outboundDuration = parseDuration(outbound.duration);
      const returnDuration = parseDuration(returnFlight.duration);

      // Get carrier info
      const carrierCode = outboundFirst.carrierCode || '';
      const carrierName = carriers[carrierCode] || carrierCode;

      // Operating carrier might be different
      const operatingCode = outboundFirst.operating?.carrierCode || '';
      const operatingName = operatingCode && operatingCode !== carrierCode
        ? carriers[operatingCode] || operatingCode
        : null;

      const stops = outboundSegments.length - 1;

      return {
        id: `F${index + 1}`,
        airline: carrierName,
        airlineCode: carrierCode,
        operatedBy: operatingName,
        price: price,
        pricePerPerson: price / (offer.travelerPricings?.length || 1),
        currency: offer.price?.currency || 'USD',

        outbound: {
          departure: outboundFirst.departure?.isoDateTime || outboundFirst.departure?.at,
          departureAirport: outboundFirst.departure?.iataCode,
          arrival: outboundLast.arrival?.isoDateTime || outboundLast.arrival?.at,
          arrivalAirport: outboundLast.arrival?.iataCode,
          duration: outboundDuration,
          durationFormatted: formatDuration(outboundDuration),
          stops: stops,
          segments: outboundSegments.length
        },

        return: returnSegments.length > 0 ? {
          departure: returnSegments[0]?.departure?.isoDateTime || returnSegments[0]?.departure?.at,
          departureAirport: returnSegments[0]?.departure?.iataCode,
          arrival: returnSegments[returnSegments.length - 1]?.arrival?.isoDateTime || returnSegments[returnSegments.length - 1]?.arrival?.at,
          arrivalAirport: returnSegments[returnSegments.length - 1]?.arrival?.iataCode,
          duration: returnDuration,
          durationFormatted: formatDuration(returnDuration),
          stops: returnSegments.length - 1
        } : null,

        bookingClass: offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || 'ECONOMY',
        seatsRemaining: offer.numberOfBookableSeats,
        lastTicketingDate: offer.lastTicketingDate,

        // Direct booking link
        bookingUrl: buildBookingUrl(offer, outboundFirst, outboundLast)
      };
    } catch (e) {
      console.error(`[Amadeus] Error parsing offer ${index}: ${e.message}`);
      return {
        id: `F${index + 1}`,
        error: e.message
      };
    }
  });
}

function parseDuration(isoDuration) {
  if (!isoDuration) return 0;
  // PT7H5M -> 425 minutes
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  return hours * 60 + minutes;
}

function formatDuration(minutes) {
  if (!minutes) return 'N/A';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
}

function buildBookingUrl(offer, firstSegment, lastSegment) {
  // Build Google Flights search URL as a starting point
  const origin = firstSegment.departure?.iataCode || '';
  const dest = lastSegment.arrival?.iataCode || '';
  const date = firstSegment.departure?.at?.split('T')[0] || '';

  return `https://www.google.com/travel/flights?q=${origin}+to+${dest}+${date}`;
}

// =============================================================================
// Test / CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Amadeus Flight Search API

Usage:
  node amadeus.js --origin BOS --dest CDG --depart 2026-04-17 --return 2026-04-23 --pax 4

Options:
  --origin, -o    Origin airport code (default: BOS)
  --dest, -d      Destination airport code (required)
  --depart        Departure date YYYY-MM-DD (required)
  --return        Return date YYYY-MM-DD (optional, omit for one-way)
  --pax, -p       Number of passengers (default: 1)
  --help, -h      Show this help
`);
    process.exit(0);
  }

  // Parse arguments
  const getArg = (names) => {
    for (const name of names) {
      const idx = args.indexOf(name);
      if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    }
    return null;
  };

  const origin = getArg(['--origin', '-o']) || 'BOS';
  const dest = getArg(['--dest', '-d']);
  const depart = getArg(['--depart']);
  const returnDate = getArg(['--return']);
  const pax = parseInt(getArg(['--pax', '-p']) || '1');

  if (!dest || !depart) {
    console.error('Error: --dest and --depart are required');
    process.exit(1);
  }

  try {
    const result = await searchFlights(origin, dest, depart, returnDate, pax);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

// Export for use as module
module.exports = { searchFlights, getAccessToken };

// Run if called directly
if (require.main === module) {
  main();
}
