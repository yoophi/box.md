use serde::Serialize;

/// Completion metadata only: never includes content, credentials or absolute roots.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChange {
    pub generation: String,
    pub kind: DocumentChangeKind,
    pub document: Option<ChangedDocument>,
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DocumentChangeKind {
    DocumentChanged,
    DocumentDeleted,
    ConnectionsChanged,
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedDocument {
    pub path: String,
    pub revision: String,
}
