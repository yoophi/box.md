use super::document_workspace::DocumentScope;
use crate::{domain::document::DocumentError, ports::document_grant_token::DocumentGrantToken};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};

const MAX_RECORDS: usize = 1024;
type Key = (String, String);

// Deliberately no Debug/Serialize: only the trusted native adapter exposes credentials.
pub struct DocumentGrant {
    pub id: String,
    pub generation: String,
    pub run_id: String,
    pub credential: String,
    scope: Arc<DocumentScope>,
}
struct Record {
    scope: Weak<DocumentScope>,
    grant: Option<Arc<DocumentGrant>>,
}
#[derive(Default)]
struct State {
    stopped: bool,
    records: HashMap<Key, Record>,
    tokens: HashMap<String, Key>,
}
pub struct DocumentGrants {
    state: Mutex<State>,
    tokens: Box<dyn DocumentGrantToken>,
}
fn unavailable(code: &'static str) -> DocumentError {
    DocumentError::new(code, "문서 도구 연결을 사용할 수 없습니다.")
}
impl DocumentGrants {
    pub fn new(tokens: impl DocumentGrantToken + 'static) -> Self {
        Self {
            state: Mutex::new(State::default()),
            tokens: Box::new(tokens),
        }
    }
    pub fn issue(
        &self,
        scope: Arc<DocumentScope>,
        run_id: &str,
    ) -> Result<Arc<DocumentGrant>, DocumentError> {
        if run_id.trim().is_empty() || run_id.len() > 128 || run_id.chars().any(char::is_control) {
            return Err(unavailable("invalidArguments"));
        }
        let mut state = self.state.lock().map_err(|_| unavailable("internal"))?;
        Self::prune(&mut state);
        if state.stopped || !scope.is_active() {
            return Err(unavailable("scopeRevoked"));
        }
        let key = (scope.generation.clone(), run_id.into());
        if let Some(record) = state.records.get(&key) {
            return record
                .grant
                .clone()
                .ok_or_else(|| unavailable("grantRevoked"));
        }
        if state.records.len() >= MAX_RECORDS {
            return Err(unavailable("grantCapacity"));
        }
        for _ in 0..32 {
            let credential = self
                .tokens
                .generate()
                .map_err(|_| unavailable("grantUnavailable"))?;
            if credential.len() != 64
                || !credential
                    .bytes()
                    .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
            {
                return Err(unavailable("grantUnavailable"));
            }
            if state.tokens.contains_key(&credential) {
                continue;
            }
            let grant = Arc::new(DocumentGrant {
                id: uuid::Uuid::new_v4().to_string(),
                generation: scope.generation.clone(),
                run_id: run_id.into(),
                credential: credential.clone(),
                scope,
            });
            state.tokens.insert(credential, key.clone());
            state.records.insert(
                key,
                Record {
                    scope: Arc::downgrade(&grant.scope),
                    grant: Some(grant.clone()),
                },
            );
            return Ok(grant);
        }
        Err(unavailable("grantUnavailable"))
    }
    pub fn resolve(&self, credential: &str) -> Option<Arc<DocumentScope>> {
        let state = self.state.lock().ok()?;
        if state.stopped {
            return None;
        }
        let key = state.tokens.get(credential)?;
        let grant = state.records.get(key)?.grant.as_ref()?;
        grant.scope.is_active().then(|| grant.scope.clone())
    }
    pub fn revoke(&self, grant_id: &str) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let key = state.records.iter().find_map(|(key, grant)| {
            grant
                .grant
                .as_ref()
                .filter(|g| g.id == grant_id)
                .map(|_| key.clone())
        });
        if let Some(key) = key {
            if let Some(grant) = state
                .records
                .get_mut(&key)
                .and_then(|record| record.grant.take())
            {
                state.tokens.remove(&grant.credential);
            }
        }
    }
    pub fn prune_inactive(&self) {
        Self::prune(&mut self.state.lock().unwrap_or_else(|e| e.into_inner()));
    }
    fn prune(state: &mut State) {
        let expired: Vec<_> = state
            .records
            .iter()
            .filter(|(_, record)| {
                record
                    .scope
                    .upgrade()
                    .is_none_or(|scope| !scope.is_active())
            })
            .map(|(key, _)| key.clone())
            .collect();
        for key in expired {
            if let Some(grant) = state.records.remove(&key).and_then(|record| record.grant) {
                state.tokens.remove(&grant.credential);
            }
        }
    }

    pub fn stop(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.stopped = true;
        state.tokens.clear();
        state.records.clear();
    }
}
