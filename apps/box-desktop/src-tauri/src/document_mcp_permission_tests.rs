use super::*;
use serde_json::{json, Value};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};

fn request(cmd: &str, body: Value, origin: &str) -> tauri::webview::InvokeRequest {
    tauri::webview::InvokeRequest {
        cmd: cmd.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: origin.parse().unwrap(),
        body: tauri::ipc::InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.into(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn main_grant_command_uses_selected_generation_and_child_cannot_issue_or_revoke() {
    let root = tempfile::tempdir().unwrap();
    let next = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path().join("note.md"),
        "---\npermalink: original\n---\noriginal",
    )
    .unwrap();
    std::fs::write(
        next.path().join("note.md"),
        "---\npermalink: next\n---\nnext",
    )
    .unwrap();
    let app = mock_builder()
        .manage(inbound::document_mcp_runtime::DocumentMcpRuntime::new())
        .manage(application::document_workspace::DocumentWorkspace::new(
            application::document_service::DocumentService::new(
                infrastructure::fs_document_repository::FsDocumentRepository,
                infrastructure::git_document_history::GitDocumentHistory::new(
                    history.path().into(),
                ),
            ),
            infrastructure::document_scope_factory::FsDocumentScopeFactory::new(
                history.path().into(),
            ),
        ))
        .invoke_handler(tauri::generate_handler![
            inbound::workspace_commands::select_document_workspace,
            inbound::document_mcp_commands::get_document_mcp_grant,
            inbound::document_mcp_commands::revoke_document_mcp_grant
        ])
        .build(app_context())
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let child = app
        .get_window("main")
        .unwrap()
        .add_child(
            tauri::webview::WebviewBuilder::new(
                "site-browser",
                tauri::WebviewUrl::External("https://example.com".parse().unwrap()),
            ),
            tauri::LogicalPosition::new(0, 0),
            tauri::LogicalSize::new(400, 400),
        )
        .unwrap();
    let child = Box::new(child);
    let selected: Value = get_ipc_response(
        &main,
        request(
            "select_document_workspace",
            json!({"path":root.path()}),
            "tauri://localhost/",
        ),
    )
    .unwrap()
    .deserialize()
    .unwrap();
    let invalid = get_ipc_response(
        &main,
        request(
            "get_document_mcp_grant",
            json!({"generation":"stale","runId":"run"}),
            "tauri://localhost/",
        ),
    )
    .unwrap_err();
    assert_eq!(invalid["code"], "scopeRevoked");
    let args = json!({"generation":selected["generation"],"runId":"run"});
    let grant: Value = get_ipc_response(
        &main,
        request("get_document_mcp_grant", args.clone(), "tauri://localhost/"),
    )
    .unwrap()
    .deserialize()
    .unwrap();
    assert_eq!(grant["generation"], selected["generation"]);
    assert_eq!(grant["runId"], "run");
    assert_eq!(grant["server"]["type"], "http");
    for origin in [
        "https://example.com/",
        "tauri://localhost/",
        "http://localhost:1430/",
    ] {
        for (cmd, body) in [
            ("get_document_mcp_grant", args.clone()),
            (
                "revoke_document_mcp_grant",
                json!({"grantId":grant["grantId"]}),
            ),
        ] {
            let error = get_ipc_response(&child, request(cmd, body, origin)).unwrap_err();
            assert!(error.as_str().unwrap().contains("not allowed"));
        }
    }
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let call = || {
        client.post(grant["server"]["url"].as_str().unwrap())
        .header("Authorization",grant["server"]["headers"][0]["value"].as_str().unwrap())
        .header("accept","application/json, text/event-stream").header("mcp-protocol-version","2025-11-25")
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_document","arguments":{"document":{"path":"note.md"}}}}))
    };
    let read = call().send().await.unwrap().json::<Value>().await.unwrap();
    assert_eq!(
        read["result"]["structuredContent"]["data"]["document"]["permalink"],
        "original"
    );
    get_ipc_response(
        &main,
        request(
            "revoke_document_mcp_grant",
            json!({"grantId":grant["grantId"]}),
            "tauri://localhost/",
        ),
    )
    .unwrap();
    assert_eq!(
        call().send().await.unwrap().status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    let retry = get_ipc_response(
        &main,
        request("get_document_mcp_grant", args.clone(), "tauri://localhost/"),
    )
    .unwrap_err();
    assert_eq!(retry["code"], "grantRevoked");
    let selected_next: Value = get_ipc_response(
        &main,
        request(
            "select_document_workspace",
            json!({"path":next.path()}),
            "tauri://localhost/",
        ),
    )
    .unwrap()
    .deserialize()
    .unwrap();
    assert_ne!(selected_next["generation"], selected["generation"]);
    let stale = get_ipc_response(
        &main,
        request("get_document_mcp_grant", args, "tauri://localhost/"),
    )
    .unwrap_err();
    assert_eq!(stale["code"], "scopeRevoked");
    let new_grant: Value = get_ipc_response(
        &main,
        request(
            "get_document_mcp_grant",
            json!({"generation":selected_next["generation"],"runId":"run"}),
            "tauri://localhost/",
        ),
    )
    .unwrap()
    .deserialize()
    .unwrap();
    assert_ne!(new_grant["grantId"], grant["grantId"]);
    let runtime = app.state::<inbound::document_mcp_runtime::DocumentMcpRuntime>();
    runtime.stop_admission().await;
    app.state::<application::document_workspace::DocumentWorkspace>()
        .close_and_drain();
    runtime.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_grant_preparation_cannot_publish_an_old_generation_after_root_switch() {
    struct SlowToken {
        entered: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
        release: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
    }
    impl ports::document_grant_token::DocumentGrantToken for SlowToken {
        fn generate(&self) -> Result<String, domain::document::DocumentError> {
            if let Some(sender) = self.entered.lock().unwrap().take() {
                let _ = sender.send(());
                self.release
                    .lock()
                    .unwrap()
                    .recv_timeout(std::time::Duration::from_secs(10))
                    .map_err(|_| {
                        domain::document::DocumentError::new("internal", "Test gate timed out")
                    })?;
            }
            infrastructure::random_document_grant_token::RandomDocumentGrantToken.generate()
        }
    }
    let root = tempfile::tempdir().unwrap();
    let next = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    let (entered, waiting) = tokio::sync::oneshot::channel();
    let (release, held) = std::sync::mpsc::channel();
    let mut runtime = inbound::document_mcp_runtime::DocumentMcpRuntime::new();
    runtime.grants = std::sync::Arc::new(application::document_grants::DocumentGrants::new(
        SlowToken {
            entered: std::sync::Mutex::new(Some(entered)),
            release: std::sync::Mutex::new(held),
        },
    ));
    let app = mock_builder()
        .manage(runtime)
        .manage(application::document_workspace::DocumentWorkspace::new(
            application::document_service::DocumentService::new(
                infrastructure::fs_document_repository::FsDocumentRepository,
                infrastructure::git_document_history::GitDocumentHistory::new(
                    history.path().into(),
                ),
            ),
            infrastructure::document_scope_factory::FsDocumentScopeFactory::new(
                history.path().into(),
            ),
        ))
        .invoke_handler(tauri::generate_handler![
            inbound::document_mcp_commands::get_document_mcp_grant
        ])
        .build(app_context())
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let selected = app
        .state::<application::document_workspace::DocumentWorkspace>()
        .select(root.path().to_str().unwrap(), false)
        .unwrap();
    let args = json!({"generation":selected.generation,"runId":"racing-run"});
    let pending = tokio::task::spawn_blocking(move || {
        get_ipc_response(
            &main,
            request("get_document_mcp_grant", args, "tauri://localhost/"),
        )
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), waiting)
        .await
        .unwrap()
        .unwrap();
    let changed = app
        .state::<application::document_workspace::DocumentWorkspace>()
        .select(next.path().to_str().unwrap(), false)
        .unwrap();
    release.send(()).unwrap();
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(10), pending)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(outcome["code"], "scopeRevoked");
    assert_ne!(changed.generation, selected.generation);
    let runtime = app.state::<inbound::document_mcp_runtime::DocumentMcpRuntime>();
    let current = runtime
        .grant(
            app.state::<application::document_workspace::DocumentWorkspace>()
                .scope()
                .unwrap(),
            "racing-run",
        )
        .await
        .unwrap();
    assert_eq!(Some(current.generation), changed.generation);
    runtime.stop_admission().await;
    app.state::<application::document_workspace::DocumentWorkspace>()
        .close_and_drain();
    runtime.shutdown().await.unwrap();
}
