use crate::{domain::document::DocumentError, ports::document_identity::DocumentIdentitySource};
use chrono::{DateTime, Local, TimeZone};
use std::fmt::Display;

pub struct LocalDocumentIdentity;

fn format_identity<T: TimeZone>(time: DateTime<T>, bytes: [u8; 4]) -> String
where
    T::Offset: Display,
{
    format!(
        "{}-{:02x}{:02x}{:02x}{:02x}",
        time.format("%y%m%d%H%M%S"),
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3]
    )
}

impl DocumentIdentitySource for LocalDocumentIdentity {
    fn next_id(&self) -> Result<String, DocumentError> {
        let mut bytes = [0; 4];
        getrandom::fill(&mut bytes).map_err(|_| {
            DocumentError::new(
                "identityUnavailable",
                "문서 식별자의 난수를 생성하지 못했습니다.",
            )
        })?;
        Ok(format_identity(Local::now(), bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_uses_local_components_and_exactly_four_lowercase_hex_bytes() {
        let local = DateTime::parse_from_rfc3339("2026-10-13T00:01:02+09:00").unwrap();
        assert_eq!(
            format_identity(local, [0x00, 0x01, 0xaf, 0xff]),
            "261013000102-0001afff"
        );
        // UTC is the previous day. The local date must not be converted to UTC.
        assert_eq!(
            format_identity(local.with_timezone(&chrono::Utc), [0x00, 0x01, 0xaf, 0xff]),
            "261012150102-0001afff"
        );
    }

    #[test]
    fn creation_order_sorts_before_the_random_suffix_across_a_day_boundary() {
        let earlier = DateTime::parse_from_rfc3339("2026-10-12T23:59:59+09:00").unwrap();
        let later = DateTime::parse_from_rfc3339("2026-10-13T00:00:00+09:00").unwrap();
        let a = format!("{}.md", format_identity(earlier, [0xff; 4]));
        let b = format!("{}.md", format_identity(later, [0x00; 4]));
        assert!(a < b);
    }

    #[test]
    fn system_source_returns_a_timestamp_with_an_os_random_suffix() {
        let before = Local::now().format("%y%m%d%H%M%S").to_string();
        let id = LocalDocumentIdentity.next_id().unwrap();
        let after = Local::now().format("%y%m%d%H%M%S").to_string();
        assert_eq!(id.len(), 21);
        assert!(id[..12].bytes().all(|b| b.is_ascii_digit()));
        assert!(before.as_str() <= &id[..12] && &id[..12] <= after.as_str());
        assert_eq!(&id[12..13], "-");
        assert!(id[13..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    }
}
