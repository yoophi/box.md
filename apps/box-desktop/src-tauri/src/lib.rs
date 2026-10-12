mod application;
mod domain;
mod inbound;
mod infrastructure;
mod ports;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

struct ExitGuard(AtomicBool);

fn app_context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

#[tauri::command]
fn set_exit_allowed(allowed: bool, guard: tauri::State<'_, ExitGuard>) {
    guard.0.store(allowed, Ordering::SeqCst);
}

#[cfg(test)]
mod browser_permission_tests {
    use super::*;
    use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
    #[test]
    fn compiled_app_permissions_isolate_child_webviews_even_on_a_local_origin() {
        let app = mock_builder()
            .manage(application::AppInfoService::new(
                infrastructure::NativeAppInfo,
            ))
            .invoke_handler(tauri::generate_handler![inbound::get_app_info])
            .build(app_context())
            .unwrap();
        let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let child = Box::new(
            app.get_window("main")
                .unwrap()
                .add_child(
                    tauri::webview::WebviewBuilder::new(
                        "site-browser",
                        tauri::WebviewUrl::External("https://example.com".parse().unwrap()),
                    ),
                    tauri::LogicalPosition::new(0, 0),
                    tauri::LogicalSize::new(400, 400),
                )
                .unwrap(),
        );
        let request = |origin: &str| tauri::webview::InvokeRequest {
            cmd: "get_app_info".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: origin.parse().unwrap(),
            body: Default::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        };
        assert!(get_ipc_response(&main, request("tauri://localhost/")).is_ok());
        assert!(get_ipc_response(&main, request("http://localhost:1430/")).is_ok());
        assert!(get_ipc_response(&main, request("https://example.com/")).is_err());
        for origin in [
            "https://example.com/",
            "tauri://localhost/",
            "http://localhost:1430/",
        ] {
            let denied = get_ipc_response(&child, request(origin)).unwrap_err();
            assert!(denied.as_str().unwrap().contains("not allowed"), "{denied}");
        }
        // Multi-webview windows are not WebviewWindow objects; main-window lifecycle uses Window.
        assert!(app.get_webview_window("main").is_none());
        let window = app.get_window("main").unwrap();
        window.show().unwrap();
        window.set_focus().unwrap();
        window.emit("box:request-close", ()).unwrap();
        assert_eq!(app.get_webview("main").unwrap().label(), "main");
    }
}

pub fn run() {
    let service = application::AppInfoService::new(infrastructure::NativeAppInfo);
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(infrastructure::native_menu::build)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "request-quit" {
                if let Some(window) = app.get_window("main") {
                    let _ = window.emit("box:request-close", ());
                }
            }
        })
        .manage(ExitGuard(AtomicBool::new(false)))
        .manage(service)
        .setup(|app| {
            app.manage(std::sync::Arc::new(
                application::site_browser_service::SiteBrowserService::new(
                    infrastructure::native_site_browser::NativeSiteBrowser::new(
                        app.handle().clone(),
                    ),
                ),
            ));
            app.manage(std::sync::Arc::new(
                application::connection_service::ConnectionService::new(
                    infrastructure::fs_connection_repository::FsConnectionRepository::new(
                        app.path().app_data_dir()?,
                    ),
                ),
            ));
            app.manage(infrastructure::workbench_shell::WorkbenchShell::new(
                &app.path().app_data_dir()?,
            ));
            app.manage(application::comment_service::CommentService::new(
                infrastructure::fs_comment_repository::FsCommentRepository::new(
                    app.path().app_data_dir()?.join("comments"),
                ),
            ));
            app.manage(application::document_service::DocumentService::new(
                infrastructure::fs_document_repository::FsDocumentRepository,
                infrastructure::git_document_history::GitDocumentHistory::new(
                    app.path().app_data_dir()?.join("history"),
                ),
            ));
            Ok(())
        })
        .manage(application::workspace_service::WorkspaceService::new(
            infrastructure::fs_workspace_repository::FsWorkspaceRepository,
        ))
        .invoke_handler(tauri::generate_handler![
            set_exit_allowed,
            inbound::site_browser_commands::site_browser_open,
            inbound::site_browser_commands::site_browser_layout,
            inbound::site_browser_commands::site_browser_action,
            inbound::site_browser_commands::site_browser_snapshot,
            inbound::connection_commands::list_connections,
            inbound::connection_commands::create_connection_entity,
            inbound::connection_commands::attach_document_connection,
            inbound::connection_commands::detach_document_connection,
            inbound::workbench_commands::get_workbench_connection,
            inbound::comment_commands::list_document_comments,
            inbound::comment_commands::add_document_comment,
            inbound::get_app_info,
            inbound::document_commands::open_document,
            inbound::document_commands::save_document,
            inbound::document_commands::document_revision,
            inbound::document_commands::document_history,
            inbound::document_commands::history_content,
            inbound::workspace_commands::list_workspace_documents
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(shell) = window
                    .app_handle()
                    .try_state::<infrastructure::workbench_shell::WorkbenchShell>()
                {
                    shell.retire();
                }
            }
        })
        .build(app_context())
        .expect("error while building box.md")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(shell) =
                    app.try_state::<infrastructure::workbench_shell::WorkbenchShell>()
                {
                    tauri::async_runtime::block_on(shell.shutdown());
                }
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<ExitGuard>().0.load(Ordering::SeqCst) {
                    if let Some(window) = app.get_window("main") {
                        api.prevent_exit();
                        let _ = window.emit("box:request-close", ());
                    }
                }
            }
        });
}
