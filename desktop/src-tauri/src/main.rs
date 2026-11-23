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
extern "system" {
    fn GetAsyncKeyState(vkey: i32) -> i16;
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

    fn call(&mut self, id: u64, method: &str, params: Value) -> Result<Value, String> {
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

        let mut response_line = String::new();
        let bytes = self
            .stdout
            .read_line(&mut response_line)
            .map_err(|e| format!("Gagal membaca respons dari Node.js sidecar: {e}"))?;

        if bytes == 0 {
            return Err("Node.js sidecar menutup koneksi secara tak terduga.".to_string());
        }

        let parsed: RpcResponse = serde_json::from_str(response_line.trim())
            .map_err(|e| format!("Respons JSON-RPC tidak valid: {e}"))?;

        if parsed.ok {
            Ok(parsed.result.unwrap_or(Value::Null))
        } else {
            Err(parsed
                .error
                .unwrap_or_else(|| "Terjadi kesalahan tidak diketahui pada runtime.".to_string()))
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
    let clamped_w = width.clamp(220.0, 740.0);
    let clamped_h = height.clamp(44.0, 480.0);
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

/// Global Custom Hotkey listener (1–3 key combo, Windows native, 0 extra crates, ~0% CPU).
#[cfg(target_os = "windows")]
fn spawn_custom_hotkey_listener(app_handle: tauri::AppHandle, hotkey_vks: Arc<Mutex<Vec<i32>>>) {
    std::thread::spawn(move || {
        const MODIFIERS: [i32; 3] = [0x11, 0x12, 0x10]; // Ctrl, Alt, Shift
        let mut was_triggered = false;

        loop {
            std::thread::sleep(Duration::from_millis(16));

            let current_vks: Vec<i32> = match hotkey_vks.lock() {
                Ok(guard) => guard.clone(),
                Err(_) => continue,
            };

            if current_vks.is_empty() {
                was_triggered = false;
                continue;
            }

            let all_pressed = current_vks
                .iter()
                .all(|&vk| unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 });

            // Pastikan tidak ada modifier tambahan yang tidak termasuk dalam hotkey user
            let extra_mod_down = MODIFIERS.iter().any(|&m| {
                !current_vks.contains(&m) && unsafe { (GetAsyncKeyState(m) as u16 & 0x8000) != 0 }
            });

            if all_pressed && !extra_mod_down {
                if !was_triggered {
                    was_triggered = true;
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let is_visible = window.is_visible().unwrap_or(false);
                        if is_visible {
                            let _ = window.emit("island-toggle-hide", ());
                        } else {
                            center_top_window(&window, 700.0, 440.0);
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("island-summon", ());
                        }
                    }
                }
            } else {
                was_triggered = false;
            }
        }
    });
}

#[tauri::command]
async fn rpc_call(
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

        client.call(id, &method, payload_params)
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
fn resize_island(app: tauri::AppHandle, width: f64, height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        center_top_window(&window, width, height);
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

    let app_state = AppState {
        worker: Arc::new(Mutex::new(None)),
        hotkey_vks,
        next_id: AtomicU64::new(1),
    };

    tauri::Builder::default()
        .manage(app_state)
        .setup(move |app| {
            #[cfg(target_os = "windows")]
            spawn_custom_hotkey_listener(app.handle().clone(), hotkey_vks_for_thread);

            if let Some(window) = app.get_webview_window("main") {
                center_top_window(&window, 426.0, 94.0);
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        let _ = win_clone.emit("island-blur", ());
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            rpc_call,
            hide_island,
            resize_island,
            set_global_hotkey,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("Gagal menjalankan aplikasi desktop aiKu");
}
