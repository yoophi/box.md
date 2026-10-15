use crate::{
    domain::site_browser::{
        BrowserError, SiteAction, SiteAddress, SiteBounds, SiteBrowserSnapshot, SiteSelection,
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
        if let Some(view) = self.app.get_webview(LABEL) {
            let (back, forward, loading) = history(&view, None)?;
            let actual_url = view.url().map_err(error)?;
            let mut state = self.state.lock().map_err(error)?;
            state.open = true;
            state.can_go_back = back;
            state.can_go_forward = forward;
            if loading == Some(true) {
                state.loading = true;
            }
            if !state.loading && SiteAddress::allowed(&actual_url) {
                state.url = Some(actual_url.to_string());
            }
        } else {
            let mut state = self.state.lock().map_err(error)?;
            state.open = false;
            state.visible = false;
            state.loading = false;
        }
        Ok(self.state.lock().map_err(error)?.clone())
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
        let loaded = self.state.clone();
        let title = self.state.clone();
        let app = self.app.clone();
        WebviewBuilder::new(LABEL, tauri::WebviewUrl::External(address.url().clone()))
            .initialization_script(include_str!("site_selection.js"))
            // Policy hooks also see subframe navigation. They must not replace the address bar.
            .on_navigation(SiteAddress::allowed)
            .on_page_load(move |_, payload| {
                if let Ok(mut state) = loaded.lock() {
                    match payload.event() {
                        PageLoadEvent::Started => state.navigation(payload.url()),
                        PageLoadEvent::Finished => state.finished(payload.url()),
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
                view.hide().map_err(error)?;
                view.set_bounds(bounds).map_err(error)?;
                view.navigate(address.url().clone()).map_err(error)?;
                view
            } else {
                let window = self
                    .app
                    .get_window("main")
                    .ok_or_else(|| error("앱 창을 찾지 못했습니다."))?;
                let size = window.inner_size().map_err(error)?;
                // Prepare outside the client area; a late open cannot cover a document/modal.
                window
                    .add_child(
                        self.builder(&address),
                        tauri::PhysicalPosition::new(size.width as i32 + 1, size.height as i32 + 1),
                        bounds.size,
                    )
                    .map_err(error)?
            };
            view.hide().map_err(error)?;
            view.set_bounds(bounds).map_err(error)?;
            let mut state = self.state.lock().map_err(error)?;
            state.open = true;
            state.visible = false;
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
            self.state.lock().map_err(error)?.open = true;
        } else {
            let mut state = self.state.lock().map_err(error)?;
            state.open = false;
            state.visible = false;
            state.loading = false;
        }
        // Visibility acknowledgements do not wait on an unrelated history query.
        Ok(self.state.lock().map_err(error)?.clone())
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
    fn selection(&self) -> Result<SiteSelection, BrowserError> {
        let _operation = self.operations.lock().map_err(error)?;
        let view = self
            .app
            .get_webview(LABEL)
            .ok_or_else(|| error("먼저 사이트 주소를 열어주세요."))?;
        capture_selection(&view)
    }
}

#[cfg(target_os = "macos")]
const SELECTION_SCRIPT: &str = r#"(() => {
  const text = window.__boxReadSiteSelection?.() ?? window.getSelection()?.toString() ?? "";
  if (new TextEncoder().encode(text).length > 262144) {
    return JSON.stringify({ kind: "tooLarge" });
  }
  if (document.title.length > 512) {
    return JSON.stringify({ kind: "titleTooLong" });
  }
  return JSON.stringify({
    kind: "selection",
    url: window.location.href,
    title: document.title,
    text,
  });
})()"#;

#[cfg(target_os = "macos")]
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum SelectionResponse {
    Selection {
        url: String,
        title: String,
        text: String,
    },
    TooLarge,
    TitleTooLong,
}

#[cfg(target_os = "macos")]
fn parse_selection(value: &str) -> Result<SiteSelection, BrowserError> {
    match serde_json::from_str::<SelectionResponse>(value).map_err(|_| {
        BrowserError::new(
            "selectionScript",
            "사이트의 선택 영역을 확인하지 못했습니다. 다시 시도해주세요.",
        )
    })? {
        SelectionResponse::Selection { url, title, text } => SiteSelection::new(&url, &title, text),
        SelectionResponse::TooLarge => Err(BrowserError::new(
            "selectionTooLarge",
            "선택 영역이 너무 큽니다. 더 작은 영역을 선택해주세요.",
        )),
        SelectionResponse::TitleTooLong => Err(BrowserError::new(
            "selectionTitle",
            "사이트 제목이 너무 깁니다.",
        )),
    }
}

#[cfg(target_os = "macos")]
fn capture_selection(view: &tauri::Webview) -> Result<SiteSelection, BrowserError> {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSError, NSString};

    let (send, receive) = std::sync::mpsc::sync_channel(1);
    view.with_webview(move |platform| {
        let send_callback = send.clone();
        let result = unsafe {
            (platform.inner() as *const objc2_web_kit::WKWebView)
                .as_ref()
                .ok_or_else(|| {
                    BrowserError::new(
                        "browser",
                        "사이트 브라우저를 확인하지 못했습니다.",
                    )
                })
                .map(|native| {
                    let handler = RcBlock::new(
                        move |value: *mut AnyObject, script_error: *mut NSError| {
                            let result = if !script_error.is_null() || value.is_null() {
                                Err(BrowserError::new(
                                    "selectionScript",
                                    "사이트의 선택 영역을 확인하지 못했습니다. 다시 시도해주세요.",
                                ))
                            } else {
                                // WebKit returns the JSON string produced by SELECTION_SCRIPT.
                                (&*value)
                                    .downcast_ref::<NSString>()
                                    .map(|value| value.to_string())
                                    .ok_or_else(|| {
                                        BrowserError::new(
                                            "selectionScript",
                                            "사이트의 선택 영역을 확인하지 못했습니다. 다시 시도해주세요.",
                                        )
                                    })
                                    .and_then(|value| parse_selection(&value))
                            };
                            let _ = send_callback.send(result);
                        },
                    );
                    native.evaluateJavaScript_completionHandler(
                        &NSString::from_str(SELECTION_SCRIPT),
                        Some(&handler),
                    );
                })
        };
        if let Err(cause) = result {
            let _ = send.send(Err(cause));
        }
    })
    .map_err(error)?;
    receive_selection(receive, std::time::Duration::from_secs(5))
}

