use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};
use std::io::Read;

pub fn decode_encoded(encoding: &str, bytes: &[u8]) -> Vec<u8> {
    let tokens: Vec<&str> = encoding
        .split(',')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty() && !part.eq_ignore_ascii_case("identity"))
        .collect();
    if tokens
        .iter()
        .any(|part| part.eq_ignore_ascii_case("deflate"))
    {
        if let Some(out) = inflate_deflate(bytes) {
            return out;
        }
    }
    if tokens.iter().any(|part| part.eq_ignore_ascii_case("gzip"))
        || bytes.starts_with(&[0x1F, 0x8B])
    {
        if let Some(out) = inflate_gzip(bytes) {
            return out;
        }
    }
    bytes.to_vec()
}

fn inflate_deflate(bytes: &[u8]) -> Option<Vec<u8>> {
    try_decode(DeflateDecoder::new(bytes)).or_else(|| try_decode(ZlibDecoder::new(bytes)))
}

fn inflate_gzip(bytes: &[u8]) -> Option<Vec<u8>> {
    try_decode(GzDecoder::new(bytes))
}

fn try_decode<R: Read>(mut decoder: R) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).ok()?;
    if out.is_empty() {
        return None;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::{DeflateEncoder, ZlibEncoder};
    use flate2::Compression;
    use std::io::Write;

    fn deflate_raw(input: &[u8]) -> Vec<u8> {
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(input).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn raw_deflate_xml_like_bilibili_danmaku() {
        let xml = b"<i><d p=\"1.0,1,25,16777215,0,0,0,0\">hi</d></i>";
        let compressed = deflate_raw(xml);
        assert_ne!(
            compressed.first(),
            Some(&0x78),
            "raw deflate is not zlib-wrapped"
        );
        let out = decode_encoded("deflate", &compressed);
        assert_eq!(out, xml);
    }

    #[test]
    fn zlib_deflate_still_works() {
        let body = b"{\"code\":0}";
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(body).unwrap();
        let compressed = encoder.finish().unwrap();
        let out = decode_encoded("deflate", &compressed);
        assert_eq!(out, body);
    }

    #[test]
    fn identity_passthrough() {
        let body = b"<xml/>";
        assert_eq!(decode_encoded("identity", body), body);
        assert_eq!(decode_encoded("", body), body);
    }
}
