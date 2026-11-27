import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

export interface DevPortEntry {
  port: number;
  pid: number;
  processName: string;
  address: string;
}

export interface NetworkDiagResult {
  localIpv4: string;
  ssid: string;
  dnsServers: string[];
  cloudflareMs: number | null;
  googleMs: number | null;
  jitterMs: number;
  status: "Stabil" | "Lambat" | "Offline";
}

const PROTECTED_PROCESS_NAMES = new Set([
  "system",
  "idle",
  "smss",
  "csrss",
  "wininit",
  "services",
  "lsass",
  "svchost",
  "winlogon",
  "dwm",
  "explorer",
  "fontdrvhost",
  "spoolsv",
]);

function execPowerShellSafe(script: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve("");
      return;
    }
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
    );
    let out = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve(out.trim());
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.trim());
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

function execBinarySafe(bin: string, args: string[], timeoutMs = 3500): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let out = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve(out.trim());
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.trim());
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

/**
 * 1. Offline Image / Screenshot OCR using built-in Windows 10/11 WinRT OcrEngine (0 MB download!)
 */
export async function runWindowsOfflineOcr(imageBase64: string): Promise<{ text: string; lines: number }> {
  const cleanedB64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "").trim();
  const buf = Buffer.from(cleanedB64, "base64");
  if (buf.length === 0 || buf.length > 15 * 1024 * 1024) {
    throw new Error("Ukuran gambar tidak valid (maksimal 15 MB).");
  }

  const tmpFile = path.join(os.tmpdir(), `aiku_ocr_${crypto.randomBytes(8).toString("hex")}.png`);
  await fs.writeFile(tmpFile, buf);

  const escapedPath = tmpFile.replace(/'/g, "''");
  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]

function Await($WinRtTask, $ResultType) {
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${escapedPath}')) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
  $lang = New-Object Windows.Globalization.Language('en-US')
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
}
$res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()
$lines = @($res.Lines | ForEach-Object { $_.Text })
($lines -join "\`n")
`;

  try {
    const text = await execPowerShellSafe(psScript, 10000);
    const trimmed = text.trim();
    const lines = trimmed ? trimmed.split(/\r?\n/).length : 0;
    return { text: trimmed, lines };
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

/**
 * 2. Dev Port & Process Manager (List & 1-Click Safe Kill)
 */
export async function listListeningDevPorts(): Promise<DevPortEntry[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$conns = Get-NetTCPConnection -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
$procs = @{}
Get-Process | ForEach-Object { $procs[$_.Id] = $_.ProcessName }
$out = foreach ($c in $conns) {
  $pName = $procs[[int]$c.OwningProcess]
  if (-not $pName) { $pName = 'unknown' }
  [PSCustomObject]@{
    port = [int]$c.LocalPort
    pid = [int]$c.OwningProcess
    processName = [string]$pName
    address = [string]$c.LocalAddress
  }
}
$out | Sort-Object port -Unique | ConvertTo-Json -Compress
`;
  const raw = await execPowerShellSafe(script, 5000);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DevPortEntry | DevPortEntry[];
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .filter(
        (x) =>
          typeof x.port === "number" &&
          typeof x.pid === "number" &&
          x.pid > 4 &&
          !PROTECTED_PROCESS_NAMES.has(String(x.processName || "").toLowerCase())
      )
      .slice(0, 80);
  } catch {
    return [];
  }
}

export async function killDevPortProcess(pid: number): Promise<{ ok: boolean; message: string }> {
  const safePid = Math.floor(pid);
  if (!Number.isFinite(safePid) || safePid <= 4 || safePid === process.pid) {
    throw new Error("PID sistem dilindungi dan tidak boleh dihentikan.");
  }

  const checkName = await execPowerShellSafe(
    `(Get-Process -Id ${safePid} -ErrorAction SilentlyContinue).ProcessName`,
    3000
  );
  const cleanName = checkName.trim();
  if (!cleanName) {
    return { ok: false, message: `Proses PID ${safePid} sudah berhenti.` };
  }
  if (PROTECTED_PROCESS_NAMES.has(cleanName.toLowerCase())) {
    throw new Error(`Proses sistem "${cleanName}" dilindungi demi keamanan Windows.`);
  }

  process.kill(safePid);
  return { ok: true, message: `Proses ${cleanName} (PID ${safePid}) berhasil dihentikan.` };
}

