use super::danmaku::{self, DanmakuOptions};
use super::error::{BiliError, BiliResult};
use super::models::*;
use super::session::{self, Session};
use super::wbi;
use reqwest::header::{HeaderMap, HeaderValue, REFERER, USER_AGENT};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const NAV: &str = "https://api.bilibili.com/x/web-interface/nav";
const QR_GEN: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const QR_POLL: &str = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const FEED: &str = "https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd";
const SEARCH: &str = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const VIEW: &str = "https://api.bilibili.com/x/web-interface/view";
const PLAYURL: &str = "https://api.bilibili.com/x/player/wbi/playurl";
const DANMAKU: &str = "https://api.bilibili.com/x/v1/dm/list.so";
const ARCHIVE_RELATION: &str = "https://api.bilibili.com/x/web-interface/archive/relation";

#[derive(Clone)]
pub struct BiliClient {
    http: reqwest::Client,
    session: Arc<Mutex<Session>>,
    data_dir: Arc<Mutex<PathBuf>>,
    wbi_keys: Arc<Mutex<Option<(String, String)>>>,
}

impl BiliClient {
    pub fn new() -> BiliResult<Self> {
        let http = reqwest::Client::builder()
            .gzip(true)
            .brotli(true)
            // B 站弹幕 list.so 把 raw deflate 标成 Content-Encoding: deflate，
            // reqwest 默认按 zlib 解会失败。关掉自动 deflate，改走手动 inflate。
            .deflate(false)
            .build()?;
        Ok(Self {
            http,
            session: Arc::new(Mutex::new(Session::default())),
            data_dir: Arc::new(Mutex::new(PathBuf::new())),
            wbi_keys: Arc::new(Mutex::new(None)),
        })
    }

    pub fn set_data_dir(&self, dir: PathBuf) -> BiliResult<()> {
        std::fs::create_dir_all(&dir)?;
        let path = session::session_path(&dir);
        let loaded = Session::load(&path)?;
        *self
            .session
            .lock()
            .map_err(|_| BiliError::msg("会话锁失败"))? = loaded;
        *self
            .data_dir
            .lock()
            .map_err(|_| BiliError::msg("路径锁失败"))? = dir;
        Ok(())
    }

    fn persist(&self) -> BiliResult<()> {
        let dir = self
            .data_dir
            .lock()
            .map_err(|_| BiliError::msg("路径锁失败"))?
            .clone();
        if dir.as_os_str().is_empty() {
            return Ok(());
        }
        let session = self
            .session
            .lock()
            .map_err(|_| BiliError::msg("会话锁失败"))?
            .clone();
        session.save(&session::session_path(&dir))
    }

    fn cookie_header(&self) -> BiliResult<String> {
        let mut session = self
            .session
            .lock()
            .map_err(|_| BiliError::msg("会话锁失败"))?;
        session.ensure_buvid();
        Ok(session.cookie_header())
    }

