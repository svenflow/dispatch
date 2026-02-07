"""
contacts_core - Core functions for macOS Contacts.app management

This module can be imported directly by other Python code to avoid subprocess overhead.
The CLI wrapper (contacts) imports from here.

Read path uses SQLite directly against AddressBook DB (fast, no Contacts.app dependency).
Write path uses AppleScript (Contacts.app required for mutations).
"""

import sqlite3
import subprocess
from pathlib import Path
from typing import Optional, Dict, List

ADDRESSBOOK_DIR = Path.home() / "Library/Application Support/AddressBook"
ADDRESSBOOK_DB = ADDRESSBOOK_DIR / "AddressBook-v22.abcddb"

# Map group names to tier strings
TIER_GROUP_MAP = {
    "Claude Admin": "admin",
    "Claude Wife": "wife",
    "Claude Family": "family",
    "Claude Favorites": "favorite",
    "Claude Bots": "bots",
}


# ──────────────────────────────────────────────────────────────
# SQLite read path (fast, no Contacts.app dependency)
# ──────────────────────────────────────────────────────────────

def _find_addressbook_db() -> Path:
    """Find the AddressBook database, checking per-source DBs if root is empty.

    macOS may store contacts in per-source databases under Sources/<UUID>/
    instead of the root AddressBook-v22.abcddb, especially with iCloud sync.
    """
    # Check root DB first
    if ADDRESSBOOK_DB.exists():
        try:
            conn = sqlite3.connect(f"file:{ADDRESSBOOK_DB}?mode=ro", uri=True, timeout=5)
            count = conn.execute("SELECT COUNT(*) FROM ZABCDRECORD WHERE ZFIRSTNAME IS NOT NULL OR ZLASTNAME IS NOT NULL").fetchone()[0]
            conn.close()
            if count > 0:
                return ADDRESSBOOK_DB
        except Exception:
            pass

    # Check per-source databases
    sources_dir = ADDRESSBOOK_DIR / "Sources"
    if sources_dir.exists():
        for source_dir in sources_dir.iterdir():
            source_db = source_dir / "AddressBook-v22.abcddb"
            if source_db.exists():
                try:
                    conn = sqlite3.connect(f"file:{source_db}?mode=ro", uri=True, timeout=5)
                    count = conn.execute("SELECT COUNT(*) FROM ZABCDRECORD WHERE ZFIRSTNAME IS NOT NULL OR ZLASTNAME IS NOT NULL").fetchone()[0]
                    conn.close()
                    if count > 0:
                        return source_db
                except Exception:
                    continue

    # Fallback to root
    return ADDRESSBOOK_DB


