use super::*;
use crate::{
    application::document_workspace::DocumentWorkspace,
    infrastructure::{
        document_scope_factory::FsDocumentScopeFactory,
        fs_document_repository::FsDocumentRepository, git_document_history::GitDocumentHistory,
    },
};
use std::{
    fs,
    path::Path,
    sync::{Arc, Barrier},
    thread,
};

fn workspace(root: &Path, history: &Path) -> DocumentWorkspace {
    let workspace = DocumentWorkspace::new(
        DocumentService::new(
            FsDocumentRepository,
            GitDocumentHistory::new(history.into()),
        ),
        FsDocumentScopeFactory::new(history.into()),
    );
    workspace.select(root.to_str().unwrap(), false).unwrap();
    workspace
}
fn path(path: &str) -> DocumentRef {
    DocumentRef::Path { path: path.into() }
}
fn id(permalink: &str) -> DocumentRef {
    DocumentRef::Permalink {
        permalink: permalink.into(),
    }
}
fn patch(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

#[test]
fn references_missing_ids_create_unicode_and_resolve_after_move() {
    for invalid in [
        "{}",
        r#"{"path":"a.md","permalink":"a"}"#,
        r#"{"path":"a.md","root":"/outside"}"#,
    ] {
        assert!(serde_json::from_str::<DocumentRef>(invalid).is_err());
    }
    let root = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("중첩")).unwrap();
    fs::write(root.path().join("legacy.md"), "legacy body").unwrap();
    let manager = workspace(root.path(), history.path());
    let scope = manager.scope().unwrap();
    assert_eq!(
        scope
            .restore_document(&uuid::Uuid::new_v4().to_string())
            .unwrap_err()
            .code,
        "notFound"
    );
    assert!(!root.path().join(".box.md").exists());
    assert_eq!(
        scope
            .document_permalink(&path("legacy.md"))
            .unwrap_err()
            .code,
        "missingPermalink"
    );
    assert_eq!(
        scope.read_document(&id("")).unwrap_err().code,
        "missingPermalink"
    );
    assert_eq!(
        scope.read_document(&id("absent")).unwrap_err().code,
        "notFound"
    );
    let created = scope
        .create_document("중첩/노트.md", "\u{feff}# 한글 본문\r\n")
        .unwrap();
    let permalink = created.permalink.unwrap();
    uuid::Uuid::parse_str(&permalink).unwrap();
    assert!(created.document.content.starts_with('\u{feff}'));
    assert!(created.document.content.ends_with("# 한글 본문\r\n"));
    fs::rename(
        root.path().join("중첩/노트.md"),
        root.path().join("renamed.md"),
    )
    .unwrap();
    assert_eq!(
        scope.read_document(&id(&permalink)).unwrap().document.path,
        "renamed.md"
    );
    assert_eq!(
        scope.read_document(&path("중첩/노트.md")).unwrap_err().code,
        "notFound"
    );
    let page = scope.list_documents(None, None).unwrap();
    assert_eq!(page.documents.len(), 2);
    assert!(!serde_json::to_string(&page)
        .unwrap()
        .contains(root.path().to_str().unwrap()));
}

