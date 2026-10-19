use serde::Serialize;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const KEYRING_SERVICE: &str = "com.pasqualecapuano.hopper";
const DEFAULT_HOTKEY: &str = "Alt+Space";

#[derive(Clone, Serialize)]
struct PopupPayload {
    text: Option<String>,
}

// ---------- Keychain / Credential Manager ----------

#[tauri::command]
fn secret_set(provider: String, key: String) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, &provider)
        .map_err(|e| e.to_string())?
        .set_password(&key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(provider: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(provider: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- Paste into the active app ----------

#[tauri::command]
fn accessibility_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_accessibility_client::accessibility::application_is_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
fn accessibility_prompt() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_accessibility_client::accessibility::application_is_trusted_with_prompt()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Writes `text` to the clipboard, hides the popup and simulates Cmd+V / Ctrl+V
/// in whatever app was active before the popup opened.
#[tauri::command]
fn paste_text(app: AppHandle, text: String) -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    app.clipboard().write_text(text).map_err(|e| e.to_string())?;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    // Give the OS a moment to hand focus back to the previous app.
    std::thread::sleep(Duration::from_millis(180));

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo.key(modifier, Direction::Press).map_err(|e| e.to_string())?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| e.to_string())?;
    enigo
        .key(modifier, Direction::Release)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Glass ----------

enum GlassKind {
    Popup,
    Window,
}

/// Native translucency behind the webview: vibrancy on macOS, acrylic on Windows.
/// The CSS paints translucent surfaces on top of this blur.
fn apply_glass(win: &tauri::WebviewWindow, kind: GlassKind) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        let (material, radius) = match kind {
            GlassKind::Popup => (NSVisualEffectMaterial::Popover, Some(22.0)),
            GlassKind::Window => (NSVisualEffectMaterial::Sidebar, None),
        };
        if let Err(e) = apply_vibrancy(win, material, Some(NSVisualEffectState::Active), radius) {
            eprintln!("vibrancy not applied: {e}");
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = kind;
        if let Err(e) = window_vibrancy::apply_acrylic(win, Some((18, 18, 18, 120))) {
            eprintln!("acrylic not applied: {e}");
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (win, kind);
    }
}

// ---------- Windows ----------

fn show_popup(app: &AppHandle) {
    let text = app
        .clipboard()
        .read_text()
        .ok()
        .filter(|t| !t.trim().is_empty());

    if let Some(win) = app.get_webview_window("main") {
        // Place the popup near the cursor, kept inside the monitor the cursor is on.
        if let Ok(cursor) = app.cursor_position() {
            let size = win
                .outer_size()
                .unwrap_or(tauri::PhysicalSize::new(1120, 960));
            let (mut x, mut y) = (cursor.x - size.width as f64 / 2.0, cursor.y + 16.0);
            if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
                let mp = monitor.position();
                let ms = monitor.size();
                let max_x = mp.x as f64 + ms.width as f64 - size.width as f64 - 8.0;
                let max_y = mp.y as f64 + ms.height as f64 - size.height as f64 - 8.0;
                x = x.max(mp.x as f64 + 8.0).min(max_x);
                y = y.max(mp.y as f64 + 8.0).min(max_y);
            }
            let _ = win.set_position(PhysicalPosition::new(x, y));
        }
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit_to("main", "popup-open", PopupPayload { text });
    }
}

fn open_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    if let Ok(win) = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html".into()))
        .title("Hopper · Impostazioni")
        .inner_size(900.0, 620.0)
        .min_inner_size(760.0, 520.0)
        .transparent(true)
        .build()
    {
        apply_glass(&win, GlassKind::Window);
    }
}

#[tauri::command]
fn show_popup_cmd(app: AppHandle) {
    show_popup(&app);
}

#[tauri::command]
fn open_settings_cmd(app: AppHandle) {
    open_settings(&app);
}

#[tauri::command]
fn hide_popup(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn set_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    let shortcut: Shortcut = hotkey.parse().map_err(|e| format!("{e:?}"))?;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    gs.register(shortcut).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_popup(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Menu-bar app: no Dock icon on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Liquid glass: the window is transparent and the OS blurs whatever is behind it.
            if let Some(win) = app.get_webview_window("main") {
                apply_glass(&win, GlassKind::Popup);
            }

            // Default hotkey; the settings window can replace it via `set_hotkey`.
            // Non-fatal: another app (e.g. Claude Desktop) may already own the combo;
            // the user can pick a different one in Settings › Scorciatoie.
            let shortcut: Shortcut = DEFAULT_HOTKEY.parse()?;
            if let Err(e) = app.global_shortcut().register(shortcut) {
                eprintln!("hotkey {DEFAULT_HOTKEY} not registered: {e}");
            }

            // Tray menu.
            let open = MenuItem::with_id(app, "open", "Apri assistente", true, Some(DEFAULT_HOTKEY))?;
            let settings = MenuItem::with_id(app, "settings", "Impostazioni…", true, None::<&str>)?;
            let quit = PredefinedMenuItem::quit(app, Some("Esci"))?;
            let menu = Menu::with_items(
                app,
                &[&open, &settings, &PredefinedMenuItem::separator(app)?, &quit],
            )?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("tray")
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("Hopper")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_popup(app),
                    "settings" => open_settings(app),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secret_set,
            secret_get,
            secret_delete,
            accessibility_granted,
            accessibility_prompt,
            paste_text,
            show_popup_cmd,
            open_settings_cmd,
            hide_popup,
            set_hotkey
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
