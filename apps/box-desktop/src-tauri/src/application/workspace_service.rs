use crate::{
    domain::{document::DocumentError, workspace::WorkspaceSnapshot},
    ports::workspace_repository::WorkspaceRepository,
};
pub struct WorkspaceService {
    repository: Box<dyn WorkspaceRepository>,
}
impl WorkspaceService {
    pub fn new(repository: impl WorkspaceRepository + 'static) -> Self {
        Self {
            repository: Box::new(repository),
        }
    }
    pub fn list(&self, path: &str) -> Result<WorkspaceSnapshot, DocumentError> {
        self.repository.list(path)
    }
}
