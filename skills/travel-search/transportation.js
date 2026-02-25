#!/usr/bin/env node
/**
 * Transportation Research Module
 *
 * Researches transportation options for a destination and provides recommendations.
 * Uses web search to gather information about:
 * - Walkability scores
 * - Public transit quality
 * - Rental car necessity
 * - Uber/rideshare availability
 * - Parking costs and availability
 */

const { execSync } = require('child_process');

// Transportation mode recommendations database
// Based on common knowledge about cities
const CITY_TRANSPORT_DATA = {
  // European cities - generally good public transit
  'barcelona': {
    walkable: true,
    transit: 'excellent',
    needsCar: false,
    recommendation: 'Metro + Walking',
    details: 'Barcelona has excellent metro coverage. Most attractions are walkable or a short metro ride. Skip the rental car - parking is expensive and limited in the Gothic Quarter and Eixample.',
    costs: { metro_pass: '€11.35/day', uber_avg: '€8-15', rental_car: '€40-60/day + €25-40 parking' }
  },
  'paris': {
    walkable: true,
    transit: 'excellent',
    needsCar: false,
    recommendation: 'Metro + Walking',
    details: 'Paris metro is world-class. Walking between arrondissements is pleasant. Rental cars are unnecessary and parking is nightmare. Use metro for longer distances, walk for everything else.',
    costs: { metro_pass: '€16.60/day', uber_avg: '€10-20', rental_car: '€50-80/day + €30-50 parking' }
  },
  'nice': {
    walkable: true,
    transit: 'good',
    needsCar: false,
    recommendation: 'Walking + Tram/Bus',
    details: 'Nice is very walkable along the Promenade des Anglais. Tram line 1 covers main areas. For day trips to Monaco/Cannes, take the train. Rental car only needed for Provence villages.',
    costs: { transit_pass: '€10/day', uber_avg: '€8-15', rental_car: '€35-50/day' }
  },
  'amsterdam': {
    walkable: true,
    transit: 'excellent',
    needsCar: false,
    recommendation: 'Bike + Walking',
    details: 'Amsterdam is a biking city. Rent bikes, not cars. The city center is compact and walkable. Trams supplement for longer distances. Driving is actively discouraged with limited parking.',
    costs: { bike_rental: '€12-15/day', transit_pass: '€8.50/day', uber_avg: '€10-18' }
  },
  'london': {
    walkable: true,
    transit: 'excellent',
    needsCar: false,
    recommendation: 'Tube + Walking',
    details: 'The Tube goes everywhere. Walking is pleasant in central London. Black cabs for late nights. Avoid renting a car - congestion charge is £15/day and parking is scarce.',
    costs: { oyster_cap: '£8.10/day', uber_avg: '£10-25', rental_car: '£40-60/day + £15 congestion + £30+ parking' }
  },
  'rome': {
    walkable: true,
    transit: 'good',
    needsCar: false,
    recommendation: 'Walking + Metro/Bus',
    details: 'Rome is best explored on foot - you will discover hidden gems. Metro has 3 lines covering major sites. Taxis for tired feet. Driving in Rome is chaotic and parking impossible.',
    costs: { transit_pass: '€7/day', taxi_avg: '€10-20', uber_avg: '€8-15' }
  },
  'lisbon': {
    walkable: true,
    transit: 'good',
    needsCar: false,
    recommendation: 'Walking + Tram/Uber',
    details: 'Lisbon is hilly but walkable with good shoes. Iconic trams (especially 28) are fun but crowded. Metro covers main areas. Uber is cheap and convenient for hills. No need for car.',
    costs: { transit_pass: '€6.60/day', uber_avg: '€5-12', tram_28: '€3.00' }
  },
  'madrid': {
    walkable: true,
    transit: 'excellent',
    needsCar: false,
    recommendation: 'Metro + Walking',
    details: 'Madrid has one of Europe\'s best metro systems. The city center is very walkable. Skip the car unless doing extensive day trips outside the city.',
    costs: { metro_pass: '€8.40/day', uber_avg: '€8-15', rental_car: '€35-55/day' }
  },

  // US cities - varies widely
  'new york': {
    walkable: true,
    transit: 'excellent',
    needsCar: false,
    recommendation: 'Subway + Walking',
    details: 'NYC subway runs 24/7. Manhattan is very walkable. Do not rent a car - parking is $40-80/day and traffic is brutal. Uber/Lyft for outer boroughs or late night.',
    costs: { subway: '$2.90/ride', uber_avg: '$15-40', rental_car: '$80-120/day + $40-80 parking' }
  },
  'los angeles': {
    walkable: false,
    transit: 'poor',
    needsCar: true,
    recommendation: 'Rental Car',
    details: 'LA requires a car. Attractions are spread across a huge area. Public transit exists but is slow and doesn\'t cover key areas. Budget for parking at hotels and attractions.',
    costs: { rental_car: '$45-75/day', parking: '$15-40/day', uber_long: '$30-60' }
  },
  'san francisco': {
    walkable: true,
    transit: 'good',
    needsCar: false,
    recommendation: 'Uber + Walking + Transit',
    details: 'SF is walkable but hilly. BART and Muni cover main areas. Uber/Lyft are abundant. Rental car useful only for wine country or Big Sur day trips. Street parking is hard to find.',
    costs: { muni_pass: '$13/day', uber_avg: '$12-25', rental_car: '$55-85/day' }
  },
  'miami': {
    walkable: false,
    transit: 'limited',
    needsCar: true,
    recommendation: 'Rental Car or Uber',
    details: 'Miami Beach is walkable, but getting to other areas (Wynwood, Little Havana, Everglades) requires wheels. Rental car recommended unless staying exclusively in South Beach.',
    costs: { rental_car: '$40-70/day', uber_avg: '$15-35', metrorail: '$2.25/ride' }
  },
  'boston': {
    walkable: true,
    transit: 'good',
    needsCar: false,
    recommendation: 'Walking + T (Subway)',
    details: 'Boston is very walkable and compact. The T covers most tourist areas. Skip the car - streets are confusing and parking is expensive. Uber for Cambridge/Somerville.',
    costs: { charlie_card: '$2.40/ride', uber_avg: '$12-25', rental_car: '$60-90/day + $30-50 parking' }
  },
  'chicago': {
    walkable: true,
    transit: 'excellent',
    needsCar: false,
    recommendation: 'L Train + Walking',
    details: 'Chicago L train is excellent and runs 24/7 on some lines. Downtown and North Side are very walkable. Skip the rental car unless exploring suburbs.',
    costs: { ventra: '$5/day unlimited', uber_avg: '$12-30', rental_car: '$50-80/day' }
  },
  'las vegas': {
    walkable: false,
    transit: 'limited',
    needsCar: false,
    recommendation: 'Walking Strip + Uber',
    details: 'The Strip is walkable (though long). Monorail connects some hotels. Uber/Lyft for off-Strip destinations. Rental car only if visiting Grand Canyon or doing extensive off-Strip exploration.',
    costs: { monorail: '$5/ride', uber_avg: '$15-30', rental_car: '$35-60/day' }
  },
  'seattle': {
    walkable: true,
    transit: 'good',
    needsCar: false,
    recommendation: 'Light Rail + Walking + Uber',
    details: 'Downtown Seattle is walkable. Light rail connects airport to downtown and UW. Uber/Lyft fill gaps. Rental car only for Mt. Rainier or Olympic Peninsula day trips.',
    costs: { orca: '$3/ride', uber_avg: '$12-25', rental_car: '$50-80/day' }
  },
  'austin': {
    walkable: false,
    transit: 'limited',
    needsCar: true,
    recommendation: 'Rental Car or Uber',
    details: 'Austin is spread out with limited public transit. Downtown/SoCo are walkable but most attractions require wheels. Rideshare works but gets expensive. Rental car recommended.',
    costs: { rental_car: '$40-65/day', uber_avg: '$15-30', parking: '$10-25/day' }
  },
  'denver': {
    walkable: true,
    transit: 'good',
    needsCar: false,
    recommendation: 'Light Rail + Walking + Uber',
    details: 'Downtown Denver is walkable. RTD light rail connects airport and major areas. For Rocky Mountain day trips, rent a car for that day only.',
    costs: { rtd: '$3/ride', uber_avg: '$12-25', rental_car: '$45-70/day' }
  },

  // Caribbean/beach destinations
  'cancun': {
    walkable: false,
    transit: 'limited',
    needsCar: false,
    recommendation: 'Hotel Shuttle + Uber/Taxi',
    details: 'Hotel zone is a long strip - use hotel shuttles or cheap taxis. Public buses run along the hotel zone. Rental car only for exploring Yucatan (Chichen Itza, Tulum). Uber exists.',
    costs: { taxi_zone: '$5-15', uber_avg: '$8-20', rental_car: '$25-45/day' }
  },
  'san juan': {
    walkable: true,
    transit: 'limited',
    needsCar: true,
    recommendation: 'Walking Old San Juan + Rental Car',
    details: 'Old San Juan is very walkable and charming. For beaches and El Yunque, rent a car. Uber exists but limited. Rental car recommended for exploring the island.',
    costs: { rental_car: '$35-55/day', uber_avg: '$10-25', parking: '$15-25/day' }
  },

  // Asia/Pacific
  'tokyo': {
    walkable: true,
    transit: 'excellent',
    needsCar: false,
    recommendation: 'Train + Walking',
    details: 'Tokyo rail system is world-class. Get a Suica/Pasmo card. Walking is essential between stations. Never rent a car in Tokyo - impossible parking and traffic.',
    costs: { suica_avg: '¥1500/day', taxi_short: '¥1000-2000', rental_car: 'Not recommended' }
  },
  'singapore': {
    walkable: true,
    transit: 'excellent',
    needsCar: false,
    recommendation: 'MRT + Walking + Grab',
    details: 'Singapore MRT is excellent. City is very walkable despite heat. Grab (Uber equivalent) is cheap. Taxis are affordable. Car ownership is heavily taxed, don\'t rent one.',
    costs: { mrt_day: 'S$20', grab_avg: 'S$10-25', taxi_avg: 'S$15-30' }
  }
};

