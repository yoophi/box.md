use super::*;
use crate::{
    application::{document_service::DocumentService, document_workspace::DocumentWorkspace},
    infrastructure::{
        document_scope_factory::FsDocumentScopeFactory,
        fs_document_repository::FsDocumentRepository, git_document_history::GitDocumentHistory,
    },
};
use local_mcp_server::{HostConfig, LocalMcpHost};
use reqwest::{Client, StatusCode};
use std::{collections::HashMap, fs, sync::Mutex, time::Duration};

struct HistoryGate {
    entered: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}
struct GatedConnectionRepository {
    inner: crate::infrastructure::fs_connection_repository::FsConnectionRepository,
    gate: Arc<HistoryGate>,
}
impl crate::ports::connection_repository::ConnectionRepository for GatedConnectionRepository {
    fn read(&self) -> Result<crate::domain::connection::ConnectionSnapshot, DocumentError> {
        self.inner.read()
    }
    fn transact(
        &self,
        edit: &mut dyn FnMut(
            &mut crate::domain::connection::ConnectionSnapshot,
        ) -> Result<bool, DocumentError>,
    ) -> Result<crate::domain::connection::ConnectionSnapshot, DocumentError> {
        self.inner.transact(&mut |state| {
            let changed = edit(state)?;
            if let Some(entered) = self.gate.entered.lock().unwrap().take() {
                let _ = entered.send(());
                self.gate
                    .release
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(10))
                    .map_err(|_| {
                        DocumentError::new("internal", "Connection test gate timed out")
                    })?;
            }
            Ok(changed)
        })
    }
}
struct GatedHistory {
    root: std::path::PathBuf,
    inner: GitDocumentHistory,
    gate: Arc<HistoryGate>,
}
impl crate::ports::document_history::DocumentHistory for GatedHistory {
    fn record(&self, path: &str, content: &str) -> Result<(), DocumentError> {
        if let Some(entered) = self.gate.entered.lock().unwrap().take() {
            let _ = entered.send(());
            self.gate
                .release
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(10))
                .map_err(|_| DocumentError::new("internal", "History test gate timed out"))?;
        }
        self.inner
            .record(self.root.join(path).to_str().unwrap(), content)
    }
    fn list(&self, path: &str) -> Result<Vec<crate::domain::history::HistoryEntry>, DocumentError> {
        self.inner.list(self.root.join(path).to_str().unwrap())
    }
    fn read(&self, path: &str, id: &str) -> Result<String, DocumentError> {
        self.inner.read(self.root.join(path).to_str().unwrap(), id)
    }
}
struct TestFactory {
    inner: FsDocumentScopeFactory,
    history: std::path::PathBuf,
    gate: Option<Arc<HistoryGate>>,
    connections: Arc<crate::application::connection_service::ConnectionService>,
}
impl crate::ports::document_scope_factory::DocumentScopeFactory for TestFactory {
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
                        inner: GitDocumentHistory::new(self.history.clone()),
                        gate: gate.clone(),
                    },
                )
                .with_identity_source(
                    crate::infrastructure::document_identity::LocalDocumentIdentity,
                )
                .with_connections(self.connections.clone()),
            );
        }
        Ok(storage)
    }
    fn native_path(&self, path: &str) -> Result<String, DocumentError> {
        self.inner.native_path(path)
    }
}

