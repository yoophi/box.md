use crate::domain::document_change::DocumentChange;

pub trait DocumentChangeSink: Send + Sync {
    fn publish(&self, change: DocumentChange);
}
impl<F: Fn(DocumentChange) + Send + Sync> DocumentChangeSink for F {
    fn publish(&self, change: DocumentChange) {
        self(change);
    }
}