#[test]
fn metadata_patches_preserve_body_comments_unknown_values_and_history() {
    let root = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    let original = "\u{feff}---\r\n# KEEP HEADER\r\npermalink: note\r\nsummary: old # KEEP SUMMARY\r\nunknown: {keep: [one, two]} # KEEP UNKNOWN\r\n---\r\n# 본문\r\n\r\n본문 byte를 보존\r\n";
    fs::write(root.path().join("note.md"), original).unwrap();
    let manager = workspace(root.path(), history.path());
    let scope = manager.scope().unwrap();
    let current = scope.read("note.md").unwrap();
    let (saved, meta) = scope
        .update_metadata(
            &id("note"),
            &patch(serde_json::json!({"summary":"새 요약","new":{"list":[true,3,null]}})),
            &[],
            &current.revision,
        )
        .unwrap();
    assert!(saved.document.content.contains("# KEEP HEADER\r\n"));
    assert!(saved.document.content.contains("# KEEP SUMMARY"));
    assert!(saved
        .document
        .content
        .contains("unknown: {keep: [one, two]} # KEEP UNKNOWN\r\n"));
    assert!(saved
        .document
        .content
        .ends_with("# 본문\r\n\r\n본문 byte를 보존\r\n"));
    assert_eq!(meta.summary.as_deref(), Some("새 요약"));
    assert_eq!(
        meta.metadata["new"]["list"],
        serde_json::json!([true, 3, null])
    );
    let before = fs::read(root.path().join("note.md")).unwrap();
    for (values, remove) in [
        (serde_json::json!({"permalink":7}), vec![]),
        (serde_json::json!({"summary":"x"}), vec!["summary".into()]),
    ] {
        assert_eq!(
            scope
                .update_metadata(
                    &id("note"),
                    &patch(values),
                    &remove,
                    &saved.document.revision
                )
                .unwrap_err()
                .code,
            "invalidMetadata"
        );
        assert_eq!(fs::read(root.path().join("note.md")).unwrap(), before);
    }
    let (removed, meta) = scope
        .update_metadata(
            &id("note"),
            &Map::new(),
            &["summary".into()],
            &saved.document.revision,
        )
        .unwrap();
    assert!(meta.summary.is_none());
    assert_eq!(
        scope.get_metadata(&id("note")).unwrap().revision,
        removed.document.revision
    );
    let native = root.path().join("note.md").to_string_lossy().into_owned();
    let versions = manager.history(&native).unwrap();
    assert_eq!(versions.len(), 3);
    assert_eq!(
        manager.history_content(&native, &versions[2].id).unwrap(),
        original
    );
}

#[test]
fn duplicate_permalink_is_rejected_for_scoped_and_native_writes_without_clobber() {
    let root = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    let manager = workspace(root.path(), history.path());
    let scope = manager.scope().unwrap();
    let a = scope
        .create_document("a.md", "---\npermalink: same\n---\na")
        .unwrap();
    assert_eq!(
        scope
            .create_document("b.md", &a.document.content)
            .unwrap_err()
            .code,
        "duplicatePermalink"
    );
    assert!(!root.path().join("b.md").exists());
    assert_eq!(
        scope
            .create_document("a.md", "no clobber")
            .unwrap_err()
            .code,
        "conflict"
    );
    let b = scope
        .create_document("b.md", "---\npermalink: other\n---\nb")
        .unwrap();
    let native = root.path().join("b.md").to_string_lossy().into_owned();
    assert_eq!(
        manager
            .save(&native, &a.document.content, Some(&b.document.revision))
            .unwrap_err()
            .code,
        "duplicatePermalink"
    );
    assert_eq!(scope.read("b.md").unwrap().content, b.document.content);
    fs::write(root.path().join("duplicate.md"), &a.document.content).unwrap();
    assert_eq!(
        scope.read_document(&id("same")).unwrap_err().code,
        "duplicatePermalink"
    );
    // An explicit path can repair an externally introduced duplicate.
    scope
        .update_document(
            &path("duplicate.md"),
            "---\npermalink: repaired\n---\nfixed",
            &a.document.revision,
        )
        .unwrap();
    assert_eq!(
        scope.read_document(&id("same")).unwrap().document.path,
        "a.md"
    );
}

