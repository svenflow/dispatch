---
name: dj-buyer
description: Search and purchase DJ tracks from Bandcamp, Beatport, and Amazon Music using scrapling. Trigger words - dj, track, buy track, search track, bandcamp, beatport, amazon music, purchase music, dj buyer, find track.
---

# DJ Buyer

Search for and purchase DJ tracks across Bandcamp, Beatport, and Amazon Music. Search uses `scrapling.Fetcher` (HTTP with TLS fingerprinting). Purchase uses `scrapling.StealthyFetcher` (headless Playwright browser via patchright) for full checkout automation.

**Project**: `~/code/dj-buyer/`
**Run all commands with**: `cd ~/code/dj-buyer && uv run dj-buyer <command>`

## Search Workflow

**Always search ALL 3 platforms, then rerank by price and similarity to find the best deal.**

```bash
cd ~/code/dj-buyer && uv run dj-buyer search-bandcamp "Artist" "Title" --json
cd ~/code/dj-buyer && uv run dj-buyer search-beatport "Artist" "Title" --json
cd ~/code/dj-buyer && uv run dj-buyer search-amazon "Artist" "Title" --json
```

Or search all at once: `cd ~/code/dj-buyer && uv run dj-buyer search "Artist" "Title"`

### How to Rerank Results

After collecting results from all 3 platforms:

1. **Filter**: Drop anything with similarity < 0.7
2. **Verify**: For similarity 0.7-0.9, manually check artist+title match
3. **Cover detection**: Bandcamp is indie/electronic-focused. When searching mainstream artists, results are frequently covers by different artists with misleadingly high title similarity (0.7+). If the Bandcamp result artist doesn't match the search artist, skip it even if title similarity is high. Prefer Beatport or Amazon for major-label tracks.
4. **Platform preference**: Always prefer Bandcamp or Beatport over Amazon. Only use Amazon if the track doesn't exist on either Bandcamp or Beatport.
5. **Price rank** (within preferred platforms): Bandcamp name-your-price ($0) > Bandcamp minimum ($1) > Beatport MP3 ($1.49) > Beatport WAV ($2.49)
6. **DJ quality tiebreak**: If prices are close, prefer Beatport (best metadata + artwork)
7. **Amazon fallback**: Only purchase from Amazon ($1.29) when the track is unavailable on both Bandcamp and Beatport

See `search/bandcamp.md`, `search/beatport.md`, `search/amazon.md` for platform-specific matching guidance.

## Purchase Workflow

**Purchase from ONE platform** — whichever had the best match at the best price.

```bash
cd ~/code/dj-buyer && uv run dj-buyer purchase-bandcamp <url> --email "email@example.com" [--price 1.00] [--dry-run]
cd ~/code/dj-buyer && uv run dj-buyer purchase-beatport <url> [--format mp3|wav] [--email "email"] [--dry-run]
cd ~/code/dj-buyer && uv run dj-buyer purchase-amazon <url> [--dry-run]
```

**Always `--dry-run` first** to verify pricing before committing.

### Bandcamp Purchase Flow (Fully Automated)

Uses `StealthyFetcher` (headless browser) for end-to-end checkout:

1. Opens track page, removes `<page-footer>` overlay that blocks clicks
2. Clicks "Buy Digital Track" button (`button.buy-link`)
3. Sets price in `#userPrice` input
4. Clicks "Check out now" button
5. Selects credit card payment (`#pick-credit-card`)
6. Clicks "Proceed to payment" (`button.proceed`)
7. Navigates to `bandcamp.com/cart/checkout` page
8. Fills card number in **Spreedly** iframe (`iframe[id^='spreedly-number-frame']`)
9. Sets expiry month/year dropdowns (`#Ecom_Payment_Card_ExpDate_Month/Year`)
10. Fills CVV in Spreedly iframe (`iframe[id^='spreedly-cvv-frame']`)
11. Fills billing info (name, email, country, ZIP)
12. Clicks "Complete purchase" (`button.button-blue`)

