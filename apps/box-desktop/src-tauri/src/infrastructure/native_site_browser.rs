use crate::{
    domain::site_browser::{
        BrowserError, SiteAction, SiteAddress, SiteBounds, SiteBrowserSnapshot,
    },
    ports::site_browser_host::SiteBrowserHost,
};
use std::sync::{Arc, Mutex};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    Manager,
};

const LABEL: &str = "site-browser";
fn error(cause: impl std::fmt::Display) -> BrowserError {
    BrowserError::new("browser", cause.to_string())
}

pub struct NativeSiteBrowser {
    app: tauri::AppHandle,
    state: Arc<Mutex<SiteBrowserSnapshot>>,
    operations: Mutex<()>,
}
impl NativeSiteBrowser {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            app,
            state: Arc::new(Mutex::new(SiteBrowserSnapshot::default())),
            operations: Mutex::new(()),
        }
    }
    fn current(&self) -> Result<SiteBrowserSnapshot, BrowserError> {
        let mut snapshot = self.state.lock().map_err(error)?.clone();
        if let Some(view) = self.app.get_webview(LABEL) {
            let (back, forward) = history(&view, None)?;
            snapshot.can_go_back = back;
            snapshot.can_go_forward = forward;
        }
        Ok(snapshot)
    }
    fn bounds(&self, bounds: SiteBounds) -> Result<tauri::Rect, BrowserError> {
        bounds.validate()?;
        let window = self
            .app
            .get_window("main")
            .ok_or_else(|| error("앱 창을 찾지 못했습니다."))?;
        let size = window
            .inner_size()
            .map_err(error)?
            .to_logical::<f64>(window.scale_factor().map_err(error)?);
        // CSS viewport fractions also account for page zoom and high-DPI display scaling.
        let horizontal = size.width / bounds.viewport_width;
        let vertical = size.height / bounds.viewport_height;
        Ok(tauri::Rect {
            position: tauri::LogicalPosition::new(bounds.x * horizontal, bounds.y * vertical)
                .into(),
            size: tauri::LogicalSize::new(bounds.width * horizontal, bounds.height * vertical)
                .into(),
        })
    }
    fn builder(&self, address: &SiteAddress) -> WebviewBuilder<tauri::Wry> {
        let navigation = self.state.clone();
        let loaded = self.state.clone();
        let title = self.state.clone();
        let app = self.app.clone();
        WebviewBuilder::new(LABEL, tauri::WebviewUrl::External(address.url().clone()))
            .on_navigation(move |url| {
                if !SiteAddress::allowed(url) {
                    return false;
                }
                if let Ok(mut state) = navigation.lock() {
                    state.navigation(url);
                }
                true
            })
            .on_page_load(move |_, payload| {
                if matches!(payload.event(), PageLoadEvent::Finished) {
                    if let Ok(mut state) = loaded.lock() {
                        state.finished(payload.url());
                    }
                }
            })
            .on_document_title_changed(move |_, value| {
                if let Ok(mut state) = title.lock() {
                    state.title = value.chars().take(512).collect();
                }
            })
            .on_new_window(move |url, _| {
                // target=_blank remains in the owned browser, without creating a privileged app window.
                if SiteAddress::allowed(&url) {
                    if let Some(view) = app.get_webview(LABEL) {
                        let _ = view.navigate(url);
                    }
                }
                NewWindowResponse::Deny
            })
    }
}
impl SiteBrowserHost for NativeSiteBrowser {
    fn open(
        &self,
        address: SiteAddress,
        bounds: SiteBounds,
    ) -> Result<SiteBrowserSnapshot, BrowserError> {
        let _operation = self.operations.lock().map_err(error)?;
        let bounds = self.bounds(bounds)?;
        let previous = self.state.lock().map_err(error)?.clone();
        self.state.lock().map_err(error)?.navigation(address.url());
        let result: Result<(), BrowserError> = (|| {
            let view = if let Some(view) = self.app.get_webview(LABEL) {
                view.set_bounds(bounds).map_err(error)?;
                view.navigate(address.url().clone()).map_err(error)?;
                view
            } else {
                let window = self
                    .app
                    .get_window("main")
                    .ok_or_else(|| error("앱 창을 찾지 못했습니다."))?;
                window
                    .add_child(self.builder(&address), bounds.position, bounds.size)
                    .map_err(error)?
            };
            view.show().map_err(error)?;
            let mut state = self.state.lock().map_err(error)?;
            state.open = true;
            state.visible = true;
            Ok(())
        })();
        if let Err(cause) = result {
            *self.state.lock().map_err(error)? = previous;
            return Err(cause);
        }
        self.current()
    }
    fn layout(&self, bounds: Option<SiteBounds>) -> Result<SiteBrowserSnapshot, BrowserError> {
        let _operation = self.operations.lock().map_err(error)?;
        let bounds = bounds.map(|bounds| self.bounds(bounds)).transpose()?;
        if let Some(view) = self.app.get_webview(LABEL) {
            if let Some(bounds) = bounds {
                view.set_bounds(bounds).map_err(error)?;
                view.show().map_err(error)?;
            } else {
                view.hide().map_err(error)?;
            }
            self.state.lock().map_err(error)?.visible = bounds.is_some();
        }
        self.current()
    }
    fn action(&self, action: SiteAction) -> Result<SiteBrowserSnapshot, BrowserError> {
        let _operation = self.operations.lock().map_err(error)?;
        let view = self
            .app
            .get_webview(LABEL)
            .ok_or_else(|| error("먼저 사이트 주소를 열어주세요."))?;
        if matches!(action, SiteAction::Reload) {
            view.reload().map_err(error)?;
        } else {
            history(&view, Some(action))?;
        }
        self.current()
    }
    fn snapshot(&self) -> Result<SiteBrowserSnapshot, BrowserError> {
        let _operation = self.operations.lock().map_err(error)?;
        self.current()
    }
}

type HistoryAvailability = (Option<bool>, Option<bool>);
#[cfg(target_os = "macos")]
fn history(
    view: &tauri::Webview,
    action: Option<SiteAction>,
) -> Result<HistoryAvailability, BrowserError> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    view.with_webview(move |platform| {
        // Tauri owns the live WKWebView pointer and runs this closure on its native UI thread.
        let result = unsafe {
            (platform.inner() as *const objc2_web_kit::WKWebView)
                .as_ref()
                .map(|native| {
                    match action {
                        Some(SiteAction::Back) => {
                            let _ = native.goBack();
                        }
                        Some(SiteAction::Forward) => {
                            let _ = native.goForward();
                        }
                        _ => (),
                    }
                    (Some(native.canGoBack()), Some(native.canGoForward()))
                })
                .ok_or_else(|| error("브라우저 탐색 기록을 확인하지 못했습니다."))
        };
        let _ = send.send(result);
    })
    .map_err(error)?;
    receive
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(error)?
}
#[cfg(not(target_os = "macos"))]
fn history(
    view: &tauri::Webview,
    action: Option<SiteAction>,
) -> Result<HistoryAvailability, BrowserError> {
    // Tauri exposes reload/navigation, but no portable back/forward API in 2.12.3.
    // macOS uses WKWebView's native history above; other targets use the page's engine history.
    match action {
        Some(SiteAction::Back) => view.eval("window.history.back()"),
        Some(SiteAction::Forward) => view.eval("window.history.forward()"),
        _ => Ok(()),
    }
    .map_err(error)?;
    Ok((None, None))
}
