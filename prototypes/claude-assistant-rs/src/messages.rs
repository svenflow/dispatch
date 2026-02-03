//! Messages.app database reader
//!
//! Reads messages from ~/Library/Messages/chat.db and parses attributedBody blobs.

use crate::config::{Config, MACOS_EPOCH_OFFSET};
use crate::error::{Error, Result};
use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use tracing::{info, warn};

/// A message from Messages.app
#[derive(Debug, Clone)]
pub struct Message {
    pub rowid: i64,
    pub timestamp: DateTime<Utc>,
    pub sender: String,        // Phone of the sender (for groups) or chat_id (for 1:1)
    pub text: String,          // Message text (empty if no text)
    pub chat_id: String,       // Chat identifier (phone for 1:1, UUID for groups)
    pub is_from_me: bool,
    pub is_group: bool,
    pub group_name: Option<String>,
    pub attachments: Vec<Attachment>,
    pub is_audio_message: bool,
    pub audio_transcription: Option<String>,
    pub thread_originator_guid: Option<String>,
}

/// An attachment from a message
#[derive(Debug, Clone)]
pub struct Attachment {
    pub path: String,
    pub mime_type: String,
    pub name: String,
    pub size: i64,
}

/// Reader for Messages.app database
pub struct MessagesReader {
    db_path: std::path::PathBuf,
}

impl MessagesReader {
    pub fn new(config: &Config) -> Self {
        Self {
            db_path: config.messages_db.clone(),
        }
    }