#[cfg(target_os = "macos")]
fn receive_selection(
    receive: std::sync::mpsc::Receiver<Result<SiteSelection, BrowserError>>,
    timeout: std::time::Duration,
) -> Result<SiteSelection, BrowserError> {
    receive.recv_timeout(timeout).map_err(|_| {
        BrowserError::new(
            "selectionTimeout",
            "선택 영역 확인이 지연되고 있습니다. 다시 시도해주세요.",
        )
    })?
}

#[cfg(not(target_os = "macos"))]
fn capture_selection(_: &tauri::Webview) -> Result<SiteSelection, BrowserError> {
    Err(BrowserError::new(
        "unsupported",
        "이 운영체제에서는 사이트 선택 영역 저장을 사용할 수 없습니다.",
    ))
}

type HistoryAvailability = (Option<bool>, Option<bool>, Option<bool>);
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
                    (
                        Some(native.canGoBack()),
                        Some(native.canGoForward()),
                        Some(native.isLoading()),
                    )
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
    Ok((None, None, None))
}

#[cfg(all(test, target_os = "macos"))]
mod selection_tests {
    use super::*;

    #[test]
    fn parses_atomic_page_selection_and_rejects_script_sentinels() {
        let selection = parse_selection(
            r#"{"kind":"selection","url":"https://example.com/new","title":"새 제목","text":"선택 🌱\n둘째 줄"}"#,
        )
        .unwrap();
        assert_eq!(selection.url, "https://example.com/new");
        assert_eq!(selection.title, "새 제목");
        assert_eq!(selection.text, "선택 🌱\n둘째 줄");
        assert_eq!(
            parse_selection(r#"{"kind":"tooLarge"}"#).unwrap_err().code,
            "selectionTooLarge"
        );
        assert_eq!(
            parse_selection(r#"{"kind":"unknown"}"#).unwrap_err().code,
            "selectionScript"
        );
    }

    #[test]
    fn reports_a_callback_timeout_without_page_data() {
        let (_send, receive) = std::sync::mpsc::sync_channel(1);
        assert_eq!(
            receive_selection(receive, std::time::Duration::ZERO)
                .unwrap_err()
                .code,
            "selectionTimeout"
        );
    }
}
