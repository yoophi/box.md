use crate::domain::{connection::ConnectionSnapshot, document::DocumentError};

pub trait ConnectionRepository: Send + Sync {
    fn read(&self) -> Result<ConnectionSnapshot, DocumentError>;
    /// Apply once under an exclusive transaction; an error never commits a partial mutation.
    fn transact(
        &self,
        edit: &mut dyn FnMut(&mut ConnectionSnapshot) -> Result<bool, DocumentError>,
    ) -> Result<ConnectionSnapshot, DocumentError>;
}
