use crate::domain::AppInfo;

pub trait AppInfoProvider: Send + Sync {
    fn app_info(&self) -> AppInfo;
}
