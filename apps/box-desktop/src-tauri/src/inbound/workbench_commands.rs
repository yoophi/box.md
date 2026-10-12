use crate::infrastructure::workbench_shell::{trusted_origin, WorkbenchShell};

#[tauri::command]
pub async fn get_workbench_connection(
    window: tauri::WebviewWindow,
    shell: tauri::State<'_, WorkbenchShell>,
) -> Result<workbench_desktop_client::WindowConnection, String> {
    let origin = trusted_origin(&window.url().map_err(|error| error.to_string())?)?;
    let connection = shell.connection(window.label(), origin).await?;
    if trusted_origin(&window.url().map_err(|error| error.to_string())?)? != origin {
        return Err("The page changed while connecting.".into());
    }
    Ok(connection)
}
