//! WBI query signing used by Bilibili web APIs.
//! Keys rotate; mixin derivation and `w_rid` construction are deterministic.

use md5::{Digest, Md5};
use std::collections::BTreeMap;

const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

pub fn mixin_key(img_key: &str, sub_key: &str) -> String {
    let raw = format!("{img_key}{sub_key}");
    let chars: Vec<char> = raw.chars().collect();
    MIXIN_KEY_ENC_TAB
        .iter()
        .filter_map(|&i| chars.get(i).copied())
        .take(32)
        .collect()
}

pub fn sign(params: BTreeMap<String, String>, mixin: &str, wts: u64) -> BTreeMap<String, String> {
    let mut signed = params;
    signed.insert("wts".to_string(), wts.to_string());
    for value in signed.values_mut() {
        *value = value
            .chars()
            .filter(|c| !matches!(c, '!' | '\'' | '(' | ')' | '*'))
            .collect();
    }
    let query = signed
        .iter()
        .map(|(k, v)| format!("{}={}", encode_uri_component(k), encode_uri_component(v)))
        .collect::<Vec<_>>()
        .join("&");
    let digest = Md5::digest(format!("{query}{mixin}").as_bytes());
    let mut rid = String::with_capacity(32);
    for byte in digest {
        rid.push_str(&format!("{byte:02x}"));
    }
    signed.insert("w_rid".to_string(), rid);
    signed
}

fn encode_uri_component(input: &str) -> String {
    let mut out = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub fn to_query(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(k, v)| format!("{}={}", encode_uri_component(k), encode_uri_component(v)))
        .collect::<Vec<_>>()
        .join("&")
}

#[cfg(test)]
mod tests {
    use super::*;

    const IMG: &str = "7cd084941338484aae1ad9425b84077c";
    const SUB: &str = "4932caff0ff746eab6f01bf08b70ac45";

    #[test]
    fn mixin_key_matches_published_example() {
        assert_eq!(mixin_key(IMG, SUB), "ea1db124af3c7062474693fa704f4ff8");
    }

    #[test]
    fn sign_is_sorted_filters_and_stable() {
        let mut params = BTreeMap::new();
        params.insert("foo".into(), "114".into());
        params.insert("bar".into(), "514".into());
        params.insert("zab".into(), "1919810".into());
        let signed = sign(params, "ea1db124af3c7062474693fa704f4ff8", 1702204169);
        assert_eq!(signed.get("wts").unwrap(), "1702204169");
        let rid = signed.get("w_rid").unwrap();
        assert_eq!(rid.len(), 32);
        assert!(rid.chars().all(|c| c.is_ascii_hexdigit()));

        let mut again = BTreeMap::new();
        again.insert("zab".into(), "1919810".into());
        again.insert("foo".into(), "114".into());
        again.insert("bar".into(), "514".into());
        let signed2 = sign(again, "ea1db124af3c7062474693fa704f4ff8", 1702204169);
        assert_eq!(signed.get("w_rid"), signed2.get("w_rid"));
    }

    #[test]
    fn sign_strips_forbidden_value_chars() {
        let mut params = BTreeMap::new();
        params.insert("keyword".into(), "hello!()*".into());
        let signed = sign(params, "ea1db124af3c7062474693fa704f4ff8", 1);
        assert_eq!(signed.get("keyword").unwrap(), "hello");
    }
}
