use crate::domain::document::DocumentSnapshot;
use box_document_store::ScopedWarning;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum DocumentRef {
    Path { path: String },
    Permalink { permalink: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDescriptor {
    pub path: String,
    pub revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permalink: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedDocument {
    #[serde(flatten)]
    pub document: DocumentSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permalink: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSnapshot {
    pub path: String,
    pub revision: String,
    pub metadata: Map<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permalink: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPage {
    pub documents: Vec<DocumentDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub warnings: Vec<ScopedWarning>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct SearchMatch {
    #[serde(flatten)]
    pub document: DocumentDescriptor,
    pub excerpts: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub matches: Vec<SearchMatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub warnings: Vec<ScopedWarning>,
    pub truncated: bool,
}
