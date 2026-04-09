---
name: amazon
description: Search and purchase products on Amazon via Chrome automation. Trigger words - amazon, order, buy, shopping, purchase, add to cart, order from amazon.
---

# Amazon Shopping Skill

Search, browse, and purchase products on Amazon using Chrome automation via `chrome-control`.

## Quick Start

```bash
# Search for a product
~/.claude/skills/amazon/scripts/amazon-search "ESP32-S3-BOX-3"

# Search within a category
~/.claude/skills/amazon/scripts/amazon-search "wireless earbuds" --category electronics
```

## Architecture

Based on the dj-buyer skill's Amazon purchase flow. Uses:
- **chrome-control** for all browser automation
- **axctl** for cross-origin iframe form filling (payment methods)
- **macOS Keychain** for credentials
- **scrapling** for search result parsing (fallback to chrome)

## Credentials

```bash
# Amazon account (Sven's account, NOT admin's)
security find-generic-password -s "assistant" -a "email" -w          # Email
security find-generic-password -s "amazon-password" -w               # Password

# Privacy.com payment card
security find-generic-password -a "sven" -s "privacy-card-number" -w
security find-generic-password -a "sven" -s "privacy-card-exp" -w    # MM/YY
security find-generic-password -a "sven" -s "privacy-card-cvv" -w
security find-generic-password -a "sven" -s "privacy-card-name" -w
```

## Search

### Via CLI script
```bash
~/.claude/skills/amazon/scripts/amazon-search "product name"
~/.claude/skills/amazon/scripts/amazon-search "product name" --category electronics
~/.claude/skills/amazon/scripts/amazon-search "product name" --max-results 5
```

Returns: title, price, rating, ASIN, URL for each result.

### Via Chrome (manual fallback)
```bash
chrome open "https://www.amazon.com/s?k=SEARCH+TERMS"
chrome text <tab>   # Read results
chrome js <tab> "JSON.stringify([...document.querySelectorAll('[data-asin]')].filter(e=>e.dataset.asin).slice(0,5).map(e=>({asin:e.dataset.asin,title:e.querySelector('h2')?.textContent?.trim(),price:e.querySelector('.a-price .a-offscreen')?.textContent})))"
```

### Category values for search
- `electronics` — Electronics & Computers
- `computers` — Computers & Accessories
- `home` — Home & Kitchen
- `tools` — Tools & Home Improvement
- `books` — Books
- `music` — Digital Music
- `toys` — Toys & Games
- `office` — Office Products
- `garden` — Patio, Lawn & Garden
- (default: all departments)

## Purchase Flow

### Safety Rules

1. **ALWAYS show the product + price and get explicit confirmation before buying**
2. **Price guardrail**: STOP and confirm if total > $50
3. **Clear cart first** before every purchase to prevent cart contamination
4. **Dry-run by default**: Show what would be purchased, then ask to proceed

### Pre-flight

```bash
# 1. Clear the cart
chrome navigate <tab> "https://www.amazon.com/gp/cart/view.html"
# Delete any existing items to prevent checkout hijacking

# 2. Verify product page
chrome navigate <tab> "https://www.amazon.com/dp/<ASIN>"
chrome text <tab>  # Confirm product name + price
```

### Step 1: Add to Cart

```bash
chrome click-by-name <tab> "Add to Cart"
# Wait 2-3 seconds
# May see "Added to Cart" confirmation or upsell page
```

If product options (size, color, etc.) need selecting first:
```bash
chrome text <tab>  # Read available options
chrome click-by-name <tab> "<option_value>"
```

### Step 2: Proceed to Checkout

```bash
chrome click-by-name <tab> "Proceed to checkout"
# OR navigate directly:
chrome navigate <tab> "https://www.amazon.com/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1"
# Wait 3-5 seconds
```

### Step 3: Sign In (if needed)

```bash
chrome text <tab>  # Look for "Sign in" or password prompt
```

If sign-in required:
```bash
# Enter email
chrome iframe-click <tab> "#ap_email"
chrome insert-text <tab> "$(security find-generic-password -s assistant -a email -w)"
chrome js <tab> "document.querySelector('#continue')?.click()"
# Wait 2 seconds

# Enter password
chrome iframe-click <tab> "#ap_password"
chrome insert-text <tab> "$(security find-generic-password -s amazon-password -w)"
chrome js <tab> "document.querySelector('#signInSubmit')?.click()"
# Wait 3 seconds
```

