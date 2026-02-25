// Airbnb listing extraction script - Rich output v2.0
// This runs in the browser context via chrome-control
// Extracts: name, rating, reviews, price (current + original), discount, superhost, amenities, neighborhood, cancellation
(function() {
  var listings = [];
  var seen = {};
  var cards = document.querySelectorAll('[itemprop="itemListElement"], [data-testid="card-container"]');

  for (var i = 0; i < cards.length && listings.length < 10; i++) {
    var card = cards[i];
    try {
      var link = card.querySelector('a[href*="/rooms/"]');
      if (!link) continue;

      var match = link.href.match(/rooms\/(\d+)/);
      if (!match) continue;

      var listingId = match[1];
      if (seen[listingId]) continue;
      seen[listingId] = true;

      var titleEl = card.querySelector('[data-testid="listing-card-title"]');
      var title = titleEl ? titleEl.textContent.trim() : 'Unknown';

      var text = card.textContent;

      // Rating and reviews
      var ratingMatch = text.match(/(\d+\.\d+)\s*\((\d+)\)/);
      var rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
      var reviews = ratingMatch ? parseInt(ratingMatch[2]) : 0;

      // Current price (total for stay)
      var priceMatch = text.match(/\$(\d[\d,]*)\s*for/);
      var price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;

      // Original price (strikethrough) - look for element with line-through style or del/s tags
      var originalPrice = null;
      var discountPct = null;
      var strikeEl = card.querySelector('[style*="line-through"], del, s, .c1pk68c3');
      if (strikeEl) {
        var origMatch = strikeEl.textContent.match(/\$(\d[\d,]*)/);
        if (origMatch) {
          originalPrice = parseInt(origMatch[1].replace(/,/g, ''));
          if (originalPrice > price && price > 0) {
            discountPct = Math.round(100 * (originalPrice - price) / originalPrice);
          }
        }
      }

      // Beds
      var bedsMatch = text.match(/(\d+)\s*bedroom/i);
      var beds = bedsMatch ? parseInt(bedsMatch[1]) : 0;

      // Superhost
      var superhost = text.indexOf('Superhost') >= 0;

      // Cancellation
      var freeCancellation = text.indexOf('Free cancellation') >= 0;
      var nonRefundable = text.indexOf('non-refundable') >= 0 || text.indexOf('Non-refundable') >= 0;

      // Neighborhood/location - look for subtitle with "in <location>"
      var neighborhood = '';
      var subtitleEl = card.querySelector('[data-testid="listing-card-subtitle"]');
      if (subtitleEl) {
        var subText = subtitleEl.textContent || '';
        var locMatch = subText.match(/(?:in|near)\s+([^,\n]+)/i);
        if (locMatch) {
          var loc = locMatch[1].trim();
          // Filter out false positives
          if (loc.toLowerCase() !== 'superhost' && loc.length > 2 && loc.length < 35) {
            neighborhood = loc;
          }
        }
      }
      // Fallback: look for arrondissement or neighborhood patterns
      if (!neighborhood) {
        var spans = card.querySelectorAll('span');
        for (var j = 0; j < spans.length && j < 15; j++) {
          var spanText = spans[j].textContent || '';
          // Look for Paris arrondissements (e.g., "11th Arr", "2nd Arrondissement")
          if (spanText.match(/^\d+(st|nd|rd|th)\s+Arr/i)) {
            neighborhood = spanText.trim().substring(0, 20);
            break;
          }
          // Look for common neighborhood patterns (e.g., "Champs-Elysees", "De Wallen")
          if (spanText.match(/^[A-Z][a-z]+([ -][A-Za-z]+){0,3}$/) &&
              spanText.length > 3 && spanText.length < 25 &&
              !spanText.match(/^(Superhost|Guest|Free|New|Rare|Entire|Private|Shared)/i)) {
            neighborhood = spanText.trim();
            break;
          }
        }
      }

      // Amenities - check for common amenity keywords
      var amenities = [];
      if (/\bwifi\b/i.test(text)) amenities.push('WiFi');
      if (/\bpool\b/i.test(text)) amenities.push('Pool');
      if (/\bkitchen\b/i.test(text)) amenities.push('Kitchen');
      if (/\bparking\b/i.test(text)) amenities.push('Parking');
      if (/\bwasher\b/i.test(text)) amenities.push('Washer');
      if (/\bac\b|\bair condition/i.test(text)) amenities.push('AC');
      if (/\bhot tub\b|\bjacuzzi\b/i.test(text)) amenities.push('HotTub');

      listings.push({
        id: listingId,
        name: title.substring(0, 50),
        rating: rating,
        reviews: reviews,
        priceTotal: price,
        originalPrice: originalPrice,
        discountPct: discountPct,
        beds: beds,
        superhost: superhost,
        freeCancellation: freeCancellation,
        nonRefundable: nonRefundable,
        neighborhood: neighborhood,
        amenities: amenities
      });
    } catch(e) {}
  }
  return JSON.stringify(listings);
})();
