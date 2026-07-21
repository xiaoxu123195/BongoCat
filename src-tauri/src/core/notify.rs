use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_custom_window::MAIN_WINDOW_LABEL;
use tauri_plugin_notification::NotificationExt;

const MAX_BODY: usize = 8 * 1024;
const BIND_ADDR: &str = "127.0.0.1:7077";

static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyPayload {
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    // Explicit badge directive from the sender: a badge code to show
    // (e.g. "waiting") or "clear" to drop the current badge.
    #[serde(default)]
    pub badge: Option<String>,
}

fn default_source() -> String { "unknown".into() }
fn default_kind() -> String { "info".into() }

const VALID_KINDS: &[&str] = &["info", "need-input", "done", "warn", "error", "schedule", "status"];

// Drop identical (source, kind, message) arrivals within this window so
// concurrent sessions / chatty hooks can't spam the bubble stack.
const DEDUP_WINDOW: Duration = Duration::from_secs(5);

fn recently_seen(key: String) -> bool {
    static SEEN: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    let mut map = SEEN.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap();
    let now = Instant::now();
    map.retain(|_, t| now.duration_since(*t) < DEDUP_WINDOW);
    if map.contains_key(&key) {
        return true;
    }
    map.insert(key, now);
    false
}

fn normalize(mut p: NotifyPayload) -> NotifyPayload {
    if p.source.is_empty() { p.source = "unknown".into(); }
    p.source.truncate(40);
    if !VALID_KINDS.contains(&p.kind.as_str()) { p.kind = "info".into(); }
    if p.message.is_empty() {
        p.message = match p.kind.as_str() {
            "done" => "✅ 已完成".into(),
            "need-input" => "需要你处理".into(),
            _ => "通知".into(),
        };
    }
    p.message.truncate(300);
    if let Some(ref mut t) = p.title { t.truncate(80); }
    if let Some(ref mut pr) = p.project { pr.truncate(60); }
    if p.project.as_deref() == Some("") { p.project = None; }
    if let Some(ref mut b) = p.badge { b.truncate(24); }
    if p.badge.as_deref() == Some("") { p.badge = None; }
    p
}

// Read a full HTTP request: headers, then body per Content-Length. Handles
// clients that send `Expect: 100-continue` (e.g. PowerShell 5.1) and bodies
// that arrive in separate TCP segments — a single read() sees neither.
fn read_request(stream: &mut TcpStream) -> Option<(String, Vec<u8>)> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];

    let header_end = loop {
        let n = stream.read(&mut tmp).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > MAX_BODY + 8192 {
            return None;
        }
    };

    let headers = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let lower = headers.to_ascii_lowercase();

    let content_length = lower
        .lines()
        .find_map(|l| l.strip_prefix("content-length:"))
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY {
        return None;
    }

    if lower.contains("expect: 100-continue") {
        let _ = stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
    }

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut tmp).ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    Some((headers, body))
}

fn http_response(status: u16, body: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        match status { 200 => "OK", 400 => "Bad Request", 405 => "Method Not Allowed", 413 => "Payload Too Large", _ => "Error" },
        body.len(),
        body
    ).into_bytes()
}

pub fn start<R: Runtime>(app_handle: AppHandle<R>) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    std::thread::spawn(move || {
        // A restart race (the old process still holding the port for a few
        // seconds) must not kill the server for the whole app lifetime —
        // keep retrying until the port frees up.
        let mut attempt: u32 = 0;
        let listener = loop {
            match TcpListener::bind(BIND_ADDR) {
                Ok(l) => {
                    log::info!("[notify] listening on http://{}", BIND_ADDR);
                    break l;
                }
                Err(e) => {
                    if attempt % 20 == 0 {
                        log::warn!("[notify] bind failed: {} — retrying every 15s", e);
                    }
                    attempt += 1;
                    std::thread::sleep(Duration::from_secs(15));
                }
            }
        };

        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => continue,
            };

            let (headers, body) = match read_request(&mut stream) {
                Some(r) => r,
                None => continue,
            };
            let lower = headers.to_ascii_lowercase();

            // Reject anything with an Origin header (browser CSRF protection).
            if lower.contains("\r\norigin:") {
                let _ = stream.write_all(&http_response(400, r#"{"error":"origin rejected"}"#));
                continue;
            }

            // Only accept POST /notify
            if !headers.starts_with("POST /notify") {
                let _ = stream.write_all(&http_response(405, r#"{"error":"use POST /notify"}"#));
                continue;
            }

            // Require X-Pixo-Notify header (CORS preflight blocker).
            if !lower.contains("x-pixo-notify:") {
                let _ = stream.write_all(&http_response(400, r#"{"error":"missing X-Pixo-Notify header"}"#));
                continue;
            }

            match serde_json::from_slice::<NotifyPayload>(&body) {
                Ok(payload) => {
                    let payload = normalize(payload);

                    let key = format!(
                        "{}|{}|{}|{}",
                        payload.source,
                        payload.kind,
                        payload.project.as_deref().unwrap_or(""),
                        payload.message
                    );
                    if recently_seen(key) {
                        log::info!("[notify] throttled {}/{}", payload.source, payload.kind);
                        let _ = stream.write_all(&http_response(200, r#"{"ok":true,"throttled":true}"#));
                        continue;
                    }

                    log::info!("[notify] {}/{}: {}", payload.source, payload.kind, payload.message);
                    let _ = app_handle.emit("pixo-notify", &payload);

                    // Cat window hidden → the bubble would land on a window
                    // nobody can see; escalate to an OS notification instead.
                    // Status ticks are ambient and never worth an OS toast.
                    if payload.kind != "status" {
                        let visible = app_handle
                            .get_webview_window(MAIN_WINDOW_LABEL)
                            .map(|w| w.is_visible().unwrap_or(true))
                            .unwrap_or(false);
                        if !visible {
                            let title = payload.title.clone().unwrap_or_else(|| payload.source.clone());
                            let _ = app_handle
                                .notification()
                                .builder()
                                .title(title)
                                .body(&payload.message)
                                .show();
                        }
                    }

                    let _ = stream.write_all(&http_response(200, r#"{"ok":true}"#));
                }
                Err(e) => {
                    let msg = format!(r#"{{"error":"invalid json: {}"}}"#, e);
                    let _ = stream.write_all(&http_response(400, &msg));
                }
            }
        }
    });
}
