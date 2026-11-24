import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { type PathGuard, sanitizeFileName } from "../../core/security/path-guard.js";
import { getIndexedEntriesCached } from "../file-manager/local-search.js";

export interface DiscoveredShortcut {
  nameLower: string;
  displayName: string;
  fullPath: string;
}

let cachedShortcuts: { timestampMs: number; items: DiscoveredShortcut[] } | null = null;
const SHORTCUT_CACHE_TTL_MS = 60_000;

async function collectLnkFilesRecursive(
  dirPath: string,
  out: DiscoveredShortcut[],
  depth = 0
): Promise<void> {
  if (depth > 3 || out.length >= 600) return;
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= 600) break;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectLnkFilesRecursive(fullPath, out, depth + 1);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".lnk")) {
      const displayName = entry.name.slice(0, -4).trim();
      const lower = displayName.toLowerCase();
      if (lower && !lower.includes("uninstall") && !lower.includes("hapus instalan")) {
        out.push({
          nameLower: lower,
          displayName,
          fullPath,
        });
      }
    }
  }
}

export async function discoverInstalledWindowsApps(
  extraSearchDirs: readonly string[] = []
): Promise<DiscoveredShortcut[]> {
  const now = Date.now();
  if (cachedShortcuts && now - cachedShortcuts.timestampMs < SHORTCUT_CACHE_TTL_MS) {
    return cachedShortcuts.items;
  }

  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  const programData = process.env.ProgramData ?? "C:\\ProgramData";

  const roots = [
    path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs"),
    ...extraSearchDirs,
  ];

  const collected: DiscoveredShortcut[] = [];
  for (const root of roots) {
    await collectLnkFilesRecursive(root, collected, 0);
  }

  cachedShortcuts = {
    timestampMs: now,
    items: collected,
  };
  return collected;
}

const BUILTIN_URI_OR_BIN_APPS: Readonly<
  Record<string, { label: string; bin: string; args: readonly string[] }>
> = {
  "snipping tool": { label: "Snipping Tool", bin: "explorer.exe", args: ["ms-screenclip:"] },
  screenshot: { label: "Snipping Tool", bin: "explorer.exe", args: ["ms-screenclip:"] },
  kamera: { label: "Kamera Windows", bin: "explorer.exe", args: ["microsoft.windows.camera:"] },
  camera: { label: "Kamera Windows", bin: "explorer.exe", args: ["microsoft.windows.camera:"] },
  jam: { label: "Windows Clock", bin: "explorer.exe", args: ["ms-clock:"] },
  clock: { label: "Windows Clock", bin: "explorer.exe", args: ["ms-clock:"] },
  cmd: { label: "Command Prompt", bin: "cmd.exe", args: ["/c", "start", "", "cmd.exe"] },
  "command prompt": { label: "Command Prompt", bin: "cmd.exe", args: ["/c", "start", "", "cmd.exe"] },
  terminal: { label: "Windows Terminal", bin: "cmd.exe", args: ["/c", "start", "", "wt.exe"] },
  powershell: { label: "PowerShell", bin: "cmd.exe", args: ["/c", "start", "", "powershell.exe"] },
  "control panel": { label: "Control Panel", bin: "control.exe", args: [] },
  word: { label: "Microsoft Word", bin: "cmd.exe", args: ["/c", "start", "", "winword"] },
  excel: { label: "Microsoft Excel", bin: "cmd.exe", args: ["/c", "start", "", "excel"] },
  powerpoint: { label: "Microsoft PowerPoint", bin: "cmd.exe", args: ["/c", "start", "", "powerpnt"] },
};

/**
 * Mencari & membuka aplikasi apa pun yang terpasang di Start Menu / Desktop Windows 11 secara aman (shell: false).
 */
