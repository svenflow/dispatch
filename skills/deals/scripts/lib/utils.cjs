'use strict';

/**
 * Deals Skill - Utilities
 * Price parsing, name cleaning, product matching, deal scoring
 */

// ============================================================
// PRICE PARSING
// ============================================================

/**
 * Parse a price string like "$1,299.99" into a number.
 * Returns null if unparseable or outside sane bounds ($0.50 - $100,000).
 */
function parsePrice(str) {
  if (!str && str !== 0) return null;
  if (typeof str === 'number') {
    return (str >= 0.50 && str <= 100000) ? str : null;
  }
  const match = String(str).match(/\$?([\d,]+\.?\d*)/);
  if (!match) return null;
  const val = parseFloat(match[1].replace(/,/g, ''));
  // Reject scraping artifacts (<$0.50) and absurd prices (>$100K)
  if (isNaN(val) || val < 0.50 || val > 100000) return null;
  return val;
}

/**
 * Format a number as a price string: "$1,299.99"
 */
function formatPrice(num) {
  if (num == null) return '--';
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Calculate discount info from current and original price.
 */
function calcDiscount(currentPrice, originalPrice) {
  if (!currentPrice || !originalPrice || originalPrice <= currentPrice) {
    return { percent: 0, amount: 0 };
  }
  const amount = Math.round((originalPrice - currentPrice) * 100) / 100;
  const percent = Math.round((1 - currentPrice / originalPrice) * 100);
  return { percent, amount };
}

// ============================================================
// PRODUCT NAME CLEANING
// ============================================================

/** Noise patterns to strip from product names */
const NOISE_PATTERNS = [
  /Rating\s+\d+(\.\d+)?\s+out\s+of\s+\d+\s+stars?(\s+with\s+\d+\s+reviews?)?/gi,
  /Not\s+yet\s+reviewed/gi,
  /\d+\+?\s+bought\s+in\s+past\s+month/gi,
  /Only\s+\d+\s+left\s+in\s+stock/gi,
  /\bSponsored\b/gi,
  /\bBest\s*Seller\b/gi,
  /\bAmazon['']?s?\s+Choice\b/gi,
  /\bLimited\s+time\s+deal\b/gi,
  /\bClimate\s+Pledge\s+Friendly\b/gi,
  /\bFree\s+delivery\b/gi,
  /\bPrime\b/gi,
  /\bSave\s+\$[\d,.]+/gi,
  /\(\d+\s+used\s+&\s+new\s+offers?\)/gi,
  /\bModel:\s*\S+/gi,
  /\bSKU:\s*\S+/gi,
  // Marketplace UI text that leaks through scraping
  /Opens in a new window or tab/gi,
  /New Listing\s*/gi,
  /\bFree Returns\b/gi,
  /\bFree shipping\b/gi,
  /\s{2,}/g, // collapse multiple spaces
];

/**
 * Clean a product name by removing noise patterns.
 */
function cleanProductName(name) {
  if (!name) return '';
  let cleaned = name.trim();
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  // Cap length
  if (cleaned.length > 150) cleaned = cleaned.substring(0, 147) + '...';
  return cleaned;
}

// ============================================================
// PRODUCT MATCHING (cross-store dedup)
// ============================================================

/**
 * Extract brand and model from a product name.
 */
function extractBrandModel(name) {
  if (!name) return { brand: '', model: '' };
  const cleaned = name.toLowerCase();

  // Common electronics brands
  const brands = [
    'samsung', 'lg', 'sony', 'canon', 'nikon', 'panasonic', 'hisense', 'tcl',
    'vizio', 'insignia', 'toshiba', 'sharp', 'philips', 'dell', 'hp', 'lenovo',
    'asus', 'acer', 'msi', 'gigabyte', 'corsair', 'logitech', 'razer', 'apple',
    'bose', 'jbl', 'sennheiser', 'nvidia', 'amd', 'intel', 'western digital',
    'seagate', 'crucial', 'kingston', 'epson', 'brother', 'fujifilm', 'olympus',
    'garmin', 'fitbit', 'roku', 'amazon', 'google', 'microsoft', 'nintendo',
    'dyson', 'kitchenaid', 'whirlpool', 'ge', 'frigidaire', 'bosch', 'maytag',
    'onkyo', 'yamaha', 'denon', 'marantz', 'pioneer', 'harman kardon', 'anthem',
    'nad', 'klipsch', 'svs', 'kef', 'polk', 'definitive technology', 'sonos',
    'pyle', 'hisense', 'tcl', 'vizio',
    'viewsonic', 'benq', 'aoc', 'pixio', 'nixeus', 'dough',
  ];

  let brand = '';
  for (const b of brands) {
    // Use word-boundary regex to prevent "lg" matching "bulging", "aoc" matching "peacock" etc.
    const bRegex = new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (bRegex.test(cleaned)) {
      brand = b;
      break;
    }
  }

  // Extract model number patterns
  // Try specific patterns first, then fall back to generic
  const modelPatterns = [
    // SKU-style model numbers: QN55S85FA, OLED55C5P, UN55U7900F, 55U65QF
    /\b([A-Z]{2,}\d{2,}[A-Z0-9]{2,})\b/i,
    // TV series names: C5, C4, S90, U6, U7, U8, A80J, X80L, QM6K, QM5K
    /\b([A-Z]\d{1,2}[A-Z]?)\s+(?:series|class)/i,
    /\bseries\s+([A-Z]\d{1,2}[A-Z]?)\b/i,
    // Camera/lens models: EOS R8, X-T5, A7C, RF 35mm
    /\b([A-Z]{1,4}[-\s]?[A-Z]?\d{1,3}[A-Z]?\b)(?!\s*(?:inch|in\b|"|class|hz|lbs?))/i,
    // Numeric model: 65C350, 55QN85D
    /\b(\d{2,4}[A-Z]{1,4}\d{0,4})\b/i,
  ];

  let model = '';
  for (const p of modelPatterns) {
    const m = name.match(p);
    if (m) {
      const candidate = m[1].trim();
      // Skip if it's just a screen size like "55" or brand repeated
      if (/^\d{2,3}$/.test(candidate)) continue;
      if (candidate.toLowerCase() === brand) continue;
      model = candidate;
      break;
    }
  }

  return { brand, model };
}

/**
 * Generate a matching key for cross-store product dedup.
 * Products with similar keys are likely the same product.
 */
function matchKey(name, price) {
  if (!name) return '';
  const nameLC = name.toLowerCase();
  // Separate refurbished/renewed from new products in dedup
  const isRefurb = /\b(refurbished|refurb|renewed|open[\s-]?box|pre-?owned)\b/i.test(nameLC);
  const conditionSuffix = isRefurb ? ':refurb' : '';
  const { brand, model } = extractBrandModel(name);
  if (brand && model) {
    // Normalize model: strip noise words (AI, evo, Ultra, Pro, Series, Class, etc.)
    // and non-alphanumeric chars, so "AI C5" and "C5" match
    const modelNorm = model.toLowerCase()
      .replace(/\b(ai|evo|ultra|pro|plus|series|class|smart|tv|inch|new)\b/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    if (modelNorm) return `${brand}:${modelNorm}${conditionSuffix}`;
  }
  // Fallback: more chars + price bucket to separate configurations
  const normalized = nameLC.replace(/[^a-z0-9]/g, '').substring(0, 60);
  if (price) {
    const bucket = Math.round(price / 50) * 50;
    return `${normalized}:p${bucket}${conditionSuffix}`;
  }
  return normalized + conditionSuffix;
}

// ============================================================
// DEAL SCORE ALGORITHM
// ============================================================

/**
 * TV spec scoring template.
 * Returns 0-100 based on technical specs.
 */
function scoreTVSpecs(specs) {
  let score = 0;

  // Resolution (0-20)
  const res = (specs.resolution || '').toLowerCase();
  if (res.includes('8k')) score += 20;
  else if (res.includes('4k') || res.includes('2160')) score += 15;
  else if (res.includes('1080') || res.includes('fhd')) score += 10;
  else if (res.includes('720')) score += 5;
  else score += 10; // assume 4K if not specified for modern TVs

  // Panel type (0-30) — widened range to create meaningful gaps
  const panel = (specs.panelType || specs.displayType || '').toLowerCase();
  if (panel.includes('qd-oled') || panel.includes('qd oled')) score += 30;
  else if (panel.includes('oled')) score += 28;
  else if (panel.includes('mini led') || panel.includes('miniled')) score += 20;
  else if (panel.includes('neo') || panel.includes('nanocell')) score += 16;
  else if (panel.includes('qled') || panel.includes('qd-led')) score += 12;
  else if (panel.includes('led') || panel.includes('lcd')) score += 5;
  else score += 5;

  // Refresh rate (0-20)
  const hz = parseInt(specs.refreshRate) || 60;
  if (hz >= 240) score += 20;
  else if (hz >= 144) score += 17;
  else if (hz >= 120) score += 15;
  else score += 5;

  // HDR (0-15)
  const hdr = (specs.hdr || '').toLowerCase();
  if (hdr.includes('dolby vision')) score += 15;
  else if (hdr.includes('hdr10+') || hdr.includes('hdr10 plus')) score += 12;
  else if (hdr.includes('hdr10') || hdr.includes('hdr')) score += 8;
  else score += 3;

  // OLED implicit HDR bonus: all modern OLEDs support Dolby Vision
  // Add points if OLED but HDR wasn't detected in the name
  if (panel.includes('oled') && !hdr.includes('dolby vision')) score += 5;

  // Smart platform (0-10)
  const platform = (specs.smartPlatform || '').toLowerCase();
  if (platform.includes('webos') || platform.includes('tizen')) score += 10;
  else if (platform.includes('google tv') || platform.includes('android')) score += 8;
  else if (platform.includes('roku') || platform.includes('fire')) score += 7;
  else score += 3;

  // Size bonus (0-10)
  const size = parseInt(specs.screenSize) || 0;
  if (size >= 65) score += 10;
  else if (size >= 55) score += 9;
  else if (size >= 50) score += 7;
  else if (size >= 43) score += 5;
  else score += 2;

  return score;
}

/**
 * Camera spec scoring template.
 * Returns 0-100 based on technical specs.
 */
function scoreCameraSpecs(specs) {
  let score = 0;

  // Sensor size (0-25)
  const sensor = (specs.sensorSize || '').toLowerCase();
  if (sensor.includes('medium format')) score += 25;
  else if (sensor.includes('full frame') || sensor.includes('35mm')) score += 20;
  else if (sensor.includes('aps-c') || sensor.includes('apsc')) score += 12;
  else if (sensor.includes('micro four') || sensor.includes('m43')) score += 10;
  else if (sensor.includes('1"') || sensor.includes('1 inch')) score += 5;
  else score += 10;

  // Resolution (0-15)
  const mp = parseInt(specs.megapixels) || 0;
  if (mp >= 40) score += 15;
  else if (mp >= 24) score += 13;
  else if (mp >= 16) score += 10;
  else score += 5;

  // Video (0-20)
  const video = (specs.video || '').toLowerCase();
  if (video.includes('6k') || video.includes('8k')) score += 20;
  else if (video.includes('4k60') || video.includes('4k 60')) score += 15;
  else if (video.includes('4k30') || video.includes('4k')) score += 10;
  else score += 5;

  // AF (0-15)
  const af = (specs.autofocus || '').toLowerCase();
  if (af.includes('subject') || af.includes('animal') || af.includes('vehicle')) score += 15;
  else if (af.includes('eye')) score += 13;
  else if (af.includes('phase')) score += 10;
  else score += 5;

  // Stabilization (0-15)
  const stab = (specs.stabilization || '').toLowerCase();
  if (stab.includes('ibis') && stab.includes('lens')) score += 15;
  else if (stab.includes('ibis') || stab.includes('body')) score += 12;
  else if (stab.includes('lens') || stab.includes('is') || stab.includes('ois')) score += 8;
  else score += 0;

  // Build (0-10)
  const build = (specs.build || '').toLowerCase();
  if (build.includes('weather') || build.includes('sealed')) score += 10;
  else if (build.includes('metal') || build.includes('magnesium')) score += 6;
  else score += 3;

  return score;
}

/**
 * Headphone/earbud spec scoring template.
 * Returns 0-100 based on technical specs extracted from product name.
 */
function scoreHeadphoneSpecs(specs) {
  let score = 0;
  const name = (specs.name || specs.productName || '').toLowerCase();

  // ANC tier (0-25)
  if (/\b(adaptive\s+noise|active\s+noise|anc)\b/.test(name)) score += 20;
  else if (/\bnoise\s*cancell?ing\b/.test(name)) score += 18;
  else if (/\bnoise\s*(reduction|isolat)/i.test(name)) score += 10;
  else score += 5;

  // Form factor (0-15)
  if (/\bover[- ]ear\b/.test(name)) score += 15;
  else if (/\bon[- ]ear\b/.test(name)) score += 12;
  else if (/\b(in[- ]ear|earbuds?|iem)\b/.test(name)) score += 10;
  else score += 8;

  // Codec / wireless tech (0-10)
  if (/\bldac\b/.test(name)) score += 10;
  else if (/\baptx\s*(adaptive|hd)\b/.test(name)) score += 9;
  else if (/\baptx\b/.test(name)) score += 7;
  else if (/\bbluetooth\s*5\.[3-9]\b/.test(name)) score += 6;
  else if (/\b(wireless|bluetooth)\b/.test(name)) score += 4;
  else if (/\bwired\b/.test(name)) score += 3;
  else score += 4;

  // Battery life (0-15)
  const battMatch = name.match(/(\d{1,3})\s*(?:hr|hour|hrs|h)\s*(?:battery|playtime|play time|listening)?/i);
  if (battMatch) {
    const hrs = parseInt(battMatch[1]);
    if (hrs >= 50) score += 15;
    else if (hrs >= 40) score += 13;
    else if (hrs >= 30) score += 11;
    else if (hrs >= 20) score += 8;
    else if (hrs >= 10) score += 5;
    else score += 3;
  } else {
    score += 5; // unknown battery
  }

  // Driver size (0-10)
  const driverMatch = name.match(/(\d{2,3})\s*mm\s*(driver|neodymium)?/i);
  if (driverMatch) {
    const mm = parseInt(driverMatch[1]);
    if (mm >= 50) score += 10;
    else if (mm >= 40) score += 8;
    else if (mm >= 30) score += 5;
    else score += 3;
  } else {
    score += 5; // unknown driver
  }

  // Flagship model boost (0-15)
  if (/\bwh-?1000xm[4-9]\b/.test(name)) score += 15;         // Sony flagship
  else if (/\bqc\s*(ultra|45|35|ii)\b/.test(name)) score += 15;    // Bose flagship
  else if (/\bairpods?\s*(max|pro)\b/.test(name)) score += 15;     // Apple flagship
  else if (/\bmomentum\s*(4|true\s*wireless)\b/.test(name)) score += 14; // Sennheiser
  else if (/\bpx[78]\b/.test(name)) score += 13;                    // B&W
  else if (/\bult\s*wear\b/.test(name)) score += 10;                // Sony mid-tier
  else if (/\btune\s*\d{3}/i.test(name)) score += 6;                // JBL budget
  else score += 3;

  // Multipoint / spatial audio bonus (0-5)
  if (/\b(multipoint|multi-?point)\b/.test(name)) score += 3;
  if (/\b(spatial|360|head\s*track)/i.test(name)) score += 2;

  return Math.min(score, 100);
}

/**
 * Generic spec scoring - extracts what it can from product name.
 * Returns 0-100.
 */
function scoreGenericSpecs(productName) {
  let score = 50; // neutral default
  const name = (productName || '').toLowerCase();

  // Bonus points for premium indicators
  if (name.includes('oled')) score += 15;
  if (name.includes('mini led') || name.includes('miniled')) score += 10;
  if (name.includes('qled')) score += 5;
  if (name.includes('4k') || name.includes('uhd')) score += 5;
  if (name.includes('8k')) score += 8;
  if (name.includes('240hz')) score += 10;
  if (name.includes('144hz')) score += 7;
  if (name.includes('120hz')) score += 5;
  if (name.includes('hdr') || name.includes('dolby vision')) score += 5;
  if (name.includes('full frame')) score += 10;

  return Math.min(score, 100);
}

/**
 * Score specs based on category.
 * @param {string} category - 'tv', 'camera', 'monitor', or null for generic
 * @param {object} specs - structured spec data (from API) or { name } for text extraction
 * @returns {number} 0-100
 */
function scoreSpecs(category, specs) {
  if (!specs) return 50; // neutral

  switch ((category || '').toLowerCase()) {
    case 'tv':
    case 'television':
      return scoreTVSpecs(specs);
    case 'monitor':
      // Monitors share display tech with TVs - resolution, panel type, refresh rate, HDR all apply
      return scoreTVSpecs(specs);
    case 'camera':
      return scoreCameraSpecs(specs);
    case 'headphones':
      return scoreHeadphoneSpecs(specs);
    default:
      // Try to extract from product name
      return scoreGenericSpecs(specs.name || specs.productName || '');
  }
}

/**
 * Calculate deal score (0-100).
 *
 * deal_score = reviews(0.30) + specs(0.25) + brand(0.15) + priceValue(0.10) + discountDepth(0.10) + storeTrust(0.10)
 *
 * @param {object} product
 * @param {number} product.price - current sale price
 * @param {number} [product.originalPrice] - was/list price
 * @param {number} [product.reviewScore] - 1-5 stars
 * @param {number} [product.reviewCount] - number of reviews
 * @param {string} [product.category] - product category for spec scoring
 * @param {object} [product.specs] - structured spec data
 * @param {string} [product.name] - product name for brand/spec extraction
 * @param {string} [product.storeKey] - store key for trust scoring
 * @param {string} [product.source] - data source (api, scrape, api+verified)
 * @returns {object} { score, components: { priceValue, reviews, specs, discountDepth, storeTrust, brand } }
 */
/**
 * Dual scoring: QUALITY (how good is this product?) + VALUE (how good is this deal?)
 *
 * Quality is price-blind: brand, specs, reviews, store trust.
 * Value is deal-focused: discount depth, specs-per-dollar, reviews-per-dollar.
 * Both 0-100. Combined score (50/50 blend) used for default sort.
 * Tag: "Sweet Spot" (high Q + V), "Premium" (high Q), "Deal" (high V), "" (mid).
 */
function dealScore(product) {
  const { price, originalPrice, reviewScore, reviewCount, category, specs, storeKey, source } = product;

  // --- Shared components ---
  const specQuality = scoreSpecs(category, specs || { name: product.name });
  const brand = brandScore(product.name);
  const storeTrust = storeTrustScore(storeKey, source);

  // Review score normalized to 0-100 (no reviews = 50 neutral)
  // Apply confidence discount: <20 reviews = unreliable, ramp linearly
  let revNorm = reviewScore ? (reviewScore / 5) * 100 : 50;
  if (reviewScore && reviewCount != null && reviewCount < 20) {
    const confidence = Math.max(reviewCount / 20, 0.1); // 1 review = 5%, 10 reviews = 50%
    revNorm = 50 + (revNorm - 50) * confidence; // blend toward neutral 50
  }
  // Review volume: log-scaled so 10 reviews isn't crushed vs 10K
  // log10(11)/log10(10001) = 0.26, log10(101)=0.50, log10(1001)=0.75, log10(10001)=1.0
  let revVolume = reviewCount ? Math.min(Math.log10(reviewCount + 1) / Math.log10(10001), 1) * 100 : 0;
  if (reviewCount && reviewCount < 5) revVolume = Math.min(revVolume, 15);

  // Refurbished / open box penalty on quality
  const nameLC = (product.name || '').toLowerCase();
  const isRefurb = /\b(refurb|renewed|open box|pre-?owned|certified refurb)\b/i.test(nameLC);
  const refurbPenalty = isRefurb ? 0.85 : 1.0; // 15% quality penalty

  // --- QUALITY SCORE (price-blind) ---
  // Category-aware weights: appliances prioritize review volume over specs
  const isApplianceCat = /^(appliance|microwave|coffee|vacuum|hvac|outdoor)$/.test(category || '');
  let qualityRaw;
  if (isApplianceCat) {
    // Appliance: Brand(0.25) + Specs(0.15) + ReviewScore(0.30) + ReviewVolume(0.20) + StoreTrust(0.10)
    qualityRaw = (brand * 0.25) + (specQuality * 0.15) + (revNorm * 0.30) +
                 (revVolume * 0.20) + (storeTrust * 0.10);
  } else {
    // Electronics: Brand(0.30) + Specs(0.30) + ReviewScore(0.25) + ReviewVolume(0.10) + StoreTrust(0.05)
    qualityRaw = (brand * 0.30) + (specQuality * 0.30) + (revNorm * 0.25) +
                 (revVolume * 0.10) + (storeTrust * 0.05);
  }
  const quality = _clamp(Math.round(qualityRaw * refurbPenalty));

  // --- VALUE SCORE (deal-focused) ---
  // Discount(0.35) + SpecsPerDollar(0.25) + ReviewPerDollar(0.20) + StoreTrust(0.10) + ReviewScore(0.10)
  let discountPct = 0;
  if (originalPrice && originalPrice > price && price > 0) {
    discountPct = Math.min(((originalPrice - price) / originalPrice) * 100, 100);
  }

  // Specs per dollar: how good are the specs relative to what you'd expect at this price?
  // Normalized against category median price so scores are comparable across categories.
  // A product at the median price with average specs (50) scores ~50.
  // Below median = bonus, above median = penalty. Specs amplify the effect.
  const CATEGORY_MEDIAN_PRICE = {
    headphones: 150, tv: 500, monitor: 300, camera: 800,
    laptop: 700, desktop: 600, audio: 400, phone: 600,
    tablet: 400, gaming: 400, gpu: 400, appliance: 500,
    microwave: 100, coffee: 80, vacuum: 250, hvac: 300,
  };
  const medianPrice = CATEGORY_MEDIAN_PRICE[category] || 200;

  // Formula: (specs/100) * min(medianPrice/price, 1.5) * 100, clamped 0-100
  // Price ratio capped at 1.5x so ultra-cheap products can't auto-max both components.
  // At median price with 50 specs: (50/100) * (1.0) * 100 = 50
  // At 2/3 median with 50 specs: (50/100) * (1.5) * 100 = 75
  // At 1/7 median with 47 specs: (47/100) * (1.5) * 100 = 71 (capped, not 335)
  // At double median with 50 specs: (50/100) * (0.5) * 100 = 25
  const priceRatio = price > 0 ? Math.min(medianPrice / price, 1.5) : 1;
  const specsPerDollar = _clamp(Math.round((specQuality / 100) * priceRatio * 100));

  // Review quality per dollar: same approach, same cap
  const revPerDollar = (price > 0 && reviewScore)
    ? _clamp(Math.round((revNorm / 100) * Math.min(medianPrice / price, 1.5) * 100))
    : 50;

  const valueRaw = (discountPct * 0.35) + (specsPerDollar * 0.25) +
                   (revPerDollar * 0.20) + (storeTrust * 0.10) + (revNorm * 0.10);
  const value = _clamp(Math.round(valueRaw));

  // --- DATA CONFIDENCE ---
  // How much data we have to support these scores (0-1)
  let dataFields = 0;
  if (price > 0) dataFields++;
  if (originalPrice && originalPrice > 0) dataFields++;
  if (reviewScore) dataFields++;
  if (reviewCount && reviewCount >= 10) dataFields++;
  if (specQuality > 30) dataFields++; // parsed meaningful specs
  const dataConfidence = dataFields / 5;

  // --- TAG ---
  // Premium requires high quality AND mid+ price (>$300); budget items with high Q get no misleading Premium label
  let tag = '';
  const isPremiumPrice = price >= 300;
  if (dataConfidence < 0.5) tag = isRefurb ? 'Low Data/Refurb' : 'Low Data';
  else if (quality >= 75 && value >= 65) tag = isRefurb ? 'Sweet Spot/Refurb' : 'Sweet Spot';
  else if (quality >= 75 && isPremiumPrice) tag = isRefurb ? 'Premium/Refurb' : 'Premium';
  else if (value >= 65) tag = isRefurb ? 'Deal/Refurb' : 'Deal';
  else if (quality >= 60 && value >= 50) tag = isRefurb ? 'Solid/Refurb' : 'Solid';
  else if (isRefurb) tag = 'Refurb';

  // Combined score for default sorting (balanced 50/50)
  const score = Math.round((quality * 0.5) + (value * 0.5));

  return {
    score,
    quality,
    value,
    tag,
    dataConfidence,
    components: {
      brand: Math.round(brand),
      specs: Math.round(specQuality),
      revScore: Math.round(revNorm),
      revVolume: Math.round(revVolume),
      storeTrust: Math.round(storeTrust),
      discountPct: Math.round(discountPct),
      specsPerDollar,
      revPerDollar,
    }
  };
}

function _clamp(n) { return Math.max(0, Math.min(100, n)); }

// ============================================================
// SPEC EXTRACTION FROM PRODUCT NAME
// ============================================================

/**
 * Try to guess category from product name.
 */
function guessCategory(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  // TV check first when "TV" or "television" is explicitly in the name.
  // This prevents "CanvasTV 4K QLED TV with Hi-Matte Display" from being classified as monitor.
  // Monitor/display classification only wins when "TV"/"television" is absent.
  if (/\b(tv|television|smart tv)\b/.test(n) && !/\b(monitor)\b/.test(n)) return 'tv';
  if (/\b(monitor|display)\b/.test(n)) return 'monitor';
  if (/\b\d{2,3}[""]?\s*(inch|in|class)\b/.test(n) && !/\b(monitor|display)\b/.test(n)) return 'tv';
  if (/\b(camera|dslr|mirrorless|eos|alpha|z\d)\b/.test(n)) return 'camera';
  if (/\b(projector|home theater projector|laser projector)\b/.test(n)) return 'projector';
  if (/\b(mac mini|mac studio|mac pro|desktop)\b/.test(n) && !/\bimac\b/.test(n)) return 'desktop';
  if (/\b(imac|all[- ]in[- ]one)\b/.test(n)) return 'aio';
  if (/\b(laptop|notebook|chromebook|macbook)\b/.test(n)) return 'laptop';
  if (/\b(ipad|tablet|galaxy tab|surface pro|fire hd)\b/.test(n)) return 'tablet';
  if (/\b(headphones?|earbuds?|airpods?|iem|in-ear)\b/.test(n)) return 'headphones';
  if (/\b(receiver|amplifier|av receiver|stereo receiver|surround sound|soundbar|subwoofer)\b/.test(n)) return 'audio';
  if (/\b(speaker|bookshelf speaker|tower speaker|center channel)\b/.test(n) && !/\btv\b/.test(n)) return 'audio';
  if (/\b(gpu|graphics card|rtx|radeon|geforce)\b/.test(n)) return 'gpu';
  if (/\b(keyboard|mouse|webcam|mousepad|desk mat)\b/.test(n)) return 'peripherals';
  if (/\b(iphone|galaxy s|pixel \d|smartphone|android phone)\b/.test(n)) return 'phone';
  if (/\b(apple watch|galaxy watch|fitbit|garmin|smartwatch|wearable)\b/.test(n)) return 'wearable';
  if (/\b(router|mesh|wifi|access point|modem|ethernet switch)\b/.test(n)) return 'networking';
  if (/\b(ssd|nvme|hard drive|nas|external drive|flash drive|hdd)\b/.test(n)) return 'storage';
  if (/\b(printer|scanner|inkjet|laserjet)\b/.test(n)) return 'printer';
  if (/\b(playstation|ps5|xbox|nintendo|switch|steam deck|gaming console)\b/.test(n)) return 'gaming';
  if (/\b(smart home|smart plug|thermostat|ring doorbell|nest|security camera|smart doorbell)\b/.test(n)) return 'smartHome';
  if (/\b(vacuum|roomba|roborock|robot vacuum|dyson v\d|stick vacuum)\b/.test(n)) return 'vacuum';
  if (/\b(espresso|coffee maker|coffee machine|nespresso|keurig|grinder)\b/.test(n)) return 'coffee';
  if (/\b(microwave|toaster|blender|air fryer|instant pot|food processor)\b/.test(n)) return 'microwave';
  if (/\b(drill|saw|impact driver|power tool|sander|milwaukee|dewalt|makita|ryobi)\b/.test(n)) return 'powertools';
  if (/\b(grill|smoker|lawn mower|leaf blower|pressure washer|chainsaw|trimmer|snow blower)\b/.test(n)) return 'outdoor';
  if (/\b(air purifier|air conditioner|portable ac|dehumidifier|humidifier|heater|mini split)\b/.test(n)) return 'hvac';
  if (/\b(refrigerator|washer|dryer|dishwasher|range|stove|freezer|oven)\b/.test(n)) return 'appliance';
  return null;
}

/**
 * Extract specs from a product name string.
 * Best effort - structured API data is always better.
 */
function extractSpecsFromName(name) {
  if (!name) return {};
  const n = name.toLowerCase();
  const specs = { name };

  // Screen size (handles ASCII ", Unicode curly quotes, prime, decimals like 26.5")
  const sizeMatch = n.match(/(\d{2,3}(?:\.\d)?)\s*[\u0022\u201C\u201D\u2033\u02BA]?\s*(?:inch|in\b|class|-in)/i) || n.match(/(\d{2,3}(?:\.\d)?)\s*[\u0022\u201C\u201D\u2033\u02BA](?:\s|$)/);
  if (sizeMatch) specs.screenSize = sizeMatch[1];

  // Resolution
  if (n.includes('8k')) specs.resolution = '8K';
  else if (n.includes('4k') || n.includes('uhd') || n.includes('2160')) specs.resolution = '4K';
  else if (n.includes('1080') || n.includes('fhd')) specs.resolution = '1080p';

  // Panel type
  if (n.includes('qd-oled') || n.includes('qd oled')) specs.panelType = 'QD-OLED';
  else if (n.includes('oled')) specs.panelType = 'OLED';
  else if (n.includes('mini led') || n.includes('miniled')) specs.panelType = 'Mini LED';
  else if (n.includes('neo qled')) specs.panelType = 'Neo QLED';
  else if (n.includes('qled')) specs.panelType = 'QLED';
  else if (n.includes('nanocell')) specs.panelType = 'NanoCell';
  else if (n.includes('crystal uhd')) specs.panelType = 'LED';
  else if (n.includes('led') || n.includes('lcd')) specs.panelType = 'LED';

  // Refresh rate
  const hzMatch = n.match(/(\d{2,3})\s*hz/i);
  if (hzMatch) specs.refreshRate = hzMatch[1] + 'Hz';

  // HDR
  if (n.includes('dolby vision')) specs.hdr = 'Dolby Vision';
  else if (n.includes('hdr10+') || n.includes('hdr10 plus')) specs.hdr = 'HDR10+';
  else if (n.includes('hdr10') || n.includes('hdr')) specs.hdr = 'HDR';

  // Smart platform (explicit mention first, then brand inference for TVs)
  if (/\bgoogle tv\b/i.test(n)) specs.smartPlatform = 'Google TV';
  else if (/\bandroid tv\b/i.test(n)) specs.smartPlatform = 'Android TV';
  else if (/\broku\b/i.test(n)) specs.smartPlatform = 'Roku';
  else if (/\bfire tv\b/i.test(n)) specs.smartPlatform = 'Fire TV';
  else if (/\bwebos\b/i.test(n)) specs.smartPlatform = 'webOS';
  else if (/\btizen\b/i.test(n)) specs.smartPlatform = 'Tizen';
  else if (/\bsmart\b/i.test(n) && /\btv\b/i.test(n)) {
    // Infer platform from brand for Smart TVs that don't name their OS
    // Matches "Smart TV", "Smart QLED TV", "Smart LED TV", etc.
    if (/\bsamsung\b/i.test(n)) specs.smartPlatform = 'Tizen';
    else if (/\blg\b/i.test(n)) specs.smartPlatform = 'webOS';
    else if (/\bvizio\b/i.test(n)) specs.smartPlatform = 'SmartCast';
  }

  // Infer panel type for TVs when not detected but product is clearly a TV
  if (!specs.panelType && specs.screenSize && parseFloat(specs.screenSize) >= 32) {
    if (/\b(tv|television)\b/i.test(n) && !/\b(monitor|display)\b/i.test(n)) {
      specs.panelType = 'LED'; // Default panel type for TVs without specific panel mention
    }
  }

  // Infer HDR for TVs based on panel type and brand
  if (!specs.hdr && specs.screenSize && parseFloat(specs.screenSize) >= 32) {
    // OLED TVs always support HDR
    if (specs.panelType === 'OLED' || specs.panelType === 'QD-OLED') {
      specs.hdr = 'HDR';
    }
    // QLED branding implies HDR support
    else if (specs.panelType === 'QLED' || specs.panelType === 'Neo QLED') {
      specs.hdr = 'HDR';
    }
    // 4K TVs from major brands support HDR10 at minimum
    else if (specs.resolution === '4K' && /\b(samsung|lg|sony|tcl|hisense|vizio|toshiba)\b/i.test(n)) {
      specs.hdr = 'HDR';
    }
  }

  // Infer refresh rate for TVs when not explicitly stated
  if (!specs.refreshRate && specs.screenSize) {
    const sz = parseFloat(specs.screenSize);
    if (sz >= 32) {
      // OLED TVs are almost always 120Hz
      if (specs.panelType === 'OLED' || specs.panelType === 'QD-OLED') {
        specs.refreshRate = '120Hz';
      }
      // LED/QLED TVs without explicit Hz are typically 60Hz
      else if (specs.panelType === 'LED' || specs.panelType === 'QLED' || specs.panelType === 'NanoCell') {
        specs.refreshRate = '60Hz';
      }
    }
  }

  // Appliance specs: wattage, capacity, color/finish
  const wattMatch = n.match(/(\d{3,4})\s*w(?:att)?s?\b/i);
  if (wattMatch) specs.wattage = wattMatch[1] + 'W';

  const capacityMatch = n.match(/([\d.]+)\s*cu\.?\s*(?:ft|foot|feet)/i);
  if (capacityMatch) {
    let cap = capacityMatch[1];
    // Normalize leading zero: ".7" -> "0.7"
    if (cap.startsWith('.')) cap = '0' + cap;
    specs.capacity = cap + ' cu ft';
  }

  // Appliance type (microwave form factor)
  if (/\bover[- ]the[- ]range\b|\botr\b/i.test(n)) specs.applianceType = 'Over-the-Range';
  else if (/\bbuilt[- ]in\b/i.test(n)) specs.applianceType = 'Built-in';
  else if (/\bcountertop\b/i.test(n)) specs.applianceType = 'Countertop';

  // Color/finish for appliances
  if (/\bstainless\s*steel\b/i.test(n)) specs.finish = 'Stainless Steel';
  else if (/\bblack\s*stainless\b/i.test(n)) specs.finish = 'Black Stainless';
  else if (/\bwhite\b/i.test(n) && /\b(microwave|oven|refrigerator|washer|dryer|dishwasher|range|freezer|toaster|blender|air fryer)\b/i.test(n)) specs.finish = 'White';
  else if (/\bblack\b/i.test(n) && /\b(microwave|oven|refrigerator|washer|dryer|dishwasher|range|freezer|toaster|blender|air fryer)\b/i.test(n)) specs.finish = 'Black';

  return specs;
}

// ============================================================
// PRODUCT RELEVANCE FILTERING
// ============================================================

/** Services, warranties, gift cards, and non-product results */
const SERVICE_PATTERNS = [
  /\b(mounting|installation|setup|repair|cleaning)\s+service/i,
  /\b(protection|extended|accidental)\s+(plan|warranty|coverage)/i,
  /\bgeek\s+squad/i,
  /\btech\s+support/i,
  /\bin-home\s+(setup|install)/i,
  /\bprofessional\s+(install|mount)/i,
  /\bbasic\s+mounting\b/i,
  /\b\d+[- ]year\s+(protection|warranty|plan)/i,
  /\bgift\s*card\b/i,
  /\bsubscription\b/i,
  /\b(prepaid|e-?gift)\b/i,
  /\bmembership\b/i,
  /\bapplecare\+?\b/i,
  /\b(monthly|annual|yearly)\s+plan\b/i,
];

/** Nouns that indicate accessories, not the primary product */
const ACCESSORY_NOUNS = [
  'mount', 'mounting', 'stand', 'bracket', 'cable', 'hdmi', 'cord',
  'remote', 'antenna', 'case', 'cover', 'bag', 'strap', 'charger',
  'adapter', 'battery', 'tripod', 'lens cap', 'screen protector',
  'cleaning kit', 'carrying case', 'wall plate', 'surge protector',
  'power strip', 'extension cord', 'wall mount', 'ceiling mount',
  'desk mount', 'floor stand', 'cart', 'shelf', 'dongle', 'splitter',
  'bezel', 'skin', 'decal',
  'keyboard', 'mouse', 'trackpad', 'webcam', 'microphone',
  'hub', 'dock', 'docking station', 'sleeve', 'stylus',
  'memory card', 'sd card', 'usb drive', 'flash drive',
  'extender', 'teleconverter', 'converter', 'filter', 'lens hood',
  'lens cap', 'lens pen', 'lens cloth',
  // Appliance parts/accessories
  'trim kit', 'mounting kit', 'filler kit', 'front panel',
  'stainless steel front', 'door assembly',
  'replacement plate', 'replacement part',
  'replacement filter', 'charcoal filter', 'grease filter',
  'turntable plate', 'turntable ring', 'light bulb',
  'interlock', 'magnetron', 'diode', 'fuse', 'capacitor',
  'door switch', 'thermal fuse', 'waveguide cover',
  'ear cushions', 'ear tips', 'ear pads',
];

/** Patterns for products that share a category keyword but are not the actual product
 *  (e.g., "Microwave Link" is RF equipment, not a kitchen microwave) */
const WRONG_PRODUCT_PATTERNS = [
  /\bmicrowave\s+(link|amplifier|transmitter|receiver|antenna|relay|waveguide)\b/i,
  /\brf[- ]links?\b/i,
  /\bwideband\s+(microwave|amplifier)\b/i,
];

/** Patterns indicating a compatibility range (not a product size) */
const RANGE_PATTERNS = [
  /\b(?:up to|fits|for|compatible with)\s+\d{2,3}[""]?\s*(?:inch|in\b|")/i,
  /\b\d{2,3}\s*(?:to|-)\s*\d{2,3}\s*(?:inch|in\b|")/i,
  /\b\d{2,3}[""]?\s*or\s+(?:small|large)/i,
];

/** Tokens to skip in query overlap scoring */
const FILLER_TOKENS = new Set([
  'inch', 'in', 'class', 'the', 'a', 'an', 'for', 'with', 'and', 'or',
  'smart', 'led', 'uhd', 'hd', '4k', '8k',
]);

/** Category core nouns */
const CATEGORY_NOUNS = {
  tv: ['tv', 'television'],
  camera: ['camera', 'mirrorless', 'dslr'],
  monitor: ['monitor', 'display'],
  laptop: ['laptop', 'notebook', 'chromebook', 'macbook'],
  headphones: ['headphone', 'headphones', 'earbud', 'earbuds', 'airpod', 'airpods'],
  desktop: ['mac mini', 'mac studio', 'mac pro', 'desktop'],
  aio: ['imac', 'all-in-one'],
  audio: ['receiver', 'amplifier', 'av receiver', 'stereo', 'soundbar', 'subwoofer', 'speaker'],
  appliance: ['microwave', 'oven', 'dishwasher', 'refrigerator', 'washer', 'dryer', 'range', 'freezer'],
};

/** Acceptable size ranges - scales with target size */
function getSizeTolerance(targetSize) {
  if (targetSize <= 27) return 2;  // small screens: ±2"
  if (targetSize <= 34) return 3;  // mid screens: ±3"
  if (targetSize <= 49) return 5;  // large screens: ±5"
  return 5;                         // very large TVs: ±5" (55 search shouldn't show 65+)
}

/**
 * Parse the users search query into a structured intent.
 */
function parseQueryIntent(query) {
  const q = (query || '').toLowerCase();
  const category = guessCategory(query);
  const specs = extractSpecsFromName(query);
  const targetSize = specs.screenSize ? Math.round(parseFloat(specs.screenSize)) : null;

  // Find core nouns based on detected category
  const coreNouns = [];
  if (category && CATEGORY_NOUNS[category]) {
    for (const noun of CATEGORY_NOUNS[category]) {
      if (q.includes(noun)) coreNouns.push(noun);
    }
  }

  // Tokenize query
  const queryTokens = q.split(/[\s,;]+/).filter(t => t.length > 0);

  // Detect specific product specs (lens focal length, aperture, model numbers)
  const specificSpecs = {};

  // Lens focal length: "35mm", "50mm", "24-70mm", "15-35mm"
  const focalMatch = q.match(/\b(\d{1,3}(?:\s*-\s*\d{1,3})?)\s*mm\b/);
  if (focalMatch) specificSpecs.focalLength = focalMatch[1].replace(/\s/g, '');

  // Lens aperture: "f1.8", "f/1.8", "f2.8", "f/2.8"
  const apertureMatch = q.match(/f\/?(\d+\.?\d*)\b/i);
  if (apertureMatch) specificSpecs.aperture = apertureMatch[1];

  // Brand
  const brandMatch = q.match(/\b(canon|nikon|sony|fujifilm|panasonic|olympus|sigma|tamron|samsung|lg|apple)\b/i);
  if (brandMatch) specificSpecs.brand = brandMatch[1].toLowerCase();

  // Specific model number patterns (e.g., "XBR-55A80J", "RF35mm", "EOS R8")
  const modelMatch = query.match(/\b([A-Z]{1,4}[-]?\d{2,5}[A-Z]?\w{0,8})\b/i);
  if (modelMatch) specificSpecs.modelNumber = modelMatch[1];

  // Is this a specific product search? (has focal length + aperture, or a model number with brand)
  const isSpecificSearch = (specificSpecs.focalLength && specificSpecs.aperture) ||
                           (specificSpecs.brand && specificSpecs.modelNumber);

  return { category, targetSize, targetSpecs: specs, coreNouns, queryTokens, specificSpecs, isSpecificSearch };
}

/**
 * Check if a product is irrelevant to the search query.
 * Returns { rejected, reason, relevanceScore }.
 */
/** Badge/junk text patterns that are scraper artifacts, not product names */
const JUNK_NAME_PATTERNS = [
  /^(shipping|free delivery|arrives|delivered by|delivery as soon)/i,
  /^\d+k?\+?\s*(bought|sold|viewed)\b/i,
  /^(bestseller|best seller|sponsored|ad)\b/i,
  /^save\s+\$/i,
  /^(add to cart|add to list|see price in cart)\b/i,
  /^(out of stock|sold out|unavailable)\b/i,
  /^(see all|view all|show more)\b/i,
  /^for\s+["\u201C]/i,   // 'for "query"' - scraped search header
  /^(results|showing)\s+(for|from)\b/i,
  /^related\s+to\b/i,   // "Related to your search"
  /^(people|customers)\s+(also|who)\b/i,
  /^when\s+purchased\b/i,         // "When purchased online"
  /^only\s+\d+\s+left\b/i,       // "Only 1 left at Milford"
  /^limited\s+stock\b/i,
  /^in\s+stock\b/i,
  /^pick\s+(it\s+)?up\b/i,
  /^same[\s-]day\s+delivery/i,
  /^ready\s+within\b/i,
];

/** Word-boundary match for accessory nouns (prevents "hub" matching inside "Thunderbolt" etc.) */
const _accRegexCache = {};
function accWordMatch(name, acc) {
  if (!_accRegexCache[acc]) {
    const escaped = acc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    _accRegexCache[acc] = new RegExp(`\\b${escaped}\\b`, 'i');
  }
  return _accRegexCache[acc].test(name);
}

function isIrrelevantProduct(productName, queryIntent) {
  const name = (productName || '').toLowerCase();

  // ---- PHASE A0: Scraper sanity check ----
  // Reject garbage/badge text that got scraped as product names
  if (!productName || productName.length < 10) {
    return { rejected: true, reason: 'parse_error', relevanceScore: 0 };
  }
  // Reject ultra-short names with no model number (likely garbage scraper artifacts)
  const wordCount = productName.trim().split(/\s+/).length;
  if (wordCount <= 2 && !/\d/.test(productName)) {
    return { rejected: true, reason: 'parse_error', relevanceScore: 0 };
  }
  for (const pattern of JUNK_NAME_PATTERNS) {
    if (pattern.test(productName.trim())) {
      return { rejected: true, reason: 'parse_error', relevanceScore: 0 };
    }
  }

  // ---- PHASE A: Hard reject (services, accessories) ----

  // A0b: Wrong-product patterns (RF equipment with "microwave" in name, etc.)
  for (const pattern of WRONG_PRODUCT_PATTERNS) {
    if (pattern.test(name)) {
      return { rejected: true, reason: 'wrong_category', relevanceScore: 0 };
    }
  }

  // A1: Service patterns (but exempt products with model numbers + screen/storage specs)
  const hasModelNumber = /\b[A-Z]{0,4}\d{2,5}[A-Z]\w{0,8}\b/i.test(productName || '') || /\b[A-Z]{2,4}[-]?\d{2,5}\b/i.test(productName || '');
  const hasScreenSize = /\d{2,3}[\u0022\u201C\u201D\u2033\u02BA]?\s*(?:inch|in\b|class|-in)/i.test(name);
  const hasStorageSpec = /\b\d+\s*(?:tb|gb|mb)\b/i.test(name);
  const hasUSBSpec = /\busb\s*\d/i.test(name);
  const likelyRealProduct = hasModelNumber && hasScreenSize || hasStorageSpec && hasUSBSpec;

  for (const pattern of SERVICE_PATTERNS) {
    if (pattern.test(name)) {
      // If it looks like a real product (model number + screen size), skip service rejection
      // This prevents false positives on products whose descriptions mention "subscription" etc.
      if (likelyRealProduct) continue;
      return { rejected: true, reason: 'service', relevanceScore: 0 };
    }
  }

  // Pre-compute category nouns and query tokens (used across multiple phases)
  const allCategoryNouns = queryIntent.category && CATEGORY_NOUNS[queryIntent.category]
    ? CATEGORY_NOUNS[queryIntent.category] : [];
  const queryTokenSet = new Set(queryIntent.queryTokens);

  // A2: Compatibility range patterns (accessories unless product IS a category product)
  // e.g., "Samsung 55" OLED TV with Tilt Mount for 37"-90" TVs" is a TV bundle, not an accessory
  for (const pattern of RANGE_PATTERNS) {
    if (pattern.test(name)) {
      // Exempt if the product name contains a recognized category noun + has a screen size
      // This catches TV bundles (TV + mount) vs pure accessory covers
      const hasCategoryNoun = allCategoryNouns.length > 0 &&
        allCategoryNouns.some(cn => name.includes(cn));
      if (hasCategoryNoun && hasScreenSize) {
        // It's a product bundle (TV + mount), not a pure accessory. Let it through.
        break;
      }
      return { rejected: true, reason: 'accessory_range', relevanceScore: 0 };
    }
  }

  // A3: Accessory + preposition pattern: "[accessory] for [query noun]"
  // Only reject if accessory noun is NOT part of the search query itself
  // Uses word-boundary matching to prevent "hub" matching inside "Thunderbolt" etc.
  // Exempt product bundles: if the name contains a category noun + screen size,
  // it's likely "TV with mount for X" not "mount for TV"
  const isCategoryProductBundle = allCategoryNouns.length > 0 &&
    allCategoryNouns.some(cn => name.includes(cn)) && hasScreenSize;
  if (!isCategoryProductBundle) {
    for (const acc of ACCESSORY_NOUNS) {
      if (!accWordMatch(name, acc)) continue;
      // Skip if the accessory noun is part of the users query
      const accTokens = acc.split(' ');
      if (accTokens.every(t => queryTokenSet.has(t))) continue;
      // Check for "[accessory] for/compatible with" pattern
      const accEscaped = acc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const forPattern = new RegExp(`\\b${accEscaped}\\b.*\\b(for|compatible with|fits)\\b`, 'i');
      if (forPattern.test(name)) {
        return { rejected: true, reason: 'accessory_preposition', relevanceScore: 0 };
      }
    }
  }

  // A4: Accessory noun present + no core query noun in name = pure accessory
  const coreNounSet = new Set([...queryIntent.coreNouns, ...allCategoryNouns]);

  // Check if the product IS a category product (e.g., "AirPods" in a headphones search)
  // If so, exempt it from accessory filtering entirely
  const isCategoryProduct = allCategoryNouns.length > 0 &&
    allCategoryNouns.some(n => name.includes(n));

  if (!isCategoryProduct) {
    for (const acc of ACCESSORY_NOUNS) {
      if (!accWordMatch(name, acc)) continue;
      const accTokens = acc.split(' ');
      if (accTokens.every(t => queryTokenSet.has(t))) continue;

      if (coreNounSet.size > 0) {
        // Have core nouns: reject if none appear in the name (check all synonyms)
        const hasCoreNoun = [...coreNounSet].some(n => name.includes(n));
        if (!hasCoreNoun) {
          return { rejected: true, reason: 'accessory_no_match', relevanceScore: 0 };
        }
      } else {
        // No core nouns: reject if less than half of meaningful query tokens appear
        const mTokens = queryIntent.queryTokens.filter(t => !FILLER_TOKENS.has(t) && t.length > 1);
        let overlap = 0;
        for (const t of mTokens) {
          if (name.includes(t)) overlap++;
        }
        if (mTokens.length > 0 && overlap / mTokens.length < 0.5) {
          return { rejected: true, reason: 'accessory_low_overlap', relevanceScore: 0 };
        }
      }
    }
  }

  // ---- PHASE B: Spec validation ----

  // B1: Screen size mismatch (asymmetric: generous upward, strict downward)
  if (queryIntent.targetSize) {
    const resultSpecs = extractSpecsFromName(productName);
    if (resultSpecs.screenSize) {
      const resultSize = Math.round(parseFloat(resultSpecs.screenSize));
      const tolerance = getSizeTolerance(queryIntent.targetSize);
      const diff = resultSize - queryIntent.targetSize;
      // For large TVs (50"+), be strict both directions — 55" search should NOT show 65"
      // For smaller screens, allow generous upward (49" fine for 42" search)
      const upwardMultiplier = queryIntent.targetSize >= 50 ? 1 : 2;
      if (diff < -tolerance || diff > tolerance * upwardMultiplier) {
        return { rejected: true, reason: 'wrong_size', relevanceScore: 0 };
      }
    } else {
      // No size detected in product name — for display products (monitor, tv, projector),
      // reject when user specified a size (avoids false positives like "24.1 Fast TN" with
      // no inch marker that slip past the regex)
      const DISPLAY_CATEGORIES = ['monitor', 'tv', 'projector'];
      const resultCat = guessCategory(productName);
      const queryCat = queryIntent.category;
      if ((resultCat && DISPLAY_CATEGORIES.includes(resultCat)) ||
          (queryCat && DISPLAY_CATEGORIES.includes(queryCat))) {
        return { rejected: true, reason: 'unknown_size', relevanceScore: 0 };
      }
    }
  }

  // B2: Category mismatch
  if (queryIntent.category) {
    const resultCategory = guessCategory(productName);
    if (resultCategory && resultCategory !== queryIntent.category) {
      return { rejected: true, reason: 'wrong_category', relevanceScore: 0 };
    }
  }

  // B3: Product line mismatch
  // If query names a specific product line, result must contain it
  const PRODUCT_LINES = [
    'mac mini', 'mac studio', 'mac pro', 'macbook', 'imac',
    'ipad', 'iphone', 'apple watch', 'airpods',
    'galaxy', 'pixel', 'surface', 'thinkpad',
    'playstation', 'xbox', 'switch',
    'roku', 'fire tv', 'chromecast', 'apple tv',
  ];
  const queryLower = queryIntent.queryTokens.join(' ');
  for (const line of PRODUCT_LINES) {
    if (queryLower.includes(line)) {
      if (!name.includes(line)) {
        return { rejected: true, reason: 'wrong_product_line', relevanceScore: 0 };
      }
      break; // only check the first matching product line
    }
  }

  // B4: Accessory-for-product-line detection
  // If name contains a product line + accessory nouns, it's likely an accessory FOR that product
  // e.g. "MAC MINI DOCK STAND+NVME" is a dock for mac mini, not a mac mini itself
  {
    let accCount = 0;
    for (const acc of ACCESSORY_NOUNS) {
      if (!accWordMatch(name, acc)) continue;
      const accTokens = acc.split(' ');
      if (!accTokens.every(t => queryTokenSet.has(t))) accCount++;
    }
    if (accCount >= 3) {
      // Name has 3+ accessory nouns not in query -- almost certainly an accessory
      return { rejected: true, reason: 'accessory_multi', relevanceScore: 0 };
    }
  }

  // B5: Specific product spec matching
  // When the query specifies exact specs (focal length, aperture, model number),
  // reject results that don't match those specs
  if (queryIntent.isSpecificSearch && queryIntent.specificSpecs) {
    const ss = queryIntent.specificSpecs;

    // Check brand mismatch
    // "for Canon" or "Canon mount" or "Canon compatible" means it's FOR that brand, not BY that brand
    if (ss.brand) {
      const brandInName = name.includes(ss.brand);
      const forBrandPattern = new RegExp(`\\b(for|compatible with|fits)\\s+.*\\b${ss.brand}\\b`, 'i');
      const mountPattern = new RegExp(`\\b${ss.brand}\\s*(rf|ef|mount|e-mount|x-mount|z-mount)\\b`, 'i');
      const isByBrand = brandInName && !forBrandPattern.test(name);
      // If the only mention of the brand is in a mount/compatibility context, not by-brand
      if (!brandInName) {
        return { rejected: true, reason: 'wrong_brand', relevanceScore: 0 };
      }
      // Check if the product is actually made by a different brand
      const otherBrands = ['rokinon', 'samyang', 'sigma', 'tamron', 'viltrox', 'tokina', 'meike', 'yongnuo', 'laowa', 'venus'];
      const madeByOther = otherBrands.some(ob => name.includes(ob));
      if (madeByOther && forBrandPattern.test(name)) {
        return { rejected: true, reason: 'third_party_brand', relevanceScore: 0 };
      }
    }

    // Check focal length for lenses (e.g., query "35mm" should not return "50mm" or "15-35mm")
    if (ss.focalLength) {
      const queryFocal = ss.focalLength; // e.g., "35" or "24-70"
      // Extract all focal lengths from the result name
      const resultFocals = [];
      const focalRegex = /(\d{1,3}(?:\s*-\s*\d{1,3})?)\s*mm\b/gi;
      let fm;
      while ((fm = focalRegex.exec(name)) !== null) {
        resultFocals.push(fm[1].replace(/\s/g, ''));
      }
      if (resultFocals.length > 0) {
        // At least one focal length in the result must match the query focal length
        const hasMatch = resultFocals.some(rf => rf === queryFocal);
        if (!hasMatch) {
          return { rejected: true, reason: 'wrong_focal_length', relevanceScore: 0 };
        }
      }
    }

    // Check aperture for lenses (e.g., query "f1.8" should not return "f2.8")
    // Also handles cinema T-stops (T1.5, T2.1, etc.)
    if (ss.aperture) {
      const resultAperture = name.match(/[fFtT]\/?(\d+\.?\d*)\b/);
      if (resultAperture) {
        const queryAp = parseFloat(ss.aperture);
        const resultAp = parseFloat(resultAperture[1]);
        // Allow small tolerance (f1.8 vs f1.7) but not different apertures (f1.8 vs f2.8)
        if (Math.abs(queryAp - resultAp) > 0.3) {
          return { rejected: true, reason: 'wrong_aperture', relevanceScore: 0 };
        }
      }
    }
  }

  // B6a: "For BRAND" accessory detection
  // If name contains "for [brand]" or "compatible with [brand]" + an accessory noun, it's an accessory
  // Exempt product bundles (TV with mount, etc.)
  if (!isCategoryProductBundle) {
    const forBrandAccRegex = /\b(for|compatible with|fits|replacement for|replaces)\b/i;
    if (forBrandAccRegex.test(name)) {
      const queryLowerStr = queryIntent.queryTokens.join(' ');
      for (const acc of ACCESSORY_NOUNS) {
        if (!accWordMatch(name, acc)) continue;
        const accTokens = acc.split(' ');
        if (accTokens.every(t => queryTokenSet.has(t))) continue;
        // Product has "for/compatible" + accessory noun not in query = accessory
        return { rejected: true, reason: 'accessory_for_brand', relevanceScore: 0 };
      }
    }
  }

  // B6: Brand enforcement
  // If query contains a recognized brand, reject results that don't mention that brand
  // Also checks known model number prefixes (e.g., TX-NR = Onkyo, RX-V = Yamaha)
  {
    const queryLowerStr = queryIntent.queryTokens.join(' ');
    const KNOWN_BRANDS_FOR_FILTER = [
      'samsung', 'lg', 'sony', 'canon', 'nikon', 'panasonic', 'hisense', 'tcl',
      'vizio', 'toshiba', 'dell', 'hp', 'lenovo', 'asus', 'acer', 'msi', 'apple',
      'bose', 'jbl', 'sennheiser', 'logitech', 'razer', 'corsair', 'epson', 'brother',
      'fujifilm', 'garmin', 'roku', 'google', 'microsoft', 'nintendo', 'dyson',
      'kitchenaid', 'whirlpool', 'frigidaire', 'bosch', 'maytag',
      'onkyo', 'yamaha', 'denon', 'marantz', 'pioneer', 'harman kardon', 'anthem',
      'nad', 'klipsch', 'svs', 'kef', 'polk', 'sonos',
    ];
    // Model number prefixes that identify brand even when brand name is absent
    const BRAND_MODEL_PREFIXES = {
      'onkyo': ['tx-nr', 'tx-rz', 'tx-sr', 'ht-s', 'ht-r', 'dxc-', 'cs-'],
      'yamaha': ['rx-v', 'rx-a', 'tsx-', 'htr-'],
      'denon': ['avr-x', 'avr-s', 'avc-x', 'dht-', 'dra-'],
      'marantz': ['sr-', 'nr-', 'pm-', 'sr5', 'sr6', 'sr7', 'sr8'],
      'pioneer': ['vsx-', 'sc-'],
      'sony': ['str-', 'strd', 'stra'],
      'samsung': ['qn', 'un', 'ua'],
      'lg': ['oled', '55nano', '65nano', '75nano'],
    };
    for (const brand of KNOWN_BRANDS_FOR_FILTER) {
      if (queryLowerStr.includes(brand)) {
        const hasBrandName = name.includes(brand);
        // Check model number prefixes as brand proxy
        const prefixes = BRAND_MODEL_PREFIXES[brand] || [];
        const hasModelPrefix = prefixes.some(p => name.includes(p));
        if (!hasBrandName && !hasModelPrefix) {
          return { rejected: true, reason: 'brand_mismatch', relevanceScore: 0 };
        }
        break; // only check first matching brand in query
      }
    }
  }

  // B7: Vintage/obsolete product penalty
  // Products with year indicators 5+ years old are likely obsolete
  {
    const currentYear = new Date().getFullYear();
    const yearMatch = name.match(/\b(20[0-2]\d)\b/);
    if (yearMatch) {
      const productYear = parseInt(yearMatch[1]);
      const age = currentYear - productYear;
      if (age >= 10) {
        // Ancient product (10+ years) - reject for electronics
        const electronicCats = ['tv', 'monitor', 'laptop', 'phone', 'tablet', 'camera', 'headphones', 'desktop', 'gpu'];
        if (queryIntent.category && electronicCats.includes(queryIntent.category)) {
          return { rejected: true, reason: 'obsolete', relevanceScore: 0 };
        }
      }
    }
  }

  // ---- PHASE C: Soft relevance scoring ----

  // C1: Query token overlap (0-0.5)
  const meaningfulTokens = queryIntent.queryTokens.filter(t => !FILLER_TOKENS.has(t) && t.length > 1);
  let matched = 0;
  for (const token of meaningfulTokens) {
    if (name.includes(token)) matched++;
  }
  const tokenOverlap = meaningfulTokens.length > 0
    ? (matched / meaningfulTokens.length) * 0.5
    : 0.3; // no meaningful tokens = neutral

  // C2: Accessory noun penalty (0 or -0.2)
  let accessoryPenalty = 0;
  for (const acc of ACCESSORY_NOUNS) {
    if (accWordMatch(name, acc)) {
      const accTokens = acc.split(' ');
      if (!accTokens.every(t => queryTokenSet.has(t))) {
        accessoryPenalty = -0.2;
        break;
      }
    }
  }

  // C3: Core noun presence (0-0.3)
  let coreNounBonus = 0;
  for (const noun of queryIntent.coreNouns) {
    if (name.includes(noun)) {
      coreNounBonus = 0.3;
      break;
    }
  }

  // C4: Hybrid monitor/TV demotion
  // Products containing both "monitor" and "tv" are hybrids (e.g. LG Smart Monitor with webOS).
  // When searching for "tv", demote these below actual TVs.
  let hybridPenalty = 0;
  if (queryIntent.category === 'tv' && name.includes('monitor')) {
    // Only penalize if query does NOT mention "monitor"
    if (!queryIntent.queryTokens.includes('monitor')) {
      hybridPenalty = -0.3;
    }
  }

  // C5: Hard reject if zero meaningful query tokens match
  // But exempt products that contain a category noun (e.g., "AirPods" in headphones search)
  if (meaningfulTokens.length >= 2 && matched === 0) {
    const hasCatNoun = allCategoryNouns.length > 0 &&
      allCategoryNouns.some(n => name.includes(n));
    if (!hasCatNoun) {
      return { rejected: true, reason: 'no_token_overlap', relevanceScore: 0 };
    }
  }

  const relevanceScore = Math.max(0, Math.min(1.0,
    0.4 + tokenOverlap + accessoryPenalty + coreNounBonus + hybridPenalty
  ));

  return { rejected: false, reason: null, relevanceScore };
}

// ============================================================
// COMPUTER SPEC EXTRACTION
// ============================================================

/**
 * Extract key computer specs from product name for display.
 * Returns a compact spec string like "M4 / 16GB / 256GB" or null if not a computer.
 */
function extractComputerSpecs(productName) {
  if (!productName) return null;
  const n = productName.toLowerCase();
  const parts = [];

  // Apple chip (M1, M2, M3, M4, M4 Pro, M4 Max, etc.)
  const chipMatch = productName.match(/\b(M[1-9]\s*(?:Pro|Max|Ultra)?)\b/i);
  if (chipMatch) parts.push(chipMatch[1].trim());

  // Intel/AMD chip
  if (!chipMatch) {
    const intelMatch = productName.match(/\b((?:Core\s+)?(?:i[3579]|Core\s+\d|Celeron|Pentium)[\w\s-]{0,15})/i);
    const amdMatch = productName.match(/\b(Ryzen\s+\d[\w\s-]{0,15})/i);
    if (intelMatch) parts.push(intelMatch[1].trim().substring(0, 20));
    else if (amdMatch) parts.push(amdMatch[1].trim().substring(0, 20));
  }

  // RAM
  const ramMatch = n.match(/\b(\d+)\s*gb\s*(?:memory|ram|ddr|unified)/i) || n.match(/\b(\d+)gb\b/i);
  if (ramMatch) parts.push(ramMatch[1] + 'GB');

  // Storage
  const storageMatch = n.match(/\b(\d+)\s*(?:tb|gb)\s*(?:ssd|hdd|storage|emmc|nvme)/i) || n.match(/\b(\d+(?:tb|gb))\s+ssd\b/i);
  if (storageMatch) {
    const raw = storageMatch[0].trim();
    const sizeMatch = raw.match(/(\d+)\s*(tb|gb)/i);
    if (sizeMatch) parts.push(sizeMatch[1] + sizeMatch[2].toUpperCase() + (n.includes('hdd') ? ' HDD' : ' SSD'));
  }

  // Condition
  if (n.includes('refurbished') || n.includes('refurb') || n.includes('renewed')) {
    parts.push('Refurb');
  }

  return parts.length >= 2 ? parts.join(' / ') : null;
}

// ============================================================
// STORE TRUST & BRAND REPUTATION
// ============================================================

/** Static store trust scores (tiebreaker weight, not dominant) */
const STORE_TRUST = {
  bestbuy: 90, amazon: 85, walmart: 80, target: 85,
  newegg: 70, bhphoto: 90, microcenter: 85,
  homedepot: 75, ebay: 60,
};

function storeTrustScore(storeKey, source) {
  const base = STORE_TRUST[storeKey] || 50;
  const apiBonus = (source && source.includes('api')) ? 5 : 0;
  return Math.min(base + apiBonus, 100);
}

/** Brand tier scores */
const BRAND_TIERS = {
  apple: 90, sony: 90, samsung: 90, canon: 90, nikon: 90, bose: 90, dyson: 90,
  'western digital': 75, wd: 75, seagate: 75, dell: 75, hp: 75, lenovo: 75,
  panasonic: 75, jbl: 75, fujifilm: 75, lg: 75, logitech: 75, corsair: 75,
  sandisk: 70, lacie: 70, anker: 70, microsoft: 85, google: 85, nvidia: 85,
  tcl: 60, hisense: 60, vizio: 60, insignia: 60, acer: 60, kingston: 60,
  crucial: 60, toshiba: 65, msi: 70, gigabyte: 65, razer: 70, asus: 75,
  onkyo: 75, yamaha: 85, denon: 85, marantz: 90, pioneer: 70, 'harman kardon': 80,
  anthem: 85, nad: 85, klipsch: 80, svs: 85, kef: 90, polk: 70,
  'definitive technology': 80, sonos: 85, pyle: 30,
  viewsonic: 70, benq: 75, aoc: 60, pixio: 55, nixeus: 50, dough: 65,
};

function brandScore(productName) {
  const name = (productName || '').toLowerCase();
  for (const [brand, score] of Object.entries(BRAND_TIERS)) {
    const bRegex = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (bRegex.test(name)) return score;
  }
  return 40; // unknown brand
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

/** Format review count: 94231 -> "94K", 1200 -> "1.2K", 450 -> "450" */
function formatReviewCount(count) {
  if (!count) return '';
  if (count >= 10000) return Math.round(count / 1000) + 'K';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
  return String(count);
}

/** Store emoji mapping - only use emojis with obvious brand association */
const STORE_EMOJI = {
  bestbuy: '\uD83D\uDD32',   // 🔲
  amazon: '\uD83D\uDCE6',    // 📦 (the Amazon box)
  walmart: '\uD83D\uDD35',   // 🔵 (Walmart blue spark)
  target: '\uD83C\uDFAF',    // 🎯 (Target bullseye)
  newegg: '\uD83E\uDD5A',    // 🥚 (egg is in the name)
  microcenter: '\uD83D\uDD27', // 🔧 (tools/tech)
};

function storeEmoji(storeKey) {
  return STORE_EMOJI[storeKey] || '';
}

/** Discount indicator emoji - flame tiers with minimum threshold */
function discountEmoji(pct) {
  if (pct >= 45) return '\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25'; // 🔥🔥🔥
  if (pct >= 25) return '\uD83D\uDD25\uD83D\uDD25'; // 🔥🔥
  if (pct >= 10) return '\uD83D\uDD25'; // 🔥
  return '';  // Under 10% is noise, not a deal
}

/** Review emoji - single star for any review */
function reviewEmoji(score) {
  if (!score) return '';
  return '\u2B50'; // ⭐
}

/** Expected discount range for Discount Depth calculation (legacy, kept for export compat) */
function getExpectedDiscountRange(category, price) {
  // Now unused - discountDepth uses percentage-based calculation directly
  // Kept for backwards compatibility with any external callers
  return price * 0.30; // 30% of price is the "expected" significant discount
}

// ============================================================
// QUERY SPEC PENALTY (score multiplier for spec mismatches)
// ============================================================

/**
 * Calculate a multiplicative penalty for spec mismatches between
 * a product and the query intent.
 * Returns a multiplier between 0.0 and 1.0 (1.0 = perfect match).
 */
function querySpecPenalty(productName, productSpecs, queryIntent) {
  if (!queryIntent || !queryIntent.targetSpecs) return 1.0;

  let penalty = 1.0;
  const resultSpecs = (productSpecs && Object.keys(productSpecs).some(k => productSpecs[k]))
    ? productSpecs
    : extractSpecsFromName(productName);

  // Refresh rate mismatch
  const queryHz = queryIntent.targetSpecs.refreshRate ? parseInt(queryIntent.targetSpecs.refreshRate) : null;
  const resultHz = resultSpecs.refreshRate ? parseInt(resultSpecs.refreshRate) : null;
  if (queryHz && resultHz) {
    if (resultHz < queryHz * 0.7) {
      penalty *= 0.5;  // Major miss: 144Hz when asking for 240Hz
    } else if (resultHz < queryHz) {
      penalty *= 0.8;  // Minor miss: 200Hz when asking for 240Hz
    }
  }

  // Screen size mismatch
  const querySize = queryIntent.targetSize;
  const resultSize = resultSpecs.screenSize ? Math.round(parseFloat(resultSpecs.screenSize)) : null;
  if (querySize && resultSize) {
    const diff = resultSize - querySize; // positive = bigger, negative = smaller
    const tolerance = getSizeTolerance(querySize);
    if (diff < -tolerance) {
      penalty *= 0.4;  // way too small
    } else if (diff < 0 && Math.abs(diff) > tolerance / 2) {
      penalty *= 0.7;  // somewhat small
    }
    // Bigger than requested is fine (no penalty)
  }

  // Resolution mismatch (only penalize lower resolution)
  const queryRes = queryIntent.targetSpecs.resolution;
  const resultRes = resultSpecs.resolution;
  if (queryRes && resultRes && queryRes !== resultRes) {
    const resRank = { '720p': 1, '1080p': 2, '1440p': 2.5, '4K': 3, '8K': 4 };
    const queryRank = resRank[queryRes] || 0;
    const resultRank = resRank[resultRes] || 0;
    if (resultRank < queryRank) {
      penalty *= 0.6;
    }
  }

  return penalty;
}

// ============================================================
// STRICT / RELAXED MATCH CLASSIFICATION
// ============================================================

/**
 * Classify a product as "strict" or "relaxed" match against query specs.
 * Strict = matches ALL parsed query specs (size, refresh rate, resolution).
 * Relaxed = passed relevance filter but misses one or more specs.
 * Returns { strict: boolean, deviations: string[] }
 */
function classifyMatch(productName, productSpecs, queryIntent) {
  const deviations = [];
  const resultSpecs = (productSpecs && Object.keys(productSpecs).some(k => productSpecs[k]))
    ? productSpecs
    : extractSpecsFromName(productName);

  // Size check
  if (queryIntent.targetSize) {
    const resultSize = resultSpecs.screenSize ? Math.round(parseFloat(resultSpecs.screenSize)) : null;
    if (!resultSize) {
      // Do not flag "not detected" as deviation - product may still match
    } else if (resultSize < queryIntent.targetSize) {
      deviations.push(`${resultSize}" vs ${queryIntent.targetSize}"+ requested`);
    }
  }

  // Refresh rate check
  const queryHz = queryIntent.targetSpecs?.refreshRate;
  if (queryHz) {
    const queryHzNum = parseInt(queryHz);
    const resultHz = resultSpecs.refreshRate ? parseInt(resultSpecs.refreshRate) : null;
    if (resultHz && resultHz < queryHzNum) {
      deviations.push(`${resultHz}Hz vs ${queryHzNum}Hz requested`);
    }
  }

  // Resolution check
  const queryRes = queryIntent.targetSpecs?.resolution;
  if (queryRes && resultSpecs.resolution && resultSpecs.resolution !== queryRes) {
    const resRank = { '720p': 1, '1080p': 2, '1440p': 2.5, '4K': 3, '8K': 4 };
    if ((resRank[resultSpecs.resolution] || 0) < (resRank[queryRes] || 0)) {
      deviations.push(`${resultSpecs.resolution} vs ${queryRes} requested`);
    }
  }

  return {
    strict: deviations.length === 0,
    deviations,
  };
}

// ============================================================
// SIZE QUERY EXPANSION
// ============================================================

/**
 * Expand a size-specific query to be more inclusive.
 * Removes the size term from the query string so stores do not pre-filter,
 * but preserves the queryIntent so post-search filtering still works.
 */
function expandSizeQuery(query) {
  const queryIntent = parseQueryIntent(query);
  if (!queryIntent.targetSize) return { searchQuery: query, originalQuery: query };

  // Only expand for display-type categories
  const expandable = new Set(['tv', 'monitor', 'projector']);
  if (queryIntent.category && !expandable.has(queryIntent.category)) {
    return { searchQuery: query, originalQuery: query };
  }

  // Remove the size term from the search query
  const sizePattern = /\b\d{2,3}\s*(?:inch|in\b|"|class|-inch)\s*/gi;
  const searchQuery = query.replace(sizePattern, '').replace(/\s{2,}/g, ' ').trim();

  return { searchQuery, originalQuery: query };
}

// ============================================================
// MARKET CONTEXT NOTES
// ============================================================

const MARKET_CONTEXT = {
  monitor: [
    {
      condition: (qi) => {
        const hz = qi.targetSpecs?.refreshRate ? parseInt(qi.targetSpecs.refreshRate) : 0;
        const size = qi.targetSize || 0;
        return hz >= 240 && size >= 40;
      },
      note: '240Hz+ monitors above 40" are rare outside ultrawide formats (45" 21:9 and 49" 32:9). Consider 240Hz 27-32" panels or 144Hz+ in larger flat sizes.',
    },
    {
      condition: (qi) => {
        const hz = qi.targetSpecs?.refreshRate ? parseInt(qi.targetSpecs.refreshRate) : 0;
        return hz >= 360;
      },
      note: '360Hz+ monitors are limited to 24-27" 1080p/1440p panels, primarily for competitive esports.',
    },
    {
      condition: (qi) => {
        const size = qi.targetSize || 0;
        const panel = (qi.targetSpecs?.panelType || '').toLowerCase();
        return panel.includes('oled') && size >= 40 && size <= 44;
      },
      note: 'OLED monitors in 40-44" are a new category (2024+). Availability is limited to a few models from LG and Samsung.',
    },
  ],
  tv: [
    {
      condition: (qi) => {
        const hz = qi.targetSpecs?.refreshRate ? parseInt(qi.targetSpecs.refreshRate) : 0;
        return hz >= 240;
      },
      note: '240Hz TVs are extremely rare. Most high-end TVs max at 120Hz/144Hz. Consider a high-refresh gaming monitor instead.',
    },
    {
      condition: (qi) => {
        const size = qi.targetSize || 0;
        return size >= 85;
      },
      note: '85"+ TVs have limited options and steep pricing. Best value is typically in the 65-77" range.',
    },
  ],
};

/**
 * Get a market context note for thin-results scenarios.
 * @param {object} queryIntent - parsed query intent
 * @param {number} strictMatchCount - number of strict matches found
 * @returns {string|null}
 */
function getMarketContext(queryIntent, strictMatchCount) {
  if (strictMatchCount >= 3) return null;

  const category = queryIntent.category;
  if (!category || !MARKET_CONTEXT[category]) return null;

  for (const entry of MARKET_CONTEXT[category]) {
    if (entry.condition(queryIntent)) {
      return entry.note;
    }
  }

  return null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  parsePrice,
  formatPrice,
  calcDiscount,
  cleanProductName,
  extractBrandModel,
  matchKey,
  dealScore,
  scoreSpecs,
  scoreTVSpecs,
  scoreCameraSpecs,
  scoreGenericSpecs,
  scoreHeadphoneSpecs,
  guessCategory,
  extractSpecsFromName,
  parseQueryIntent,
  isIrrelevantProduct,
  storeTrustScore,
  brandScore,
  formatReviewCount,
  storeEmoji,
  discountEmoji,
  reviewEmoji,
  extractComputerSpecs,
  getExpectedDiscountRange,
  querySpecPenalty,
  classifyMatch,
  expandSizeQuery,
  getMarketContext,
};