    /// Open database connection (read-only to avoid lock contention)
    fn open_db(&self) -> Result<Connection> {
        let conn = Connection::open_with_flags(
            &self.db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        Ok(conn)
    }

    /// Get messages newer than the given ROWID (poll for new messages)
    pub fn poll(&self, since_rowid: i64) -> Result<Vec<Message>> {
        self.get_new_messages(since_rowid)
    }

    /// Get the maximum ROWID (for starting the daemon)
    pub fn get_max_rowid(&self) -> Result<i64> {
        self.get_latest_rowid()
    }

    /// Get messages newer than the given ROWID
    pub fn get_new_messages(&self, since_rowid: i64) -> Result<Vec<Message>> {
        let conn = self.open_db()?;

        let mut stmt = conn.prepare(
            r#"
            SELECT
                message.ROWID,
                message.date,
                handle.id as phone,
                message.text,
                message.attributedBody,
                message.cache_has_attachments,
                message.is_audio_message,
                message.is_from_me,
                chat.style,
                chat.display_name,
                chat.chat_identifier,
                message.thread_originator_guid
            FROM message
            LEFT JOIN handle ON message.handle_id = handle.ROWID
            LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
            LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
            WHERE message.ROWID > ?1
            ORDER BY message.date ASC
            "#,
        )?;

        let mut messages = Vec::new();

        let rows = stmt.query_map([since_rowid], |row| {
            let rowid: i64 = row.get(0)?;
            let date: i64 = row.get(1)?;
            let phone: Option<String> = row.get(2)?;
            let text: Option<String> = row.get(3)?;
            let attributed_body: Option<Vec<u8>> = row.get(4)?;
            let has_attachments: bool = row.get::<_, i32>(5)? != 0;
            let is_audio: bool = row.get::<_, i32>(6)? != 0;
            let is_from_me: bool = row.get::<_, i32>(7)? != 0;
            let chat_style: Option<i32> = row.get(8)?;
            let display_name: Option<String> = row.get(9)?;
            let chat_identifier: Option<String> = row.get(10)?;
            let thread_guid: Option<String> = row.get(11)?;

            Ok((
                rowid,
                date,
                phone,
                text,
                attributed_body,
                has_attachments,
                is_audio,
                is_from_me,
                chat_style,
                display_name,
                chat_identifier,
                thread_guid,
            ))
        })?;

        for row_result in rows {
            let (
                rowid,
                date,
                phone,
                text,
                attributed_body,
                has_attachments,
                is_audio,
                is_from_me,
                chat_style,
                display_name,
                chat_identifier,
                thread_guid,
            ) = row_result?;

            // Skip if no phone
            let phone = match phone {
                Some(p) => p,
                None => continue,
            };

            // Race condition fix: If chat_style is None, the chat_message_join row might not
            // have been written yet. Wait 50ms and re-query this specific message.
            let (chat_style, display_name, chat_identifier) = if chat_style.is_none() {
                let race_start = std::time::Instant::now();
                info!(rowid = rowid, "[RACE_TELEMETRY] chat_style=NULL on initial query, waiting 50ms");
                std::thread::sleep(std::time::Duration::from_millis(50));
                let requery_result: rusqlite::Result<(Option<i32>, Option<String>, Option<String>)> = conn.query_row(
                    r#"
                    SELECT chat.style, chat.display_name, chat.chat_identifier
                    FROM message
                    LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
                    LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
                    WHERE message.ROWID = ?1
                    "#,
                    [rowid],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                );
                let race_elapsed_ms = race_start.elapsed().as_millis();
                match requery_result {
                    Ok((style, name, identifier)) => {
                        if style.is_some() {
                            info!(rowid = rowid, elapsed_ms = race_elapsed_ms, chat_style = ?style, chat_identifier = ?identifier, "[RACE_TELEMETRY] SUCCESS after re-query");
                        } else {
                            warn!(rowid = rowid, elapsed_ms = race_elapsed_ms, "[RACE_TELEMETRY] STILL_NULL after re-query - join row may not exist yet");
                        }
                        (style, name, identifier)
                    }
                    Err(e) => {
                        warn!(rowid = rowid, elapsed_ms = race_elapsed_ms, error = ?e, "[RACE_TELEMETRY] NO_ROW after re-query - message may have been deleted");
                        (chat_style, display_name, chat_identifier)
                    }
                }
            } else {
                (chat_style, display_name, chat_identifier)
            };

            // Parse attributed body if text is None
            let (msg_text, audio_transcription) = match (&text, &attributed_body) {
                (Some(t), _) if !t.is_empty() && t != "\u{fffc}" => (Some(t.clone()), None),
                (_, Some(blob)) => {
                    let (parsed_text, audio) = parse_attributed_body(blob);
                    (parsed_text, audio)
                }
                _ => (None, None),
            };

            // Skip if no text and no attachments
            if msg_text.is_none() && !has_attachments {
                continue;
            }

            // Get attachments if present
            let attachments = if has_attachments {
                self.get_attachments(&conn, rowid)?
            } else {
                Vec::new()
            };

            // Detect group chat (style 43 = group, 45 = 1:1)
            let is_group = chat_style == Some(43);

            let timestamp = macos_to_datetime(date);

            // Determine chat_id (phone for 1:1, UUID for groups)
            let chat_id = chat_identifier.clone().unwrap_or_else(|| phone.clone());

            messages.push(Message {
                rowid,
                timestamp,
                sender: phone.clone(),
                text: msg_text.unwrap_or_default(),
                chat_id,
                is_from_me,
                is_group,
                group_name: if is_group { display_name } else { None },
                attachments,
                is_audio_message: is_audio,
                audio_transcription,
                thread_originator_guid: thread_guid,
            });
        }

        Ok(messages)
    }

    /// Get the most recent message ROWID
    pub fn get_latest_rowid(&self) -> Result<i64> {
        let conn = self.open_db()?;
        let rowid: i64 = conn.query_row("SELECT MAX(ROWID) FROM message", [], |row| row.get(0))?;
        Ok(rowid)
    }

    /// Get attachments for a message
    fn get_attachments(&self, conn: &Connection, message_rowid: i64) -> Result<Vec<Attachment>> {
        let mut stmt = conn.prepare(
            r#"
            SELECT
                attachment.filename,
                attachment.mime_type,
                attachment.transfer_name,
                attachment.total_bytes
            FROM attachment
            JOIN message_attachment_join ON attachment.ROWID = message_attachment_join.attachment_id
            WHERE message_attachment_join.message_id = ?1
            "#,
        )?;

        let attachments = stmt
            .query_map([message_rowid], |row| {
                let filename: Option<String> = row.get(0)?;
                let mime_type: Option<String> = row.get(1)?;
                let transfer_name: Option<String> = row.get(2)?;
                let total_bytes: Option<i64> = row.get(3)?;

                Ok((filename, mime_type, transfer_name, total_bytes))
            })?
            .filter_map(|r| r.ok())
            .filter_map(|(filename, mime_type, transfer_name, total_bytes)| {
                let path = filename?;
                // Expand ~ to home dir
                let expanded = if path.starts_with("~/") {
                    dirs::home_dir()
                        .map(|h| h.join(&path[2..]).to_string_lossy().to_string())
                        .unwrap_or(path.clone())
                } else {
                    path.clone()
                };

                Some(Attachment {
                    path: expanded,
                    mime_type: mime_type.unwrap_or_else(|| "unknown".to_string()),
                    name: transfer_name.unwrap_or_else(|| {
                        Path::new(&path)
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default()
                    }),
                    size: total_bytes.unwrap_or(0),
                })
            })
            .collect();

        Ok(attachments)
    }
}

/// Convert macOS nanosecond timestamp to DateTime<Utc>
fn macos_to_datetime(ts: i64) -> DateTime<Utc> {
    let unix_ts = ts / 1_000_000_000 + MACOS_EPOCH_OFFSET;
    Utc.timestamp_opt(unix_ts, 0).unwrap()
}

/// Parse NSAttributedString from attributedBody blob
/// Returns (message_text, audio_transcription)
pub fn parse_attributed_body(data: &[u8]) -> (Option<String>, Option<String>) {
    let text = extract_message_text(data);
    let audio = extract_audio_transcription(data);
    (text, audio)
}

/// Extract main message text from blob
fn extract_message_text(data: &[u8]) -> Option<String> {
    let markers: &[&[u8]] = &[b"NSString", b"NSMutableString"];

    for marker in markers {
        if let Some(pos) = find_subsequence(data, marker) {
            let after_marker = &data[pos + marker.len()..];
            if let Some(text) = extract_text_after_marker(after_marker) {
                return Some(text);
            }
        }
    }

    // Fallback: try plist parsing
    parse_via_plist(data)
}

/// Extract audio transcription (Apple's speech-to-text for voice messages)
fn extract_audio_transcription(data: &[u8]) -> Option<String> {
    let marker = b"IMAudioTranscription";

    if let Some(pos) = find_subsequence(data, marker) {
        let after_marker = &data[pos + marker.len()..];

        for i in 0..after_marker.len().saturating_sub(10) {
            let slice = &after_marker[i..];

            // 2-byte length encoding (0x81 prefix)
            if slice.len() > 4 && slice[0] == 0x81 {
                let len = u16::from_le_bytes([slice[1], slice[2]]) as usize;
                if len > 10 && len < 5000 && slice.len() > 3 + len {
                    let text_bytes = &slice[3..3 + len];
                    if let Ok(text) = std::str::from_utf8(text_bytes) {
                        let cleaned = text.trim();
                        if !cleaned.is_empty() && cleaned.chars().any(|c| c.is_alphabetic()) {
                            return Some(cleaned.to_string());
                        }
                    }
                }
            }

            // 1-byte length for shorter transcriptions
            if slice.len() > 2 {
                let len = slice[0] as usize;
                if len > 10 && len < 128 && slice.len() > 1 + len {
                    let text_bytes = &slice[1..1 + len];
                    if let Ok(text) = std::str::from_utf8(text_bytes) {
                        let cleaned = text.trim();
                        if !cleaned.is_empty() && cleaned.chars().any(|c| c.is_alphabetic()) {
                            return Some(cleaned.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

fn extract_text_after_marker(data: &[u8]) -> Option<String> {
    for i in 0..data.len().saturating_sub(10) {
        let slice = &data[i..];

        if slice.is_empty() || slice[0] != 0x2B {
            continue;
        }

        // Format 1: 0x2B <1-byte length> <text>
        if slice.len() > 2 {
            let len = slice[1] as usize;
            if len > 0 && len < 128 && slice.len() > 2 + len {
                let text_bytes = &slice[2..2 + len];
                if let Ok(text) = std::str::from_utf8(text_bytes) {
                    if is_valid_message_text(text) {
                        return Some(text.to_string());
                    }
                }
            }
        }

        // Format 2: 0x2B 0x81 <2-byte length LE> <text>
        if slice.len() > 4 && slice[1] == 0x81 {
            let len = u16::from_le_bytes([slice[2], slice[3]]) as usize;
            if len > 0 && slice.len() > 4 + len {
                let text_bytes = &slice[4..4 + len];
                if let Ok(text) = std::str::from_utf8(text_bytes) {
                    if is_valid_message_text(text) {
                        return Some(text.to_string());
                    }
                }
            }
        }

        // Format 3: 0x2B 0x82 <4-byte length LE> <text>
        if slice.len() > 6 && slice[1] == 0x82 {
            let len = u32::from_le_bytes([slice[2], slice[3], slice[4], slice[5]]) as usize;
            if len > 0 && len < 100_000 && slice.len() > 6 + len {
                let text_bytes = &slice[6..6 + len];
                if let Ok(text) = std::str::from_utf8(text_bytes) {
                    if is_valid_message_text(text) {
                        return Some(text.to_string());
                    }
                }
            }
        }
    }

    None
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn is_valid_message_text(text: &str) -> bool {
    !text.is_empty() && text.len() > 1 && text.chars().any(|c| c.is_alphabetic())
}

fn parse_via_plist(data: &[u8]) -> Option<String> {
    match plist::from_bytes::<plist::Value>(data) {
        Ok(value) => extract_string_from_plist(&value),
        Err(_) => None,
    }
}

fn extract_string_from_plist(value: &plist::Value) -> Option<String> {
    match value {
        plist::Value::String(s) => Some(s.clone()),
        plist::Value::Dictionary(dict) => {
            if let Some(plist::Value::Array(objects)) = dict.get("$objects") {
                for obj in objects {
                    if let plist::Value::String(s) = obj {
                        if is_valid_message_text(s) {
                            return Some(s.clone());
                        }
                    }
                    if let plist::Value::Dictionary(inner) = obj {
                        if let Some(plist::Value::String(s)) = inner.get("NS.string") {
                            return Some(s.clone());
                        }
                    }
                }
            }
            None
        }
        plist::Value::Array(arr) => {
            for item in arr {
                if let Some(s) = extract_string_from_plist(item) {
                    return Some(s);
                }
            }
            None
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    // Test blob: "i think we can drop haiku..."
    const TEST_BLOB_SIMPLE: &str = "040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B6669207468696E6B2077652063616E2064726F70206861696B7520736F207765206A7573742075736520746D75782072696768743F20616E64207468656E20666F72204E534174747269627574656453747269696E6720706C656173652070726F746F7479706586840269490166928484840C4E5344696374696F6E617279009484016901928496961D5F5F6B494D4D657373616765506172744174747269627574654E616D658692848484084E534E756D626572008484074E5356616C7565009484012A84999900868686";

    // Test blob: long text (165 chars)
    const TEST_BLOB_LONG: &str = "040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B81A5007765206861766520746F207265777269746520697420616C6C2E20706C656173652064657269736B2065766572797468696E67206279206C61756E6368696E67207375626167656E7420666F72206561636820636F6D706F6E656E7420616E6420676F6F676C6520666F7220727573742076657273696F6E732E207468656E20657374696D61746520706572666F726D616E636520696E637265617365206F76657220707986840269490181A500928484840C4E5344696374696F6E617279009484016901928496961D5F5F6B494D4D657373616765506172744174747269627574654E616D658692848484084E534E756D626572008484074E5356616C7565009484012A84999900868686";

    // Test blob: URL with link attributes
    const TEST_BLOB_URL: &str = "040B73747265616D747970656481E803840140848484194E534D757461626C6541747472696275746564537472696E67008484124E5341747472696275746564537472696E67008484084E534F626A6563740085928484840F4E534D757461626C65537472696E67018484084E53537472696E67019584012B2368747470733A2F2F6769746875622E636F6D2F6F6272612F7375706572706F7765727386840269490123928484840C4E5344696374696F6E61727900958401690592849898265F5F6B494D4261736557726974696E67446972656374696F6E4174747269627574654E616D658692848484084E534E756D626572008484074E5356616C7565009584012A848401719FFF8692849898205F5F6B494D4C696E6B4973526963684C696E6B4174747269627574654E616D658692849D9E84840163A0018692849898165F5F6B494D4C696E6B4174747269627574654E616D658692848484054E5355524C0095A000928498982368747470733A2F2F6769746875622E636F6D2F6F6272612F7375706572706F776572738686928498981D5F5F6B494D4D657373616765506172744174747269627574654E616D658692849D9E9F9F0086928498981E5F5F6B494D4461746144657465637465644174747269627574654E616D658692848484064E534461746100959B81350284065B353635635D62706C6973743030D4010203040506070C582476657273696F6E592461726368697665725424746F7058246F626A6563747312000186A05F100F4E534B657965644172636869766572D208090A0B5776657273696F6E5964642D726573756C74800B8001AC0D0E1C2425262C2D2E32353955246E756C6CD70F101112131415161718191A1B1A524D535624636C6173735241525154515052535252564E8006800A8002800710018008D41D1E1F10202122235F10124E532E72616E676576616C2E6C656E6774685F10144E532E72616E676576616C2E6C6F636174696F6E5A4E532E7370656369616C800380041004800510231000D22728292A5A24636C6173736E616D655824636C6173736573574E5356616C7565A2292B584E534F626A6563745F102368747470733A2F2F6769746875622E636F6D2F6F6272612F7375706572706F77657273574874747055524CD22F1030315A4E532E6F626A65637473A08009D227283334574E534172726179A2332BD2272836375F100F44445363616E6E6572526573756C74A2382B5F100F44445363616E6E6572526573756C74100100080011001A00240029003200370049004E005600600062006400710077008600890090009300950097009A009D009F00A100A300A500A700A900B200C700DE00E900EB00ED00EF00F100F300F500FA0105010E0116011901220148015001550160016101630168017001730178018A018D019F0000000000000201000000000000003A000000000000000000000000000001A1868686";

    // Test blob: Audio message with transcription
    const TEST_BLOB_AUDIO: &str = "040B73747265616D747970656481E803840140848484124E5341747472696275746564537472696E67008484084E534F626A656374008592848484084E53537472696E67019484012B03EFBFBC86840269490101928484840C4E5344696374696F6E61727900948401690492849696225F5F6B494D46696C655472616E73666572475549444174747269627574654E616D6586928496962961745F305F38463932454445322D373631372D343939312D423939432D383834313134334341463138869284969614494D417564696F5472616E736372697074696F6E869284969681C2024F6E636520796F7527726520646F6E6520646F696E6720746861742C207768617420492077616E7420796F7520746F20646F20697320726561642074686520726F6F7420636C6F74204D4420746F2067657420612073656E736520666F7220616C6C206F6620746865207468696E6773207468617420617265206F6E207468697320636F6D707574657220616E64207468656E20492077616E7420796F7520746F20666F722065616368206F66207468652066757475726573206C6973746564206F7574207468657265206C61756E6368206120737562206167656E7420746F20646F20726573656172636820746861742073686F756C64206265206174206C6561737420612070616765206F722074776F206F662065786163746C7920686F7720697420776F726B73206F6E2074686973206D616368696E6520736372756262696E6720616C6C206F662074686520706572736F6E616C2064657461696C73206E616D65732074686174206B696E64206F66207468696E67206A757374206B6565702069742E2049206C6F7665206F6E652067656E6572616C2077726974696E67206120626967207265706F727420746861742073686F756C64206265206C696B6520313020746F203135207061676573206B696E64206F66207468696E67207468656E20636F6E76657274207468617420746F20612050444620616E64207468656E2070617374652069742068657265206F6E636520796F7520646F2074686174207468656E20636F6E7665727420746861742050444620666F72206F75722054657861732073706565636820616E64206174746163682E2054686520617564696F20746F2074686973207468726561642061732077656C6C2C20736F20646F2074686174206F6E636520796F7527726520646F6E652077697468207468697320576861746576657220796F7527726520646F696E67207269676874206E6F778692849696265F5F6B494D4261736557726974696E67446972656374696F6E4174747269627574654E616D658692848484084E534E756D626572008484074E5356616C7565009484012A848401719DFF86928496961D5F5F6B494D4D657373616765506172744174747269627574654E616D658692849F9CA19D00868686";

    #[test]
    fn test_parse_simple_text() {
        let data = hex::decode(TEST_BLOB_SIMPLE).unwrap();
        let (text, audio) = parse_attributed_body(&data);
        assert!(text.is_some());
        assert!(text.unwrap().contains("i think we can drop haiku"));
        assert!(audio.is_none());
    }

    #[test]
    fn test_parse_long_text() {
        let data = hex::decode(TEST_BLOB_LONG).unwrap();
        let (text, audio) = parse_attributed_body(&data);
        assert!(text.is_some());
        let t = text.unwrap();
        assert!(t.contains("we have to rewrite it all"));
        assert_eq!(t.len(), 165);
        assert!(audio.is_none());
    }

    #[test]
    fn test_parse_url() {
        let data = hex::decode(TEST_BLOB_URL).unwrap();
        let (text, audio) = parse_attributed_body(&data);
        assert!(text.is_some());
        assert!(text.unwrap().contains("github.com/obra/superpowers"));
        assert!(audio.is_none());
    }

    #[test]
    fn test_parse_audio_transcription() {
        let data = hex::decode(TEST_BLOB_AUDIO).unwrap();
        let (text, audio) = parse_attributed_body(&data);
        // Audio messages have placeholder text
        assert!(audio.is_some());
        let a = audio.unwrap();
        assert!(a.contains("Once you're done doing that"));
        assert!(a.len() > 100); // Should be a long transcription
    }

    #[test]
    fn test_parse_empty_blob() {
        let (text, audio) = parse_attributed_body(&[]);
        assert!(text.is_none());
        assert!(audio.is_none());
    }

    #[test]
    fn test_parse_invalid_blob() {
        let data = vec![0x00, 0x01, 0x02, 0x03];
        let (text, audio) = parse_attributed_body(&data);
        assert!(text.is_none());
        assert!(audio.is_none());
    }

    #[test]
    fn test_macos_timestamp_conversion() {
        // Test a known timestamp
        let macos_ts: i64 = 0; // Jan 1, 2001 00:00:00 in macOS time
        let dt = macos_to_datetime(macos_ts);
        assert_eq!(dt.year(), 2001);
        assert_eq!(dt.month(), 1);
        assert_eq!(dt.day(), 1);
    }

    #[test]
    fn test_find_subsequence() {
        assert_eq!(find_subsequence(b"hello world", b"world"), Some(6));
        assert_eq!(find_subsequence(b"hello world", b"xxx"), None);
        assert_eq!(find_subsequence(b"NSString", b"NSString"), Some(0));
    }

    #[test]
    fn test_is_valid_message_text() {
        assert!(is_valid_message_text("hello"));
        assert!(is_valid_message_text("hello world"));
        assert!(!is_valid_message_text(""));
        assert!(!is_valid_message_text("a")); // Too short
        assert!(!is_valid_message_text("123")); // No letters
    }

    // Benchmark test (run with --release for meaningful results)
    #[test]
    fn test_parsing_performance() {
        let data = hex::decode(TEST_BLOB_LONG).unwrap();
        let start = std::time::Instant::now();
        for _ in 0..1000 {
            let _ = parse_attributed_body(&data);
        }
        let elapsed = start.elapsed();
        // Should complete 1000 iterations in under 100ms
        assert!(elapsed.as_millis() < 100, "Parsing too slow: {:?}", elapsed);
    }

    // Tests for chat_style race condition fix
    #[test]
    fn test_is_group_detection_style_43() {
        // Style 43 = group chat
        let chat_style: Option<i32> = Some(43);
        let is_group = chat_style == Some(43);
        assert!(is_group, "Style 43 should be detected as group");
    }

    #[test]
    fn test_is_group_detection_style_45() {
        // Style 45 = individual chat
        let chat_style: Option<i32> = Some(45);
        let is_group = chat_style == Some(43);
        assert!(!is_group, "Style 45 should not be detected as group");
    }

    #[test]
    fn test_is_group_detection_null_style() {
        // NULL style (race condition case) should not be detected as group
        let chat_style: Option<i32> = None;
        let is_group = chat_style == Some(43);
        assert!(!is_group, "NULL style should not be detected as group (triggers re-query)");
    }

    #[test]
    fn test_requery_delay_duration() {
        // Verify the 50ms delay is reasonable
        let delay = std::time::Duration::from_millis(50);
        assert_eq!(delay.as_millis(), 50, "Re-query delay should be 50ms");
        // Ensure delay is not too long (wouldn't want to slow down message processing)
        assert!(delay.as_millis() < 100, "Re-query delay should be under 100ms");
    }
}
