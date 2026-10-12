pub mod document_service;
pub mod workspace_service;
use crate::{domain::AppInfo, ports::AppInfoProvider};

pub struct AppInfoService {
    provider: Box<dyn AppInfoProvider>,
}

impl AppInfoService {
    pub fn new(provider: impl AppInfoProvider + 'static) -> Self {
        Self {
            provider: Box::new(provider),
        }
    }

    pub fn get(&self) -> AppInfo {
        self.provider.app_info()
    }
}

pub mod comment_service;
pub mod connection_service;
pub mod site_browser_service;
