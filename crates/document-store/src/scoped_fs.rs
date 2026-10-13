use crate::{
    DocumentError, DocumentRepository, DocumentSnapshot, ScopedDocumentRepository, ScopedListing,
    ScopedWarning, TrashSnapshot,
};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, File, OpenOptions, Permissions},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{self, Read, Write},
    path::{Component, Path},
    sync::Mutex,
};

const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;

/// Authority is the original directory object, not a repeatedly resolved path.
/// No ambient filesystem operation occurs after construction.
pub struct ScopedFsDocumentRepository {
    root: Dir,
    mutation: Mutex<()>,
}

fn error(e: io::Error) -> DocumentError {
    #[cfg(unix)]
    if e.raw_os_error() == Some(libc::ELOOP) {
        return DocumentError::new("invalidPath", "symlink 경로는 사용할 수 없습니다.");
    }
    let code = match e.kind() {
        io::ErrorKind::NotFound => "notFound",
        io::ErrorKind::AlreadyExists => "conflict",
        io::ErrorKind::InvalidInput | io::ErrorKind::PermissionDenied => "invalidPath",
        _ => "io",
    };
    DocumentError::new(code, "작업 디렉터리의 문서를 처리하지 못했습니다.")
}
fn conflict() -> DocumentError {
    DocumentError::new("conflict", "문서가 변경되었습니다. 다시 조회해주세요.")
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| matches!(s.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown"))
}
fn visible_dir(name: &str) -> bool {
    !name.starts_with('.') && !matches!(name, "node_modules" | "target")
}
fn validate(path: &str) -> Result<Vec<&str>, DocumentError> {
    let parts: Vec<_> = path.split('/').collect();
    if path.len() > 4096
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || Path::new(path)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        || parts
            .iter()
            .any(|p| matches!(*p, "" | "." | ".." | ".box.md"))
        || parts[..parts.len().saturating_sub(1)]
            .iter()
            .any(|p| !visible_dir(p))
        || (path.as_bytes().get(1) == Some(&b':') && path.as_bytes()[0].is_ascii_alphabetic())
        || !markdown(Path::new(path))
    {
        return Err(DocumentError::new(
            "invalidPath",
            "작업 디렉터리의 상대 Markdown 경로를 사용해주세요.",
        ));
    }
    Ok(parts)
}
/// Pure path validation shared by scoped request admission and filesystem access.
pub fn validate_relative_document_path(path: &str) -> Result<(), DocumentError> {
    validate(path).map(|_| ())
}
fn options(read: bool, write: bool, create_new: bool) -> OpenOptions {
    let mut options = OpenOptions::new();
    options
        .read(read)
        .write(write)
        .create_new(create_new)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NONBLOCK);
    }
    options
}
fn open_regular(dir: &Dir, name: &str) -> Result<File, DocumentError> {
    let file = dir
        .open_with(name, &options(true, false, false))
        .map_err(error)?;
    if !file.metadata().map_err(error)?.is_file() {
        return Err(DocumentError::new(
            "invalidPath",
            "일반 Markdown 파일만 처리할 수 있습니다.",
        ));
    }
    Ok(file)
}
fn bytes(dir: &Dir, name: &str) -> Result<(Vec<u8>, Permissions), DocumentError> {
    let file = open_regular(dir, name)?;
    let permissions = file.metadata().map_err(error)?.permissions();
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() > MAX_BYTES {
        return Err(DocumentError::new(
            "documentTooLarge",
            "문서 크기 제한을 초과했습니다.",
        ));
    }
    Ok((bytes, permissions))
}
fn snapshot(path: &str, bytes: Vec<u8>) -> Result<DocumentSnapshot, DocumentError> {
    let revision = digest(&bytes);
    let content = String::from_utf8(bytes)
        .map_err(|_| DocumentError::new("encoding", "UTF-8 Markdown 파일만 처리할 수 있습니다."))?;
    Ok(DocumentSnapshot {
        path: path.into(),
        content,
        revision,
        history_warning: None,
    })
}
fn revision(dir: &Dir, name: &str) -> Result<Option<String>, DocumentError> {
    match bytes(dir, name) {
        Ok((bytes, _)) => Ok(Some(digest(&bytes))),
        Err(e) if e.code == "notFound" => Ok(None),
        Err(e) => Err(e),
    }
}

