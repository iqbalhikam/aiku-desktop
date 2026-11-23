import path from "node:path";
import type { FileOperationProposal } from "../../core/security/schemas.js";

const FAST_PATH_RULES: Readonly<Record<string, string>> = {
  // Video
  ".mp4": "Video",
  ".mkv": "Video",
  ".avi": "Video",
  ".mov": "Video",
  ".webm": "Video",
  ".wmv": "Video",
  ".flv": "Video",

  // Arsip
  ".zip": "Arsip",
  ".rar": "Arsip",
  ".7z": "Arsip",
  ".tar": "Arsip",
  ".gz": "Arsip",
  ".bz2": "Arsip",
  ".xz": "Arsip",

  // Installer
  ".exe": "Installer",
  ".msi": "Installer",
  ".msix": "Installer",
  ".dmg": "Installer",
  ".pkg": "Installer",
  ".deb": "Installer",
  ".appimage": "Installer",

  // Gambar
  ".jpg": "Gambar",
  ".jpeg": "Gambar",
  ".png": "Gambar",
  ".gif": "Gambar",
  ".webp": "Gambar",
  ".bmp": "Gambar",
  ".svg": "Gambar",
  ".ico": "Gambar",
  ".heic": "Gambar",

  // Audio
  ".mp3": "Audio",
  ".wav": "Audio",
  ".flac": "Audio",
  ".aac": "Audio",
  ".ogg": "Audio",
  ".m4a": "Audio",
};

/**
 * Rule-Based Fast Path (Tanpa AI):
 * Mengelompokkan file dengan ekstensi jelas langsung berdasarkan aturan ekstensi.
 */
export function matchFastPathCategory(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return FAST_PATH_RULES[ext] ?? null;
}

export function buildFastPathProposal(
  sourceFilePath: string,
  sandboxRoot: string
): FileOperationProposal | null {
  const category = matchFastPathCategory(sourceFilePath);
  if (category === null) {
    return null;
  }

  const fileName = path.basename(sourceFilePath);
  const destination = path.join(sandboxRoot, category, fileName);

  return {
    action: "MOVE",
    source: sourceFilePath,
    destination,
    reason: `Fast Path rule-based: ekstensi ${path.extname(fileName).toLowerCase()} -> folder ${category}`,
    origin: "FAST_PATH",
  };
}