/**
 * 3. Network Ping, Jitter, Local IPv4 & Wi-Fi SSID Diagnostics
 */
function measureTcpLatencyMs(host: string, port = 443, timeoutMs = 1800): Promise<number | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const sock = net.createConnection({ host, port });
    let settled = false;
    const finish = (val: number | null): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(val);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(Math.round(performance.now() - start)));
    sock.once("timeout", () => finish(null));
    sock.once("error", () => finish(null));
  });
}

export async function runNetworkDiagnostics(): Promise<NetworkDiagResult> {
  // Local IPv4
  let localIpv4 = "127.0.0.1";
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === "IPv4" && !iface.internal) {
        localIpv4 = iface.address;
        break;
      }
    }
    if (localIpv4 !== "127.0.0.1") break;
  }

  const dnsServers = dns.getServers().slice(0, 3);

  const [wlanOut, cf1, cf2, gg1] = await Promise.all([
    process.platform === "win32" ? execBinarySafe("netsh", ["wlan", "show", "interfaces"], 2500) : Promise.resolve(""),
    measureTcpLatencyMs("1.1.1.1", 443),
    measureTcpLatencyMs("1.1.1.1", 443),
    measureTcpLatencyMs("8.8.8.8", 443),
  ]);

  let ssid = "Ethernet / LAN";
  const ssidMatch = wlanOut.match(/^\s*SSID\s*:\s*(.+)$/m);
  if (ssidMatch?.[1]) {
    ssid = ssidMatch[1].trim();
  }

  const samples = [cf1, cf2, gg1].filter((x): x is number => x !== null);
  const cloudflareMs = cf1 ?? cf2;
  const googleMs = gg1;
  let jitterMs = 0;
  if (samples.length >= 2) {
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    jitterMs = max - min;
  }

  const best = samples.length > 0 ? Math.min(...samples) : null;
  const status: NetworkDiagResult["status"] =
    best === null ? "Offline" : best <= 85 ? "Stabil" : "Lambat";

  return {
    localIpv4,
    ssid,
    dnsServers,
    cloudflareMs,
    googleMs,
    jitterMs,
    status,
  };
}

/**
 * 4. Local PDF Merger & Page Splitter (100% Offline via pdf-lib)
 */
export async function mergeLocalPdfs(filesBase64: string[]): Promise<{ pdfBase64: string; totalPages: number }> {
  if (filesBase64.length < 2) {
    throw new Error("Pilih minimal 2 file PDF untuk digabungkan.");
  }
  const merged = await PDFDocument.create();
  for (const raw of filesBase64.slice(0, 20)) {
    const clean = raw.replace(/^data:application\/pdf;base64,/, "").trim();
    const srcDoc = await PDFDocument.load(Buffer.from(clean, "base64"), { ignoreEncryption: true });
    const copied = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
    for (const page of copied) {
      merged.addPage(page);
    }
  }
  const outBytes = await merged.save();
  return {
    pdfBase64: Buffer.from(outBytes).toString("base64"),
    totalPages: merged.getPageCount(),
  };
}

function parsePageRangeSpec(spec: string, maxPages: number): number[] {
  const indices: number[] = [];
  const seen = new Set<number>();
  const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const a = Math.max(1, Math.min(maxPages, Number(rangeMatch[1])));
      const b = Math.max(1, Math.min(maxPages, Number(rangeMatch[2])));
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let p = start; p <= end; p++) {
        if (!seen.has(p - 1)) {
          seen.add(p - 1);
          indices.push(p - 1);
        }
      }
    } else if (/^\d+$/.test(part)) {
      const p = Math.max(1, Math.min(maxPages, Number(part)));
      if (!seen.has(p - 1)) {
        seen.add(p - 1);
        indices.push(p - 1);
      }
    }
  }
  return indices;
}

