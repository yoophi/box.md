use crate::domain::document::DocumentError;

pub trait DocumentGrantToken: Send + Sync {
    fn generate(&self) -> Result<String, DocumentError>;
}
