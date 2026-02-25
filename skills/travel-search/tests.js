#!/usr/bin/env node
/**
 * Travel Search Unit Tests
 *
 * Tests core functions without requiring browser/network access:
 * - generateDateWindows()
 * - getAirportCode()
 * - Price extraction patterns
 * - Price validation functions
 *
 * Run: node tests.js
 */

const {
  generateDateWindows,
  offsetDate,
  getAirportCode,
  validateAirportCode,
  validateFlightResults,
  validateAirbnbResults,
  validateTotalCost,
  PRICE_LIMITS,
  airportData,
  withRetry,
  CONFIG
} = require('./scrape.js');

// Test utilities
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (error) {
    console.log(`  [FAIL] ${name}`);
    console.log(`         ${error.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, msg = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected ${expectedStr}, got ${actualStr}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) {
    throw new Error(msg || 'Expected true, got false');
  }
}

// =============================================================================
// generateDateWindows Tests
// =============================================================================

console.log('\n--- generateDateWindows() Tests ---');

test('generates correct number of windows for flexDays=3', () => {
  // Use future dates to avoid past-date filtering
  const baseCheckin = '2030-06-15';
  const baseCheckout = '2030-06-20';
  const windows = generateDateWindows(baseCheckin, baseCheckout, 3);

  // Should generate 7 windows: -3, -2, -1, 0, +1, +2, +3
  assertEqual(windows.length, 7, 'Window count');
});

test('generates correct number of windows for flexDays=1', () => {
  const baseCheckin = '2030-06-15';
  const baseCheckout = '2030-06-20';
  const windows = generateDateWindows(baseCheckin, baseCheckout, 1);

  // Should generate 3 windows: -1, 0, +1
  assertEqual(windows.length, 3, 'Window count');
});

test('preserves number of nights in all windows', () => {
  const baseCheckin = '2030-06-15';
  const baseCheckout = '2030-06-20'; // 5 nights
  const windows = generateDateWindows(baseCheckin, baseCheckout, 2);

  for (const window of windows) {
    assertEqual(window.nights, 5, `Nights for ${window.checkin}`);
  }
});

test('labels windows correctly', () => {
  const baseCheckin = '2030-06-15';
  const baseCheckout = '2030-06-20';
  const windows = generateDateWindows(baseCheckin, baseCheckout, 2);

  const labels = windows.map(w => w.label);
  assertTrue(labels.includes('original'), 'Should have original');
  assertTrue(labels.includes('1d earlier'), 'Should have 1d earlier');
  assertTrue(labels.includes('2d earlier'), 'Should have 2d earlier');
  assertTrue(labels.includes('1d later'), 'Should have 1d later');
  assertTrue(labels.includes('2d later'), 'Should have 2d later');
});

test('filters out past dates', () => {
  // Use dates in the past
  const pastCheckin = '2020-01-15';
  const pastCheckout = '2020-01-20';
  const windows = generateDateWindows(pastCheckin, pastCheckout, 3);

  // All windows should be filtered out since they're in the past
  assertEqual(windows.length, 0, 'Past dates should be filtered');
});

test('offsets are correctly assigned', () => {
  const baseCheckin = '2030-06-15';
  const baseCheckout = '2030-06-20';
  const windows = generateDateWindows(baseCheckin, baseCheckout, 2);

  const offsets = windows.map(w => w.offset);
  assertTrue(offsets.includes(-2), 'Should have offset -2');
  assertTrue(offsets.includes(-1), 'Should have offset -1');
  assertTrue(offsets.includes(0), 'Should have offset 0');
  assertTrue(offsets.includes(1), 'Should have offset 1');
  assertTrue(offsets.includes(2), 'Should have offset 2');
});

// =============================================================================
// getAirportCode Tests
// =============================================================================

console.log('\n--- getAirportCode() Tests ---');

test('returns correct code for major cities', () => {
  // Suppress console.error for these tests
  const originalError = console.error;
  console.error = () => {};

  assertEqual(getAirportCode('paris'), 'CDG');
  assertEqual(getAirportCode('london'), 'LHR');
  assertEqual(getAirportCode('new york'), 'JFK');
  assertEqual(getAirportCode('tokyo'), 'NRT');
  assertEqual(getAirportCode('los angeles'), 'LAX');

  console.error = originalError;
});

test('handles city with country suffix', () => {
  const originalError = console.error;
  console.error = () => {};

  // Should extract city before comma
  assertEqual(getAirportCode('Paris, France'), 'CDG');
  assertEqual(getAirportCode('London, UK'), 'LHR');

  console.error = originalError;
});

test('returns valid code for already-uppercase airport code', () => {
  const originalError = console.error;
  console.error = () => {};

  assertEqual(getAirportCode('JFK'), 'JFK');
  assertEqual(getAirportCode('LAX'), 'LAX');
  assertEqual(getAirportCode('CDG'), 'CDG');

  console.error = originalError;
});

test('handles lowercase airport codes', () => {
  const originalError = console.error;
  console.error = () => {};

  assertEqual(getAirportCode('jfk'), 'JFK');
  assertEqual(getAirportCode('lax'), 'LAX');

  console.error = originalError;
});

// =============================================================================
// validateAirportCode Tests
// =============================================================================

console.log('\n--- validateAirportCode() Tests ---');

test('validates known airport codes', () => {
  const originalError = console.error;
  console.error = () => {};

  const jfk = validateAirportCode('JFK');
  assertTrue(jfk.valid, 'JFK should be valid');

  const lax = validateAirportCode('LAX');
  assertTrue(lax.valid, 'LAX should be valid');

  console.error = originalError;
});

test('returns invalid for fake codes', () => {
  const originalError = console.error;
  console.error = () => {};

  const fake = validateAirportCode('ZZZ');
  assertTrue(!fake.valid, 'ZZZ should be invalid');

  const xyz = validateAirportCode('XYZ');
  assertTrue(!xyz.valid, 'XYZ should be invalid');

  console.error = originalError;
});

// =============================================================================
// Price Extraction Pattern Tests
// =============================================================================

console.log('\n--- Price Extraction Pattern Tests ---');

test('extracts price from $XXX format', () => {
  const pattern = /\$[\d,]+/;

  assertTrue(pattern.test('$499'), 'Should match $499');
  assertTrue(pattern.test('$1,234'), 'Should match $1,234');
  assertTrue(pattern.test('$12,345'), 'Should match $12,345');
  assertTrue(pattern.test('Price: $500'), 'Should match embedded price');
});

test('extracts numeric value from price string', () => {
  const extractPrice = (text) => {
    const match = text.match(/\$[\d,]+/);
    return match ? parseInt(match[0].replace(/[$,]/g, '')) : 0;
  };

  assertEqual(extractPrice('$499'), 499);
  assertEqual(extractPrice('$1,234'), 1234);
  assertEqual(extractPrice('Total: $2,500'), 2500);
  assertEqual(extractPrice('no price'), 0);
});

test('duration regex extracts hours and minutes', () => {
  const durationPattern = /(\d+)\s*h(?:r|our)?s?\s*(\d+)?\s*m?/i;

  const test1 = '5h 30m'.match(durationPattern);
  assertEqual(test1[1], '5', 'Hours');
  assertEqual(test1[2], '30', 'Minutes');

  const test2 = '12hr 45m'.match(durationPattern);
  assertEqual(test2[1], '12', 'Hours');
  assertEqual(test2[2], '45', 'Minutes');

  const test3 = '3 hours'.match(durationPattern);
  assertEqual(test3[1], '3', 'Hours');
});

// =============================================================================
// Price Validation Tests
// =============================================================================

console.log('\n--- validateFlightResults() Tests ---');

test('filters out $0 flights', () => {
  const originalError = console.error;
  console.error = () => {};

  const flights = [
    { id: 'F1', airline: 'Test Air', price: 0 },
    { id: 'F2', airline: 'Valid Air', price: 500 },
    { id: 'F3', airline: 'Zero Air', price: 0 }
  ];

  const result = validateFlightResults(flights);
  assertEqual(result.length, 1, 'Should filter to 1 flight');
  assertEqual(result[0].price, 500, 'Should keep valid price');

  console.error = originalError;
});

test('filters out negative price flights', () => {
  const originalError = console.error;
  console.error = () => {};

  const flights = [
    { id: 'F1', airline: 'Negative Air', price: -100 },
    { id: 'F2', airline: 'Valid Air', price: 300 }
  ];

  const result = validateFlightResults(flights);
  assertEqual(result.length, 1, 'Should filter to 1 flight');

  console.error = originalError;
});

test('filters out excessive price flights (>$50k)', () => {
  const originalError = console.error;
  console.error = () => {};

  const flights = [
    { id: 'F1', airline: 'Expensive Air', price: 60000 },
    { id: 'F2', airline: 'Valid Air', price: 1000 }
  ];

  const result = validateFlightResults(flights);
  assertEqual(result.length, 1, 'Should filter to 1 flight');
  assertEqual(result[0].price, 1000, 'Should keep valid price');

  console.error = originalError;
});

test('keeps error entries unchanged', () => {
  const originalError = console.error;
  console.error = () => {};

  const flights = [
    { id: 'F1', error: true, message: 'Failed to load' },
    { id: 'F2', airline: 'Valid Air', price: 500 }
  ];

  const result = validateFlightResults(flights);
  assertEqual(result.length, 2, 'Should keep both entries');
  assertTrue(result[0].error, 'Error entry preserved');

  console.error = originalError;
});

console.log('\n--- validateAirbnbResults() Tests ---');

test('filters out $0 total Airbnb listings', () => {
  const originalError = console.error;
  console.error = () => {};

  const listings = [
    { id: 'A1', name: 'Free Place', priceTotal: 0, pricePerNight: 0 },
    { id: 'A2', name: 'Valid Place', priceTotal: 1000, pricePerNight: 200 }
  ];

  const result = validateAirbnbResults(listings);
  assertEqual(result.length, 1, 'Should filter to 1 listing');
  assertEqual(result[0].priceTotal, 1000, 'Should keep valid price');

  console.error = originalError;
});

test('filters out excessive total Airbnb (>$50k)', () => {
  const originalError = console.error;
  console.error = () => {};

  const listings = [
    { id: 'A1', name: 'Mansion', priceTotal: 75000, pricePerNight: 5000 },
    { id: 'A2', name: 'Cabin', priceTotal: 800, pricePerNight: 200 }
  ];

  const result = validateAirbnbResults(listings);
  assertEqual(result.length, 1, 'Should filter to 1 listing');
  assertEqual(result[0].name, 'Cabin', 'Should keep valid listing');

  console.error = originalError;
});

test('filters out excessive per-night Airbnb (>$10k/night)', () => {
  const originalError = console.error;
  console.error = () => {};

  const listings = [
    { id: 'A1', name: 'Luxury', priceTotal: 40000, pricePerNight: 15000 },
    { id: 'A2', name: 'Normal', priceTotal: 800, pricePerNight: 200 }
  ];

  const result = validateAirbnbResults(listings);
  assertEqual(result.length, 1, 'Should filter to 1 listing');
  assertEqual(result[0].name, 'Normal', 'Should keep valid listing');

  console.error = originalError;
});

console.log('\n--- validateTotalCost() Tests ---');

test('validates reasonable total costs', () => {
  const originalError = console.error;
  console.error = () => {};

  const result = validateTotalCost(1000, 2000);
  assertTrue(result.valid, 'Should be valid');
  assertEqual(result.total, 3000, 'Total should be sum');

  console.error = originalError;
});

test('invalidates excessive total costs', () => {
  const originalError = console.error;
  console.error = () => {};

  const result = validateTotalCost(30000, 25000);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.message.includes('exceeds'), 'Should have error message');

  console.error = originalError;
});

test('handles null/undefined prices', () => {
  const originalError = console.error;
  console.error = () => {};

  const result1 = validateTotalCost(null, 1000);
  assertEqual(result1.total, 1000, 'Should handle null flight');

  const result2 = validateTotalCost(500, undefined);
  assertEqual(result2.total, 500, 'Should handle undefined airbnb');

  console.error = originalError;
});

// =============================================================================
// PRICE_LIMITS Constants Tests
// =============================================================================

console.log('\n--- PRICE_LIMITS Configuration Tests ---');

test('flight limits are reasonable', () => {
  assertEqual(PRICE_LIMITS.flight.min, 1, 'Min flight price');
  assertEqual(PRICE_LIMITS.flight.max, 50000, 'Max flight price');
  assertEqual(PRICE_LIMITS.flight.warnAbove, 10000, 'Flight warning threshold');
});

test('airbnb limits are reasonable', () => {
  assertEqual(PRICE_LIMITS.airbnb.min, 1, 'Min airbnb price');
  assertEqual(PRICE_LIMITS.airbnb.maxTotal, 50000, 'Max airbnb total');
  assertEqual(PRICE_LIMITS.airbnb.maxPerNight, 10000, 'Max per night');
});

test('total limits are reasonable', () => {
  assertEqual(PRICE_LIMITS.total.max, 50000, 'Max total price');
  assertEqual(PRICE_LIMITS.total.warnAbove, 10000, 'Total warning threshold');
});

// =============================================================================
// withRetry() Tests
// =============================================================================

console.log('\n--- withRetry() Tests ---');

test('withRetry returns result on first success', async () => {
  const originalError = console.error;
  console.error = () => {};

  let callCount = 0;
  const result = await withRetry(async () => {
    callCount++;
    return 'success';
  }, { name: 'test', maxAttempts: 3 });

  assertEqual(result, 'success', 'Should return success');
  assertEqual(callCount, 1, 'Should only call once on success');

  console.error = originalError;
});

test('withRetry retries on retryable error then succeeds', async () => {
  const originalError = console.error;
  console.error = () => {};

  let callCount = 0;
  const result = await withRetry(async () => {
    callCount++;
    if (callCount < 2) {
      throw new Error('TimeoutError: navigation timeout');
    }
    return 'success after retry';
  }, { name: 'test', maxAttempts: 3 });

  assertEqual(result, 'success after retry', 'Should return success after retry');
  assertEqual(callCount, 2, 'Should call twice (1 fail + 1 success)');

  console.error = originalError;
});

test('withRetry throws after max attempts exceeded', async () => {
  const originalError = console.error;
  console.error = () => {};

  let callCount = 0;
  let thrownError = null;

  try {
    await withRetry(async () => {
      callCount++;
      throw new Error('net::ERR_CONNECTION_REFUSED');
    }, { name: 'test', maxAttempts: 2 });
  } catch (error) {
    thrownError = error;
  }

  assertTrue(thrownError !== null, 'Should throw error');
  assertTrue(thrownError.message.includes('ERR_CONNECTION_REFUSED'), 'Should throw the original error');
  assertEqual(callCount, 2, 'Should have tried maxAttempts times');

  console.error = originalError;
});

test('withRetry does not retry non-retryable errors', async () => {
  const originalError = console.error;
  console.error = () => {};

  let callCount = 0;
  let thrownError = null;

  try {
    await withRetry(async () => {
      callCount++;
      throw new Error('SyntaxError: invalid JSON');
    }, { name: 'test', maxAttempts: 3 });
  } catch (error) {
    thrownError = error;
  }

  assertTrue(thrownError !== null, 'Should throw error');
  assertEqual(callCount, 1, 'Should only call once for non-retryable error');

  console.error = originalError;
});

// =============================================================================
// Date Windows Partially in Past Tests
// =============================================================================

console.log('\n--- Date Windows Partially in Past Tests ---');

test('filters early windows when base date is near today', () => {
  // Create a base date that is 2 days from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const twoDaysFromNow = new Date(today);
  twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
  const baseCheckin = twoDaysFromNow.toISOString().split('T')[0];

  const fiveDaysFromNow = new Date(today);
  fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5);
  const baseCheckout = fiveDaysFromNow.toISOString().split('T')[0];

  // With flexDays=3, should generate -3 to +3 days
  // But -3 and possibly -2 would be in the past, so should be filtered
  const windows = generateDateWindows(baseCheckin, baseCheckout, 3);

  // Verify no windows have dates before today
  for (const window of windows) {
    const checkinDate = new Date(window.checkin);
    assertTrue(checkinDate >= today, `Window ${window.checkin} should not be in the past`);
  }

  // Should have fewer than 7 windows since some past dates are filtered
  assertTrue(windows.length < 7, 'Should filter out past date windows');
  assertTrue(windows.length > 0, 'Should have at least some valid windows');
});

test('returns some windows when only early dates are filtered', () => {
  // Create a base date that is exactly tomorrow
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const baseCheckin = tomorrow.toISOString().split('T')[0];

  const threeDaysLater = new Date(tomorrow);
  threeDaysLater.setDate(threeDaysLater.getDate() + 2);
  const baseCheckout = threeDaysLater.toISOString().split('T')[0];

  // With flexDays=2, should have -2, -1, 0, +1, +2
  // -2 would be yesterday (filtered), -1 would be today (kept)
  const windows = generateDateWindows(baseCheckin, baseCheckout, 2);

  // Should have windows from today onwards
  assertTrue(windows.length >= 3, 'Should have at least 3 windows (today, +1, +2)');

  // Original date should be included
  const originalWindow = windows.find(w => w.offset === 0);
  assertTrue(originalWindow !== undefined, 'Should include the original date');
});

test('includes today as valid checkin date', () => {
  // Create a base date that is tomorrow to avoid timezone edge cases
  // Then test that offset 0 (the base date) is included
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const baseCheckin = tomorrow.toISOString().split('T')[0];

  const fourDaysLater = new Date(tomorrow);
  fourDaysLater.setDate(fourDaysLater.getDate() + 3);
  const baseCheckout = fourDaysLater.toISOString().split('T')[0];

  // With flexDays=1, base date (tomorrow) should always be included
  const windows = generateDateWindows(baseCheckin, baseCheckout, 1);

  // The base date (offset 0) should always be included when it's in the future
  const baseWindow = windows.find(w => w.offset === 0);
  assertTrue(baseWindow !== undefined, 'Should include base date as valid checkin');
  assertTrue(windows.length >= 2, 'Should have at least 2 windows (base and +1)');
});

// =============================================================================
// CONFIG Tests
// =============================================================================

console.log('\n--- CONFIG Tests ---');

test('CONFIG has selector fallback threshold defined', () => {
  assertTrue(CONFIG.selectors !== undefined, 'CONFIG.selectors should exist');
  assertTrue(typeof CONFIG.selectors.fallbackThreshold === 'number', 'fallbackThreshold should be a number');
  assertEqual(CONFIG.selectors.fallbackThreshold, 3, 'fallbackThreshold should be 3');
});

// =============================================================================
// Summary
// =============================================================================

console.log('\n' + '='.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
