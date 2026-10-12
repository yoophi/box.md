use crate::{application::AppInfoService, domain::AppInfo};

#[tauri::command]
pub fn get_app_info(service: tauri::State<'_, AppInfoService>) -> AppInfo {
    service.get()
}
