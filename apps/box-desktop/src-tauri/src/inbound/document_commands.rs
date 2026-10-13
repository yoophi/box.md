use crate::{
    application::document_workspace::DocumentWorkspace,
    domain::document::{DocumentError, DocumentSnapshot},
};

#[tauri::command]
pub fn open_document(
    path: String,
    service: tauri::State<'_, DocumentWorkspace>,
) -> Result<DocumentSnapshot, DocumentError> {
    service.read(&path)
}
#[tauri::command]
pub fn document_revision(
    path: String,
    service: tauri::State<'_, DocumentWorkspace>,
) -> Result<Option<String>, DocumentError> {
    service.revision(&path)
}
#[tauri::command]
pub fn save_document(
    path: String,
    content: String,
    expected_revision: Option<String>,
    service: tauri::State<'_, DocumentWorkspace>,
) -> Result<DocumentSnapshot, DocumentError> {
    service.save(&path, &content, expected_revision.as_deref())
}

#[tauri::command]
pub fn document_history(
    path: String,
    service: tauri::State<'_, DocumentWorkspace>,
) -> Result<Vec<crate::domain::history::HistoryEntry>, DocumentError> {
    service.history(&path)
}
#[tauri::command]
pub fn history_content(
    path: String,
    id: String,
    service: tauri::State<'_, DocumentWorkspace>,
) -> Result<String, DocumentError> {
    service.history_content(&path, &id)
}