export async function splitLocalPdf(
  pdfBase64: string,
  rangeSpec: string
): Promise<{ pdfBase64: string; extractedPages: number; originalPages: number }> {
  const clean = pdfBase64.replace(/^data:application\/pdf;base64,/, "").trim();
  const srcDoc = await PDFDocument.load(Buffer.from(clean, "base64"), { ignoreEncryption: true });
  const total = srcDoc.getPageCount();
  const indices = parsePageRangeSpec(rangeSpec, total);
  if (indices.length === 0) {
    throw new Error(`Rentang halaman tidak valid (dokumen memiliki ${total} halaman, contoh: 1-3, 5).`);
  }

  const outDoc = await PDFDocument.create();
  const copied = await outDoc.copyPages(srcDoc, indices);
  for (const page of copied) {
    outDoc.addPage(page);
  }
  const outBytes = await outDoc.save();
  return {
    pdfBase64: Buffer.from(outBytes).toString("base64"),
    extractedPages: outDoc.getPageCount(),
    originalPages: total,
  };
}

/**
 * 5. Native Windows 1-Click Screen Recorder (ffmpeg gdigrab -> H.264 MP4)
 * Bebas popup browser "Choose what to share" & kompatibel penuh dengan Tauri click-through!
 */
interface ActiveNativeRecording {
  proc: ChildProcess;
  filePath: string;
  startedAtMs: number;
  fps: number;
  bitrate: number;
  audioAttached: boolean;
  lastStderr: string;
}

let activeNativeRec: ActiveNativeRecording | null = null;

function resolveFfmpegExecutable(): string | null {
  if (process.platform !== "win32") return "ffmpeg";
  const localAppData = process.env["LOCALAPPDATA"] ?? "";
  const candidates = [
    path.join(localAppData, "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
    "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
  ];
  for (const c of candidates) {
    if (c && fsSync.existsSync(c)) return c;
  }
  return "ffmpeg";
}

function detectFirstDirectShowAudioDevice(ffmpegBin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegBin, ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve(null);
    }, 2500);
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const match = stderr.match(/"([^"]+)"\s*\(audio\)/i);
      resolve(match?.[1]?.trim() || null);
    });
  });
}

export interface RecordableWindow {
  title: string;
  processName: string;
}

export async function listRecordableWindows(): Promise<RecordableWindow[]> {
  if (process.platform !== "win32") return [];
  const ps = `
$ErrorActionPreference='SilentlyContinue'
$items = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } |
  Select-Object @{N='processName';E={$_.ProcessName}}, @{N='title';E={$_.MainWindowTitle}}
if ($null -eq $items) { '[]' } else { @($items) | ConvertTo-Json -Compress }
`.trim();
  try {
    const raw = await execPowerShellSafe(ps, 3500);
    const parsed = JSON.parse(raw || "[]") as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const seen = new Set<string>();
    const out: RecordableWindow[] = [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const title = String(r["title"] ?? "").trim();
      const processName = String(r["processName"] ?? "").trim();
      if (!title || /^aiku/i.test(title) || seen.has(title)) continue;
      seen.add(title);
      out.push({ title, processName });
    }
    return out.slice(0, 30);
  } catch {
    return [];
  }
}