/// Named staging files stay in the pinned parent. Publishing a new document
/// uses no-clobber hard-link, publishing an update uses atomic rename.
struct Staging<'a> {
    dir: &'a Dir,
    name: String,
    file: File,
}
impl<'a> Staging<'a> {
    fn new(
        dir: &'a Dir,
        content: &[u8],
        permissions: Option<Permissions>,
    ) -> Result<Self, DocumentError> {
        let name = format!(".box-save-{}.tmp", uuid::Uuid::new_v4());
        let file = dir
            .open_with(&name, &options(true, true, true))
            .map_err(error)?;
        let mut staging = Self { dir, name, file };
        if let Some(permissions) = permissions {
            staging.file.set_permissions(permissions).map_err(error)?;
        }
        staging.file.write_all(content).map_err(error)?;
        staging.file.sync_all().map_err(error)?;
        Ok(staging)
    }
    fn publish(&self, name: &str, replace: bool) -> Result<(), DocumentError> {
        if replace {
            self.dir.rename(&self.name, self.dir, name).map_err(error)
        } else {
            self.dir
                .hard_link(&self.name, self.dir, name)
                .map_err(error)
        }
    }
}
impl Drop for Staging<'_> {
    fn drop(&mut self) {
        let _ = self.dir.remove_file(&self.name);
    }
}

#[derive(Serialize, Deserialize)]
struct TrashManifest {
    path: String,
    revision: String,
}

impl ScopedFsDocumentRepository {
    pub fn open(root: &Path) -> Result<Self, DocumentError> {
        if !root.is_absolute() {
            return Err(DocumentError::new(
                "invalidPath",
                "절대 경로의 작업 디렉터리를 선택해주세요.",
            ));
        }
        let root = Dir::open_ambient_dir(root, ambient_authority()).map_err(|_| {
            DocumentError::new("workspaceUnavailable", "작업 디렉터리를 열 수 없습니다.")
        })?;
        Ok(Self {
            root,
            mutation: Mutex::new(()),
        })
    }
    fn parent<'a>(&self, path: &'a str) -> Result<(Dir, &'a str), DocumentError> {
        let parts = validate(path)?;
        let mut dir = self.root.try_clone().map_err(error)?;
        for part in &parts[..parts.len() - 1] {
            dir = dir.open_dir_nofollow(part).map_err(error)?;
        }
        Ok((dir, parts[parts.len() - 1]))
    }
    fn internal(parent: &Dir, name: &str) -> Result<Dir, DocumentError> {
        match parent.create_dir(name) {
            Ok(()) => (),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(error(e)),
        }
        parent.open_dir_nofollow(name).map_err(error)
    }
    fn lock_file(&self) -> Result<std::fs::File, DocumentError> {
        let admin = Self::internal(&self.root, ".box.md")?;
        // Separate no-clobber creation from opening the existing lock. In
        // particular, do not race two create(true) path-resolution attempts.
        let file = match admin.open_with("documents.lock", &options(true, true, true)) {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => admin
                .open_with("documents.lock", &options(true, true, false))
                .map_err(error)?,
            Err(e) => return Err(error(e)),
        };
        if !file.metadata().map_err(error)?.is_file() {
            return Err(DocumentError::new(
                "invalidPath",
                "저장소 잠금 파일이 올바르지 않습니다.",
            ));
        }
        let file = file.into_std();
        file.lock().map_err(error)?;
        Ok(file)
    }
    fn guard(&self) -> Result<std::sync::MutexGuard<'_, ()>, DocumentError> {
        self.mutation
            .lock()
            .map_err(|_| DocumentError::new("internal", "저장소 잠금 오류"))
    }
    fn trash_dir(&self) -> Result<Dir, DocumentError> {
        Self::internal(&Self::internal(&self.root, ".box.md")?, "trash")
    }
    fn retained(&self, id: &str) -> Result<(Dir, DocumentSnapshot), DocumentError> {
        uuid::Uuid::parse_str(id)
            .map_err(|_| DocumentError::new("invalidArguments", "복구 ID가 올바르지 않습니다."))?;
        let slot = self
            .root
            .open_dir_nofollow(".box.md")
            .map_err(error)?
            .open_dir_nofollow("trash")
            .map_err(error)?
            .open_dir_nofollow(id)
            .map_err(error)?;
        let manifest: TrashManifest = serde_json::from_slice(&bytes(&slot, "manifest.json")?.0)
            .map_err(|_| DocumentError::new("invalidMetadata", "복구 정보가 올바르지 않습니다."))?;
        validate(&manifest.path)?;
        let document = snapshot(&manifest.path, bytes(&slot, "document.md")?.0)?;
        if document.revision != manifest.revision {
            return Err(conflict());
        }
        Ok((slot, document))
    }
}
impl ScopedFsDocumentRepository {
    fn restore_snapshot(
        &self,
        id: &str,
        expected: Option<(&str, &str)>,
    ) -> Result<DocumentSnapshot, DocumentError> {
        uuid::Uuid::parse_str(id)
            .map_err(|_| DocumentError::new("invalidArguments", "복구 ID가 올바르지 않습니다."))?;
        let _guard = self.guard()?;
        let _lock = self.lock_file()?;
        let (slot, document) = self.retained(id)?;
        if expected
            .is_some_and(|(path, revision)| path != document.path || revision != document.revision)
        {
            return Err(conflict());
        }
        let (dir, name) = self.parent(&document.path)?;
        slot.hard_link("document.md", &dir, name).map_err(error)?;
        // Publication already succeeded. A leftover recovery copy must not
        // report a failed restore or cause callers to retry the publication.
        let _ = slot.remove_file("document.md");
        Ok(document)
    }
}