**NOTE**: `click-by-name "Sign in"` may hit heading text, not the submit button. Use `chrome js` with querySelector.

Amazon may prompt "Keep hackers out" (phone verification) — skip it:
```bash
chrome click-by-name <tab> "Not now"
```

### Step 4: Review Order

```bash
chrome text <tab>  # Check: shipping address, payment method, order total
```

Verify:
- Right product and quantity
- Reasonable price (< $50 guardrail)
- Correct shipping address
- Correct payment method

### Step 5: Place Order

```bash
chrome click-by-name <tab> "Place your order"
# Wait 5-10 seconds
```

If billing address error:
```bash
chrome click-by-name <tab> "Continue"  # Usually works on retry
```

Success page shows: **"Order placed, thank you!"**

### Step 6: Confirm

```bash
chrome text <tab>  # Get order number + delivery estimate
```

Report: order number, estimated delivery, total charged.

## Digital Music Purchases (from dj-buyer)

For MP3/digital music, use the streamlined flow:

```bash
chrome navigate <tab> "https://www.amazon.com/dp/<ASIN>"
chrome click-by-name <tab> "Purchase Options"
# Wait 1 second
chrome click-by-name <tab> "MP3 Music"
# Wait 3 seconds
chrome click-by-name <tab> "Buy MP3 Song - Pay Now"
# Wait 5 seconds
chrome click-by-name <tab> "Download"
```

## Payment Method Management

### Adding a payment card

Card form is in a cross-origin secure iframe — cannot fill via `chrome js`.

```bash
chrome navigate <tab> "https://www.amazon.com/cpe/yourpayments/wallet"
# Click "Add a payment method" -> "Add a credit or debit card"

# Use axctl for cross-origin iframe
CARD_NUM=$(security find-generic-password -a "sven" -s "privacy-card-number" -w)
CARD_CVV=$(security find-generic-password -a "sven" -s "privacy-card-cvv" -w)
CARD_NAME=$(security find-generic-password -a "sven" -s "privacy-card-name" -w)

axctl type "Google Chrome" --title "Card number" "$CARD_NUM"
axctl type "Google Chrome" --title "Name on card" "$CARD_NAME"
axctl type "Google Chrome" --role AXTextField --index 4 "$CARD_CVV"
```

Expiration dropdowns require coordinate clicking:
```bash
axctl get "Google Chrome" --title "Expiration date" AXPosition
cliclick c:<center_x>,<center_y>  # Open dropdown
axctl search "Google Chrome" --role AXMenuItem
cliclick c:<item_x>,<item_y>  # Select month/year
```

### Account Hold Recovery

If account goes on hold ("Account on hold temporarily"):
1. Go to `https://account-status.amazon.com/`
2. Upload Privacy.com statement screenshot
3. Wait ~5 hours for review
4. After lift: re-add payment card + billing address (they get wiped)

## Troubleshooting

### Anti-bot detection
- Use `chrome` (real browser) not scrapling for purchase flows
- Wait 2-3 seconds between actions
- If CAPTCHA appears, screenshot and solve manually

### Cart contamination
Always clear cart before purchasing. Stale items hijack checkout.

### "Something went wrong" on checkout
Re-sign in and retry. Payment method may need re-adding.

### click-by-name hits wrong element
Use `chrome js` with `document.querySelector()` as fallback.

### Prime upsell interstitial ("Try Prime" / "Add a Prime membership")

After clicking "Add to Cart", Amazon sometimes shows a full-page Prime upsell instead of the cart confirmation. This blocks the checkout flow.

**Primary path** — click by name (try these in order):
```bash
chrome click-by-name <tab> "No thanks"
# OR
chrome click-by-name <tab> "Continue without Prime"
```

**JS fallback** (if click-by-name fails):
```bash
chrome js <tab> "document.querySelector('[data-action=\"prime-upsell-decline\"], [id*=\"no-thanks\"], [id*=\"noThanks\"]')?.click()"
```

**Note:** After every "Add to Cart", check for Prime upsell and dismiss before proceeding to checkout. This interstitial has been seen multiple times during Roomba parts checkout.
