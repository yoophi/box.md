use crate::{DocumentError, DocumentSnapshot, ScopedListing, TrashSnapshot};

/// The native adapter accepts absolute picker paths; a scoped adapter accepts
/// root-relative Markdown paths. Callers select the adapter's authority once.
pub trait DocumentRepository: Send + Sync {
    fn read(&self, path: &str) -> Result<DocumentSnapshot, DocumentError>;
    fn revision(&self, path: &str) -> Result<Option<String>, DocumentError>;
    fn save(
        &self,
        path: &str,
        content: &str,
        expected_revision: Option<&str>,
    ) -> Result<DocumentSnapshot, DocumentError>;
}

pub trait ScopedDocumentRepository: DocumentRepository {
    fn list(&self) -> Result<ScopedListing, DocumentError>;
    fn trash(&self, path: &str, expected_revision: &str) -> Result<TrashSnapshot, DocumentError>;
    /// Inspect retained bytes without publishing them or changing the store.
    fn read_trash(&self, trash_id: &str) -> Result<DocumentSnapshot, DocumentError>;
    fn restore(&self, trash_id: &str) -> Result<DocumentSnapshot, DocumentError>;
    /// Publish only the retained snapshot that was inspected during preparation.
    fn restore_checked(
        &self,
        trash_id: &str,
        path: &str,
        revision: &str,
    ) -> Result<DocumentSnapshot, DocumentError>;
}
