use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub path: String,
    pub content: String,
    pub revision: String,
    pub history_warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentError {
    pub code: &'static str,
    pub message: String,
}

impl DocumentError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
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
