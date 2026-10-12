use crate::domain::{document::DocumentError, workspace::WorkspaceSnapshot};
pub trait WorkspaceRepository: Send + Sync {
    fn list(&self, path: &str) -> Result<WorkspaceSnapshot, DocumentError>;
}
