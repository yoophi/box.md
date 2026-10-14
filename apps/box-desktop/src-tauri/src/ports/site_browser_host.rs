use crate::domain::site_browser::{
    BrowserError, SiteAction, SiteAddress, SiteBounds, SiteBrowserSnapshot, SiteSelection,
};

/// Owns the remote page and its engine history independently of document/ACP state.
pub trait SiteBrowserHost: Send + Sync {
    fn open(
        &self,
        address: SiteAddress,
        bounds: SiteBounds,
    ) -> Result<SiteBrowserSnapshot, BrowserError>;
    fn layout(&self, bounds: Option<SiteBounds>) -> Result<SiteBrowserSnapshot, BrowserError>;
    fn action(&self, action: SiteAction) -> Result<SiteBrowserSnapshot, BrowserError>;
    fn snapshot(&self) -> Result<SiteBrowserSnapshot, BrowserError>;
    fn selection(&self) -> Result<SiteSelection, BrowserError>;
}
