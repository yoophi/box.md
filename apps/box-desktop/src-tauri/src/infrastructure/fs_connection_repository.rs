use crate::{
    domain::{connection::ConnectionSnapshot, document::DocumentError},
    ports::connection_repository::ConnectionRepository,
};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};

const MAX_BYTES: u64 = 8 * 1024 * 1024;
pub struct FsConnectionRepository {
    root: PathBuf,
}
fn error(value: impl std::fmt::Display) -> DocumentError {
    DocumentError::new("connectionStore", format!("연결 저장소 오류: {value}"))
}
impl FsConnectionRepository {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn data_path(&self) -> PathBuf {
        self.root.join("connections.json")
    }
}
impl ConnectionRepository for FsConnectionRepository {
    fn read(&self) -> Result<ConnectionSnapshot, DocumentError> {
        let file = match fs::File::open(self.data_path()) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ConnectionSnapshot::default())
            }
            Err(e) => return Err(error(e)),
        };
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(error)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(error("연결 데이터가 너무 큽니다. 원본을 유지합니다."));
        }
        let state: ConnectionSnapshot = serde_json::from_slice(&bytes).map_err(error)?;
        state.validate()?;
        Ok(state)
    }
    fn transact(
        &self,
        edit: &mut dyn FnMut(&mut ConnectionSnapshot) -> Result<bool, DocumentError>,
    ) -> Result<ConnectionSnapshot, DocumentError> {
        fs::create_dir_all(&self.root).map_err(error)?;
        let mut options = fs::File::options();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        // Lock a stable inode, not the data file replaced below. Drop releases the lock.
        let lock = options
            .open(self.root.join("connections.lock"))
            .map_err(error)?;
        lock.lock().map_err(error)?;
        let mut state = self.read()?;
        let changed = edit(&mut state)?;
        state.validate()?;
        if changed {
            let bytes = serde_json::to_vec_pretty(&state).map_err(error)?;
            if bytes.len() as u64 > MAX_BYTES {
                return Err(error("연결 데이터가 너무 큽니다. 원본을 유지합니다."));
            }
            let mut file = tempfile::NamedTempFile::new_in(&self.root).map_err(error)?;
            file.write_all(&bytes).map_err(error)?;
            file.as_file().sync_all().map_err(error)?;
            file.persist(self.data_path()).map_err(|e| error(e.error))?;
        }
        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::{
        connection_service::ConnectionService, document_service::DocumentService,
    };
    use crate::infrastructure::{
        fs_document_repository::FsDocumentRepository, git_document_history::GitDocumentHistory,
    };

    fn service(root: &std::path::Path) -> ConnectionService {
        ConnectionService::new(FsConnectionRepository::new(root.into()))
    }

    #[test]
    fn many_to_many_detach_keeps_other_relations_entities_and_documents() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        let one = dir.path().join("one.md");
        let two = dir.path().join("two.md");
        fs::write(&one, "# 원본 문서 🌱").unwrap();
        fs::write(&two, "# 다른 문서").unwrap();
        let connection = service(&root);
        let created = connection.create(" 검토 ").unwrap();
        let first = created.entities[0].id.clone();
        assert!(uuid::Uuid::parse_str(&first).is_ok());
        assert_eq!(created.entities[0].name, "검토");
        assert!(created.memberships.is_empty());
        let second = connection.create("자료").unwrap().entities[1].id.clone();
        assert_ne!(first, second);
        connection.attach(&first, "one").unwrap();
        connection.attach(&first, "two").unwrap();
        connection.attach(&second, "one").unwrap();
        assert_eq!(
            connection.attach(&first, "one").unwrap().memberships.len(),
            3
        );
        let detached = connection.detach(&first, "one").unwrap();
        assert_eq!(detached.entities.len(), 2);
        assert_eq!(detached.memberships.len(), 2);
        assert!(detached
            .memberships
            .iter()
            .any(|edge| edge.connection_id == first && edge.permalink == "two"));
        assert!(detached
            .memberships
            .iter()
            .any(|edge| edge.connection_id == second && edge.permalink == "one"));
        assert_eq!(connection.detach(&first, "one").unwrap(), detached);
        assert_eq!(service(&root).snapshot().unwrap(), detached);
        assert_eq!(fs::read_to_string(one).unwrap(), "# 원본 문서 🌱");
        assert_eq!(fs::read_to_string(two).unwrap(), "# 다른 문서");
    }

    #[test]
    fn file_location_title_and_wikilink_edits_do_not_change_memberships() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("app-data");
        let document = dir.path().join("note.md");
        fs::write(&document, "---\npermalink: stable\n---\n# 원래 제목\n").unwrap();
        let connection = service(&root);
        let id = connection.create("연구").unwrap().entities[0].id.clone();
        let expected = connection.attach(&id, "stable").unwrap();
        let data = fs::read(root.join("connections.json")).unwrap();
        let elsewhere = dir.path().join("different-directory");
        fs::create_dir(&elsewhere).unwrap();
        let renamed = elsewhere.join("renamed.md");
        fs::rename(&document, &renamed).unwrap();
        let documents = DocumentService::new(
            FsDocumentRepository,
            GitDocumentHistory::new(dir.path().join("history")),
        );
        let original = documents.read(renamed.to_str().unwrap()).unwrap();
        let updated = documents
            .save(
                &original.path,
                "---\npermalink: stable\n---\n# 새 제목\n\n[[other]] 그리고 [[other | 별칭]]",
                Some(&original.revision),
            )
            .unwrap();
        assert_eq!(service(&root).snapshot().unwrap(), expected);
        documents
            .save(
                &updated.path,
                "---\npermalink: stable\n---\n# 새 제목\n\n본문 링크 제거",
                Some(&updated.revision),
            )
            .unwrap();
        assert_eq!(service(&root).snapshot().unwrap(), expected);
        assert_eq!(fs::read(root.join("connections.json")).unwrap(), data);
    }

    #[test]
    fn validation_and_failed_transactions_preserve_the_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let repo = FsConnectionRepository::new(dir.path().into());
        let connection = service(dir.path());
        let expected = connection.create("Topic").unwrap();
        let bytes = fs::read(repo.data_path()).unwrap();
        for name in [
            " ".into(),
            "topic".into(),
            "bad\nname".into(),
            "x".repeat(121),
        ] {
            assert!(connection.create(&name).is_err());
        }
        assert!(connection.attach("missing", "doc").is_err());
        assert!(connection.attach(&expected.entities[0].id, " ").is_err());
        assert!(repo
            .transact(&mut |state| {
                state.entities.clear();
                Err(DocumentError::new("test", "abort"))
            })
            .is_err());
        assert_eq!(connection.snapshot().unwrap(), expected);
        assert_eq!(fs::read(repo.data_path()).unwrap(), bytes);
    }

    #[test]
    fn corrupt_future_and_inconsistent_data_are_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let repo = FsConnectionRepository::new(dir.path().into());
        let malformed = [
            "not JSON",
            r#"{"version":2,"entities":[],"memberships":[]}"#,
            r#"{"version":1,"entities":[],"memberships":[],"extra":"keep"}"#,
            r#"{"version":1,"entities":[],"memberships":[{"connectionId":"absent","permalink":"doc"}]}"#,
            r#"{"version":1,"entities":[{"id":"a","name":"one"},{"id":"a","name":"two"}],"memberships":[]}"#,
            r#"{"version":1,"entities":[{"id":"a","name":"one"}],"memberships":[{"connectionId":"a","permalink":"doc"},{"connectionId":"a","permalink":"doc"}]}"#,
        ];
        for raw in malformed {
            fs::write(repo.data_path(), raw).unwrap();
            assert!(service(dir.path()).snapshot().is_err());
            assert!(service(dir.path()).create("new").is_err());
            assert_eq!(fs::read_to_string(repo.data_path()).unwrap(), raw);
        }
    }

    #[test]
    fn permalink_is_an_opaque_value_not_a_filesystem_path() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside");
        fs::write(&outside, "keep").unwrap();
        let connection = service(&dir.path().join("data"));
        let id = connection.create("자료 🌱").unwrap().entities[0].id.clone();
        for key in ["../outside", "__proto__", "한글 /?#&"] {
            connection.attach(&id, key).unwrap();
        }
        assert_eq!(connection.snapshot().unwrap().memberships.len(), 3);
        assert_eq!(fs::read_to_string(outside).unwrap(), "keep");
    }

    #[test]
    fn independent_processes_do_not_lose_each_others_changes() {
        let dir = tempfile::tempdir().unwrap();
        let executable = std::env::current_exe().unwrap();
        let spawn = |prefix: &str| {
            std::process::Command::new(&executable)
                .args([
                    "--exact",
                    "infrastructure::fs_connection_repository::tests::connection_peer_worker",
                    "--ignored",
                ])
                .env("BOX_CONNECTION_TEST_ROOT", dir.path())
                .env("BOX_CONNECTION_TEST_PREFIX", prefix)
                .spawn()
                .unwrap()
        };
        let mut one = spawn("one");
        let mut two = spawn("two");
        assert!(one.wait().unwrap().success());
        assert!(two.wait().unwrap().success());
        let snapshot = service(dir.path()).snapshot().unwrap();
        assert_eq!(snapshot.entities.len(), 24);
        assert_eq!(snapshot.memberships.len(), 24);
        snapshot.validate().unwrap();
    }

    #[test]
    fn fresh_process_restores_exact_entity_ids_and_memberships() {
        let dir = tempfile::tempdir().unwrap();
        let connection = service(dir.path());
        let first = connection.create("検討 🌱").unwrap().entities[0].id.clone();
        let second = connection.create("자료").unwrap().entities[1].id.clone();
        connection.attach(&first, "source").unwrap();
        connection.attach(&first, "target").unwrap();
        let expected = connection.attach(&second, "source").unwrap();
        let bytes = fs::read(dir.path().join("connections.json")).unwrap();
        drop(connection);
        // A new OS process reads the actual file; no inherited service or in-memory snapshot.
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "infrastructure::fs_connection_repository::tests::connection_peer_worker",
                "--ignored",
            ])
            .env("BOX_CONNECTION_TEST_ROOT", dir.path())
            .env(
                "BOX_CONNECTION_TEST_EXPECTED",
                serde_json::to_string(&expected).unwrap(),
            )
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(
            fs::read(dir.path().join("connections.json")).unwrap(),
            bytes
        );
    }

    #[test]
    #[ignore = "spawned with a disposable directory by persistence/concurrency tests"]
    fn connection_peer_worker() {
        let root = PathBuf::from(std::env::var_os("BOX_CONNECTION_TEST_ROOT").unwrap());
        let connection = service(&root);
        if let Ok(raw) = std::env::var("BOX_CONNECTION_TEST_EXPECTED") {
            let expected: ConnectionSnapshot = serde_json::from_str(&raw).unwrap();
            let restored = connection.snapshot().unwrap();
            restored.validate().unwrap();
            assert_eq!(restored, expected);
            return;
        }
        let prefix = std::env::var("BOX_CONNECTION_TEST_PREFIX").unwrap();
        for number in 0..12 {
            let created = connection.create(&format!("{prefix}-{number}")).unwrap();
            let id = created.entities.last().unwrap().id.clone();
            // Another process can add entities after create; use its returned snapshot's own last ID.
            connection
                .attach(&id, &format!("{prefix}-document-{number}"))
                .unwrap();
        }
    }
}
