#[derive(Debug, Clone)]
pub struct Danmaku {
    pub time: f64,
    pub mode: u8,
    #[allow(dead_code)]
    pub size: u32,
    pub color: u32,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct DanmakuOptions {
    pub font_size: u32,
    pub max_rows: usize,
    pub scroll_seconds: f64,
}

impl Default for DanmakuOptions {
    fn default() -> Self {
        Self {
            font_size: 48,
            max_rows: 12,
            scroll_seconds: 8.0,
        }
    }
}

pub fn parse_xml(xml: &str) -> Vec<Danmaku> {
    let mut items = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<d p=\"") {
        rest = &rest[start + 6..];
        let Some(p_end) = rest.find('"') else { break };
        let attrs = &rest[..p_end];
        rest = &rest[p_end + 1..];
        let Some(gt) = rest.find('>') else { break };
        rest = &rest[gt + 1..];
        let Some(close) = rest.find("</d>") else { break };
        let raw_text = &rest[..close];
        rest = &rest[close + 4..];
        let mut cols = attrs.split(',');
        let time = cols.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
        let mode = cols.next().and_then(|s| s.parse().ok()).unwrap_or(1);
        let size = cols.next().and_then(|s| s.parse().ok()).unwrap_or(25);
        let color = cols.next().and_then(|s| s.parse().ok()).unwrap_or(16777215);
        items.push(Danmaku {
            time,
            mode,
            size,
            color,
            text: unescape(raw_text),
        });
    }
    items
}

pub fn to_ass(items: &[Danmaku], opts: &DanmakuOptions) -> String {
    let play_x = 1920.0;
    let play_y = 1080.0;
    let row_h = opts.font_size as f64 + 8.0;
    let mut scroll_until = vec![0.0_f64; opts.max_rows.max(1)];
    let mut top_until = vec![0.0_f64; opts.max_rows.max(1)];
    let mut bottom_until = vec![0.0_f64; opts.max_rows.max(1)];

    let mut events = String::new();
    for item in items {
        let text = escape_ass(&item.text);
        if text.trim().is_empty() {
            continue;
        }
        let start = item.time.max(0.0);
        let color = ass_color(item.color);
        match item.mode {
            4 => {
                if let Some(row) = claim_row(&mut bottom_until, start, 4.0) {
                    let y = play_y - (row as f64 + 1.0) * row_h;
                    let end = start + 4.0;
                    events.push_str(&format!(
                        "Dialogue: 0,{start_t},{end_t},Bottom,,0,0,0,,{{\\an2\\pos({x},{y})\\c{color}}}{text}\n",
                        start_t = ass_time(start),
                        end_t = ass_time(end),
                        x = play_x / 2.0,
                        y = y,
                    ));
                }
            }
            5 => {
                if let Some(row) = claim_row(&mut top_until, start, 4.0) {
                    let y = (row as f64 + 1.0) * row_h;
                    let end = start + 4.0;
                    events.push_str(&format!(
                        "Dialogue: 0,{start_t},{end_t},Top,,0,0,0,,{{\\an8\\pos({x},{y})\\c{color}}}{text}\n",
                        start_t = ass_time(start),
                        end_t = ass_time(end),
                        x = play_x / 2.0,
                        y = y,
                    ));
                }
            }
            _ => {
                if let Some(row) = claim_row(&mut scroll_until, start, opts.scroll_seconds * 0.4) {
                    let y = (row as f64 + 1.0) * row_h;
                    let end = start + opts.scroll_seconds;
                    let width = estimate_width(&item.text, opts.font_size);
                    events.push_str(&format!(
                        "Dialogue: 0,{start_t},{end_t},Scroll,,0,0,0,,{{\\move({x1},{y},{x2},{y})\\c{color}}}{text}\n",
                        start_t = ass_time(start),
                        end_t = ass_time(end),
                        x1 = play_x + width,
                        y = y,
                        x2 = -width,
                    ));
                }
            }
        }
    }

    format!(
        "\
[Script Info]\n\
ScriptType: v4.00+\n\
PlayResX: 1920\n\
PlayResY: 1080\n\
WrapStyle: 0\n\
ScaledBorderAndShadow: yes\n\
\n\
[V4+ Styles]\n\
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
Style: Scroll,Microsoft YaHei,{font},&H00FFFFFF,&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,8,0,0,0,1\n\
Style: Top,Microsoft YaHei,{font},&H00FFFFFF,&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,8,0,0,0,1\n\
Style: Bottom,Microsoft YaHei,{font},&H00FFFFFF,&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,2,0,0,0,1\n\
\n\
[Events]\n\
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n\
{events}",
        font = opts.font_size
    )
}

fn claim_row(rows: &mut [f64], start: f64, occupy: f64) -> Option<usize> {
    for (i, until) in rows.iter_mut().enumerate() {
        if *until <= start {
            *until = start + occupy;
            return Some(i);
        }
    }
    None
}

fn estimate_width(text: &str, font_size: u32) -> f64 {
    text.chars().count() as f64 * font_size as f64 * 0.7
}

fn ass_time(seconds: f64) -> String {
    let cs = (seconds.max(0.0) * 100.0).round() as i64;
    let h = cs / 360000;
    let m = (cs % 360000) / 6000;
    let s = (cs % 6000) / 100;
    let c = cs % 100;
    format!("{h}:{m:02}:{s:02}.{c:02}")
}

fn ass_color(rgb: u32) -> String {
    let r = (rgb >> 16) & 0xFF;
    let g = (rgb >> 8) & 0xFF;
    let b = rgb & 0xFF;
    format!("&H00{b:02X}{g:02X}{r:02X}")
}

fn escape_ass(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace('\n', " ")
}

fn unescape(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<i>
<d p="1.50,1,25,16777215,0,0,0,1">hello</d>
<d p="2,5,25,16711680,0,0,0,2">top</d>
<d p="3,4,25,255,0,0,0,3">bottom</d>
<d p="4,1,25,16777215,0,0,0,4">{bad &amp; x}</d>
</i>"#;

    #[test]
    fn parse_modes_and_unescape() {
        let items = parse_xml(SAMPLE);
        assert_eq!(items.len(), 4);
        assert_eq!(items[0].time, 1.5);
        assert_eq!(items[1].mode, 5);
        assert_eq!(items[2].mode, 4);
        assert_eq!(items[3].text, "{bad & x}");
    }

    #[test]
    fn ass_contains_move_and_escapes() {
        let items = parse_xml(SAMPLE);
        let ass = to_ass(&items, &DanmakuOptions::default());
        assert!(ass.contains("\\move("));
        assert!(ass.contains("\\{bad & x\\}"));
        assert!(ass.contains("&H00FF0000") || ass.contains("Bottom"));
        assert!(ass.contains("[Events]"));
    }

    #[test]
    fn density_drops_overflow() {
        let crowded: Vec<Danmaku> = (0..40)
            .map(|i| Danmaku {
                time: 1.0,
                mode: 1,
                size: 25,
                color: 16777215,
                text: format!("d{i}"),
            })
            .collect();
        let opts = DanmakuOptions {
            max_rows: 4,
            font_size: 48,
            scroll_seconds: 8.0,
        };
        let ass = to_ass(&crowded, &opts);
        let dialogues = ass.lines().filter(|l| l.starts_with("Dialogue:")).count();
        assert_eq!(dialogues, 4);
    }
}
