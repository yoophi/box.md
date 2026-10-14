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
    use crate::domain::document_change::{ChangedDocument, DocumentChangeKind};
    use std::sync::{Arc, Mutex};
    use tauri::{Listener, Manager};

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

    #[test]
    fn emitted_change_reaches_main_and_not_another_webview() {
        let app = tauri::test::mock_builder()
            .build(crate::app_context())
            .unwrap();
        let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let child = tauri::WebviewWindowBuilder::new(&app, "site-browser", Default::default())
            .build()
            .unwrap();
        let main_payloads = Arc::new(Mutex::new(Vec::new()));
        let child_payloads = Arc::new(Mutex::new(Vec::new()));
        let received = main_payloads.clone();
        app.get_webview(main.label())
            .unwrap()
            .listen(DOCUMENT_CHANGE_EVENT, move |event| {
                received.lock().unwrap().push(event.payload().to_owned());
            });
        let received = child_payloads.clone();
        app.get_webview(child.label())
            .unwrap()
            .listen(DOCUMENT_CHANGE_EVENT, move |event| {
                received.lock().unwrap().push(event.payload().to_owned());
            });

        emit(
            app.handle(),
            DocumentChange {
                generation: "generation-1".into(),
                kind: DocumentChangeKind::DocumentChanged,
                document: Some(ChangedDocument {
                    path: "notes/a.md".into(),
                    revision: "revision-2".into(),
                }),
            },
        );

        let payloads = main_payloads.lock().unwrap();
        assert_eq!(payloads.len(), 1);
        let payload: serde_json::Value = serde_json::from_str(&payloads[0]).unwrap();
        assert_eq!(payload["generation"], "generation-1");
        assert_eq!(payload["kind"], "documentChanged");
        assert_eq!(payload["document"]["path"], "notes/a.md");
        assert!(child_payloads.lock().unwrap().is_empty());
        assert!(app.get_webview_window("main").is_some());
    }
}