impl DocumentRepository for ScopedFsDocumentRepository {
    fn read(&self, path: &str) -> Result<DocumentSnapshot, DocumentError> {
        let (dir, name) = self.parent(path)?;
        snapshot(path, bytes(&dir, name)?.0)
    }
    fn revision(&self, path: &str) -> Result<Option<String>, DocumentError> {
        let (dir, name) = self.parent(path)?;
        revision(&dir, name)
    }
    fn save(
        &self,
        path: &str,
        content: &str,
        expected: Option<&str>,
    ) -> Result<DocumentSnapshot, DocumentError> {
        validate(path)?;
        if content.len() > MAX_BYTES {
            return Err(DocumentError::new(
                "documentTooLarge",
                "문서 크기 제한을 초과했습니다.",
            ));
        }
        let _guard = self.guard()?;
        let _lock = self.lock_file()?;
        let (dir, name) = self.parent(path)?;
        let previous = match bytes(&dir, name) {
            Ok(value) => Some(value),
            Err(e) if e.code == "notFound" => None,
            Err(e) => return Err(e),
        };
        if previous.as_ref().map(|(b, _)| digest(b)).as_deref() != expected {
            return Err(conflict());
        }
        if let Some((bytes, _)) = &previous {
            std::str::from_utf8(bytes).map_err(|_| {
                DocumentError::new("encoding", "UTF-8 Markdown 파일만 처리할 수 있습니다.")
            })?;
        }
        let staging = Staging::new(&dir, content.as_bytes(), previous.map(|(_, p)| p))?;
        if revision(&dir, name)?.as_deref() != expected {
            return Err(conflict());
        }
        staging.publish(name, expected.is_some())?;
        snapshot(path, content.as_bytes().to_vec())
    }
}
impl ScopedDocumentRepository for ScopedFsDocumentRepository {
    fn list(&self) -> Result<ScopedListing, DocumentError> {
        let mut result = ScopedListing::default();
        let mut stack = vec![(self.root.try_clone().map_err(error)?, String::new())];
        let mut count = 0;
        while let Some((dir, prefix)) = stack.pop() {
            let entries = match dir.entries() {
                Ok(entries) => entries,
                Err(e) => {
                    result.warnings.push(ScopedWarning {
                        path: Some(prefix),
                        code: error(e).code,
                    });
                    continue;
                }
            };
            for entry in entries {
                count += 1;
                if count > MAX_ENTRIES {
                    result.truncated = true;
                    break;
                }
                let entry = match entry {
                    Ok(e) => e,
                    Err(e) => {
                        result.warnings.push(ScopedWarning {
                            path: Some(prefix.clone()),
                            code: error(e).code,
                        });
                        continue;
                    }
                };
                let name = entry.file_name();
                let Some(name) = name.to_str() else {
                    result.warnings.push(ScopedWarning {
                        path: None,
                        code: "encoding",
                    });
                    continue;
                };
                let path = if prefix.is_empty() {
                    name.into()
                } else {
                    format!("{prefix}/{name}")
                };
                let kind = match entry.file_type() {
                    Ok(k) => k,
                    Err(e) => {
                        result.warnings.push(ScopedWarning {
                            path: Some(path),
                            code: error(e).code,
                        });
                        continue;
                    }
                };
                if kind.is_dir() && visible_dir(name) {
                    match dir.open_dir_nofollow(name) {
                        Ok(child) => stack.push((child, path)),
                        Err(e) => result.warnings.push(ScopedWarning {
                            path: Some(path),
                            code: error(e).code,
                        }),
                    }
                } else if kind.is_file() && markdown(Path::new(name)) {
                    match validate(&path) {
                        Ok(_) => result.paths.push(path),
                        Err(e) => result.warnings.push(ScopedWarning {
                            path: Some(path),
                            code: e.code,
                        }),
                    }
                }
            }
            if result.truncated {
                break;
            }
        }
        result.paths.sort_by(|a, b| {
            a.to_lowercase()
                .cmp(&b.to_lowercase())
                .then_with(|| a.cmp(b))
        });
        Ok(result)
    }
    fn trash(&self, path: &str, expected: &str) -> Result<TrashSnapshot, DocumentError> {
        validate(path)?;
        let _guard = self.guard()?;
        let _lock = self.lock_file()?;
        let (dir, name) = self.parent(path)?;
        let document = snapshot(path, bytes(&dir, name)?.0)?;
        if document.revision != expected {
            return Err(conflict());
        }
        let trash = self.trash_dir()?;
        let id = uuid::Uuid::new_v4().to_string();
        trash.create_dir(&id).map_err(error)?;
        let slot = trash.open_dir_nofollow(&id).map_err(error)?;
        let manifest = serde_json::to_vec(&TrashManifest {
            path: path.into(),
            revision: expected.into(),
        })
        .map_err(|_| DocumentError::new("internal", "복구 정보 오류"))?;
        let staging = Staging::new(&slot, &manifest, None)?;
        staging.publish("manifest.json", false)?;
        if revision(&dir, name)?.as_deref() != Some(expected) {
            return Err(conflict());
        }
        dir.rename(name, &slot, "document.md").map_err(error)?;
        // A non-cooperating editor can race the last revision check. Retain all
        // bytes and attempt no-clobber rollback instead of discarding that edit.
        let moved_revision = revision(&slot, "document.md");
        if !matches!(&moved_revision, Ok(Some(revision)) if revision == expected) {
            let restored = slot.hard_link("document.md", &dir, name).is_ok();
            if restored {
                // Once rollback succeeds, cleanup failure must not disguise
                // that the original path has been restored.
                let _ = slot.remove_file("document.md");
            }
            return Err(DocumentError::new(
                "conflict",
                if restored {
                    "삭제 중 문서가 변경되어 원래 경로에 복원했습니다.".into()
                } else {
                    format!("삭제 중 문서가 변경되었습니다. 보존된 복구 데이터 ID: {id}")
                },
            ));
        }
        Ok(TrashSnapshot {
            trash_id: id,
            document,
        })
    }
    fn read_trash(&self, id: &str) -> Result<DocumentSnapshot, DocumentError> {
        self.retained(id).map(|(_, document)| document)
    }
    fn restore(&self, id: &str) -> Result<DocumentSnapshot, DocumentError> {
        self.restore_snapshot(id, None)
    }
    fn restore_checked(
        &self,
        id: &str,
        path: &str,
        revision: &str,
    ) -> Result<DocumentSnapshot, DocumentError> {
        self.restore_snapshot(id, Some((path, revision)))
    }
}
