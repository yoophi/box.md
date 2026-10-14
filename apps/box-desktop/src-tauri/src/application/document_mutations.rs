use super::{document_service::DocumentService, scope_admission::AdmissionPermit};
use crate::domain::{document::DocumentError, scoped_document::DocumentRef};
use crate::{
    domain::document_change::{ChangedDocument, DocumentChange, DocumentChangeKind},
    ports::document_change_sink::DocumentChangeSink,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{self, Write},
    sync::{Arc, Condvar, Mutex},
};

const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
const ENTRY_BYTES: usize = 4096;

struct JsonSize {
    bytes: usize,
    limit: usize,
}
impl Write for JsonSize {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let total = self
            .bytes
            .checked_add(bytes.len())
            .filter(|n| *n <= self.limit)
            .ok_or_else(|| io::Error::other("response capacity"))?;
        self.bytes = total;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn json_size(value: &Value, limit: usize) -> Result<usize, DocumentError> {
    let mut counter = JsonSize { bytes: 0, limit };
    serde_json::to_writer(&mut counter, value).map_err(|_| capacity())?;
    Ok(counter.bytes)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DocumentMutation {
    CreateDocument {
        content: String,
    },
    DuplicateDocument {
        document: DocumentRef,
        expected_revision: String,
        #[serde(default)]
        content: Option<String>,
    },
    // Legacy path-directed construction is internal; public creation owns its ID/path.
    #[serde(skip_deserializing)]
    Create {
        path: String,
        content: String,
    },
    Update {
        document: DocumentRef,
        content: String,
        expected_revision: String,
    },
    UpdateMetadata {
        document: DocumentRef,
        patch: Map<String, Value>,
        remove: Vec<String>,
        expected_revision: String,
    },
    Delete {
        document: DocumentRef,
        expected_revision: String,
    },
    Restore {
        trash_id: String,
    },
    CreateConnection {
        name: String,
    },
    AttachConnection {
        connection_id: String,
        permalink: String,
    },
    DetachConnection {
        connection_id: String,
        permalink: String,
    },
}

fn invalid() -> DocumentError {
    DocumentError::new(
        "invalidArguments",
        "문서 변경 요청의 인자 또는 크기가 올바르지 않습니다.",
    )
}
fn capacity() -> DocumentError {
    DocumentError::new(
        "requestCapacityExceeded",
        "이 작업 루트의 요청 보관 한도를 초과했습니다.",
    )
}
fn validate_reference(reference: &DocumentRef) -> Result<(), DocumentError> {
    match reference {
        DocumentRef::Path { path } => box_document_store::validate_relative_document_path(path),
        DocumentRef::Permalink { permalink }
            if !permalink.is_empty()
                && permalink.len() <= MAX_INPUT_BYTES
                && !permalink.contains(['\r', '\n']) =>
        {
            Ok(())
        }
        _ => Err(invalid()),
    }
}
fn validate_json(
    value: &Value,
    depth: usize,
    nodes: &mut usize,
    bytes: &mut usize,
) -> Result<(), DocumentError> {
    *nodes += 1;
    if depth > 128 || *nodes > 100_000 {
        return Err(invalid());
    }
    match value {
        Value::String(s) => *bytes = bytes.saturating_add(s.len()),
        Value::Object(map) => {
            for (key, child) in map {
                *bytes = bytes.saturating_add(key.len());
                validate_json(child, depth + 1, nodes, bytes)?;
            }
        }
        Value::Array(array) => {
            for child in array {
                validate_json(child, depth + 1, nodes, bytes)?;
            }
        }
        _ => (),
    }
    if *bytes > MAX_INPUT_BYTES {
        return Err(invalid());
    }
    Ok(())
}
fn canonical(value: &Value, output: &mut Sha256) {
    match value {
        Value::Object(map) => {
            output.update(b"{");
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            for key in keys {
                output.update(serde_json::to_vec(key).expect("string serialization"));
                output.update(b":");
                canonical(&map[key], output);
                output.update(b",");
            }
            output.update(b"}");
        }
        Value::Array(array) => {
            output.update(b"[");
            for item in array {
                canonical(item, output);
                output.update(b",");
            }
            output.update(b"]");
        }
        _ => output.update(serde_json::to_vec(value).expect("JSON serialization")),
    }
}
impl DocumentMutation {
    fn fingerprint(&self) -> Result<[u8; 32], DocumentError> {
        let revision = match self {
            Self::CreateConnection { name } => {
                if name.len() > 8192 {
                    return Err(invalid());
                }
                None
            }
            Self::AttachConnection {
                connection_id,
                permalink,
            }
            | Self::DetachConnection {
                connection_id,
                permalink,
            } => {
                if [connection_id, permalink]
                    .iter()
                    .any(|s| s.trim().is_empty() || s.len() > 8192 || s.contains(['\r', '\n']))
                {
                    return Err(invalid());
                }
                None
            }
            Self::CreateDocument { content } => {
                if content.len() > MAX_INPUT_BYTES {
                    return Err(invalid());
                }
                None
            }
            Self::DuplicateDocument {
                document,
                expected_revision,
                content,
            } => {
                validate_reference(document)?;
                if content.as_ref().is_some_and(|c| c.len() > MAX_INPUT_BYTES) {
                    return Err(invalid());
                }
                Some(expected_revision)
            }
            Self::Create { path, content } => {
                box_document_store::validate_relative_document_path(path)?;
                if content.len() > MAX_INPUT_BYTES {
                    return Err(invalid());
                }
                None
            }
            Self::Update {
                document,
                content,
                expected_revision,
            } => {
                validate_reference(document)?;
                if content.len() > MAX_INPUT_BYTES {
                    return Err(invalid());
                }
                Some(expected_revision)
            }
            Self::UpdateMetadata {
                document,
                patch,
                remove,
                expected_revision,
            } => {
                validate_reference(document)?;
                if remove.len() > 100_000
                    || remove
                        .iter()
                        .any(|key| key.is_empty() || patch.contains_key(key))
                {
                    return Err(invalid());
                }
                let mut nodes = 0;
                let mut bytes: usize = 0;
                for (key, value) in patch {
                    bytes = bytes.saturating_add(key.len());
                    validate_json(value, 1, &mut nodes, &mut bytes)?;
                }
                for key in remove {
                    bytes = bytes.saturating_add(key.len());
                }
                if bytes > MAX_INPUT_BYTES {
                    return Err(invalid());
                }
                Some(expected_revision)
            }
            Self::Delete {
                document,
                expected_revision,
            } => {
                validate_reference(document)?;
                Some(expected_revision)
            }
            Self::Restore { trash_id } => {
                if uuid::Uuid::parse_str(trash_id).is_err() {
                    return Err(invalid());
                }
                None
            }
        };
        if revision
            .is_some_and(|r| r.is_empty() || r.len() > 128 || r.chars().any(char::is_control))
        {
            return Err(invalid());
        }
        let value = serde_json::to_value(self).map_err(|_| invalid())?;
        let mut hash = Sha256::new();
        canonical(&value, &mut hash);
        Ok(hash.finalize().into())
    }
}

pub type MutationResult = Result<Value, DocumentError>;
struct Completion {
    value: Mutex<Option<Arc<MutationResult>>>,
    ready: Condvar,
}
impl Completion {
    fn finish(&self, value: MutationResult) {
        *self.value.lock().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(value));
        self.ready.notify_all();
    }
}

/// Dropping this response handle does not cancel the accepted mutation.
#[derive(Clone)]
pub struct MutationTicket(Arc<Completion>);
impl MutationTicket {
    /// HTTP adapters should wait on their blocking executor, not the async reactor.
    pub fn wait(&self) -> Arc<MutationResult> {
        let mut value = self.0.value.lock().unwrap_or_else(|e| e.into_inner());
        while value.is_none() {
            value = self.0.ready.wait(value).unwrap_or_else(|e| e.into_inner());
        }
        value.as_ref().unwrap().clone()
    }
    pub fn try_result(&self) -> Option<Arc<MutationResult>> {
        self.0
            .value
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

struct Entry {
    fingerprint: [u8; 32],
    completion: Arc<Completion>,
    bytes: usize,
}
struct Journal {
    entries: HashMap<String, Entry>,
    bytes: usize,
}
pub(super) struct MutationRegistry {
    journal: Mutex<Journal>,
    max_requests: usize,
    max_bytes: usize,
    changes: Option<(String, Arc<dyn DocumentChangeSink>)>,
}
impl MutationRegistry {
    pub(super) fn new() -> Arc<Self> {
        Self::with_limits(128, 64 * 1024 * 1024)
    }
    pub(super) fn with_changes(generation: String, sink: Arc<dyn DocumentChangeSink>) -> Arc<Self> {
        let mut registry = Self::new();
        Arc::get_mut(&mut registry)
            .expect("new registry is uniquely owned")
            .changes = Some((generation, sink));
        registry
    }
    pub(super) fn with_limits(max_requests: usize, max_bytes: usize) -> Arc<Self> {
        Arc::new(Self {
            journal: Mutex::new(Journal {
                entries: HashMap::new(),
                bytes: 0,
            }),
            max_requests,
            max_bytes,
            changes: None,
        })
    }
    pub(super) fn submit(
        self: &Arc<Self>,
        request_id: &str,
        mutation: DocumentMutation,
        service: Arc<DocumentService>,
        permit: AdmissionPermit,
    ) -> Result<MutationTicket, DocumentError> {
        if request_id.trim().is_empty()
            || request_id.len() > 256
            || request_id.chars().any(char::is_control)
        {
            return Err(invalid());
        }
        let fingerprint = mutation.fingerprint()?;
        let mut journal = self.journal.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = journal.entries.get(request_id) {
            if entry.fingerprint != fingerprint {
                return Err(DocumentError::new(
                    "requestIdConflict",
                    "같은 요청 ID에 다른 인자를 사용할 수 없습니다.",
                ));
            }
            return Ok(MutationTicket(entry.completion.clone()));
        }
        let bytes = ENTRY_BYTES + request_id.len();
        if journal.entries.len() >= self.max_requests
            || journal.bytes.saturating_add(bytes) > self.max_bytes
        {
            return Err(capacity());
        }
        let completion = Arc::new(Completion {
            value: Mutex::new(None),
            ready: Condvar::new(),
        });
        journal.bytes += bytes;
        journal.entries.insert(
            request_id.into(),
            Entry {
                fingerprint,
                completion: completion.clone(),
                bytes,
            },
        );
        drop(journal);
        let registry = self.clone();
        let id = request_id.to_owned();
        let response = completion.clone();
        let permit = Arc::new(permit);
        let worker_permit = permit.clone();
        let change_kind = match &mutation {
            DocumentMutation::CreateConnection { .. }
            | DocumentMutation::AttachConnection { .. }
            | DocumentMutation::DetachConnection { .. } => DocumentChangeKind::ConnectionsChanged,
            DocumentMutation::Delete { .. } => DocumentChangeKind::DocumentDeleted,
            _ => DocumentChangeKind::DocumentChanged,
        };
        // The worker, journal and permit outlive the response ticket. No scope
        // reference cycle is formed; a worker owns the fixed service and gate.
        let spawn = std::thread::Builder::new()
            .name("box-document-mutation".into())
            .spawn(move || {
                let _permit = worker_permit;
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    service.execute_mutation(mutation, |planned| registry.reserve(&id, planned))
                }))
                .unwrap_or_else(|_| {
                    Err(DocumentError::new(
                        "internal",
                        "문서 요청 실행을 완료하지 못했습니다.",
                    ))
                });
                // Keep errors bounded and do not publish adapter exception details.
                let result = result.map_err(|mut error| {
                    error.message =
                        "문서 요청을 처리하지 못했습니다. 오류 코드를 확인해주세요.".into();
                    error
                });
                registry.complete(&id, &result);
                if let Ok(value) = &result {
                    registry.publish_change(change_kind, value);
                }
                response.finish(result);
            });
        if spawn.is_err() {
            let result = Err(DocumentError::new(
                "internal",
                "문서 요청 실행을 시작하지 못했습니다.",
            ));
            self.complete(request_id, &result);
            completion.finish(result);
        }
        Ok(MutationTicket(completion))
    }
    fn publish_change(&self, kind: DocumentChangeKind, value: &Value) {
        let Some((generation, sink)) = &self.changes else {
            return;
        };
        let document = if kind == DocumentChangeKind::ConnectionsChanged {
            None
        } else {
            let key = if kind == DocumentChangeKind::DocumentDeleted {
                "deleted"
            } else {
                "document"
            };
            let Some(path) = value[key]["path"].as_str() else {
                return;
            };
            let Some(revision) = value[key]["revision"].as_str() else {
                return;
            };
            if box_document_store::validate_relative_document_path(path).is_err() {
                return;
            }
            Some(ChangedDocument {
                path: path.into(),
                revision: revision.into(),
            })
        };
        let event = DocumentChange {
            generation: generation.clone(),
            kind,
            document,
        };
        // A renderer/sink failure cannot undo a completed filesystem mutation or strand its ticket.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| sink.publish(event)));
    }
    fn reserve(&self, id: &str, planned: &Value) -> Result<(), DocumentError> {
        // Count the serialized response without allocating another full JSON
        // string; stop counting as soon as the scope's byte limit is exceeded.
        let size = json_size(planned, self.max_bytes)?.saturating_add(ENTRY_BYTES + id.len());
        let mut journal = self.journal.lock().unwrap_or_else(|e| e.into_inner());
        let old = journal.entries[id].bytes;
        let total = journal.bytes.saturating_sub(old).saturating_add(size);
        if total > self.max_bytes {
            return Err(capacity());
        }
        journal.bytes = total;
        journal.entries.get_mut(id).unwrap().bytes = size;
        Ok(())
    }
    fn complete(&self, id: &str, result: &MutationResult) {
        let size = match result {
            Ok(value) => json_size(value, usize::MAX).expect("JSON size counting cannot fail"),
            Err(_) => 0,
        } + ENTRY_BYTES
            + id.len();
        let mut journal = self.journal.lock().unwrap_or_else(|e| e.into_inner());
        let old = journal.entries[id].bytes;
        // Successful output is the preallocated response with a shorter/null
        // history warning and fixed-size revision/trash ID substitutions.
        journal.bytes = journal.bytes - old + size;
        journal.entries.get_mut(id).unwrap().bytes = size;
    }
}
