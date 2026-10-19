use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
const DEFAULT_HOTKEY: &str = "Alt+Space";
#[cfg(not(target_os = "macos"))]
const DEFAULT_HOTKEY: &str = "Ctrl+Shift+Space";

#[derive(Clone, Serialize)]
struct PopupPayload {
    text: Option<String>,
    /// Quick action to run right away (bound to its own global shortcut).
    action: Option<String>,
}

/// Registered global shortcuts and what they trigger: "open" or a quick-action id.
struct Bindings(Mutex<Vec<(Shortcut, String)>>);

#[derive(Deserialize)]
struct Binding {
    id: String,
    shortcut: String,
}

// ---------- API keys ----------
//
// Keys live in a JSON file inside the app's data directory, readable only by
// the current user (0600). The macOS Keychain would be nicer, but unsigned
// builds get a new identity on every update and macOS then asks for the login
// password each time. Switch back to `keyring` once the app is signed with a
// Developer ID.

fn secrets_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("secrets.json"))
}

fn secrets_read(app: &AppHandle) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let path = secrets_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .map(Ok)
            .unwrap_or_else(|| Ok(serde_json::Map::new())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Map::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn secrets_write(app: &AppHandle, map: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let path = secrets_path(app)?;
    let text = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
fn secret_set(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let mut map = secrets_read(&app)?;
    map.insert(provider, serde_json::Value::String(key));
    secrets_write(&app, &map)
}

#[tauri::command]
fn secret_get(app: AppHandle, provider: String) -> Result<Option<String>, String> {
    let map = secrets_read(&app)?;
    Ok(map.get(&provider).and_then(|v| v.as_str()).map(|s| s.to_string()))
}

#[tauri::command]
fn secret_delete(app: AppHandle, provider: String) -> Result<(), String> {
    let mut map = secrets_read(&app)?;
    map.remove(&provider);
    secrets_write(&app, &map)
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

fn show_popup(app: &AppHandle, action: Option<String>) {
    let text = app
        .clipboard()
        .read_text()
        .ok()
        .filter(|t| !t.trim().is_empty());

    if let Some(win) = app.get_webview_window("main") {
        // Centre the popup on the monitor the cursor is on, slightly above the middle
        // (Spotlight-style). The user can then drag it from the header.
        if let Ok(cursor) = app.cursor_position() {
            if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
                let size = win
                    .outer_size()
                    .unwrap_or(tauri::PhysicalSize::new(1120, 960));
                let mp = monitor.position();
                let ms = monitor.size();
                let x = mp.x as f64 + (ms.width as f64 - size.width as f64) / 2.0;
                let y = mp.y as f64 + (ms.height as f64 - size.height as f64) * 0.38;
                let _ = win.set_position(PhysicalPosition::new(x, y));
            }
        }
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit_to("main", "popup-open", PopupPayload { text, action });
    }
}

fn open_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    if let Ok(win) = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html".into()))
        .title("Hopper · Settings")
        .inner_size(900.0, 620.0)
        .min_inner_size(760.0, 520.0)
        .transparent(true)
        .build()
    {
        apply_glass(&win, GlassKind::Window);
    }
}

/// Tray menu items, relabelled when the interface language changes.
struct TrayItems(Mutex<Option<(MenuItem<tauri::Wry>, MenuItem<tauri::Wry>, PredefinedMenuItem<tauri::Wry>)>>);

#[tauri::command]
fn set_tray_labels(app: AppHandle, open: String, settings: String, quit: String) -> Result<(), String> {
    let items = app.state::<TrayItems>();
    let guard = items.0.lock().map_err(|e| e.to_string())?;
    if let Some((o, s, q)) = guard.as_ref() {
        o.set_text(&open).map_err(|e| e.to_string())?;
        s.set_text(&settings).map_err(|e| e.to_string())?;
        q.set_text(&quit).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_popup_cmd(app: AppHandle) {
    show_popup(&app, None);
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

/// Replaces every global shortcut. Returns the ids whose shortcut could not be
/// parsed or registered (typically because another app owns the combination).
#[tauri::command]
fn set_hotkeys(app: AppHandle, bindings: Vec<Binding>) -> Result<Vec<String>, String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let mut registered: Vec<(Shortcut, String)> = Vec::new();
    let mut failed = Vec::new();
    for b in bindings {
        let sc: Shortcut = match b.shortcut.parse() {
            Ok(sc) => sc,
            Err(_) => {
                failed.push(b.id);
                continue;
            }
        };
        if registered.iter().any(|(r, _)| r == &sc) || gs.register(sc).is_err() {
            failed.push(b.id);
            continue;
        }
        registered.push((sc, b.id));
    }
    *app.state::<Bindings>().0.lock().unwrap() = registered;
    Ok(failed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let target = app
                        .state::<Bindings>()
                        .0
                        .lock()
                        .unwrap()
                        .iter()
                        .find(|(sc, _)| sc == shortcut)
                        .map(|(_, id)| id.clone());
                    match target.as_deref() {
                        Some("open") | None => show_popup(app, None),
                        Some(action) => show_popup(app, Some(action.to_string())),
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(Bindings(Mutex::new(Vec::new())))
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
            // The frontend re-applies the saved bindings as soon as it loads.
            let shortcut: Shortcut = DEFAULT_HOTKEY.parse()?;
            match app.global_shortcut().register(shortcut) {
                Ok(()) => app.state::<Bindings>().0.lock().unwrap().push((shortcut, "open".into())),
                Err(e) => eprintln!("hotkey {DEFAULT_HOTKEY} not registered: {e}"),
            }

            // Tray menu.
            let open = MenuItem::with_id(app, "open", "Open assistant", true, Some(DEFAULT_HOTKEY))?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
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
                    "open" => show_popup(app, None),
                    "settings" => open_settings(app),
                    _ => {}
                })
                .build(app)?;
            // Kept so the frontend can relabel the menu in the chosen language.
            app.manage(TrayItems(Mutex::new(Some((open, settings, quit)))));
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
            set_hotkeys,
            set_tray_labels
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
