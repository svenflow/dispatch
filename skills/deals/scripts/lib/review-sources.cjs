'use strict';

/**
 * Category Review Sources
 *
 * Pre-populated map of authoritative review sites, forums, and technical
 * resources for each electronics/appliance category. Used to:
 * 1. Display "where to read reviews" links in search output
 * 2. Inform Reddit subreddit selection
 * 3. (Future) Scrape professional review scores
 */

const CATEGORY_REVIEW_SOURCES = {
  monitor: {
    professional: [
      { name: 'Rtings', url: 'https://www.rtings.com/monitor/reviews/best/by-usage/gaming', type: 'review_site' },
      { name: 'TFT Central', url: 'https://tftcentral.co.uk', type: 'review_site' },
      { name: 'Hardware Unboxed', url: 'https://www.youtube.com/@Hardwareunboxed', type: 'youtube' },
      { name: "Tom's Hardware", url: 'https://www.tomshardware.com/reviews/best-gaming-monitors,6590.html', type: 'review_site' },
      { name: 'PC Monitors', url: 'https://pcmonitors.info', type: 'review_site' },
      { name: 'Optimum Tech', url: 'https://www.youtube.com/@OptimumTech', type: 'youtube' },
      { name: 'Badseed Tech', url: 'https://www.youtube.com/@BadSeedTech', type: 'youtube' },
      { name: 'DisplayNinja', url: 'https://displayninja.com', type: 'review_site' },
    ],
    community: [
      { name: 'r/Monitors', subreddit: 'Monitors' },
      { name: 'r/buildapcsales', subreddit: 'buildapcsales' },
      { name: 'r/ultrawide', subreddit: 'ultrawide' },
      { name: 'r/OLED_Monitors', subreddit: 'OLED_Monitors' },
    ],
    specs: [
      { name: 'DisplaySpecifications', url: 'https://www.displayspecifications.com', type: 'spec_db' },
    ],
    priceHistory: [
      { name: 'PCPartPicker', url: 'https://pcpartpicker.com/trends/price/monitor/', type: 'price_history' },
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  tv: {
    professional: [
      { name: 'Rtings', url: 'https://www.rtings.com/tv/reviews/best/by-usage/hdr-gaming', type: 'review_site' },
      { name: 'HDTV Test', url: 'https://www.youtube.com/@hdtvtest', type: 'youtube' },
      { name: "Tom's Guide", url: 'https://www.tomsguide.com/best-picks/best-tvs', type: 'review_site' },
    ],
    community: [
      { name: 'r/4kTV', subreddit: '4kTV' },
      { name: 'r/hometheater', subreddit: 'hometheater' },
      { name: 'r/OLED', subreddit: 'OLED' },
      { name: 'AVS Forum', url: 'https://www.avsforum.com/forums/lcd-flat-panel-displays.33/', type: 'forum' },
    ],
    specs: [
      { name: 'DisplaySpecifications', url: 'https://www.displayspecifications.com', type: 'spec_db' },
    ],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  camera: {
    professional: [
      { name: 'DPReview', url: 'https://www.dpreview.com', type: 'review_site' },
      { name: 'Imaging Resource', url: 'https://www.imaging-resource.com', type: 'review_site' },
      { name: 'Camera Labs', url: 'https://www.cameralabs.com', type: 'review_site' },
      { name: 'Dustin Abbott', url: 'https://dustinabbott.net', type: 'review_site' },
    ],
    community: [
      { name: 'r/photography', subreddit: 'photography' },
      { name: 'r/Cameras', subreddit: 'Cameras' },
      { name: 'r/SonyAlpha', subreddit: 'SonyAlpha' },
      { name: 'Fred Miranda', url: 'https://www.fredmiranda.com/forum/', type: 'forum' },
    ],
    specs: [
      { name: 'Camera Decision', url: 'https://cameradecision.com', type: 'spec_db' },
    ],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
      { name: 'Price.camera', url: 'https://price.camera', type: 'price_history' },
    ],
  },

  audio: {
    professional: [
      { name: 'Audio Science Review', url: 'https://www.audiosciencereview.com', type: 'review_site' },
      { name: 'Audioholics', url: 'https://www.audioholics.com', type: 'review_site' },
      { name: 'Sound & Vision', url: 'https://www.soundandvision.com', type: 'review_site' },
    ],
    community: [
      { name: 'r/hometheater', subreddit: 'hometheater' },
      { name: 'r/BudgetAudiophile', subreddit: 'BudgetAudiophile' },
      { name: 'r/audiophile', subreddit: 'audiophile' },
      { name: 'AVS Forum', url: 'https://www.avsforum.com/forums/receivers-amps-and-processors.90/', type: 'forum' },
    ],
    specs: [
      { name: 'ASR Measurements', url: 'https://www.audiosciencereview.com/forum/index.php?pages/measurements/', type: 'spec_db' },
    ],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  headphones: {
    professional: [
      { name: 'Rtings', url: 'https://www.rtings.com/headphones/reviews/best/by-usage/gaming', type: 'review_site' },
      { name: 'Head-Fi', url: 'https://www.head-fi.org', type: 'review_site' },
      { name: 'Crinacle', url: 'https://crinacle.com/rankings/', type: 'review_site' },
    ],
    community: [
      { name: 'r/headphones', subreddit: 'headphones' },
      { name: 'r/HeadphoneAdvice', subreddit: 'HeadphoneAdvice' },
      { name: 'Head-Fi Forums', url: 'https://www.head-fi.org/forums/', type: 'forum' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  laptop: {
    professional: [
      { name: 'NotebookCheck', url: 'https://www.notebookcheck.net', type: 'review_site' },
      { name: 'Laptop Mag', url: 'https://www.laptopmag.com', type: 'review_site' },
      { name: "Jarrod's Tech", url: 'https://www.youtube.com/@JarrodsTech', type: 'youtube' },
      { name: 'Rtings', url: 'https://www.rtings.com/laptop/reviews/best/by-usage/gaming', type: 'review_site' },
    ],
    community: [
      { name: 'r/laptops', subreddit: 'laptops' },
      { name: 'r/LaptopDeals', subreddit: 'LaptopDeals' },
      { name: 'r/GamingLaptops', subreddit: 'GamingLaptops' },
    ],
    specs: [
      { name: 'NotebookCheck Benchmarks', url: 'https://www.notebookcheck.net/Benchmarks-Tech.123.0.html', type: 'spec_db' },
    ],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
      { name: 'PCPartPicker', url: 'https://pcpartpicker.com', type: 'price_history' },
    ],
  },

  desktop: {
    professional: [
      { name: "Tom's Hardware", url: 'https://www.tomshardware.com', type: 'review_site' },
      { name: 'Gamers Nexus', url: 'https://www.youtube.com/@GamersNexus', type: 'youtube' },
    ],
    community: [
      { name: 'r/buildapcsales', subreddit: 'buildapcsales' },
      { name: 'r/buildapc', subreddit: 'buildapc' },
      { name: 'r/macdeals', subreddit: 'macdeals' },
    ],
    specs: [
      { name: 'PCPartPicker', url: 'https://pcpartpicker.com', type: 'spec_db' },
    ],
    priceHistory: [
      { name: 'PCPartPicker', url: 'https://pcpartpicker.com', type: 'price_history' },
    ],
  },

  appliance: {
    professional: [
      { name: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter/', type: 'review_site' },
      { name: 'Consumer Reports', url: 'https://www.consumerreports.org', type: 'review_site' },
      { name: 'Reviewed.com', url: 'https://reviewed.usatoday.com', type: 'review_site' },
    ],
    community: [
      { name: 'r/Appliances', subreddit: 'Appliances' },
      { name: 'r/BuyItForLife', subreddit: 'BuyItForLife' },
      { name: 'r/homeimprovement', subreddit: 'homeimprovement' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  networking: {
    professional: [
      { name: 'SmallNetBuilder', url: 'https://www.smallnetbuilder.com', type: 'review_site' },
      { name: 'Dong Knows Tech', url: 'https://dongknows.com', type: 'review_site' },
    ],
    community: [
      { name: 'r/HomeNetworking', subreddit: 'HomeNetworking' },
      { name: 'r/wifi', subreddit: 'wifi' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  storage: {
    professional: [
      { name: "Tom's Hardware", url: 'https://www.tomshardware.com/reviews/best-ssds,3891.html', type: 'review_site' },
      { name: 'TechPowerUp', url: 'https://www.techpowerup.com/review/?category=SSD', type: 'review_site' },
    ],
    community: [
      { name: 'r/DataHoarder', subreddit: 'DataHoarder' },
      { name: 'r/NewMaxx', subreddit: 'NewMaxx' },
      { name: 'r/buildapcsales', subreddit: 'buildapcsales' },
    ],
    specs: [],
    priceHistory: [
      { name: 'PCPartPicker', url: 'https://pcpartpicker.com/trends/price/internal-hard-drive/', type: 'price_history' },
    ],
  },

  smartHome: {
    professional: [
      { name: 'The Verge', url: 'https://www.theverge.com/smart-home', type: 'review_site' },
      { name: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter/', type: 'review_site' },
    ],
    community: [
      { name: 'r/homeautomation', subreddit: 'homeautomation' },
      { name: 'r/smarthome', subreddit: 'smarthome' },
      { name: 'r/homeassistant', subreddit: 'homeassistant' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  phone: {
    professional: [
      { name: 'GSMArena', url: 'https://www.gsmarena.com', type: 'review_site' },
      { name: 'MKBHD', url: 'https://www.youtube.com/@mkbhd', type: 'youtube' },
      { name: 'The Verge', url: 'https://www.theverge.com/phones', type: 'review_site' },
    ],
    community: [
      { name: 'r/Android', subreddit: 'Android' },
      { name: 'r/iphone', subreddit: 'iphone' },
      { name: 'r/GooglePixel', subreddit: 'GooglePixel' },
    ],
    specs: [
      { name: 'GSMArena Compare', url: 'https://www.gsmarena.com/compare.php3', type: 'comparison' },
    ],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  printer: {
    professional: [
      { name: 'Rtings', url: 'https://www.rtings.com/printer/reviews/best/by-usage/home-use', type: 'review_site' },
      { name: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter/reviews/best-all-in-one-printer/', type: 'review_site' },
    ],
    community: [
      { name: 'r/printers', subreddit: 'printers' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  gaming: {
    professional: [
      { name: 'Digital Foundry', url: 'https://www.youtube.com/@DigitalFoundry', type: 'youtube' },
      { name: 'Rtings', url: 'https://www.rtings.com', type: 'review_site' },
    ],
    community: [
      { name: 'r/GameDeals', subreddit: 'GameDeals' },
      { name: 'r/buildapcsales', subreddit: 'buildapcsales' },
      { name: 'r/pcmasterrace', subreddit: 'pcmasterrace' },
    ],
    specs: [],
    priceHistory: [
      { name: 'IsThereAnyDeal', url: 'https://isthereanydeal.com', type: 'price_history' },
    ],
  },
  gpu: {
    professional: [
      { name: 'Gamers Nexus', url: 'https://www.youtube.com/@GamersNexus', type: 'youtube' },
      { name: 'Hardware Unboxed', url: 'https://www.youtube.com/@Hardwareunboxed', type: 'youtube' },
      { name: 'TechPowerUp', url: 'https://www.techpowerup.com/review/?category=GPU', type: 'review_site' },
      { name: "Tom's Hardware", url: 'https://www.tomshardware.com/reviews/best-gpus,4380.html', type: 'review_site' },
    ],
    community: [
      { name: 'r/nvidia', subreddit: 'nvidia' },
      { name: 'r/AMD', subreddit: 'AMD' },
      { name: 'r/buildapcsales', subreddit: 'buildapcsales' },
    ],
    specs: [
      { name: 'TechPowerUp GPU DB', url: 'https://www.techpowerup.com/gpu-specs/', type: 'spec_db' },
    ],
    priceHistory: [
      { name: 'PCPartPicker', url: 'https://pcpartpicker.com/trends/price/video-card/', type: 'price_history' },
    ],
  },

  peripherals: {
    professional: [
      { name: 'Rtings', url: 'https://www.rtings.com/keyboard/reviews/best/by-usage/office', type: 'review_site' },
      { name: 'Hardware Canucks', url: 'https://www.youtube.com/@HardwareCanucks', type: 'youtube' },
      { name: 'Badseed Tech', url: 'https://www.youtube.com/@BadSeedTech', type: 'youtube' },
    ],
    community: [
      { name: 'r/MechanicalKeyboards', subreddit: 'MechanicalKeyboards' },
      { name: 'r/MouseReview', subreddit: 'MouseReview' },
      { name: 'r/buildapcsales', subreddit: 'buildapcsales' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  tablet: {
    professional: [
      { name: 'Rtings', url: 'https://www.rtings.com/tablet', type: 'review_site' },
      { name: 'The Verge', url: 'https://www.theverge.com/tablets', type: 'review_site' },
    ],
    community: [
      { name: 'r/ipad', subreddit: 'ipad' },
      { name: 'r/AndroidTablets', subreddit: 'AndroidTablets' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  projector: {
    professional: [
      { name: 'ProjectorCentral', url: 'https://www.projectorcentral.com', type: 'review_site' },
      { name: 'Chris Majestic', url: 'https://www.youtube.com/@ChrisMajestic', type: 'youtube' },
    ],
    community: [
      { name: 'r/projectors', subreddit: 'projectors' },
      { name: 'r/hometheater', subreddit: 'hometheater' },
    ],
    specs: [
      { name: 'ProjectorCentral Compare', url: 'https://www.projectorcentral.com/projectors.cfm', type: 'spec_db' },
    ],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  wearable: {
    professional: [
      { name: 'The Verge', url: 'https://www.theverge.com/wearables', type: 'review_site' },
      { name: 'DC Rainmaker', url: 'https://www.dcrainmaker.com', type: 'review_site' },
      { name: 'Wareable', url: 'https://www.wareable.com', type: 'review_site' },
    ],
    community: [
      { name: 'r/AppleWatch', subreddit: 'AppleWatch' },
      { name: 'r/GalaxyWatch', subreddit: 'GalaxyWatch' },
      { name: 'r/Garmin', subreddit: 'Garmin' },
      { name: 'r/fitbit', subreddit: 'fitbit' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  vacuum: {
    professional: [
      { name: 'Vacuum Wars', url: 'https://www.youtube.com/@VacuumWars', type: 'youtube' },
      { name: 'Rtings', url: 'https://www.rtings.com/vacuum/reviews/best/by-usage/robot', type: 'review_site' },
      { name: 'Consumer Reports', url: 'https://www.consumerreports.org/vacuums/', type: 'review_site' },
    ],
    community: [
      { name: 'r/VacuumCleaners', subreddit: 'VacuumCleaners' },
      { name: 'r/RobotVacuums', subreddit: 'RobotVacuums' },
      { name: 'r/BuyItForLife', subreddit: 'BuyItForLife' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  coffee: {
    professional: [
      { name: 'James Hoffmann', url: 'https://www.youtube.com/@jameshoffmann', type: 'youtube' },
      { name: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter/reviews/best-drip-coffee-maker/', type: 'review_site' },
      { name: 'Whole Latte Love', url: 'https://www.youtube.com/@WholeLatteLove', type: 'youtube' },
    ],
    community: [
      { name: 'r/Coffee', subreddit: 'Coffee' },
      { name: 'r/espresso', subreddit: 'espresso' },
      { name: 'r/BuyItForLife', subreddit: 'BuyItForLife' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  microwave: {
    professional: [
      { name: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter/', type: 'review_site' },
      { name: 'Consumer Reports', url: 'https://www.consumerreports.org', type: 'review_site' },
      { name: 'Reviewed.com', url: 'https://reviewed.usatoday.com', type: 'review_site' },
    ],
    community: [
      { name: 'r/Appliances', subreddit: 'Appliances' },
      { name: 'r/BuyItForLife', subreddit: 'BuyItForLife' },
      { name: 'r/Cooking', subreddit: 'Cooking' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  powertools: {
    professional: [
      { name: 'Project Farm', url: 'https://www.youtube.com/@ProjectFarm', type: 'youtube' },
      { name: 'Tool Box Buzz', url: 'https://toolboxbuzz.com', type: 'review_site' },
      { name: 'Pro Tool Reviews', url: 'https://www.protoolreviews.com', type: 'review_site' },
    ],
    community: [
      { name: 'r/Tools', subreddit: 'Tools' },
      { name: 'r/powertools', subreddit: 'powertools' },
      { name: 'r/MilwaukeeTool', subreddit: 'MilwaukeeTool' },
      { name: 'r/DeWalt', subreddit: 'DeWalt' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  outdoor: {
    professional: [
      { name: 'Consumer Reports', url: 'https://www.consumerreports.org', type: 'review_site' },
      { name: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter/', type: 'review_site' },
    ],
    community: [
      { name: 'r/grilling', subreddit: 'grilling' },
      { name: 'r/BBQ', subreddit: 'BBQ' },
      { name: 'r/lawncare', subreddit: 'lawncare' },
      { name: 'r/lawnmowers', subreddit: 'lawnmowers' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },

  hvac: {
    professional: [
      { name: 'Consumer Reports', url: 'https://www.consumerreports.org', type: 'review_site' },
      { name: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter/', type: 'review_site' },
      { name: 'Technology Connections', url: 'https://www.youtube.com/@TechnologyConnections', type: 'youtube' },
    ],
    community: [
      { name: 'r/hvacadvice', subreddit: 'hvacadvice' },
      { name: 'r/AirPurifiers', subreddit: 'AirPurifiers' },
      { name: 'r/homeimprovement', subreddit: 'homeimprovement' },
    ],
    specs: [],
    priceHistory: [
      { name: 'CamelCamelCamel', url: 'https://camelcamelcamel.com', type: 'price_history' },
    ],
  },
};

/**
 * Get the top N review source links for a category (for display in output).
 * @param {string} category
 * @param {number} [limit=2]
 * @returns {string[]} e.g. ['rtings.com/monitor', 'tftcentral.co.uk']
 */
function getReviewLinks(category, limit = 2) {
  const sources = CATEGORY_REVIEW_SOURCES[category];
  if (!sources || !sources.professional) return [];
  return sources.professional.slice(0, limit).map(s => {
    // Extract short domain from URL
    try {
      const domain = new URL(s.url).hostname.replace(/^www\./, '');
      return `${s.name} (${domain})`;
    } catch {
      return s.name;
    }
  });
}

/**
 * Get community subreddits for a category (for Reddit integration).
 * @param {string} category
 * @returns {string[]} subreddit names
 */
function getCommunitySubreddits(category) {
  const sources = CATEGORY_REVIEW_SOURCES[category];
  if (!sources || !sources.community) return [];
  return sources.community.filter(c => c.subreddit).map(c => c.subreddit);
}

module.exports = {
  CATEGORY_REVIEW_SOURCES,
  getReviewLinks,
  getCommunitySubreddits,
};
