import { spawn } from "node:child_process";
import crypto from "node:crypto";
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
  "OPEN_NOTEPAD",
  "OPEN_CALCULATOR",
  "OPEN_EDGE",
  "OPEN_CHROME",
  "OPEN_VSCODE",
  "OPEN_SPOTIFY",
  "OPEN_YOUTUBE",
  "OPEN_WHATSAPP",
  "OPEN_EXPLORER",
  "OPEN_WINDOWS_SETTINGS",
  "OPEN_TASK_MANAGER",
  "OPEN_PAINT",
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
 * Ekstrak daftar To-Do dari teks mentah menjadi format Markdown Checklist & JSON terstruktur.
 * Berjalan 100% lokal (0 MB AI RAM) untuk kecepatan instan.
 */
export interface ExtractedTodoItem {
  task: string;
  done: boolean;
}

export function extractTodoChecklist(rawText: string): {
  items: ExtractedTodoItem[];
  markdown: string;
  json: string;
} {
  const lines = rawText
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);

  const items: ExtractedTodoItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // Deteksi baris yang sudah berupa checkbox/bullet/numbering atau kalimat tugas
    const doneMatch = line.match(/^[-*•]?\s*\[[xX]\]\s+(.+)$/);
    if (doneMatch?.[1]) {
      const task = doneMatch[1].trim();
      const key = task.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ task, done: true });
      }
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*•]\s*(?:\[\s*\])?|\d+[.)])\s*(.+)$/);
    const candidate = (bulletMatch?.[1] ?? line).trim();
    const cleaned = candidate.replace(/^(todo|to-do|tugas|task)\s*:\s*/i, "").trim();

    if (cleaned.length >= 3 && cleaned.length <= 200) {
      const key = cleaned.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ task: cleaned, done: false });
      }
    }
  }

  const markdown = items
    .map((item) => `- [${item.done ? "x" : " "}] ${item.task}`)
    .join("\n");

  return {
    items,
    markdown,
    json: JSON.stringify(items, null, 2),
  };
}

/**
 * Quick Notes lokal yang tervalidasi Zod, tersimpan aman di ./logs/notes.json.
 */
export const QuickNoteSchema = z
  .object({
    id: z.number().int().positive(),
    text: z.string().min(1).max(400),
    createdAt: z.string().datetime(),
  })
  .strict();

export type QuickNote = z.infer<typeof QuickNoteSchema>;
const QuickNotesListSchema = z.array(QuickNoteSchema);

export class QuickNotesStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  public async readAll(): Promise<QuickNote[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return QuickNotesListSchema.parse(JSON.parse(raw));
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
  }

  public async add(text: string): Promise<QuickNote> {
    const notes = await this.readAll();
    const nextId = notes.reduce((max, n) => Math.max(max, n.id), 0) + 1;
    const note: QuickNote = {
      id: nextId,
      text: text.trim().slice(0, 400),
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    await this.writeAll(notes);
    return note;
  }

  public async removeByIndex(oneBasedIndex: number): Promise<QuickNote | null> {
    const notes = await this.readAll();
    const idx = oneBasedIndex - 1;
    if (idx < 0 || idx >= notes.length) {
      return null;
    }
    const [removed] = notes.splice(idx, 1);
    await this.writeAll(notes);
    return removed ?? null;
  }

  private async writeAll(notes: readonly QuickNote[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(notes, null, 2) + "\n", "utf8");
    await fs.rename(tmp, this.filePath);
  }
}

/**
 * Generator Password Kuat Kriptografis (100% lokal via crypto.randomInt).
 */
export function generateSecurePassword(length: number = 16): string {
  const safeLen = Math.min(Math.max(Math.floor(length), 8), 64);
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*_-+=";
  const all = upper + lower + digits + symbols;

  const chars: string[] = [
    upper[crypto.randomInt(upper.length)] ?? "A",
    lower[crypto.randomInt(lower.length)] ?? "a",
    digits[crypto.randomInt(digits.length)] ?? "7",
    symbols[crypto.randomInt(symbols.length)] ?? "!",
  ];

  while (chars.length < safeLen) {
    chars.push(all[crypto.randomInt(all.length)] ?? "x");
  }

  // Fisher-Yates shuffle dengan crypto.randomInt
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }

  return chars.join("");
}

/**
 * Kalkulator ekspresi matematika aman (Recursive Descent Parser, TANPA eval()).
 */
