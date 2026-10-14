use crate::{
    application::site_browser_service::SiteBrowserService,
    domain::site_browser::{
        BrowserError, SiteAction, SiteBounds, SiteBrowserSnapshot, SiteSelection,
    },
    infrastructure::workbench_shell::trusted_origin,
};
use std::sync::Arc;

fn trusted(view: &tauri::Webview) -> Result<(), BrowserError> {
    trusted_context(
        view.label(),
        &view
            .url()
            .map_err(|cause| BrowserError::new("permission", cause.to_string()))?,
    )
}

fn trusted_context(label: &str, url: &url::Url) -> Result<(), BrowserError> {
    if label != "main" {
        return Err(BrowserError::new(
            "permission",
            "앱 화면에서 브라우저를 조작해주세요.",
        ));
    }
    trusted_origin(url)
        .map(|_| ())
        .map_err(|_| BrowserError::new("permission", "앱 화면에서 브라우저를 조작해주세요."))
}
async fn execute<T: Send + 'static>(
    view: tauri::Webview,
    operation: impl FnOnce() -> Result<T, BrowserError> + Send + 'static,
) -> Result<T, BrowserError> {
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

#[tauri::command]
pub async fn site_browser_selection(
    webview: tauri::Webview,
    service: tauri::State<'_, Arc<SiteBrowserService>>,
) -> Result<SiteSelection, BrowserError> {
    let service = service.inner().clone();
    execute(webview, move || service.selection()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_command_requires_the_trusted_main_view() {
        for origin in ["tauri://localhost/", "http://localhost:1430/"] {
            trusted_context("main", &origin.parse().unwrap()).unwrap();
        }
        assert_eq!(
            trusted_context("main", &"https://example.com/".parse().unwrap())
                .unwrap_err()
                .code,
            "permission"
        );
        for origin in [
            "https://example.com/",
            "tauri://localhost/",
            "http://localhost:1430/",
        ] {
            assert_eq!(
                trusted_context("site-browser", &origin.parse().unwrap())
                    .unwrap_err()
                    .code,
                "permission"
            );
        }
    }

    #[test]
    fn capability_manifest_grants_selection_only_to_main() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
        assert_eq!(capability["webviews"], serde_json::json!(["main"]));
        assert!(capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|permission| permission == "allow-site-browser-selection"));
    }
}
