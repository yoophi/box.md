use crate::DocumentError;
use serde_json::{Map, Value};
use std::collections::HashSet;
use yaml_rt_core::{
    CollectionStyle, NodeId, NodeKind, ResolvedScalar, SemanticKind, Source, TokenKind, YamlDoc,
    YamlNumber, YamlScalarStyle, lex, resolve_scalar,
};

const MAX_HEADER: usize = 8 * 1024 * 1024;
const MAX_DEPTH: usize = 128;
const MAX_NODES: usize = 100_000;
const MAX_COMPARISONS: usize = 1_000_000;
const MAX_SAFE_INTEGER: i128 = 9_007_199_254_740_991;

fn invalid() -> DocumentError {
    DocumentError::new(
        "invalidMetadata",
        "YAML frontmatter의 형식 또는 값이 지원되지 않습니다.",
    )
}
fn bounded() -> DocumentError {
    DocumentError::new(
        "invalidMetadata",
        "YAML frontmatter의 복잡도 제한을 초과했습니다.",
    )
}

struct Envelope<'a> {
    opening: &'a str,
    raw: &'a str,
    suffix: &'a str,
}
fn line_content(line: &str) -> &str {
    match line.strip_suffix('\n') {
        Some(line) => line.strip_suffix('\r').unwrap_or(line),
        None => line,
    }
}
fn delimiter(line: &str, marker: &str) -> bool {
    line_content(line).trim_end_matches([' ', '\t']) == marker
}
fn envelope(markdown: &str) -> Result<Option<Envelope<'_>>, DocumentError> {
    let without_bom = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    let first = without_bom.split_inclusive('\n').next().unwrap_or("");
    if !first.ends_with('\n') || !delimiter(first, "---") {
        return Ok(None);
    }
    let opening_len = markdown.len() - without_bom.len() + first.len();
    let rest = &markdown[opening_len..];
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if delimiter(line, "---") || delimiter(line, "...") {
            if offset > MAX_HEADER {
                return Err(bounded());
            }
            return Ok(Some(Envelope {
                opening: &markdown[..opening_len],
                raw: &rest[..offset],
                suffix: &rest[offset..],
            }));
        }
        offset += line.len();
        if offset > MAX_HEADER {
            return Err(bounded());
        }
    }
    Err(DocumentError::new(
        "invalidMetadata",
        "YAML frontmatter의 닫는 구분자가 없습니다.",
    ))
}

