use super::{
    document_mutations::{DocumentMutation, MutationResult},
    document_service::{DocumentService, DocumentStore},
    scoped_documents::{metadata, properties, scoped},
};
use crate::domain::{
    document::{DocumentError, DocumentSnapshot},
    scoped_document::DocumentRef,
};
use box_document_store::{patch_document_metadata, set_document_property};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

// Scoped history adapters already sanitize exceptions. A fixed warning in the
// tool result also makes its pre-write reservation independent of error size.
const HISTORY_WARNING: &str = "문서 변경은 완료했지만 이력을 기록하지 못했습니다.";
fn snapshot(path: &str, content: String) -> DocumentSnapshot {
    DocumentSnapshot {
        path: path.into(),
        revision: format!("{:x}", Sha256::digest(content.as_bytes())),
        content,
        history_warning: Some(HISTORY_WARNING.into()),
    }
}
fn document_value(document: &DocumentSnapshot) -> Result<Value, DocumentError> {
    serde_json::to_value(scoped(document.clone())?)
        .map_err(|_| DocumentError::new("internal", "문서 응답을 준비하지 못했습니다."))
}
fn finish_document(value: &mut Value, saved: DocumentSnapshot) {
    value["historyWarning"] = if saved.history_warning.is_some() {
        json!(HISTORY_WARNING)
    } else {
        Value::Null
    };
}
impl DocumentStore {
    fn expected(
        &self,
        reference: &DocumentRef,
        revision: &str,
    ) -> Result<DocumentSnapshot, DocumentError> {
        let current = self.read_reference(reference)?;
        if current.revision != revision {
            return Err(DocumentError::new(
                "conflict",
                "문서가 변경되었습니다. 다시 조회해주세요.",
            ));
        }
        Ok(current)
    }
    fn planned(&self, path: &str, content: String) -> Result<DocumentSnapshot, DocumentError> {
        if content.len() > 8 * 1024 * 1024 {
            return Err(DocumentError::new(
                "documentTooLarge",
                "문서 크기 제한을 초과했습니다.",
            ));
        }
        self.validate_candidate(path, &content)?;
        Ok(snapshot(path, content))
    }
}
impl DocumentService {
    /// Preparation, result reservation, filesystem CAS and history all run under
    /// the same mutex used by native UI saves. Only the accepted worker calls this.
    pub(super) fn execute_mutation(
        &self,
        mutation: DocumentMutation,
        reserve: impl FnOnce(&Value) -> Result<(), DocumentError>,
    ) -> MutationResult {
        let store = self.lock()?;
        store.scoped_repository()?;
        match mutation {
            DocumentMutation::Create { path, content } => {
                let content = if properties(&content)?.0.is_none() {
                    set_document_property(&content, "permalink", &uuid::Uuid::new_v4().to_string())?
                } else {
                    content
                };
                let planned = store.planned(&path, content)?;
                let mut value = json!({"document": document_value(&planned)?});
                reserve(&value)?;
                let saved = store.write(&path, &planned.content, None)?;
                finish_document(&mut value["document"], saved);
                Ok(value)
            }
            DocumentMutation::Update {
                document,
                content,
                expected_revision,
            } => {
                let current = store.expected(&document, &expected_revision)?;
                let planned = store.planned(&current.path, content)?;
                let mut value = json!({"document": document_value(&planned)?});
                reserve(&value)?;
                let saved =
                    store.write(&planned.path, &planned.content, Some(&expected_revision))?;
                finish_document(&mut value["document"], saved);
                Ok(value)
            }
            DocumentMutation::UpdateMetadata {
                document,
                patch,
                remove,
                expected_revision,
            } => {
                let current = store.expected(&document, &expected_revision)?;
                let content = patch_document_metadata(&current.content, &patch, &remove)?;
                let planned = store.planned(&current.path, content)?;
                // Build the exact metadata projection before publication.
                let projection = metadata(&planned)?;
                let mut value =
                    json!({"document": document_value(&planned)?, "metadata": projection});
                reserve(&value)?;
                let saved =
                    store.write(&planned.path, &planned.content, Some(&expected_revision))?;
                finish_document(&mut value["document"], saved);
                Ok(value)
            }
            DocumentMutation::Delete {
                document,
                expected_revision,
            } => {
                let current = store.expected(&document, &expected_revision)?;
                // Path deletion also repairs unreadable metadata workspaces:
                // retain raw bytes in trash even when optional properties fail.
                let permalink = properties(&current.content).ok().and_then(|p| p.0);
                let mut deleted = json!({"path":current.path, "revision":current.revision});
                if let Some(id) = permalink {
                    deleted["permalink"] = json!(id);
                }
                let mut value = json!({"deleted":deleted, "trashId":"00000000-0000-0000-0000-000000000000", "historyWarning":HISTORY_WARNING});
                reserve(&value)?;
                let mut result = store
                    .scoped_repository()?
                    .trash(&current.path, &expected_revision)?;
                store.record(&mut result.document);
                value["trashId"] = json!(result.trash_id);
                value["historyWarning"] = if result.document.history_warning.is_some() {
                    json!(HISTORY_WARNING)
                } else {
                    Value::Null
                };
                Ok(value)
            }
            DocumentMutation::Restore { trash_id } => {
                let retained = store.scoped_repository()?.read_trash(&trash_id)?;
                let planned = store.planned(&retained.path, retained.content)?;
                let mut value = json!({"document":document_value(&planned)?});
                reserve(&value)?;
                let mut restored = store.scoped_repository()?.restore_checked(
                    &trash_id,
                    &planned.path,
                    &planned.revision,
                )?;
                store.record(&mut restored);
                finish_document(&mut value["document"], restored);
                Ok(value)
            }
        }
    }
}
