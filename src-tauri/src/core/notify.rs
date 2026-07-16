use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Runtime};

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
}

fn default_source() -> String { "unknown".into() }
fn default_kind() -> String { "info".into() }

const VALID_KINDS: &[&str] = &["info", "need-input", "done", "warn", "error", "schedule"];

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
    p
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
        let listener = match TcpListener::bind(BIND_ADDR) {
            Ok(l) => {
                log::info!("[notify] listening on http://{}", BIND_ADDR);
                l
            }
            Err(e) => {
                log::warn!("[notify] bind failed: {}", e);
                RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };

        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => continue,
            };

            let mut buf = vec![0u8; MAX_BODY + 4096];
            let n = match stream.read(&mut buf) {
                Ok(n) => n,
                Err(_) => continue,
            };
            let raw = String::from_utf8_lossy(&buf[..n]);

            // Reject anything with an Origin header (browser CSRF protection).
            if raw.contains("\r\nOrigin:") || raw.contains("\r\norigin:") {
                let _ = stream.write_all(&http_response(400, r#"{"error":"origin rejected"}"#));
                continue;
            }

            // Only accept POST /notify
            if !raw.starts_with("POST /notify") {
                let _ = stream.write_all(&http_response(405, r#"{"error":"use POST /notify"}"#));
                continue;
            }

            // Require X-Pixo-Notify header (CORS preflight blocker).
            let has_marker = raw.contains("X-Pixo-Notify:") || raw.contains("x-pixo-notify:");
            if !has_marker {
                let _ = stream.write_all(&http_response(400, r#"{"error":"missing X-Pixo-Notify header"}"#));
                continue;
            }

            // Extract JSON body (after \r\n\r\n).
            let body = raw.find("\r\n\r\n").map(|i| &raw[i + 4..]).unwrap_or("");

            match serde_json::from_str::<NotifyPayload>(body) {
                Ok(payload) => {
                    let payload = normalize(payload);
                    log::info!("[notify] {}/{}: {}", payload.source, payload.kind, payload.message);
                    let _ = app_handle.emit("pixo-notify", &payload);
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
