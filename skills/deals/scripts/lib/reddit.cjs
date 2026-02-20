'use strict';

/**
 * Reddit Community Signal Integration
 *
 * Searches relevant subreddits for product mentions, deals, and community sentiment.
 * Uses Reddit's public JSON API (no auth needed for read-only at low volume).
 *
 * Rate limit: < 60 requests/minute with proper User-Agent.
 */

const UA = 'Pangserve-Deals/1.0 (Mac Mini; contact: deals@pangserve.local)';

// ============================================================
// SUBREDDIT MAPPING
// ============================================================

/** Map product categories to relevant subreddits (3-5 per category, most relevant first) */
const CATEGORY_SUBREDDITS = {
  // Display
  tv: ['4kTV', 'hometheater', 'OLED', 'BRAVIA', 'buildapcsales'],
  monitor: ['Monitors', 'buildapcsales', 'ultrawide', 'OLED_Monitors'],

  // Computing
  desktop: ['buildapcsales', 'buildapc', 'macdeals', 'apple'],
  aio: ['buildapcsales', 'macdeals', 'apple'],
  laptop: ['LaptopDeals', 'GamingLaptops', 'buildapcsales', 'macdeals'],
  tablet: ['ipad', 'AndroidTablets', 'buildapcsales'],
  gpu: ['nvidia', 'AMD', 'buildapcsales', 'hardwareswap'],
  peripherals: ['MechanicalKeyboards', 'MouseReview', 'buildapcsales'],
  storage: ['DataHoarder', 'NewMaxx', 'buildapcsales'],
  networking: ['HomeNetworking', 'wifi', 'buildapcsales'],
  printer: ['printers', 'BuyItForLife'],

  // Audio/Video
  camera: ['Cameras', 'photography', 'videography', 'SonyAlpha'],
  audio: ['BudgetAudiophile', 'hometheater', 'audiophile'],
  receiver: ['hometheater', 'BudgetAudiophile', 'audiophile'],
  headphones: ['headphones', 'HeadphoneAdvice', 'buildapcsales'],
  projector: ['projectors', 'hometheater'],

  // Mobile
  phone: ['Android', 'iphone', 'GooglePixel', 'apple'],
  wearable: ['AppleWatch', 'GalaxyWatch', 'Garmin', 'fitbit'],

  // Gaming
  gaming: ['GameDeals', 'buildapcsales', 'pcmasterrace', 'NintendoSwitchDeals'],

  // Home/Smart Home
  smartHome: ['homeautomation', 'smarthome', 'homeassistant'],

  // Appliances (large)
  appliance: ['Appliances', 'BuyItForLife', 'homeimprovement'],

  // Kitchen (small appliances)
  microwave: ['Appliances', 'BuyItForLife', 'Cooking'],
  coffee: ['Coffee', 'espresso', 'BuyItForLife'],

  // Cleaning
  vacuum: ['VacuumCleaners', 'RobotVacuums', 'BuyItForLife'],

  // Outdoor/Tools
  powertools: ['Tools', 'powertools', 'MilwaukeeTool', 'DeWalt'],
  outdoor: ['grilling', 'BBQ', 'lawncare', 'lawnmowers'],

  // HVAC/Climate
  hvac: ['hvacadvice', 'AirPurifiers', 'homeimprovement'],

  // Generic fallback
  _default: ['buildapcsales', 'deals', 'BuyItForLife', 'hometheater'],
};

/** Positive sentiment keywords */
const POSITIVE_KEYWORDS = [
  'great deal', 'amazing deal', 'fantastic deal', 'incredible deal',
  'steal', 'worth it', 'buy it', 'highly recommend', 'best price',
  'historical low', 'all-time low', 'lowest price', 'price drop',
  'must buy', 'no brainer', 'can\'t go wrong', 'love this', 'love mine',
  'excellent', 'outstanding', 'phenomenal', 'solid choice',
  'chief this is it', 'this is it', 'it chief',
];

/** Negative sentiment keywords */
const NEGATIVE_KEYWORDS = [
  'overpriced', 'not worth', 'pass', 'skip', 'avoid',
  'bad deal', 'terrible', 'garbage', 'junk', 'cheap build',
  'buyer beware', 'don\'t buy', 'returned it', 'regret',
  'been cheaper', 'was cheaper', 'better deal', 'wait for',
  'price gouging', 'inflated', 'markup', 'meh',
  'this ain\'t it', 'ain\'t it chief',
];

// ============================================================
// REDDIT API
// ============================================================

