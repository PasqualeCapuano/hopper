//! Dictation: hold (or toggle) a hotkey, speak, and the text lands where the
//! cursor is. Rust records the microphone and shows a small overlay; the main
//! webview transcribes the WAV with the chosen provider, cleans it up and asks
//! Rust to paste it.

use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub struct Dictation(pub Mutex<Inner>);

#[derive(Default)]
pub struct Inner {
    /// Stops the recording thread; `Some` while recording.
    stop: Option<mpsc::Sender<()>>,
    started: Option<Instant>,
    /// Press to start, press again to stop (instead of hold-to-talk).
    pub toggle: bool,
    /// The hotkey is physically down: later Pressed events are key repeats.
    key_down: bool,
    /// Microphone name chosen in Settings; `None` = system default.
    pub device: Option<String>,
}

/// Input devices the user can pick from, in the host's order.
#[tauri::command]
pub fn list_microphones() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|it| it.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

/// The chosen device if it is still around, otherwise the system default.
fn pick_device(app: &AppHandle) -> Result<(cpal::Device, String), String> {
    let host = cpal::default_host();
    let wanted = app.state::<Dictation>().0.lock().unwrap().device.clone();
    if let Some(name) = wanted.filter(|n| !n.is_empty()) {
        if let Ok(mut devices) = host.input_devices() {
            if let Some(d) = devices.find(|d| d.name().ok().as_deref() == Some(name.as_str())) {
                return Ok((d, name));
            }
        }
    }
    let d = host.default_input_device().ok_or("no-mic")?;
    let name = d.name().unwrap_or_else(|_| "default".into());
    Ok((d, name))
}

#[derive(Clone, Serialize)]
struct StatePayload {
    state: &'static str,
    message: Option<String>,
}

#[derive(Clone, Serialize)]
struct LevelPayload {
    level: f32,
}

#[derive(Clone, Serialize)]
struct AudioPayload {
    wav: String,
    seconds: f32,
}

const MAX_SECONDS: f32 = 120.0;
const TARGET_RATE: u32 = 16_000;
const OVERLAY_W: f64 = 320.0;
const OVERLAY_H: f64 = 64.0;

// ---------- Overlay window ----------

fn overlay(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window("dictation") {
        return Some(w);
    }
    let win = WebviewWindowBuilder::new(app, "dictation", WebviewUrl::App("index.html".into()))
        .title("Hopper")
        .inner_size(OVERLAY_W, OVERLAY_H)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .resizable(false)
        .visible(false)
        .build()
        .ok()?;
    crate::apply_glass(&win, crate::GlassKind::Popup);
    Some(win)
}

fn set_state(app: &AppHandle, state: &'static str, message: Option<String>) {
    let _ = app.emit_to("dictation", "dictation-state", StatePayload { state, message });
}

/// Shows the pill at the bottom centre of the monitor the cursor is on, without taking focus.
fn show_overlay(app: &AppHandle) {
    let Some(win) = overlay(app) else { return };
    if let Ok(cursor) = app.cursor_position() {
        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            let size = win.outer_size().unwrap_or(tauri::PhysicalSize::new(640, 128));
            let mp = monitor.position();
            let ms = monitor.size();
            let scale = monitor.scale_factor();
            let x = mp.x as f64 + (ms.width as f64 - size.width as f64) / 2.0;
            let y = mp.y as f64 + ms.height as f64 - size.height as f64 - 72.0 * scale;
            let _ = win.set_position(PhysicalPosition::new(x, y));
        }
    }
    let _ = win.show();
}

fn hide_overlay(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("dictation") {
        let _ = win.hide();
    }
}

fn hide_later(app: &AppHandle, ms: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ms));
        hide_overlay(&app);
    });
}

// ---------- Recording ----------

pub fn start(app: &AppHandle) {
    {
        let state = app.state::<Dictation>();
        let mut inner = state.0.lock().unwrap();
        if inner.stop.is_some() {
            return;
        }
        let (tx, rx) = mpsc::channel::<()>();
        inner.stop = Some(tx);
        inner.started = Some(Instant::now());
        let app2 = app.clone();
        std::thread::spawn(move || {
            let result = record(&app2, rx);
            finish(&app2, result);
        });
    }
    show_overlay(app);
    set_state(app, "listening", None);
}

pub fn stop(app: &AppHandle) {
    let state = app.state::<Dictation>();
    let tx = state.0.lock().unwrap().stop.take();
    if let Some(tx) = tx {
        let _ = tx.send(());
    }
}

