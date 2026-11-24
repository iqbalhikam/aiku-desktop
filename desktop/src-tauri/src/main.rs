#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, State, WindowEvent};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
#[repr(C)]
struct WinPoint {
    x: i32,
    y: i32,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetAsyncKeyState(vkey: i32) -> i16;
    fn GetCursorPos(lp_point: *mut WinPoint) -> i32;
}

const CANVAS_WIDTH: f64 = 960.0;
const CANVAS_HEIGHT: f64 = 620.0;

#[derive(Clone, Copy)]
struct HitBox {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
    toast_left: f64,
    toast_top: f64,
    toast_right: f64,
    toast_bottom: f64,
    has_toast: bool,
    dragging: bool,
}

impl Default for HitBox {
    fn default() -> Self {
        Self {
            // Default tepat seukuran Idle Pill (220x38) di tengah kanvas 960px
            left: (CANVAS_WIDTH - 220.0) / 2.0,
            top: 0.0,
            right: (CANVAS_WIDTH + 220.0) / 2.0,
            bottom: 38.0,
            toast_left: 0.0,
            toast_top: 0.0,
            toast_right: 0.0,
            toast_bottom: 0.0,
            has_toast: false,
            dragging: false,
        }
    }
}

#[derive(Serialize)]
struct RpcRequest<'a> {
    id: u64,
    method: &'a str,
    params: Value,
}

#[derive(Deserialize)]
struct RpcResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

struct NodeRpcClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl NodeRpcClient {
    fn spawn() -> Result<Self, String> {
        let project_root = resolve_project_root()?;
        let worker_script = project_root.join("dist").join("rpc").join("worker.js");

        if !worker_script.exists() {
            return Err(format!(
                "Worker Node.js tidak ditemukan di {}. Jalankan `npm run build` terlebih dahulu.",
                worker_script.display()
            ));
        }

        let mut cmd = Command::new("node");
        cmd.arg(&worker_script)
            .current_dir(&project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        if let Ok(exe_path) = std::env::current_exe() {
            cmd.env("AIKU_TAURI_EXE", exe_path);
        }

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Gagal menjalankan Node.js sidecar: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Gagal membuka stdin Node.js sidecar".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Gagal membuka stdout Node.js sidecar".to_string())?;

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn call(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        app_handle: &tauri::AppHandle,
    ) -> Result<Value, String> {
        let req = RpcRequest { id, method, params };
        let mut line = serde_json::to_string(&req)
            .map_err(|e| format!("Gagal serialisasi JSON-RPC: {e}"))?;
        line.push('\n');

        self.stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("Gagal mengirim request ke Node.js sidecar: {e}"))?;
        self.stdin
            .flush()
            .map_err(|e| format!("Gagal flush stdin Node.js sidecar: {e}"))?;

        loop {
            let mut response_line = String::new();
            let bytes = self
                .stdout
                .read_line(&mut response_line)
                .map_err(|e| format!("Gagal membaca respons dari Node.js sidecar: {e}"))?;

            if bytes == 0 {
                return Err("Node.js sidecar menutup koneksi secara tak terduga.".to_string());
            }

            let trimmed = response_line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let raw_val: Value = serde_json::from_str(trimmed)
                .map_err(|e| format!("Respons JSON-RPC tidak valid: {e}"))?;

            // Jika baris ini adalah chunk token streaming real-time, langsung pancarkan ke UI!
            if let Some(chunk) = raw_val.get("stream").and_then(|v| v.as_str()) {
                let _ = app_handle.emit("ai-chat-chunk", chunk.to_string());
                continue;
            }

            let parsed: RpcResponse = serde_json::from_value(raw_val)
                .map_err(|e| format!("Struktur respons JSON-RPC tidak valid: {e}"))?;

            if parsed.ok {
                return Ok(parsed.result.unwrap_or(Value::Null));
            } else {
                return Err(parsed.error.unwrap_or_else(|| {
                    "Terjadi kesalahan tidak diketahui pada runtime.".to_string()
                }));
            }
        }
    }
}