def _get_db_connection() -> sqlite3.Connection:
    """Open a read-only connection to the AddressBook database."""
    db_path = _find_addressbook_db()
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def list_contacts_sqlite(tier_filter: str = None) -> List[Dict[str, str]]:
    """List all contacts with tiers via direct SQLite read.

    Returns list of dicts with 'name', 'phone', 'emails', 'tier', 'notes'.
    """
    try:
        conn = _get_db_connection()
    except Exception:
        return []

    try:
        # Build tier mapping: contact Z_PK -> tier
        tier_map: Dict[int, str] = {}
        cursor = conn.execute("""
            SELECT pg.Z_22CONTACTS AS contact_pk, g.ZNAME AS group_name
            FROM Z_22PARENTGROUPS pg
            JOIN ZABCDRECORD g ON g.Z_PK = pg.Z_19PARENTGROUPS1
            WHERE g.ZNAME IN ({})
        """.format(",".join(f"'{g}'" for g in TIER_GROUP_MAP)))
        for row in cursor:
            group_name = row["group_name"]
            contact_pk = row["contact_pk"]
            # First match wins (admin > wife > family > favorite)
            if contact_pk not in tier_map:
                tier_map[contact_pk] = TIER_GROUP_MAP[group_name]

        # Get all contacts with phones and emails
        contacts_by_pk: Dict[int, Dict] = {}

        # Get all people (not groups - groups have ZFIRSTNAME=NULL and no phone)
        cursor = conn.execute("""
            SELECT Z_PK, ZFIRSTNAME, ZLASTNAME
            FROM ZABCDRECORD
            WHERE ZFIRSTNAME IS NOT NULL OR ZLASTNAME IS NOT NULL
        """)
        for row in cursor:
            pk = row["Z_PK"]
            first = row["ZFIRSTNAME"] or ""
            last = row["ZLASTNAME"] or ""
            name = f"{first} {last}".strip()
            tier = tier_map.get(pk, "unknown")
            if tier_filter and tier != tier_filter:
                continue
            contacts_by_pk[pk] = {
                "name": name,
                "phone": None,
                "emails": [],
                "tier": tier,
            }

        # Attach phone numbers
        if contacts_by_pk:
            cursor = conn.execute("SELECT ZOWNER, ZFULLNUMBER FROM ZABCDPHONENUMBER")
            for row in cursor:
                pk = row["ZOWNER"]
                if pk in contacts_by_pk and not contacts_by_pk[pk]["phone"]:
                    contacts_by_pk[pk]["phone"] = row["ZFULLNUMBER"]

        # Attach emails
        if contacts_by_pk:
            cursor = conn.execute("SELECT ZOWNER, ZADDRESS FROM ZABCDEMAILADDRESS")
            for row in cursor:
                pk = row["ZOWNER"]
                if pk in contacts_by_pk and row["ZADDRESS"]:
                    contacts_by_pk[pk]["emails"].append(row["ZADDRESS"].lower())

        # Attach notes
        if contacts_by_pk:
            cursor = conn.execute("""
                SELECT r.Z_PK, n.ZTEXT
                FROM ZABCDRECORD r
                JOIN ZABCDNOTE n ON n.Z_PK = r.ZNOTE
                WHERE n.ZTEXT IS NOT NULL
            """)
            for row in cursor:
                pk = row["Z_PK"]
                if pk in contacts_by_pk:
                    contacts_by_pk[pk]["notes"] = row["ZTEXT"]

        conn.close()
        return list(contacts_by_pk.values())

    except Exception:
        conn.close()
        return []


def lookup_phone_sqlite(phone: str) -> Optional[Dict[str, str]]:
    """Look up contact by phone number via SQLite. Returns {name, phone, tier} or None."""
    normalized = ''.join(c for c in phone if c.isdigit() or c == '+')
    if not normalized:
        return None

    try:
        conn = _get_db_connection()
    except Exception:
        return None

    try:
        # Build tier mapping
        tier_map: Dict[int, str] = {}
        cursor = conn.execute("""
            SELECT pg.Z_22CONTACTS, g.ZNAME
            FROM Z_22PARENTGROUPS pg
            JOIN ZABCDRECORD g ON g.Z_PK = pg.Z_19PARENTGROUPS1
            WHERE g.ZNAME IN ({})
        """.format(",".join(f"'{g}'" for g in TIER_GROUP_MAP)))
        for row in cursor:
            if row[0] not in tier_map:
                tier_map[row[0]] = TIER_GROUP_MAP[row[1]]

        # Find phone number owner
        cursor = conn.execute(
            "SELECT ZOWNER, ZFULLNUMBER FROM ZABCDPHONENUMBER"
        )
        for row in cursor:
            full = row["ZFULLNUMBER"] or ""
            clean = ''.join(c for c in full if c.isdigit() or c == '+')
            if clean == normalized or (normalized.startswith('+') and clean == normalized[1:]) or clean.endswith(normalized[-10:]):
                owner_pk = row["ZOWNER"]
                # Get contact name
                name_row = conn.execute(
                    "SELECT ZFIRSTNAME, ZLASTNAME FROM ZABCDRECORD WHERE Z_PK = ?",
                    (owner_pk,)
                ).fetchone()
                if name_row:
                    first = name_row["ZFIRSTNAME"] or ""
                    last = name_row["ZLASTNAME"] or ""
                    name = f"{first} {last}".strip()
                    tier = tier_map.get(owner_pk, "unknown")
                    conn.close()
                    return {"name": name, "phone": full, "tier": tier}

        conn.close()
        return None
    except Exception:
        conn.close()
        return None


