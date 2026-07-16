use tauri::AppHandle;
use tauri::WebviewWindow;

use crate::core::notify;

pub fn platform(
    app_handle: &AppHandle,
    _main_window: WebviewWindow,
    _preference_window: WebviewWindow,
) {
    notify::start(app_handle.clone());
}
