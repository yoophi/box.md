use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub path: String,
    pub content: String,
    pub revision: String,
    pub history_warning: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<String>,
}

impl DocumentError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            current_revision: None,
        }
    }

    pub fn with_current_revision(mut self, revision: String) -> Self {
        // Revisions are content hashes, never adapter exception text or paths.
        if revision.len() == 64 && revision.bytes().all(|b| b.is_ascii_hexdigit()) {
            self.current_revision = Some(revision);
        }
        self
    }
}

#[derive(Debug, Serialize)]
pub struct ScopedWarning {
    pub path: Option<String>,
    pub code: &'static str,
}

#[derive(Debug, Default, Serialize)]
pub struct ScopedListing {
    pub paths: Vec<String>,
    pub warnings: Vec<ScopedWarning>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashSnapshot {
    pub trash_id: String,
    pub document: DocumentSnapshot,
}
