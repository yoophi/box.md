use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikilinkToken {
    pub permalink: String,
    pub alias: Option<String>,
    pub raw: String,
    pub byte_start: usize,
    pub byte_end: usize,
}

// ECMAScript String.trim, as used by the existing editor. Rust's Unicode
// whitespace differs for BOM and NEL, which are possible opaque ID bytes.
pub fn trim_text(text: &str) -> &str {
    text.trim_matches(|c| {
        matches!(
            c,
            '\u{9}'
                | '\u{b}'
                | '\u{c}'
                | '\u{20}'
                | '\u{a0}'
                | '\u{feff}'
                | '\u{a}'
                | '\u{d}'
                | '\u{1680}'
                | '\u{2000}'
                ..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}'
        )
    })
}

/// The Markdown parser determines prose/code/escape boundaries. Box's raw
/// grammar determines identity and alias; parser-decoded destinations never
/// replace opaque permalink bytes or interpret alias markup.
pub fn wikilinks(body: &str, limit: usize) -> (Vec<WikilinkToken>, bool) {
    let options =
        Options::ENABLE_WIKILINKS | Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH;
    let mut tokens = Vec::new();
    for (event, range) in Parser::new_ext(body, options).into_offset_iter() {
        if !matches!(
            event,
            Event::Start(Tag::Link {
                link_type: LinkType::WikiLink { .. },
                ..
            })
        ) {
            continue;
        }
        let raw = &body[range.clone()];
        let Some(inner) = raw.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")) else {
            continue;
        };
        if inner.contains(['[', ']', '\r', '\n']) {
            continue;
        }
        let (permalink, alias) = match inner.split_once('|') {
            Some((id, alias)) => (trim_text(id), Some(trim_text(alias))),
            None => (trim_text(inner), None),
        };
        if permalink.is_empty() || alias == Some("") {
            continue;
        }
        if tokens.len() == limit {
            return (tokens, true);
        }
        tokens.push(WikilinkToken {
            permalink: permalink.into(),
            alias: alias.map(str::to_owned),
            raw: raw.into(),
            byte_start: range.start,
            byte_end: range.end,
        });
    }
    (tokens, false)
}

pub fn first_heading(body: &str) -> Option<String> {
    let options =
        Options::ENABLE_WIKILINKS | Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH;
    let mut heading = None::<String>;
    let mut skip_until = 0;
    for (event, range) in Parser::new_ext(body, options).into_offset_iter() {
        if matches!(event, Event::End(TagEnd::Heading(_))) {
            if let Some(text) = heading.take().filter(|t| !trim_text(t).is_empty()) {
                return Some(trim_text(&text).into());
            }
            continue;
        }
        if matches!(event, Event::Start(Tag::Heading { .. })) {
            heading = Some(String::new());
            continue;
        }
        let Some(text) = heading.as_mut() else {
            continue;
        };
        if range.end <= skip_until {
            continue;
        }
        match event {
            Event::Start(Tag::Link {
                link_type: LinkType::WikiLink { .. },
                ..
            }) => {
                let raw = &body[range.clone()];
                let (tokens, _) = wikilinks(raw, 1);
                if let Some(token) = tokens.first() {
                    text.push_str(token.alias.as_deref().unwrap_or(&token.permalink));
                } else {
                    text.push_str(raw);
                }
                skip_until = range.end;
            }
            Event::Text(value) | Event::Code(value) => text.push_str(&value),
            Event::SoftBreak | Event::HardBreak => text.push(' '),
            _ => (),
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_editor_fixtures_preserve_raw_grammar_and_code_boundaries() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../packages/editor/fixtures/wikilinks.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let (tokens, truncated) = wikilinks(fixture["body"].as_str().unwrap(), 10_000);
            assert!(!truncated);
            let actual: Vec<_> = tokens
                .iter()
                .map(|t| serde_json::json!({"permalink":t.permalink,"alias":t.alias,"raw":t.raw}))
                .collect();
            assert_eq!(
                serde_json::json!(actual),
                fixture["links"],
                "{}",
                fixture["name"]
            );
            for t in tokens {
                assert_eq!(
                    &fixture["body"].as_str().unwrap()[t.byte_start..t.byte_end],
                    t.raw
                );
            }
        }
    }
    #[test]
    fn truncation_is_explicit_and_does_not_split_unicode_tokens() {
        let (tokens, truncated) = wikilinks("[[한글 | 🌱]] [[two]]", 1);
        assert_eq!(tokens.len(), 1);
        assert!(truncated);
        assert_eq!(tokens[0].permalink, "한글");
    }
}
