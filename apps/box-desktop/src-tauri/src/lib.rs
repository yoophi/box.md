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
        .manage(application::document_service::DocumentService::new(
            infrastructure::fs_document_repository::FsDocumentRepository,
        ))
        .manage(application::workspace_service::WorkspaceService::new(
            infrastructure::fs_workspace_repository::FsWorkspaceRepository,
        ))
        .invoke_handler(tauri::generate_handler![
            set_exit_allowed,
            inbound::get_app_info,
            inbound::document_commands::open_document,
            inbound::document_commands::save_document,
            inbound::document_commands::document_revision,
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
