fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "set_exit_allowed",
            "get_app_info",
            "get_workbench_connection",
            "open_document",
            "save_document",
            "document_revision",
            "document_history",
            "history_content",
            "list_workspace_documents",
            "list_document_comments",
            "add_document_comment",
            "list_connections",
            "create_connection_entity",
            "attach_document_connection",
            "detach_document_connection",
            "site_browser_open",
            "site_browser_layout",
            "site_browser_action",
            "site_browser_snapshot",
        ]),
    ))
    .expect("failed to build box.md permissions");
}
