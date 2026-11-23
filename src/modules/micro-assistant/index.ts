import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { LlmInferenceClient } from "../../core/llm/llama-engine.js";
import type { PathGuard } from "../../core/security/path-guard.js";

export const MAX_TLDR_WORDS = 1500;

/**
 * Daftar aksi preset aman yang di-hardcode (BUKAN eksekusi shell bebas).
 */
export const SAFE_PRESET_COMMANDS = [
  "OPEN_SANDBOX",
  "OPEN_QUARANTINE",
  "SHOW_STORAGE_SUMMARY",
] as const;

export const SafePresetCommandSchema = z.enum(SAFE_PRESET_COMMANDS);
export type SafePresetCommand = z.infer<typeof SafePresetCommandSchema>;

/**
 * Memotong teks maksimal 1.500 kata untuk Quick TL;DR agar hemat token & cepat di CPU.
 */
export function truncateToMaxWords(text: string, maxWords: number = MAX_TLDR_WORDS): {
  text: string;
  wordCount: number;
  truncated: boolean;
} {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return { text: text.trim(), wordCount: words.length, truncated: false };
  }
  return {
    text: words.slice(0, maxWords).join(" "),
    wordCount: words.length,
    truncated: true,
  };
}

/**
 * Quick TL;DR: Ringkas teks pendek (maks 1.500 kata) menjadi 3-5 poin utama.
 */
export async function runQuickTldr(
  rawText: string,
  llmClient: LlmInferenceClient
): Promise<{ summary: string; wordCount: number; truncated: boolean }> {
  const { text, wordCount, truncated } = truncateToMaxWords(rawText, MAX_TLDR_WORDS);
  if (wordCount === 0) {
    throw new Error("Teks kosong. Salin atau masukkan teks terlebih dahulu.");
  }

  const prompt = [
    "Ringkas teks berikut menjadi 3 sampai 5 poin utama yang singkat dan jelas dalam Bahasa Indonesia (gunakan format bullet '- ').",
    "Teks:",
    text,
  ].join("\n\n");

  const summary = await llmClient.chat({
    message: prompt,
    history: [],
    sandboxContextSummary: "Mode Quick TL;DR (ringkas teks).",
  });

  return { summary, wordCount, truncated };
}

/**
 * Smart Clipboard Formatter (Pure Local, 0 MB AI RAM):
 * Merapikan teks hasil copy-paste dari PDF yang terpotong barisnya di tengah kalimat,
 * menyambungkan kata ber-hyphen ("pemro-\ngraman" -> "pemrograman"),
 * serta menjaga pemisah paragraf asli.
 */
export function formatBrokenPdfClipboard(rawText: string): string {
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (normalized.length === 0) {
    return "";
  }

  // Pisahkan berdasarkan paragraf (2+ newline)
  const paragraphs = normalized.split(/\n{2,}/);
  const cleaned = paragraphs.map((para) => {
    // Gabungkan kata terpotong hyphen di akhir baris
    const dehyphenated = para.replace(/([a-zA-Z])-\n([a-zA-Z])/g, "$1$2");
    // Pertahankan bullet list, gabungkan baris biasa menjadi satu kalimat utuh
    const lines = dehyphenated.split("\n");
    const merged: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const isBullet = /^([-*•]|\d+[.)])\s+/.test(line);
      if (isBullet || merged.length === 0) {
        merged.push(line);
      } else {
        const lastIdx = merged.length - 1;
        const prev = merged[lastIdx] ?? "";
        merged[lastIdx] = `${prev} ${line}`;
      }
    }

    return merged.join("\n").replace(/[ \t]{2,}/g, " ");
  });

  return cleaned.join("\n\n");
}

/**
 * Memetakan kalimat natural user ke daftar Safe Preset Command yang di-hardcode.
 */
export function matchSafePresetCommand(userText: string): SafePresetCommand | null {
  const lower = userText.toLowerCase();

  if (/\b(buka|open|tampilkan)\b/.test(lower) && /\b(karantina|quarantine)\b/.test(lower)) {
    return "OPEN_QUARANTINE";
  }
  if (/\b(buka|open)\b/.test(lower) && /\b(folder|sandbox|explorer|direktori)\b/.test(lower)) {
    return "OPEN_SANDBOX";
  }
  if (/\b(ukuran|storage|kapasitas|statistik|ringkasan\s+folder|berapa\s+mb)\b/.test(lower)) {
    return "SHOW_STORAGE_SUMMARY";
  }

  return null;
}

async function computeFolderStats(
  dirPath: string,
  pathGuard: PathGuard
): Promise<{ fileCount: number; totalBytes: number; byExtension: Record<string, number> }> {
  let fileCount = 0;
  let totalBytes = 0;
  const byExtension: Record<string, number> = {};

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      try {
        await pathGuard.validatePathStrict(fullPath);
      } catch {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const st = await fs.stat(fullPath);
        fileCount += 1;
        totalBytes += st.size;
        const ext = path.extname(entry.name).toLowerCase() || "(tanpa ext)";
        byExtension[ext] = (byExtension[ext] ?? 0) + 1;
      }
    }
  }

  await walk(dirPath);
  return { fileCount, totalBytes, byExtension };
}

/**
 * Mengeksekusi hanya aksi preset aman yang terverifikasi Zod + PathGuard.
 * Dilarang keras menerima perintah shell bebas.
 */
export async function executeSafePresetCommand(options: {
  command: SafePresetCommand;
  sandboxRoot: string;
  quarantineDirName: string;
  pathGuard: PathGuard;
}): Promise<{ command: SafePresetCommand; message: string; data?: unknown }> {
  const validatedCommand = SafePresetCommandSchema.parse(options.command);
  const validatedSandbox = await options.pathGuard.validatePathStrict(options.sandboxRoot);

  switch (validatedCommand) {
    case "OPEN_SANDBOX": {
      if (process.platform === "win32") {
        const child = spawn("explorer.exe", [validatedSandbox], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      }
      return {
        command: validatedCommand,
        message: `Membuka folder sandbox di File Explorer: \`${validatedSandbox}\``,
      };
    }

    case "OPEN_QUARANTINE": {
      const quarantinePath = await options.pathGuard.validatePathStrict(
        path.join(validatedSandbox, options.quarantineDirName)
      );
      await fs.mkdir(quarantinePath, { recursive: true });
      if (process.platform === "win32") {
        const child = spawn("explorer.exe", [quarantinePath], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      }
      return {
        command: validatedCommand,
        message: `Membuka folder karantina di File Explorer: \`${quarantinePath}\``,
      };
    }

    case "SHOW_STORAGE_SUMMARY": {
      const stats = await computeFolderStats(validatedSandbox, options.pathGuard);
      const sizeKb = (stats.totalBytes / 1024).toFixed(1);
      const breakdown = Object.entries(stats.byExtension)
        .map(([ext, count]) => `${ext}: ${count}`)
        .join(", ");
      return {
        command: validatedCommand,
        message: `Ringkasan Sandbox: **${stats.fileCount} file** (total **${sizeKb} KB**). Rincian: ${breakdown || "kosong"}.`,
        data: stats,
      };
    }
  }
}
