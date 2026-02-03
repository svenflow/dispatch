---
name: whatsnew
description: Research trending topics and recent discussions from Reddit and X/Twitter. Use when asked about what's new, trending, or recent discussions on a topic.
---

# What's New - Trend Research Skill

Research recent trends and discussions on any topic using web search. No API keys needed.

## How to Use

When user asks about trends or what's new on a topic:

### 1. Search Reddit Discussions

```
WebSearch: "[TOPIC] reddit discussions January 2026"
WebSearch: "[TOPIC] reddit recommendations 2026"
```

Note: Don't use `site:reddit.com` - regular search finds Reddit content better.

Look for:
- Popular threads (high upvote discussions)
- Common questions and pain points
- Recommended solutions/products
- Emerging patterns or techniques

### 2. Search X/Twitter Discussions

```
WebSearch: "[TOPIC] twitter trending January 2026"
WebSearch: "[TOPIC] viral tweet 2026"
```

Note: Don't use `site:twitter.com` - Twitter blocks crawlers. Regular search finds tweet content in news coverage.

Look for:
- Viral tweets and discussions
- Expert opinions
- Breaking news/announcements
- Community reactions

### 3. Search General Web (recent)

```
WebSearch: "[TOPIC] 2026"
WebSearch: "[TOPIC] January 2026 news"
```

Look for:
- News articles
- Blog posts
- Product announcements
- Best practices updates

## Output Format

Present findings as:

### What's Trending
- **Pattern 1**: [Description with examples]
- **Pattern 2**: [Description with examples]
- **Pattern 3**: [Description with examples]

### Key Discussions
- [Thread/post title] - [Brief summary of consensus]

### Notable Mentions
- Specific products, tools, or techniques that came up repeatedly

### Actionable Takeaways
- Bullet points the user can act on

## Example Queries

- "What's new with Claude Code?"
- "Trending AI image generation techniques"
- "Recent discussions about React Server Components"
- "What are people saying about the new MacBook?"

## Tips

- Adjust date filter based on topic freshness needs
- For fast-moving topics, narrow to last 7 days
- For stable topics, expand to last 90 days
- Weight Reddit/Twitter higher for community sentiment
- Weight news sites higher for announcements

## Date Handling

Include the current month/year in searches to get recent content:
- Use "January 2026" or "2026" to filter for recent
- For very recent: "this week" or "past week"
- Mention "trending" or "viral" to surface high-engagement content
