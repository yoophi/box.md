use super::document_mcp_runtime::{DocumentMcpRuntime, McpGrant};
use crate::{
    application::document_workspace::DocumentWorkspace, domain::document::DocumentError,
    infrastructure::workbench_shell::trusted_origin,
};

fn authorize<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
) -> Result<&'static str, DocumentError> {
    if webview.label() != "main" {
        return Err(denied());
    }
    trusted_origin(&webview.url().map_err(|_| denied())?).map_err(|_| denied())
}
fn denied() -> DocumentError {
    DocumentError::new("unauthorized", "앱 화면에서 문서 도구를 연결해주세요.")
}
fn revoked() -> DocumentError {
    DocumentError::new(
        "scopeRevoked",
        "작업 디렉터리가 변경되었습니다. 다시 연결해주세요.",
    )
}

#[tauri::command]
pub async fn get_document_mcp_grant<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    generation: String,
    run_id: String,
    documents: tauri::State<'_, DocumentWorkspace>,
    mcp: tauri::State<'_, DocumentMcpRuntime>,
) -> Result<McpGrant, DocumentError> {
    let origin = authorize(&webview)?;
    let scope = documents.scope()?;
    if scope.generation != generation {
        return Err(revoked());
    }
    let grant = mcp.grant(scope, &run_id).await?;
    let current = documents.scope();
    if authorize(&webview).ok() != Some(origin)
        || current.as_ref().is_err()
        || current
            .as_ref()
            .is_ok_and(|scope| scope.generation != generation || !scope.is_active())
    {
        mcp.grants.revoke(&grant.grant_id);
        return Err(revoked());
    }
    Ok(grant)
}

#[tauri::command]
pub fn revoke_document_mcp_grant<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    grant_id: String,
    mcp: tauri::State<'_, DocumentMcpRuntime>,
) -> Result<(), DocumentError> {
    authorize(&webview)?;
    mcp.grants.revoke(&grant_id);
    Ok(())
}
