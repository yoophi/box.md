use crate::domain::document_change::DocumentChange;
use tauri::Emitter;

pub const DOCUMENT_CHANGE_EVENT: &str = "box:document-change";

pub fn target() -> tauri::EventTarget {
    tauri::EventTarget::webview("main")
}

pub fn emit<R: tauri::Runtime>(app: &tauri::AppHandle<R>, change: DocumentChange) {
    let _ = app.emit_to(target(), DOCUMENT_CHANGE_EVENT, change);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_changes_target_only_the_main_webview() {
        assert_eq!(
            target(),
            tauri::EventTarget::Webview {
                label: "main".into()
            }
        );
        assert_eq!(DOCUMENT_CHANGE_EVENT, "box:document-change");
    }
}