#[derive(Default)]
struct Validation {
    active: HashSet<NodeId>,
    visited: HashSet<NodeId>,
    nodes: usize,
    comparisons: usize,
    key_nodes: usize,
}
impl Validation {
    fn visit(&mut self, doc: &YamlDoc, node: NodeId, depth: usize) -> Result<(), DocumentError> {
        self.nodes += 1;
        if depth > MAX_DEPTH || self.nodes > MAX_NODES {
            return Err(bounded());
        }
        if self.visited.contains(&node) {
            return Ok(());
        }
        if !self.active.insert(node) {
            return Err(invalid());
        }
        let kind = doc.semantic_kind(node).ok_or_else(invalid)?;
        match kind {
            SemanticKind::Alias => {
                self.visit(doc, doc.resolve_alias(node).ok_or_else(invalid)?, depth + 1)?
            }
            SemanticKind::Mapping { .. } => {
                let entries: Vec<_> = doc.mapping_entries(node).collect();
                for (key, value) in &entries {
                    self.visit(doc, *key, depth + 1)?;
                    self.visit(doc, *value, depth + 1)?;
                }
                let keys = entries
                    .iter()
                    .map(|(key, _)| key_identity(doc, *key, 0, &mut self.key_nodes))
                    .collect::<Result<Vec<_>, _>>()?;
                for (i, key) in keys.iter().enumerate() {
                    for other in &keys[..i] {
                        self.comparisons += 1;
                        if self.comparisons > MAX_COMPARISONS {
                            return Err(bounded());
                        }
                        if key == other {
                            return Err(invalid());
                        }
                    }
                }
            }
            SemanticKind::Sequence { .. } => {
                for item in doc.sequence_items(node) {
                    self.visit(doc, item, depth + 1)?;
                }
            }
            SemanticKind::Scalar { .. } => (),
            SemanticKind::Document => return Err(invalid()),
        }
        self.active.remove(&node);
        self.visited.insert(node);
        Ok(())
    }
}
struct Header {
    doc: YamlDoc,
    prefix: Option<&'static str>,
}
impl std::ops::Deref for Header {
    type Target = YamlDoc;
    fn deref(&self) -> &YamlDoc {
        &self.doc
    }
}
impl std::ops::DerefMut for Header {
    fn deref_mut(&mut self) -> &mut YamlDoc {
        &mut self.doc
    }
}
impl Header {
    fn output(&self) -> Result<String, DocumentError> {
        let output = self.doc.to_string();
        match self.prefix {
            Some(prefix) => output
                .strip_prefix(prefix)
                .map(str::to_owned)
                .ok_or_else(invalid),
            None => Ok(output),
        }
    }
}
fn root(doc: &Header) -> Result<Option<NodeId>, DocumentError> {
    if doc.document_count() == 0 {
        Ok(None)
    } else {
        let root = doc.document_root(0).map_err(|_| invalid())?;
        if doc.prefix.is_some() {
            let Some(root) = root else {
                return Err(invalid());
            };
            let entries: Vec<_> = doc.mapping_entries(root).collect();
            if entries.len() != 1 {
                return Err(invalid());
            }
            let value = entries[0].1;
            Ok(Some(value)
                .filter(|node| !doc.node(*node).is_some_and(|node| node.span().is_empty())))
        } else {
            Ok(root)
        }
    }
}
fn yaml(raw: &str) -> Result<Header, DocumentError> {
    if raw.len() > MAX_HEADER {
        return Err(bounded());
    }
    // The crate rejects a valid indented document root without a parent.
    // Supply a private parent only to the parser; no original bytes are
    // dedented, and the exact prefix is removed before returning output.
    let indented = raw
        .lines()
        .find(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#'))
        .is_some_and(|line| line.starts_with(' '));
    let prefix = indented.then_some(
        if raw
            .split_inclusive('\n')
            .next()
            .is_some_and(|line| line.ends_with("\r\n"))
        {
            "__box_frontmatter__:\r\n"
        } else {
            "__box_frontmatter__:\n"
        },
    );
    let source = prefix.map_or_else(|| raw.into(), |prefix| format!("{prefix}{raw}"));
    let doc = Header {
        doc: YamlDoc::parse(&source).map_err(|_| invalid())?,
        prefix,
    };
    if doc.document_count() > 1
        || doc.yaml_directive().is_some()
        || !doc.tag_directives().is_empty()
        || !doc.reserved_directives().is_empty()
    {
        return Err(invalid());
    }
    if let Some(root) = root(&doc)? {
        if !matches!(doc.semantic_kind(root), Some(SemanticKind::Mapping { .. })) {
            return Err(invalid());
        }
        Validation::default().visit(&doc, root, 0)?;
    }
    Ok(doc)
}
fn scalar(doc: &YamlDoc, node: NodeId) -> Result<(ResolvedScalar, String), DocumentError> {
    let Some(SemanticKind::Scalar { style }) = doc.semantic_kind(node) else {
        return Err(invalid());
    };
    let text = doc.scalar_value(node).map_err(|_| invalid())?.into_owned();
    let tag = doc.resolved_tag(node).map_err(|_| invalid())?;
    let tag = if tag.as_deref() == Some("!") {
        Some("tag:yaml.org,2002:str")
    } else {
        tag.as_deref()
    };
    let value = resolve_core(&text, style, tag)?;
    Ok((value, text))
}
fn digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit())
}
fn unsigned(value: &str) -> &str {
    value.strip_prefix(['+', '-']).unwrap_or(value)
}
fn float_spelling(value: &str) -> bool {
    let unsigned = unsigned(value);
    if matches!(unsigned, ".inf" | ".Inf" | ".INF") || matches!(value, ".nan" | ".NaN" | ".NAN") {
        return true;
    }
    let (mantissa, exponent) = match unsigned.find(['e', 'E']) {
        Some(index) => (&unsigned[..index], Some(&unsigned[index + 1..])),
        None => (unsigned, None),
    };
    if exponent.is_some_and(|e| !digits(self::unsigned(e))) {
        return false;
    }
    match mantissa.split_once('.') {
        Some((whole, fraction)) => {
            (whole.is_empty() || digits(whole))
                && (fraction.is_empty() || digits(fraction))
                && !(whole.is_empty() && fraction.is_empty())
        }
        None => exponent.is_some() && digits(mantissa),
    }
}
// Match the app's YAML 1.2 core schema. The crate also accepts binary,
// underscore and signed radix numbers, while its decimal integer resolver
// rejects leading zeros; none of those differences should leak into the app.
fn resolve_core(
    text: &str,
    style: YamlScalarStyle,
    tag: Option<&str>,
) -> Result<ResolvedScalar, DocumentError> {
    let implicit = style == YamlScalarStyle::Plain && tag.is_none();
    if implicit || tag == Some("tag:yaml.org,2002:int") {
        let body = unsigned(text);
        if digits(body) {
            let trimmed = body.trim_start_matches('0');
            let normalized = format!(
                "{}{}",
                if text.starts_with('-') { "-" } else { "" },
                if trimmed.is_empty() { "0" } else { trimmed }
            );
            return resolve_scalar(
                &normalized,
                YamlScalarStyle::Plain,
                Some("tag:yaml.org,2002:int"),
            )
            .map_err(|_| invalid());
        }
        let radix = text
            .strip_prefix("0x")
            .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit()))
            || text
                .strip_prefix("0o")
                .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| matches!(b, b'0'..=b'7')));
        if radix {
            return resolve_scalar(text, YamlScalarStyle::Plain, Some("tag:yaml.org,2002:int"))
                .map_err(|_| invalid());
        }
        if tag.is_some() {
            return Err(invalid());
        }
    }
    if implicit && float_spelling(text) {
        return resolve_scalar(text, style, Some("tag:yaml.org,2002:float")).map_err(|_| invalid());
    }
    let resolved = resolve_scalar(text, style, tag).map_err(|_| invalid())?;
    if implicit
        && matches!(
            resolved,
            ResolvedScalar::Number(_) | ResolvedScalar::NonFinite(_)
        )
    {
        Ok(ResolvedScalar::String)
    } else {
        Ok(resolved)
    }
}
fn resolve_alias(doc: &YamlDoc, mut node: NodeId) -> Result<NodeId, DocumentError> {
    let mut seen = HashSet::new();
    while matches!(doc.semantic_kind(node), Some(SemanticKind::Alias)) {
        if !seen.insert(node) || seen.len() > MAX_DEPTH {
            return Err(invalid());
        }
        node = doc.resolve_alias(node).ok_or_else(invalid)?;
    }
    Ok(node)
}
// yaml-rt-core 0.3.2's semantically_equal compares scalar type tokens and
// considers all strings equal. Keep actual decoded strings in key identity.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum Key {
    Null,
    Bool(bool),
    Number(YamlNumber),
    NonFinite(String),
    String(String),
    Sequence(Vec<Key>),
    Mapping(Vec<(Key, Key)>),
    Tagged(String, Box<Key>),
}
fn key_identity(
    doc: &YamlDoc,
    node: NodeId,
    depth: usize,
    count: &mut usize,
) -> Result<Key, DocumentError> {
    *count += 1;
    if depth > MAX_DEPTH || *count > MAX_NODES {
        return Err(bounded());
    }
    let node = resolve_alias(doc, node)?;
    let tag = doc.resolved_tag(node).map_err(|_| invalid())?;
    let kind = doc.semantic_kind(node).ok_or_else(invalid)?;
    let standard = match kind {
        SemanticKind::Mapping { .. } => Some("tag:yaml.org,2002:map"),
        SemanticKind::Sequence { .. } => Some("tag:yaml.org,2002:seq"),
        _ => None,
    };
    let identity = match kind {
        SemanticKind::Mapping { .. } => {
            let mut entries = doc
                .mapping_entries(node)
                .map(|(key, value)| {
                    Ok((
                        key_identity(doc, key, depth + 1, count)?,
                        key_identity(doc, value, depth + 1, count)?,
                    ))
                })
                .collect::<Result<Vec<_>, DocumentError>>()?;
            entries.sort();
            Key::Mapping(entries)
        }
        SemanticKind::Sequence { .. } => Key::Sequence(
            doc.sequence_items(node)
                .map(|n| key_identity(doc, n, depth + 1, count))
                .collect::<Result<_, _>>()?,
        ),
        SemanticKind::Scalar { .. } => {
            let (kind, text) = legacy_scalar(doc, node)?;
            match kind {
                ResolvedScalar::Null => Key::Null,
                ResolvedScalar::Bool(b) => Key::Bool(b),
                ResolvedScalar::Number(n) => Key::Number(n),
                ResolvedScalar::NonFinite(n) => Key::NonFinite(format!("{n:?}")),
                ResolvedScalar::String => Key::String(text),
            }
        }
        _ => return Err(invalid()),
    };
    match tag {
        Some(tag) if standard.is_some() && tag != "!" && Some(tag.as_ref()) != standard => {
            Ok(Key::Tagged(tag.into_owned(), Box::new(identity)))
        }
        _ => Ok(identity),
    }
}
fn member(doc: &Header, key: &str) -> Result<Option<NodeId>, DocumentError> {
    let Some(root) = root(doc)? else {
        return Ok(None);
    };
    let mut found = None;
    for (name, value) in doc.mapping_entries(root) {
        if matches!(doc.semantic_kind(name), Some(SemanticKind::Scalar { .. })) {
            let (kind, text) = legacy_scalar(doc, name)?;
            if kind == ResolvedScalar::String && text == key && found.replace(value).is_some() {
                return Err(invalid());
            }
        }
    }
    Ok(found)
}

