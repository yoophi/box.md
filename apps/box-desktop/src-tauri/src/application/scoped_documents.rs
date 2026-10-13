use super::document_service::{DocumentService, DocumentStore};
use crate::domain::{
    document::{DocumentError, DocumentSnapshot},
    scoped_document::{
        DocumentDescriptor, DocumentPage, DocumentRef, MetadataSnapshot, ScopedDocument,
        SearchMatch, SearchPage,
    },
};
use box_document_store::{
    document_metadata, document_property, patch_document_metadata, set_document_property,
    ScopedDocumentRepository, ScopedWarning, TrashSnapshot,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

// Bounded work in addition to the filesystem adapter's entry/file limits.
const MAX_SCAN_BYTES: usize = 64 * 1024 * 1024;

fn argument(message: &str) -> DocumentError {
    DocumentError::new("invalidArguments", message)
}
fn optional(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}
pub(super) fn properties(content: &str) -> Result<(Option<String>, Option<String>), DocumentError> {
    let permalink = document_property(content, "permalink")?;
    let summary = document_property(content, "summary")?;
    if permalink.contains(['\r', '\n']) || summary.contains(['\r', '\n']) {
        return Err(DocumentError::new(
            "invalidMetadata",
            "고정 링크와 한 줄 요약은 한 줄 문자열이어야 합니다.",
        ));
    }
    Ok((optional(permalink), optional(summary)))
}
pub(super) fn scoped(document: DocumentSnapshot) -> Result<ScopedDocument, DocumentError> {
    let (permalink, _) = properties(&document.content)?;
    Ok(ScopedDocument {
        document,
        permalink,
    })
}
pub(super) fn metadata(document: &DocumentSnapshot) -> Result<MetadataSnapshot, DocumentError> {
    let (permalink, summary) = properties(&document.content)?;
    Ok(MetadataSnapshot {
        path: document.path.clone(),
        revision: document.revision.clone(),
        metadata: document_metadata(&document.content)?,
        permalink,
        summary,
    })
}

// Called only after the metadata adapter has validated the envelope. Search
// excludes arbitrary header fields, but includes summary/permalink separately.
fn body(content: &str) -> &str {
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let first = text.split_inclusive('\n').next().unwrap_or("");
    fn marker(line: &str) -> &str {
        line.trim_end_matches(['\r', '\n', ' ', '\t'])
    }
    if marker(first) != "---" || !first.ends_with('\n') {
        return content;
    }
    let mut offset = first.len();
    for line in text[offset..].split_inclusive('\n') {
        offset += line.len();
        if matches!(marker(line), "---" | "...") {
            return &text[offset..];
        }
    }
    content
}
fn excerpt(text: &str, query: &str) -> Option<String> {
    let position = text.to_lowercase().find(query)?;
    // Unicode lowercase can change byte length. Map the hit to the original
    // character boundary rather than indexing the original with folded bytes.
    let mut folded = 0;
    let mut start = 0;
    for (offset, c) in text.char_indices() {
        let end = folded + c.to_lowercase().map(char::len_utf8).sum::<usize>();
        if position < end {
            start = offset;
            break;
        }
        folded = end;
    }
    let mut before: Vec<char> = text[..start].chars().rev().take(40).collect();
    before.reverse();
    Some(
        before
            .into_iter()
            .chain(text[start..].chars().take(200))
            .collect(),
    )
}

struct Index {
    documents: Vec<DocumentDescriptor>,
    matches: Vec<SearchMatch>,
    warnings: Vec<ScopedWarning>,
    truncated: bool,
    revision: String,
}
impl Index {
    fn complete(&self) -> Result<(), DocumentError> {
        if self.truncated || !self.warnings.is_empty() {
            return Err(DocumentError::new(
                "workspaceUnavailable",
                "전체 문서의 고정 링크를 확인하지 못했습니다. 목록의 경고를 확인해주세요.",
            ));
        }
        Ok(())
    }
}
impl DocumentStore {
    pub(super) fn scoped_repository(&self) -> Result<&dyn ScopedDocumentRepository, DocumentError> {
        self.scoped.as_deref().ok_or_else(|| {
            DocumentError::new("workspaceUnavailable", "작업 디렉터리를 선택해주세요.")
        })
    }
    fn index(&self, exclude: Option<&str>, query: Option<&str>) -> Result<Index, DocumentError> {
        let listing = self.scoped_repository()?.list()?;
        let mut result = Index {
            documents: vec![],
            matches: vec![],
            warnings: listing.warnings,
            truncated: listing.truncated,
            revision: String::new(),
        };
        let mut scanned = 0usize;
        for path in listing.paths {
            if exclude == Some(path.as_str()) {
                continue;
            }
            let document = match self.repository.read(&path) {
                Ok(document) => document,
                Err(error) => {
                    result.warnings.push(ScopedWarning {
                        path: Some(path),
                        code: error.code,
                    });
                    continue;
                }
            };
            scanned = scanned.saturating_add(document.content.len());
            if scanned > MAX_SCAN_BYTES {
                result.truncated = true;
                result.warnings.push(ScopedWarning {
                    path: Some(path),
                    code: "scanLimit",
                });
                break;
            }
            let (permalink, summary) = match properties(&document.content) {
                Ok(properties) => properties,
                Err(error) => {
                    result.warnings.push(ScopedWarning {
                        path: Some(path.clone()),
                        code: error.code,
                    });
                    result.documents.push(DocumentDescriptor {
                        path,
                        revision: document.revision,
                        permalink: None,
                        summary: None,
                    });
                    continue;
                }
            };
            if let Some(query) = query {
                let excerpts: Vec<_> = [
                    Some(body(&document.content)),
                    summary.as_deref(),
                    permalink.as_deref(),
                ]
                .into_iter()
                .flatten()
                .filter_map(|text| excerpt(text, query))
                .collect();
                if !excerpts.is_empty() {
                    result.matches.push(SearchMatch {
                        document: DocumentDescriptor {
                            path: path.clone(),
                            revision: document.revision.clone(),
                            permalink: permalink.clone(),
                            summary: summary.clone(),
                        },
                        excerpts,
                    });
                }
            }
            result.documents.push(DocumentDescriptor {
                path,
                revision: document.revision,
                permalink,
                summary,
            });
        }
        result
            .warnings
            .sort_by(|a, b| a.path.cmp(&b.path).then_with(|| a.code.cmp(b.code)));
        let bytes = serde_json::to_vec(&(&result.documents, &result.warnings, result.truncated))
            .map_err(|_| DocumentError::new("internal", "문서 목록 상태를 처리하지 못했습니다."))?;
        result.revision = format!("{:x}", Sha256::digest(bytes));
        Ok(result)
    }
    fn resolve(&self, reference: &DocumentRef) -> Result<String, DocumentError> {
        self.scoped_repository()?;
        match reference {
            DocumentRef::Path { path } => {
                self.repository.read(path)?;
                Ok(path.clone())
            }
            DocumentRef::Permalink { permalink } => {
                if permalink.is_empty() {
                    return Err(DocumentError::new(
                        "missingPermalink",
                        "고정 링크를 지정해주세요.",
                    ));
                }
                if permalink.contains(['\r', '\n']) {
                    return Err(argument("한 줄의 고정 링크를 사용해주세요."));
                }
                let index = self.index(None, None)?;
                index.complete()?;
                let mut matches = index
                    .documents
                    .into_iter()
                    .filter(|d| d.permalink.as_ref() == Some(permalink));
                let first = matches.next().ok_or_else(|| {
                    DocumentError::new("notFound", "고정 링크의 문서를 찾지 못했습니다.")
                })?;
                if matches.next().is_some() {
                    return Err(DocumentError::new(
                        "duplicatePermalink",
                        "같은 고정 링크의 문서가 여러 개입니다.",
                    ));
                }
                Ok(first.path)
            }
        }
    }
    pub(super) fn validate_candidate(
        &self,
        path: &str,
        content: &str,
    ) -> Result<(), DocumentError> {
        let (permalink, _) = properties(content)?;
        if let Some(permalink) = permalink {
            let index = self.index(Some(path), None)?;
            index.complete()?;
            if index
                .documents
                .iter()
                .any(|d| d.permalink.as_deref() == Some(&permalink))
            {
                return Err(DocumentError::new(
                    "duplicatePermalink",
                    "다른 문서가 이미 사용하는 고정 링크입니다.",
                ));
            }
        }
        Ok(())
    }
    pub(super) fn record(&self, document: &mut DocumentSnapshot) {
        if let Err(error) = self.history.record(&document.path, &document.content) {
            document.history_warning = Some(error.message);
        }
    }
    pub(super) fn read_reference(
        &self,
        reference: &DocumentRef,
    ) -> Result<DocumentSnapshot, DocumentError> {
        let document = self.repository.read(&self.resolve(reference)?)?;
        if let DocumentRef::Permalink { permalink } = reference {
            if properties(&document.content)?.0.as_ref() != Some(permalink) {
                return Err(DocumentError::new(
                    "conflict",
                    "조회 중 문서 식별자가 변경되었습니다. 다시 조회해주세요.",
                ));
            }
        }
        Ok(document)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cursor {
    generation: String,
    index_revision: String,
    query_hash: String,
    offset: usize,
}
fn paging(
    index: &Index,
    generation: &str,
    query: &str,
    cursor: Option<&str>,
    limit: Option<usize>,
    total: usize,
) -> Result<(usize, usize, Option<String>), DocumentError> {
    let limit = limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(argument("목록 개수는 1~100이어야 합니다."));
    }
    let query_hash = format!("{:x}", Sha256::digest(query.as_bytes()));
    let offset = if let Some(cursor) = cursor {
        if cursor.len() > 4096 {
            return Err(argument("목록 cursor가 올바르지 않습니다."));
        }
        let value: Cursor = serde_json::from_str(cursor)
            .map_err(|_| argument("목록 cursor가 올바르지 않습니다."))?;
        if value.generation != generation
            || value.index_revision != index.revision
            || value.query_hash != query_hash
        {
            return Err(DocumentError::new(
                "staleCursor",
                "목록이 변경되었습니다. 처음부터 조회해주세요.",
            ));
        }
        if value.offset > total {
            return Err(argument("목록 cursor가 올바르지 않습니다."));
        }
        value.offset
    } else {
        0
    };
    let end = offset.saturating_add(limit).min(total);
    let next = if end < total {
        Some(
            serde_json::to_string(&Cursor {
                generation: generation.into(),
                index_revision: index.revision.clone(),
                query_hash,
                offset: end,
            })
            .map_err(|_| DocumentError::new("internal", "목록 cursor를 만들지 못했습니다."))?,
        )
    } else {
        None
    };
    Ok((offset, end, next))
}

impl DocumentService {
    pub fn list_documents(
        &self,
        generation: &str,
        cursor: Option<&str>,
        limit: Option<usize>,
    ) -> Result<DocumentPage, DocumentError> {
        let store = self.lock()?;
        let mut index = store.index(None, None)?;
        let (offset, end, next_cursor) = paging(
            &index,
            generation,
            "list",
            cursor,
            limit,
            index.documents.len(),
        )?;
        let documents = index.documents.drain(offset..end).collect();
        Ok(DocumentPage {
            documents,
            next_cursor,
            warnings: index.warnings,
            truncated: index.truncated,
        })
    }
    pub fn search_documents(
        &self,
        generation: &str,
        query: &str,
        cursor: Option<&str>,
        limit: Option<usize>,
    ) -> Result<SearchPage, DocumentError> {
        if query.trim().is_empty() || query.chars().count() > 1024 {
            return Err(argument(
                "검색어는 비어 있지 않은 1024자 이하 문자열이어야 합니다.",
            ));
        }
        let query = query.to_lowercase();
        let store = self.lock()?;
        let mut index = store.index(None, Some(&query))?;
        let (offset, end, next_cursor) = paging(
            &index,
            generation,
            &format!("search:{query}"),
            cursor,
            limit,
            index.matches.len(),
        )?;
        let matches = index.matches.drain(offset..end).collect();
        Ok(SearchPage {
            matches,
            next_cursor,
            warnings: index.warnings,
            truncated: index.truncated,
        })
    }
    pub fn read_document(&self, reference: &DocumentRef) -> Result<ScopedDocument, DocumentError> {
        let store = self.lock()?;
        scoped(store.read_reference(reference)?)
    }
    pub fn document_permalink(&self, reference: &DocumentRef) -> Result<String, DocumentError> {
        self.read_document(reference)?
            .permalink
            .ok_or_else(|| DocumentError::new("missingPermalink", "문서에 고정 링크가 없습니다."))
    }
    pub fn get_metadata(&self, reference: &DocumentRef) -> Result<MetadataSnapshot, DocumentError> {
        let store = self.lock()?;
        metadata(&store.read_reference(reference)?)
    }
    pub fn create_document(
        &self,
        path: &str,
        content: &str,
    ) -> Result<ScopedDocument, DocumentError> {
        let store = self.lock()?;
        store.scoped_repository()?;
        let (permalink, _) = properties(content)?;
        let content = if permalink.is_none() {
            set_document_property(content, "permalink", &uuid::Uuid::new_v4().to_string())?
        } else {
            content.into()
        };
        store.validate_candidate(path, &content)?;
        scoped(store.write(path, &content, None)?)
    }
    pub fn update_document(
        &self,
        reference: &DocumentRef,
        content: &str,
        expected: &str,
    ) -> Result<ScopedDocument, DocumentError> {
        if expected.is_empty() {
            return Err(argument("현재 revision을 지정해주세요."));
        }
        let store = self.lock()?;
        let current = store.read_reference(reference)?;
        if current.revision != expected {
            return Err(DocumentError::new(
                "conflict",
                "문서가 변경되었습니다. 다시 조회해주세요.",
            ));
        }
        let path = current.path;
        store.validate_candidate(&path, content)?;
        scoped(store.write(&path, content, Some(expected))?)
    }
    pub fn update_metadata(
        &self,
        reference: &DocumentRef,
        patch: &Map<String, Value>,
        remove: &[String],
        expected: &str,
    ) -> Result<(ScopedDocument, MetadataSnapshot), DocumentError> {
        if expected.is_empty() {
            return Err(argument("현재 revision을 지정해주세요."));
        }
        let store = self.lock()?;
        let document = store.read_reference(reference)?;
        if document.revision != expected {
            return Err(DocumentError::new(
                "conflict",
                "문서가 변경되었습니다. 다시 조회해주세요.",
            ));
        }
        let path = document.path.clone();
        let content = patch_document_metadata(&document.content, patch, remove)?;
        // Validate the response's JSON projection before making any write.
        document_metadata(&content)?;
        store.validate_candidate(&path, &content)?;
        let saved = store.write(&path, &content, Some(expected))?;
        let metadata = metadata(&saved)?;
        Ok((scoped(saved)?, metadata))
    }
    pub fn delete_document(
        &self,
        reference: &DocumentRef,
        expected: &str,
    ) -> Result<TrashSnapshot, DocumentError> {
        if expected.is_empty() {
            return Err(argument("현재 revision을 지정해주세요."));
        }
        let store = self.lock()?;
        let current = store.read_reference(reference)?;
        if current.revision != expected {
            return Err(DocumentError::new(
                "conflict",
                "문서가 변경되었습니다. 다시 조회해주세요.",
            ));
        }
        let path = current.path;
        let mut deleted = store.scoped_repository()?.trash(&path, expected)?;
        store.record(&mut deleted.document);
        Ok(deleted)
    }
    pub fn restore_document(&self, trash_id: &str) -> Result<ScopedDocument, DocumentError> {
        let store = self.lock()?;
        let repository = store.scoped_repository()?;
        let retained = repository.read_trash(trash_id)?;
        store.validate_candidate(&retained.path, &retained.content)?;
        let mut restored = repository.restore(trash_id)?;
        store.record(&mut restored);
        scoped(restored)
    }
}

#[cfg(test)]
mod tests;
