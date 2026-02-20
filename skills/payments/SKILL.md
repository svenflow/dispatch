---
name: payments
description: Make online purchases using stored Privacy.com virtual card. Use when buying things online, checking out, making payments, or needing credit card details. Trigger words - buy, purchase, checkout, pay, credit card, payment.
---

# Payments Skill

Make online purchases using Sven's Privacy.com virtual card stored in macOS Keychain.

## Sven's Credentials (macOS Keychain)

All of Sven's account credentials are stored in macOS Keychain:

```bash
# Google account
security find-generic-password -s "google-account" -w

# Apple ID / iCloud password
security find-generic-password -s "apple-id-password" -w
# (email is in ~/.claude/secrets.env as APPLE_ID_EMAIL)
```

## Card Details Location

Card details are stored securely in macOS Keychain:

```bash
# Get card number
security find-generic-password -a "sven" -s "privacy-card-number" -w

# Get expiration date
security find-generic-password -a "sven" -s "privacy-card-exp" -w

# Get CVV
security find-generic-password -a "sven" -s "privacy-card-cvv" -w
```

## Card Information

- **Type:** Privacy.com virtual card
- **Cardholder:** Sven (the assistant)
- **Limits:** Set by admin in Privacy.com dashboard

## Usage Guidelines

### Before Making a Purchase

1. **Always confirm with admin** before making any purchase
2. Check the card's spending limit in Privacy.com if needed
3. Verify the merchant is legitimate

### Making a Purchase

```bash
# Retrieve card details
CARD_NUM=$(security find-generic-password -a "sven" -s "privacy-card-number" -w)
CARD_EXP=$(security find-generic-password -a "sven" -s "privacy-card-exp" -w)
CARD_CVV=$(security find-generic-password -a "sven" -s "privacy-card-cvv" -w)

# Format card number with spaces for display
echo "${CARD_NUM:0:4} ${CARD_NUM:4:4} ${CARD_NUM:8:4} ${CARD_NUM:12:4}"
```

### Billing Address

Use the admin's billing address (check Contacts.app or ask admin).

## Security Rules

1. **Never log or display full card details** in responses to non-admin users
2. **Never share card details** with third parties or other sessions
3. **Only use for purchases explicitly approved by admin**
4. **Report any suspicious charges** to admin immediately

## Privacy.com Features

This card has these protections:
- Spending limits (total, per-transaction, monthly)
- Can be paused/closed anytime
- Single-merchant locking available
- Real-time transaction notifications

## Updating Card Details

If the card is replaced or updated:

```bash
# Update card number
security add-generic-password -a "sven" -s "privacy-card-number" -w "NEW_NUMBER" -U

# Update expiration
security add-generic-password -a "sven" -s "privacy-card-exp" -w "MM/YY" -U

# Update CVV
security add-generic-password -a "sven" -s "privacy-card-cvv" -w "XXX" -U
```