impl Drop for NodeRpcClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct AppState {
    worker: Arc<Mutex<Option<NodeRpcClient>>>,
    hotkey_vks: Arc<Mutex<Vec<i32>>>,
    hit_box: Arc<Mutex<HitBox>>,
    next_id: AtomicU64,
}

fn resolve_project_root() -> Result<PathBuf, String> {
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("dist").join("rpc").join("worker.js").exists() {
            return Ok(cwd);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = manifest_dir.parent().and_then(|p| p.parent()) {
        if root.join("dist").join("rpc").join("worker.js").exists() {
            return Ok(root.to_path_buf());
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        for ancestor in exe_path.ancestors().skip(1) {
            if ancestor.join("dist").join("rpc").join("worker.js").exists() {
                return Ok(ancestor.to_path_buf());
            }
        }
    }

    Err("Tidak dapat menemukan root proyek aiKu (dist/rpc/worker.js). Jalankan `npm run build` terlebih dahulu.".to_string())
}

fn center_top_window(window: &tauri::WebviewWindow, width: f64, height: f64) {
    let clamped_w = width.clamp(220.0, 1200.0);
    let clamped_h = height.clamp(44.0, 720.0);
    let _ = window.set_size(LogicalSize::new(clamped_w, clamped_h));

    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let monitor_width = monitor.size().width as f64 / scale;
        let x = ((monitor_width - clamped_w) / 2.0).max(0.0);
        let _ = window.set_position(LogicalPosition::new(x, 0.0));
    }
}

fn parse_key_token_to_vk(token: &str) -> Option<i32> {
    let upper = token.trim().to_uppercase();
    match upper.as_str() {
        "CTRL" | "CONTROL" => Some(0x11),
        "ALT" | "MENU" => Some(0x12),
        "SHIFT" => Some(0x10),
        "WIN" | "META" | "SUPER" => Some(0x5B),
        "SPACE" | "SPACEBAR" => Some(0x20),
        "TAB" => Some(0x09),
        "ENTER" | "RETURN" => Some(0x0D),
        "ESC" | "ESCAPE" => Some(0x1B),
        "BACKSPACE" => Some(0x08),
        "INSERT" | "INS" => Some(0x2D),
        "DELETE" | "DEL" => Some(0x2E),
        "HOME" => Some(0x24),
        "END" => Some(0x23),
        "PAGEUP" | "PGUP" => Some(0x21),
        "PAGEDOWN" | "PGDN" => Some(0x22),
        "UP" | "ARROWUP" => Some(0x26),
        "DOWN" | "ARROWDOWN" => Some(0x28),
        "LEFT" | "ARROWLEFT" => Some(0x25),
        "RIGHT" | "ARROWRIGHT" => Some(0x27),
        "BACKQUOTE" | "`" | "TILDE" => Some(0xC0),
        "F1" => Some(0x70),
        "F2" => Some(0x71),
        "F3" => Some(0x72),
        "F4" => Some(0x73),
        "F5" => Some(0x74),
        "F6" => Some(0x75),
        "F7" => Some(0x76),
        "F8" => Some(0x77),
        "F9" => Some(0x78),
        "F10" => Some(0x79),
        "F11" => Some(0x7A),
        "F12" => Some(0x7B),
        _ => {
            let bytes = upper.as_bytes();
            if bytes.len() == 1 {
                let b = bytes[0];
                if (b'A'..=b'Z').contains(&b) || (b'0'..=b'9').contains(&b) {
                    return Some(b as i32);
                }
            }
            None
        }
    }
}

fn parse_hotkey_to_vks(hotkey: &str) -> Vec<i32> {
    let mut vks = Vec::new();
    for part in hotkey.split('+') {
        if let Some(vk) = parse_key_token_to_vk(part) {
            if !vks.contains(&vk) {
                vks.push(vk);
            }
            if vks.len() >= 3 {
                break;
            }
        }
    }
    vks
}

fn load_initial_hotkey_vks() -> Vec<i32> {
    if let Ok(root) = resolve_project_root() {
        let cfg_path = root.join("aiku.config.json");
        if let Ok(content) = std::fs::read_to_string(cfg_path) {
            if let Ok(json) = serde_json::from_str::<Value>(&content) {
                if let Some(hk) = json.get("hotkey").and_then(|v| v.as_str()) {
                    let parsed = parse_hotkey_to_vks(hk);
                    if !parsed.is_empty() {
                        return parsed;
                    }
                }
            }
        }
    }
    // Default aman & ergonomis: Alt+Space
    vec![0x12, 0x20]
}

/// Global Custom Hotkey + Pixel-Exact Click-Through Hit-Testing Daemon (~0% CPU).
/// Memastikan HANYA area hitam Dynamic Island (dan toast aktif) yang menerima sentuhan/klik mouse,
/// sedangkan seluruh ruang transparan di sekelilingnya 100% tembus klik ke aplikasi di bawahnya!
#[cfg(target_os = "windows")]
fn spawn_island_daemon(
    app_handle: tauri::AppHandle,
    hotkey_vks: Arc<Mutex<Vec<i32>>>,
    hit_box: Arc<Mutex<HitBox>>,
) {
    std::thread::spawn(move || {
        const MODIFIERS: [i32; 3] = [0x11, 0x12, 0x10]; // Ctrl, Alt, Shift
        let mut was_triggered = false;
        let mut last_ignore_cursor: Option<bool> = None;
        let mut last_in_island = false;
        let mut prev_mouse_down = false;

        loop {
            std::thread::sleep(Duration::from_millis(16));

            // 1. Cek Global Custom Hotkey (1-3 tombol)
            let current_vks: Vec<i32> = match hotkey_vks.lock() {
                Ok(guard) => guard.clone(),
                Err(_) => Vec::new(),
            };

            if !current_vks.is_empty() {
                let all_pressed = current_vks
                    .iter()
                    .all(|&vk| unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 });

                let extra_mod_down = MODIFIERS.iter().any(|&m| {
                    !current_vks.contains(&m)
                        && unsafe { (GetAsyncKeyState(m) as u16 & 0x8000) != 0 }
                });

                if all_pressed && !extra_mod_down {
                    if !was_triggered {
                        was_triggered = true;
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.emit("island-toggle-hide", ());
                            } else {
                                center_top_window(&window, CANVAS_WIDTH, CANVAS_HEIGHT);
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.emit("island-summon", ());
                            }
                        }
                    }
                } else {
                    was_triggered = false;
                }
            } else {
                was_triggered = false;
            }

            // 2. Pixel-Exact Hit-Testing terhadap batas nyata Dynamic Island
            if let Some(window) = app_handle.get_webview_window("main") {
                if !window.is_visible().unwrap_or(false) {
                    last_ignore_cursor = None;
                    last_in_island = false;
                    continue;
                }

                let mut pt = WinPoint { x: 0, y: 0 };
                if unsafe { GetCursorPos(&mut pt) } != 0 {
                    if let Ok(win_pos) = window.outer_position() {
                        let scale = window.scale_factor().unwrap_or(1.0);
                        let rel_x = (pt.x - win_pos.x) as f64 / scale;
                        let rel_y = (pt.y - win_pos.y) as f64 / scale;

                        let hb = hit_box.lock().map(|g| *g).unwrap_or_default();

                        // Di tepi atas (y <= 15px), sertakan kuping cekung (14px kiri & kanan)
                        let ear_pad = if (0.0..=15.0).contains(&rel_y) {
                            14.0
                        } else {
                            0.0
                        };

                        let in_island = rel_x >= (hb.left - ear_pad)
                            && rel_x <= (hb.right + ear_pad)
                            && rel_y >= hb.top.min(0.0)
                            && rel_y <= hb.bottom;

                        let in_toast = hb.has_toast
                            && rel_x >= hb.toast_left
                            && rel_x <= hb.toast_right
                            && rel_y >= hb.toast_top
                            && rel_y <= hb.toast_bottom;

                        if in_island != last_in_island {
                            last_in_island = in_island;
                            if in_island {
                                let _ = window.emit("island-cursor-enter", ());
                            } else {
                                let _ = window.emit("island-cursor-leave", ());
                            }
                        }

                        let interactive = hb.dragging || in_island || in_toast;
                        let should_ignore = !interactive;

                        if last_ignore_cursor != Some(should_ignore) {
                            if window.set_ignore_cursor_events(should_ignore).is_ok() {
                                last_ignore_cursor = Some(should_ignore);
                            }
                        }

                        // Klik di luar batas Dynamic Island -> tembus ke app di bawahnya & langsung lipat ke Fase 1!
                        let mouse_down = unsafe {
                            ((GetAsyncKeyState(0x01) as u16 & 0x8000) != 0)
                                || ((GetAsyncKeyState(0x02) as u16 & 0x8000) != 0)
                        };
                        if mouse_down && !prev_mouse_down && !interactive {
                            let _ = window.emit("island-blur", ());
                        }
                        prev_mouse_down = mouse_down;
                    }
                }
            }
        }
    });
}

