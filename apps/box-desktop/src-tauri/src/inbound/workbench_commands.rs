use crate::infrastructure::workbench_shell::{trusted_origin, WorkbenchShell};

#[tauri::command]
pub async fn get_workbench_connection(
    webview: tauri::Webview,
    shell: tauri::State<'_, WorkbenchShell>,
) -> Result<workbench_desktop_client::WindowConnection, String> {
    if webview.label() != "main" {
        return Err("Only the app page can request a Workbench connection.".into());
    }
    let origin = trusted_origin(&webview.url().map_err(|error| error.to_string())?)?;
    let connection = shell.connection(webview.label(), origin).await?;
    if trusted_origin(&webview.url().map_err(|error| error.to_string())?)? != origin {
        return Err("The page changed while connecting.".into());
    }
    Ok(connection)
}
