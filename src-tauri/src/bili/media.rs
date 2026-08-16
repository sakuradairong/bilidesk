use super::client::BiliClient;
use super::error::BiliResult;
use tauri::http::{header::CONTENT_TYPE, Response, StatusCode};

/// 1x1 #0c0e13 PNG so a failed fetch still paints an opaque pixel.
const PLACEHOLDER_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0x18, 0x11, 0x11, 0x00,
    0x00, 0x6F, 0x00, 0x0F, 0x00, 0x6C, 0x8E, 0x9D, 0x2D, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
];

pub fn is_allowed_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "hdslb.com"
        || host.ends_with(".hdslb.com")
        || host == "biliimg.com"
        || host.ends_with(".biliimg.com")
}

pub fn extract_target(request_uri: &str) -> Option<String> {
    let uri = url::Url::parse(request_uri).ok()?;
    uri.query_pairs()
        .find(|(key, _)| key == "u")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
}

pub async fn serve(client: &BiliClient, request_uri: &str) -> Response<Vec<u8>> {
    let Some(target) = extract_target(request_uri) else {
        return placeholder();
    };
    match client.fetch_allowed_image(&target).await {
        Ok((content_type, bytes)) => Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, content_type)
            .header("Cache-Control", "public, max-age=86400")
            .body(bytes)
            .unwrap_or_else(|_| placeholder()),
        Err(_) => placeholder(),
    }
}

pub fn validate_and_url(raw: &str) -> BiliResult<url::Url> {
    let parsed = url::Url::parse(raw).map_err(|_| super::error::BiliError::msg("封面地址无效"))?;
    if parsed.scheme() != "https" {
        return Err(super::error::BiliError::msg("仅允许 https 图床"));
    }
    let host = parsed.host_str().unwrap_or_default();
    if !is_allowed_host(host) {
        return Err(super::error::BiliError::msg("拒绝非 B 站图床"));
    }
    Ok(parsed)
}

fn placeholder() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "image/png")
        .header("Cache-Control", "no-store")
        .body(PLACEHOLDER_PNG.to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_bili_cdns() {
        assert!(is_allowed_host("i0.hdslb.com"));
        assert!(is_allowed_host("s1.hdslb.com"));
        assert!(is_allowed_host("i0.hdslb.com."));
        assert!(is_allowed_host("archive.biliimg.com"));
        assert!(is_allowed_host("hdslb.com"));
    }

    #[test]
    fn rejects_other_hosts() {
        assert!(!is_allowed_host("evil.com"));
        assert!(!is_allowed_host("hdslb.com.evil.com"));
        assert!(!is_allowed_host("not-hdslb.com"));
        assert!(!is_allowed_host("localhost"));
        assert!(!is_allowed_host("127.0.0.1"));
    }

    #[test]
    fn extracts_encoded_target() {
        let uri = "http://biliimg.localhost/img?u=https%3A%2F%2Fi0.hdslb.com%2Fbfs%2Fa.jpg";
        assert_eq!(
            extract_target(uri).as_deref(),
            Some("https://i0.hdslb.com/bfs/a.jpg")
        );
    }

    #[test]
    fn missing_target_is_none() {
        assert!(extract_target("http://biliimg.localhost/img").is_none());
        assert!(extract_target("http://biliimg.localhost/img?u=").is_none());
    }
}
