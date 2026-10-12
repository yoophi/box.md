use crate::{
    application::comment_service::CommentService,
    domain::{comment::DocumentComment, document::DocumentError},
};
#[tauri::command]
pub fn list_document_comments(
    key: String,
    service: tauri::State<'_, CommentService>,
) -> Result<Vec<DocumentComment>, DocumentError> {
    service.list(&key)
}
#[tauri::command]
pub fn add_document_comment(
    key: String,
    body: String,
    service: tauri::State<'_, CommentService>,
) -> Result<DocumentComment, DocumentError> {
    service.append(&key, &body)
}