def lookup_email_sqlite(email: str) -> Optional[Dict[str, str]]:
    """Look up contact by email via SQLite. Returns {name, email, tier} or None."""
    email_lower = email.lower().strip()
    if not email_lower:
        return None

    try:
        conn = _get_db_connection()
    except Exception:
        return None

    try:
        # Build tier mapping
        tier_map: Dict[int, str] = {}
        cursor = conn.execute("""
            SELECT pg.Z_22CONTACTS, g.ZNAME
            FROM Z_22PARENTGROUPS pg
            JOIN ZABCDRECORD g ON g.Z_PK = pg.Z_19PARENTGROUPS1
            WHERE g.ZNAME IN ({})
        """.format(",".join(f"'{g}'" for g in TIER_GROUP_MAP)))
        for row in cursor:
            if row[0] not in tier_map:
                tier_map[row[0]] = TIER_GROUP_MAP[row[1]]

        row = conn.execute(
            "SELECT ZOWNER, ZADDRESS FROM ZABCDEMAILADDRESS WHERE ZADDRESSNORMALIZED = ?",
            (email_lower,)
        ).fetchone()
        if row:
            owner_pk = row["ZOWNER"]
            name_row = conn.execute(
                "SELECT ZFIRSTNAME, ZLASTNAME FROM ZABCDRECORD WHERE Z_PK = ?",
                (owner_pk,)
            ).fetchone()
            if name_row:
                first = name_row["ZFIRSTNAME"] or ""
                last = name_row["ZLASTNAME"] or ""
                name = f"{first} {last}".strip()
                tier = tier_map.get(owner_pk, "unknown")
                conn.close()
                return {"name": name, "email": row["ZADDRESS"], "tier": tier}

        conn.close()
        return None
    except Exception:
        conn.close()
        return None


def get_notes_sqlite(name: str) -> Optional[str]:
    """Get contact notes via SQLite."""
    try:
        conn = _get_db_connection()
        row = conn.execute("""
            SELECT n.ZTEXT FROM ZABCDRECORD r
            JOIN ZABCDNOTE n ON n.Z_PK = r.ZNOTE
            WHERE (r.ZFIRSTNAME || ' ' || COALESCE(r.ZLASTNAME, '')) LIKE ?
            OR r.ZSORTINGFIRSTNAME LIKE ?
        """, (f"%{name}%", f"%{name.lower()}%")).fetchone()
        conn.close()
        if row:
            return row["ZTEXT"]
        return None
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────
# AppleScript path (used for writes and as fallback)
# ──────────────────────────────────────────────────────────────

# AppleScript to get group members (reused across functions)
GET_GROUP_MEMBERS = '''
tell application "Contacts"
    set adminMembers to {}
    set wifeMembers to {}
    set familyMembers to {}
    set favMembers to {}

    try
        set adminMembers to name of every person of group "Claude Admin"
    end try
    try
        set wifeMembers to name of every person of group "Claude Wife"
    end try
    try
        set familyMembers to name of every person of group "Claude Family"
    end try
    try
        set favMembers to name of every person of group "Claude Favorites"
    end try
'''


def ensure_contacts_running():
    """Ensure Contacts.app is running. Launch it if not."""
    subprocess.run(
        ["osascript", "-e", 'tell application "Contacts" to launch'],
        capture_output=True, text=True, timeout=5
    )


