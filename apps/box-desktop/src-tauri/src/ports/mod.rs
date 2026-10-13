pub mod document_repository;
pub mod workspace_repository;
use crate::domain::AppInfo;

pub trait AppInfoProvider: Send + Sync {
    fn app_info(&self) -> AppInfo;
}

pub mod document_history;
pub mod document_identity;

pub mod comment_repository;
pub mod connection_repository;
pub mod document_scope_factory;
pub mod site_browser_host;
