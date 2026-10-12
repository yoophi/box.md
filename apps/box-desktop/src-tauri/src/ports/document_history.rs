use crate::domain::{document::DocumentError, history::HistoryEntry};

pub trait DocumentHistory: Send + Sync {
    fn record(&self, path: &str, content: &str) -> Result<(), DocumentError>;
    fn list(&self, path: &str) -> Result<Vec<HistoryEntry>, DocumentError>;
    fn read(&self, path: &str, id: &str) -> Result<String, DocumentError>;
}
