-- Count of unread chats for APNs badge count.
-- A chat is unread if:
--   - marked_unread = 1, OR
--   - last message is from assistant AND (last_opened_at IS NULL OR m.created_at > last_opened_at)
--
-- SYNC NOTE: This SQL is the single source of truth. It is read by:
--   1. server.py GET /unread-count (reads via Path(__file__).parent)
--   2. send-push (standalone uv script, reads via file I/O)
--   3. useChatList.ts _isServerUnread() — JS mirror of this logic (must stay in sync manually)
-- Relies on timestamps being ISO 8601 strings (JS Date comparison matches SQLite string ordering).
SELECT COUNT(*) FROM (
    SELECT c.id
    FROM chats c
    LEFT JOIN (
        SELECT chat_id, created_at, role,
               ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
        FROM messages
    ) m ON m.chat_id = c.id AND m.rn = 1
    WHERE c.marked_unread = 1
       OR (m.role = 'assistant'
           AND m.created_at IS NOT NULL
           AND (c.last_opened_at IS NULL OR m.created_at > c.last_opened_at))
)
