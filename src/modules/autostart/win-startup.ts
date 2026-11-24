import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const RUN_REGISTRY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const REGISTRY_VALUE_NAME = "aiKuDesktop";

let cachedAutoStart: boolean | null = null;

/**
 * Menentukan path executable utama aiKu untuk didaftarkan ke Windows Startup.
 * Prioritas:
 * 1. Env AIKU_TAURI_EXE yang dikirim oleh host Rust Tauri saat sidecar dijalankan.
 * 2. File aiKu-Desktop.exe di folder proyek (jika sudah diunduh dari GitHub Release).
 * 3. Fallback ke Node.js local desktop server.
 */
export async function resolveStartupLaunchCommand(projectRoot: string): Promise<string> {
  const envExe = process.env.AIKU_TAURI_EXE?.trim();
  if (envExe) {
    return `"${envExe}"`;
  }

  const candidateExes = [
    path.join(projectRoot, "aiKu-Desktop.exe"),
    path.join(projectRoot, "desktop", "src-tauri", "target", "release", "aiku-desktop.exe"),
  ];

  for (const candidate of candidateExes) {
    try {
      await fs.access(candidate);
      return `"${candidate}"`;
    } catch {
      // Lanjut cek kandidat berikutnya
    }
  }

  const serverScript = path.join(projectRoot, "dist", "desktop", "server.js");
  return `"${process.execPath}" "${serverScript}"`;
}

/**
 * Mengecek apakah aiKu terdaftar di HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
 */
export async function queryWindowsAutoStart(): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }
  if (cachedAutoStart !== null) {
    return cachedAutoStart;
  }

  try {
    await execFileAsync(
      "reg.exe",
      ["query", RUN_REGISTRY_KEY, "/v", REGISTRY_VALUE_NAME],
      { windowsHide: true, timeout: 2500 }
    );
    cachedAutoStart = true;
    return true;
  } catch {
    cachedAutoStart = false;
    return false;
  }
}

/**
 * Mengaktifkan atau menonaktifkan Auto-Start aiKu saat user login / laptop menyala di Windows.
 * Menggunakan execFile("reg.exe", [...]) tanpa shell (zero command injection) dan HKCU (tanpa butuh UAC Admin).
 */
export async function setWindowsAutoStart(
  enabled: boolean,
  projectRoot: string
): Promise<{ enabled: boolean; commandRegistered: string | null }> {
  if (process.platform !== "win32") {
    return { enabled: false, commandRegistered: null };
  }

  if (enabled) {
    const launchCmd = await resolveStartupLaunchCommand(projectRoot);
    await execFileAsync(
      "reg.exe",
      [
        "add",
        RUN_REGISTRY_KEY,
        "/v",
        REGISTRY_VALUE_NAME,
        "/t",
        "REG_SZ",
        "/d",
        launchCmd,
        "/f",
      ],
      { windowsHide: true, timeout: 3000 }
    );
    cachedAutoStart = true;
    return { enabled: true, commandRegistered: launchCmd };
  }

  try {
    await execFileAsync(
      "reg.exe",
      ["delete", RUN_REGISTRY_KEY, "/v", REGISTRY_VALUE_NAME, "/f"],
      { windowsHide: true, timeout: 3000 }
    );
  } catch {
    // Jika value memang belum ada di registry, abaikan error delete
  }

  cachedAutoStart = false;
  return { enabled: false, commandRegistered: null };
}
