use crate::{
    application::workspace_service::WorkspaceService,
    domain::{document::DocumentError, workspace::WorkspaceSnapshot},
};
#[tauri::command]
pub fn list_workspace_documents(
    path: String,
    service: tauri::State<'_, WorkspaceService>,
    documents: tauri::State<'_, crate::application::document_workspace::DocumentWorkspace>,
) -> Result<WorkspaceSnapshot, DocumentError> {
    if let Some(snapshot) = documents.list(&path)? {
        Ok(snapshot)
    } else {
        service.list(&path)
    }
}

#[tauri::command]
pub fn select_document_workspace<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    rebind: Option<bool>,
    documents: tauri::State<'_, crate::application::document_workspace::DocumentWorkspace>,
) -> Result<WorkspaceSnapshot, DocumentError> {
    let snapshot = documents.select(&path, rebind.unwrap_or(false))?;
    if let Some(mcp) =
        tauri::Manager::try_state::<super::document_mcp_runtime::DocumentMcpRuntime>(&app)
    {
        mcp.grants.prune_inactive();
    }
    Ok(snapshot)
}