/// The existing TS getter contract: missing/null is empty, other types fail.
pub fn document_property(markdown: &str, key: &str) -> Result<String, DocumentError> {
    let Some(parts) = envelope(markdown)? else {
        return Ok(String::new());
    };
    let doc = yaml(parts.raw)?;
    let Some(node) = member(&doc, key)? else {
        return Ok(String::new());
    };
    let (value, text) = legacy_scalar(&doc, node)?;
    match value {
        ResolvedScalar::String => Ok(text),
        ResolvedScalar::Null => Ok(String::new()),
        _ => Err(invalid()),
    }
}
fn legacy_scalar(doc: &YamlDoc, node: NodeId) -> Result<(ResolvedScalar, String), DocumentError> {
    // TS doc.get() returns alias/collection nodes, not their resolved scalar.
    let Some(SemanticKind::Scalar { style }) = doc.semantic_kind(node) else {
        return Err(invalid());
    };
    let text = doc.scalar_value(node).map_err(|_| invalid())?.into_owned();
    let tag = doc.resolved_tag(node).map_err(|_| invalid())?;
    let tag = if tag.as_deref() == Some("!") {
        Some("tag:yaml.org,2002:str")
    } else {
        tag.as_deref()
    };
    // The existing TS reader keeps unresolved scalar tags as strings (parser
    // warnings). JSON projection below remains strict about tagged values.
    if tag == Some("tag:yaml.org,2002:float") && !float_spelling(&text) {
        return Ok((ResolvedScalar::String, text));
    }
    let value = match resolve_core(&text, style, tag) {
        Ok(value) => value,
        Err(_) if tag.is_some() => return Ok((ResolvedScalar::String, text)),
        Err(error) => return Err(error),
    };
    Ok((value, text))
}

