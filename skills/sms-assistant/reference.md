# iMessage Technical Reference

## Database Location

```
~/Library/Messages/chat.db
```

Requires Full Disk Access for the terminal app (System Settings > Privacy & Security > Full Disk Access).

## Key Tables

### message
| Column | Description |
|--------|-------------|
| ROWID | Unique message ID (use for tracking processed messages) |
| date | Timestamp in nanoseconds since 2001-01-01 (macOS epoch) |
| text | Message text (often NULL for outgoing messages) |
| attributedBody | Binary NSAttributedString (contains text when `text` is NULL) |
| is_from_me | 1 = outgoing, 0 = incoming |
| handle_id | Foreign key to handle table |

### handle
| Column | Description |
|--------|-------------|
| ROWID | Unique handle ID |
| id | Phone number or email (e.g., +16175551234) |
| service | "iMessage" or "SMS" |

### attachment
| Column | Description |
|--------|-------------|
| ROWID | Unique attachment ID |
| filename | Full path to attachment file |
| mime_type | MIME type (e.g., "text/vcard", "image/jpeg") |
| transfer_name | Original filename |

### message_attachment_join
Links messages to attachments via message_id and attachment_id.

## Timestamp Conversion

macOS uses a custom epoch: 2001-01-01 00:00:00 UTC (978307200 seconds after Unix epoch).

Messages store timestamps in **nanoseconds**.

```python
# macOS timestamp to Unix timestamp
unix_ts = macos_ts / 1_000_000_000 + 978307200

# In SQLite
datetime(message.date/1000000000 + 978307200, 'unixepoch', 'localtime')
```

## attributedBody Format

Outgoing messages (and some incoming) store text in `attributedBody` instead of `text` field. This is Apple's **typedstream** serialization format for NSAttributedString.

### Structure
```
streamtyped...NSMutableAttributedString...NSString[overhead][length][text]...NSDictionary...
```

### Parsing Algorithm
```python
def extract_text_from_attributed_body(data):
    # Split on NSString marker
    parts = data.split(b"NSString")
    content = parts[1][5:]  # Skip 5 bytes of overhead

    # Length encoding:
    # - If first byte is 0x81: length is next 2 bytes (little endian)
    # - Otherwise: first byte is the length
    if content[0] == 0x81:
        length = int.from_bytes(content[1:3], "little")
        text_start = 3
    else:
        length = content[0]
        text_start = 1

    return content[text_start:text_start + length].decode("utf-8")
```

### Why This Happens
Around iOS 16 / macOS Ventura (late 2022), Apple changed how messages are stored. Many messages now have NULL in the `text` column and require parsing `attributedBody`.

## Sending Messages via AppleScript

```applescript
tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to buddy "+16175551234" of targetService
    send "Hello!" to targetBuddy
end tell
```

### IMPORTANT: Use `buddy` not `participant`

- **`participant`** - Creates message in chat.db but may NOT deliver (is_delivered = 0)
- **`buddy`** - Actually delivers the message (is_delivered = 1)

This was discovered when messages to the wife weren't being received despite showing in chat.db.

### Notes
- Messages sent via AppleScript don't populate the `text` field in chat.db
- The text IS stored in `attributedBody`
- Our read script handles both formats

## Sending Images via AppleScript

### The Bug (macOS Monterey through Sequoia)

Since macOS Monterey, AppleScript image sending has been broken. The script runs without error, but:
1. The image appears in Messages.app with a progress bar
2. The progress bar times out
3. "Not Delivered" appears in red
4. The script returns success (no error)

This affects all standard approaches:
- `send theFile to buddy`
- `send file theFile to buddy`
- `send POSIX file "/path" to buddy`

### The Workaround: ~/Pictures Folder

Images sent from the `~/Pictures` folder work reliably. Other folders (Downloads, Desktop, tmp) fail silently.

```applescript
-- Copy file to Pictures first
set picturesPath to (POSIX path of (path to pictures folder)) & "image.png"
do shell script "cp /path/to/image.png " & quoted form of picturesPath

-- Send with 'file' keyword
set theFile to POSIX file picturesPath
tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to buddy "+16175551234" of targetService
    send file theFile to targetBuddy
end tell

-- Clean up
delay 2
do shell script "rm " & quoted form of picturesPath
```

### Key Requirements

1. **File must be in ~/Pictures** - This is the critical workaround
2. **Use `file` keyword** - `send file theFile` not just `send theFile`
3. **Use `buddy` not `participant`** - Same as text messages
4. **Delay before cleanup** - Give Messages time to start the transfer

### Alternative: UI Scripting

If the Pictures workaround stops working, fall back to simulating user input:

```applescript
-- Copy image to clipboard
set the clipboard to (read (POSIX file "/path/to/image.jpg") as JPEG picture)

-- Activate Messages and paste
tell application "Messages" to activate
tell application "System Events"
    keystroke "v" using {command down}
    delay 0.5
    keystroke return
end tell
```

This is more fragile (depends on UI state) but works as a last resort.

### Sources

- [MacScripter: Sequoia Messages send file](https://www.macscripter.net/t/sequoia-messages-send-file/76468)
- [MacScripter: Monterey can't send images](https://www.macscripter.net/t/scripting-messages-in-monterey-cant-send-images/73483)
- [Glinteco: Automating iMessages with AppleScript](https://glinteco.com/en/post/from-text-to-media-automating-imessages-with-applescript/)

## Detecting Attachments

Messages with attachments show the Unicode Object Replacement Character (`\ufffc` / `￼`) in the text field.

```sql
-- Find messages with attachments
SELECT m.ROWID, a.filename, a.mime_type
FROM message m
JOIN message_attachment_join maj ON m.ROWID = maj.message_id
JOIN attachment a ON a.ROWID = maj.attachment_id
ORDER BY m.date DESC;
```

## Common Queries

### Recent messages from everyone
```sql
SELECT
    datetime(message.date/1000000000 + 978307200, 'unixepoch', 'localtime') as timestamp,
    handle.id as phone,
    CASE WHEN message.is_from_me THEN 'OUT' ELSE 'IN' END as direction,
    message.text
FROM message
LEFT JOIN handle ON message.handle_id = handle.ROWID
ORDER BY message.date DESC
LIMIT 20;
```

### Messages since ROWID (for polling)
```sql
SELECT * FROM message WHERE ROWID > ? ORDER BY date ASC;
```

### Get latest ROWID
```sql
SELECT MAX(ROWID) FROM message;
```

## Resources

- [LangChain iMessage Loader](https://api.python.langchain.com/en/latest/_modules/langchain_community/chat_loaders/imessage.html) - attributedBody parsing reference
- [imessage_tools](https://github.com/my-other-github-account/imessage_tools) - Comprehensive iMessage parsing library
- [Reverse Engineering Apple's Typedstream](https://chrissardegna.com/blog/reverse-engineering-apples-typedstream-format/) - Deep dive into the binary format
