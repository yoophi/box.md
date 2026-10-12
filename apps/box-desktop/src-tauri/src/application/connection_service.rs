use crate::{
    domain::{connection::ConnectionSnapshot, document::DocumentError},
    ports::connection_repository::ConnectionRepository,
};

pub struct ConnectionService(Box<dyn ConnectionRepository>);
impl ConnectionService {
    pub fn new(repository: impl ConnectionRepository + 'static) -> Self {
        Self(Box::new(repository))
    }
    pub fn snapshot(&self) -> Result<ConnectionSnapshot, DocumentError> {
        self.0.read()
    }
    pub fn create(&self, name: &str) -> Result<ConnectionSnapshot, DocumentError> {
        let id = uuid::Uuid::new_v4().to_string();
        self.0.transact(&mut |state| state.create(id.clone(), name))
    }
    pub fn attach(
        &self,
        connection_id: &str,
        permalink: &str,
    ) -> Result<ConnectionSnapshot, DocumentError> {
        self.0
            .transact(&mut |state| state.attach(connection_id, permalink))
    }
    pub fn detach(
        &self,
        connection_id: &str,
        permalink: &str,
    ) -> Result<ConnectionSnapshot, DocumentError> {
        self.0
            .transact(&mut |state| state.detach(connection_id, permalink))
    }
}
