use super::*;
use crate::{
    application::document_service::DocumentService,
    application::document_workspace::DocumentWorkspace,
    infrastructure::{
        document_scope_factory::FsDocumentScopeFactory,
        fs_document_repository::FsDocumentRepository, git_document_history::GitDocumentHistory,
    },
};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use std::{fs, sync::atomic::AtomicUsize};

struct Fixture {
    roots: [tempfile::TempDir; 2],
    _history: tempfile::TempDir,
    workspace: Arc<DocumentWorkspace>,
    runtime: DocumentMcpRuntime,
    client: Client,
}
impl Fixture {
    fn new() -> Self {
        Self::with_gate(None)
    }
    fn with_gate(gate: Option<Arc<HistoryGate>>) -> Self {
        let roots = [tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap()];
        for (index, root) in roots.iter().enumerate() {
            fs::write(
                root.path().join("note.md"),
                format!("---\npermalink: root-{index}\n---\nroot {index}"),
            )
            .unwrap();
        }
        let history = tempfile::tempdir().unwrap();
        let workspace = Arc::new(DocumentWorkspace::new(
            DocumentService::new(
                FsDocumentRepository,
                GitDocumentHistory::new(history.path().into()),
            ),
            GatedFactory {
                inner: FsDocumentScopeFactory::new(history.path().into()),
                history: history.path().into(),
                gate,
            },
        ));
        workspace
            .select(roots[0].path().to_str().unwrap(), false)
            .unwrap();
        Self {
            roots,
            _history: history,
            workspace,
            runtime: DocumentMcpRuntime::new(),
            client: Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap(),
        }
    }
    async fn call(&self, grant: &McpGrant, name: &str, arguments: Value) -> reqwest::Response {
        self.client.post(&grant.server.url).header("Authorization", &grant.server.headers[0].value)
            .header("accept", "application/json, text/event-stream").header("mcp-protocol-version", "2025-11-25")
            .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":arguments}}))
            .send().await.unwrap()
    }
    async fn stop(self) {
        self.runtime.stop_admission().await;
        self.workspace.close_and_drain();
        self.runtime.shutdown().await.unwrap();
    }
}
#[tokio::test]
async fn real_grants_retry_one_credential_revoke_only_one_run_and_follow_new_root_generations() {
    let f = Fixture::new();
    let old_scope = f.workspace.scope().unwrap();
    let first = f.runtime.grant(old_scope.clone(), "run-a").await.unwrap();
    let repeat = f.runtime.grant(old_scope.clone(), "run-a").await.unwrap();
    assert_eq!(first.grant_id, repeat.grant_id);
    assert!(first.server.headers[0].value == repeat.server.headers[0].value);
    let second = f.runtime.grant(old_scope.clone(), "run-b").await.unwrap();
    assert!(first.server.headers[0].value != second.server.headers[0].value);
    let read = f
        .call(
            &first,
            "read_document",
            json!({"document":{"path":"note.md"}}),
        )
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        read["result"]["structuredContent"]["data"]["document"]["permalink"],
        "root-0"
    );
    f.runtime.grants.revoke(&first.grant_id);
    assert_eq!(
        f.call(&first, "list_documents", json!({})).await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        f.call(&second, "list_documents", json!({})).await.status(),
        StatusCode::OK
    );
    let rejected = f
        .runtime
        .grant(old_scope.clone(), "run-a")
        .await
        .err()
        .unwrap();
    assert_eq!(rejected.code, "grantRevoked");
    assert!(!rejected.message.contains(&first.server.headers[0].value));
    f.workspace
        .select(f.roots[1].path().to_str().unwrap(), false)
        .unwrap();
    // Authorization checks scope admission, even before the native command prunes records.
    assert_eq!(
        f.call(
            &second,
            "create_document",
            json!({"content":"denied","requestId":"old"})
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        f.runtime
            .grant(old_scope, "run-c")
            .await
            .err()
            .unwrap()
            .code,
        "scopeRevoked"
    );
    f.runtime.grants.prune_inactive();
    let next = f
        .runtime
        .grant(f.workspace.scope().unwrap(), "run-a")
        .await
        .unwrap();
    assert_ne!(next.generation, first.generation);
    assert_ne!(next.grant_id, first.grant_id);
    let result = f
        .call(
            &next,
            "read_document",
            json!({"document":{"permalink":"root-0"}}),
        )
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        result["result"]["structuredContent"]["error"]["code"],
        "notFound"
    );
    let result = f
        .call(
            &next,
            "create_document",
            json!({"content":"new root","requestId":"new"}),
        )
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(result["result"]["structuredContent"]["ok"], true);
    assert_eq!(fs::read_dir(f.roots[0].path()).unwrap().count(), 1);
    let path = result["result"]["structuredContent"]["data"]["document"]["path"]
        .as_str()
        .unwrap();
    assert!(f.roots[1].path().join(path).exists());
    let rebound = f
        .workspace
        .select(f.roots[1].path().to_str().unwrap(), true)
        .unwrap();
    assert_ne!(
        rebound.generation.as_deref(),
        Some(next.generation.as_str())
    );
    assert_eq!(
        f.call(&next, "list_documents", json!({})).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let fresh = f
        .runtime
        .grant(f.workspace.scope().unwrap(), "run-a")
        .await
        .unwrap();
    assert_eq!(Some(fresh.generation), rebound.generation);

    f.stop().await;
}

