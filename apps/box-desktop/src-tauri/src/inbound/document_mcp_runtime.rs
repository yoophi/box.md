use super::document_mcp::{DocumentMcpHandler, DocumentPrincipal};
use crate::{
    application::{document_grants::DocumentGrants, document_workspace::DocumentScope},
    domain::document::DocumentError,
    infrastructure::random_document_grant_token::RandomDocumentGrantToken,
};
use local_mcp_server::{HostConfig, LocalMcpHost};
use serde::Serialize;
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;

type Starter = Arc<
    dyn Fn(
            Arc<DocumentGrants>,
        ) -> Pin<Box<dyn Future<Output = std::io::Result<LocalMcpHost>> + Send>>
        + Send
        + Sync,
>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpGrant {
    pub grant_id: String,
    pub generation: String,
    pub run_id: String,
    pub server: HttpServer,
}
#[derive(Serialize)]
pub struct HttpServer {
    #[serde(rename = "type")]
    pub transport: &'static str,
    pub name: &'static str,
    pub url: String,
    pub headers: Vec<HttpHeader>,
}
#[derive(Serialize)]
pub struct HttpHeader {
    pub name: &'static str,
    pub value: String,
}

pub struct DocumentMcpRuntime {
    pub grants: Arc<DocumentGrants>,
    host: Mutex<Option<LocalMcpHost>>,
    retired: AtomicBool,
    starter: Starter,
}
fn unavailable(code: &'static str) -> DocumentError {
    DocumentError::new(code, "문서 도구에 연결하지 못했습니다. 다시 시도해주세요.")
}
impl DocumentMcpRuntime {
    pub fn new() -> Self {
        Self {
            grants: Arc::new(DocumentGrants::new(RandomDocumentGrantToken)),
            host: Mutex::new(None),
            retired: AtomicBool::new(false),
            starter: Arc::new(|grants| {
                Box::pin(async move {
                    local_mcp_server::start(
                        || Ok(DocumentMcpHandler),
                        move |token| grants.resolve(token).map(DocumentPrincipal),
                        HostConfig::default(),
                    )
                    .await
                })
            }),
        }
    }
    pub async fn grant(
        &self,
        scope: Arc<DocumentScope>,
        run_id: &str,
    ) -> Result<McpGrant, DocumentError> {
        if self.retired.load(Ordering::Acquire) {
            return Err(unavailable("scopeRevoked"));
        }
        let mut host = self.host.lock().await;
        if self.retired.load(Ordering::Acquire) {
            return Err(unavailable("scopeRevoked"));
        }
        if host.is_none() {
            *host = Some(
                (self.starter)(self.grants.clone())
                    .await
                    .map_err(|_| unavailable("mcpUnavailable"))?,
            );
        }
        let grant = self.grants.issue(scope, run_id)?;
        Ok(McpGrant {
            grant_id: grant.id.clone(),
            generation: grant.generation.clone(),
            run_id: grant.run_id.clone(),
            server: HttpServer {
                transport: "http",
                name: "box-documents",
                url: host.as_ref().unwrap().endpoint().into(),
                headers: vec![HttpHeader {
                    name: "Authorization",
                    value: format!("Bearer {}", grant.credential),
                }],
            },
        })
    }
    pub fn retire(&self) {
        self.retired.store(true, Ordering::Release);
        self.grants.stop();
    }
    pub async fn stop_admission(&self) {
        self.retire();
        if let Some(host) = self.host.lock().await.as_ref() {
            host.stop_accepting();
        }
    }
    /// Application owner stops admission and drains DocumentWorkspace before shutdown.
    pub async fn shutdown(&self) -> Result<(), DocumentError> {
        self.stop_admission().await;
        if let Some(host) = self.host.lock().await.take() {
            host.shutdown()
                .await
                .map_err(|_| unavailable("mcpUnavailable"))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
