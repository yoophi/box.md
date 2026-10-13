use super::*;
use crate::{
    infrastructure::{
        document_scope_factory::FsDocumentScopeFactory,
        fs_document_repository::FsDocumentRepository, git_document_history::GitDocumentHistory,
    },
    ports::document_history::DocumentHistory,
};
use box_document_store::ScopedFsDocumentRepository;
use std::{
    fs,
    path::PathBuf,
    sync::{mpsc, Barrier},
    thread,
};

struct BlockingHistory {
    root: PathBuf,
    inner: GitDocumentHistory,
    entered: mpsc::SyncSender<()>,
    release: Arc<Barrier>,
    blocked: AtomicBool,
}
impl DocumentHistory for BlockingHistory {
    fn record(&self, path: &str, content: &str) -> Result<(), DocumentError> {
        if !self.blocked.swap(true, Ordering::AcqRel) {
            self.entered.send(()).unwrap();
            self.release.wait();
        }
        self.inner
            .record(self.root.join(path).to_str().unwrap(), content)
    }
    fn list(&self, path: &str) -> Result<Vec<HistoryEntry>, DocumentError> {
        self.inner.list(self.root.join(path).to_str().unwrap())
    }
    fn read(&self, path: &str, id: &str) -> Result<String, DocumentError> {
        self.inner.read(self.root.join(path).to_str().unwrap(), id)
    }
}
struct BlockingFactory {
    inner: FsDocumentScopeFactory,
    history: PathBuf,
    entered: mpsc::SyncSender<()>,
    release: Arc<Barrier>,
}
impl DocumentScopeFactory for BlockingFactory {
    fn open(&self, path: &str) -> Result<DocumentScopeStorage, DocumentError> {
        let mut storage = self.inner.open(path)?;
        storage.service = Arc::new(DocumentService::scoped(
            Arc::new(ScopedFsDocumentRepository::open(Path::new(&storage.path))?),
            BlockingHistory {
                root: storage.path.clone().into(),
                inner: GitDocumentHistory::new(self.history.clone()),
                entered: self.entered.clone(),
                release: self.release.clone(),
                blocked: AtomicBool::new(false),
            },
        ));
        Ok(storage)
    }
    fn native_path(&self, path: &str) -> Result<String, DocumentError> {
        self.inner.native_path(path)
    }
}
fn manager(history: &Path) -> (DocumentWorkspace, mpsc::Receiver<()>, Arc<Barrier>) {
    let (entered, rx) = mpsc::sync_channel(1);
    let release = Arc::new(Barrier::new(2));
    let manager = DocumentWorkspace::new(
        DocumentService::new(
            FsDocumentRepository,
            GitDocumentHistory::new(history.into()),
        ),
        BlockingFactory {
            inner: FsDocumentScopeFactory::new(history.into()),
            history: history.into(),
            entered,
            release: release.clone(),
        },
    );
    (manager, rx, release)
}

#[test]
fn root_switch_waits_for_native_write_and_history_and_rejects_new_old_scope_calls() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let (manager, entered, release) = manager(cache.path());
    let manager = Arc::new(manager);
    manager
        .select(first.path().to_str().unwrap(), false)
        .unwrap();
    let old = manager.scope().unwrap();
    let path = first.path().canonicalize().unwrap().join("note.md");
    let writer = {
        let manager = manager.clone();
        let path = path.clone();
        thread::spawn(move || manager.save(path.to_str().unwrap(), "accepted", None))
    };
    entered.recv().unwrap(); // File is published; history is deliberately blocked.
    assert_eq!(fs::read_to_string(&path).unwrap(), "accepted");
    let (finished, rx) = mpsc::channel();
    let switch = {
        let manager = manager.clone();
        let root = second.path().to_owned();
        thread::spawn(move || {
            let result = manager.select(root.to_str().unwrap(), false);
            finished.send(()).unwrap();
            result
        })
    };
    old.admission.wait_until_stopped();
    assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert_eq!(old.read("note.md").unwrap_err().code, "scopeRevoked");
    assert_eq!(
        old.save("rejected.md", "new", None).unwrap_err().code,
        "scopeRevoked"
    );
    assert!(!first.path().join("rejected.md").exists());
    release.wait();
    assert!(writer.join().unwrap().unwrap().history_warning.is_none());
    let selected = switch.join().unwrap().unwrap();
    assert_ne!(
        selected.generation.as_deref(),
        Some(old.generation.as_str())
    );
    assert_eq!(
        manager.read(path.to_str().unwrap()).unwrap().content,
        "accepted"
    );
    assert_eq!(manager.history(path.to_str().unwrap()).unwrap().len(), 1);
    assert!(!second.path().join("note.md").exists());
}

