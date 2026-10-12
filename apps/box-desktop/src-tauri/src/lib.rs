mod application;
mod domain;
mod inbound;
mod infrastructure;
mod ports;

pub fn run() {
    let service = application::AppInfoService::new(infrastructure::NativeAppInfo);
    tauri::Builder::default()
        .manage(service)
        .invoke_handler(tauri::generate_handler![inbound::get_app_info])
        .run(tauri::generate_context!())
        .expect("error while running box.md");
}
