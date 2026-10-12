use crate::{
    domain::{comment::DocumentComment, document::DocumentError},
    ports::comment_repository::CommentRepository,
};
use std::sync::Mutex;

pub struct CommentService(Mutex<Box<dyn CommentRepository>>);
impl CommentService {
    pub fn new(repository: impl CommentRepository + 'static) -> Self {
        Self(Mutex::new(Box::new(repository)))
    }
    fn validate_key(key: &str) -> Result<(), DocumentError> {
        if key.is_empty() || key.len() > 8192 {
            return Err(DocumentError::new(
                "comment",
                "댓글을 연결할 문서가 올바르지 않습니다.",
            ));
        }
        Ok(())
    }
    pub fn list(&self, key: &str) -> Result<Vec<DocumentComment>, DocumentError> {
        Self::validate_key(key)?;
        self.0
            .lock()
            .map_err(|_| DocumentError::new("comment", "댓글 저장소 잠금 오류"))?
            .list(key)
    }
    pub fn append(&self, key: &str, body: &str) -> Result<DocumentComment, DocumentError> {
        Self::validate_key(key)?;
        if body.trim().is_empty() || body.chars().count() > 10000 {
            return Err(DocumentError::new(
                "comment",
                "댓글을 1~10,000자로 입력해주세요.",
            ));
        }
        self.0
            .lock()
            .map_err(|_| DocumentError::new("comment", "댓글 저장소 잠금 오류"))?
            .append(key, body)
    }
}
