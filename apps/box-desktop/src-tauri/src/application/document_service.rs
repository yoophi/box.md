use crate::{
    domain::document::{DocumentError, DocumentSnapshot},
    ports::document_repository::DocumentRepository,
};
use std::sync::Mutex;

pub struct DocumentService {
    repository: Mutex<Box<dyn DocumentRepository>>,
}

impl DocumentService {
    pub fn new(repository: impl DocumentRepository + 'static) -> Self {
        Self {
            repository: Mutex::new(Box::new(repository)),
        }
    }
    pub fn read(&self, path: &str) -> Result<DocumentSnapshot, DocumentError> {
        self.repository
            .lock()
            .map_err(|_| DocumentError::new("internal", "문서 저장소 잠금 오류"))?
            .read(path)
    }
    pub fn revision(&self, path: &str) -> Result<Option<String>, DocumentError> {
        self.repository
            .lock()
            .map_err(|_| DocumentError::new("internal", "문서 저장소 잠금 오류"))?
            .revision(path)
    }
    pub fn save(
        &self,
        path: &str,
        content: &str,
        expected_revision: Option<&str>,
    ) -> Result<DocumentSnapshot, DocumentError> {
        self.repository
            .lock()
            .map_err(|_| DocumentError::new("internal", "문서 저장소 잠금 오류"))?
            .save(path, content, expected_revision)
    }
}
