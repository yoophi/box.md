//! HTTP/protocol adapter only. The authenticated principal owns a pinned scope;
//! application admission, CAS, history and accepted workers own file operations.
mod schemas;
#[cfg(test)]
mod tests;

use crate::{
    application::{document_mutations::DocumentMutation, document_workspace::DocumentScope},
    domain::{document::DocumentError, scoped_document::DocumentRef},
};
use local_mcp_server::{principal, rmcp};
use rmcp::{
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerConfig, Tool,
    },
    service::RequestContext,
    ErrorData, RoleServer, ServerHandler,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{borrow::Cow, sync::Arc};

/// Credentials never live in this principal. gh-52 owns grant issuance/revocation.
#[derive(Clone)]
pub struct DocumentPrincipal(pub Arc<DocumentScope>);

#[derive(Clone, Default)]
pub struct DocumentMcpHandler;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Paging {
    cursor: Option<String>,
    limit: Option<usize>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Search {
    query: String,
    cursor: Option<String>,
    limit: Option<usize>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reference {
    document: DocumentRef,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConnectionFilter {
    document: Option<DocumentRef>,
}
fn invalid() -> DocumentError {
    DocumentError::new("invalidArguments", "도구 인자를 확인해주세요.")
}
fn parse<T: serde::de::DeserializeOwned>(args: Map<String, Value>) -> Result<T, DocumentError> {
    serde_json::from_value(Value::Object(args)).map_err(|_| invalid())
}
fn value(value: impl serde::Serialize) -> Result<Value, DocumentError> {
    serde_json::to_value(value)
        .map_err(|_| DocumentError::new("internal", "도구 결과를 처리하지 못했습니다."))
}

fn execute(
    scope: Arc<DocumentScope>,
    name: &str,
    mut args: Map<String, Value>,
) -> Result<Value, DocumentError> {
    match name {
        "list_connections" => {
            let p: ConnectionFilter = parse(args)?;
            scope.list_connections(p.document.as_ref())
        }
        "list_documents" => {
            let p: Paging = parse(args)?;
            value(scope.list_documents(p.cursor.as_deref(), p.limit)?)
        }
        "search_documents" => {
            let p: Search = parse(args)?;
            value(scope.search_documents(&p.query, p.cursor.as_deref(), p.limit)?)
        }
        "read_document" => {
            let p: Reference = parse(args)?;
            Ok(json!({"document":scope.read_document(&p.document)?}))
        }
        "get_document_metadata" => {
            let p: Reference = parse(args)?;
            value(scope.get_metadata(&p.document)?)
        }
        "get_document_links" => {
            let p: Reference = parse(args)?;
            scope.document_links(&p.document)
        }
        _ => {
            let request_id = args
                .remove("requestId")
                .and_then(|v| v.as_str().map(str::to_owned))
                .ok_or_else(invalid)?;
            let operation = match name {
                "create_document" => "create_document",
                "duplicate_document" => "duplicate_document",
                "update_document" => "update",
                "update_document_metadata" => "update_metadata",
                "delete_document" => "delete",
                "restore_document" => "restore",
                "create_connection" => "create_connection",
                "attach_connection" => "attach_connection",
                "detach_connection" => "detach_connection",
                _ => return Err(invalid()),
            };
            args.insert("operation".into(), json!(operation));
            let mutation: DocumentMutation = parse(args)?;
            let result = scope.submit_mutation(&request_id, mutation)?.wait();
            result.as_ref().as_ref().cloned().map_err(Clone::clone)
        }
    }
}

fn result(outcome: Result<Value, DocumentError>) -> CallToolResponse {
    match outcome {
        Ok(data) => CallToolResult::structured(json!({"ok":true,"data":data})).into(),
        // No adapter exception text, input, absolute path or credential in errors.
        Err(mut error) => {
            error.message = "도구 요청을 처리하지 못했습니다. 오류 코드를 확인해주세요.".into();
            CallToolResult::structured_error(json!({"ok":false,"error":error})).into()
        }
    }
}

impl ServerHandler for DocumentMcpHandler {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_protocol_version(ProtocolVersion::V_2025_11_25)
            .with_server_info(Implementation::new(
                "box-documents",
                env!("CARGO_PKG_VERSION"),
            ))
    }
    fn supported_protocol_versions(&self) -> Cow<'static, [ProtocolVersion]> {
        Cow::Borrowed(&[ProtocolVersion::V_2025_11_25])
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        schemas::tool(name)
    }
    async fn list_tools(
        &self,
        params: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        if params.is_some_and(|p| p.cursor.is_some()) {
            return Err(ErrorData::invalid_params(
                "Tool discovery has no continuation cursor",
                None,
            ));
        }
        Ok(ListToolsResult::with_all_items(
            schemas::NAMES
                .iter()
                .filter_map(|name| schemas::tool(name))
                .collect(),
        ))
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let Some(tool) = schemas::tool(&request.name) else {
            return Err(ErrorData::new(
                rmcp::model::ErrorCode::METHOD_NOT_FOUND,
                "Unknown tool",
                None,
            ));
        };
        let Some(scope) = principal::<DocumentPrincipal>(&context).map(|p| p.0.clone()) else {
            return Ok(result(Err(DocumentError::new(
                "scopeRevoked",
                "작업 범위를 사용할 수 없습니다.",
            ))));
        };
        let args = request.arguments.unwrap_or_default();
        if !schemas::valid(
            &Value::Object((*tool.input_schema).clone()),
            &Value::Object(args.clone()),
        ) {
            return Ok(result(Err(invalid())));
        }
        let name = request.name.to_string();
        // Once queued, this blocking operation owns its scope/ticket independent
        // of the HTTP response future. Never block rmcp's async reactor on I/O.
        let outcome = tokio::task::spawn_blocking(move || execute(scope, &name, args))
            .await
            .unwrap_or_else(|_| Err(DocumentError::new("internal", "도구 실행 오류")));
        Ok(result(outcome))
    }
}