def run_applescript(script: str, retry_on_app_error: bool = True, timeout: int = 15) -> tuple[bool, str]:
    """Run AppleScript and return (success, output).

    If Contacts.app isn't running (error -600), launch it and retry.
    If Contacts.app is hung (timeout), kill it and retry once.
    """
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        # Contacts.app is hung — kill it and retry once
        subprocess.run(["pkill", "-x", "Contacts"], capture_output=True)
        subprocess.run(["pkill", "-f", "osascript.*Contacts"], capture_output=True)
        import time
        time.sleep(1)
        ensure_contacts_running()
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=timeout
            )
        except subprocess.TimeoutExpired:
            return False, "Contacts.app hung (timed out twice)"

    if result.returncode == 0:
        return True, result.stdout.strip()

    # Check for "Application isn't running" error (-600)
    if retry_on_app_error and "-600" in result.stderr:
        ensure_contacts_running()
        # Retry once after launching
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=timeout
            )
        except subprocess.TimeoutExpired:
            return False, "Contacts.app hung after relaunch"
        if result.returncode == 0:
            return True, result.stdout.strip()

    return False, result.stderr.strip()


def lookup_email(email: str) -> Optional[Dict[str, str]]:
    """Look up a contact by email address.

    Returns dict with 'name', 'email', 'tier' or None if not found.
    """
    email_lower = email.lower().strip()
    email_esc = email_lower.replace('"', '\\"')

    script = GET_GROUP_MEMBERS + f'''
    -- Search all contacts
    set allPeople to every person
    repeat with p in allPeople
        try
            set emailCount to count of emails of p
            repeat with i from 1 to emailCount
                set em to value of email i of p
                -- Case-insensitive comparison
                if em is not missing value then
                    considering case
                        set emLower to em
                    end considering
                    -- AppleScript doesn't have lowercase, so we compare as-is
                    -- The Python side normalizes to lowercase
                    if em is "{email_esc}" then
                        set n to name of p

                        -- Determine tier
                        if adminMembers contains n then
                            return "FOUND|" & n & "|" & em & "|admin"
                        else if wifeMembers contains n then
                            return "FOUND|" & n & "|" & em & "|wife"
                        else if familyMembers contains n then
                            return "FOUND|" & n & "|" & em & "|family"
                        else if favMembers contains n then
                            return "FOUND|" & n & "|" & em & "|favorite"
                        else
                            return "NOT_FOUND|" & "{email}"
                        end if
                    end if
                end if
            end repeat
        end try
    end repeat

    return "NOT_FOUND|{email}"
end tell
'''
    success, output = run_applescript(script)
    if not success:
        return None

    if output.startswith("FOUND|"):
        parts = output.split("|")
        return {
            "name": parts[1],
            "email": parts[2],
            "tier": parts[3]
        }
    return None


def lookup_phone(phone: str) -> Optional[Dict[str, str]]:
    """Look up a contact by phone number.

    Returns dict with 'name', 'phone', 'tier' or None if not found.
    """
    # Normalize phone for comparison
    normalized = ''.join(c for c in phone if c.isdigit() or c == '+')

    script = GET_GROUP_MEMBERS + f'''
    -- Search all contacts
    set allPeople to every person
    repeat with p in allPeople
        try
            set phoneCount to count of phones of p
            repeat with i from 1 to phoneCount
                set ph to value of phone i of p
                set cleanPh to ""
                repeat with c in ph
                    if c is in "0123456789+" then
                        set cleanPh to cleanPh & c
                    end if
                end repeat

                if cleanPh contains "{normalized}" or "{normalized}" contains cleanPh then
                    set n to name of p

                    -- Determine tier
                    if adminMembers contains n then
                        return "FOUND|" & n & "|" & ph & "|admin"
                    else if wifeMembers contains n then
                        return "FOUND|" & n & "|" & ph & "|wife"
                    else if familyMembers contains n then
                        return "FOUND|" & n & "|" & ph & "|family"
                    else if favMembers contains n then
                        return "FOUND|" & n & "|" & ph & "|favorite"
                    else
                        return "NOT_FOUND|" & "{phone}"
                    end if
                end if
            end repeat
        end try
    end repeat

    return "NOT_FOUND|{phone}"
end tell
'''
    success, output = run_applescript(script)
    if not success:
        return None

    if output.startswith("FOUND|"):
        parts = output.split("|")
        return {
            "name": parts[1],
            "phone": parts[2],
            "tier": parts[3]
        }
    return None


