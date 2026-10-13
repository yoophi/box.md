use crate::{
    application::document_mutations::DocumentMutation,
    application::document_workspace::DocumentWorkspace,
    domain::document::{DocumentError, DocumentSnapshot},
};

async fn created_result(
    scope: std::sync::Arc<crate::application::document_workspace::DocumentScope>,
    ticket: crate::application::document_mutations::MutationTicket,
) -> Result<serde_json::Value, DocumentError> {
    tauri::async_runtime::spawn_blocking(move || scope.native_created_result(ticket))
        .await
        .map_err(|_| DocumentError::new("internal", "문서 생성 응답을 확인하지 못했습니다."))?
}

#[tauri::command]
pub async fn create_document(
    generation: String,
    request_id: String,
    content: String,
    service: tauri::State<'_, DocumentWorkspace>,
) -> Result<serde_json::Value, DocumentError> {
    let (scope, ticket) = service.submit_creation(
        &generation,
        &request_id,
        DocumentMutation::CreateDocument { content },
    )?;
    created_result(scope, ticket).await
}

#[tauri::command]
pub async fn duplicate_document(
    generation: String,
    request_id: String,
    document: crate::domain::scoped_document::DocumentRef,
    expected_revision: String,
    content: Option<String>,
    service: tauri::State<'_, DocumentWorkspace>,
) -> Result<serde_json::Value, DocumentError> {
    let (scope, ticket) = service.submit_creation(
        &generation,
        &request_id,
        DocumentMutation::DuplicateDocument {
            document,
            expected_revision,
            content,
        },
    )?;
    created_result(scope, ticket).await
}

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