#[tokio::test]
async fn host_start_failure_is_sanitized_retryable_and_shutdown_retires_future_grants() {
    let mut f = Fixture::new();
    let actual = f.runtime.starter.clone();
    let attempts = Arc::new(AtomicUsize::new(0));
    f.runtime.starter = Arc::new(move |grants| {
        let actual = actual.clone();
        let fail = attempts.fetch_add(1, Ordering::SeqCst) == 0;
        Box::pin(async move {
            if fail {
                return Err(std::io::Error::other("private-startup-marker"));
            }
            actual(grants).await
        })
    });
    let scope = f.workspace.scope().unwrap();
    let failed = f.runtime.grant(scope.clone(), "retry").await.err().unwrap();
    assert_eq!(failed.code, "mcpUnavailable");
    assert!(!failed.message.contains("private-startup-marker"));
    let (a, b) = tokio::join!(
        f.runtime.grant(scope.clone(), "retry"),
        f.runtime.grant(scope.clone(), "retry")
    );
    let a = a.unwrap();
    let b = b.unwrap();
    assert_eq!(a.grant_id, b.grant_id);
    assert_eq!(a.server.url, b.server.url);
    assert_eq!(
        f.call(&a, "list_documents", json!({})).await.status(),
        StatusCode::OK
    );
    f.runtime.stop_admission().await;
    assert_eq!(
        f.call(&a, "list_documents", json!({})).await.status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    f.workspace.close_and_drain();
    f.runtime.shutdown().await.unwrap();
    assert_eq!(
        f.runtime.grant(scope, "late").await.err().unwrap().code,
        "scopeRevoked"
    );
    assert!(f.client.get(&a.server.url).send().await.is_err());
}

#[test]
fn failed_entropy_and_invalid_token_output_never_issue_a_credential_or_echo_provider_details() {
    struct Broken;
    impl crate::ports::document_grant_token::DocumentGrantToken for Broken {
        fn generate(&self) -> Result<String, DocumentError> {
            Err(DocumentError::new("internal", "private-entropy-marker"))
        }
    }
    struct Invalid;
    impl crate::ports::document_grant_token::DocumentGrantToken for Invalid {
        fn generate(&self) -> Result<String, DocumentError> {
            Ok("\r\nprivate-entropy-marker".into())
        }
    }
    let f = Fixture::new();
    let scope = f.workspace.scope().unwrap();
    for registry in [DocumentGrants::new(Broken), DocumentGrants::new(Invalid)] {
        let failed = registry.issue(scope.clone(), "run").err().unwrap();
        assert_eq!(failed.code, "grantUnavailable");
        assert!(!failed.message.contains("private-entropy-marker"));
        assert!(registry.resolve("private-entropy-marker").is_none());
        assert_eq!(fs::read_dir(f.roots[0].path()).unwrap().count(), 1);
    }
    f.workspace.close_and_drain();
}

struct HistoryGate {
    entered: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    release: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
}
struct GatedFactory {
    inner: FsDocumentScopeFactory,
    history: std::path::PathBuf,
    gate: Option<Arc<HistoryGate>>,
}
struct GatedHistory {
    root: std::path::PathBuf,
    history: GitDocumentHistory,
    gate: Arc<HistoryGate>,
}
impl crate::ports::document_history::DocumentHistory for GatedHistory {
    fn record(&self, path: &str, content: &str) -> Result<(), DocumentError> {
        if let Some(sender) = self.gate.entered.lock().unwrap().take() {
            let _ = sender.send(());
            self.gate
                .release
                .lock()
                .unwrap()
                .recv_timeout(std::time::Duration::from_secs(10))
                .map_err(|_| DocumentError::new("internal", "Test gate timed out"))?;
        }
        self.history
            .record(self.root.join(path).to_str().unwrap(), content)
    }
    fn list(&self, path: &str) -> Result<Vec<crate::domain::history::HistoryEntry>, DocumentError> {
        self.history.list(self.root.join(path).to_str().unwrap())
    }
    fn read(&self, path: &str, id: &str) -> Result<String, DocumentError> {
        self.history
            .read(self.root.join(path).to_str().unwrap(), id)
    }
}
impl crate::ports::document_scope_factory::DocumentScopeFactory for GatedFactory {
    fn open(
        &self,
        path: &str,
    ) -> Result<crate::ports::document_scope_factory::DocumentScopeStorage, DocumentError> {
        let mut storage = self.inner.open(path)?;
        if let Some(gate) = &self.gate {
            storage.service = Arc::new(
                DocumentService::scoped(
                    Arc::new(box_document_store::ScopedFsDocumentRepository::open(
                        std::path::Path::new(&storage.path),
                    )?),
                    GatedHistory {
                        root: storage.path.clone().into(),
                        history: GitDocumentHistory::new(self.history.clone()),
                        gate: gate.clone(),
                    },
                )
                .with_identity_source(
                    crate::infrastructure::document_identity::LocalDocumentIdentity,
                ),
            );
        }
        Ok(storage)
    }
    fn native_path(&self, path: &str) -> Result<String, DocumentError> {
        self.inner.native_path(path)
    }
}

#[tokio::test]
async fn disconnected_granted_mutation_survives_revoke_and_root_switch_drains_before_new_grant() {
    use tokio::io::AsyncWriteExt;
    let (entered, waiting) = tokio::sync::oneshot::channel();
    let (release, held) = std::sync::mpsc::channel();
    let gate = Arc::new(HistoryGate {
        entered: std::sync::Mutex::new(Some(entered)),
        release: std::sync::Mutex::new(held),
    });
    let f = Fixture::with_gate(Some(gate));
    let scope = f.workspace.scope().unwrap();
    let original = scope.read("note.md").unwrap();
    let history_path = f.roots[0].path().join("note.md").canonicalize().unwrap();
    let grant = f.runtime.grant(scope.clone(), "accepted").await.unwrap();
    let content = "---\npermalink: root-0\n---\naccepted after disconnect";
    let body=json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"update_document","arguments":{"document":{"path":"note.md"},"content":content,"expectedRevision":original.revision,"requestId":"accepted"}}}).to_string();
    let url = url::Url::parse(&grant.server.url).unwrap();
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", url.port().unwrap()))
        .await
        .unwrap();
    stream.write_all(format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: {}\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-11-25\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",url.port().unwrap(),grant.server.headers[0].value,body.len(),body).as_bytes()).await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(10), waiting)
        .await
        .unwrap()
        .unwrap();
    drop(stream);
    f.runtime.grants.revoke(&grant.grant_id);
    assert_eq!(
        f.call(&grant, "list_documents", json!({})).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let workspace = f.workspace.clone();
    let next = f.roots[1].path().to_str().unwrap().to_owned();
    let switching = tokio::task::spawn_blocking(move || workspace.select(&next, false));
    let old = scope.clone();
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::task::spawn_blocking(move || old.wait_until_stopped()),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!switching.is_finished());
    assert_eq!(
        f.runtime.grant(scope, "late").await.err().unwrap().code,
        "scopeRevoked"
    );
    release.send(()).unwrap();
    let selected = tokio::time::timeout(std::time::Duration::from_secs(10), switching)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_ne!(
        selected.generation.as_deref(),
        Some(grant.generation.as_str())
    );
    assert_eq!(
        fs::read_to_string(f.roots[0].path().join("note.md")).unwrap(),
        content
    );
    let versions = f.workspace.history(history_path.to_str().unwrap()).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(
        f.workspace
            .history_content(history_path.to_str().unwrap(), &versions[0].id)
            .unwrap(),
        content
    );
    assert_eq!(
        f.workspace
            .history_content(history_path.to_str().unwrap(), &versions[1].id)
            .unwrap(),
        original.content
    );
    let next = f
        .runtime
        .grant(f.workspace.scope().unwrap(), "accepted")
        .await
        .unwrap();
    let read = f
        .call(
            &next,
            "read_document",
            json!({"document":{"path":"note.md"}}),
        )
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        read["result"]["structuredContent"]["data"]["document"]["permalink"],
        "root-1"
    );
    f.stop().await;
}

