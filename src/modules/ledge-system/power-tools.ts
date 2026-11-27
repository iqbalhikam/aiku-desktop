import { spawn } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns";
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
