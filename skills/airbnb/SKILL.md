---
name: airbnb
description: Search and browse Airbnb listings using Chrome automation. Use when asked to find vacation rentals, Airbnbs, or places to stay. Checks contact preferences for accommodation requirements.
---

# Airbnb Search Skill

## CRITICAL: NEVER PURCHASE WITHOUT EXPLICIT PERMISSION
**Do NOT book or reserve any Airbnb under any circumstances unless you have EXPLICIT permission from the user.** Only search, browse, and share options - never click "Reserve" or complete any booking.

Search for Airbnb listings using Chrome browser automation. **Always check contact preferences first** for accommodation requirements like pet-friendly, accessibility needs, etc.

## Before Searching

**CRITICAL: Check contact notes for preferences!**
```bash
~/.claude/skills/contacts/scripts/contacts notes "Contact Name"
```

Common preferences to look for:
- Pet/dog friendly requirements
- Accessibility needs
- Preferred amenities
- Budget constraints

## Search URL Structure

Base URL: `https://www.airbnb.com/s/{location}/homes`

### Common Filter Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `amenities[]=25` | Hot tub | Required for hot tub |
| `amenities[]=12` | Allows pets | Required for dog-friendly |
| `amenities[]=46` | Pool | Outdoor pool |
| `min_bedrooms=X` | Minimum bedrooms | `min_bedrooms=3` |
| `min_bathrooms=X` | Minimum bathrooms | `min_bathrooms=2` |
| `min_beds=X` | Minimum beds | `min_beds=6` |
| `host_badge[]=superhost` | Superhosts only | Trusted hosts |
| `category_tag=Tag:8536` | Amazing views | Category filter |

### Example Search URLs

**Dog-friendly with hot tub, 3+ bedrooms, 3+ baths:**
```
https://www.airbnb.com/s/Jiminy-Peak--Hancock--MA/homes?amenities%5B%5D=25&amenities%5B%5D=12&min_bedrooms=3&min_bathrooms=3
```

**Pet-friendly near ski resort:**
```
https://www.airbnb.com/s/Stowe--VT/homes?amenities%5B%5D=12&amenities%5B%5D=25
```

## Chrome Commands

```bash
CHROME=~/.claude/skills/chrome-control/scripts/chrome

# Open search
$CHROME open "https://www.airbnb.com/s/Location/homes?amenities..."

# List tabs to find Airbnb tab
$CHROME tabs

# Read page elements (to find filter buttons, listings)
$CHROME read <tab_id>

# Click on listings or filter buttons
$CHROME click <tab_id> ref_XX

# Take screenshot
$CHROME screenshot <tab_id>
```

## Checking Listing Details

### Pet Policy
1. Open listing page
2. Click "Learn more" under House Rules (usually ref_200 area)
3. Look for "Pets allowed" or "No pets" in the rules

### Amenities (Game Room, Pool Table, etc.)
1. Click "Show all XX amenities" button
2. Scroll through or use WebFetch on listing URL to extract amenities
3. Note: Airbnb doesn't have a "game room" filter - must check each listing manually

### Available Dates & Pricing
- Dates shown in calendar on listing page
- Price displayed (e.g., "$2,619 for 5 nights")
- Look for "These dates are priced lower than usual" for deals

## Workflow

1. **Check contact preferences** for any requirements
2. **Build search URL** with appropriate filters
3. **Open in Chrome** and take screenshot of results
4. **Click through top listings** to verify:
   - Pet policy (if needed)
   - Specific amenities (game room, etc.)
   - Available dates
   - Pricing
5. **Send screenshots and links** to the group/user
6. **Provide summary** with key details for each option

## Common Issues

### Game Room Filter
Airbnb doesn't have a dedicated game room/pool table filter. To find listings with game rooms:
1. Search with other filters first (pets, hot tub, beds, baths)
2. Use WebSearch to find specific listings: `Airbnb [location] "pool table" OR "game room" hot tub`
3. Check each listing's amenities manually

### Listing No Longer Available
If you get a 404 error, the listing has been removed. Search for alternatives.

### Pets vs No Pets Conflict
Many higher-end properties with game rooms don't allow pets. May need to:
- Suggest bringing portable games instead
- Search broader area
- Ask user to prioritize requirements

## Sending Results

**IMPORTANT: Always send each listing as a SEPARATE message** so the Airbnb link generates an image preview in iMessage. Never combine multiple listings in one message.

### Listing Format Template
Use this exact format for each listing:
```
[NUMBER]. [NAME] [DISCOUNT]% OFF
$[ORIGINAL] → $[DISCOUNTED] ([X] nights)
[X] bed / [X] bath / [X] beds / [X] guests
📍 [Location] (~[X] min to [Mountain])
🎱 Game room: [YES (details) / No]
🐕 Dogs: [YES / No]
♨️ Hot tub: [YES / No] [+ extras like Sauna]
⭐ [X.X] rating ([X] reviews) [- Guest fav! if applicable]

https://www.airbnb.com/rooms/[LISTING_ID]
```

### Example Message
```
1. SKI & PLAY LUXURY ⭐ 67% OFF
$10,235 → $3,375 (5 nights)
4 bed / 4 bath / 7 beds
📍 ~10 min to Mt Snow
🎱 Game room: Pool table + Poker setup
🐕 Dogs: YES
♨️ Hot tub: YES
⭐ 5.0 rating (14 reviews)

https://www.airbnb.com/rooms/1517400814989647185
```

### Required Info Per Listing
Always include:
- **Discount %** and price (original → discounted)
- **Beds/baths/guests**
- **Distance to mountain** (check listing description or estimate from town)
- **Game room**: YES with specifics (pool table, air hockey, etc.) or No
- **Dogs**: YES or No (verify in House Rules)
- **Hot tub**: YES or No (plus sauna/pool if available)
- **Rating** and review count
- **Full Airbnb URL** (not shortened) - this generates the preview!

### SMS Commands
```bash
# Send to group chat
~/.claude/skills/sms-assistant/scripts/send-sms -g "GROUP_ID" "message"

# Send to individual
~/.claude/skills/sms-assistant/scripts/send-sms "+1234567890" "message"
```

### Send Images (optional)
```bash
osascript <<'EOF'
set imagePath to "/path/to/screenshot.jpg"
set chatId to "GROUP_ID"
tell application "System Events"
    set theFile to (POSIX file imagePath) as alias
end tell
tell application "Messages"
    repeat with aChat in chats
        if id of aChat contains chatId then
            send theFile to aChat
            exit repeat
        end if
    end repeat
end tell
EOF
```

## Key Learnings

1. **Always verify pet policy** in House Rules - don't assume from search filters
2. **Hot tub filter (amenity 25)** is reliable
3. **Pet filter (amenity 12)** works but always double-check House Rules
4. **Game room amenities** must be checked manually - no filter exists
5. **Take screenshots** of listings for easy sharing
6. **Include links** so users can book directly
