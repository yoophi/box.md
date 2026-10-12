use crate::{
    domain::{comment::DocumentComment, document::DocumentError},
    ports::comment_repository::CommentRepository,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

pub struct FsCommentRepository {
    root: PathBuf,
}
fn error(e: impl std::fmt::Display) -> DocumentError {
    DocumentError::new("comment", e.to_string())
}
impl FsCommentRepository {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn path(&self, key: &str) -> PathBuf {
        self.root
            .join(format!("{:x}.json", Sha256::digest(key.as_bytes())))
    }
}
impl CommentRepository for FsCommentRepository {
    fn list(&self, key: &str) -> Result<Vec<DocumentComment>, DocumentError> {
        match fs::read(self.path(key)) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(error),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(error(e)),
        }
    }
    fn append(&self, key: &str, body: &str) -> Result<DocumentComment, DocumentError> {
        let mut comments = self.list(key)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(error)?
            .as_millis()
            .to_string();
        let comment = DocumentComment {
            id: format!("{}-{}", now, comments.len()),
            created_at: now,
            body: body.into(),
        };
        comments.push(comment.clone());
        fs::create_dir_all(&self.root).map_err(error)?;
        let mut file = tempfile::NamedTempFile::new_in(&self.root).map_err(error)?;
        file.write_all(&serde_json::to_vec_pretty(&comments).map_err(error)?)
            .map_err(error)?;
        file.as_file().sync_all().map_err(error)?;
        file.persist(self.path(key)).map_err(|e| error(e.error))?;
        Ok(comment)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::comment_service::CommentService;
    #[test]
    fn comments_persist_separately_without_changing_document_and_reject_empty_input() {
        let dir = tempfile::tempdir().unwrap();
        let document = dir.path().join("note.md");
        fs::write(&document, "---\nsummary: 메모\n---\n# 원문\n").unwrap();
        let key = document.to_str().unwrap();
        let original = fs::read(&document).unwrap();
        let service = CommentService::new(FsCommentRepository::new(dir.path().join("comments")));
        let first = service.append(key, "의견 🌱\n두 번째 줄").unwrap();
        let second = service.append(key, "다음 의견").unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(fs::read(&document).unwrap(), original);
        assert!(service.append(key, "  ").is_err());
        assert!(service.append(key, &"x".repeat(10001)).is_err());
        let reopened = CommentService::new(FsCommentRepository::new(dir.path().join("comments")));
        assert_eq!(reopened.list(key).unwrap()[0].body, "의견 🌱\n두 번째 줄");
        assert_eq!(reopened.list(key).unwrap().len(), 2);
        assert!(reopened.list("different-document").unwrap().is_empty());
    }
    #[test]
    fn never_overwrites_corrupt_comment_data() {
        let dir = tempfile::tempdir().unwrap();
        let repo = FsCommentRepository::new(dir.path().into());
        fs::write(repo.path("stable"), "broken").unwrap();
        assert!(repo.append("stable", "new").is_err());
        assert_eq!(fs::read_to_string(repo.path("stable")).unwrap(), "broken");
    }
}