export async function launchAnyInstalledWindowsApp(
  rawAppQuery: string,
  extraDirs: readonly string[] = []
): Promise<{ launched: boolean; label: string }> {
  const query = rawAppQuery
    .trim()
    .toLowerCase()
    .replace(/^aplikasi\s+/, "")
    .replace(/\.(exe|lnk)$/i, "")
    .trim();

  if (!query || query.length > 80) {
    return { launched: false, label: rawAppQuery };
  }

  // 1. Cek daftar aplikasi sistem / Office built-in terlebih dahulu jika cocok persis
  const builtin = BUILTIN_URI_OR_BIN_APPS[query];
  if (builtin && process.platform === "win32") {
    const child = spawn(builtin.bin, [...builtin.args], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      shell: false,
    });
    child.unref();
    return { launched: true, label: builtin.label };
  }

  // 2. Cari di indeks shortcut Start Menu & Desktop (.lnk)
  const shortcuts = await discoverInstalledWindowsApps(extraDirs);
  const exact = shortcuts.find((s) => s.nameLower === query);
  const starts = shortcuts.find((s) => s.nameLower.startsWith(query));
  const wordMatch = shortcuts.find((s) => s.nameLower.split(/[\s_-]+/).includes(query));
  const partial = shortcuts.find((s) => s.nameLower.includes(query));
  const best = exact ?? starts ?? wordMatch ?? partial;

  if (best && process.platform === "win32") {
    const child = spawn("explorer.exe", [best.fullPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.unref();
    return { launched: true, label: best.displayName };
  }

  return { launched: false, label: rawAppQuery };
}

/**
 * Membuka file atau folder di dalam Sandbox menggunakan program bawaan Windows / File Explorer.
 */
export async function openSandboxItemInWindows(options: {
  targetQuery: string;
  allowedDirectories: readonly string[];
  pathGuard: PathGuard;
}): Promise<{ opened: boolean; relativePath: string }> {
  const cleaned = options.targetQuery.trim().replace(/^["'`]|["'`]$/g, "");
  if (!cleaned) return { opened: false, relativePath: "" };

  // 1. Coba resolve relatif terhadap setiap allowedDirectory terlebih dahulu
  for (const root of options.allowedDirectories) {
    const candidate = path.resolve(root, cleaned);
    try {
      const strictPath = await options.pathGuard.validatePathStrict(candidate);
      await fs.access(strictPath);
      if (process.platform === "win32") {
        const child = spawn("explorer.exe", [strictPath], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          shell: false,
        });
        child.unref();
      }
      return { opened: true, relativePath: path.relative(root, strictPath) || path.basename(strictPath) };
    } catch {
      // Lanjut cari di indeks nama file
    }
  }

  // 2. Fuzzy match nama file di indeks Sandbox
  const indexed = await getIndexedEntriesCached(options.allowedDirectories, options.pathGuard);
  const qLower = cleaned.toLowerCase();
  const matched =
    indexed.find((e) => e.fileName.toLowerCase() === qLower || e.relativePath.toLowerCase() === qLower) ??
    indexed.find((e) => e.fileName.toLowerCase().includes(qLower));

  if (matched) {
    const strictPath = await options.pathGuard.validatePathStrict(matched.fullPath);
    if (process.platform === "win32") {
      const child = spawn("explorer.exe", [strictPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      child.unref();
    }
    return { opened: true, relativePath: matched.relativePath };
  }

  return { opened: false, relativePath: cleaned };
}

const READABLE_TEXT_EXTENSIONS = new Set<string>([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".tsv",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".cs",
  ".html",
  ".css",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".sql",
  ".sh",
  ".ps1",
  ".bat",
  ".excalidraw",
]);

function stripOfficeXmlTags(xml: string): string {
  return xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<\/si>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function neutralizeInjectedTags(raw: string): string {
  return raw
    .replace(/\[(OPEN_APP|OPEN_FILE|OPEN_CHROME|OPEN_WEB|SEARCH_YT|SEARCH_WEB|SYS_CONTROL|SET_BRIGHTNESS|CREATE_FOLDER|RUN_CMD)\s*:/gi, "[DATA:")
    .replace(/<\s*\/?\s*write_file/gi, "&lt;write_file");
}

/**
 * Membaca isi lengkap dokumen di dalam Sandbox (.pdf, .docx, .xlsx, .txt, .md, kode, .json, .csv)
 * secara aman melalui PathGuard agar Qwen 3B dapat merangkum, menganalisis, atau menjawab isi file.
 */
export async function readFullSandboxDocument(options: {
  fileQuery: string;
  allowedDirectories: readonly string[];
  pathGuard: PathGuard;
  maxChars?: number;
}): Promise<{ found: boolean; fileName: string; relativePath: string; content: string; truncated: boolean }> {
  const maxChars = options.maxChars ?? 4800;
  const cleanedQuery = options.fileQuery.trim().replace(/^["'`]|["'`]$/g, "");
  if (!cleanedQuery) {
    return { found: false, fileName: "", relativePath: "", content: "", truncated: false };
  }

  let targetFullPath: string | null = null;
  let targetRelative = cleanedQuery;

  for (const root of options.allowedDirectories) {
    const candidate = path.resolve(root, cleanedQuery);
    try {
      const validated = await options.pathGuard.validatePathStrict(candidate);
      const st = await fs.stat(validated);
      if (st.isFile()) {
        targetFullPath = validated;
        targetRelative = path.relative(root, validated);
        break;
      }
    } catch {
      // Lanjut ke pencarian indeks
    }
  }

  if (!targetFullPath) {
    const entries = await getIndexedEntriesCached(options.allowedDirectories, options.pathGuard);
    const qLower = cleanedQuery.toLowerCase();
    const exact = entries.find(
      (e) =>
        e.fileName.toLowerCase() === qLower ||
        e.relativePath.toLowerCase() === qLower ||
        path.parse(e.fileName).name.toLowerCase() === qLower
    );
    const partial = entries.find(
      (e) => e.extension !== ".lnk" && e.fileName.toLowerCase().includes(qLower)
    );
    const chosen = exact ?? partial;
    if (chosen) {
      targetFullPath = await options.pathGuard.validatePathStrict(chosen.fullPath);
      targetRelative = chosen.relativePath;
    }
  }

  if (!targetFullPath) {
    return { found: false, fileName: cleanedQuery, relativePath: cleanedQuery, content: "", truncated: false };
  }

  const ext = path.extname(targetFullPath).toLowerCase();
  const fileName = path.basename(targetFullPath);
  let extracted = "";

  if (ext === ".pdf") {
    const buffer = await fs.readFile(targetFullPath);
    const pdfParseModule = (await import("pdf-parse")) as unknown as {
      default?: (dataBuffer: Buffer, opts?: { max?: number }) => Promise<{ text: string }>;
    };
    if (typeof pdfParseModule.default === "function") {
      const parsed = await pdfParseModule.default(buffer, { max: 8 });
      extracted = parsed.text.trim();
    }
  } else if (ext === ".docx") {
    const zip = new AdmZip(targetFullPath);
    const entry = zip.getEntry("word/document.xml");
    if (entry) {
      extracted = stripOfficeXmlTags(entry.getData().toString("utf8"));
    }
  } else if (ext === ".xlsx") {
    const zip = new AdmZip(targetFullPath);
    const shared = zip.getEntry("xl/sharedStrings.xml");
    if (shared) {
      extracted = stripOfficeXmlTags(shared.getData().toString("utf8"));
    }
  } else if (READABLE_TEXT_EXTENSIONS.has(ext)) {
    const handle = await fs.open(targetFullPath, "r");
    try {
      const capBytes = 32 * 1024;
      const buf = Buffer.alloc(capBytes);
      const { bytesRead } = await handle.read(buf, 0, capBytes, 0);
      extracted = buf.subarray(0, bytesRead).toString("utf8").trim();
    } finally {
      await handle.close();
    }
  } else {
    return {
      found: true,
      fileName,
      relativePath: targetRelative,
      content: `[File biner ${ext} — tidak berisi teks langsung yang bisa dibaca, gunakan fitur buka file jika ingin membukanya di aplikasi]`,
      truncated: false,
    };
  }

  const sanitized = neutralizeInjectedTags(extracted);
  const truncated = sanitized.length > maxChars;
  return {
    found: true,
    fileName,
    relativePath: targetRelative,
    content: sanitized.slice(0, maxChars),
    truncated,
  };
}

/**
 * Deteksi otomatis jika pesan pengguna meminta membaca/merangkum/menganalisis suatu nama file nyata di Sandbox.
 */
export async function detectAndReadMentionedDocument(options: {
  userMessage: string;
  allowedDirectories: readonly string[];
  pathGuard: PathGuard;
}): Promise<{ fileName: string; relativePath: string; content: string; truncated: boolean } | null> {
  const lower = options.userMessage.toLowerCase();
  const wantsReadOrAnalyze =
    /\b(baca|bacain|bacakan|isi\s+file|isi\s+dokumen|isi\s+dari|rangkum|ringkas|jelaskan\s+isi|analisis\s+file|cek\s+isi|apa\s+isi|terjemahkan\s+file|review\s+file)\b/.test(
      lower
    );
  if (!wantsReadOrAnalyze) {
    return null;
  }

  const entries = await getIndexedEntriesCached(options.allowedDirectories, options.pathGuard);
  // Cari nama file non-shortcut terpanjang yang disebut di dalam pesan user
  const candidates = entries
    .filter((e) => e.extension !== ".lnk" && e.extension !== ".url")
    .filter((e) => {
      const fullLower = e.fileName.toLowerCase();
      const stemLower = path.parse(e.fileName).name.toLowerCase();
      return (
        lower.includes(fullLower) ||
        (stemLower.length >= 4 && lower.includes(stemLower))
      );
    })
    .sort((a, b) => b.fileName.length - a.fileName.length);

  const best = candidates[0];
  if (!best) {
    return null;
  }

  const res = await readFullSandboxDocument({
    fileQuery: best.relativePath,
    allowedDirectories: options.allowedDirectories,
    pathGuard: options.pathGuard,
  });

  if (!res.found || !res.content) {
    return null;
  }

  return {
    fileName: res.fileName,
    relativePath: res.relativePath,
    content: res.content,
    truncated: res.truncated,
  };
}

async function resolveNonOverwritingPath(targetPath: string): Promise<{ finalPath: string; autoRenamed: boolean }> {
  const dir = path.dirname(targetPath);
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let counter = 1;

  while (counter <= 500) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${parsed.name}_${counter}${parsed.ext}`);
      counter += 1;
    } catch {
      return { finalPath: candidate, autoRenamed: counter > 1 };
    }
  }
  throw new Error("Terlalu banyak konflik nama file serupa di folder tujuan.");
}

const BLOCKED_WRITE_EXTENSIONS = new Set<string>([
  ".exe",
  ".dll",
  ".sys",
  ".msi",
  ".scr",
  ".com",
  ".pif",
  ".vbs",
  ".reg",
]);

/**
 * Menulis file teks/kode/dokumen baru di dalam Sandbox secara aman (PathGuard + Anti-Overwrite + Blokir Binary Eksekusi).
 */
export async function writeSafeSandboxFile(options: {
  relativePath: string;
  content: string;
  sandboxRoot: string;
  pathGuard: PathGuard;
}): Promise<{ savedPath: string; relativePath: string; autoRenamed: boolean }> {
  const rawRel = options.relativePath.trim().replace(/^["'`\\/]+|["'`]+$/g, "");
  const rootBaseLower = path.basename(options.sandboxRoot).toLowerCase();
  let segments = rawRel.split(/[\\/]+/).filter(Boolean);

  // Bersihkan awalan redundan "Sandbox/" atau "Desktop/" jika model menulis path="Sandbox/Desktop/file.md"
  while (
    segments.length > 1 &&
    (segments[0]!.toLowerCase() === "sandbox" ||
      segments[0]!.toLowerCase() === "desktop" ||
      segments[0]!.toLowerCase() === rootBaseLower)
  ) {
    segments = segments.slice(1);
  }

  if (segments.length === 0 || segments.length > 5) {
    throw new Error("Path file baru tidak valid.");
  }

  const safeSegments = segments.map((seg) => sanitizeFileName(seg));
  const fileName = safeSegments[safeSegments.length - 1]!;
  const ext = path.extname(fileName).toLowerCase();
  if (BLOCKED_WRITE_EXTENSIONS.has(ext)) {
    throw new Error(`Pembuatan file biner/sistem (${ext}) diblokir demi keamanan.`);
  }

  const candidateFull = path.join(options.sandboxRoot, ...safeSegments);
  options.pathGuard.validatePath(candidateFull);

  await fs.mkdir(path.dirname(candidateFull), { recursive: true });
  const { finalPath, autoRenamed } = await resolveNonOverwritingPath(candidateFull);
  options.pathGuard.validatePath(finalPath);

  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, options.content, "utf8");
  await fs.rename(tmpPath, finalPath);

  return {
    savedPath: finalPath,
    relativePath: path.relative(options.sandboxRoot, finalPath),
    autoRenamed,
  };
}

/**
 * Membuat folder baru di dalam Sandbox secara aman (PathGuard).
 */
export async function createSafeSandboxFolder(options: {
  folderPath: string;
  sandboxRoot: string;
  pathGuard: PathGuard;
}): Promise<{ createdPath: string; relativePath: string }> {
  const rawRel = options.folderPath.trim().replace(/^["'`\\/]+|["'`]+$/g, "");
  const segments = rawRel.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.length > 5) {
    throw new Error("Nama folder tidak valid.");
  }

  const safeSegments = segments.map((seg) => sanitizeFileName(seg));
  const targetDir = path.join(options.sandboxRoot, ...safeSegments);
  options.pathGuard.validatePath(targetDir);
  await fs.mkdir(targetDir, { recursive: true });

  return {
    createdPath: targetDir,
    relativePath: path.relative(options.sandboxRoot, targetDir),
  };
}

export type SystemControlAction =
  | "volume_up"
  | "volume_down"
  | "mute"
  | "brightness_up"
  | "brightness_down"
  | "screenshot";

function runDetachedPowerShell(script: string): void {
  if (process.platform !== "win32") return;
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    }
  );
  child.unref();
}

/**
 * Kontrol perangkat keras Windows 11 (Volume, Mute, Kecerahan Layar, Screenshot) tanpa interpolasi string liar.
 */
export async function executeWindowsSystemControl(
  action: string,
  explicitBrightness?: number
): Promise<{ ok: boolean; description: string }> {
  const norm = action.trim().toLowerCase();

  if (explicitBrightness !== undefined) {
    const level = Math.min(100, Math.max(5, Math.round(explicitBrightness)));
    runDetachedPowerShell(
      `$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue; if ($m) { Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = ${level} } | Out-Null }`
    );
    return { ok: true, description: `Kecerahan layar diatur ke ${level}%` };
  }

  switch (norm) {
    case "volume_up":
    case "naikkan_volume": {
      // 5 langkah VK_VOLUME_UP (~10%)
      runDetachedPowerShell(
        "$w = New-Object -ComObject WScript.Shell; 1..5 | ForEach-Object { $w.SendKeys([char]175) }"
      );
      return { ok: true, description: "Volume suara dinaikkan" };
    }
    case "volume_down":
    case "turunkan_volume": {
      runDetachedPowerShell(
        "$w = New-Object -ComObject WScript.Shell; 1..5 | ForEach-Object { $w.SendKeys([char]174) }"
      );
      return { ok: true, description: "Volume suara diturunkan" };
    }
    case "mute":
    case "unmute": {
      runDetachedPowerShell("$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]173)");
      return { ok: true, description: "Status mute audio di-toggle" };
    }
    case "brightness_up": {
      runDetachedPowerShell(
        "$b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness; $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue; if ($m -and $null -ne $b) { $next = [Math]::Min(100, $b + 15); Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = $next } | Out-Null }"
      );
      return { ok: true, description: "Kecerahan layar dinaikkan +15%" };
    }
    case "brightness_down": {
      runDetachedPowerShell(
        "$b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness; $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue; if ($m -and $null -ne $b) { $next = [Math]::Max(10, $b - 15); Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = $next } | Out-Null }"
      );
      return { ok: true, description: "Kecerahan layar diturunkan -15%" };
    }
    case "screenshot": {
      if (process.platform === "win32") {
        const child = spawn("explorer.exe", ["ms-screenclip:"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          shell: false,
        });
        child.unref();
      }
      return { ok: true, description: "Membuka Snipping Tool tangkapan layar" };
    }
    default:
      return { ok: false, description: "" };
  }
}

const CATASTROPHIC_CMD_PATTERNS: readonly RegExp[] = [
  /\b(format-volume|clear-disk|initialize-disk|diskpart|cipher\s+\/w|bcdedit|vssadmin\s+delete)\b/i,
  /\b(remove-item|del|erase|rm|rd|rmdir)\b.*(-recurse|\/s).*([a-z]:\\windows|[a-z]:\\program|[a-z]:\\users\\[^\\]+\\?$)/i,
  /\b(stop-computer|restart-computer|shutdown\s+\/[sr])/i,
  /\breg\s+delete\s+hklm/i,
  /\binvoke-expression\b|\biex\b.*http/i,
];

export interface PendingApprovedCommand {
  cmdId: string;
  command: string;
  cwd: string;
  createdAtMs: number;
}

export function validateProposedPowerShellCommand(rawCmd: string): {
  safeToAskApproval: boolean;
  reason?: string;
  cleanedCommand: string;
} {
  const cleaned = rawCmd.trim().replace(/^`+|`+$/g, "").trim();
  if (!cleaned || cleaned.length > 600) {
    return {
      safeToAskApproval: false,
      reason: "Perintah kosong atau melebihi 600 karakter.",
      cleanedCommand: cleaned,
    };
  }

  for (const blocked of CATASTROPHIC_CMD_PATTERNS) {
    if (blocked.test(cleaned)) {
      return {
        safeToAskApproval: false,
        reason: "Perintah sistem destruktif tingkat tinggi (format/hapus OS/remote exec) diblokir permanen oleh P0 Guard.",
        cleanedCommand: cleaned,
      };
    }
  }

  return { safeToAskApproval: true, cleanedCommand: cleaned };
}

export function createPendingCommandRecord(command: string, cwd: string): PendingApprovedCommand {
  return {
    cmdId: `cmd_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
    command,
    cwd,
    createdAtMs: Date.now(),
  };
}

/**
 * Mengeksekusi perintah PowerShell HANYA setelah pengguna mengeklik tombol 'Setujui & Jalankan' di UI.
 */
export async function executeApprovedPowerShellCommand(
  record: PendingApprovedCommand
): Promise<{ exitCode: number | null; output: string; durationMs: number }> {
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", record.command],
      {
        cwd: record.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let combined = "";
    const appendChunk = (chunk: Buffer): void => {
      if (combined.length < 8000) {
        combined += chunk.toString("utf8");
      }
    };

    const timer = setTimeout(() => {
      child.kill();
      resolve({
        exitCode: -1,
        output: `${combined.slice(0, 6000)}\n[Dihentikan otomatis setelah batas waktu 20 detik]`.trim(),
        durationMs: Math.round(performance.now() - t0),
      });
    }, 20_000);

    child.stdout.on("data", appendChunk);
    child.stderr.on("data", appendChunk);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Gagal menjalankan PowerShell: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        output: combined.trim().slice(0, 6000) || "(Perintah selesai tanpa output teks)",
        durationMs: Math.round(performance.now() - t0),
      });
    });
  });
}
