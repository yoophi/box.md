pub mod document_repository;
pub mod workspace_repository;
use crate::domain::AppInfo;

pub trait AppInfoProvider: Send + Sync {
    fn app_info(&self) -> AppInfo;
}

pub mod document_history;
