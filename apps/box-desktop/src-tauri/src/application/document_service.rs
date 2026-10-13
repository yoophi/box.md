use crate::{
    domain::{
        document::{DocumentError, DocumentSnapshot},
        history::HistoryEntry,
    },
    ports::{
        document_history::DocumentHistory, document_identity::DocumentIdentitySource,
        document_repository::DocumentRepository,
    },
};
use box_document_store::{ScopedDocumentRepository, ScopedListing};
use std::sync::{Arc, Mutex};

pub(super) struct DocumentStore {
    pub(super) repository: Box<dyn DocumentRepository>,
    pub(super) history: Box<dyn DocumentHistory>,
    pub(super) scoped: Option<Arc<dyn ScopedDocumentRepository>>,
    pub(super) identities: Option<Arc<dyn DocumentIdentitySource>>,
}
pub struct DocumentService {
    store: Mutex<DocumentStore>,
}
impl DocumentService {
    pub fn new(
        repository: impl DocumentRepository + 'static,
        history: impl DocumentHistory + 'static,
    ) -> Self {
        Self {
            store: Mutex::new(DocumentStore {
                repository: Box::new(repository),
                history: Box::new(history),
                scoped: None,
                identities: None,
            }),
        }
    }
    pub fn scoped(
        repository: Arc<dyn ScopedDocumentRepository>,
        history: impl DocumentHistory + 'static,
    ) -> Self {
        Self {
            store: Mutex::new(DocumentStore {
                repository: Box::new(SharedScopedRepository(repository.clone())),
                history: Box::new(history),
                scoped: Some(repository),
                identities: None,
            }),
        }
    }
    pub fn with_identity_source(mut self, source: impl DocumentIdentitySource + 'static) -> Self {
        self.store
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .identities = Some(Arc::new(source));
        self
    }
    pub fn listing(&self) -> Result<ScopedListing, DocumentError> {
        self.lock()?
            .scoped
            .as_ref()
            .ok_or_else(|| DocumentError::new("workspaceUnavailable", "작업 루트를 선택해주세요."))?
            .list()
    }
    pub(super) fn lock(&self) -> Result<std::sync::MutexGuard<'_, DocumentStore>, DocumentError> {
        self.store
            .lock()
            .map_err(|_| DocumentError::new("internal", "문서 저장소 잠금 오류"))
    }
    pub fn read(&self, path: &str) -> Result<DocumentSnapshot, DocumentError> {
        self.lock()?.repository.read(path)
    }
    pub fn revision(&self, path: &str) -> Result<Option<String>, DocumentError> {
        self.lock()?.repository.revision(path)
    }
    pub fn history(&self, path: &str) -> Result<Vec<HistoryEntry>, DocumentError> {
        self.lock()?.history.list(path)
    }
    pub fn history_content(&self, path: &str, id: &str) -> Result<String, DocumentError> {
        self.lock()?.history.read(path, id)
    }
    pub fn save(
        &self,
        path: &str,
        content: &str,
        expected_revision: Option<&str>,
    ) -> Result<DocumentSnapshot, DocumentError> {
        let store = self.lock()?;
        if store.scoped.is_some() {
            store.validate_candidate(path, content)?;
        }
        store.write(path, content, expected_revision)
    }
}

impl DocumentStore {
    pub(super) fn write(
        &self,
        path: &str,
        content: &str,
        expected_revision: Option<&str>,
    ) -> Result<DocumentSnapshot, DocumentError> {
        let previous = if expected_revision.is_some() {
            Some(self.repository.read(path)?)
        } else {
            None
        };
        let mut saved = self.repository.save(path, content, expected_revision)?;
        let history_result = (|| {
            if let Some(previous) = previous {
                self.history.record(&saved.path, &previous.content)?;
            }
            self.history.record(&saved.path, &saved.content)
        })();
        if let Err(error) = history_result {
            saved.history_warning = Some(error.message);
        }
        Ok(saved)
    }
}

struct SharedScopedRepository(Arc<dyn ScopedDocumentRepository>);
impl DocumentRepository for SharedScopedRepository {
    fn read(&self, path: &str) -> Result<DocumentSnapshot, DocumentError> {
        self.0.read(path)
    }
    fn revision(&self, path: &str) -> Result<Option<String>, DocumentError> {
        self.0.revision(path)
    }
    fn save(
        &self,
        path: &str,
        content: &str,
        expected: Option<&str>,
    ) -> Result<DocumentSnapshot, DocumentError> {
        self.0.save(path, content, expected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::{
        fs_document_repository::FsDocumentRepository, git_document_history::GitDocumentHistory,
    };
    #[test]
    fn saves_original_and_new_versions_and_never_records_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        std::fs::write(&path, "original").unwrap();
        let service = DocumentService::new(
            FsDocumentRepository,
            GitDocumentHistory::new(dir.path().join("history")),
        );
        let original = service.read(path.to_str().unwrap()).unwrap();
        let saved = service
            .save(&original.path, "changed", Some(&original.revision))
            .unwrap();
        assert!(saved.history_warning.is_none());
        let versions = service.history(&saved.path).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(
            service
                .history_content(&saved.path, &versions[1].id)
                .unwrap(),
            "original"
        );
        std::fs::write(&path, "external").unwrap();
        assert!(service
            .save(&saved.path, "conflicting", Some(&saved.revision))
            .is_err());
        assert_eq!(service.history(&saved.path).unwrap().len(), 2);
    }
    #[test]
    fn history_failure_does_not_turn_a_saved_document_into_a_failed_save() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("not-a-directory");
        std::fs::write(&blocker, "x").unwrap();
        let service = DocumentService::new(FsDocumentRepository, GitDocumentHistory::new(blocker));
        let saved = service
            .save(dir.path().join("note.md").to_str().unwrap(), "saved", None)
            .unwrap();
        assert!(saved.history_warning.is_some());
        assert_eq!(service.read(&saved.path).unwrap().content, "saved");
    }
}
