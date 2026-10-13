use box_document_store::{
    DocumentRepository, ScopedDocumentRepository, ScopedFsDocumentRepository,
};
use std::{
    fs,
    sync::{Arc, Barrier},
    thread,
};
use tempfile::TempDir;

fn repository(root: &TempDir) -> ScopedFsDocumentRepository {
    ScopedFsDocumentRepository::open(root.path()).unwrap()
}

#[test]
fn unicode_nested_listing_and_reading() {
    let root = tempfile::tempdir().unwrap();
    for dir in ["한글/문서", ".hidden", "node_modules", "target", ".box.md"] {
        fs::create_dir_all(root.path().join(dir)).unwrap();
    }
    for path in ["한글/문서/노트.MD", "a.markdown", "B.mdown", ".note.md"] {
        fs::write(root.path().join(path), "안녕하세요\r\n").unwrap();
    }
    for path in [
        ".hidden/a.md",
        "node_modules/a.md",
        "target/a.md",
        ".box.md/a.md",
        "a.txt",
    ] {
        fs::write(root.path().join(path), "excluded").unwrap();
    }
    let repo = repository(&root);
    let listing = repo.list().unwrap();
    assert_eq!(
        listing.paths,
        [".note.md", "a.markdown", "B.mdown", "한글/문서/노트.MD"]
    );
    assert!(!listing.truncated);
    assert!(listing.warnings.is_empty());
    let doc = repo.read("한글/문서/노트.MD").unwrap();
    assert_eq!(doc.path, "한글/문서/노트.MD");
    assert_eq!(doc.content, "안녕하세요\r\n");
    assert_eq!(
        repo.revision(&doc.path).unwrap().as_deref(),
        Some(doc.revision.as_str())
    );
}

#[test]
fn create_update_conflict_and_deleted_file_are_distinct() {
    let root = tempfile::tempdir().unwrap();
    let repo = repository(&root);
    assert_eq!(repo.revision("note.md").unwrap(), None);
    let first = repo.save("note.md", "first", None).unwrap();
    assert_eq!(
        repo.save("note.md", "overwrite", None).unwrap_err().code,
        "conflict"
    );
    let second = repo
        .save("note.md", "second", Some(&first.revision))
        .unwrap();
    assert_ne!(first.revision, second.revision);
    assert_eq!(
        repo.save("note.md", "stale", Some(&first.revision))
            .unwrap_err()
            .code,
        "conflict"
    );
    assert_eq!(
        fs::read_to_string(root.path().join("note.md")).unwrap(),
        "second"
    );
    fs::remove_file(root.path().join("note.md")).unwrap();
    assert_eq!(
        repo.save("note.md", "resurrect", Some(&second.revision))
            .unwrap_err()
            .code,
        "conflict"
    );
    assert!(!root.path().join("note.md").exists());
    assert!(fs::read_dir(root.path()).unwrap().all(|e| {
        !e.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".box-save-")
    }));
}

