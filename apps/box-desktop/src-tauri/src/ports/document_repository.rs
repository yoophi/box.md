use crate::domain::document::{DocumentError, DocumentSnapshot};

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
