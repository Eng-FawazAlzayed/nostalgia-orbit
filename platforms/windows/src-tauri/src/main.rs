// Thin Windows shell around the shared web client (uses the system WebView2,
// so the installer stays a few MB). F11 toggles fullscreen.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Nostalgia Orbit");
}
