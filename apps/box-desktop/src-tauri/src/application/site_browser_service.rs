use crate::{
    domain::site_browser::{
        BrowserError, SiteAction, SiteAddress, SiteBounds, SiteBrowserSnapshot, SiteSelection,
    },
    ports::site_browser_host::SiteBrowserHost,
};

pub struct SiteBrowserService {
    host: Box<dyn SiteBrowserHost>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    struct Host(Arc<AtomicUsize>);
    impl SiteBrowserHost for Host {
        fn open(&self, _: SiteAddress, _: SiteBounds) -> Result<SiteBrowserSnapshot, BrowserError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(BrowserError::new("fixture", "native create failed"))
        }
        fn layout(&self, _: Option<SiteBounds>) -> Result<SiteBrowserSnapshot, BrowserError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(SiteBrowserSnapshot::default())
        }
        fn action(&self, _: SiteAction) -> Result<SiteBrowserSnapshot, BrowserError> {
            unreachable!()
        }
        fn snapshot(&self) -> Result<SiteBrowserSnapshot, BrowserError> {
            unreachable!()
        }
        fn selection(&self) -> Result<SiteSelection, BrowserError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            SiteSelection::new(
                "https://example.com/article",
                "문서 제목",
                "선택한 원문".into(),
            )
        }
    }
    #[test]
    fn invalid_input_cannot_create_or_reposition_the_native_page() {
        let calls = Arc::new(AtomicUsize::new(0));
        let service = SiteBrowserService::new(Host(calls.clone()));
        let bounds = SiteBounds {
            x: 0.0,
            y: 0.0,
            width: 500.0,
            height: 500.0,
            viewport_width: 500.0,
            viewport_height: 500.0,
        };
        assert_eq!(
            service.open("file:///etc/passwd", bounds).unwrap_err().code,
            "address"
        );
        assert_eq!(
            service
                .open(
                    "https://example.com",
                    SiteBounds {
                        width: 501.0,
                        ..bounds
                    }
                )
                .unwrap_err()
                .code,
            "bounds"
        );
        assert_eq!(
            service
                .layout(Some(SiteBounds { x: -1.0, ..bounds }))
                .unwrap_err()
                .code,
            "bounds"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(
            service
                .open("https://example.com", bounds)
                .unwrap_err()
                .code,
            "fixture"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(!service.layout(None).unwrap().open);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(
            service.selection().unwrap(),
            SiteSelection {
                url: "https://example.com/article".into(),
                title: "문서 제목".into(),
                text: "선택한 원문".into(),
            }
        );
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }
}
impl SiteBrowserService {
    pub fn new(host: impl SiteBrowserHost + 'static) -> Self {
        Self {
            host: Box::new(host),
        }
    }
    pub fn open(&self, url: &str, bounds: SiteBounds) -> Result<SiteBrowserSnapshot, BrowserError> {
        let address = SiteAddress::parse(url)?;
        bounds.validate()?;
        self.host.open(address, bounds)
    }
    pub fn layout(&self, bounds: Option<SiteBounds>) -> Result<SiteBrowserSnapshot, BrowserError> {
        if let Some(bounds) = bounds {
            bounds.validate()?;
        }
        self.host.layout(bounds)
    }
    pub fn action(&self, action: SiteAction) -> Result<SiteBrowserSnapshot, BrowserError> {
        self.host.action(action)
    }
    pub fn snapshot(&self) -> Result<SiteBrowserSnapshot, BrowserError> {
        self.host.snapshot()
    }
    pub fn selection(&self) -> Result<SiteSelection, BrowserError> {
        self.host.selection()
    }
}