struct Fixture {
    managers: Vec<Arc<DocumentWorkspace>>,
    roots: [tempfile::TempDir; 2],
    _history: tempfile::TempDir,
    connection_dir: tempfile::TempDir,
    connections: Arc<crate::application::connection_service::ConnectionService>,
    scopes: [Arc<DocumentScope>; 2],
    grants: Arc<Mutex<HashMap<String, DocumentPrincipal>>>,
    host: LocalMcpHost,
    client: Client,
    evidence: Option<std::path::PathBuf>,
}
impl Fixture {
    async fn new() -> Self {
        Self::with_gate(None).await
    }
    async fn with_gate(gate: Option<Arc<HistoryGate>>) -> Self {
        Self::with_gates(gate, None).await
    }
    async fn with_gates(
        mut gate: Option<Arc<HistoryGate>>,
        connection_gate: Option<Arc<HistoryGate>>,
    ) -> Self {
        let roots = [tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap()];
        let history = tempfile::tempdir().unwrap();
        let connection_dir = tempfile::tempdir().unwrap();
        let repository =
            crate::infrastructure::fs_connection_repository::FsConnectionRepository::new(
                connection_dir.path().into(),
            );
        let connections = Arc::new(match connection_gate {
            Some(gate) => crate::application::connection_service::ConnectionService::new(
                GatedConnectionRepository {
                    inner: repository,
                    gate,
                },
            ),
            None => crate::application::connection_service::ConnectionService::new(repository),
        });
        let mut scopes = vec![];
        for (index, root) in roots.iter().enumerate() {
            fs::write(root.path().join("legacy.md"), format!("---\npermalink: legacy-{index}\nsummary: 한 줄\n---\nroot {index} [[target]]\n")).unwrap();
            let workspace = DocumentWorkspace::new(
                DocumentService::new(
                    FsDocumentRepository,
                    GitDocumentHistory::new(history.path().into()),
                ),
                TestFactory {
                    inner: FsDocumentScopeFactory::new(history.path().into())
                        .with_connections(connections.clone()),
                    history: history.path().into(),
                    gate: gate.take(),
                    connections: connections.clone(),
                },
            );
            workspace
                .select(root.path().to_str().unwrap(), false)
                .unwrap();
            scopes.push((workspace, root.path().to_path_buf()));
        }
        // The manager owns lifecycle. Keep it for the fixture through an Arc
        // captured by the authorization closure; do not accidentally revoke on Drop.
        let managers: Vec<_> = scopes.into_iter().map(|(w, _)| Arc::new(w)).collect();
        let scopes = [managers[0].scope().unwrap(), managers[1].scope().unwrap()];
        let grants = Arc::new(Mutex::new(HashMap::from([
            ("fixture-a".into(), DocumentPrincipal(scopes[0].clone())),
            ("fixture-b".into(), DocumentPrincipal(scopes[1].clone())),
        ])));
        let resolver = grants.clone();
        let keep_alive = managers.clone();
        let host = local_mcp_server::start(
            || Ok(DocumentMcpHandler),
            move |token| {
                let _keep_alive = &keep_alive;
                resolver.lock().unwrap().get(token).cloned()
            },
            HostConfig::default(),
        )
        .await
        .unwrap();
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        Self {
            managers,
            roots,
            _history: history,
            connection_dir,
            connections,
            scopes,
            grants,
            host,
            client,
            evidence: std::env::var_os("BOX_MCP_SCHEMA_EVIDENCE").map(|dir| {
                let dir = std::path::PathBuf::from(dir);
                fs::create_dir_all(&dir).unwrap();
                dir.join(format!("{}.jsonl", uuid::Uuid::new_v4()))
            }),
        }
    }
    async fn rpc(&self, token: &str, method: &str, params: Value) -> Value {
        let response = self
            .client
            .post(self.host.endpoint())
            .bearer_auth(token)
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2025-11-25")
            .json(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response.json().await.unwrap()
    }
    async fn call_as(&self, token: &str, name: &str, args: Value) -> Value {
        let response = self
            .rpc(token, "tools/call", json!({"name":name,"arguments":args}))
            .await;
        assert!(response.get("error").is_none(), "{response}");
        let output = response["result"]["structuredContent"].clone();
        let text: Value =
            serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap())
                .unwrap();
        assert_eq!(output, text);
        assert_eq!(
            response["result"]["isError"],
            !output["ok"].as_bool().unwrap()
        );
        let tool = schemas::tool(name).unwrap();
        if let Some(path) = &self.evidence {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .unwrap();
            writeln!(
                file,
                "{}",
                json!({"tool":name,"schema":tool.output_schema,"output":output})
            )
            .unwrap();
        }
        assert!(
            schemas::valid(
                &Value::Object((*tool.output_schema.unwrap()).clone()),
                &output
            ),
            "{name}: {output}"
        );
        output
    }
    async fn call(&self, name: &str, args: Value) -> Value {
        self.call_as("fixture-a", name, args).await
    }
    async fn stop(self) {
        for scope in &self.scopes {
            scope.close_and_drain();
        }
        tokio::time::timeout(Duration::from_secs(10), self.host.shutdown())
            .await
            .unwrap()
            .unwrap();
    }
}

