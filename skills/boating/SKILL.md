---
name: boating
description: Freedom Boat Club (FBC) CLI for reservations, locations, boats, member profile. Trigger words - boat, boating, FBC, Freedom Boat Club, reservation, marina.
---

# Freedom Boat Club (FBC) Skill

CLI for interacting with the Freedom Boat Club reservation system.

## CLI Location

`~/.claude/skills/boating/scripts/fbc`

## Commands

```bash
fbc me                                # Show member profile
fbc reservations [--all]              # Show upcoming (or all) reservations
fbc locations [--query TEXT]          # List/search locations
fbc available <location-id> <date>   # Show available boats at a location
```

## Credentials

Stored in macOS Keychain under service `freedom-boat-club`. Retrieve via:
```bash
security find-generic-password -s freedom-boat-club -w        # password
security find-generic-password -s freedom-boat-club -g        # full entry (acct = email)
```

## API Endpoints

Base: `https://reservations.freedomboatclub.com/bin/brunswick/fbc-reservations/api.json`

| Endpoint | Returns |
|----------|---------|
| `/clubs` | 132 clubs (locations field is always `null`) |
| `/locations` | 452 locations (each includes parent club object) |
| `/users/{objectId}` | Full member profile |
| `/reservations?startDate=YYYY-MM-DD&membershipId=ID&orderBy=startDate&orderByAsc=true&offset=0&limit=50` | Reservations |
| `/reservations/availability?locationId=ID&date=YYYY-MM-DD&membershipId=ID` | Boat availability |

User endpoint (different path): `https://reservations.freedomboatclub.com/bin/brunswick/fbc-reservations/user`

Authentication is cookie-based via zendriver browser login to `https://boatreservations.freedomboatclub.com/`. After login, API calls use `fetch()` from the browser context.

## Key IDs

### Greater Boston and Cape Cod Club
- **Club ID**: `a0c5Y00000ByPpDQAV`
- **Club Name**: FBC of Greater Boston and Cape Cod

### Boston-area Locations

| Location | ID | Address |
|----------|-----|---------|
| Boston - Seaport Fan Pier (primary) | `a0c5Y00000ByPyuQAF` | 1 Marina Park Drive, Boston MA 02210 |
| Charlestown | `a0c5Y00000ByPuyQAF` | 1 8th St, Pier 6, Charlestown MA 02129 |
| East Boston | `a0c5Y00000GXa2cQAD` | 256 Marginal Street, Boston MA 02128 |

## Dock Phone Numbers (Greater Boston & Cape Cod)

| Location | Phone |
|----------|-------|
| Beverly | 978-580-7708 |
| Boston - Seaport Fan Pier | 617-981-0114 |
| Cataumet | 978-954-1456 |
| Charlestown | 617-990-6687 |
| Chatham | 774-212-7231 |
| East Boston | 617-599-6264 |
| East Dennis - Sesuit | 774-212-1547 |
| Fairhaven | 508-951-6609 |
| Fall River | 508-837-2753 |
| Falmouth | 978-935-3923 |
| Hingham | 978-935-1013 |
| Hull | 774-699-1025 |
| Marshfield | 978-551-4618 |
| Onset | 781-563-0042 |
| Plymouth | 781-563-4327 |
| Provincetown | 774-205-0187 |
| Quincy | 617-386-0081 |
| Scituate | 339-236-9580 |
| Skippy's - Yarmouth | 508-776-4837 |
| South Hadley | 413-207-4100 |
| West Dennis - Bass River | 774-212-4226 |

**Admin Office**: 20 Cantor Court, Plymouth MA 02360 — 508-398-3221
**Billing**: billing@freedomboatclub.com
**Training**: membertraining@freedomboatclub.com

## 2026 Massachusetts Season

Massachusetts locations are seasonal. Opening dates for 2026:

| Location | Reservations Open | First Day | Closed Days |
|----------|------------------|-----------|-------------|
| Quincy | 4/20 | 4/23 (Thu) | N/A |
| East Dennis | 4/20 | 4/23 (Thu) | N/A |
| Falmouth | 4/20 | 4/30 (Thu) | N/A |
| Beverly | 4/20 | 4/30 (Thu) | Mon, May 4/11/18 |
| Hingham | 4/20 | 5/1 (Fri) | Wed, May 6/13/20/27 |
| Fan Pier Boston | 4/30 | 5/5 (Tue) | N/A |
| West Dennis | 4/30 | 5/5 (Tue) | Wed, May 13/20/27 |
| Onset | 4/30 | 5/8 (Fri) | Tue, May 12/19/26 |
| Charlestown | 4/30 | 5/8 (Fri) | Wed, May 13/20/27 |
| Plymouth | 4/30 | 5/12 (Tue) | N/A |
| Hull | 4/30 | 5/12 (Tue) | Mon, May 18 |
| East Boston | 4/30 | 5/13 (Wed) | Mon/Tue, May 18/19/26 |
| Scituate | 5/1 | 5/14 (Thu) | Tue, May 19/26 |
| Chatham | 5/1 | 5/14 | Mon/Tue, May 18/19 |
| Cataumet | 5/1 | 5/15 | Wed, May 20/27 |
| Fall River | 5/1 | 5/15 | Tue, May 19/26 |
| Fairhaven | 5/11 | 5/21 (Thu) | Wed, May 27 |
| Provincetown | 5/11 | 5/21 (Thu) | N/A |
| Skippy's-Yarmouth | 5/11 | 5/21 | N/A |
| Marshfield | TBD | TBD | TBD |

## 2026 Season Announcements

### FBC Elite Membership (NEW)
- $799 + tax/month upgrade
- 6 advance reservations (vs 4 on Freedom tier)
- Up to 3 weekend reservations
- All Amenity Boats included
- $2,000 upgrade fee waived for first 50 members by May 15, 2026

### Additional Driver Option (NEW)
- $999 + tax one-time
- Add co-member as authorized driver on your membership
- Must complete 3-step training
- Cannot make reservations independently

### FBC Plus Deductible Reduction Program
- $799/year
- Reduces Physical Damage and Liability deductible from $2,500 each to $0

### MA Boating Law - Hanson Milone Act
- Effective April 1, 2026
- All operators must have NASBLA-approved boating safety certificate
- Must carry it on the water (digital or printed)
- Download from boatus.org if already completed
- New course: iLearnToBoat.com

### Tall Ships Event (Boston)
- 100-yard security zone while underway, 25-yard while docked
- FBC boats NOT permitted in credentialed areas
- No reciprocal boats at Fan Pier, East Boston, or Charlestown during event

## Future Expansion Ideas

- Weather-aware reservation suggestions (check forecast before recommending dates)
- Automated reservation creation
- Boat type preferences and filtering
- Multi-location availability comparison
- Season opening/closing date tracking
- Reciprocal location search for travel
