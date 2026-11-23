#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{LogicalPosition, LogicalSize, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
    worker: Mutex<Option<NodeRpcClient>>,
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

#[tauri::command]
fn rpc_call(
    state: State<'_, AppState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let mut guard = state
        .worker
        .lock()
        .map_err(|_| "Gagal mengunci state Node.js sidecar.".to_string())?;

    let needs_spawn = match guard.as_mut() {
        Some(client) => !client.is_alive(),
        None => true,
    };

    if needs_spawn {
        *guard = Some(NodeRpcClient::spawn()?);
    }

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let client = guard
        .as_mut()
        .ok_or_else(|| "Node.js sidecar tidak tersedia.".to_string())?;

    client.call(
        id,
        &method,
        params.unwrap_or_else(|| Value::Object(Default::default())),
    )
}

fn center_top_window(window: &tauri::WebviewWindow, width: f64, height: f64) {
    let clamped_w = width.clamp(220.0, 740.0);
    let clamped_h = height.clamp(56.0, 560.0);
    let _ = window.set_size(LogicalSize::new(clamped_w, clamped_h));

    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let monitor_width = monitor.size().width as f64 / scale;
        let x = ((monitor_width - clamped_w) / 2.0).max(0.0);
        let _ = window.set_position(LogicalPosition::new(x, 0.0));
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
        worker: Mutex::new(None),
        next_id: AtomicU64::new(1),
    };

    tauri::Builder::default()
        .manage(app_state)
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                center_top_window(&window, 250.0, 68.0);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc_call, resize_island, quit_app])
        .run(tauri::generate_context!())
        .expect("Gagal menjalankan aplikasi desktop aiKu");
}