#[tokio::test]
async fn discovery_and_all_document_tools_use_real_http_files_and_common_results() {
    let f = Fixture::new().await;
    let initialized = f.rpc("fixture-a", "initialize", json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"box-test","version":"1"}})).await;
    assert_eq!(initialized["result"]["serverInfo"]["name"], "box-documents");
    let tools = f.rpc("fixture-a", "tools/list", json!({})).await;
    let tools = tools["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 15);
    for tool in tools {
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
        assert_eq!(tool["outputSchema"]["oneOf"].as_array().unwrap().len(), 2);
    }
    let original = f
        .call(
            "read_document",
            json!({"document":{"permalink":"legacy-0"}}),
        )
        .await;
    assert_eq!(original["data"]["document"]["path"], "legacy.md");
    let raw = "\u{feff}---\r\n# preserved\r\ntitle: 원본\r\nsummary: 한 줄\r\nunknown: {nested: [1, true]}\r\n---\r\n본문 [[legacy-0]]\r\n";
    let create_args = json!({"content":raw,"requestId":"create"});
    let created = f.call("create_document", create_args.clone()).await;
    assert_eq!(created["ok"], true);
    assert_eq!(created, f.call("create_document", create_args).await);
    let doc = &created["data"]["document"];
    let path = doc["path"].as_str().unwrap();
    let id = doc["permalink"].as_str().unwrap();
    assert_eq!(path, format!("{id}.md"));
    assert_eq!(id.len(), 21);
    assert_eq!(
        fs::read_to_string(f.roots[0].path().join(path)).unwrap(),
        doc["content"]
    );
    let reference = json!({"permalink":id});
    let meta = f
        .call("get_document_metadata", json!({"document":reference}))
        .await;
    assert_eq!(
        meta["data"]["metadata"]["unknown"]["nested"],
        json!([1, true])
    );
    let patched = f.call("update_document_metadata", json!({"document":reference,"patch":{"summary":"변경 요약"},"remove":[],"expectedRevision":doc["revision"],"requestId":"patch"})).await;
    assert_eq!(patched["data"]["metadata"]["summary"], "변경 요약");
    let source = &patched["data"]["document"];
    let copy = f.call("duplicate_document", json!({"document":reference,"expectedRevision":source["revision"],"requestId":"duplicate"})).await;
    assert_eq!(copy["ok"], true);
    let copied = &copy["data"]["document"];
    assert_ne!(copied["permalink"], id);
    let content = copied["content"].as_str().unwrap();
    assert!(content.starts_with('\u{feff}'));
    assert!(content.contains("# preserved\r\n"));
    assert!(content.contains("원본 사본"));
    assert!(content.ends_with("본문 [[legacy-0]]\r\n"));
    assert_eq!(
        f.call("read_document", json!({"document":reference})).await["data"]["document"],
        *source
    );
    let listed = f.call("list_documents", json!({"limit":1})).await;
    assert_eq!(listed["data"]["documents"].as_array().unwrap().len(), 1);
    assert!(listed["data"]["nextCursor"].is_string());
    let search = f
        .call("search_documents", json!({"query":"변경 요약"}))
        .await;
    assert_eq!(search["data"]["matches"].as_array().unwrap().len(), 2);
    let copy_ref = json!({"permalink":copied["permalink"]});
    let updated = f.call("update_document", json!({"document":copy_ref,"content":format!("{content}변경\r\n"),"expectedRevision":copied["revision"],"requestId":"update"})).await;
    assert_eq!(updated["ok"], true);
    let deleted = f.call("delete_document", json!({"document":copy_ref,"expectedRevision":updated["data"]["document"]["revision"],"requestId":"delete"})).await;
    assert_eq!(deleted["ok"], true);
    assert!(!f.roots[0]
        .path()
        .join(copied["path"].as_str().unwrap())
        .exists());
    let restored = f
        .call(
            "restore_document",
            json!({"trashId":deleted["data"]["trashId"],"requestId":"restore"}),
        )
        .await;
    assert_eq!(
        restored["data"]["document"]["content"],
        updated["data"]["document"]["content"]
    );
    assert_eq!(
        fs::read_to_string(f.roots[0].path().join("legacy.md")).unwrap(),
        original["data"]["document"]["content"]
    );
    f.stop().await;
}

#[tokio::test]
async fn invalid_arguments_protocol_errors_stale_revision_and_nonce_never_clobber() {
    let f = Fixture::new().await;
    for (name, args) in [
        ("list_documents", json!({"limit":0})),
        ("list_documents", json!({"limit":1.5})),
        ("list_documents", json!({"cursor":null})),
        (
            "read_document",
            json!({"document":{"path":"legacy.md","permalink":"legacy-0"}}),
        ),
        (
            "create_document",
            json!({"content":"x","requestId":"r","path":"chosen.md"}),
        ),
        (
            "create_document",
            json!({"content":"x","requestId":"r","operation":"create"}),
        ),
        ("create_document", json!({"content":false,"requestId":"r"})),
        (
            "duplicate_document",
            json!({"document":{"path":"legacy.md"},"expectedRevision":"r","requestId":"r","content":null}),
        ),
        (
            "update_document",
            json!({"document":{"path":"legacy.md"},"content":"x","requestId":"r"}),
        ),
    ] {
        assert_eq!(
            f.call(name, args).await["error"]["code"],
            "invalidArguments"
        );
    }
    let unknown = f
        .rpc(
            "fixture-a",
            "tools/call",
            json!({"name":"unknown","arguments":{}}),
        )
        .await;
    assert_eq!(unknown["error"]["code"], -32601);
    let current = f
        .call("read_document", json!({"document":{"path":"legacy.md"}}))
        .await;
    let changed = f.call("update_document",json!({"document":{"path":"legacy.md"},"content":"saved","expectedRevision":current["data"]["document"]["revision"],"requestId":"same"})).await;
    assert_eq!(changed["ok"], true);
    let conflict = f.call("update_document",json!({"document":{"path":"legacy.md"},"content":"stale","expectedRevision":current["data"]["document"]["revision"],"requestId":"stale"})).await;
    assert_eq!(conflict["error"]["code"], "conflict");
    assert_eq!(
        conflict["error"]["currentRevision"],
        changed["data"]["document"]["revision"]
    );
    let nonce = f
        .call("create_document", json!({"content":"x","requestId":"same"}))
        .await;
    assert_eq!(nonce["error"]["code"], "requestIdConflict");
    assert_eq!(
        fs::read_to_string(f.roots[0].path().join("legacy.md")).unwrap(),
        "saved"
    );
    assert_eq!(
        fs::read_dir(f.roots[0].path())
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_type().unwrap().is_file()
                && e.as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|v| v == "md"))
            .count(),
        1
    );
    f.stop().await;
}

