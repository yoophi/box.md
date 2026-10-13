use super::*;
use crate::application::document_mutations::{DocumentMutation, MutationRegistry};
use crate::infrastructure::{
    document_scope_factory::FsDocumentScopeFactory, fs_document_repository::FsDocumentRepository,
    git_document_history::GitDocumentHistory,
};
use crate::ports::document_history::DocumentHistory;
use serde_json::{json, Value};
use std::{
    fs,
    sync::{mpsc, Barrier},
    thread,
};

fn manager(history: &Path) -> DocumentWorkspace {
    DocumentWorkspace::new(
        DocumentService::new(
            FsDocumentRepository,
            GitDocumentHistory::new(history.into()),
        ),
        FsDocumentScopeFactory::new(history.into()),
    )
}
fn limited(root: &Path, history: &Path, count: usize, bytes: usize) -> DocumentScope {
    DocumentScope {
        generation: uuid::Uuid::new_v4().to_string(),
        storage: FsDocumentScopeFactory::new(history.into())
            .open(root.to_str().unwrap())
            .unwrap(),
        admission: ScopeAdmission::new(),
        mutations: MutationRegistry::with_limits(count, bytes),
    }
}
fn create(path: &str, content: &str) -> DocumentMutation {
    DocumentMutation::Create {
        path: path.into(),
        content: content.into(),
    }
}
fn update(content: &str, revision: &str) -> DocumentMutation {
    DocumentMutation::Update {
        document: DocumentRef::Path {
            path: "note.md".into(),
        },
        content: content.into(),
        expected_revision: revision.into(),
    }
}
fn data(ticket: MutationTicket) -> Value {
    ticket.wait().as_ref().as_ref().unwrap().clone()
}

#[test]
fn simultaneous_retries_return_the_same_first_result_and_record_one_native_shared_change() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let manager = manager(cache.path());
    manager
        .select(root.path().to_str().unwrap(), false)
        .unwrap();
    let scope = manager.scope().unwrap();
    let original = scope.save("note.md", "original", None).unwrap();
    let barrier = Arc::new(Barrier::new(17));
    let mut calls = vec![];
    for _ in 0..16 {
        let scope = scope.clone();
        let barrier = barrier.clone();
        let revision = original.revision.clone();
        calls.push(thread::spawn(move || {
            barrier.wait();
            scope
                .submit_mutation("one-change", update("changed", &revision))
                .unwrap()
                .wait()
        }));
    }
    barrier.wait();
    let results: Vec<_> = calls.into_iter().map(|call| call.join().unwrap()).collect();
    assert!(results
        .iter()
        .all(|result| Arc::ptr_eq(&results[0], result)));
    let native_path = root.path().canonicalize().unwrap().join("note.md");
    let saved = manager.read(native_path.to_str().unwrap()).unwrap();
    assert_eq!(saved.content, "changed");
    assert_eq!(
        results[0].as_ref().as_ref().unwrap()["document"]["revision"],
        saved.revision
    );
    assert_eq!(
        manager
            .history(native_path.to_str().unwrap())
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        scope
            .submit_mutation("one-change", update("different", &original.revision))
            .err()
            .unwrap()
            .code,
        "requestIdConflict"
    );
    assert_eq!(
        scope
            .submit_mutation("one-change", create("other.md", "changed"))
            .err()
            .unwrap()
            .code,
        "requestIdConflict"
    );
    assert!(!root.path().join("other.md").exists());
}