    fn headers(&self) -> BiliResult<HeaderMap> {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(Session::user_agent()));
        headers.insert(
            REFERER,
            HeaderValue::from_static("https://www.bilibili.com/"),
        );
        let cookies = self.cookie_header()?;
        if !cookies.is_empty() {
            if let Ok(value) = HeaderValue::from_str(&cookies) {
                headers.insert(reqwest::header::COOKIE, value);
            }
        }
        Ok(headers)
    }

    fn csrf(&self) -> BiliResult<String> {
        let session = self
            .session
            .lock()
            .map_err(|_| BiliError::msg("会话锁失败"))?;
        session
            .csrf()
            .ok_or_else(|| BiliError::msg("未登录"))
    }

    fn logged_mid(&self) -> BiliResult<i64> {
        let session = self
            .session
            .lock()
            .map_err(|_| BiliError::msg("会话锁失败"))?;
        session.mid().ok_or_else(|| BiliError::msg("未登录"))
    }

    async fn post_form(&self, url: &str, form: &[(&str, String)]) -> BiliResult<Value> {
        let pairs: Vec<(&str, &str)> = form.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let response = self
            .http
            .post(url)
            .headers(self.headers()?)
            .form(&pairs)
            .send()
            .await?;
        self.capture_cookies(&response);
        let bytes = read_decoded(response).await?;
        let value: Value = serde_json::from_slice(&bytes)?;
        check_code(&value)?;
        Ok(value)
    }

    async fn get_json(&self, url: &str) -> BiliResult<Value> {
        let response = self.http.get(url).headers(self.headers()?).send().await?;
        self.capture_cookies(&response);
        let status = response.status();
        let bytes = read_decoded(response).await?;
        if !status.is_success() {
            let text = String::from_utf8_lossy(&bytes);
            return Err(BiliError::Api(format!(
                "HTTP {status}: {}",
                truncate(&text, 180)
            )));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn get_text(&self, url: &str) -> BiliResult<String> {
        let response = self.http.get(url).headers(self.headers()?).send().await?;
        self.capture_cookies(&response);
        let bytes = read_decoded(response).await?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn capture_cookies(&self, response: &reqwest::Response) {
        let values: Vec<String> = response
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
            .collect();
        if values.is_empty() {
            return;
        }
        if let Ok(mut session) = self.session.lock() {
            session.merge_set_cookie(values.into_iter());
        }
        let _ = self.persist();
    }

    async fn wbi_query(&self, base: &str, params: BTreeMap<String, String>) -> BiliResult<Value> {
        let (img, sub) = self.ensure_wbi_keys().await?;
        let mixin = wbi::mixin_key(&img, &sub);
        let wts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let signed = wbi::sign(params, &mixin, wts);
        let url = format!("{base}?{}", wbi::to_query(&signed));
        let value = self.get_json(&url).await?;
        match value.get("code").and_then(|c| c.as_i64()).unwrap_or(0) {
            0 => Ok(value),
            -352 | -412 => Err(BiliError::msg("请求被风控，请稍后重试或重新登录")),
            other => Err(BiliError::Api(
                value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .map(|m| m.to_string())
                    .unwrap_or_else(|| format!("错误码 {other}")),
            )),
        }
    }

    async fn ensure_wbi_keys(&self) -> BiliResult<(String, String)> {
        if let Ok(guard) = self.wbi_keys.lock() {
            if let Some(keys) = guard.clone() {
                return Ok(keys);
            }
        }
        let nav = self.get_json(NAV).await?;
        let img = nav["data"]["wbi_img"]["img_url"]
            .as_str()
            .and_then(key_from_url)
            .ok_or_else(|| BiliError::msg("无法读取 WBI 密钥"))?;
        let sub = nav["data"]["wbi_img"]["sub_url"]
            .as_str()
            .and_then(key_from_url)
            .ok_or_else(|| BiliError::msg("无法读取 WBI 密钥"))?;
        if let Ok(mut guard) = self.wbi_keys.lock() {
            *guard = Some((img.clone(), sub.clone()));
        }
        Ok((img, sub))
    }

    pub async fn qr_start(&self) -> BiliResult<QrStart> {
        let value = self.get_json(QR_GEN).await?;
        check_code(&value)?;
        Ok(QrStart {
            url: json_str(&value["data"]["url"])?,
            qrcode_key: json_str(&value["data"]["qrcode_key"])?,
        })
    }

    pub async fn qr_poll(&self, qrcode_key: &str) -> BiliResult<QrPoll> {
        let url = format!("{QR_POLL}?qrcode_key={qrcode_key}");
        let response = self.http.get(&url).headers(self.headers()?).send().await?;
        self.capture_cookies(&response);
        let value: Value = serde_json::from_str(&response.text().await?)?;
        let data_code = value["data"]["code"].as_i64().unwrap_or(-1);
        let status = match data_code {
            0 => "confirmed",
            86090 => "scanned",
            86101 => "pending",
            86038 => "expired",
            _ => "pending",
        };
        if status == "confirmed" {
            self.persist()?;
            let profile = self.profile().await.ok();
            return Ok(QrPoll {
                status: status.into(),
                profile,
            });
        }
        Ok(QrPoll {
            status: status.into(),
            profile: None,
        })
    }

    pub fn logout(&self) -> BiliResult<()> {
        {
            let mut session = self
                .session
                .lock()
                .map_err(|_| BiliError::msg("会话锁失败"))?;
            session.clear_login();
        }
        if let Ok(mut keys) = self.wbi_keys.lock() {
            *keys = None;
        }
        self.persist()
    }

    pub async fn profile(&self) -> BiliResult<Profile> {
        let value = self.get_json(NAV).await?;
        let data = &value["data"];
        let is_login = data["isLogin"].as_bool().unwrap_or(false);
        Ok(Profile {
            is_login,
            mid: data["mid"].as_i64().unwrap_or(0),
            name: data["uname"].as_str().unwrap_or("未登录").to_string(),
            face: https_url(data["face"].as_str().unwrap_or_default()),
            vip: data["vipStatus"].as_i64().unwrap_or(0) == 1
                || data["vip"]["status"].as_i64().unwrap_or(0) == 1,
        })
    }

    pub async fn recommend(&self, fresh_idx: u32) -> BiliResult<Vec<VideoCard>> {
        let mut params = BTreeMap::new();
        params.insert("fresh_idx".into(), fresh_idx.max(1).to_string());
        params.insert("fresh_idx_1h".into(), fresh_idx.max(1).to_string());
        params.insert("brush".into(), "0".into());
        params.insert("feed_version".into(), "V3".into());
        let value = self.wbi_query(FEED, params).await?;
        Ok(cards_from_feed(&value))
    }

    pub async fn selected(&self, fresh_idx: u32, fresh_type: u32) -> BiliResult<Vec<VideoCard>> {
        let mut params = BTreeMap::new();
        params.insert("fresh_idx".into(), fresh_idx.max(1).to_string());
        params.insert("fresh_idx_1h".into(), fresh_idx.max(1).to_string());
        params.insert("brush".into(), "0".into());
        params.insert("feed_version".into(), "CLIENT_SELECTED".into());
        params.insert("plat".into(), "1".into());
        params.insert("ps".into(), "10".into());
        params.insert("fresh_type".into(), fresh_type.to_string());
        let value = self.wbi_query(FEED, params).await?;
        Ok(cards_from_feed(&value)
            .into_iter()
            .filter(|card| card.cid.unwrap_or(0) > 0)
            .collect())
    }

    pub async fn search(&self, keyword: &str, page: u32) -> BiliResult<SearchResult> {
        let mut params = BTreeMap::new();
        params.insert("search_type".into(), "video".into());
        params.insert("keyword".into(), keyword.to_string());
        params.insert("page".into(), page.max(1).to_string());
        let value = self.wbi_query(SEARCH, params).await?;
        let items = value["data"]["result"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(parse_search_card)
            .collect();
        Ok(SearchResult {
            items,
            page: page.max(1),
        })
    }

    pub async fn view(&self, bvid: &str) -> BiliResult<VideoDetail> {
        let url = format!("{VIEW}?bvid={bvid}");
        let value = self.get_json(&url).await?;
        check_code(&value)?;
        let data = &value["data"];
        let pages = data["pages"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|p| {
                Some(VideoPage {
                    cid: p["cid"].as_i64()?,
                    page: p["page"].as_i64().unwrap_or(1) as i32,
                    part: p["part"].as_str().unwrap_or("P1").to_string(),
                    duration: p["duration"].as_i64().unwrap_or(0),
                })
            })
            .collect::<Vec<_>>();
        Ok(VideoDetail {
            bvid: json_str(&data["bvid"]).unwrap_or_else(|_| bvid.to_string()),
            aid: data["aid"].as_i64().unwrap_or(0),
            title: json_str(&data["title"])?,
            cover: https_url(data["pic"].as_str().unwrap_or_default()),
            desc: data["desc"].as_str().unwrap_or("").to_string(),
            owner: data["owner"]["name"].as_str().unwrap_or("").to_string(),
            duration: data["duration"].as_i64().unwrap_or(0),
            pages,
            owner_face: https_url(data["owner"]["face"].as_str().unwrap_or_default()),
            season_title: data["ugc_season"]["title"].as_str().unwrap_or("").to_string(),
            like: data["stat"]["like"].as_i64().unwrap_or(0),
            coin: data["stat"]["coin"].as_i64().unwrap_or(0),
            favorite: data["stat"]["favorite"].as_i64().unwrap_or(0),
            share: data["stat"]["share"].as_i64().unwrap_or(0),
            reply: data["stat"]["reply"].as_i64().unwrap_or(0),
        })
    }

    pub async fn resolve_streams(
        &self,
        bvid: &str,
        cid: i64,
        quality: Option<i64>,
    ) -> BiliResult<(Vec<StreamChoice>, StreamChoice)> {
        let mut params = BTreeMap::new();
        params.insert("bvid".into(), bvid.to_string());
        params.insert("cid".into(), cid.to_string());
        params.insert("fnval".into(), "4048".into());
        params.insert("fnver".into(), "0".into());
        params.insert("fourk".into(), "1".into());
        params.insert("qn".into(), quality.unwrap_or(0).to_string());
        let value = self.wbi_query(PLAYURL, params).await?;
        let data = &value["data"];
        let mut choices = parse_dash(data);
        if choices.is_empty() {
            if let Some(durl) = data["durl"].as_array().and_then(|arr| arr.first()) {
                if let Some(url) = durl["url"].as_str() {
                    choices.push(StreamChoice {
                        quality: data["quality"].as_i64().unwrap_or(0),
                        desc: data["quality"]
                            .as_i64()
                            .map(quality_name)
                            .unwrap_or_else(|| "默认".into()),
                        codecs: String::new(),
                        video_url: url.to_string(),
                        audio_url: None,
                    });
                }
            }
        }
        if choices.is_empty() {
            return Err(map_play_error(data).unwrap_or(BiliError::NoPlayUrl));
        }
        let current = pick_quality(&choices, quality)
            .ok_or(BiliError::NoPlayUrl)?
            .clone();
        Ok((choices, current))
    }

    pub async fn danmaku_ass(&self, cid: i64, opts: &DanmakuOptions) -> BiliResult<String> {
        let xml = self.get_text(&format!("{DANMAKU}?oid={cid}")).await?;
        let items = danmaku::parse_xml(&xml);
        Ok(danmaku::to_ass(&items, opts))
    }

    pub async fn fetch_allowed_image(&self, raw_url: &str) -> BiliResult<(String, Vec<u8>)> {
        let parsed = super::media::validate_and_url(raw_url)?;
        let response = self
            .http
            .get(parsed)
            .headers(self.headers()?)
            .send()
            .await?;
        let final_host = response.url().host_str().unwrap_or_default();
        if !super::media::is_allowed_host(final_host) {
            return Err(BiliError::msg("图床跳转到未知域名"));
        }
        let status = response.status();
        if !status.is_success() {
            return Err(BiliError::msg(format!("封面 HTTP {status}")));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/jpeg")
            .to_string();
        let bytes = read_decoded(response).await?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err(BiliError::msg("封面过大"));
        }
        Ok((content_type, bytes))
    }

    pub fn push_history(&self, item: HistoryItem) -> BiliResult<()> {
        let dir = self
            .data_dir
            .lock()
            .map_err(|_| BiliError::msg("路径锁失败"))?
            .clone();
        if dir.as_os_str().is_empty() {
            return Ok(());
        }
        let mut items = session::load_history(&dir)?;
        items.retain(|existing| existing.bvid != item.bvid);
        items.insert(0, item);
        items.truncate(100);
        session::save_history(&dir, &items)
    }

    pub fn history(&self) -> BiliResult<Vec<HistoryItem>> {
        let dir = self
            .data_dir
            .lock()
            .map_err(|_| BiliError::msg("路径锁失败"))?
            .clone();
        if dir.as_os_str().is_empty() {
            return Ok(Vec::new());
        }
        session::load_history(&dir)
    }

    pub fn http_headers_for_mpv(&self) -> BiliResult<Vec<String>> {
        Ok(vec![
            format!("User-Agent: {}", Session::user_agent()),
            "Referer: https://www.bilibili.com/".into(),
            format!("Cookie: {}", self.cookie_header()?),
        ])
    }

    pub async fn archive_relation(&self, aid: i64) -> BiliResult<ArchiveRelation> {
        let value = self
            .get_json(&format!("{ARCHIVE_RELATION}?aid={aid}"))
            .await?;
        check_code(&value)?;
        Ok(parse_archive_relation(&value))
    }

    pub async fn like(&self, aid: i64, unlike: bool) -> BiliResult<()> {
        let csrf = self.csrf()?;
        self.post_form(
            "https://api.bilibili.com/x/web-interface/archive/like",
            &[
                ("aid", aid.to_string()),
                ("like", if unlike { "2" } else { "1" }.into()),
                ("csrf", csrf),
            ],
        )
        .await?;
        Ok(())
    }

    pub async fn dislike(&self, aid: i64, cancel: bool) -> BiliResult<()> {
        let csrf = self.csrf()?;
        let url = if cancel {
            "https://api.bilibili.com/x/web-interface/feedback/dislike/cancel"
        } else {
            "https://api.bilibili.com/x/web-interface/feedback/dislike"
        };
        self.post_form(url, &[("aid", aid.to_string()), ("csrf", csrf)])
            .await?;
        Ok(())
    }

    pub async fn coin(&self, aid: i64) -> BiliResult<()> {
        let csrf = self.csrf()?;
        self.post_form(
            "https://api.bilibili.com/x/web-interface/coin/add",
            &[
                ("aid", aid.to_string()),
                ("multiply", "1".into()),
                ("select_like", "0".into()),
                ("csrf", csrf),
            ],
        )
        .await?;
        Ok(())
    }

    pub async fn fav_folders(&self) -> BiliResult<Vec<FavFolder>> {
        let mid = self.logged_mid()?;
        let url = format!(
            "https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid={mid}"
        );
        let value = self.get_json(&url).await?;
        check_code(&value)?;
        Ok(parse_fav_folders(&value))
    }

    pub async fn fav_add(&self, aid: i64, media_id: Option<i64>) -> BiliResult<()> {
        let csrf = self.csrf()?;
        let folder = match media_id {
            Some(id) => id,
            None => {
                self.fav_folders()
                    .await?
                    .first()
                    .map(|f| f.id)
                    .ok_or_else(|| BiliError::msg("没有可用收藏夹"))?
            }
        };
        self.post_form(
            "https://api.bilibili.com/x/v3/fav/resource/deal",
            &[
                ("rid", aid.to_string()),
                ("type", "2".into()),
                ("add_media_ids", folder.to_string()),
                ("csrf", csrf),
            ],
        )
        .await?;
        Ok(())
    }

    pub async fn danmaku_post(
        &self,
        aid: i64,
        cid: i64,
        bvid: &str,
        message: &str,
        progress_ms: i64,
    ) -> BiliResult<()> {
        let csrf = self.csrf()?;
        let _ = aid;
        self.post_form(
            "https://api.bilibili.com/x/v2/dm/post",
            &[
                ("type", "1".into()),
                ("oid", cid.to_string()),
                ("msg", message.to_string()),
                ("bvid", bvid.to_string()),
                ("progress", progress_ms.max(0).to_string()),
                ("mode", "1".into()),
                ("fontsize", "25".into()),
                ("color", "16777215".into()),
                ("rnd", unix_ms().to_string()),
                ("csrf", csrf),
            ],
        )
        .await?;
        Ok(())
    }

    pub async fn reply_list(&self, aid: i64) -> BiliResult<CommentPage> {
        let mut params = BTreeMap::new();
        params.insert("oid".into(), aid.to_string());
        params.insert("type".into(), "1".into());
        params.insert("mode".into(), "3".into());
        params.insert("ps".into(), "20".into());
        let value = self
            .wbi_query("https://api.bilibili.com/x/v2/reply/wbi/main", params)
            .await?;
        Ok(parse_comments(&value))
    }

    pub async fn reply_add(&self, aid: i64, message: &str, parent: Option<i64>) -> BiliResult<()> {
        let csrf = self.csrf()?;
        let mut form = vec![
            ("oid", aid.to_string()),
            ("type", "1".into()),
            ("message", message.to_string()),
            ("plat", "1".into()),
            ("csrf", csrf),
        ];
        if let Some(id) = parent {
            form.push(("root", id.to_string()));
            form.push(("parent", id.to_string()));
        }
        self.post_form("https://api.bilibili.com/x/v2/reply/add", &form)
            .await?;
        Ok(())
    }
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn parse_archive_relation(value: &Value) -> ArchiveRelation {
    let data = &value["data"];
    ArchiveRelation {
        liked: value_truthy(&data["like"]),
        disliked: value_truthy(&data["dislike"]),
        coin_count: data["coin"]
            .as_i64()
            .unwrap_or_else(|| i64::from(value_truthy(&data["coin"]))),
        faved: value_truthy(&data["favorite"]) || value_truthy(&data["fav"]),
    }
}

fn value_truthy(value: &Value) -> bool {
    value
        .as_bool()
        .unwrap_or_else(|| value.as_i64().unwrap_or(0) > 0)
}

fn parse_fav_folders(value: &Value) -> Vec<FavFolder> {
    value["data"]["list"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|item| {
            Some(FavFolder {
                id: item["id"].as_i64()?,
                title: item["title"].as_str().unwrap_or("收藏夹").to_string(),
            })
        })
        .collect()
}

fn parse_comments(value: &Value) -> CommentPage {
    let items: Vec<CommentItem> = value["data"]["replies"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|item| {
            Some(CommentItem {
                rpid: item["rpid"].as_i64()?,
                mid: item["mid"].as_i64().unwrap_or(0),
                name: item["member"]["uname"].as_str().unwrap_or("").to_string(),
                face: https_url(item["member"]["avatar"].as_str().unwrap_or_default()),
                message: item["content"]["message"].as_str().unwrap_or("").to_string(),
                like: item["like"].as_i64().unwrap_or(0),
            })
        })
        .collect();
    CommentPage {
        all_count: value["data"]["cursor"]["all_count"]
            .as_i64()
            .or_else(|| value["data"]["page"]["count"].as_i64())
            .unwrap_or(items.len() as i64),
        items,
    }
}

fn parse_dash(data: &Value) -> Vec<StreamChoice> {
    let dash = &data["dash"];
    let audio = dash["audio"]
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .max_by_key(|a| a["bandwidth"].as_u64().unwrap_or(0))
        })
        .and_then(|a| a["baseUrl"].as_str().or_else(|| a["base_url"].as_str()))
        .map(|s| s.to_string());
    let mut videos = Vec::new();
    let Some(arr) = dash["video"].as_array() else {
        return videos;
    };
    for video in arr {
        let Some(quality) = video["id"].as_i64() else {
            continue;
        };
        let url = video["baseUrl"]
            .as_str()
            .or_else(|| video["base_url"].as_str())
            .unwrap_or_default();
        if url.is_empty() {
            continue;
        }
        if videos.iter().any(|v: &StreamChoice| v.quality == quality) {
            continue;
        }
        videos.push(StreamChoice {
            quality,
            desc: quality_name(quality),
            codecs: video["codecs"].as_str().unwrap_or("").to_string(),
            video_url: url.to_string(),
            audio_url: audio.clone(),
        });
    }
    videos.sort_by(|a, b| b.quality.cmp(&a.quality));
    videos
}

fn pick_quality(choices: &[StreamChoice], quality: Option<i64>) -> Option<&StreamChoice> {
    if let Some(qn) = quality {
        if let Some(found) = choices.iter().find(|c| c.quality == qn) {
            return Some(found);
        }
    }
    choices.first()
}

fn parse_card(value: &Value) -> Option<VideoCard> {
    let bvid = value["bvid"].as_str().map(|s| s.to_string()).or_else(|| {
        value["uri"]
            .as_str()
            .and_then(|uri| uri.split('/').rev().find(|p| p.starts_with("BV")))
            .map(|s| s.split('?').next().unwrap_or(s).to_string())
    })?;
    if bvid.is_empty() {
        return None;
    }
    let goto = value["goto"].as_str().unwrap_or("av");
    if goto != "av" && !bvid.starts_with("BV") {
        return None;
    }
    Some(VideoCard {
        bvid,
        title: strip_em(value["title"].as_str().unwrap_or_default()),
        cover: https_url(
            value["pic"]
                .as_str()
                .or_else(|| value["cover"].as_str())
                .unwrap_or_default(),
        ),
        owner: value["owner"]["name"]
            .as_str()
            .or_else(|| value["owner_name"].as_str())
            .or_else(|| value["author"].as_str())
            .unwrap_or("")
            .to_string(),
        duration: parse_duration(value),
        views: value["stat"]["view"]
            .as_i64()
            .or_else(|| value["play"].as_i64())
            .unwrap_or(0),
        aid: value["aid"]
            .as_i64()
            .or_else(|| value["id"].as_i64())
            .unwrap_or(0),
        cid: value["cid"].as_i64().filter(|cid| *cid > 0),
        owner_face: https_url(
            value["owner"]["face"]
                .as_str()
                .or_else(|| value["face"].as_str())
                .unwrap_or_default(),
        ),
    })
}

fn cards_from_feed(value: &Value) -> Vec<VideoCard> {
    value["data"]["item"]
        .as_array()
        .cloned()
        .or_else(|| value["data"]["items"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(parse_card)
        .collect()
}

fn parse_search_card(value: &Value) -> Option<VideoCard> {
    if value["type"].as_str().unwrap_or("video") != "video"
        && value["typename"].as_str().unwrap_or("").is_empty()
        && value["bvid"].as_str().is_none()
    {
        return None;
    }
    parse_card(value)
}

fn parse_duration(value: &Value) -> i64 {
    if let Some(n) = value["duration"].as_i64() {
        return n;
    }
    if let Some(s) = value["duration"].as_str() {
        let parts: Vec<i64> = s.split(':').filter_map(|p| p.parse().ok()).collect();
        return match parts.as_slice() {
            [h, m, s] => h * 3600 + m * 60 + s,
            [m, s] => m * 60 + s,
            [s] => *s,
            _ => 0,
        };
    }
    0
}

fn strip_em(input: &str) -> String {
    input
        .replace("<em class=\"keyword\">", "")
        .replace("</em>", "")
        .replace("<em>", "")
}

fn https_url(url: &str) -> String {
    if url.starts_with("//") {
        format!("https:{url}")
    } else if url.starts_with("http:") {
        url.replacen("http:", "https:", 1)
    } else {
        url.to_string()
    }
}

fn key_from_url(url: &str) -> Option<String> {
    let name = url.rsplit('/').next()?;
    Some(name.split('.').next()?.to_string())
}

fn json_str(value: &Value) -> BiliResult<String> {
    value
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| BiliError::msg("接口字段缺失"))
}

fn check_code(value: &Value) -> BiliResult<()> {
    match value.get("code").and_then(|c| c.as_i64()).unwrap_or(0) {
        0 => Ok(()),
        -101 => Err(BiliError::msg("未登录")),
        -352 | -412 => Err(BiliError::msg("请求被风控，请稍后重试或重新登录")),
        other => Err(BiliError::Api(
            value
                .get("message")
                .and_then(|m| m.as_str())
                .map(|m| format!("{m} ({other})"))
                .unwrap_or_else(|| format!("错误码 {other}")),
        )),
    }
}

fn map_play_error(data: &Value) -> Option<BiliError> {
    let message = data["message"].as_str().unwrap_or("");
    if message.contains("大会员") {
        Some(BiliError::msg(
            "该清晰度需要大会员，已回退到当前账号可用的最高清晰度",
        ))
    } else if !message.is_empty() {
        Some(BiliError::Api(message.to_string()))
    } else {
        None
    }
}

fn quality_name(id: i64) -> String {
    match id {
        127 => "8K".into(),
        126 => "杜比视界".into(),
        125 => "HDR 真彩".into(),
        120 => "4K".into(),
        116 => "1080P60".into(),
        112 => "1080P 高码率".into(),
        80 => "1080P".into(),
        74 => "720P60".into(),
        64 => "720P".into(),
        32 => "480P".into(),
        16 => "360P".into(),
        other => format!("QN {other}"),
    }
}

fn truncate(text: &str, max: usize) -> String {
    let s: String = text.chars().take(max).collect();
    if s.chars().count() < text.chars().count() {
        format!("{s}…")
    } else {
        s
    }
}

async fn read_decoded(response: reqwest::Response) -> BiliResult<Vec<u8>> {
    let encoding = response
        .headers()
        .get(reqwest::header::CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = response.bytes().await?;
    Ok(super::inflate::decode_encoded(&encoding, &bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_card_from_rcmd_fixture() {
        let item = json!({
            "goto": "av",
            "bvid": "BV1xx411c7mD",
            "title": "hello",
            "pic": "//i0.hdslb.com/bfs/cover.png",
            "owner": { "name": "up" },
            "duration": 125,
            "stat": { "view": 88 }
        });
        let card = match parse_card(&item) {
            Some(card) => card,
            None => panic!("recommend fixture should parse"),
        };
        assert_eq!(card.cover, "https://i0.hdslb.com/bfs/cover.png");
        assert_eq!(card.duration, 125);
        assert_eq!(card.views, 88);
    }

    #[test]
    fn selected_feed_keeps_only_cards_with_cid() {
        let feed = json!({
            "data": {
                "item": [
                    {
                        "goto": "av",
                        "bvid": "BV1keep11111",
                        "id": 101,
                        "cid": 202,
                        "title": "ok",
                        "cover": "https://i0.hdslb.com/a.jpg",
                        "owner": { "name": "up", "face": "//i0.hdslb.com/f.png" }
                    },
                    {
                        "goto": "live",
                        "bvid": "",
                        "title": "live"
                    },
                    {
                        "goto": "av",
                        "bvid": "BV1drop22222",
                        "title": "no cid"
                    }
                ]
            }
        });
        let cards: Vec<_> = cards_from_feed(&feed)
            .into_iter()
            .filter(|card| card.cid.unwrap_or(0) > 0)
            .collect();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].bvid, "BV1keep11111");
        assert_eq!(cards[0].aid, 101);
        assert_eq!(cards[0].cid, Some(202));
        assert_eq!(cards[0].owner_face, "https://i0.hdslb.com/f.png");
    }

    #[test]
    fn csrf_missing_is_logged_out() {
        let session = crate::bili::session::Session::default();
        assert!(session.csrf().is_none());
        let mut session = crate::bili::session::Session::default();
        session.cookies.insert("bili_jct".into(), "abc".into());
        assert_eq!(session.csrf().as_deref(), Some("abc"));
    }

    #[test]
    fn parse_archive_relation_from_fixture() {
        let value = json!({
            "data": {
                "like": true,
                "dislike": false,
                "coin": 1,
                "favorite": true
            }
        });
        let relation = parse_archive_relation(&value);
        assert!(relation.liked);
        assert!(!relation.disliked);
        assert_eq!(relation.coin_count, 1);
        assert!(relation.faved);
    }

    #[test]
    fn parse_comments_from_fixture() {
        let value = json!({
            "data": {
                "cursor": { "all_count": 3 },
                "replies": [
                    {
                        "rpid": 9,
                        "mid": 1,
                        "like": 2,
                        "member": { "uname": "a", "avatar": "//i0.hdslb.com/a.png" },
                        "content": { "message": "hi" }
                    }
                ]
            }
        });
        let page = parse_comments(&value);
        assert_eq!(page.all_count, 3);
        assert_eq!(page.items[0].message, "hi");
        assert_eq!(page.items[0].face, "https://i0.hdslb.com/a.png");
    }

    #[test]
    fn search_title_strips_em() {
        let item = json!({
            "bvid": "BV1xx411c7mD",
            "title": "<em class=\"keyword\">rust</em> 入门",
            "duration": "1:02",
            "author": "up",
            "pic": "https://i0.hdslb.com/a.jpg"
        });
        let card = match parse_search_card(&item) {
            Some(card) => card,
            None => panic!("search fixture should parse"),
        };
        assert_eq!(card.title, "rust 入门");
        assert_eq!(card.duration, 62);
    }

    #[test]
    #[ignore = "hits live Bilibili danmaku"]
    fn live_danmaku_inflates_raw_deflate() {
        let client = BiliClient::new().expect("client");
        let ass = tauri::async_runtime::block_on(client.danmaku_ass(
            40217479053,
            &crate::bili::danmaku::DanmakuOptions::default(),
        ));
        let ass = ass.expect("danmaku should inflate");
        assert!(ass.contains("Dialogue:"), "ass={ass}");
    }
}