**Card details**: Retrieved from macOS Keychain (`privacy-card-number`, `privacy-card-exp`, `privacy-card-cvv`)

**Key selectors**:
- Buy button: `button.buy-link` with text "Buy Digital Track"
- Page-footer overlay: MUST remove `document.querySelector("page-footer").remove()` or clicks timeout
- Spreedly iframes: Use `page.frame_locator()` to access card inputs inside iframes
- Checkout form IDs: `Ecom_BillTo_Postal_Name_First/Last`, `Ecom_ReceiptTo_Online_Email`, `Ecom_BillTo_Postal_PostalCode`

**Note**: Bandcamp uses Spreedly (not Stripe) for payment processing. The Stripe iframe present on page is only for metrics, not payment.

### Beatport Purchase Flow (Requires Login)

Uses `StealthyFetcher` for browser automation:

1. Opens track page, clicks `$X.XX` price button (`AddToCart-style__PriceButton`)
2. Login modal appears → clicks "Log In" → fills email/password → submits
3. Re-adds to cart after login
4. Navigates to cart page → checkout

**Credentials**: Stored in macOS Keychain:
```bash
security add-generic-password -a "sven" -s "beatport-email" -w "EMAIL" -U
security add-generic-password -a "sven" -s "beatport-password" -w "PASS" -U
```

### Amazon Purchase Flow

Uses Chrome extension CLI for browser automation (user must be logged into Amazon in Chrome).

## Scrapling Architecture

- **`Fetcher`**: HTTP-only with TLS fingerprinting. Used for search. Access HTML via `response.html_content` (NOT `.text`).
- **`StealthyFetcher`**: Headless browser via patchright (Playwright fork). Used for purchases.
  - `page_action` parameter takes a **sync** function (NOT async) that receives the Playwright `page` object
  - Supports `page.frame_locator()` for interacting with iframes (Spreedly, Stripe)
  - `force=True` on clicks bypasses actionability checks (useful for overlaid elements)
  - Deps: `patchright`, `msgspec` (auto-installed via uv)

**CRITICAL: Use `response.html_content` not `response.text`.** Scrapling's `Fetcher` returns empty string for `.text` but the actual HTML is in `.html_content` (decoded from `.body` bytes).

## Payment Card Details

Stored in macOS Keychain (Privacy.com virtual card):
```bash
security find-generic-password -a "sven" -s "privacy-card-number" -w
security find-generic-password -a "sven" -s "privacy-card-exp" -w    # MM/YY format
security find-generic-password -a "sven" -s "privacy-card-cvv" -w
```

**Note**: Privacy.com card may need Bandcamp/Beatport added as approved merchants, or spending limits adjusted, for transactions to succeed.

## Spotify Integration

The daemon watches a Spotify playlist for new tracks and auto-searches all platforms.

```bash
cd ~/code/dj-buyer && uv run dj-buyer list-tracks <playlist_id>
cd ~/code/dj-buyer && uv run dj-buyer poll
cd ~/code/dj-buyer && uv run dj-buyer auth   # Re-auth if token expired
```

Current playlist: `162TAg29u887r6VksnVf5d` (configured in `config.toml`)

### Spotify Token Management

**Token storage**: Access token, refresh token, and expiry are in `~/code/dj-buyer/state.db` (table: `spotify_auth`). Refresh token is also backed up to macOS Keychain under service `spotify-refresh-token`, account `dj-buyer`.

**Auto-refresh**: `get_spotify_client()` automatically refreshes the access token when it's within 5 minutes of expiry using the stored refresh token. No manual intervention needed.

**Token health check**: Before running Spotify operations in background/ephemeral tasks, validate the token first. The re-auth flow requires manual SMS URL exchange which breaks in background contexts (exit code 144 / SIGTERM timeout). If the token is expired and refresh fails, proactively notify admin via SMS with the re-auth URL rather than silently failing. Don't attempt full re-auth in background tasks.

**Refresh token recovery from keychain**:
```bash
security find-generic-password -a "dj-buyer" -s "spotify-refresh-token" -w
```

