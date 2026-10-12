use crate::{
    application::workspace_service::WorkspaceService,
    domain::{document::DocumentError, workspace::WorkspaceSnapshot},
};
#[tauri::command]
pub fn list_workspace_documents(
    path: String,
    service: tauri::State<'_, WorkspaceService>,
) -> Result<WorkspaceSnapshot, DocumentError> {
    service.list(&path)
}
