use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use workbench_desktop_client::{
    DesktopConnection, DesktopConnectionConfig, WindowConnection, WindowIdentity, EXIT_FLUSH_LIMIT,
};

/// Native shell owns connection credentials/lifecycle. ACP commands and events stay in HTTP/WS.
pub struct WorkbenchShell {
    connection: Arc<DesktopConnection>,
    incarnation: String,
    retired: AtomicBool,
}
impl WorkbenchShell {
    pub fn new(app_data: &Path) -> Self {
        let data_dir = std::env::var_os("BOX_WORKBENCH_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                app_data
                    .parent()
                    .unwrap_or(app_data)
                    .join("com.yoophi.agentic-workbench")
            });
        let executable = workbench_desktop_client::discover_server_executable(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../target"),
        );
        Self {
            connection: DesktopConnection::new(DesktopConnectionConfig {
                data_dir,
                executable,
                runtime: tauri::async_runtime::handle().inner().clone(),
                shutdown_limit: EXIT_FLUSH_LIMIT,
            }),
            incarnation: uuid::Uuid::new_v4().to_string(),
            retired: AtomicBool::new(false),
        }
    }
    pub async fn connection(&self, label: &str, origin: &str) -> Result<WindowConnection, String> {
        if label != "main" || self.retired.load(Ordering::SeqCst) {
            return Err("This window cannot request a Workbench connection.".into());
        }
        let result = self
            .connection
            .window_connection(WindowIdentity {
                label,
                incarnation: &self.incarnation,
                origin,
            })
            .await?;
        if self.retired.load(Ordering::SeqCst) {
            self.connection
                .retire_windows_for_exit(vec![("main".into(), self.incarnation.clone())]);
            self.connection.shutdown().await;
            return Err("The window closed while connecting.".into());
        }
        Ok(result)
    }
    pub fn retire(&self) {
        if !self.retired.swap(true, Ordering::SeqCst) {
            self.connection
                .retire_windows_for_exit(vec![("main".into(), self.incarnation.clone())]);
        }
    }
    pub async fn shutdown(&self) {
        self.retire();
        self.connection.shutdown().await;
    }
}

pub fn trusted_origin(url: &tauri::Url) -> Result<&'static str, String> {
    match (url.scheme(), url.host_str(), url.port()) {
        ("tauri", Some("localhost"), None) => Ok("tauri://localhost"),
        ("http", Some("tauri.localhost"), None) => Ok("http://tauri.localhost"),
        ("http", Some("localhost"), Some(1430)) => Ok("http://localhost:1430"),
        _ => Err("The current page cannot request a Workbench connection.".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_origin_check_accepts_only_box_pages() {
        for url in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "http://localhost:1430/",
        ] {
            assert!(trusted_origin(&tauri::Url::parse(url).unwrap()).is_ok());
        }
        for url in [
            "https://example.com/",
            "http://localhost.evil.example:1430/",
            "http://localhost:1420/",
            "http://localhost:1430@evil.example/",
        ] {
            assert!(trusted_origin(&tauri::Url::parse(url).unwrap()).is_err());
        }
    }
}
