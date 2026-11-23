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

/**
 * Deteksi & kontrol Music Player Windows 11 (Spotify, YouTube Music, Chrome, Edge, VLC)
 * melalui Windows Global System Media Transport Controls (GSMTC), 0 dependensi eksternal.
 */
export async function queryWindowsMedia(
  action: MediaControlAction = "get"
): Promise<MediaSessionStatus> {
  const safeAction = MediaControlActionSchema.parse(action);
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