/**
 * Normalize destination name for lookup
 */
function normalizeDestination(dest) {
  return dest.toLowerCase()
    .replace(/,.*$/, '') // Remove country/state
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get transportation recommendation for a destination
 */
function getTransportationRecommendation(destination) {
  const normalized = normalizeDestination(destination);

  // Direct match
  if (CITY_TRANSPORT_DATA[normalized]) {
    return CITY_TRANSPORT_DATA[normalized];
  }

  // Partial match
  for (const [city, data] of Object.entries(CITY_TRANSPORT_DATA)) {
    if (normalized.includes(city) || city.includes(normalized)) {
      return data;
    }
  }

  // Default for unknown cities - conservative recommendation
  return {
    walkable: null,
    transit: 'unknown',
    needsCar: null,
    recommendation: 'Research needed',
    details: `Transportation data not available for ${destination}. Research walkability, public transit, and rideshare availability before booking.`,
    costs: {}
  };
}

/**
 * Format transportation recommendation for SMS output
 */
function formatTransportation(destination, nights = 6) {
  const rec = getTransportationRecommendation(destination);
  const lines = [];

  lines.push('🚗 TRANSPORTATION');
  lines.push(`Recommendation: ${rec.recommendation}`);

  if (rec.details) {
    // Wrap long text for SMS
    const words = rec.details.split(' ');
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).length > 45) {
        lines.push(line.trim());
        line = word;
      } else {
        line += ' ' + word;
      }
    }
    if (line.trim()) lines.push(line.trim());
  }

  // Cost estimates
  if (rec.costs && Object.keys(rec.costs).length > 0) {
    lines.push('');
    lines.push('Estimated costs:');
    for (const [type, cost] of Object.entries(rec.costs)) {
      const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`  ${label}: ${cost}`);
    }
  }

  return lines;
}

// CLI interface
if (require.main === module) {
  const dest = process.argv[2] || 'Barcelona, Spain';
  const rec = getTransportationRecommendation(dest);
  console.log(JSON.stringify(rec, null, 2));
}

module.exports = {
  getTransportationRecommendation,
  formatTransportation,
  CITY_TRANSPORT_DATA
};
