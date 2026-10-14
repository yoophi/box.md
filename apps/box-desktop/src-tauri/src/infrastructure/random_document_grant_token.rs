use crate::{domain::document::DocumentError, ports::document_grant_token::DocumentGrantToken};

pub struct RandomDocumentGrantToken;
impl DocumentGrantToken for RandomDocumentGrantToken {
    fn generate(&self) -> Result<String, DocumentError> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|_| {
            DocumentError::new(
                "grantUnavailable",
                "문서 도구 자격 증명을 생성하지 못했습니다.",
            )
        })?;
        Ok(bytes
            .into_iter()
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }
}