struct Projection {
    active: HashSet<NodeId>,
    count: usize,
}
impl Projection {
    fn value(&mut self, doc: &YamlDoc, node: NodeId, depth: usize) -> Result<Value, DocumentError> {
        self.count += 1;
        if depth > MAX_DEPTH || self.count > MAX_NODES {
            return Err(bounded());
        }
        if !self.active.insert(node) {
            return Err(invalid());
        }
        let kind = doc.semantic_kind(node).ok_or_else(invalid)?;
        let tag = doc.resolved_tag(node).map_err(|_| invalid())?;
        let result = match kind {
            SemanticKind::Alias => {
                self.value(doc, doc.resolve_alias(node).ok_or_else(invalid)?, depth + 1)?
            }
            SemanticKind::Mapping { .. } => {
                if tag
                    .as_deref()
                    .is_some_and(|t| t != "tag:yaml.org,2002:map" && t != "!")
                {
                    return Err(invalid());
                }
                let mut map = Map::new();
                for (key, value) in doc.mapping_entries(node) {
                    let (kind, key) = scalar(doc, resolve_alias(doc, key)?)?;
                    if kind != ResolvedScalar::String {
                        return Err(invalid());
                    }
                    if map
                        .insert(key, self.value(doc, value, depth + 1)?)
                        .is_some()
                    {
                        return Err(invalid());
                    }
                }
                Value::Object(map)
            }
            SemanticKind::Sequence { .. } => {
                if tag
                    .as_deref()
                    .is_some_and(|t| t != "tag:yaml.org,2002:seq" && t != "!")
                {
                    return Err(invalid());
                }
                Value::Array(
                    doc.sequence_items(node)
                        .map(|item| self.value(doc, item, depth + 1))
                        .collect::<Result<_, _>>()?,
                )
            }
            SemanticKind::Scalar { .. } => match scalar(doc, node)? {
                (ResolvedScalar::Null, _) => Value::Null,
                (ResolvedScalar::Bool(b), _) => Value::Bool(b),
                (ResolvedScalar::String, s) => Value::String(s),
                (ResolvedScalar::Number(number), _) => {
                    if number.has_integer_syntax() {
                        let approximate = number
                            .as_f64()
                            .filter(|v| v.is_finite())
                            .ok_or_else(invalid)?;
                        if approximate.abs() > MAX_SAFE_INTEGER as f64 {
                            return Err(invalid());
                        }
                        let value = number.as_i128().ok_or_else(invalid)?;
                        if !(-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value) {
                            return Err(invalid());
                        }
                        Value::Number((value as i64).into())
                    } else {
                        let value = number
                            .as_f64()
                            .filter(|v| v.is_finite())
                            .ok_or_else(invalid)?;
                        Value::Number(serde_json::Number::from_f64(value).ok_or_else(invalid)?)
                    }
                }
                (ResolvedScalar::NonFinite(_), _) => return Err(invalid()),
            },
            SemanticKind::Document => return Err(invalid()),
        };
        self.active.remove(&node);
        Ok(result)
    }
}
/// JSON projection is explicit; unrepresentable YAML is never silently omitted.
pub fn document_metadata(markdown: &str) -> Result<Map<String, Value>, DocumentError> {
    let Some(parts) = envelope(markdown)? else {
        return Ok(Map::new());
    };
    let doc = yaml(parts.raw)?;
    let Some(node) = root(&doc)? else {
        return Ok(Map::new());
    };
    let Value::Object(map) = (Projection {
        active: HashSet::new(),
        count: 0,
    })
    .value(&doc, node, 0)?
    else {
        return Err(invalid());
    };
    Ok(map)
}

