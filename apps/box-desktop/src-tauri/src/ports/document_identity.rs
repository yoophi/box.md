use crate::domain::document::DocumentError;

/// Supplies a fresh local timestamp and cryptographic random suffix.
/// Application code checks uniqueness and publishes the document without clobbering.
pub trait DocumentIdentitySource: Send + Sync {
    fn next_id(&self) -> Result<String, DocumentError>;
}
