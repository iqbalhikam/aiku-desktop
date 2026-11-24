import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export const MediaControlActionSchema = z.enum(["get", "toggle", "next", "prev"]);
export type MediaControlAction = z.infer<typeof MediaControlActionSchema>;

export const MediaSessionStatusSchema = z.object({
  active: z.boolean(),
  title: z.string().optional(),
  artist: z.string().optional(),
  status: z.string().optional(),
});

export type MediaSessionStatus = z.infer<typeof MediaSessionStatusSchema>;

let cachedMediaStatus: MediaSessionStatus = { active: false };
let lastMediaRefreshMs = 0;
let mediaRefreshInFlight = false;
const MEDIA_CACHE_TTL_MS = 10_000;

async function runPowerShellMediaAction(safeAction: MediaControlAction): Promise<MediaSessionStatus> {
  if (process.platform !== "win32") {
    return { active: false };
  }
  const scriptPath = path.resolve(process.cwd(), "scripts", "win-media.ps1");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Action", safeAction],
      {
        timeout: 3500,
        windowsHide: true,
        encoding: "utf8",
      }
    );

    const lastLine = stdout
      .trim()
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().startsWith("{"));

    if (!lastLine) {
      return { active: false };
    }

    const parsed: unknown = JSON.parse(lastLine);
    return MediaSessionStatusSchema.parse(parsed);
  } catch {
    return { active: false };
  }
}

/**
 * Deteksi & kontrol Music Player Windows 11 (Spotify, YouTube Music, Chrome, Edge, VLC).
 * Mode "get" bersifat NON-BLOCKING (0ms): langsung mengembalikan cache memori dan memperbarui
 * di latar belakang agar pipa JSON-RPC tidak pernah tertahan oleh proses PowerShell!
 */
export async function queryWindowsMedia(
  action: MediaControlAction = "get"
): Promise<MediaSessionStatus> {
  const safeAction = MediaControlActionSchema.parse(action);
  if (process.platform !== "win32") {
    return { active: false };
  }

  if (safeAction === "get") {
    const now = Date.now();
    if (!mediaRefreshInFlight && now - lastMediaRefreshMs >= MEDIA_CACHE_TTL_MS) {
      mediaRefreshInFlight = true;
      lastMediaRefreshMs = now;
      void runPowerShellMediaAction("get")
        .then((fresh) => {
          cachedMediaStatus = fresh;
        })
        .finally(() => {
          mediaRefreshInFlight = false;
        });
    }
    return cachedMediaStatus;
  }

  // Untuk aksi eksplisit user (toggle / next / prev), jalankan & perbarui cache
  const updated = await runPowerShellMediaAction(safeAction);
  cachedMediaStatus = updated;
  lastMediaRefreshMs = Date.now();
  return updated;
}