#[tokio::test]
async fn shutdown_stops_http_admission_then_drains_an_accepted_disconnected_write() {
    use crate::ports::document_history::DocumentHistory;
    use tokio::io::AsyncWriteExt;
    let (entered, waiting) = tokio::sync::oneshot::channel();
    let (release, held) = std::sync::mpsc::channel();
    let f = Fixture::with_gate(Some(Arc::new(HistoryGate {
        entered: std::sync::Mutex::new(Some(entered)),
        release: std::sync::Mutex::new(held),
    })));
    let scope = f.workspace.scope().unwrap();
    let initial = scope.read("note.md").unwrap();
    let history_path = f.roots[0].path().join("note.md").canonicalize().unwrap();
    let grant = f.runtime.grant(scope.clone(), "exit").await.unwrap();
    let content = "---\npermalink: root-0\n---\naccepted before shutdown";
    let body=json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"update_document","arguments":{"document":{"path":"note.md"},"content":content,"expectedRevision":initial.revision,"requestId":"exit"}}}).to_string();
    let url = url::Url::parse(&grant.server.url).unwrap();
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", url.port().unwrap()))
        .await
        .unwrap();
    stream.write_all(format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: {}\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-11-25\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",url.port().unwrap(),grant.server.headers[0].value,body.len(),body).as_bytes()).await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(10), waiting)
        .await
        .unwrap()
        .unwrap();
    drop(stream);
    f.runtime.stop_admission().await;
    let workspace = f.workspace.clone();
    let draining = tokio::task::spawn_blocking(move || workspace.close_and_drain());
    let old = scope.clone();
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::task::spawn_blocking(move || old.wait_until_stopped()),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!draining.is_finished());
    assert_eq!(
        f.call(&grant, "list_documents", json!({})).await.status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        f.runtime.grant(scope, "late").await.err().unwrap().code,
        "scopeRevoked"
    );
    release.send(()).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(10), draining)
        .await
        .unwrap()
        .unwrap();
    f.runtime.shutdown().await.unwrap();
    assert_eq!(fs::read_to_string(&history_path).unwrap(), content);
    let history = GitDocumentHistory::new(f._history.path().into());
    let versions = history.list(history_path.to_str().unwrap()).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(
        history
            .read(history_path.to_str().unwrap(), &versions[0].id)
            .unwrap(),
        content
    );
    assert_eq!(
        history
            .read(history_path.to_str().unwrap(), &versions[1].id)
            .unwrap(),
        initial.content
    );
    assert!(f.client.get(&grant.server.url).send().await.is_err());
}
