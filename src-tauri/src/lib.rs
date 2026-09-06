// Tauri entry point. Commands are registered here; the work lives in the
// printer, log, and settings modules.
pub mod command_error;
mod commands;
pub mod log;
pub mod platform;
pub mod printer;
pub mod settings;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // The print log is one SQLite file per machine (ADR 0004). It is
            // opened once here and shared by every command that touches it.
            //
            // A machine that will not let the app open a log is not a reason
            // to refuse to start. The window opens either way and every log
            // command answers with the reason, so the operator reads what is
            // wrong instead of watching the app fail to appear.
            app.manage(log::LogState::for_app(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_printers,
            commands::printer_state,
            commands::print_zpl,
            commands::record_print_run,
            commands::record_verification,
            commands::list_print_runs,
            commands::get_print_run,
            commands::get_settings,
            commands::set_settings,
            commands::storage_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
