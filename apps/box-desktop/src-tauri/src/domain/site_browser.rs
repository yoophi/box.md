use serde::{Deserialize, Serialize};
use url::Url;

pub const MAX_SITE_SELECTION_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
pub struct BrowserError {
    pub code: &'static str,
    pub message: String,
}
impl BrowserError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub struct SiteAddress(Url);
impl SiteAddress {
    pub fn parse(input: &str) -> Result<Self, BrowserError> {
        let input = input.trim();
        if input.is_empty()
            || input.len() > 8192
            || input.contains('\\')
            || input.chars().any(char::is_control)
        {
            return Err(BrowserError::new("address", "사이트 주소를 확인해주세요."));
        }
        let address = if input.contains("://") {
            input.to_owned()
        } else {
            // Bare hostnames default to HTTPS; executable addresses are never passed to the engine.
            if input.starts_with('/') || input.contains('\\') {
                return Err(BrowserError::new(
                    "address",
                    "HTTP 또는 HTTPS 사이트 주소를 입력해주세요.",
                ));
            }
            format!("https://{input}")
        };
        let url = Url::parse(&address)
            .map_err(|_| BrowserError::new("address", "사이트 주소를 확인해주세요."))?;
        if !Self::allowed(&url) {
            return Err(BrowserError::new(
                "address",
                "로그인 정보가 포함되지 않은 HTTP 또는 HTTPS 주소를 입력해주세요.",
            ));
        }
        Ok(Self(url))
    }
    pub fn allowed(url: &Url) -> bool {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
    }
    pub fn url(&self) -> &Url {
        &self.0
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteSelection {
    pub url: String,
    pub title: String,
    pub text: String,
}
impl SiteSelection {
    pub fn new(url: &str, title: &str, text: String) -> Result<Self, BrowserError> {
        let address = SiteAddress::parse(url)?;
        if text.trim().is_empty() {
            return Err(BrowserError::new(
                "selectionEmpty",
                "사이트에서 저장할 텍스트를 선택해주세요.",
            ));
        }
        if text.len() > MAX_SITE_SELECTION_BYTES {
            return Err(BrowserError::new(
                "selectionTooLarge",
                "선택 영역이 너무 큽니다. 더 작은 영역을 선택해주세요.",
            ));
        }
        let title = title.replace(['\r', '\n'], " ").trim().to_owned();
        if title.chars().count() > 512 {
            return Err(BrowserError::new(
                "selectionTitle",
                "사이트 제목이 너무 깁니다.",
            ));
        }
        Ok(Self {
            url: address.url().to_string(),
            title,
            text,
        })
    }
}

impl SiteBrowserSnapshot {
    pub fn navigation(&mut self, url: &Url) {
        self.url = Some(url.to_string());
        self.title.clear();
        self.loading = true;
    }
    pub fn finished(&mut self, url: &Url) {
        // A late completion of the prior page cannot finish the current navigation.
        if self.url.as_deref() == Some(url.as_str()) {
            self.loading = false;
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
}
impl SiteBounds {
    pub fn validate(&self) -> Result<(), BrowserError> {
        let numbers = [
            self.x,
            self.y,
            self.width,
            self.height,
            self.viewport_width,
            self.viewport_height,
        ];
        if numbers.iter().any(|n| !n.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
            || self.viewport_width <= 0.0
            || self.viewport_height <= 0.0
            || self.x + self.width > self.viewport_width + 0.5
            || self.y + self.height > self.viewport_height + 0.5
        {
            return Err(BrowserError::new(
                "bounds",
                "브라우저 표시 영역을 확인해주세요.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SiteAction {
    Back,
    Forward,
    Reload,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBrowserSnapshot {
    pub open: bool,
    pub visible: bool,
    pub url: Option<String>,
    pub title: String,
    pub loading: bool,
    /// None means the platform does not expose history availability through this adapter.
    pub can_go_back: Option<bool>,
    pub can_go_forward: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_web_addresses_and_preserves_query_fragment_and_unicode() {
        for (input, expected) in [
            (
                " example.com/docs?q=a%20b#section ",
                "https://example.com/docs?q=a%20b#section",
            ),
            ("http://127.0.0.1:3210/page", "http://127.0.0.1:3210/page"),
            ("HTTPS://EXAMPLE.COM/", "https://example.com/"),
            ("example.com/한글", "https://example.com/%ED%95%9C%EA%B8%80"),
            ("localhost:3210", "https://localhost:3210/"),
        ] {
            assert_eq!(SiteAddress::parse(input).unwrap().url().as_str(), expected);
        }
    }
    #[test]
    fn rejects_executable_local_and_credential_addresses() {
        for input in [
            "",
            "javascript:alert(1)",
            "data:text/html,hello",
            "file:///etc/passwd",
            "tauri://localhost/",
            "boxmd://document?permalink=x",
            "ftp://example.com",
            "https://user:secret@example.com",
            "//example.com",
            "http://",
            "https://ex\nample.com",
            "https://example.com\\@other.example",
        ] {
            assert!(SiteAddress::parse(input).is_err(), "{input}");
        }
        assert!(SiteAddress::parse(&"x".repeat(8193)).is_err());
    }
    #[test]
    fn rejects_nonfinite_empty_and_outside_viewport_bounds() {
        let valid = SiteBounds {
            x: 220.0,
            y: 96.0,
            width: 880.0,
            height: 664.0,
            viewport_width: 1100.0,
            viewport_height: 760.0,
        };
        valid.validate().unwrap();
        for invalid in [
            SiteBounds { x: -1.0, ..valid },
            SiteBounds {
                width: 0.0,
                ..valid
            },
            SiteBounds {
                height: f64::NAN,
                ..valid
            },
            SiteBounds {
                viewport_width: f64::INFINITY,
                ..valid
            },
            SiteBounds { x: 221.0, ..valid },
            SiteBounds { y: 97.0, ..valid },
        ] {
            assert!(invalid.validate().is_err());
        }
    }
    #[test]
    fn late_page_completion_cannot_finish_a_new_navigation() {
        let one = Url::parse("https://example.com/one").unwrap();
        let two = Url::parse("https://example.com/two").unwrap();
        let mut state = SiteBrowserSnapshot::default();
        state.navigation(&one);
        state.title = "이전 페이지".into();
        state.navigation(&two);
        state.finished(&one);
        assert!(state.loading);
        assert_eq!(state.url.as_deref(), Some(two.as_str()));
        assert!(state.title.is_empty());
        state.finished(&two);
        assert!(!state.loading);
    }

    #[test]
    fn validates_selection_without_changing_its_text() {
        let text = " 첫 줄\r\n둘째 줄 🌱  ".to_owned();
        let selection = SiteSelection::new(
            " HTTPS://EXAMPLE.COM/article?q=1#part ",
            "  문서\r\n제목  ",
            text.clone(),
        )
        .unwrap();
        assert_eq!(selection.url, "https://example.com/article?q=1#part");
        assert_eq!(selection.title, "문서  제목");
        assert_eq!(selection.text, text);
    }

    #[test]
    fn rejects_empty_oversized_or_untrusted_selection_fields() {
        assert_eq!(
            SiteSelection::new("https://example.com", "title", " \n\t".into())
                .unwrap_err()
                .code,
            "selectionEmpty"
        );
        assert_eq!(
            SiteSelection::new(
                "https://example.com",
                "title",
                "가".repeat(MAX_SITE_SELECTION_BYTES / 3 + 1),
            )
            .unwrap_err()
            .code,
            "selectionTooLarge"
        );
        assert_eq!(
            SiteSelection::new("file:///private", "title", "selected".into())
                .unwrap_err()
                .code,
            "address"
        );
        assert_eq!(
            SiteSelection::new("https://example.com", &"가".repeat(513), "selected".into())
                .unwrap_err()
                .code,
            "selectionTitle"
        );
    }
}