/// Mono samples at the device rate, until the stop signal or the time cap.
fn record(app: &AppHandle, rx: mpsc::Receiver<()>) -> Result<(Vec<f32>, u32, String), String> {
    let (device, name) = pick_device(app)?;
    let config = device.default_input_config().map_err(|e| e.to_string())?;
    let rate = config.sample_rate().0;
    let channels = config.channels().max(1) as usize;
    let buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let meter = Arc::new(Mutex::new(Instant::now()));
    let err_fn = |e: cpal::StreamError| eprintln!("microphone: {e}");

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let (b, a, m) = (buf.clone(), app.clone(), meter.clone());
            device.build_input_stream(&config.into(), move |data: &[f32], _| push(&b, &a, &m, data, channels), err_fn, None)
        }
        cpal::SampleFormat::I16 => {
            let (b, a, m) = (buf.clone(), app.clone(), meter.clone());
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    let v: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                    push(&b, &a, &m, &v, channels)
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let (b, a, m) = (buf.clone(), app.clone(), meter.clone());
            device.build_input_stream(
                &config.into(),
                move |data: &[u16], _| {
                    let v: Vec<f32> = data.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).collect();
                    push(&b, &a, &m, &v, channels)
                },
                err_fn,
                None,
            )
        }
        other => return Err(format!("Unsupported microphone format {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    let _ = rx.recv_timeout(Duration::from_secs_f32(MAX_SECONDS));
    drop(stream);
    let samples = std::mem::take(&mut *buf.lock().unwrap());
    Ok((samples, rate, name))
}

/// Downmixes a callback's frames to mono and feeds the level meter (~20 fps).
fn push(buf: &Mutex<Vec<f32>>, app: &AppHandle, meter: &Mutex<Instant>, data: &[f32], channels: usize) {
    let mut out = buf.lock().unwrap();
    let mut sum = 0f32;
    let mut n = 0usize;
    for frame in data.chunks(channels) {
        let s = frame.iter().sum::<f32>() / channels as f32;
        out.push(s);
        sum += s * s;
        n += 1;
    }
    drop(out);
    let mut last = meter.lock().unwrap();
    if n > 0 && last.elapsed() >= Duration::from_millis(50) {
        *last = Instant::now();
        let rms = (sum / n as f32).sqrt();
        let _ = app.emit_to("dictation", "dictation-level", LevelPayload { level: (rms * 6.0).min(1.0) });
    }
}

fn finish(app: &AppHandle, result: Result<(Vec<f32>, u32, String), String>) {
    let started = {
        let state = app.state::<Dictation>();
        let mut inner = state.0.lock().unwrap();
        inner.stop = None;
        inner.started.take()
    };
    let seconds = started.map(|t| t.elapsed().as_secs_f32()).unwrap_or(0.0);
    match result {
        Err(e) => {
            set_state(app, "error", Some(e));
            hide_later(app, 3000);
        }
        Ok((samples, rate, device)) => {
            // A tap shorter than this is an accident, not a sentence.
            if seconds < 0.4 || samples.is_empty() {
                hide_overlay(app);
                return;
            }
            let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs()));
            if peak < 0.004 {
                // Name the device: a paired headset that is not really in use is the usual culprit.
                set_state(app, "error", Some(format!("no-audio:{device}")));
                hide_later(app, 6000);
                return;
            }
            set_state(app, "transcribing", None);
            let wav = encode_wav(&samples, rate);
            let _ = app.emit_to("main", "dictation-audio", AudioPayload { wav, seconds });
        }
    }
}

/// 16 kHz mono 16-bit WAV, base64. Linear resampling is plenty for speech.
fn encode_wav(samples: &[f32], rate: u32) -> String {
    let ratio = rate as f64 / TARGET_RATE as f64;
    let out_len = (samples.len() as f64 / ratio) as usize;
    let spec = hound::WavSpec { channels: 1, sample_rate: TARGET_RATE, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
    {
        let mut w = hound::WavWriter::new(&mut cursor, spec).expect("wav header");
        for i in 0..out_len {
            let pos = i as f64 * ratio;
            let j = pos as usize;
            let frac = (pos - j as f64) as f32;
            let a = samples[j.min(samples.len() - 1)];
            let b = samples[(j + 1).min(samples.len() - 1)];
            let s = (a + (b - a) * frac).clamp(-1.0, 1.0);
            let _ = w.write_sample((s * 32767.0) as i16);
        }
        let _ = w.finalize();
    }
    base64::engine::general_purpose::STANDARD.encode(cursor.into_inner())
}

// ---------- Hotkey and commands ----------

/// Hold mode: Pressed starts, Released stops. Toggle mode: Pressed alternates.
/// Key repeats (Pressed while already down) are ignored.
pub fn hotkey(app: &AppHandle, pressed: bool) {
    let (recording, toggle, repeat) = {
        let state = app.state::<Dictation>();
        let mut inner = state.0.lock().unwrap();
        let repeat = pressed && inner.key_down;
        inner.key_down = pressed;
        (inner.stop.is_some(), inner.toggle, repeat)
    };
    if repeat {
        return;
    }
    if toggle {
        if pressed {
            if recording { stop(app) } else { start(app) }
        }
    } else if pressed {
        if !recording { start(app) }
    } else if recording {
        stop(app)
    }
}

#[tauri::command]
pub fn dictation_start(app: AppHandle) {
    start(&app);
}

#[tauri::command]
pub fn dictation_stop(app: AppHandle) {
    stop(&app);
}

/// The webview reports the end of transcription: hide the pill, or show why it failed.
#[tauri::command]
pub fn dictation_done(app: AppHandle, error: Option<String>) {
    match error {
        Some(e) => {
            set_state(&app, "error", Some(e));
            hide_later(&app, 4000);
        }
        None => hide_overlay(&app),
    }
}

/// Types `text` where the cursor is (clipboard + paste shortcut) and restores the clipboard.
#[tauri::command]
pub fn dictation_insert(app: AppHandle, text: String) -> Result<(), String> {
    let before_text = app.clipboard().read_text().ok();
    let before_image = if before_text.is_none() { app.clipboard().read_image().ok().map(|i| i.to_owned()) } else { None };
    app.clipboard().write_text(text).map_err(|e| e.to_string())?;
    crate::wait_modifiers_released();
    std::thread::sleep(Duration::from_millis(60));
    crate::press_paste()?;
    std::thread::sleep(Duration::from_millis(300));
    if let Some(t) = before_text {
        let _ = app.clipboard().write_text(t);
    } else if let Some(img) = before_image {
        let _ = app.clipboard().write_image(&img);
    }
    Ok(())
}
