pub mod document_commands;
pub mod workspace_commands;
use crate::{application::AppInfoService, domain::AppInfo};

#[tauri::command]
pub fn get_app_info(service: tauri::State<'_, AppInfoService>) -> AppInfo {
    service.get()
}

pub mod comment_commands;

pub mod connection_commands;
pub mod site_browser_commands;
pub mod workbench_commands;
