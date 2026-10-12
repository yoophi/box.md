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
}