#[test]
fn metadata_and_native_cas_share_one_lock_and_only_record_the_winner() {
    let root = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    let manager = Arc::new(workspace(root.path(), history.path()));
    let scope = manager.scope().unwrap();
    let original = scope
        .create_document("note.md", "---\npermalink: note\n---\noriginal")
        .unwrap()
        .document;
    let barrier = Arc::new(Barrier::new(3));
    let a = {
        let manager = manager.clone();
        let barrier = barrier.clone();
        let revision = original.revision.clone();
        let file = root.path().join("note.md").to_string_lossy().into_owned();
        thread::spawn(move || {
            barrier.wait();
            manager.save(&file, "---\npermalink: note\n---\nnative", Some(&revision))
        })
    };
    let b = {
        let scope = scope.clone();
        let barrier = barrier.clone();
        let revision = original.revision.clone();
        thread::spawn(move || {
            barrier.wait();
            scope
                .update_metadata(
                    &id("note"),
                    &patch(serde_json::json!({"summary":"agent"})),
                    &[],
                    &revision,
                )
                .map(|(doc, _)| doc.document)
        })
    };
    barrier.wait();
    let results = [a.join().unwrap(), b.join().unwrap()];
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| r.as_ref().is_err_and(|e| e.code == "conflict"))
            .count(),
        1
    );
    assert_eq!(
        scope
            .update_document(&id("note"), "stale", &original.revision)
            .unwrap_err()
            .code,
        "conflict"
    );
    assert_eq!(
        manager
            .history(root.path().join("note.md").to_str().unwrap())
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn trash_restore_checks_duplicates_and_no_clobber_before_publication() {
    let root = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    let manager = workspace(root.path(), history.path());
    let scope = manager.scope().unwrap();
    let original = scope
        .create_document("note.md", "---\npermalink: retained\n---\noriginal")
        .unwrap()
        .document;
    assert_eq!(
        scope
            .delete_document(&path("note.md"), "stale")
            .unwrap_err()
            .code,
        "conflict"
    );
    let deleted = scope
        .delete_document(&id("retained"), &original.revision)
        .unwrap();
    assert!(!root.path().join("note.md").exists());
    assert!(scope
        .list_documents(None, None)
        .unwrap()
        .documents
        .is_empty());
    fs::write(root.path().join("note.md"), "replacement").unwrap();
    assert_eq!(
        scope.restore_document(&deleted.trash_id).unwrap_err().code,
        "conflict"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("note.md")).unwrap(),
        "replacement"
    );
    fs::remove_file(root.path().join("note.md")).unwrap();
    let other = scope
        .create_document("other.md", &original.content)
        .unwrap()
        .document;
    assert_eq!(
        scope.restore_document(&deleted.trash_id).unwrap_err().code,
        "duplicatePermalink"
    );
    assert!(!root.path().join("note.md").exists());
    scope
        .delete_document(&path("other.md"), &other.revision)
        .unwrap();
    let restored = scope.restore_document(&deleted.trash_id).unwrap();
    assert_eq!(restored.document.content, original.content);
    assert_eq!(restored.document.revision, original.revision);
    assert_eq!(
        scope.restore_document(&deleted.trash_id).unwrap_err().code,
        "notFound"
    );
    assert_eq!(
        manager
            .history(root.path().join("note.md").to_str().unwrap())
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn search_pages_are_bounded_and_cursors_expire_on_content_query_or_scope_change() {
    let root = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    fs::write(root.path().join("a.md"), "---\npermalink: a\nsummary: Alpha summary\nsecret: header-only-token\n---\nİSTANBUL alpha 본문").unwrap();
    fs::write(
        root.path().join("b.md"),
        "---\npermalink: b\n---\nALPHA body",
    )
    .unwrap();
    let manager = workspace(root.path(), history.path());
    let scope = manager.scope().unwrap();
    fs::write(
        root.path().join("c.md"),
        format!("{} ALPHA {}", "앞".repeat(1000), "뒤".repeat(1000)),
    )
    .unwrap();
    let first = scope.search_documents("ALPHA", None, Some(1)).unwrap();
    assert!(scope
        .search_documents("alpha", None, None)
        .unwrap()
        .matches
        .iter()
        .flat_map(|m| &m.excerpts)
        .all(|e| e.chars().count() <= 240));
    assert_eq!(first.matches.len(), 1);
    let cursor = first.next_cursor.unwrap();
    assert_eq!(
        scope
            .search_documents("alpha", Some(&cursor), Some(1))
            .unwrap()
            .matches[0]
            .document
            .path,
        "b.md"
    );
    assert_eq!(
        scope
            .search_documents("header-only-token", None, None)
            .unwrap()
            .matches
            .len(),
        0
    );
    assert!(scope
        .search_documents("İSTANBUL", None, None)
        .unwrap()
        .matches[0]
        .excerpts[0]
        .contains("İSTANBUL"));
    assert_eq!(
        scope
            .search_documents("different", Some(&cursor), None)
            .unwrap_err()
            .code,
        "staleCursor"
    );
    assert_eq!(
        scope.list_documents(Some(&cursor), None).unwrap_err().code,
        "staleCursor"
    );
    assert_eq!(
        scope.list_documents(None, Some(0)).unwrap_err().code,
        "invalidArguments"
    );
    assert_eq!(
        scope.search_documents(" ", None, None).unwrap_err().code,
        "invalidArguments"
    );
    let list_cursor = scope
        .list_documents(None, Some(1))
        .unwrap()
        .next_cursor
        .unwrap();
    manager.select(root.path().to_str().unwrap(), true).unwrap();
    let fresh = manager.scope().unwrap();
    assert_eq!(
        scope.list_documents(None, None).unwrap_err().code,
        "scopeRevoked"
    );
    assert_eq!(
        fresh
            .list_documents(Some(&list_cursor), None)
            .unwrap_err()
            .code,
        "staleCursor"
    );
    fs::write(root.path().join("b.md"), "changed alpha").unwrap();
    assert_eq!(
        fresh
            .search_documents("alpha", Some(&cursor), None)
            .unwrap_err()
            .code,
        "staleCursor"
    );
}

#[test]
fn incomplete_metadata_and_io_are_visible_and_never_prove_unique_identity() {
    let root = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    fs::write(
        root.path().join("bad.md"),
        "---\npermalink: [invalid]\n---\nbody",
    )
    .unwrap();
    fs::write(root.path().join("invalid-utf8.md"), [0xff]).unwrap();
    let manager = workspace(root.path(), history.path());
    let scope = manager.scope().unwrap();
    let page = scope.list_documents(None, None).unwrap();
    assert_eq!(page.warnings.len(), 2);
    assert!(page
        .warnings
        .iter()
        .all(|w| w.path.as_ref().is_some_and(|p| !p.starts_with('/'))));
    assert_eq!(
        scope.create_document("new.md", "body").unwrap_err().code,
        "workspaceUnavailable"
    );
    assert!(!root.path().join("new.md").exists());
    assert_eq!(
        scope.read_document(&id("unknown")).unwrap_err().code,
        "workspaceUnavailable"
    );
    assert_eq!(
        fs::read(root.path().join("invalid-utf8.md")).unwrap(),
        [0xff]
    );
    fs::remove_file(root.path().join("invalid-utf8.md")).unwrap();
    let previous = scope.read("bad.md").unwrap();
    scope
        .update_document(
            &path("bad.md"),
            "---\npermalink: repaired\n---\nbody",
            &previous.revision,
        )
        .unwrap();
    assert_eq!(
        scope.read_document(&id("repaired")).unwrap().document.path,
        "bad.md"
    );
}

#[test]
fn application_paths_and_metadata_errors_preserve_outside_and_unknown_source() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("outside.md"), "outside original").unwrap();
    let manager = workspace(root.path(), history.path());
    let scope = manager.scope().unwrap();
    for invalid in [
        "../outside.md".to_string(),
        ".box.md/x.md".into(),
        outside
            .path()
            .join("outside.md")
            .to_string_lossy()
            .into_owned(),
    ] {
        let error = scope.create_document(&invalid, "body").unwrap_err();
        assert_eq!(error.code, "invalidPath");
        assert!(!error.message.contains(outside.path().to_str().unwrap()));
    }
    let raw = "---\npermalink: tagged\nunknown: !custom value\n---\nbody";
    fs::write(root.path().join("tagged.md"), raw).unwrap();
    assert_eq!(
        scope.get_metadata(&id("tagged")).unwrap_err().code,
        "invalidMetadata"
    );
    let current = scope.read("tagged.md").unwrap();
    assert_eq!(
        scope
            .update_metadata(
                &id("tagged"),
                &patch(serde_json::json!({"summary":"x"})),
                &[],
                &current.revision
            )
            .unwrap_err()
            .code,
        "invalidMetadata"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("tagged.md")).unwrap(),
        raw
    );
    assert_eq!(
        fs::read_to_string(outside.path().join("outside.md")).unwrap(),
        "outside original"
    );
}

#[test]
fn aggregate_scan_limit_reports_partial_results_and_blocks_identity_mutations() {
    let root = tempfile::tempdir().unwrap();
    let history = tempfile::tempdir().unwrap();
    let bytes = vec![b'x'; 8 * 1024 * 1024];
    for i in 0..9 {
        fs::write(root.path().join(format!("{i}.md")), &bytes).unwrap();
    }
    let manager = workspace(root.path(), history.path());
    let scope = manager.scope().unwrap();
    let page = scope.list_documents(None, Some(100)).unwrap();
    assert!(page.truncated);
    assert_eq!(page.documents.len(), 8);
    assert_eq!(page.warnings[0].code, "scanLimit");
    assert_eq!(
        scope
            .create_document("new.md", "small body")
            .unwrap_err()
            .code,
        "workspaceUnavailable"
    );
    assert!(!root.path().join("new.md").exists());
}