fn node_ids(doc: &YamlDoc) -> Vec<NodeId> {
    let mut result = Vec::new();
    let mut stack: Vec<_> = doc.documents().collect();
    while let Some(node) = stack.pop() {
        result.push(node);
        stack.extend(doc.children(node));
    }
    result
}
fn safe_to_change(doc: &YamlDoc, target: NodeId) -> Result<(), DocumentError> {
    let span = doc.node(target).ok_or_else(invalid)?.span();
    let nodes = node_ids(doc);
    let owned: HashSet<_> = nodes
        .iter()
        .copied()
        .filter(|node| {
            doc.anchor(*node).is_some()
                && doc.node(*node).is_some_and(|node| {
                    node.span().start >= span.start && node.span().end <= span.end
                })
        })
        .collect();
    for alias in nodes {
        if matches!(doc.semantic_kind(alias), Some(SemanticKind::Alias))
            && doc
                .resolve_alias(alias)
                .is_some_and(|node| owned.contains(&node))
        {
            let alias_span = doc.node(alias).ok_or_else(invalid)?.span();
            if alias_span.start < span.start || alias_span.end > span.end {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
fn replace_scalar(doc: &mut YamlDoc, node: NodeId, mut json: String) -> Result<(), DocumentError> {
    let span = doc.node(node).ok_or_else(invalid)?.span();
    let raw = &doc.as_source()[span.start as usize..span.end as usize];
    let block = matches!(
        doc.semantic_kind(node),
        Some(SemanticKind::Scalar {
            style: YamlScalarStyle::Literal | YamlScalarStyle::Folded
        })
    );
    let scanned = if block {
        raw.split_inclusive('\n').next().unwrap_or(raw)
    } else {
        raw
    };
    let source = Source::new(scanned.into()).map_err(|_| invalid())?;
    let comment = lex(&source)
        .map_err(|_| invalid())?
        .into_iter()
        .find(|token| token.kind == TokenKind::Comment);
    let has_comment = comment.is_some();
    if let Some(comment) = comment {
        let start = scanned[..comment.span.start as usize]
            .trim_end_matches([' ', '\t'])
            .len();
        json.push_str(&scanned[start..comment.span.end as usize]);
        if !block {
            json.push_str(&raw[comment.span.end as usize..]);
        }
    }
    if (block || !has_comment) && raw.ends_with('\n') {
        json.push_str(if raw.ends_with("\r\n") { "\r\n" } else { "\n" });
    }
    doc.replace_node_text(node, json).map_err(|_| invalid())
}
fn insert_member(doc: &mut Header, key: &str, json: &str) -> Result<(), DocumentError> {
    let root = root(doc)?.ok_or_else(invalid)?;
    let span = doc.node(root).ok_or_else(invalid)?.span();
    let raw = &doc.as_source()[span.start as usize..span.end as usize];
    let key = serde_json::to_string(key).map_err(|_| invalid())?;
    let replacement = match doc.semantic_kind(root) {
        Some(SemanticKind::Mapping {
            style: CollectionStyle::Flow,
        }) => {
            let source = Source::new(raw.into()).map_err(|_| invalid())?;
            let tokens = lex(&source).map_err(|_| invalid())?;
            let closing = tokens
                .iter()
                .rfind(|t| t.kind == TokenKind::FlowMappingEnd)
                .ok_or_else(invalid)?
                .span
                .start as usize;
            let trailing_comma = tokens
                .iter()
                .rfind(|t| {
                    (t.span.end as usize) <= closing
                        && !matches!(
                            t.kind,
                            TokenKind::Whitespace | TokenKind::Newline | TokenKind::Comment
                        )
                })
                .is_some_and(|t| t.kind == TokenKind::Comma);
            let comma = if doc.mapping_entries(root).next().is_some() && !trailing_comma {
                ", "
            } else {
                " "
            };
            format!("{}{comma}{key}: {json}{}", &raw[..closing], &raw[closing..])
        }
        Some(SemanticKind::Mapping {
            style: CollectionStyle::Block,
        }) => {
            let first = doc.as_source().split_inclusive('\n').next().unwrap_or("");
            let newline = if first.ends_with("\r\n") {
                "\r\n"
            } else {
                "\n"
            };
            let line_prefix = doc.as_source()[..span.start as usize]
                .rsplit('\n')
                .next()
                .unwrap_or("");
            let indent = line_prefix.chars().take_while(|c| *c == ' ').count()
                + raw.chars().take_while(|c| *c == ' ').count();
            format!(
                "{raw}{}{space}{key}: {json}{newline}",
                if raw.ends_with('\n') { "" } else { newline },
                space = " ".repeat(indent)
            )
        }
        _ => return Err(invalid()),
    };
    // Preserve the original source literally; insert a quoted new key rather
    // than letting the crate misclassify numeric-looking string keys.
    doc.replace_node_text(root, replacement)
        .map_err(|_| invalid())
}
fn remove_member(doc: &mut Header, value: NodeId) -> Result<(), DocumentError> {
    let root = root(doc)?.ok_or_else(invalid)?;
    let mut entry = value;
    while doc.node(entry).ok_or_else(invalid)?.kind() != NodeKind::MappingEntry {
        entry = doc
            .node(entry)
            .ok_or_else(invalid)?
            .parent()
            .ok_or_else(invalid)?;
    }
    if doc.node(entry).ok_or_else(invalid)?.parent() != Some(root) {
        return Err(invalid());
    }
    if matches!(
        doc.semantic_kind(root),
        Some(SemanticKind::Mapping {
            style: CollectionStyle::Block
        })
    ) {
        return doc.remove_node(entry).map_err(|_| invalid());
    }
    let span = doc.node(root).ok_or_else(invalid)?.span();
    let target = doc.node(entry).ok_or_else(invalid)?.span();
    let raw = &doc.as_source()[span.start as usize..span.end as usize];
    let entries: Vec<_> = doc
        .children(root)
        .filter(|n| {
            doc.node(*n)
                .is_some_and(|n| n.kind() == NodeKind::MappingEntry)
        })
        .collect();
    let index = entries
        .iter()
        .position(|n| *n == entry)
        .ok_or_else(invalid)?;
    let source = Source::new(raw.into()).map_err(|_| invalid())?;
    let tokens = lex(&source).map_err(|_| invalid())?;
    let comma = if entries.len() == 1 {
        tokens
            .iter()
            .find(|t| t.kind == TokenKind::Comma && t.span.start + span.start >= target.end)
            .map(|t| t.span)
    } else {
        let (from, to) = if index + 1 < entries.len() {
            (
                target.end,
                doc.node(entries[index + 1])
                    .ok_or_else(invalid)?
                    .span()
                    .start,
            )
        } else {
            (
                doc.node(entries[index - 1]).ok_or_else(invalid)?.span().end,
                target.start,
            )
        };
        Some(
            tokens
                .iter()
                .find(|t| {
                    t.kind == TokenKind::Comma
                        && t.span.start + span.start >= from
                        && t.span.end + span.start <= to
                })
                .ok_or_else(invalid)?
                .span,
        )
    };
    let mut ranges = vec![(
        target.start as usize - span.start as usize,
        target.end as usize - span.start as usize,
    )];
    if let Some(comma) = comma {
        ranges.push((comma.start as usize, comma.end as usize));
    }
    ranges.sort_unstable();
    let mut output = String::new();
    let mut offset = 0;
    for (start, end) in ranges {
        output.push_str(&raw[offset..start]);
        offset = end;
    }
    output.push_str(&raw[offset..]);
    doc.replace_node_text(root, output).map_err(|_| invalid())
}
fn edit_one(doc: &mut Header, key: &str, value: Option<&Value>) -> Result<(), DocumentError> {
    let existing = member(doc, key)?;
    if let Some(existing) = existing {
        safe_to_change(doc, existing)?;
    }
    match value {
        Some(value) => {
            let json = serde_json::to_string(value).map_err(|_| invalid())?;
            if let Some(node) = existing.filter(|node| {
                matches!(
                    doc.semantic_kind(*node),
                    Some(SemanticKind::Scalar { .. } | SemanticKind::Alias)
                )
            }) {
                // Avoid retaining an old scalar tag/style that changes the
                // JSON type. This replaces only the selected CST value span.
                replace_scalar(doc, node, json)?;
            } else if let Some(node) = existing {
                let span = doc.node(node).ok_or_else(invalid)?.span();
                let raw = &doc.as_source()[span.start as usize..span.end as usize];
                let replacement = format!(
                    "{json}{}",
                    if raw.ends_with("\r\n") {
                        "\r\n"
                    } else if raw.ends_with('\n') {
                        "\n"
                    } else {
                        ""
                    }
                );
                doc.replace_node_text(node, replacement)
                    .map_err(|_| invalid())?;
            } else {
                insert_member(doc, key, &json)?;
            }
        }
        None if existing.is_some() => remove_member(doc, existing.ok_or_else(invalid)?)?,
        None => return Ok(()),
    }
    doc.commit_edits().map_err(|_| invalid())?;
    Ok(())
}

/// Applies top-level JSON values using source patches, never whole YAML output.
/// Failure returns no replacement; this pure adapter never writes files.
pub fn patch_document_metadata(
    markdown: &str,
    patch: &Map<String, Value>,
    remove: &[String],
) -> Result<String, DocumentError> {
    let removed: HashSet<_> = remove.iter().collect();
    if removed.len() != remove.len() || patch.keys().any(|key| removed.contains(key)) {
        return Err(invalid());
    }
    for key in ["summary", "permalink"] {
        if let Some(value) = patch.get(key)
            && !value.as_str().is_some_and(|s| !s.contains(['\r', '\n']))
        {
            return Err(invalid());
        }
    }
    let parts = envelope(markdown)?;
    let mut doc = yaml(parts.as_ref().map_or("", |p| p.raw))?;
    let mut changes = false;
    for key in remove {
        changes |= member(&doc, key)?.is_some();
    }
    for (key, value) in patch {
        changes |= if matches!(key.as_str(), "summary" | "permalink") && value.as_str() == Some("")
        {
            member(&doc, key)?.is_some()
        } else {
            true
        };
    }
    if !changes {
        return Ok(markdown.into());
    }
    if root(&doc)?.is_none() {
        let newline = parts.as_ref().map_or("\n", |p| {
            if p.opening.ends_with("\r\n") {
                "\r\n"
            } else {
                "\n"
            }
        });
        let raw = parts.as_ref().map_or("", |p| p.raw);
        doc = yaml(&format!("{raw}{{}}{newline}"))?;
    }
    for key in remove {
        edit_one(&mut doc, key, None)?;
    }
    for (key, value) in patch {
        let value = if matches!(key.as_str(), "summary" | "permalink") && value.as_str() == Some("")
        {
            None
        } else {
            Some(value)
        };
        edit_one(&mut doc, key, value)?;
    }
    let raw = doc.output()?;
    yaml(&raw)?;
    // Preserving an old explicit tag or scalar style must not silently change
    // the JSON type intended by the patch.
    for (key, value) in patch {
        if matches!(key.as_str(), "summary" | "permalink") && value.as_str() == Some("") {
            if member(&doc, key)?.is_some() {
                return Err(invalid());
            }
        } else {
            let node = member(&doc, key)?.ok_or_else(invalid)?;
            let actual = (Projection {
                active: HashSet::new(),
                count: 0,
            })
            .value(&doc, node, 0)?;
            if actual != *value {
                return Err(invalid());
            }
        }
    }
    let candidate = if let Some(parts) = parts {
        format!("{}{}{}", parts.opening, raw, parts.suffix)
    } else {
        let bom = if markdown.starts_with('\u{feff}') {
            "\u{feff}"
        } else {
            ""
        };
        format!("{bom}---\n{raw}---\n{}", &markdown[bom.len()..])
    };
    // Prevent a generated marker line from changing the envelope boundary.
    let saved = envelope(&candidate)?.ok_or_else(invalid)?;
    if saved.raw != raw {
        return Err(invalid());
    }
    Ok(candidate)
}

pub fn set_document_property(
    markdown: &str,
    key: &str,
    value: &str,
) -> Result<String, DocumentError> {
    if key.is_empty()
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        || value.contains(['\r', '\n'])
    {
        return Err(invalid());
    }
    if value.is_empty() {
        patch_document_metadata(markdown, &Map::new(), &[key.into()])
    } else {
        patch_document_metadata(
            markdown,
            &Map::from_iter([(key.into(), Value::String(value.into()))]),
            &[],
        )
    }
}
