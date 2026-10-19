use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use base64::Engine;

#[cfg(target_os = "macos")]
const DEFAULT_HOTKEY: &str = "Alt+Space";
#[cfg(not(target_os = "macos"))]
const DEFAULT_HOTKEY: &str = "Ctrl+Shift+Space";

#[derive(Clone, Serialize, Default)]
struct PopupPayload {
    text: Option<String>,
    /// PNG, base64: a screenshot or an image from the clipboard.
    image: Option<String>,
    /// Quick action to run right away (bound to its own global shortcut).
    action: Option<String>,
    /// Something the popup must explain instead ("screen-recording").
    error: Option<String>,
    /// The image comes from the region picker rather than the clipboard.
    shot: bool,
}

/// Behaviour the frontend configures from Settings.
struct Prefs(Mutex<PrefsInner>);
#[derive(Default)]
struct PrefsInner {
    /// Press Cmd+C / Ctrl+C at the hotkey to read the current selection.
    grab_selection: bool,
}

#[tauri::command]
fn set_prefs(app: AppHandle, grab_selection: bool) {
    app.state::<Prefs>().0.lock().unwrap().grab_selection = grab_selection;
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

// ---------- Selection, images, screenshots ----------

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGEventSourceFlagsState(state: i32) -> u64;
}

/// True while the user still holds a modifier key (the hotkey's own, typically).
fn modifiers_held() -> bool {
    #[cfg(target_os = "macos")]
    {
        const HID_SYSTEM_STATE: i32 = 1;
        const MASK: u64 = 0x20000 | 0x40000 | 0x80000 | 0x100000; // shift, control, option, command
        unsafe { CGEventSourceFlagsState(HID_SYSTEM_STATE) & MASK != 0 }
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};
        [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
            .iter()
            .any(|&k| (unsafe { GetAsyncKeyState(k as i32) } as u16) & 0x8000 != 0)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

/// Simulates the copy shortcut in the frontmost app and returns the selection
/// if the clipboard changed. The previous clipboard content is put back.
fn grab_selection(app: &AppHandle) -> Option<String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    if !accessibility_granted() {
        return None;
    }
    let before_text = app.clipboard().read_text().ok();
    let before_image = if before_text.is_none() {
        app.clipboard().read_image().ok().map(|i| i.to_owned())
    } else {
        None
    };

    // The hotkey's modifiers are usually still down: wait for them, otherwise the
    // app receives e.g. Option+Cmd+C instead of Cmd+C.
    for _ in 0..40 {
        if !modifiers_held() {
            break;
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    let mut enigo = Enigo::new(&Settings::default()).ok()?;
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;
    enigo.key(modifier, Direction::Press).ok()?;
    let clicked = enigo.key(Key::Unicode('c'), Direction::Click);
    let _ = enigo.key(modifier, Direction::Release);
    clicked.ok()?;
    std::thread::sleep(Duration::from_millis(150));

    let after = app.clipboard().read_text().ok().filter(|t| !t.trim().is_empty())?;
    if before_text.as_deref() == Some(after.as_str()) {
        return None;
    }
    if let Some(t) = before_text {
        let _ = app.clipboard().write_text(t);
    } else if let Some(img) = before_image {
        let _ = app.clipboard().write_image(&img);
    } else {
        let _ = app.clipboard().clear();
    }
    Some(after)
}

fn png_base64(img: &tauri::image::Image<'_>) -> Option<String> {
    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, img.width(), img.height());
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().ok()?;
        w.write_image_data(img.rgba()).ok()?;
    }
    Some(base64::engine::general_purpose::STANDARD.encode(buf))
}

fn clipboard_image_base64(app: &AppHandle) -> Option<String> {
    let img = app.clipboard().read_image().ok()?;
    if img.width() == 0 || img.height() == 0 {
        return None;
    }
    png_base64(&img)
}

#[tauri::command]
fn screen_recording_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { CGPreflightScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
fn screen_recording_prompt(app: AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        let granted = unsafe { CGRequestScreenCaptureAccess() };
        if !granted {
            // macOS shows its dialog only once; afterwards send the user to the pane.
            let _ = app
                .opener()
                .open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", None::<&str>);
        }
        granted
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        true
    }
}

/// Lets the user pick a screen region, then opens the popup with the image.
fn take_screenshot(app: &AppHandle, action: Option<String>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    #[cfg(target_os = "macos")]
    if !screen_recording_granted() {
        present_popup(app, PopupPayload { error: Some("screen-recording".into()), ..Default::default() });
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let image = capture_region(&app);
        if let Some(image) = image {
            present_popup(&app, PopupPayload { image: Some(image), action, shot: true, ..Default::default() });
        }
    });
}

