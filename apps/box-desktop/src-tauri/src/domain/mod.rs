pub mod document;
pub mod scoped_document;
pub mod workspace;
use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
}

pub mod history;

pub mod comment;
pub mod connection;
pub mod site_browser;