#[tokio::test]
async fn principal_isolation_auth_retirement_and_live_permalink_resolution() {
    let f = Fixture::new().await;
    let denied = f
        .client
        .post(f.host.endpoint())
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        f.call_as(
            "fixture-b",
            "read_document",
            json!({"document":{"path":"legacy.md"}})
        )
        .await["data"]["document"]["permalink"],
        "legacy-1"
    );
    assert_eq!(
        f.call(
            "read_document",
            json!({"document":{"permalink":"legacy-1"}})
        )
        .await["error"]["code"],
        "notFound"
    );
    fs::rename(
        f.roots[0].path().join("legacy.md"),
        f.roots[0].path().join("moved.md"),
    )
    .unwrap();
    assert_eq!(
        f.call(
            "read_document",
            json!({"document":{"permalink":"legacy-0"}})
        )
        .await["data"]["document"]["path"],
        "moved.md"
    );
    fs::copy(
        f.roots[0].path().join("moved.md"),
        f.roots[0].path().join("duplicate.md"),
    )
    .unwrap();
    assert_eq!(
        f.call(
            "read_document",
            json!({"document":{"permalink":"legacy-0"}})
        )
        .await["error"]["code"],
        "duplicatePermalink"
    );
    assert_eq!(
        f.call("read_document", json!({"document":{"permalink":""}}))
            .await["error"]["code"],
        "invalidArguments"
    );
    for path in [
        "../secret.md",
        "/private/secret.md",
        ".box.md/trash/test.md",
    ] {
        let error = f
            .call("read_document", json!({"document":{"path":path}}))
            .await;
        assert_eq!(error["ok"], false);
        assert!(!error.to_string().contains(path));
        assert!(!error
            .to_string()
            .contains(f.roots[0].path().to_str().unwrap()));
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(
            f.roots[1].path().join("legacy.md"),
            f.roots[0].path().join("escape.md"),
        )
        .unwrap();
        assert_eq!(
            f.call("read_document", json!({"document":{"path":"escape.md"}}))
                .await["ok"],
            false
        );
    }
    f.scopes[0].close_and_drain();
    assert_eq!(
        f.call(
            "create_document",
            json!({"content":"x","requestId":"retired"})
        )
        .await["error"]["code"],
        "scopeRevoked"
    );
    assert_eq!(
        f.call_as("fixture-b", "list_documents", json!({})).await["ok"],
        true
    );
    f.grants.lock().unwrap().remove("fixture-b");
    let revoked = f
        .client
        .post(f.host.endpoint())
        .bearer_auth("fixture-b")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
    f.stop().await;
}

#[tokio::test]
async fn cursors_bind_to_current_index_query_and_principal_generation() {
    let f = Fixture::new().await;
    fs::write(f.roots[0].path().join("second.md"), "second root").unwrap();
    let page = f.call("list_documents", json!({"limit":1})).await;
    let cursor = page["data"]["nextCursor"].clone();
    let next = f
        .call("list_documents", json!({"cursor":cursor,"limit":1}))
        .await;
    assert_eq!(next["ok"], true);
    assert_eq!(next["data"]["documents"][0]["path"], "second.md");
    assert!(next["data"].get("nextCursor").is_none());
    assert_eq!(
        f.call_as("fixture-b", "list_documents", json!({"cursor":cursor}))
            .await["error"]["code"],
        "staleCursor"
    );
    let search = f
        .call("search_documents", json!({"query":"root","limit":1}))
        .await;
    let search_cursor = search["data"]["nextCursor"].clone();
    assert!(search_cursor.is_string());
    assert_eq!(
        f.call(
            "search_documents",
            json!({"query":"second","cursor":search_cursor})
        )
        .await["error"]["code"],
        "staleCursor"
    );
    fs::write(f.roots[0].path().join("second.md"), "changed").unwrap();
    assert_eq!(
        f.call("list_documents", json!({"cursor":cursor})).await["error"]["code"],
        "staleCursor"
    );
    f.stop().await;
}

