use crate::{
    application::document_service::DocumentService,
    domain::document::{DocumentError, DocumentSnapshot},
};

#[tauri::command]
pub fn open_document(
    path: String,
    service: tauri::State<'_, DocumentService>,
) -> Result<DocumentSnapshot, DocumentError> {
    service.read(&path)
}
#[tauri::command]
pub fn document_revision(
    path: String,
    service: tauri::State<'_, DocumentService>,
) -> Result<Option<String>, DocumentError> {
    service.revision(&path)
}
#[tauri::command]
pub fn save_document(
    path: String,
    content: String,
    expected_revision: Option<String>,
    service: tauri::State<'_, DocumentService>,
) -> Result<DocumentSnapshot, DocumentError> {
    service.save(&path, &content, expected_revision.as_deref())
}
