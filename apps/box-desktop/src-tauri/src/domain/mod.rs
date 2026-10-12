use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
}
