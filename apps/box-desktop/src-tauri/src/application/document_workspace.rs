use super::document_service::DocumentService;
use crate::{
    domain::{
        document::{DocumentError, DocumentSnapshot},
        history::HistoryEntry,
        workspace::{WorkspaceDocument, WorkspaceSnapshot},
    },
    ports::document_scope_factory::{DocumentScopeFactory, DocumentScopeStorage},
};
use std::{
    path::{Component, Path},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

pub struct DocumentScope {
    pub generation: String,
    storage: DocumentScopeStorage,
    active: AtomicBool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::{
        document_scope_factory::FsDocumentScopeFactory,
        fs_document_repository::FsDocumentRepository, git_document_history::GitDocumentHistory,
    };
    use std::{fs, sync::Barrier, thread};

    fn manager(history: &Path) -> DocumentWorkspace {
        DocumentWorkspace::new(
            DocumentService::new(
                FsDocumentRepository,
                GitDocumentHistory::new(history.into()),
            ),
            FsDocumentScopeFactory::new(history.into()),
        )
    }

    #[test]
    fn native_and_scoped_calls_share_revision_conflict_and_existing_history_keys() {
        let root = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let manager = manager(cache.path());
        let original = manager
            .save(
                root.path().join("노트.md").to_str().unwrap(),
                "original",
                None,
            )
            .unwrap();
        let selected = manager
            .select(root.path().to_str().unwrap(), false)
            .unwrap();
        let scope = manager.scope().unwrap();
        assert_eq!(
            selected.generation.as_deref(),
            Some(scope.generation.as_str())
        );
        let agent = scope.read("노트.md").unwrap();
        assert_eq!(scope.listing().unwrap().paths, ["노트.md"]);
        assert_eq!(agent.path, "노트.md");
        assert_eq!(agent.revision, original.revision);
        let changed = scope
            .save("노트.md", "agent edit", Some(&agent.revision))
            .unwrap();
        assert!(changed.history_warning.is_none());
        assert_eq!(manager.read(&original.path).unwrap().content, "agent edit");
        assert_eq!(
            manager
                .save(&original.path, "stale UI", Some(&original.revision))
                .unwrap_err()
                .code,
            "conflict"
        );
        let native = manager
            .save(&original.path, "UI edit", Some(&changed.revision))
            .unwrap();
        assert_eq!(scope.revision("노트.md").unwrap(), Some(native.revision));
        let versions = manager.history(&original.path).unwrap();
        assert_eq!(versions.len(), 3);
        assert_eq!(
            manager
                .history_content(&original.path, &versions[2].id)
                .unwrap(),
            "original"
        );
    }

    #[test]
    fn concurrent_native_and_scoped_writes_have_one_winner_and_one_history_change() {
        let root = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let manager = Arc::new(manager(cache.path()));
        manager
            .select(root.path().to_str().unwrap(), false)
            .unwrap();
        let scope = manager.scope().unwrap();
        let doc = scope.save("note.md", "original", None).unwrap();
        let path = root.path().join("note.md").to_string_lossy().to_string();
        let barrier = Arc::new(Barrier::new(3));
        let a = {
            let manager = manager.clone();
            let barrier = barrier.clone();
            let rev = doc.revision.clone();
            let path = path.clone();
            thread::spawn(move || {
                barrier.wait();
                manager.save(&path, "native", Some(&rev))
            })
        };
        let b = {
            let scope = scope.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                scope.save("note.md", "scoped", Some(&doc.revision))
            })
        };
        barrier.wait();
        let results = [a.join().unwrap(), b.join().unwrap()];
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|r| r.as_ref().is_err_and(|e| e.code == "conflict"))
                .count(),
            1
        );
        assert_eq!(manager.history(&path).unwrap().len(), 2);
    }

    #[test]
    fn root_switch_retires_old_handles_but_native_outside_files_keep_working() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let manager = manager(cache.path());
        let a = manager
            .select(first.path().to_str().unwrap(), false)
            .unwrap();
        let old = manager.scope().unwrap();
        old.save("a.md", "old", None).unwrap();
        assert_eq!(
            manager
                .select(first.path().to_str().unwrap(), false)
                .unwrap()
                .generation,
            a.generation
        );
        assert!(manager
            .select(first.path().join("missing").to_str().unwrap(), false)
            .is_err());
        assert_eq!(manager.scope().unwrap().generation, old.generation);
        let b = manager
            .select(second.path().to_str().unwrap(), false)
            .unwrap();
        assert_ne!(a.generation, b.generation);
        assert_eq!(old.read("a.md").unwrap_err().code, "scopeRevoked");
        let path = first.path().join("a.md");
        let doc = manager.read(path.to_str().unwrap()).unwrap();
        manager
            .save(&doc.path, "explicit outside edit", Some(&doc.revision))
            .unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "explicit outside edit");
        assert!(manager
            .list(first.path().to_str().unwrap())
            .unwrap()
            .is_none());
    }

    #[test]
    fn scoped_history_failures_are_warnings_without_absolute_paths() {
        let root = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let blocker = cache.path().join("blocked");
        fs::write(&blocker, "x").unwrap();
        let manager = manager(&blocker);
        manager
            .select(root.path().to_str().unwrap(), false)
            .unwrap();
        let saved = manager
            .scope()
            .unwrap()
            .save("note.md", "saved", None)
            .unwrap();
        let warning = saved.history_warning.unwrap();
        assert!(!warning.contains(root.path().to_str().unwrap()));
        assert!(!warning.contains(cache.path().to_str().unwrap()));
        assert_eq!(
            fs::read_to_string(root.path().join("note.md")).unwrap(),
            "saved"
        );
    }

    #[cfg(unix)]
    #[test]
    fn root_name_replacement_and_symlinks_never_retarget_the_pinned_ui_service() {
        use std::os::unix::fs::symlink;
        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let root = parent.path().join("root");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("note.md"), "original").unwrap();
        fs::write(outside.path().join("note.md"), "outside").unwrap();
        let manager = manager(cache.path());
        let selected = manager.select(root.to_str().unwrap(), false).unwrap();
        let path = selected.documents[0].path.clone();
        fs::rename(&root, parent.path().join("moved")).unwrap();
        symlink(outside.path(), &root).unwrap();
        let doc = manager.read(&path).unwrap();
        assert_eq!(doc.content, "original");
        manager.save(&path, "updated", Some(&doc.revision)).unwrap();
        assert_eq!(
            fs::read_to_string(outside.path().join("note.md")).unwrap(),
            "outside"
        );
        assert_eq!(
            manager
                .list(&selected.path)
                .unwrap()
                .unwrap()
                .documents
                .len(),
            1
        );
        symlink(
            outside.path().join("note.md"),
            parent.path().join("moved/linked.md"),
        )
        .unwrap();
        assert!(manager
            .read(root.join("linked.md").to_str().unwrap())
            .is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("note.md")).unwrap(),
            "outside"
        );
        let rebound = manager.select(root.to_str().unwrap(), true).unwrap();
        assert_ne!(selected.generation, rebound.generation);
        assert_eq!(
            manager.scope().unwrap().read("note.md").unwrap().content,
            "outside"
        );
    }
}
impl DocumentScope {
    fn admitted<T>(
        &self,
        f: impl FnOnce(&DocumentService) -> Result<T, DocumentError>,
    ) -> Result<T, DocumentError> {
        if !self.active.load(Ordering::Acquire) {
            return Err(DocumentError::new(
                "scopeRevoked",
                "이 작업 루트의 사용이 종료되었습니다.",
            ));
        }
        // A call already admitted owns the pinned service through completion.
        f(&self.storage.service)
    }
    pub fn read(&self, path: &str) -> Result<DocumentSnapshot, DocumentError> {
        self.admitted(|s| s.read(path))
    }
    pub fn revision(&self, path: &str) -> Result<Option<String>, DocumentError> {
        self.admitted(|s| s.revision(path))
    }
    pub fn save(
        &self,
        path: &str,
        content: &str,
        expected: Option<&str>,
    ) -> Result<DocumentSnapshot, DocumentError> {
        self.admitted(|s| s.save(path, content, expected))
    }
    fn history(&self, path: &str) -> Result<Vec<HistoryEntry>, DocumentError> {
        self.admitted(|s| s.history(path))
    }
    fn history_content(&self, path: &str, id: &str) -> Result<String, DocumentError> {
        self.admitted(|s| s.history_content(path, id))
    }
    fn native_path(&self, relative: &str) -> String {
        Path::new(&self.storage.path)
            .join(relative)
            .to_string_lossy()
            .into()
    }
    pub fn listing(&self) -> Result<box_document_store::ScopedListing, DocumentError> {
        self.admitted(|service| service.listing())
    }
    fn native_snapshot(&self) -> Result<WorkspaceSnapshot, DocumentError> {
        let listing = self.listing()?;
        let documents = listing
            .paths
            .into_iter()
            .map(|relative| WorkspaceDocument {
                name: Path::new(&relative)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                path: self.native_path(&relative),
                relative_path: relative,
            })
            .collect();
        Ok(WorkspaceSnapshot {
            path: self.storage.path.clone(),
            documents,
            truncated: listing.truncated,
            warnings: listing.warnings,
            generation: Some(self.generation.clone()),
        })
    }
    fn relative(&self, path: &str) -> Result<Option<String>, DocumentError> {
        let path = Path::new(path);
        if !path.is_absolute() {
            return Err(DocumentError::new(
                "invalidPath",
                "절대 경로의 문서를 선택해주세요.",
            ));
        }
        for root in &self.storage.aliases {
            if let Ok(relative) = path.strip_prefix(root) {
                let parts = relative
                    .components()
                    .map(|c| match c {
                        Component::Normal(part) => part.to_str().ok_or_else(|| {
                            DocumentError::new("invalidPath", "UTF-8 경로를 선택해주세요.")
                        }),
                        _ => Err(DocumentError::new(
                            "invalidPath",
                            "상위 경로 이동은 사용할 수 없습니다.",
                        )),
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if parts.is_empty() {
                    return Err(DocumentError::new("invalidPath", "문서를 선택해주세요."));
                }
                // Explicit native file editing retains access to hidden/build
                // files. They are outside the agent's visible document scope.
                if parts[..parts.len() - 1]
                    .iter()
                    .any(|p| p.starts_with('.') || matches!(*p, "node_modules" | "target"))
                    || parts.last() == Some(&".box.md")
                {
                    return Ok(None);
                }
                return Ok(Some(parts.join("/")));
            }
        }
        Ok(None)
    }
}

pub struct DocumentWorkspace {
    native: DocumentService,
    factory: Box<dyn DocumentScopeFactory>,
    current: Mutex<Option<Arc<DocumentScope>>>,
}
impl DocumentWorkspace {
    pub fn new(native: DocumentService, factory: impl DocumentScopeFactory + 'static) -> Self {
        Self {
            native,
            factory: Box::new(factory),
            current: Mutex::new(None),
        }
    }
    pub fn scope(&self) -> Result<Arc<DocumentScope>, DocumentError> {
        self.current
            .lock()
            .map_err(|_| DocumentError::new("internal", "작업 루트 잠금 오류"))?
            .clone()
            .ok_or_else(|| {
                DocumentError::new("workspaceUnavailable", "작업 디렉터리를 선택해주세요.")
            })
    }
    pub fn select(&self, path: &str, rebind: bool) -> Result<WorkspaceSnapshot, DocumentError> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| DocumentError::new("internal", "작업 루트 잠금 오류"))?;
        if let Some(scope) = current
            .as_ref()
            .filter(|s| !rebind && s.storage.aliases.iter().any(|p| p == path))
        {
            return scope.native_snapshot();
        }
        let scope = Arc::new(DocumentScope {
            generation: uuid::Uuid::new_v4().to_string(),
            storage: self.factory.open(path)?,
            active: AtomicBool::new(true),
        });
        let listing = scope.native_snapshot()?;
        if let Some(previous) = current.replace(scope) {
            previous.active.store(false, Ordering::Release);
        }
        Ok(listing)
    }
    pub fn list(&self, path: &str) -> Result<Option<WorkspaceSnapshot>, DocumentError> {
        match self.scope() {
            Ok(scope) if scope.storage.aliases.iter().any(|p| p == path) => {
                scope.native_snapshot().map(Some)
            }
            Ok(_) => Ok(None),
            Err(error) if error.code == "workspaceUnavailable" => Ok(None),
            Err(error) => Err(error),
        }
    }
    fn target(&self, path: &str) -> Result<Option<(Arc<DocumentScope>, String)>, DocumentError> {
        let current = self
            .current
            .lock()
            .map_err(|_| DocumentError::new("internal", "작업 루트 잠금 오류"))?
            .clone();
        let Some(scope) = current else {
            return Ok(None);
        };
        if let Some(relative) = scope.relative(path)? {
            return Ok(Some((scope, relative)));
        }
        let normalized = self.factory.native_path(path)?;
        Ok(scope
            .relative(&normalized)?
            .map(|relative| (scope, relative)))
    }
    pub fn read(&self, path: &str) -> Result<DocumentSnapshot, DocumentError> {
        match self.target(path)? {
            Some((scope, relative)) => {
                let mut doc = scope.read(&relative)?;
                doc.path = scope.native_path(&relative);
                Ok(doc)
            }
            None => self.native.read(path),
        }
    }
    pub fn revision(&self, path: &str) -> Result<Option<String>, DocumentError> {
        match self.target(path)? {
            Some((s, p)) => s.revision(&p),
            None => self.native.revision(path),
        }
    }
    pub fn save(
        &self,
        path: &str,
        content: &str,
        expected: Option<&str>,
    ) -> Result<DocumentSnapshot, DocumentError> {
        match self.target(path)? {
            Some((scope, relative)) => {
                let mut doc = scope.save(&relative, content, expected)?;
                doc.path = scope.native_path(&relative);
                Ok(doc)
            }
            None => self.native.save(path, content, expected),
        }
    }
    pub fn history(&self, path: &str) -> Result<Vec<HistoryEntry>, DocumentError> {
        match self.target(path)? {
            Some((s, p)) => s.history(&p),
            None => self.native.history(path),
        }
    }
    pub fn history_content(&self, path: &str, id: &str) -> Result<String, DocumentError> {
        match self.target(path)? {
            Some((s, p)) => s.history_content(&p, id),
            None => self.native.history_content(path, id),
        }
    }
}
