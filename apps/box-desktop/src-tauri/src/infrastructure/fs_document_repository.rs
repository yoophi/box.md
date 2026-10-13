use crate::{
    domain::document::{DocumentError, DocumentSnapshot},
    ports::document_repository::DocumentRepository,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub struct FsDocumentRepository;

fn io_error(error: impl std::fmt::Display) -> DocumentError {
    DocumentError::new("io", error.to_string())
}

pub(crate) fn checked_path(path: &str) -> Result<PathBuf, DocumentError> {
    let path = Path::new(path);
    if !path.is_absolute()
        || !path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown"))
    {
        return Err(DocumentError::new(
            "invalidPath",
            "절대 경로의 Markdown 파일을 선택해주세요.",
        ));
    }
    if path.exists() {
        return path.canonicalize().map_err(io_error);
    }
    let parent = path
        .parent()
        .ok_or_else(|| DocumentError::new("invalidPath", "상위 폴더가 없습니다."))?
        .canonicalize()
        .map_err(io_error)?;
    Ok(parent.join(
        path.file_name()
            .ok_or_else(|| DocumentError::new("invalidPath", "파일명이 없습니다."))?,
    ))
}

fn hash(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}
fn revision(path: &Path) -> Result<Option<String>, DocumentError> {
    match fs::read(path) {
        Ok(content) => Ok(Some(hash(&content))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(error)),
    }
}

impl DocumentRepository for FsDocumentRepository {
    fn read(&self, path: &str) -> Result<DocumentSnapshot, DocumentError> {
        let path = checked_path(path)?;
        let bytes = fs::read(&path).map_err(io_error)?;
        let rev = hash(&bytes);
        let content = String::from_utf8(bytes)
            .map_err(|_| DocumentError::new("encoding", "UTF-8 Markdown 파일만 열 수 있습니다."))?;
        Ok(DocumentSnapshot {
            path: path.to_string_lossy().into(),
            content,
            revision: rev,
            history_warning: None,
        })
    }
    fn revision(&self, path: &str) -> Result<Option<String>, DocumentError> {
        revision(&checked_path(path)?)
    }
    fn save(
        &self,
        path: &str,
        content: &str,
        expected_revision: Option<&str>,
    ) -> Result<DocumentSnapshot, DocumentError> {
        let path = checked_path(path)?;
        if revision(&path)?.as_deref() != expected_revision {
            return Err(DocumentError::new(
                "conflict",
                "파일이 외부에서 변경되었습니다. 다시 불러오거나 다른 이름으로 저장해주세요.",
            ));
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(io_error)?;
        if expected_revision.is_some() {
            temporary
                .as_file()
                .set_permissions(fs::metadata(&path).map_err(io_error)?.permissions())
                .map_err(io_error)?;
        }
        temporary.write_all(content.as_bytes()).map_err(io_error)?;
        temporary.as_file().sync_all().map_err(io_error)?;
        if revision(&path)?.as_deref() != expected_revision {
            return Err(DocumentError::new(
                "conflict",
                "저장하는 동안 파일이 외부에서 변경되었습니다.",
            ));
        }
        if expected_revision.is_some() {
            temporary.persist(&path).map_err(|e| io_error(e.error))?;
        } else {
            temporary.persist_noclobber(&path).map_err(|e| {
                DocumentError::new(
                    if e.error.kind() == std::io::ErrorKind::AlreadyExists {
                        "conflict"
                    } else {
                        "io"
                    },
                    e.error.to_string(),
                )
            })?;
        }
        Ok(DocumentSnapshot {
            path: path.to_string_lossy().into(),
            content: content.into(),
            revision: hash(content.as_bytes()),
            history_warning: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_unicode_and_reopens_without_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("한글.md");
        let repo = FsDocumentRepository;
        let created = repo
            .save(
                path.to_str().unwrap(),
                "# 생각

안녕 🌱",
                None,
            )
            .unwrap();
        assert_eq!(
            repo.read(&created.path).unwrap().content,
            "# 생각

안녕 🌱"
        );
        let changed = repo
            .save(&created.path, "수정한 문서", Some(&created.revision))
            .unwrap();
        assert_eq!(repo.read(&created.path).unwrap().revision, changed.revision);
    }
    #[test]
    fn rejects_external_edit_and_keeps_disk_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        let repo = FsDocumentRepository;
        let created = repo.save(path.to_str().unwrap(), "original", None).unwrap();
        fs::write(&path, "external edit").unwrap();
        let error = repo
            .save(&created.path, "local edit", Some(&created.revision))
            .unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(fs::read_to_string(path).unwrap(), "external edit");
    }
    #[test]
    fn new_file_never_overwrites_existing_document() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "keep").unwrap();
        assert_eq!(
            FsDocumentRepository
                .save(path.to_str().unwrap(), "replace", None)
                .unwrap_err()
                .code,
            "conflict"
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "keep");
    }
    #[test]
    fn rejects_non_markdown_and_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            FsDocumentRepository
                .save(dir.path().join("note.txt").to_str().unwrap(), "x", None)
                .unwrap_err()
                .code,
            "invalidPath"
        );
        let path = dir.path().join("bad.md");
        fs::write(&path, [0xff]).unwrap();
        assert_eq!(
            FsDocumentRepository
                .read(path.to_str().unwrap())
                .unwrap_err()
                .code,
            "encoding"
        );
    }
    #[test]
    fn externally_deleted_file_is_not_recreated_by_stale_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        let repo = FsDocumentRepository;
        let created = repo.save(path.to_str().unwrap(), "original", None).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(
            repo.save(&created.path, "stale", Some(&created.revision))
                .unwrap_err()
                .code,
            "conflict"
        );
        assert!(!path.exists());
    }
}
