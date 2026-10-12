use crate::{
    application::connection_service::ConnectionService,
    domain::{connection::ConnectionSnapshot, document::DocumentError},
    infrastructure::workbench_shell::trusted_origin,
};
use std::sync::Arc;

fn trusted(webview: &tauri::Webview) -> Result<(), DocumentError> {
    if webview.label() != "main" {
        return Err(DocumentError::new(
            "permission",
            "이 화면에서 연결 데이터를 요청할 수 없습니다.",
        ));
    }
    trusted_origin(
        &webview
            .url()
            .map_err(|e| DocumentError::new("permission", e.to_string()))?,
    )
    .map(|_| ())
    .map_err(|_| {
        DocumentError::new(
            "permission",
            "이 페이지에서 연결 데이터를 요청할 수 없습니다.",
        )
    })
}
async fn execute(
    webview: tauri::Webview,
    operation: impl FnOnce() -> Result<ConnectionSnapshot, DocumentError> + Send + 'static,
) -> Result<ConnectionSnapshot, DocumentError> {
    trusted(&webview)?;
    let result = tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|e| DocumentError::new("connectionStore", e.to_string()))??;
    trusted(&webview)?;
    Ok(result)
}
#[tauri::command]
pub async fn list_connections(
    webview: tauri::Webview,
    service: tauri::State<'_, Arc<ConnectionService>>,
) -> Result<ConnectionSnapshot, DocumentError> {
    let service = service.inner().clone();
    execute(webview, move || service.snapshot()).await
}
#[tauri::command]
pub async fn create_connection_entity(
    name: String,
    webview: tauri::Webview,
    service: tauri::State<'_, Arc<ConnectionService>>,
) -> Result<ConnectionSnapshot, DocumentError> {
    let service = service.inner().clone();
    execute(webview, move || service.create(&name)).await
}
#[tauri::command]
pub async fn attach_document_connection(
    connection_id: String,
    permalink: String,
    webview: tauri::Webview,
    service: tauri::State<'_, Arc<ConnectionService>>,
) -> Result<ConnectionSnapshot, DocumentError> {
    let service = service.inner().clone();
    execute(webview, move || service.attach(&connection_id, &permalink)).await
}
#[tauri::command]
pub async fn detach_document_connection(
    connection_id: String,
    permalink: String,
    webview: tauri::Webview,
    service: tauri::State<'_, Arc<ConnectionService>>,
) -> Result<ConnectionSnapshot, DocumentError> {
    let service = service.inner().clone();
    execute(webview, move || service.detach(&connection_id, &permalink)).await
}