#[test]
fn dropped_response_is_owned_by_worker_and_root_switch_drains_through_result_recording() {
    let root = tempfile::tempdir().unwrap();
    let next = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let (manager, entered, release) = super::lifecycle_tests::manager(cache.path());
    let manager = Arc::new(manager);
    manager
        .select(root.path().to_str().unwrap(), false)
        .unwrap();
    let scope = manager.scope().unwrap();
    let abandoned = scope
        .submit_mutation("lost-response", create("note.md", "accepted"))
        .unwrap();
    entered.recv().unwrap();
    assert!(abandoned.try_result().is_none());
    drop(abandoned);
    let retry = scope
        .submit_mutation("lost-response", create("note.md", "accepted"))
        .unwrap();
    assert_eq!(
        scope
            .submit_mutation("lost-response", create("note.md", "other"))
            .err()
            .unwrap()
            .code,
        "requestIdConflict"
    );
    let (done, rx) = mpsc::channel();
    let switch = {
        let manager = manager.clone();
        let next = next.path().to_owned();
        thread::spawn(move || {
            let result = manager.select(next.to_str().unwrap(), false);
            done.send(()).unwrap();
            result
        })
    };
    scope.admission.wait_until_stopped();
    assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert_eq!(
        scope
            .submit_mutation("new", create("new.md", "rejected"))
            .err()
            .unwrap()
            .code,
        "scopeRevoked"
    );
    release.wait();
    switch.join().unwrap().unwrap();
    let value = data(retry);
    assert_eq!(
        value["document"]["content"],
        fs::read_to_string(root.path().join("note.md")).unwrap()
    );
    assert!(value["document"]["permalink"].as_str().is_some());
    assert!(!next.path().join("note.md").exists());
    let path = root.path().canonicalize().unwrap().join("note.md");
    assert_eq!(
        GitDocumentHistory::new(cache.path().into())
            .list(path.to_str().unwrap())
            .unwrap()
            .len(),
        1
    );
    // A new generation has its own journal, and does not reuse the old outcome.
    let new_scope = manager.scope().unwrap();
    assert_ne!(scope.generation, new_scope.generation);
    let new_ticket = new_scope
        .submit_mutation("lost-response", create("note.md", "next generation"))
        .unwrap();
    // Blocking factory also stops the new root's first history record.
    entered.recv().unwrap();
    release.wait();
    assert!(data(new_ticket)["document"]["content"]
        .as_str()
        .unwrap()
        .ends_with("next generation"));
}

#[test]
fn failed_revision_is_cached_even_after_disk_changes_to_match_the_request() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let scope = limited(root.path(), cache.path(), 128, 64 * 1024 * 1024);
    let original = scope.save("note.md", "original", None).unwrap();
    fs::write(root.path().join("note.md"), "external").unwrap();
    let first = scope
        .submit_mutation("stale", update("request", &original.revision))
        .unwrap()
        .wait();
    assert_eq!(first.as_ref().as_ref().unwrap_err().code, "conflict");
    fs::write(root.path().join("note.md"), "original").unwrap();
    let retry = scope
        .submit_mutation("stale", update("request", &original.revision))
        .unwrap()
        .wait();
    assert!(Arc::ptr_eq(&first, &retry));
    assert_eq!(
        fs::read_to_string(root.path().join("note.md")).unwrap(),
        "original"
    );
    assert_eq!(scope.history("note.md").unwrap().len(), 1);
}

#[test]
fn completed_records_are_not_evicted_and_same_id_retries_work_at_count_capacity() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let scope = limited(root.path(), cache.path(), 2, 64 * 1024 * 1024);
    let first = scope
        .submit_mutation("first", create("a.md", "one"))
        .unwrap()
        .wait();
    data(
        scope
            .submit_mutation("second", create("b.md", "two"))
            .unwrap(),
    );
    assert_eq!(
        scope
            .submit_mutation("third", create("c.md", "three"))
            .err()
            .unwrap()
            .code,
        "requestCapacityExceeded"
    );
    let retry = scope
        .submit_mutation("first", create("a.md", "one"))
        .unwrap()
        .wait();
    assert!(Arc::ptr_eq(&first, &retry));
    assert_eq!(scope.history("a.md").unwrap().len(), 1);
    assert!(!root.path().join("c.md").exists());
}

#[test]
fn response_bytes_are_reserved_before_writes_and_capacity_failure_is_retained() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let scope = limited(root.path(), cache.path(), 5, 10_000);
    let content = "x".repeat(12_000);
    let failed = scope
        .submit_mutation("large", create("large.md", &content))
        .unwrap()
        .wait();
    assert_eq!(
        failed.as_ref().as_ref().unwrap_err().code,
        "requestCapacityExceeded"
    );
    assert!(!root.path().join("large.md").exists());
    assert!(scope.history("large.md").unwrap().is_empty());
    // Failed response reservations return unused bytes, without evicting the ID.
    let small = data(
        scope
            .submit_mutation("small", create("small.md", "ok"))
            .unwrap(),
    );
    assert!(small["document"]["content"]
        .as_str()
        .unwrap()
        .ends_with("ok"));
    let retry = scope
        .submit_mutation("large", create("large.md", &content))
        .unwrap()
        .wait();
    assert!(Arc::ptr_eq(&failed, &retry));
    assert_eq!(
        scope
            .submit_mutation("unreserved", create("third.md", "ok"))
            .err()
            .unwrap()
            .code,
        "requestCapacityExceeded"
    );
}

