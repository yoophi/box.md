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