#[tokio::test]
async fn dropped_http_connection_retains_accepted_mutation_result_and_single_history() {
    use tokio::io::AsyncWriteExt;
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let f = Fixture::with_gate(Some(Arc::new(HistoryGate {
        entered: Mutex::new(Some(entered_tx)),
        release: Mutex::new(release_rx),
    })))
    .await;
    let endpoint = url::Url::parse(f.host.endpoint()).unwrap();
    let port = endpoint.port().unwrap();
    let args = json!({"content":"---\ntitle: response lost\n---\nbody","requestId":"disconnected"});
    let body=json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_document","arguments":args}}).to_string();
    let mut socket = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    let request=format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer fixture-a\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-11-25\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",body.len());
    socket.write_all(request.as_bytes()).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), entered_rx)
        .await
        .unwrap()
        .unwrap();
    // The application has published the file and is still blocked inside its
    // accepted history operation when the actual TCP client disappears.
    drop(socket);
    let paths: Vec<_> = fs::read_dir(f.roots[0].path())
        .unwrap()
        .flatten()
        .filter(|e| e.file_type().unwrap().is_file() && e.file_name() != "legacy.md")
        .map(|e| e.path())
        .collect();
    assert_eq!(paths.len(), 1);
    let accepted = fs::read_to_string(&paths[0]).unwrap();
    release_tx.send(()).unwrap();
    let retry = f.call("create_document", args.clone()).await;
    assert_eq!(retry["ok"], true);
    assert!(retry["data"]["document"]["historyWarning"].is_null());
    assert_eq!(retry["data"]["document"]["content"], accepted);
    assert_eq!(retry, f.call("create_document", args).await);
    assert_eq!(
        fs::read_dir(f.roots[0].path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_type().unwrap().is_file())
            .count(),
        2
    );
    let history = GitDocumentHistory::new(f._history.path().into());
    use crate::ports::document_history::DocumentHistory;
    assert_eq!(
        history
            .list(paths[0].canonicalize().unwrap().to_str().unwrap())
            .unwrap()
            .len(),
        1
    );
    f.stop().await;
}

#[tokio::test]
async fn body_links_backlinks_live_resolution_and_partial_scan_never_mutate_files_or_connections() {
    let f = Fixture::new().await;
    let body="앞 [[target | 별칭 🌱]] [[missing]] [[ambiguous]] [[invalidtitle]]\r\n`[[inline]]`\r\n\\[[escaped]]\r\n\r\n```\r\n[[code]]\r\n```\r\n";
    let source = format!(
        "\u{feff}---\r\npermalink: legacy-0\r\nsummary: '[[header-only]]'\r\n---\r\n{body}"
    );
    fs::write(f.roots[0].path().join("legacy.md"), &source).unwrap();
    for (path,content) in [
        ("target.md","---\npermalink: target\n---\n# **최신** [[x | 별칭]]\n"),
        ("amb1.md","---\npermalink: ambiguous\n---\na"),("amb2.md","---\npermalink: ambiguous\n---\nb"),
        ("invalidtitle.md","---\npermalink: invalidtitle\ntitle: [not, string]\n---\ntext"),
        ("incoming.md","---\npermalink: incoming\nsummary: '[[legacy-0]]'\n---\n[[legacy-0 | source]] `[[legacy-0]]`"),
    ] {fs::write(f.roots[0].path().join(path),content).unwrap();}
    let connections = tempfile::tempdir().unwrap();
    let service = crate::application::connection_service::ConnectionService::new(
        crate::infrastructure::fs_connection_repository::FsConnectionRepository::new(
            connections.path().into(),
        ),
    );
    let created = service.create("独立 관계").unwrap();
    service.attach(&created.entities[0].id, "legacy-0").unwrap();
    let relationship_bytes = fs::read(connections.path().join("connections.json")).unwrap();
    let query = json!({"document":{"path":"legacy.md"}});
    let result = f.call("get_document_links", query.clone()).await;
    assert_eq!(result["ok"], true);
    let data = &result["data"];
    assert_eq!(data["truncated"], false);
    assert_eq!(data["links"].as_array().unwrap().len(), 4);
    assert_eq!(data["links"][0]["state"], "resolved");
    assert_eq!(data["links"][0]["alias"], "별칭 🌱");
    assert_eq!(data["links"][0]["target"]["title"], "최신 별칭");
    assert_eq!(data["links"][1]["state"], "missing");
    assert_eq!(data["links"][2]["state"], "duplicate");
    assert_eq!(data["links"][3]["state"], "error");
    for link in data["links"].as_array().unwrap() {
        assert_eq!(
            &body[link["byteStart"].as_u64().unwrap() as usize
                ..link["byteEnd"].as_u64().unwrap() as usize],
            link["raw"].as_str().unwrap()
        );
    }
    assert_eq!(data["backlinks"].as_array().unwrap().len(), 1);
    assert_eq!(data["backlinks"][0]["document"]["permalink"], "incoming");
    assert_eq!(data["backlinks"][0]["links"].as_array().unwrap().len(), 1);
    fs::rename(
        f.roots[0].path().join("target.md"),
        f.roots[0].path().join("renamed.md"),
    )
    .unwrap();
    assert_eq!(
        f.call("get_document_links", query.clone()).await["data"]["links"][0]["target"]["path"],
        "renamed.md"
    );
    fs::write(
        f.roots[0].path().join("bad.md"),
        "---\nunknown: [invalid YAML\n---\n[[legacy-0]]",
    )
    .unwrap();
    let partial = f.call("get_document_links", query).await;
    assert_eq!(partial["ok"], true);
    assert!(!partial["data"]["warnings"].as_array().unwrap().is_empty());
    assert_eq!(partial["data"]["links"][0]["state"], "error");
    assert_eq!(partial["data"]["links"][2]["state"], "duplicate");
    assert_eq!(partial["data"]["backlinks"].as_array().unwrap().len(), 1);
    assert_eq!(
        fs::read_to_string(f.roots[0].path().join("legacy.md")).unwrap(),
        source
    );
    assert_eq!(
        fs::read(connections.path().join("connections.json")).unwrap(),
        relationship_bytes
    );
    f.stop().await;
}

