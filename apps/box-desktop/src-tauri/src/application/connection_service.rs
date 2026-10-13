use crate::{
    domain::{connection::ConnectionSnapshot, document::DocumentError},
    ports::connection_repository::ConnectionRepository,
};

pub struct ConnectionService(Box<dyn ConnectionRepository>);
impl ConnectionService {
    pub(super) fn reserved(
        &self,
        created_id: Option<&str>,
        edit: impl FnOnce(&mut ConnectionSnapshot) -> Result<bool, DocumentError>,
        reserve: impl FnOnce(&serde_json::Value) -> Result<(), DocumentError>,
    ) -> Result<serde_json::Value, DocumentError> {
        let mut edit = Some(edit);
        let mut reserve = Some(reserve);
        let mut response = None;
        self.0.transact(&mut |state| {
            let changed = edit
                .take()
                .ok_or_else(|| DocumentError::new("internal", "연결 transaction 중복 실행"))?(
                state,
            )?;
            state.validate()?;
            let mut planned = serde_json::json!({"connections":state});
            if let Some(id) = created_id {
                let entity = state.entities.iter().find(|e| e.id == id).ok_or_else(|| {
                    DocumentError::new("internal", "생성한 연결 엔티티를 확인하지 못했습니다.")
                })?;
                planned["connection"] = serde_json::to_value(entity).expect("entity serialization");
            }
            reserve
                .take()
                .ok_or_else(|| DocumentError::new("internal", "연결 응답 중복 예약"))?(
                &planned,
            )?;
            response = Some(planned);
            Ok(changed)
        })?;
        response.ok_or_else(|| DocumentError::new("internal", "연결 응답을 준비하지 못했습니다."))
    }
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