def get_tier(name: str) -> Optional[str]:
    """Get a contact's tier by name.

    Returns tier string ('admin', 'wife', 'family', 'favorite') or None.
    """
    name_esc = name.replace('"', '\\"')

    script = GET_GROUP_MEMBERS + f'''
    if adminMembers contains "{name_esc}" then
        return "admin"
    else if wifeMembers contains "{name_esc}" then
        return "wife"
    else if familyMembers contains "{name_esc}" then
        return "family"
    else if favMembers contains "{name_esc}" then
        return "favorite"
    else
        return ""
    end if
end tell
'''
    success, output = run_applescript(script)
    if success and output:
        return output
    return None


def set_tier(name: str, tier: str) -> bool:
    """Set a contact's tier.

    Args:
        name: Contact's full name
        tier: One of 'admin', 'wife', 'family', 'favorite', or 'none' to remove

    Returns True on success.
    """
    name_esc = name.replace('"', '\\"')

    script = f'''
tell application "Contacts"
    set p to person "{name_esc}"

    -- Ensure groups exist
    try
        set adminGroup to group "Claude Admin"
    on error
        set adminGroup to make new group with properties {{name:"Claude Admin"}}
    end try
    try
        set wifeGroup to group "Claude Wife"
    on error
        set wifeGroup to make new group with properties {{name:"Claude Wife"}}
    end try
    try
        set familyGroup to group "Claude Family"
    on error
        set familyGroup to make new group with properties {{name:"Claude Family"}}
    end try
    try
        set favGroup to group "Claude Favorites"
    on error
        set favGroup to make new group with properties {{name:"Claude Favorites"}}
    end try

    -- Remove from all Claude groups first
    try
        remove p from adminGroup
    end try
    try
        remove p from wifeGroup
    end try
    try
        remove p from familyGroup
    end try
    try
        remove p from favGroup
    end try

    -- Add to new tier group
    if "{tier}" is "admin" then
        add p to adminGroup
    else if "{tier}" is "wife" then
        add p to wifeGroup
    else if "{tier}" is "family" then
        add p to familyGroup
    else if "{tier}" is "favorite" then
        add p to favGroup
    end if

    save
    return "UPDATED"
end tell
'''
    success, output = run_applescript(script)
    return success and output == "UPDATED"


def add_contact(first: str, last: str, phone: str, tier: str = "none") -> bool:
    """Add a new contact.

    Args:
        first: First name
        last: Last name
        phone: Phone number
        tier: Optional tier to assign

    Returns True on success.
    """
    tier_group_map = {
        "admin": "Claude Admin",
        "wife": "Claude Wife",
        "family": "Claude Family",
        "favorite": "Claude Favorites"
    }

    # Escape quotes in names
    first_esc = first.replace('"', '\\"')
    last_esc = last.replace('"', '\\"')

    script = f'''
tell application "Contacts"
    set newPerson to make new person with properties {{first name:"{first_esc}", last name:"{last_esc}"}}
    make new phone at end of phones of newPerson with properties {{label:"mobile", value:"{phone}"}}
'''

    if tier in tier_group_map:
        group_name = tier_group_map[tier]
        script += f'''
    try
        set targetGroup to group "{group_name}"
    on error
        set targetGroup to make new group with properties {{name:"{group_name}"}}
    end try
    add newPerson to targetGroup
'''

    script += '''
    save
    return "CREATED"
end tell
'''

    success, output = run_applescript(script)
    return success and output == "CREATED"