#[tokio::test]
async fn link_and_backlink_output_share_a_global_token_limit_without_silent_completeness() {
    let f = Fixture::new().await;
    let source = format!(
        "---\npermalink: legacy-0\n---\n{}",
        "[[legacy-0]] ".repeat(10_001)
    );
    fs::write(f.roots[0].path().join("legacy.md"), &source).unwrap();
    let result = f
        .call(
            "get_document_links",
            json!({"document":{"path":"legacy.md"}}),
        )
        .await;
    assert_eq!(result["ok"], true);
    assert_eq!(result["data"]["links"].as_array().unwrap().len(), 10_000);
    assert!(result["data"]["backlinks"].as_array().unwrap().is_empty());
    assert_eq!(result["data"]["truncated"], true);
    let warnings = result["data"]["warnings"].as_array().unwrap();
    assert!(warnings.iter().any(|w| w["code"] == "linkLimit"));
    assert!(warnings.iter().any(|w| w["code"] == "backlinkLimit"));
    assert_eq!(
        fs::read_to_string(f.roots[0].path().join("legacy.md")).unwrap(),
        source
    );
    f.stop().await;
}

#[tokio::test]
async fn bounded_target_titles_and_heading_alias_markup_remain_inert() {
    let f = Fixture::new().await;
    fs::write(
        f.roots[0].path().join("legacy.md"),
        "---\npermalink: legacy-0\n---\n[[huge]] [[inert]] [[fallback]]",
    )
    .unwrap();
    fs::write(
        f.roots[0].path().join("huge.md"),
        format!(
            "---\npermalink: huge\ntitle: {}\n---\ntext",
            "x".repeat(8193)
        ),
    )
    .unwrap();
    fs::write(
        f.roots[0].path().join("inert.md"),
        "---\npermalink: inert\n---\n```\n# wrong\n```\n\n# [[unknown | <b>alias</b>]]",
    )
    .unwrap();
    fs::write(
        f.roots[0].path().join("fallback.md"),
        "---\npermalink: fallback\n---\nplain body",
    )
    .unwrap();
    let result = f
        .call(
            "get_document_links",
            json!({"document":{"path":"legacy.md"}}),
        )
        .await;
    assert_eq!(result["data"]["links"][0]["state"], "error");
    assert!(result["data"]["links"][0].get("target").is_none());
    assert_eq!(
        result["data"]["links"][1]["target"]["title"],
        "<b>alias</b>"
    );
    assert_eq!(result["data"]["links"][2]["target"]["title"], "fallback.md");
    f.stop().await;
}

