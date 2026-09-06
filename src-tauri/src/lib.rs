// Tauri entry point. Commands are registered here; the work lives in the
// printer and log modules that the build tasks add.
mod commands;
pub mod printer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::list_printers,
            commands::printer_state,
            commands::print_zpl,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
