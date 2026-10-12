use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentComment {
    pub id: String,
    pub body: String,
    pub created_at: String,
}