fn race_writes(root: &TempDir, expected: Option<String>) {
    let barrier = Arc::new(Barrier::new(3));
    let contents = if expected.is_some() {
        ["updated alpha", "updated beta"]
    } else {
        ["alpha", "beta"]
    };
    let handles: Vec<_> = contents
        .into_iter()
        .map(|content| {
            let repo = repository(root);
            let barrier = barrier.clone();
            let expected = expected.clone();
            thread::spawn(move || {
                barrier.wait();
                repo.save("race.md", content, expected.as_deref())
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(
        results.iter().filter(|r| r.is_ok()).count(),
        1,
        "{results:?}"
    );
    assert_eq!(
        results
            .iter()
            .filter(|r| r.as_ref().is_err_and(|e| e.code == "conflict"))
            .count(),
        1,
        "{results:?}"
    );
    let winner = results.into_iter().find_map(Result::ok).unwrap();
    assert_eq!(
        fs::read_to_string(root.path().join("race.md")).unwrap(),
        winner.content
    );
}

#[test]
fn independent_instances_serialize_create_and_cas_updates() {
    let root = tempfile::tempdir().unwrap();
    race_writes(&root, None);
    let revision = repository(&root).read("race.md").unwrap().revision;
    race_writes(&root, Some(revision));
}

#[test]
fn rejected_paths_do_not_mutate_the_workspace() {
    let root = tempfile::tempdir().unwrap();
    let repo = repository(&root);
    for path in [
        "",
        "/tmp/note.md",
        "../note.md",
        "a/../note.md",
        "./note.md",
        "a//note.md",
        "a/./note.md",
        "C:/note.md",
        "a\\note.md",
        "note\n.md",
        ".box.md/note.md",
        ".hidden/note.md",
        "target/note.md",
        "node_modules/note.md",
        "note.txt",
    ] {
        assert_eq!(repo.read(path).unwrap_err().code, "invalidPath", "{path:?}");
        assert_eq!(
            repo.save(path, "rejected", None).unwrap_err().code,
            "invalidPath",
            "{path:?}"
        );
    }
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn invalid_encoding_and_oversized_documents_preserve_original_bytes() {
    let root = tempfile::tempdir().unwrap();
    let repo = repository(&root);
    fs::write(root.path().join("binary.md"), [0xff, 0xfe]).unwrap();
    let revision = repo.revision("binary.md").unwrap().unwrap();
    assert_eq!(repo.read("binary.md").unwrap_err().code, "encoding");
    assert_eq!(
        repo.save("binary.md", "replacement", Some(&revision))
            .unwrap_err()
            .code,
        "encoding"
    );
    assert_eq!(
        repo.trash("binary.md", &revision).unwrap_err().code,
        "encoding"
    );
    assert_eq!(
        fs::read(root.path().join("binary.md")).unwrap(),
        [0xff, 0xfe]
    );
    let first = repo.save("large.md", "original", None).unwrap();
    let oversized = "x".repeat(8 * 1024 * 1024 + 1);
    assert_eq!(
        repo.save("large.md", &oversized, Some(&first.revision))
            .unwrap_err()
            .code,
        "documentTooLarge"
    );
    assert_eq!(repo.read("large.md").unwrap().content, "original");
    fs::write(root.path().join("external-large.md"), oversized).unwrap();
    assert_eq!(
        repo.read("external-large.md").unwrap_err().code,
        "documentTooLarge"
    );
}

#[test]
fn trash_survives_reopening_and_restore_never_overwrites_new_content() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("notes")).unwrap();
    let repo = repository(&root);
    let doc = repo
        .save(
            "notes/한글.md",
            "\u{feff}---\r\nsummary: hello\r\n---\r\n본문",
            None,
        )
        .unwrap();
    assert_eq!(repo.trash(&doc.path, "stale").unwrap_err().code, "conflict");
    let trashed = repo.trash(&doc.path, &doc.revision).unwrap();
    assert!(!root.path().join(&doc.path).exists());
    assert!(repo.list().unwrap().paths.is_empty());
    drop(repo);
    let repo = repository(&root);
    repo.save(&doc.path, "new document", None).unwrap();
    assert_eq!(
        repo.restore(&trashed.trash_id).unwrap_err().code,
        "conflict"
    );
    assert_eq!(repo.read(&doc.path).unwrap().content, "new document");
    fs::remove_file(root.path().join(&doc.path)).unwrap();
    let restored = repo.restore(&trashed.trash_id).unwrap();
    assert_eq!(restored.content, doc.content);
    assert_eq!(restored.revision, doc.revision);
    assert_eq!(
        repo.restore(&trashed.trash_id).unwrap_err().code,
        "notFound"
    );
    assert_eq!(
        repo.restore("../../outside").unwrap_err().code,
        "invalidArguments"
    );
}

#[test]
fn tampered_recovery_manifest_and_content_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    let repo = repository(&root);
    let doc = repo.save("note.md", "original", None).unwrap();
    let trash = repo.trash("note.md", &doc.revision).unwrap();
    let slot = root.path().join(".box.md/trash").join(&trash.trash_id);
    let manifest = fs::read(slot.join("manifest.json")).unwrap();
    fs::write(
        slot.join("manifest.json"),
        format!(
            "{{\"path\":\"../outside.md\",\"revision\":\"{}\"}}",
            doc.revision
        ),
    )
    .unwrap();
    assert_eq!(
        repo.restore(&trash.trash_id).unwrap_err().code,
        "invalidPath"
    );
    fs::write(slot.join("manifest.json"), &manifest).unwrap();
    fs::write(slot.join("document.md"), "tampered").unwrap();
    assert_eq!(repo.restore(&trash.trash_id).unwrap_err().code, "conflict");
    assert!(!root.path().join("note.md").exists());
    assert_eq!(
        fs::read_to_string(slot.join("document.md")).unwrap(),
        "tampered"
    );
}

#[test]
fn listing_reports_truncation_instead_of_claiming_completeness() {
    let root = tempfile::tempdir().unwrap();
    for i in 0..20_001 {
        fs::write(root.path().join(format!("{i}.md")), "").unwrap();
    }
    let listing = repository(&root).list().unwrap();
    assert!(listing.truncated);
    assert_eq!(listing.paths.len(), 20_000);
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::{
        os::unix::fs::{PermissionsExt, symlink},
        sync::atomic::{AtomicBool, Ordering},
    };

    #[test]
    fn permissions_survive_updates_and_trash_restore() {
        let root = tempfile::tempdir().unwrap();
        let repo = repository(&root);
        let doc = repo.save("note.md", "first", None).unwrap();
        assert_eq!(
            fs::metadata(root.path().join("note.md"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::set_permissions(
            root.path().join("note.md"),
            fs::Permissions::from_mode(0o640),
        )
        .unwrap();
        let doc = repo.save("note.md", "second", Some(&doc.revision)).unwrap();
        let trash = repo.trash("note.md", &doc.revision).unwrap();
        repo.restore(&trash.trash_id).unwrap();
        assert_eq!(
            fs::metadata(root.path().join("note.md"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
    }

    #[test]
    fn leaf_parent_and_management_symlinks_cannot_reach_outside() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("note.md"), "outside").unwrap();
        symlink(outside.path().join("note.md"), root.path().join("leaf.md")).unwrap();
        symlink(outside.path(), root.path().join("linked")).unwrap();
        let repo = repository(&root);
        for path in ["leaf.md", "linked/note.md"] {
            assert!(repo.read(path).is_err());
            assert!(repo.save(path, "overwrite", None).is_err());
        }
        assert!(repo.list().unwrap().paths.is_empty());
        fs::remove_dir(root.path().join(".box.md")).unwrap_err(); // contains only the lock
        fs::remove_file(root.path().join(".box.md/documents.lock")).unwrap();
        fs::remove_dir(root.path().join(".box.md")).unwrap();
        symlink(outside.path(), root.path().join(".box.md")).unwrap();
        assert!(repo.save("new.md", "rejected", None).is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("note.md")).unwrap(),
            "outside"
        );
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
    }

    #[test]
    fn replacing_root_name_keeps_the_original_directory_authority() {
        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = parent.path().join("workspace");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("note.md"), "original").unwrap();
        fs::write(outside.path().join("note.md"), "outside").unwrap();
        let repo = ScopedFsDocumentRepository::open(&root).unwrap();
        fs::rename(&root, parent.path().join("moved")).unwrap();
        symlink(outside.path(), &root).unwrap();
        let doc = repo.read("note.md").unwrap();
        assert_eq!(doc.content, "original");
        repo.save("note.md", "updated", Some(&doc.revision))
            .unwrap();
        assert_eq!(
            fs::read_to_string(parent.path().join("moved/note.md")).unwrap(),
            "updated"
        );
        assert_eq!(
            fs::read_to_string(outside.path().join("note.md")).unwrap(),
            "outside"
        );
    }

    #[test]
    fn concurrent_parent_symlink_swaps_never_mutate_external_files() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("notes")).unwrap();
        fs::write(root.path().join("notes/note.md"), "inside").unwrap();
        fs::write(outside.path().join("note.md"), "outside").unwrap();
        let repo = repository(&root);
        let running = Arc::new(AtomicBool::new(true));
        let barrier = Arc::new(Barrier::new(2));
        let swapper = {
            let root = root.path().to_owned();
            let outside = outside.path().to_owned();
            let running = running.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                let mut swaps = 0;
                while running.load(Ordering::Acquire) || swaps < 100 {
                    fs::rename(root.join("notes"), root.join("parked")).unwrap();
                    symlink(&outside, root.join("notes")).unwrap();
                    thread::yield_now();
                    fs::remove_file(root.join("notes")).unwrap();
                    fs::rename(root.join("parked"), root.join("notes")).unwrap();
                    swaps += 1;
                }
                swaps
            })
        };
        barrier.wait();
        for _ in 0..300 {
            if let Ok(doc) = repo.read("notes/note.md") {
                assert_ne!(doc.content, "outside");
                let _ = repo.save("notes/note.md", "inside updated", Some(&doc.revision));
            }
            let _ = repo.save("notes/created.md", "inside new", None);
            let _ = repo.list();
        }
        running.store(false, Ordering::Release);
        assert!(swapper.join().unwrap() >= 100);
        assert_eq!(
            fs::read_to_string(outside.path().join("note.md")).unwrap(),
            "outside"
        );
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
    }

    #[test]
    fn readers_observe_complete_files_during_atomic_updates() {
        let root = tempfile::tempdir().unwrap();
        let repo = repository(&root);
        let first = "a".repeat(128 * 1024);
        let mut doc = repo.save("atomic.md", &first, None).unwrap();
        let running = Arc::new(AtomicBool::new(true));
        let ready = Arc::new(Barrier::new(2));
        let reader = {
            let path = root.path().join("atomic.md");
            let running = running.clone();
            let ready = ready.clone();
            thread::spawn(move || {
                let mut reads = 0;
                loop {
                    let bytes = fs::read(&path).unwrap();
                    assert_eq!(bytes.len(), 128 * 1024);
                    assert!(bytes.iter().all(|byte| *byte == bytes[0]));
                    reads += 1;
                    if reads == 1 {
                        ready.wait();
                    }
                    if !running.load(Ordering::Acquire) {
                        break;
                    }
                }
                reads
            })
        };
        ready.wait();
        for i in 0..30 {
            let content = if i % 2 == 0 { "b" } else { "a" }.repeat(128 * 1024);
            doc = repo
                .save("atomic.md", &content, Some(&doc.revision))
                .unwrap();
        }
        running.store(false, Ordering::Release);
        assert!(reader.join().unwrap() > 1);
    }

    #[test]
    fn special_files_and_symlink_lock_are_rejected_without_external_writes() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let fifo = root.path().join("pipe.md");
        assert!(
            std::process::Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .unwrap()
                .success()
        );
        let repo = repository(&root);
        assert_eq!(repo.read("pipe.md").unwrap_err().code, "invalidPath");
        assert!(repo.list().unwrap().paths.is_empty());
        fs::create_dir(root.path().join(".box.md")).unwrap();
        let external_lock = outside.path().join("lock");
        fs::write(&external_lock, "untouched").unwrap();
        symlink(&external_lock, root.path().join(".box.md/documents.lock")).unwrap();
        assert!(repo.save("note.md", "rejected", None).is_err());
        assert_eq!(fs::read_to_string(external_lock).unwrap(), "untouched");
        assert!(!root.path().join("note.md").exists());
    }

    #[test]
    fn successful_restore_is_not_reported_as_failure_when_cleanup_is_denied() {
        let root = tempfile::tempdir().unwrap();
        let repo = repository(&root);
        let doc = repo.save("note.md", "original", None).unwrap();
        let trash = repo.trash("note.md", &doc.revision).unwrap();
        let slot = root.path().join(".box.md/trash").join(&trash.trash_id);
        fs::set_permissions(&slot, fs::Permissions::from_mode(0o555)).unwrap();
        let restored = repo.restore(&trash.trash_id);
        fs::set_permissions(&slot, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(restored.unwrap().content, "original");
        assert_eq!(repo.read("note.md").unwrap().revision, doc.revision);
        // The recovery data may remain, but a repeated restore must never
        // overwrite an existing document, regardless of cleanup outcome.
        assert!(repo.restore(&trash.trash_id).is_err());
    }
}