export function evaluateSafeMathExpression(rawExpr: string): number | null {
  const expr = rawExpr.replace(/,/g, ".").replace(/x/gi, "*").trim();
  if (!/^[0-9+\-*/().^\s]+$/.test(expr) || !/[+\-*/^]/.test(expr)) {
    return null;
  }

  const tokens = expr.match(/\d+(?:\.\d+)?|[+\-*/()^]/g);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  let pos = 0;

  function peek(): string | undefined {
    return tokens?.[pos];
  }

  function consume(): string | undefined {
    const tok = tokens?.[pos];
    pos += 1;
    return tok;
  }

  function parseExpression(): number {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parsePower();
      if (op === "/" && right === 0) {
        throw new Error("Pembagian dengan nol tidak diizinkan.");
      }
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function parsePower(): number {
    let base = parseUnary();
    if (peek() === "^") {
      consume();
      const exp = parsePower();
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    if (peek() === "-") {
      consume();
      return -parseUnary();
    }
    if (peek() === "+") {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const tok = peek();
    if (tok === "(") {
      consume();
      const val = parseExpression();
      if (consume() !== ")") {
        throw new Error("Tanda kurung tidak seimbang.");
      }
      return val;
    }
    if (tok !== undefined && /^\d+(?:\.\d+)?$/.test(tok)) {
      consume();
      return Number.parseFloat(tok);
    }
    throw new Error("Ekspresi matematika tidak valid.");
  }

  try {
    const result = parseExpression();
    if (pos !== tokens.length || !Number.isFinite(result)) {
      return null;
    }
    return Math.round(result * 1_000_000) / 1_000_000;
  } catch {
    return null;
  }
}

/**
 * Konverter satuan instan (data, jarak, berat, suhu).
 */
export function convertUnitExpression(rawText: string): string | null {
  const match = rawText
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:[.,]\d+)?)\s*(b|kb|mb|gb|tb|km|m|cm|mil|mile|ft|inch|kg|g|lb|c|f)\s+(?:ke|to|in)\s+(b|kb|mb|gb|tb|km|m|cm|mil|mile|ft|inch|kg|g|lb|c|f)$/);

  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const value = Number.parseFloat(match[1].replace(",", "."));
  const from = match[2] === "mile" ? "mil" : match[2];
  const to = match[3] === "mile" ? "mil" : match[3];

  // Suhu
  if (from === "c" && to === "f") {
    return `${value} °C = **${((value * 9) / 5 + 32).toFixed(2)} °F**`;
  }
  if (from === "f" && to === "c") {
    return `${value} °F = **${(((value - 32) * 5) / 9).toFixed(2)} °C**`;
  }

  const tables: Array<Record<string, number>> = [
    { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 },
    { cm: 0.01, m: 1, km: 1000, inch: 0.0254, ft: 0.3048, mil: 1609.344 },
    { g: 1, kg: 1000, lb: 453.59237 },
  ];

  for (const table of tables) {
    const fFactor = table[from];
    const tFactor = table[to];
    if (fFactor !== undefined && tFactor !== undefined) {
      const converted = (value * fFactor) / tFactor;
      const formatted =
        Math.abs(converted) >= 100
          ? converted.toLocaleString("id-ID", { maximumFractionDigits: 2 })
          : Number(converted.toFixed(4)).toString();
      return `${value} ${from.toUpperCase()} = **${formatted} ${to.toUpperCase()}**`;
    }
  }

  return null;
}

/**
 * Memetakan kalimat natural user ke daftar Safe Preset Command yang di-hardcode.
 */