#[test]
fn metadata_retries_share_canonical_object_fingerprint_and_preserve_raw_body() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let scope = limited(root.path(), cache.path(), 128, 64 * 1024 * 1024);
    let original = scope.save("note.md", "\u{feff}---\r\npermalink: stable\r\nunknown: {items: [1, 2]} # retained\r\n---\r\n본문\r\n", None).unwrap();
    let operation = |reverse: bool| {
        let mut nested = serde_json::Map::new();
        for key in if reverse { ["b", "a"] } else { ["a", "b"] } {
            nested.insert(key.into(), json!(key));
        }
        let mut patch = serde_json::Map::new();
        if reverse {
            patch.insert("summary".into(), json!("한 줄"));
        }
        patch.insert("extra".into(), Value::Object(nested));
        patch.insert("summary".into(), json!("한 줄"));
        DocumentMutation::UpdateMetadata {
            document: DocumentRef::Permalink {
                permalink: "stable".into(),
            },
            patch,
            remove: vec![],
            expected_revision: original.revision.clone(),
        }
    };
    let first = scope
        .submit_mutation("metadata", operation(false))
        .unwrap()
        .wait();
    let retry = scope
        .submit_mutation("metadata", operation(true))
        .unwrap()
        .wait();
    assert!(Arc::ptr_eq(&first, &retry));
    let value = first.as_ref().as_ref().unwrap();
    assert_eq!(value["metadata"]["metadata"]["summary"], "한 줄");
    let saved = fs::read_to_string(root.path().join("note.md")).unwrap();
    assert!(saved.starts_with('\u{feff}'));
    assert!(saved.contains("unknown: {items: [1, 2]} # retained"));
    assert!(saved.ends_with("---\r\n본문\r\n"));
    assert_eq!(scope.history("note.md").unwrap().len(), 2);
}

#[test]
fn delete_restore_retries_keep_trash_identity_and_one_history_transition() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let scope = limited(root.path(), cache.path(), 128, 64 * 1024 * 1024);
    let created = data(
        scope
            .submit_mutation("create", create("note.md", "body"))
            .unwrap(),
    );
    let revision = created["document"]["revision"].as_str().unwrap();
    let delete = || DocumentMutation::Delete {
        document: DocumentRef::Path {
            path: "note.md".into(),
        },
        expected_revision: revision.into(),
    };
    let deleted = scope.submit_mutation("delete", delete()).unwrap().wait();
    let retry = scope.submit_mutation("delete", delete()).unwrap().wait();
    assert!(Arc::ptr_eq(&deleted, &retry));
    let value = deleted.as_ref().as_ref().unwrap();
    assert!(value["deleted"].get("content").is_none());
    assert_eq!(
        value["deleted"]["permalink"],
        created["document"]["permalink"]
    );
    assert!(!root.path().join("note.md").exists());
    let trash_id = value["trashId"].as_str().unwrap();
    let restored = scope
        .submit_mutation(
            "restore",
            DocumentMutation::Restore {
                trash_id: trash_id.into(),
            },
        )
        .unwrap()
        .wait();
    let retry = scope
        .submit_mutation(
            "restore",
            DocumentMutation::Restore {
                trash_id: trash_id.into(),
            },
        )
        .unwrap()
        .wait();
    assert!(Arc::ptr_eq(&restored, &retry));
    assert_eq!(
        restored.as_ref().as_ref().unwrap()["document"]["content"],
        created["document"]["content"]
    );
    assert_eq!(scope.history("note.md").unwrap().len(), 1); // Same content, Git deduplicates.
}

