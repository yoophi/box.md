use super::{
    document_service::DocumentService,
    scoped_documents::{body, properties},
};
use crate::domain::{
    document::{DocumentError, DocumentSnapshot},
    scoped_document::DocumentRef,
    wikilink::{first_heading, trim_text, wikilinks, WikilinkToken},
};
use box_document_store::{document_property, ScopedWarning};
use serde_json::{json, Value};
use std::collections::HashMap;

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_LINKS: usize = 10_000;
const MAX_BACKLINKS: usize = 1_000;
fn title(doc: &DocumentSnapshot) -> Result<String, DocumentError> {
    let title = document_property(&doc.content, "title")?;
    let title = if !trim_text(&title).is_empty() {
        trim_text(&title).into()
    } else {
        first_heading(body(&doc.content))
            .unwrap_or_else(|| doc.path.rsplit('/').next().unwrap_or(&doc.path).into())
    };
    if title.len() > 8192 {
        return Err(DocumentError::new(
            "titleLimit",
            "대상 제목의 표시 한도를 초과했습니다.",
        ));
    }
    Ok(title)
}
fn descriptor(doc: &DocumentSnapshot) -> Value {
    let mut value = json!({"path":doc.path,"revision":doc.revision});
    if let Some(permalink) = properties(&doc.content).ok().and_then(|p| p.0) {
        value["permalink"] = json!(permalink);
    }
    value
}
fn resolved(
    token: WikilinkToken,
    index: &HashMap<String, Vec<&DocumentSnapshot>>,
    complete: bool,
    cache: &mut HashMap<String, Option<Value>>,
) -> Value {
    let matches = index
        .get(&token.permalink)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut value = serde_json::to_value(&token).expect("token serialization");
    value["state"] = json!(if matches.len() > 1 {
        "duplicate"
    } else if !complete {
        "error"
    } else if matches.is_empty() {
        "missing"
    } else {
        "resolved"
    });
    if value["state"] == "resolved" {
        let target = cache.entry(matches[0].path.clone()).or_insert_with(|| {
            title(matches[0]).ok().map(|title| {
                let mut target = descriptor(matches[0]);
                target["title"] = json!(title);
                target
            })
        });
        match target {
            Some(target) => value["target"] = target.clone(),
            None => value["state"] = json!("error"),
        }
    }
    value
}
impl DocumentService {
    pub fn document_links(&self, reference: &DocumentRef) -> Result<Value, DocumentError> {
        let store = self.lock()?;
        let source = store.read_reference(reference)?;
        let permalink = properties(&source.content)?.0;
        let listing = store.index(None, None)?;
        let mut warnings = listing.warnings;
        let mut truncated = listing.truncated;
        let mut scanned = 0usize;
        let mut docs = Vec::new();
        for entry in listing.documents {
            match store.repository.read(&entry.path) {
                Ok(doc) => {
                    scanned = scanned.saturating_add(doc.content.len());
                    if scanned > MAX_BYTES {
                        truncated = true;
                        warnings.push(ScopedWarning {
                            path: Some(entry.path),
                            code: "scanLimit",
                        });
                        break;
                    }
                    if doc.revision != entry.revision {
                        warnings.push(ScopedWarning {
                            path: Some(entry.path),
                            code: "conflict",
                        });
                        continue;
                    }
                    if let Err(error) = properties(&doc.content) {
                        if !warnings
                            .iter()
                            .any(|w| w.path.as_deref() == Some(&entry.path) && w.code == error.code)
                        {
                            warnings.push(ScopedWarning {
                                path: Some(entry.path),
                                code: error.code,
                            });
                        }
                        continue;
                    }
                    docs.push(doc);
                }
                Err(error) => warnings.push(ScopedWarning {
                    path: Some(entry.path),
                    code: error.code,
                }),
            }
        }
        let mut index = HashMap::<String, Vec<&DocumentSnapshot>>::new();
        for doc in &docs {
            if let Some(id) = properties(&doc.content).ok().and_then(|p| p.0) {
                index.entry(id).or_default().push(doc);
            }
        }
        let complete = !truncated && warnings.is_empty();
        let (tokens, limited) = wikilinks(body(&source.content), MAX_LINKS);
        if limited {
            truncated = true;
            warnings.push(ScopedWarning {
                path: Some(source.path.clone()),
                code: "linkLimit",
            });
        }
        let mut cache = HashMap::new();
        let links: Vec<_> = tokens
            .into_iter()
            .map(|t| resolved(t, &index, complete, &mut cache))
            .collect();
        let mut backlinks = Vec::new();
        let mut remaining = MAX_LINKS.saturating_sub(links.len());
        if let Some(id) = permalink {
            for doc in &docs {
                let (tokens, limited) = wikilinks(body(&doc.content), MAX_LINKS);
                if limited {
                    truncated = true;
                    warnings.push(ScopedWarning {
                        path: Some(doc.path.clone()),
                        code: "linkLimit",
                    });
                }
                let mut links: Vec<_> = tokens
                    .into_iter()
                    .filter(|t| t.permalink == id)
                    .take(remaining.saturating_add(1))
                    .map(|t| resolved(t, &index, complete, &mut cache))
                    .collect();
                let limited_output = links.len() > remaining;
                if limited_output {
                    truncated = true;
                    warnings.push(ScopedWarning {
                        path: Some(doc.path.clone()),
                        code: "backlinkLimit",
                    });
                    links.truncate(remaining);
                }
                if links.is_empty() {
                    if limited_output {
                        break;
                    }
                    continue;
                }
                if backlinks.len() == MAX_BACKLINKS {
                    truncated = true;
                    warnings.push(ScopedWarning {
                        path: None,
                        code: "backlinkLimit",
                    });
                    break;
                }
                remaining -= links.len();
                backlinks.push(json!({"document":descriptor(doc),"links":links}));
                if limited_output {
                    break;
                }
            }
        }
        Ok(
            json!({"document":descriptor(&source),"links":links,"backlinks":backlinks,"warnings":warnings,"truncated":truncated}),
        )
    }
}