export function matchSafePresetCommand(userText: string): SafePresetCommand | null {
  const lower = userText.toLowerCase();

  if (/\b(buka|open|jalankan|jalanin|tampilkan)\b/.test(lower)) {
    if (/\b(karantina|quarantine)\b/.test(lower)) return "OPEN_QUARANTINE";
    if (/\b(sandbox|folder\s+sandbox)\b/.test(lower)) return "OPEN_SANDBOX";
    if (/\b(notepad|catatan\s+windows)\b/.test(lower)) return "OPEN_NOTEPAD";
    if (/\b(kalkulator|calculator|calc)\b/.test(lower)) return "OPEN_CALCULATOR";
    if (/\b(chrome|google\s+chrome)\b/.test(lower)) return "OPEN_CHROME";
    if (/\b(edge|browser)\b/.test(lower)) return "OPEN_EDGE";
    if (/\b(vs\s*code|vscode|visual\s+studio\s+code)\b/.test(lower)) return "OPEN_VSCODE";
    if (/\b(spotify)\b/.test(lower)) return "OPEN_SPOTIFY";
    if (/\b(youtube|yt)\b/.test(lower)) return "OPEN_YOUTUBE";
    if (/\b(whatsapp|wa)\b/.test(lower)) return "OPEN_WHATSAPP";
    if (/\b(task\s*manager)\b/.test(lower)) return "OPEN_TASK_MANAGER";
    if (/\b(paint|mspaint)\b/.test(lower)) return "OPEN_PAINT";
    if (/\b(pengaturan\s+windows|windows\s+settings|setting\s+windows)\b/.test(lower)) {
      return "OPEN_WINDOWS_SETTINGS";
    }
    if (/\b(explorer|file\s+explorer|folder)\b/.test(lower)) return "OPEN_EXPLORER";
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

    default: {
      // Safe Hardcoded Windows App Launcher (ZERO user input passed to shell!)
      const SAFE_APP_TARGETS: Readonly<
        Record<
          Exclude<SafePresetCommand, "OPEN_SANDBOX" | "OPEN_QUARANTINE" | "SHOW_STORAGE_SUMMARY">,
          { label: string; bin: string; args: readonly string[] }
        >
      > = {
        OPEN_NOTEPAD: { label: "Notepad", bin: "notepad.exe", args: [] },
        OPEN_CALCULATOR: { label: "Kalkulator", bin: "calc.exe", args: [] },
        OPEN_EDGE: { label: "Microsoft Edge", bin: "cmd.exe", args: ["/c", "start", "", "msedge"] },
        OPEN_CHROME: { label: "Google Chrome", bin: "cmd.exe", args: ["/c", "start", "", "chrome"] },
        OPEN_VSCODE: { label: "VS Code", bin: "cmd.exe", args: ["/c", "start", "", "code"] },
        OPEN_SPOTIFY: { label: "Spotify", bin: "cmd.exe", args: ["/c", "start", "", "spotify:"] },
        OPEN_YOUTUBE: { label: "YouTube", bin: "cmd.exe", args: ["/c", "start", "", "https://youtube.com"] },
        OPEN_WHATSAPP: { label: "WhatsApp", bin: "cmd.exe", args: ["/c", "start", "", "whatsapp:"] },
        OPEN_EXPLORER: { label: "File Explorer", bin: "explorer.exe", args: [] },
        OPEN_WINDOWS_SETTINGS: { label: "Windows Settings", bin: "cmd.exe", args: ["/c", "start", "", "ms-settings:"] },
        OPEN_TASK_MANAGER: { label: "Task Manager", bin: "taskmgr.exe", args: [] },
        OPEN_PAINT: { label: "Paint", bin: "mspaint.exe", args: [] },
      };

      const target = SAFE_APP_TARGETS[validatedCommand];
      if (process.platform === "win32") {
        const child = spawn(target.bin, [...target.args], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();
      }
      return {
        command: validatedCommand,
        message: `Membuka **${target.label}** untuk Anda!`,
      };
    }
  }
}

const BrowserTargetInputSchema = z.string().trim().min(1).max(300);

/**
 * Membuka URL HTTPS/HTTP atau kueri pencarian Google di browser bawaan Windows
 * melalui rundll32 url.dll,FileProtocolHandler (tanpa cmd.exe -> zero shell injection).
 */
export function openSafeBrowserTarget(rawQueryOrUrl: string): { url: string; message: string } {
  const cleaned = BrowserTargetInputSchema.parse(rawQueryOrUrl);
  let targetUrl: string;

  const looksLikeDomain =
    /^https?:\/\//i.test(cleaned) ||
    (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(cleaned) && !cleaned.includes(" "));

  if (looksLikeDomain) {
    const withProto = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    const parsed = new URL(withProto);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Hanya protokol HTTP/HTTPS yang diizinkan.");
    }
    targetUrl = parsed.toString();
  } else {
    targetUrl = `https://www.google.com/search?q=${encodeURIComponent(cleaned)}`;
  }

  if (process.platform === "win32") {
    const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", targetUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }

  return {
    url: targetUrl,
    message: `Membuka di browser: ${targetUrl}`,
  };
}