#[test]
fn rejected_metadata_and_restore_capacity_leave_original_and_recovery_data_unchanged() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let scope = limited(root.path(), cache.path(), 128, 64 * 1024 * 1024);
    let original = scope
        .save("note.md", "x".repeat(12_000).as_str(), None)
        .unwrap();
    let deleted = scope
        .delete_document(
            &DocumentRef::Path {
                path: "note.md".into(),
            },
            &original.revision,
        )
        .unwrap();
    let restricted = limited(root.path(), cache.path(), 2, 6000);
    let result = restricted
        .submit_mutation(
            "restore",
            DocumentMutation::Restore {
                trash_id: deleted.trash_id.clone(),
            },
        )
        .unwrap()
        .wait();
    assert_eq!(
        result.as_ref().as_ref().unwrap_err().code,
        "requestCapacityExceeded"
    );
    assert!(!root.path().join("note.md").exists());
    assert!(root
        .path()
        .join(".box.md/trash")
        .join(&deleted.trash_id)
        .join("document.md")
        .exists());
    scope.restore_document(&deleted.trash_id).unwrap();
    let result = scope
        .submit_mutation(
            "bad-patch",
            DocumentMutation::UpdateMetadata {
                document: DocumentRef::Path {
                    path: "note.md".into(),
                },
                patch: json!({"summary": 7}).as_object().unwrap().clone(),
                remove: vec![],
                expected_revision: original.revision.clone(),
            },
        )
        .unwrap()
        .wait();
    assert_eq!(
        result.as_ref().as_ref().unwrap_err().code,
        "invalidMetadata"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("note.md")).unwrap(),
        original.content
    );
    assert_eq!(scope.history("note.md").unwrap().len(), 1);
}

#[test]
fn native_and_owned_mutation_writers_use_one_cas_and_history_mutex() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let manager = Arc::new(manager(cache.path()));
    manager
        .select(root.path().to_str().unwrap(), false)
        .unwrap();
    let scope = manager.scope().unwrap();
    let original = scope.save("note.md", "original", None).unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let native = {
        let manager = manager.clone();
        let barrier = barrier.clone();
        let revision = original.revision.clone();
        let path = root.path().join("note.md");
        thread::spawn(move || {
            barrier.wait();
            manager.save(path.to_str().unwrap(), "native", Some(&revision))
        })
    };
    let agent = {
        let scope = scope.clone();
        let barrier = barrier.clone();
        thread::spawn(move || {
            barrier.wait();
            scope
                .submit_mutation("agent", update("agent", &original.revision))
                .unwrap()
                .wait()
        })
    };
    barrier.wait();
    let native = native.join().unwrap();
    let agent = agent.join().unwrap();
    assert_ne!(native.is_ok(), agent.is_ok());
    assert_eq!(
        native.as_ref().err().map(|e| e.code).or_else(|| agent
            .as_ref()
            .as_ref()
            .err()
            .map(|e| e.code)),
        Some("conflict")
    );
    assert_eq!(scope.history("note.md").unwrap().len(), 2);
}

#[test]
fn argument_validation_rejects_unknown_fields_paths_and_conflicting_patch_keys_before_admission() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let scope = limited(root.path(), cache.path(), 1, 64 * 1024 * 1024);
    for id in ["", "  ", "line\n", &"x".repeat(257)] {
        assert_eq!(
            scope
                .submit_mutation(id, create("note.md", "body"))
                .err()
                .unwrap()
                .code,
            "invalidArguments"
        );
    }
    assert_eq!(
        scope
            .submit_mutation("outside", create("../outside.md", "body"))
            .err()
            .unwrap()
            .code,
        "invalidPath"
    );
    assert!(serde_json::from_value::<DocumentMutation>(
        json!({"operation":"create", "path":"note.md", "content":"body", "root":"/tmp"})
    )
    .is_err());
    let overlap = DocumentMutation::UpdateMetadata {
        document: DocumentRef::Path {
            path: "note.md".into(),
        },
        patch: json!({"a":1}).as_object().unwrap().clone(),
        remove: vec!["a".into()],
        expected_revision: "rev".into(),
    };
    assert_eq!(
        scope
            .submit_mutation("overlap", overlap)
            .err()
            .unwrap()
            .code,
        "invalidArguments"
    );
    // Invalid syntax did not consume the only request slot.
    data(
        scope
            .submit_mutation("valid", create("note.md", "valid"))
            .unwrap(),
    );
}

