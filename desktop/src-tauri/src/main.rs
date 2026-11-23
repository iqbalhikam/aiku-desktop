#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
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
    let clamped_w = width.clamp(220.0, 680.0);
    let clamped_h = height.clamp(44.0, 480.0);
    let _ = window.set_size(LogicalSize::new(clamped_w, clamped_h));

    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let monitor_width = monitor.size().width as f64 / scale;
        let x = ((monitor_width - clamped_w) / 2.0).max(0.0);
        let _ = window.set_position(LogicalPosition::new(x, 0.0));
    }
}

/// Global Double-Tap Ctrl listener (Windows native, 0 extra crates, 0% CPU).
/// Mengabaikan kombinasi seperti Ctrl+C / Ctrl+V / Ctrl+Tab.
#[cfg(target_os = "windows")]
fn spawn_double_ctrl_listener(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        const VK_CONTROL: i32 = 0x11;
        let mut prev_ctrl_down = false;
        let mut press_started: Option<Instant> = None;
        let mut combo_used = false;
        let mut last_clean_tap: Option<Instant> = None;

        loop {
            std::thread::sleep(Duration::from_millis(16));

            let ctrl_down = unsafe { (GetAsyncKeyState(VK_CONTROL) as u16 & 0x8000) != 0 };

            if ctrl_down {
                if !prev_ctrl_down {
                    press_started = Some(Instant::now());
                    combo_used = false;
                } else if !combo_used {
                    // Cek apakah tombol lain ditekan bersamaan (Shift, Alt, Tab, A-Z, 0-9)
                    let other_down = unsafe {
                        let shift = (GetAsyncKeyState(0x10) as u16 & 0x8000) != 0;
                        let alt = (GetAsyncKeyState(0x12) as u16 & 0x8000) != 0;
                        let tab = (GetAsyncKeyState(0x09) as u16 & 0x8000) != 0;
                        let mut any_alnum = false;
                        for vk in 0x30..=0x5A {
                            if (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 {
                                any_alnum = true;
                                break;
                            }
                        }
                        shift || alt || tab || any_alnum
                    };
                    if other_down {
                        combo_used = true;
                    }
                }
            } else if prev_ctrl_down {
                // Ctrl baru saja dilepas
                if let Some(started) = press_started {
                    let hold_ms = started.elapsed().as_millis();
                    if !combo_used && hold_ms <= 260 {
                        let now = Instant::now();
                        if let Some(prev_tap) = last_clean_tap {
                            if now.duration_since(prev_tap).as_millis() <= 380 {
                                // Double-Tap Ctrl terdeteksi!
                                last_clean_tap = None;
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    let is_visible = window.is_visible().unwrap_or(false);
                                    if is_visible {
                                        let _ = window.emit("island-toggle-hide", ());
                                    } else {
                                        center_top_window(&window, 656.0, 410.0);
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                        let _ = window.emit("island-summon", ());
                                    }
                                }
                            } else {
                                last_clean_tap = Some(now);
                            }
                        } else {
                            last_clean_tap = Some(now);
                        }
                    } else {
                        last_clean_tap = None;
                    }
                }
                press_started = None;
            }

            prev_ctrl_down = ctrl_down;
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
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let app_state = AppState {
        worker: Arc::new(Mutex::new(None)),
        next_id: AtomicU64::new(1),
    };

    tauri::Builder::default()
        .manage(app_state)
        .setup(|app| {
            #[cfg(target_os = "windows")]
            spawn_double_ctrl_listener(app.handle().clone());

            if let Some(window) = app.get_webview_window("main") {
                center_top_window(&window, 256.0, 46.0);
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
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("Gagal menjalankan aplikasi desktop aiKu");
}
