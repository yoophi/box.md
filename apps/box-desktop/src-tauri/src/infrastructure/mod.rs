pub mod fs_document_repository;
pub mod fs_workspace_repository;
pub mod native_menu;
use crate::{domain::AppInfo, ports::AppInfoProvider};

pub struct NativeAppInfo;

impl AppInfoProvider for NativeAppInfo {
    fn app_info(&self) -> AppInfo {
        AppInfo {
            name: "box.md".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            platform: std::env::consts::OS.into(),
        }
    }
}

pub mod git_document_history;

pub mod fs_comment_repository;

pub mod document_identity;
pub mod document_scope_factory;
pub mod fs_connection_repository;
pub mod native_site_browser;
pub mod workbench_shell;