#[tokio::test]
async fn connection_tools_keep_many_to_many_pairs_and_markdown_independent_with_cached_retries() {
    let f = Fixture::new().await;
    let original: Vec<_> = f
        .roots
        .iter()
        .map(|r| fs::read(r.path().join("legacy.md")).unwrap())
        .collect();
    let args = json!({"name":" review ","requestId":"connection-create"});
    let first = f.call("create_connection", args.clone()).await;
    assert_eq!(first["ok"], true);
    assert_eq!(first, f.call("create_connection", args).await);
    assert_eq!(
        f.call(
            "create_connection",
            json!({"name":"different","requestId":"connection-create"})
        )
        .await["error"]["code"],
        "requestIdConflict"
    );
    let id = first["data"]["connections"]["entities"][0]["id"]
        .as_str()
        .unwrap();
    assert!(uuid::Uuid::parse_str(id).is_ok());
    assert_eq!(first["data"]["connection"]["id"], id);
    assert_eq!(first["data"]["connection"]["name"], "review");
    assert_eq!(
        first["data"]["connections"]["entities"][0]["name"],
        "review"
    );
    for (nonce, permalink) in [("attach-a", "legacy-0"), ("attach-b", "legacy-1")] {
        let args = json!({"connectionId":id,"permalink":permalink,"requestId":nonce});
        let attached = f.call("attach_connection", args.clone()).await;
        assert_eq!(attached["ok"], true);
        assert_eq!(attached, f.call("attach_connection", args).await);
    }
    let second = f
        .call(
            "create_connection",
            json!({"name":"other","requestId":"other-create"}),
        )
        .await;
    let second_id = second["data"]["connections"]["entities"][1]["id"]
        .as_str()
        .unwrap();
    assert_eq!(
        f.call(
            "attach_connection",
            json!({"connectionId":second_id,"permalink":"legacy-0","requestId":"attach-other"})
        )
        .await["ok"],
        true
    );
    let selected = f
        .call(
            "list_connections",
            json!({"document":{"permalink":"legacy-0"}}),
        )
        .await;
    assert_eq!(
        selected["data"]["connections"]["entities"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        selected["data"]["connections"]["memberships"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let all = f.call("list_connections", json!({})).await;
    assert!(all["data"]["connections"]["memberships"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["permalink"] == "legacy-1" && m["state"] == "unresolved"));
    let other_root = f.call_as("fixture-b", "list_connections", json!({})).await;
    assert!(other_root["data"]["connections"]["memberships"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["permalink"] == "legacy-1" && m["state"] == "resolved"));
    let detach = json!({"connectionId":id,"permalink":"legacy-0","requestId":"detach"});
    let detached = f.call("detach_connection", detach.clone()).await;
    assert_eq!(detached, f.call("detach_connection", detach).await);
    let state = f.connections.snapshot().unwrap();
    assert_eq!(state.entities.len(), 2);
    assert_eq!(state.memberships.len(), 2);
    assert!(state
        .memberships
        .iter()
        .any(|m| m.connection_id == id && m.permalink == "legacy-1"));
    assert!(state
        .memberships
        .iter()
        .any(|m| m.connection_id == second_id && m.permalink == "legacy-0"));
    for (root, bytes) in f.roots.iter().zip(original.iter()) {
        assert_eq!(fs::read(root.path().join("legacy.md")).unwrap(), *bytes);
    }
    let connection_bytes = fs::read(f.connection_dir.path().join("connections.json")).unwrap();
    let doc = f
        .call("read_document", json!({"document":{"path":"legacy.md"}}))
        .await;
    let changed=f.call("update_document",json!({"document":{"path":"legacy.md"},"content":format!("{}\n[[legacy-1]]",doc["data"]["document"]["content"].as_str().unwrap()),"expectedRevision":doc["data"]["document"]["revision"],"requestId":"body-save"})).await;
    assert_eq!(changed["ok"], true);
    assert_eq!(
        fs::read(f.connection_dir.path().join("connections.json")).unwrap(),
        connection_bytes
    );
    let metadata=f.call("update_document_metadata",json!({"document":{"path":"legacy.md"},"patch":{"permalink":"changed-id","title":"new title"},"remove":[],"expectedRevision":changed["data"]["document"]["revision"],"requestId":"identity-change"})).await;
    assert_eq!(metadata["ok"], true);
    assert_eq!(
        fs::read(f.connection_dir.path().join("connections.json")).unwrap(),
        connection_bytes
    );
    let by_new_id = f
        .call(
            "list_connections",
            json!({"document":{"permalink":"changed-id"}}),
        )
        .await;
    assert!(by_new_id["data"]["connections"]["memberships"]
        .as_array()
        .unwrap()
        .is_empty());
    let deleted=f.call("delete_document",json!({"document":{"path":"legacy.md"},"expectedRevision":metadata["data"]["document"]["revision"],"requestId":"delete-linked"})).await;
    assert_eq!(deleted["ok"], true);
    let unresolved = f.call("list_connections", json!({})).await;
    assert!(unresolved["data"]["connections"]["memberships"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["permalink"] == "legacy-0" && m["state"] == "unresolved"));
    assert_eq!(
        fs::read(f.connection_dir.path().join("connections.json")).unwrap(),
        connection_bytes
    );
    f.stop().await;
}

#[tokio::test]
async fn concurrent_connection_requests_preserve_distinct_pairs_and_one_entity_per_nonce() {
    let f = Fixture::new().await;
    let args = json!({"name":"concurrent","requestId":"same-creation"});
    let (a, b) = tokio::join!(
        f.call("create_connection", args.clone()),
        f.call("create_connection", args)
    );
    assert_eq!(a, b);
    assert_eq!(f.connections.snapshot().unwrap().entities.len(), 1);
    let id = a["data"]["connections"]["entities"][0]["id"]
        .as_str()
        .unwrap();
    let (a, b) = tokio::join!(
        f.call(
            "attach_connection",
            json!({"connectionId":id,"permalink":"legacy-0","requestId":"pair-a"})
        ),
        f.call_as(
            "fixture-b",
            "attach_connection",
            json!({"connectionId":id,"permalink":"legacy-1","requestId":"pair-b"})
        )
    );
    assert_eq!(a["ok"], true);
    assert_eq!(b["ok"], true);
    assert_eq!(f.connections.snapshot().unwrap().memberships.len(), 2);
    assert_eq!(
        f.call(
            "attach_connection",
            json!({"connectionId":"missing","permalink":"legacy-0","requestId":"unknown-entity"})
        )
        .await["error"]["code"],
        "connectionNotFound"
    );
    assert_eq!(
        f.call(
            "create_connection",
            json!({"name":"CONCURRENT","requestId":"duplicate-name"})
        )
        .await["error"]["code"],
        "connectionNameExists"
    );
    assert_eq!(f.connections.snapshot().unwrap().entities.len(), 1);
    for (name, args) in [
        ("list_connections", json!({"root":"/private"})),
        (
            "create_connection",
            json!({"name":123,"requestId":"wrong-type"}),
        ),
        (
            "attach_connection",
            json!({"connectionId":id,"permalink":"legacy-0","requestId":"wrong-key","path":"chosen.md"}),
        ),
        (
            "detach_connection",
            json!({"connectionId":id,"permalink":"legacy-0"}),
        ),
    ] {
        assert_eq!(
            f.call(name, args).await["error"]["code"],
            "invalidArguments"
        );
    }
    f.stop().await;
}

async fn send_connection_without_waiting(f: &Fixture, args: Value) -> tokio::net::TcpStream {
    use tokio::io::AsyncWriteExt;
    let port = url::Url::parse(f.host.endpoint()).unwrap().port().unwrap();
    let body=json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_connection","arguments":args}}).to_string();
    let mut socket = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    socket.write_all(format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer fixture-a\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-11-25\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
    socket
}

#[tokio::test]
async fn disconnected_connection_creation_retries_one_persisted_entity() {
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let f = Fixture::with_gates(
        None,
        Some(Arc::new(HistoryGate {
            entered: Mutex::new(Some(entered_tx)),
            release: Mutex::new(release_rx),
        })),
    )
    .await;
    let args = json!({"name":"response lost","requestId":"lost-connection"});
    let socket = send_connection_without_waiting(&f, args.clone()).await;
    tokio::time::timeout(Duration::from_secs(5), entered_rx)
        .await
        .unwrap()
        .unwrap();
    assert!(f.connections.snapshot().unwrap().entities.is_empty());
    drop(socket);
    release_tx.send(()).unwrap();
    let result = f.call("create_connection", args.clone()).await;
    assert_eq!(result["ok"], true);
    assert_eq!(result, f.call("create_connection", args).await);
    let state = f.connections.snapshot().unwrap();
    assert_eq!(state.entities.len(), 1);
    assert_eq!(
        state.entities[0].id,
        result["data"]["connections"]["entities"][0]["id"]
    );
    assert!(state.memberships.is_empty());
    f.stop().await;
}

#[tokio::test]
async fn root_switch_drains_a_disconnected_accepted_connection_and_rejects_new_writes() {
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let f = Fixture::with_gates(
        None,
        Some(Arc::new(HistoryGate {
            entered: Mutex::new(Some(entered_tx)),
            release: Mutex::new(release_rx),
        })),
    )
    .await;
    let socket = send_connection_without_waiting(
        &f,
        json!({"name":"accepted before close","requestId":"retiring"}),
    )
    .await;
    tokio::time::timeout(Duration::from_secs(5), entered_rx)
        .await
        .unwrap()
        .unwrap();
    drop(socket);
    let manager = f.managers[0].clone();
    let next_root = f.roots[1].path().to_path_buf();
    let switch =
        tokio::task::spawn_blocking(move || manager.select(next_root.to_str().unwrap(), false));
    let scope = f.scopes[0].clone();
    tokio::time::timeout(
        Duration::from_secs(5),
        tokio::task::spawn_blocking(move || scope.wait_until_stopped()),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!switch.is_finished());
    assert_eq!(
        f.call(
            "create_connection",
            json!({"name":"rejected","requestId":"after-close"})
        )
        .await["error"]["code"],
        "scopeRevoked"
    );
    assert!(f.connections.snapshot().unwrap().entities.is_empty());
    release_tx.send(()).unwrap();
    let selected = tokio::time::timeout(Duration::from_secs(5), switch)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_ne!(
        selected.generation.as_deref(),
        Some(f.scopes[0].generation.as_str())
    );
    assert_eq!(
        f.managers[0]
            .scope()
            .unwrap()
            .list_connections(None)
            .unwrap()["connections"]["entities"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let state = f.connections.snapshot().unwrap();
    assert_eq!(state.entities.len(), 1);
    assert_eq!(state.entities[0].name, "accepted before close");
    assert_eq!(
        f.call_as("fixture-b", "list_connections", json!({})).await["data"]["connections"]
            ["entities"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    f.stop().await;
}