#[cfg(target_os = "macos")]
fn capture_region(_app: &AppHandle) -> Option<String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("hopper-shot-{nanos}.png"));
    // The system's own region picker (same as Cmd+Shift+4); Esc cancels and writes nothing.
    let _ = std::process::Command::new("screencapture")
        .args(["-i", "-x", "-t", "png"])
        .arg(&path)
        .status();
    let bytes = std::fs::read(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    if bytes.is_empty() {
        return None;
    }
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(target_os = "windows")]
fn capture_region(app: &AppHandle) -> Option<String> {
    // Snipping Tool's region picker puts the clip on the clipboard; wait for it.
    let before = app.clipboard().read_image().ok().map(|i| i.rgba().to_vec());
    std::process::Command::new("explorer.exe").arg("ms-screenclip:").spawn().ok()?;
    for _ in 0..300 {
        std::thread::sleep(Duration::from_millis(300));
        if let Ok(img) = app.clipboard().read_image() {
            if img.width() > 0 && before.as_deref() != Some(img.rgba()) {
                return png_base64(&img);
            }
        }
    }
    None
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn capture_region(_app: &AppHandle) -> Option<String> {
    None
}

#[tauri::command]
fn take_screenshot_cmd(app: AppHandle) {
    take_screenshot(&app, None);
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

/// Opens the popup on the selection if there is one, else on the clipboard
/// (text first, then an image).
fn show_popup(app: &AppHandle, action: Option<String>) {
    let grab = app.state::<Prefs>().0.lock().unwrap().grab_selection;
    let mut text = if grab { grab_selection(app) } else { None };
    if text.is_none() {
        text = app
            .clipboard()
            .read_text()
            .ok()
            .filter(|t| !t.trim().is_empty());
    }
    let image = if text.is_none() { clipboard_image_base64(app) } else { None };
    present_popup(app, PopupPayload { text, image, action, ..Default::default() });
}

fn present_popup(app: &AppHandle, payload: PopupPayload) {
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
        let _ = app.emit_to("main", "popup-open", payload);
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
struct TrayItems(Mutex<Option<(MenuItem<tauri::Wry>, MenuItem<tauri::Wry>, MenuItem<tauri::Wry>, PredefinedMenuItem<tauri::Wry>)>>);

#[tauri::command]
fn set_tray_labels(app: AppHandle, open: String, shot: String, settings: String, quit: String) -> Result<(), String> {
    let items = app.state::<TrayItems>();
    let guard = items.0.lock().map_err(|e| e.to_string())?;
    if let Some((o, c, s, q)) = guard.as_ref() {
        o.set_text(&open).map_err(|e| e.to_string())?;
        c.set_text(&shot).map_err(|e| e.to_string())?;
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
                        Some("shot") => take_screenshot(app, None),
                        Some(action) => show_popup(app, Some(action.to_string())),
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(Bindings(Mutex::new(Vec::new())))
        .manage(Prefs(Mutex::new(PrefsInner::default())))
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
            let shot = MenuItem::with_id(app, "shot", "Capture screen…", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
            let menu = Menu::with_items(
                app,
                &[&open, &shot, &settings, &PredefinedMenuItem::separator(app)?, &quit],
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
                    "shot" => take_screenshot(app, None),
                    "settings" => open_settings(app),
                    _ => {}
                })
                .build(app)?;
            // Kept so the frontend can relabel the menu in the chosen language.
            app.manage(TrayItems(Mutex::new(Some((open, shot, settings, quit)))));
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
            set_tray_labels,
            set_prefs,
            screen_recording_granted,
            screen_recording_prompt,
            take_screenshot_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
