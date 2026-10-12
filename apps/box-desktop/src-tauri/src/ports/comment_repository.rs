use crate::domain::{comment::DocumentComment, document::DocumentError};

pub trait CommentRepository: Send + Sync {
    fn list(&self, key: &str) -> Result<Vec<DocumentComment>, DocumentError>;
    fn append(&self, key: &str, body: &str) -> Result<DocumentComment, DocumentError>;
}
