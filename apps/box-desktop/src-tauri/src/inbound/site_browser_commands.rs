use crate::{
    application::site_browser_service::SiteBrowserService,
    domain::site_browser::{BrowserError, SiteAction, SiteBounds, SiteBrowserSnapshot},
    infrastructure::workbench_shell::trusted_origin,
};
use std::sync::Arc;

fn trusted(view: &tauri::Webview) -> Result<(), BrowserError> {
    if view.label() != "main" {
        return Err(BrowserError::new(
            "permission",
            "앱 화면에서 브라우저를 조작해주세요.",
        ));
    }
    trusted_origin(
        &view
            .url()
            .map_err(|cause| BrowserError::new("permission", cause.to_string()))?,
    )
    .map(|_| ())
    .map_err(|_| BrowserError::new("permission", "앱 화면에서 브라우저를 조작해주세요."))
}
async fn execute(
    view: tauri::Webview,
    operation: impl FnOnce() -> Result<SiteBrowserSnapshot, BrowserError> + Send + 'static,
) -> Result<SiteBrowserSnapshot, BrowserError> {
    trusted(&view)?;
    let result = tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|cause| BrowserError::new("browser", cause.to_string()))??;
    trusted(&view)?;
    Ok(result)
}
#[tauri::command]
pub async fn site_browser_open(
    url: String,
    bounds: SiteBounds,
    webview: tauri::Webview,
    service: tauri::State<'_, Arc<SiteBrowserService>>,
) -> Result<SiteBrowserSnapshot, BrowserError> {
    let service = service.inner().clone();
    execute(webview, move || service.open(&url, bounds)).await
}
#[tauri::command]
pub async fn site_browser_layout(
    bounds: Option<SiteBounds>,
    webview: tauri::Webview,
    service: tauri::State<'_, Arc<SiteBrowserService>>,
) -> Result<SiteBrowserSnapshot, BrowserError> {
    let service = service.inner().clone();
    execute(webview, move || service.layout(bounds)).await
}
#[tauri::command]
pub async fn site_browser_action(
    action: SiteAction,
    webview: tauri::Webview,
    service: tauri::State<'_, Arc<SiteBrowserService>>,
) -> Result<SiteBrowserSnapshot, BrowserError> {
    let service = service.inner().clone();
    execute(webview, move || service.action(action)).await
}
#[tauri::command]
pub async fn site_browser_snapshot(
    webview: tauri::Webview,
    service: tauri::State<'_, Arc<SiteBrowserService>>,
) -> Result<SiteBrowserSnapshot, BrowserError> {
    let service = service.inner().clone();
    execute(webview, move || service.snapshot()).await
}
