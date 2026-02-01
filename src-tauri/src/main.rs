// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod stream;

use tauri::Manager;

#[tauri::command]
fn open_devtools(window: tauri::Window) {
    window.open_devtools();
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![stream::stream_fetch, open_devtools])
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .setup(|app| {
      // 在 debug 模式自動開啟開發者工具
      #[cfg(debug_assertions)]
      {
        let window = app.get_window("main").unwrap();
        window.open_devtools();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
