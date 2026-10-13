use super::{
    document_identity::LocalDocumentIdentity, fs_document_repository::checked_path,
    git_document_history::GitDocumentHistory,
};
use crate::{
    application::document_service::DocumentService,
    domain::{document::DocumentError, history::HistoryEntry},
    ports::{
        document_history::DocumentHistory,
        document_scope_factory::{DocumentScopeFactory, DocumentScopeStorage},
    },
};
use box_document_store::ScopedFsDocumentRepository;
use std::{
    path::{Component, Path, PathBuf},
    sync::Arc,
};

pub struct FsDocumentScopeFactory {
    history: PathBuf,
    connections: Option<Arc<crate::application::connection_service::ConnectionService>>,
}
impl FsDocumentScopeFactory {
    pub fn new(history: PathBuf) -> Self {
        Self {
            history,
            connections: None,
        }
    }
    pub fn with_connections(
        mut self,
        connections: Arc<crate::application::connection_service::ConnectionService>,
    ) -> Self {
        self.connections = Some(connections);
        self
    }
}
impl DocumentScopeFactory for FsDocumentScopeFactory {
    fn open(&self, path: &str) -> Result<DocumentScopeStorage, DocumentError> {
        if !Path::new(path).is_absolute() {
            return Err(DocumentError::new(
                "invalidPath",
                "절대 경로의 작업 디렉터리를 선택해주세요.",
            ));
        }
        let root = Path::new(path).canonicalize().map_err(|_| {
            DocumentError::new("workspaceUnavailable", "작업 디렉터리를 열 수 없습니다.")
        })?;
        let canonical = root
            .to_str()
            .ok_or_else(|| {
                DocumentError::new("invalidPath", "UTF-8 작업 디렉터리를 선택해주세요.")
            })?
            .to_string();
        let repository = Arc::new(ScopedFsDocumentRepository::open(&root)?);
        let history = ScopedHistory {
            root,
            inner: GitDocumentHistory::new(self.history.clone()),
        };
        let mut service = DocumentService::scoped(repository, history)
            .with_identity_source(LocalDocumentIdentity);
        if let Some(connections) = &self.connections {
            service = service.with_connections(connections.clone());
        }
        Ok(DocumentScopeStorage {
            path: canonical.clone(),
            aliases: vec![canonical, path.into()],
            service: Arc::new(service),
        })
    }
    fn native_path(&self, path: &str) -> Result<String, DocumentError> {
        Ok(checked_path(path)?.to_string_lossy().into())
    }
}
struct ScopedHistory {
    root: PathBuf,
    inner: GitDocumentHistory,
}
impl ScopedHistory {
    fn key(&self, path: &str) -> Result<String, DocumentError> {
        let p = Path::new(path);
        if path.is_empty()
            || path.contains('\\')
            || p.components().any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(DocumentError::new(
                "invalidPath",
                "상대 문서 경로를 사용해주세요.",
            ));
        }
        Ok(self.root.join(p).to_string_lossy().into())
    }
    fn sanitize(error: DocumentError) -> DocumentError {
        DocumentError::new(error.code, "문서 이력을 처리하지 못했습니다.")
    }
}
impl DocumentHistory for ScopedHistory {
    fn record(&self, path: &str, content: &str) -> Result<(), DocumentError> {
        self.inner
            .record(&self.key(path)?, content)
            .map_err(Self::sanitize)
    }
    fn list(&self, path: &str) -> Result<Vec<HistoryEntry>, DocumentError> {
        self.inner.list(&self.key(path)?).map_err(Self::sanitize)
    }
    fn read(&self, path: &str, id: &str) -> Result<String, DocumentError> {
        self.inner
            .read(&self.key(path)?, id)
            .map_err(Self::sanitize)
    }
}