#[test]
fn workspace_drop_drains_owned_mutation_after_response_handles_are_dropped() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let (manager, entered, release) = super::lifecycle_tests::manager(cache.path());
    manager
        .select(root.path().to_str().unwrap(), false)
        .unwrap();
    let scope = manager.scope().unwrap();
    drop(
        scope
            .submit_mutation("detached", create("note.md", "accepted"))
            .unwrap(),
    );
    entered.recv().unwrap();
    let (done, rx) = mpsc::channel();
    let shutdown = thread::spawn(move || {
        drop(manager);
        done.send(()).unwrap();
    });
    scope.admission.wait_until_stopped();
    assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert_eq!(
        scope
            .submit_mutation("new", create("new.md", "rejected"))
            .err()
            .unwrap()
            .code,
        "scopeRevoked"
    );
    release.wait();
    shutdown.join().unwrap();
    assert!(fs::read_to_string(root.path().join("note.md"))
        .unwrap()
        .ends_with("accepted"));
    assert_eq!(
        GitDocumentHistory::new(cache.path().into())
            .list(
                root.path()
                    .canonicalize()
                    .unwrap()
                    .join("note.md")
                    .to_str()
                    .unwrap()
            )
            .unwrap()
            .len(),
        1
    );
    assert!(!root.path().join("new.md").exists());
}

#[test]
fn metadata_response_capacity_fails_before_update_and_corrupt_metadata_can_be_trashed_by_path() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let scope = limited(root.path(), cache.path(), 128, 6000);
    let original = scope.save("note.md", "original", None).unwrap();
    let result = scope
        .submit_mutation(
            "metadata-size",
            DocumentMutation::UpdateMetadata {
                document: DocumentRef::Path {
                    path: "note.md".into(),
                },
                patch: json!({"summary": "x".repeat(12_000)})
                    .as_object()
                    .unwrap()
                    .clone(),
                remove: vec![],
                expected_revision: original.revision.clone(),
            },
        )
        .unwrap()
        .wait();
    assert_eq!(
        result.as_ref().as_ref().unwrap_err().code,
        "requestCapacityExceeded"
    );
    assert_eq!(scope.read("note.md").unwrap().revision, original.revision);
    assert_eq!(scope.history("note.md").unwrap().len(), 1);
    let corrupt = "---\nsummary: [\n---\nbody";
    fs::write(root.path().join("note.md"), corrupt).unwrap();
    let revision = scope.read("note.md").unwrap().revision;
    // A fresh scope journal has enough room for the compact deletion receipt.
    let deleting = limited(root.path(), cache.path(), 128, 6000);
    let value = data(
        deleting
            .submit_mutation(
                "delete",
                DocumentMutation::Delete {
                    document: DocumentRef::Path {
                        path: "note.md".into(),
                    },
                    expected_revision: revision,
                },
            )
            .unwrap(),
    );
    assert!(value["deleted"].get("permalink").is_none());
    let retained = root
        .path()
        .join(".box.md/trash")
        .join(value["trashId"].as_str().unwrap())
        .join("document.md");
    assert_eq!(fs::read_to_string(retained).unwrap(), corrupt);
}

#[test]
fn history_failure_is_a_bounded_success_result_and_retry_does_not_save_again() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let blocker = cache.path().join("blocked");
    fs::write(&blocker, "blocked").unwrap();
    let scope = limited(root.path(), &blocker, 128, 6000);
    let first = scope
        .submit_mutation("warning", create("note.md", "saved"))
        .unwrap()
        .wait();
    let retry = scope
        .submit_mutation("warning", create("note.md", "saved"))
        .unwrap()
        .wait();
    assert!(Arc::ptr_eq(&first, &retry));
    let value = first.as_ref().as_ref().unwrap();
    let warning = value["document"]["historyWarning"].as_str().unwrap();
    assert!(!warning.contains(root.path().to_str().unwrap()));
    assert!(!warning.contains(cache.path().to_str().unwrap()));
    assert_eq!(
        fs::read_to_string(root.path().join("note.md")).unwrap(),
        value["document"]["content"]
    );
}