def list_contacts(tier_filter: str = None) -> List[Dict[str, str]]:
    """List all contacts with their tiers.

    Returns list of dicts with 'name', 'phone', 'emails', 'tier'.
    """
    script = GET_GROUP_MEMBERS + '''
    set output to ""

    set allPeople to every person
    repeat with p in allPeople
        set n to name of p

        -- Determine tier (check in priority order)
        if adminMembers contains n then
            set tier to "admin"
        else if wifeMembers contains n then
            set tier to "wife"
        else if familyMembers contains n then
            set tier to "family"
        else if favMembers contains n then
            set tier to "favorite"
        else
            set tier to "unknown"
        end if

        -- Get phone if available
        set ph to ""
        try
            set ph to value of first phone of p
        end try

        -- Get all emails
        set emailList to ""
        try
            set emailCount to count of emails of p
            repeat with i from 1 to emailCount
                set em to value of email i of p
                if i > 1 then
                    set emailList to emailList & ","
                end if
                set emailList to emailList & em
            end repeat
        end try

        set output to output & n & "|" & ph & "|" & tier & "|" & emailList & linefeed
    end repeat

    return output
end tell
'''
    success, output = run_applescript(script)
    if not success:
        return []

    contacts = []
    for line in output.strip().split('\n'):
        if not line.strip():
            continue
        parts = line.split('|')
        if len(parts) >= 3:
            name, phone, tier = parts[0], parts[1], parts[2]
            emails = parts[3].split(',') if len(parts) > 3 and parts[3] else []

            # Filter by tier if specified
            if tier_filter and tier != tier_filter:
                continue

            contacts.append({
                "name": name,
                "phone": phone if phone else None,
                "emails": [e.strip().lower() for e in emails if e.strip()],
                "tier": tier
            })

    return contacts


def get_notes(name: str) -> Optional[str]:
    """Get a contact's notes."""
    name_esc = name.replace('"', '\\"')

    script = f'''
tell application "Contacts"
    try
        set thePerson to person "{name_esc}"
        set theNote to note of thePerson
        if theNote is missing value then
            return ""
        else
            return theNote
        end if
    on error
        return "ERROR|Contact not found"
    end try
end tell
'''
    success, output = run_applescript(script)
    if output.startswith("ERROR|"):
        return None
    return output


def set_notes(name: str, content: str) -> bool:
    """Set a contact's notes. Returns True on success."""
    name_esc = name.replace('"', '\\"')
    content_esc = content.replace('\\', '\\\\').replace('"', '\\"')

    script = f'''
tell application "Contacts"
    try
        set thePerson to person "{name_esc}"
        set note of thePerson to "{content_esc}"
        save
        return "SAVED"
    on error
        return "ERROR|Contact not found"
    end try
end tell
'''
    success, output = run_applescript(script)
    return success and not output.startswith("ERROR|")


class ContactsCache:
    """Thin wrapper around SQLite lookups for backwards compatibility.

    No in-memory cache needed — SQLite reads are fast (~1ms).
    Kept as a class so existing code (manager.py) doesn't need restructuring.
    """

    def __init__(self, auto_load: bool = True):
        pass  # No cache to load

    def refresh(self) -> int:
        """Return count of blessed contacts. No cache to refresh."""
        contacts = list_contacts_sqlite()
        return len([c for c in contacts if c["tier"] != "unknown"])

    def lookup_phone(self, phone: str) -> Optional[Dict[str, str]]:
        return lookup_phone_sqlite(phone)

    def lookup_email(self, email: str) -> Optional[Dict[str, str]]:
        return lookup_email_sqlite(email)

    def lookup_name(self, name: str) -> Optional[Dict[str, str]]:
        """Lookup by name via SQLite."""
        contacts = list_contacts_sqlite()
        name_lower = name.lower()
        for c in contacts:
            if c["name"].lower() == name_lower:
                return c
        return None

    @property
    def count(self) -> int:
        contacts = list_contacts_sqlite()
        return len([c for c in contacts if c["tier"] != "unknown"])


def cached_lookup_phone(phone: str) -> Optional[Dict[str, str]]:
    """Look up contact by phone via SQLite."""
    return lookup_phone_sqlite(phone)


def cached_lookup_email(email: str) -> Optional[Dict[str, str]]:
    """Look up contact by email via SQLite."""
    return lookup_email_sqlite(email)