export async function startNativeScreenRecord(opts: {
  fps: number;
  height: number;
  bitrate: number;
  audioMode: "mic" | "system" | "both" | "none";
  targetMode?: "desktop" | "window";
  windowTitle?: string;
}): Promise<{
  recording: boolean;
  filePath: string;
  fileName: string;
  audioAttached: boolean;
}> {
  if (activeNativeRec !== null) {
    return {
      recording: true,
      filePath: activeNativeRec.filePath,
      fileName: path.basename(activeNativeRec.filePath),
      audioAttached: activeNativeRec.audioAttached,
    };
  }

  const ffmpegBin = resolveFfmpegExecutable();
  if (!ffmpegBin) {
    throw new Error("ffmpeg tidak ditemukan. Instal via terminal: winget install Gyan.FFmpeg");
  }

  const outDir = path.join(os.homedir(), "Videos", "aiku-recordings");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fps = Math.min(60, Math.max(15, Math.round(opts.fps || 30)));
  const bitrate = Math.min(25_000_000, Math.max(1_000_000, Math.round(opts.bitrate || 6_000_000)));
  const height = Math.max(0, Math.round(opts.height || 0));
  const fileName = `aiku-rec-${stamp}-${fps}fps.mp4`;
  const filePath = path.join(outDir, fileName);

  const audioDevice =
    opts.audioMode !== "none" ? await detectFirstDirectShowAudioDevice(ffmpegBin) : null;

  const captureInput =
    opts.targetMode === "window" && opts.windowTitle?.trim()
      ? `title=${opts.windowTitle.trim()}`
      : "desktop";

  const args: string[] = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "gdigrab",
    "-framerate",
    String(fps),
    "-draw_mouse",
    "1",
    "-i",
    captureInput,
  ];

  if (audioDevice) {
    args.push("-f", "dshow", "-i", `audio=${audioDevice}`);
  }

  const vf =
    height > 0
      ? `scale=-2:${height}:flags=fast_bilinear`
      : "scale=trunc(iw/2)*2:trunc(ih/2)*2";

  args.push(
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    String(bitrate),
    "-maxrate",
    String(bitrate),
    "-bufsize",
    String(bitrate * 2)
  );

  if (audioDevice) {
    args.push("-c:a", "aac", "-b:a", "128k");
  }

  args.push("-movflags", "+faststart", filePath);

  const proc = spawn(ffmpegBin, args, {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "ignore", "pipe"],
  });

  const recState: ActiveNativeRecording = {
    proc,
    filePath,
    startedAtMs: Date.now(),
    fps,
    bitrate,
    audioAttached: Boolean(audioDevice),
    lastStderr: "",
  };
  activeNativeRec = recState;

  proc.stderr?.on("data", (buf: Buffer) => {
    recState.lastStderr = (recState.lastStderr + buf.toString("utf8")).slice(-800);
  });

  let earlyExitError: string | null = null;
  proc.once("error", (err) => {
    earlyExitError = err.message;
    if (activeNativeRec === recState) activeNativeRec = null;
  });
  proc.once("exit", (code) => {
    if (code !== 0 && code !== null && !earlyExitError) {
      earlyExitError = recState.lastStderr.trim() || `ffmpeg keluar dengan kode ${code}`;
    }
    if (activeNativeRec === recState) activeNativeRec = null;
  });

  // Tunggu 450ms untuk memastikan ffmpeg benar-benar berhasil menangkap layar
  await new Promise((r) => setTimeout(r, 450));
  if (earlyExitError) {
    throw new Error(`Gagal memulai perekaman layar: ${earlyExitError}`);
  }

  return {
    recording: true,
    filePath,
    fileName,
    audioAttached: recState.audioAttached,
  };
}

export async function stopNativeScreenRecord(): Promise<{
  saved: boolean;
  filePath: string;
  fileName: string;
  sizeBytes: number;
}> {
  const rec = activeNativeRec;
  if (!rec) {
    return { saved: false, filePath: "", fileName: "", sizeBytes: 0 };
  }
  activeNativeRec = null;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    const killTimer = setTimeout(() => {
      try {
        rec.proc.kill();
      } catch {}
      finish();
    }, 4500);

    rec.proc.once("exit", () => {
      clearTimeout(killTimer);
      finish();
    });

    try {
      rec.proc.stdin?.write("q\n");
      rec.proc.stdin?.end();
    } catch {
      try {
        rec.proc.kill();
      } catch {}
    }
  });

  let sizeBytes = 0;
  try {
    const st = await fs.stat(rec.filePath);
    sizeBytes = st.size;
  } catch {
    sizeBytes = 0;
  }

  return {
    saved: sizeBytes > 0,
    filePath: rec.filePath,
    fileName: path.basename(rec.filePath),
    sizeBytes,
  };
}

export async function openRecordingsFolder(filePath?: string): Promise<{ opened: boolean }> {
  const outDir = path.join(os.homedir(), "Videos", "aiku-recordings");
  await fs.mkdir(outDir, { recursive: true });
  const target = filePath && fsSync.existsSync(filePath) ? filePath : outDir;
  if (process.platform === "win32") {
    const args = target === filePath ? [`/select,${target}`] : [target];
    const child = spawn("explorer.exe", args, {
      shell: false,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
  return { opened: true };
}