/**
 * Search a subreddit for product mentions.
 * @param {string} subreddit - subreddit name (without r/)
 * @param {string} query - search query
 * @param {object} [options]
 * @param {number} [options.limit=5] - max posts to return
 * @param {string} [options.sort='relevance'] - relevance, new, hot, top
 * @param {string} [options.time='year'] - hour, day, week, month, year, all
 * @returns {Promise<object[]>} - array of post objects
 */
async function searchSubreddit(subreddit, query, options = {}) {
  const { limit = 5, sort = 'relevance', time = 'year' } = options;

  const url = `https://www.reddit.com/r/${subreddit}/search.json?` +
    `q=${encodeURIComponent(query)}&restrict_sr=on&sort=${sort}&t=${time}&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status === 429) {
        process.stderr.write(`    [reddit] Rate limited on r/${subreddit}\n`);
        return [];
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const posts = (data?.data?.children || []).map(child => child.data);

    return posts.map(post => ({
      title: post.title || '',
      url: `https://www.reddit.com${post.permalink}`,
      subreddit: post.subreddit,
      score: post.score || 0,
      upvoteRatio: post.upvote_ratio || 0,
      numComments: post.num_comments || 0,
      created: post.created_utc ? new Date(post.created_utc * 1000) : null,
      flair: post.link_flair_text || null,
      selftext: (post.selftext || '').substring(0, 500),
      linkUrl: post.url || null,
    }));
  } catch (e) {
    if (e.name === 'AbortError') {
      process.stderr.write(`    [reddit] Timeout on r/${subreddit}\n`);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch top comments on a specific Reddit post.
 * @param {string} permalink - e.g., "/r/buildapcsales/comments/abc123/..."
 * @param {number} [limit=10]
 * @returns {Promise<string[]>} - array of comment body texts
 */
async function fetchTopComments(permalink, limit = 10) {
  // Clean up permalink
  const cleanPermalink = permalink.replace(/^https?:\/\/www\.reddit\.com/, '');
  const url = `https://www.reddit.com${cleanPermalink}.json?sort=top&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) return [];

    const data = await res.json();
    // Reddit returns [post, comments] array
    const commentListing = data[1]?.data?.children || [];

    return commentListing
      .filter(c => c.kind === 't1' && c.data?.body)
      .slice(0, limit)
      .map(c => c.data.body);

  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Analyze sentiment from an array of text strings.
 * Returns { positive, negative, neutral, summary }
 */
function analyzeSentiment(texts) {
  let positive = 0;
  let negative = 0;
  const allText = texts.join(' ').toLowerCase();

  for (const kw of POSITIVE_KEYWORDS) {
    if (allText.includes(kw)) positive++;
  }
  for (const kw of NEGATIVE_KEYWORDS) {
    if (allText.includes(kw)) negative++;
  }

  const total = positive + negative;
  let summary = 'neutral';
  if (total === 0) summary = 'no signal';
  else if (positive > negative * 2) summary = 'very positive';
  else if (positive > negative) summary = 'positive';
  else if (negative > positive * 2) summary = 'very negative';
  else if (negative > positive) summary = 'negative';
  else summary = 'mixed';

  return { positive, negative, neutral: texts.length - total, summary };
}

/**
 * Calculate a community score (0-100) from Reddit data.
 */
function communityScore(posts, sentiment) {
  if (!posts || posts.length === 0) return 0;

  // Factor 1: Total engagement (upvotes + comments across top posts)
  const totalScore = posts.reduce((sum, p) => sum + p.score, 0);
  const totalComments = posts.reduce((sum, p) => sum + p.numComments, 0);
  const engagementScore = Math.min(
    (Math.log10(Math.max(totalScore, 1)) / Math.log10(5000)) * 40,
    40
  );

  // Factor 2: Upvote ratio average (high ratio = community endorsement)
  const avgRatio = posts.reduce((sum, p) => sum + p.upvoteRatio, 0) / posts.length;
  const ratioScore = avgRatio * 30; // 0-30

  // Factor 3: Sentiment
  let sentimentScore = 15; // neutral default
  if (sentiment.summary === 'very positive') sentimentScore = 30;
  else if (sentiment.summary === 'positive') sentimentScore = 25;
  else if (sentiment.summary === 'mixed') sentimentScore = 15;
  else if (sentiment.summary === 'negative') sentimentScore = 5;
  else if (sentiment.summary === 'very negative') sentimentScore = 0;

  return Math.round(Math.min(engagementScore + ratioScore + sentimentScore, 100));
}

// ============================================================
// MAIN: SEARCH REDDIT FOR PRODUCT
// ============================================================

/**
 * Search Reddit for community signal on a product.
 *
 * @param {string} query - product search query
 * @param {string} [category] - product category (tv, camera, etc.)
 * @returns {Promise<object>} - { posts, sentiment, score, summary }
 */
async function searchReddit(query, category) {
  const subreddits = CATEGORY_SUBREDDITS[category] || CATEGORY_SUBREDDITS._default;

  // Build a focused search query that preserves key specs (size, brand, model)
  // Keep size/spec info so we don't return results for wrong sizes
  let searchQuery = query;
  if (searchQuery.length > 50) {
    // Preserve size specs (e.g. "55 inch", "27"") and brand, drop filler words
    const sizeMatch = searchQuery.match(/\b(\d{2,3})[\s-]*(inch|in|")\b/i);
    const sizePrefix = sizeMatch ? sizeMatch[0] + ' ' : '';
    const trimmed = searchQuery.split(' ').slice(0, 5).join(' ');
    searchQuery = sizePrefix ? sizePrefix + trimmed.replace(sizeMatch?.[0] || '', '').trim() : trimmed;
  }

  process.stderr.write(`  [reddit] Searching ${subreddits.length} subreddits for "${searchQuery}"...\n`);

  // Search top 3 subreddits in parallel (don't hammer Reddit)
  const searchPromises = subreddits.slice(0, 3).map(sub =>
    searchSubreddit(sub, searchQuery, { limit: 5, sort: 'relevance', time: 'year' })
  );

  const results = await Promise.allSettled(searchPromises);
  const allPosts = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allPosts.push(...result.value);
    }
  }

  if (allPosts.length === 0) {
    process.stderr.write('  [reddit] No posts found\n');
    return { posts: [], sentiment: { summary: 'no data' }, score: 0, summary: null };
  }

  // Sort by score (upvotes) and take top posts
  allPosts.sort((a, b) => b.score - a.score);
  const topPosts = allPosts.slice(0, 5);

  // Fetch comments from the top 2 posts for sentiment analysis
  const commentPromises = topPosts.slice(0, 2).map(p =>
    fetchTopComments(p.url, 8)
  );
  const commentResults = await Promise.allSettled(commentPromises);
  const allComments = [];
  for (const cr of commentResults) {
    if (cr.status === 'fulfilled') allComments.push(...cr.value);
  }

  // Combine post titles + selftexts + comments for sentiment
  const allText = [
    ...topPosts.map(p => p.title),
    ...topPosts.map(p => p.selftext).filter(Boolean),
    ...allComments,
  ];

  const sentiment = analyzeSentiment(allText);
  const score = communityScore(topPosts, sentiment);

  // Build human-readable summary
  const topPost = topPosts[0];
  const totalUpvotes = topPosts.reduce((sum, p) => sum + p.score, 0);
  const subNames = [...new Set(topPosts.map(p => p.subreddit))].slice(0, 2);

  let summary = '';
  if (totalUpvotes > 100) {
    summary = `${totalUpvotes.toLocaleString()} upvotes across r/${subNames.join(', r/')}`;
  } else if (topPosts.length > 0) {
    summary = `${topPosts.length} posts found on r/${subNames.join(', r/')}`;
  }

  if (sentiment.summary !== 'no signal' && sentiment.summary !== 'neutral') {
    // Find the most notable keyword that was detected
    const allTextJoined = allText.join(' ').toLowerCase();
    const notablePositive = POSITIVE_KEYWORDS.find(kw => allTextJoined.includes(kw));
    const notableNegative = NEGATIVE_KEYWORDS.find(kw => allTextJoined.includes(kw));
    if (sentiment.summary.includes('positive') && notablePositive) {
      summary += `, "${notablePositive}" in comments`;
    } else if (sentiment.summary.includes('negative') && notableNegative) {
      summary += `, "${notableNegative}" in comments`;
    } else {
      summary += `, sentiment: ${sentiment.summary}`;
    }
  }

  process.stderr.write(`  [reddit] ${topPosts.length} posts, score: ${score}/100, sentiment: ${sentiment.summary}\n`);

  return {
    posts: topPosts,
    sentiment,
    score,
    summary: summary || null,
    topPostUrl: topPost?.url || null,
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  searchReddit,
  searchSubreddit,
  fetchTopComments,
  analyzeSentiment,
  communityScore,
  CATEGORY_SUBREDDITS,
};
