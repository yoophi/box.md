use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocument {
    pub path: String,
    pub relative_path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub path: String,
    pub documents: Vec<WorkspaceDocument>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<box_document_store::ScopedWarning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<String>,
}
