use crate::{application::document_service::DocumentService, domain::document::DocumentError};
use std::sync::Arc;

pub struct DocumentScopeStorage {
    pub path: String,
    pub aliases: Vec<String>,
    pub service: Arc<DocumentService>,
}

/// Only the main application's directory selection may call open. Scoped
/// callers receive an already bound service, never a root-path argument.
pub trait DocumentScopeFactory: Send + Sync {
    fn open(&self, path: &str) -> Result<DocumentScopeStorage, DocumentError>;
    fn native_path(&self, path: &str) -> Result<String, DocumentError>;
}