### Spotify Re-auth Flow (when refresh token is revoked)

The redirect URI registered in the Spotify app is `http://127.0.0.1:5432/api/spotify_callback` (shared with playlist-manager, same client_id `43d9bf46f34d48bb80cc23803c8db2a8`). **CRITICAL: Must use `127.0.0.1` not `localhost` — Spotify checks exact URI match.**

When the refresh token is revoked and you need fresh auth:

1. Generate the auth URL and send it to the admin via SMS:
   ```bash
   cd ~/code/dj-buyer && uv run python -c "
   from src.dj_buyer.config import Config
   from src.dj_buyer.spotify.auth import get_auth_url
   print(get_auth_url(Config.load()))
   "
   ```
2. Admin opens URL on their phone browser and logs into Spotify
3. After authorizing, Spotify redirects to `http://127.0.0.1:5432/api/spotify_callback?code=XXX` which won't load on phone
4. Admin copies the full redirect URL from their phone's address bar and pastes it back via SMS
5. Extract the `code=` parameter and exchange it for tokens:
   ```bash
   CLIENT_SECRET=$(cd ~/code/dj-buyer && uv run python -c "from src.dj_buyer.config import get_spotify_secret; print(get_spotify_secret())")
   CREDS=$(echo -n "43d9bf46f34d48bb80cc23803c8db2a8:$CLIENT_SECRET" | base64)
   curl -s -X POST "https://accounts.spotify.com/api/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -H "Authorization: Basic $CREDS" \
     -d "grant_type=authorization_code&code=AUTH_CODE&redirect_uri=http://127.0.0.1:5432/api/spotify_callback"
   ```
6. Save tokens to state.db and keychain:
   ```bash
   EXPIRES_AT=$(($(date +%s) + 3600))
   sqlite3 ~/code/dj-buyer/state.db "DELETE FROM spotify_auth; INSERT INTO spotify_auth (access_token, refresh_token, expires_at) VALUES ('ACCESS_TOKEN', 'REFRESH_TOKEN', $EXPIRES_AT);"
   security add-generic-password -a "dj-buyer" -s "spotify-refresh-token" -w "REFRESH_TOKEN" -U
   ```

**Important**: The refresh token doesn't expire on its own — only if the user revokes access or the app credentials change. Once you have it, auto-refresh handles everything.

## Known Bugs (Fixed)

- **DB path bug**: `db.py` had `Path(__file__).parent.parent.parent.parent` (4 parents → `~/code/`) instead of `.parent.parent.parent` (3 parents → `~/code/dj-buyer/`). This caused it to read/write a stale `~/code/state.db` instead of the correct `~/code/dj-buyer/state.db`.
- **Redirect URI mismatch**: The Spotify app has `http://127.0.0.1:5432/api/spotify_callback` registered (from playlist-manager). The dj-buyer auth code originally used `http://localhost:5432/callback` which caused "INVALID_CLIENT: Invalid redirect URI" errors.
- **Bandcamp /cart/add 404**: Bandcamp's old cart API `/cart/add` returns 404. The real endpoint is `/cart/cb` with form-encoded data including `req=add`, `client_id`, `item_type` (short: `t`/`a`/`p`), `item_id`, `unit_price`, `band_id`.
- **Bandcamp page-footer intercepts clicks**: The `<page-footer>` web component covers buy buttons and intercepts pointer events. Must remove via JS before clicking.
- **Beatport internal API**: `api-internal.beatportprod.com` blocks external HTTP requests. Must use browser automation instead.
- **StealthyFetcher page_action sync**: The `page_action` callback must be a **sync** function, not async. Async functions silently fail.

## Config

`~/code/dj-buyer/config.toml`:
- `search.max_price = 15.00` — skip anything over this
- `search.min_similarity = 0.7` — minimum fuzzy match score
- `search.platforms = ["beatport", "bandcamp", "amazon"]`
- `search.preferred_format = "mp3"`