#[test]
fn explicit_shutdown_drains_scope_calls_and_permanently_rejects_native_access() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let (manager, entered, release) = manager(cache.path());
    let manager = Arc::new(manager);
    manager
        .select(root.path().to_str().unwrap(), false)
        .unwrap();
    let scope = manager.scope().unwrap();
    let writer = {
        let scope = scope.clone();
        thread::spawn(move || scope.save("note.md", "accepted", None))
    };
    entered.recv().unwrap();
    let (finished, rx) = mpsc::channel();
    let close = {
        let manager = manager.clone();
        thread::spawn(move || {
            manager.close_and_drain();
            finished.send(()).unwrap();
        })
    };
    scope.admission.wait_until_stopped();
    assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert_eq!(scope.listing().unwrap_err().code, "scopeRevoked");
    release.wait();
    writer.join().unwrap().unwrap();
    close.join().unwrap();
    manager.close_and_drain(); // Idempotent.
    assert_eq!(manager.scope().err().unwrap().code, "scopeRevoked");
    assert_eq!(
        manager
            .select(root.path().to_str().unwrap(), true)
            .unwrap_err()
            .code,
        "scopeRevoked"
    );
    assert_eq!(
        manager
            .read(root.path().join("note.md").to_str().unwrap())
            .unwrap_err()
            .code,
        "scopeRevoked"
    );
    let outside_path = outside.path().join("outside.md");
    assert_eq!(
        manager
            .save(outside_path.to_str().unwrap(), "rejected", None)
            .unwrap_err()
            .code,
        "scopeRevoked"
    );
    assert!(!outside_path.exists());
    assert_eq!(
        fs::read_to_string(root.path().join("note.md")).unwrap(),
        "accepted"
    );
    assert_eq!(
        GitDocumentHistory::new(cache.path().into())
            .list(
                root.path()
                    .canonicalize()
                    .unwrap()
                    .join("note.md")
                    .to_str()
                    .unwrap()
            )
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn workspace_drop_drains_an_accepted_call_even_when_a_scope_handle_survives() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let (manager, entered, release) = manager(cache.path());
    manager
        .select(root.path().to_str().unwrap(), false)
        .unwrap();
    let scope = manager.scope().unwrap();
    let writer = {
        let scope = scope.clone();
        thread::spawn(move || scope.save("note.md", "accepted", None))
    };
    entered.recv().unwrap();
    let (finished, rx) = mpsc::channel();
    let shutdown = thread::spawn(move || {
        drop(manager);
        finished.send(()).unwrap();
    });
    scope.admission.wait_until_stopped();
    assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert_eq!(scope.read("note.md").unwrap_err().code, "scopeRevoked");
    release.wait();
    assert!(writer.join().unwrap().unwrap().history_warning.is_none());
    shutdown.join().unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("note.md")).unwrap(),
        "accepted"
    );
    assert_eq!(
        GitDocumentHistory::new(cache.path().into())
            .list(
                root.path()
                    .canonicalize()
                    .unwrap()
                    .join("note.md")
                    .to_str()
                    .unwrap()
            )
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn unwind_releases_admission_and_stop_precedes_drain() {
    let admission = ScopeAdmission::new();
    let permit = admission.admit().unwrap();
    admission.stop_accepting();
    assert_eq!(admission.admit().err().unwrap().code, "scopeRevoked");
    let worker = thread::spawn(move || {
        let _permit = permit;
        panic!("owned test operation");
    });
    assert!(worker.join().is_err());
    admission.drain();
    admission.stop_accepting();
    admission.drain();
}
