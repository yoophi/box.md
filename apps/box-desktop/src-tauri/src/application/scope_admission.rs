use crate::domain::document::DocumentError;
use std::sync::{Arc, Condvar, Mutex};

struct State {
    accepting: bool,
    pending: usize,
}

/// The permit belongs to the accepted operation, rather than its response.
/// No service code executes while the admission mutex is held.
pub(super) struct ScopeAdmission {
    state: Mutex<State>,
    drained: Condvar,
}

pub(super) struct AdmissionPermit(Arc<ScopeAdmission>);

pub(super) fn revoked() -> DocumentError {
    DocumentError::new("scopeRevoked", "이 작업 루트의 사용이 종료되었습니다.")
}

impl ScopeAdmission {
    pub(super) fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                accepting: true,
                pending: 0,
            }),
            drained: Condvar::new(),
        })
    }

    pub(super) fn admit(self: &Arc<Self>) -> Result<AdmissionPermit, DocumentError> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.accepting {
            return Err(revoked());
        }
        state.pending += 1;
        Ok(AdmissionPermit(self.clone()))
    }

    pub(super) fn is_active(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.accepting)
            .unwrap_or(false)
    }

    pub(super) fn stop_accepting(&self) {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .accepting = false;
        self.drained.notify_all();
    }

    pub(super) fn drain(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        while state.pending != 0 {
            state = self.drained.wait(state).unwrap_or_else(|e| e.into_inner());
        }
    }

    #[cfg(test)]
    pub(super) fn wait_until_stopped(&self) {
        let mut state = self.state.lock().unwrap();
        while state.accepting {
            state = self.drained.wait(state).unwrap();
        }
    }
}

impl Drop for AdmissionPermit {
    fn drop(&mut self) {
        let mut state = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        state.pending -= 1;
        if state.pending == 0 {
            self.0.drained.notify_all();
        }
    }
}
