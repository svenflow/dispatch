---
name: passwords
description: Store and retrieve passwords/credentials using macOS Keychain. Trigger words - password, keychain, credentials, secrets, login.
---

# Passwords Skill

All my credentials are stored in macOS Keychain using the `security` CLI. This is the standard secure storage on macOS.

## Stored Credentials

### Account Credentials
| Service | Account | Purpose |
|---------|---------|---------|
| `google-account` | nicklaudethorat@gmail.com | My Google/Gmail account |
| `apple-id-password` | sven | My iCloud/Apple ID |

### API Keys & Secrets
| Service | Purpose |
|---------|---------|
| `google-api-key` | Google Cloud API key |
| `google-oauth-client-id` | OAuth client ID for gogcli |
| `google-oauth-client-secret` | OAuth client secret for gogcli |
| `modal-token-id` | Modal.com API token ID |
| `modal-token-secret` | Modal.com API token secret |

### Payment Card (Privacy.com)
| Service | Purpose |
|---------|---------|
| `privacy-card-number` | Virtual card number |
| `privacy-card-exp` | Expiration date |
| `privacy-card-cvv` | CVV code |

## CLI Usage

### Retrieve a password
```bash
security find-generic-password -s "service-name" -w
```

Examples:
```bash
# Get Google password
security find-generic-password -s "google-account" -w

# Get Apple ID password
security find-generic-password -s "apple-id-password" -w

# Get card number
security find-generic-password -s "privacy-card-number" -w
```

### Store a new password
```bash
security add-generic-password -a "account" -s "service-name" -w "password" -U
```
The `-U` flag updates if it already exists.

### List all my services
```bash
security dump-keychain | grep 'svce' | grep -oP '(?<="svce"<blob>=").*(?=")'
```

### Delete a password
```bash
security delete-generic-password -s "service-name"
```

## Security Notes

- **NEVER put actual passwords in code or skill files** - always retrieve from keychain at runtime
- **NEVER log or echo passwords** - only use them in secure contexts
- Keychain is encrypted and requires system login to access