#[tauri::command]
async fn rpc_call(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let worker_arc = Arc::clone(&state.worker);
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let payload_params = params.unwrap_or_else(|| Value::Object(Default::default()));

    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = worker_arc
            .lock()
            .map_err(|_| "Gagal mengunci state Node.js sidecar.".to_string())?;

        let needs_spawn = match guard.as_mut() {
            Some(client) => !client.is_alive(),
            None => true,
        };

        if needs_spawn {
            *guard = Some(NodeRpcClient::spawn()?);
        }

        let client = guard
            .as_mut()
            .ok_or_else(|| "Node.js sidecar tidak tersedia.".to_string())?;

        client.call(id, &method, payload_params, &app)
    })
    .await
    .map_err(|e| format!("Task RPC gagal dijalankan: {e}"))?
}

#[tauri::command]
fn hide_island(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn resize_island(_app: tauri::AppHandle, _width: f64, _height: f64) {
    // Kanvas kini tetap 960x620 dengan click-through presisi per piksel (update_hit_box) -> zero clipping & zero HWND flicker
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn update_hit_box(
    state: State<'_, AppState>,
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
    toast_left: f64,
    toast_top: f64,
    toast_right: f64,
    toast_bottom: f64,
    has_toast: bool,
    dragging: bool,
) {
    if let Ok(mut guard) = state.hit_box.lock() {
        *guard = HitBox {
            left,
            top,
            right,
            bottom,
            toast_left,
            toast_top,
            toast_right,
            toast_bottom,
            has_toast,
            dragging,
        };
    }
}

#[tauri::command]
fn set_global_hotkey(state: State<'_, AppState>, hotkey: String) -> Result<String, String> {
    let vks = parse_hotkey_to_vks(&hotkey);
    if vks.is_empty() || vks.len() > 3 {
        return Err("Hotkey harus terdiri dari 1 hingga 3 tombol yang valid.".to_string());
    }
    let mut guard = state
        .hotkey_vks
        .lock()
        .map_err(|_| "Gagal memperbarui hotkey global.".to_string())?;
    *guard = vks;
    Ok(hotkey)
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let hotkey_vks = Arc::new(Mutex::new(load_initial_hotkey_vks()));
    let hotkey_vks_for_thread = Arc::clone(&hotkey_vks);
    let hit_box = Arc::new(Mutex::new(HitBox::default()));
    let hit_box_for_thread = Arc::clone(&hit_box);

    let app_state = AppState {
        worker: Arc::new(Mutex::new(None)),
        hotkey_vks,
        hit_box,
        next_id: AtomicU64::new(1),
    };

    tauri::Builder::default()
        .manage(app_state)
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                center_top_window(&window, CANVAS_WIDTH, CANVAS_HEIGHT);
                // Aktifkan click-through sejak awal; daemon 60Hz otomatis membuka interaksi tepat saat kursor menyentuh Dynamic Island
                let _ = window.set_ignore_cursor_events(true);
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        let _ = win_clone.emit("island-blur", ());
                    }
                });
            }

            #[cfg(target_os = "windows")]
            spawn_island_daemon(app.handle().clone(), hotkey_vks_for_thread, hit_box_for_thread);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            rpc_call,
            hide_island,
            resize_island,
            update_hit_box,
            set_global_hotkey,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("Gagal menjalankan aplikasi desktop aiKu");
}
