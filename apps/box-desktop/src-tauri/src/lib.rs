mod application;
mod domain;
mod inbound;
mod infrastructure;
mod ports;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

struct ExitGuard(AtomicBool);

#[tauri::command]
fn set_exit_allowed(allowed: bool, guard: tauri::State<'_, ExitGuard>) {
    guard.0.store(allowed, Ordering::SeqCst);
}

pub fn run() {
    let service = application::AppInfoService::new(infrastructure::NativeAppInfo);
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
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
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("box:request-close", ());
                }
            }
        })
        .manage(ExitGuard(AtomicBool::new(false)))
        .manage(service)
        .setup(|app| {
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
        .build(tauri::generate_context!())
        .expect("error while building box.md")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<ExitGuard>().0.load(Ordering::SeqCst) {
                    if let Some(window) = app.get_webview_window("main") {
                        api.prevent_exit();
                        let _ = window.emit("box:request-close", ());
                    }
                }
            }
        });
}
