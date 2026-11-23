import fs from "node:fs/promises";
import path from "node:path";
import type { LlmInferenceClient } from "../../core/llm/llama-engine.js";
import type { PathGuard } from "../../core/security/path-guard.js";
import { type SearchFilter, SearchFilterSchema } from "../../core/security/schemas.js";

export interface IndexedFileEntry {
  fullPath: string;
  relativePath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: Date;
}

export interface LocalSearchResult {
  filter: SearchFilter;
  usedAi: boolean;
  matches: IndexedFileEntry[];
}

function formatDateIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Fallback parser deterministik (tanpa AI) untuk kueri sederhana bahasa Indonesia/Inggris.
 */
export function parseSearchQueryHeuristic(query: string, now: Date = new Date()): SearchFilter {
  const lower = query.toLowerCase();

  // Deteksi ekstensi umum
  const extMatch = lower.match(/\b(pdf|docx|doc|txt|md|jpg|jpeg|png|mp4|mkv|zip|rar|exe|msi|xlsx|pptx)\b/);
  const extension = extMatch?.[1] ? `.${extMatch[1]}` : null;

  // Deteksi rentang waktu sederhana
  let from: string | null = null;
  let to: string | null = null;

  if (lower.includes("bulan lalu") || lower.includes("last month")) {
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    from = formatDateIso(startLastMonth);
    to = formatDateIso(endLastMonth);
  } else if (lower.includes("bulan ini") || lower.includes("this month")) {
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    from = formatDateIso(startThisMonth);
    to = formatDateIso(now);
  } else if (lower.includes("minggu lalu") || lower.includes("last week")) {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    from = formatDateIso(weekAgo);
    to = formatDateIso(now);
  } else if (lower.includes("hari ini") || lower.includes("today")) {
    from = formatDateIso(now);
    to = formatDateIso(now);
  }

  const stopWords = new Set<string>([
    "ada",
    "apa",
    "aja",
    "saja",
    "sih",
    "semua",
    "lihat",
    "tampilkan",
    "sandbox",
    "folder",
    "isi",
    "daftar",
    "list",
    "dong",
    "tolong",
    "coba",
    "cari",
    "carikan",
    "temukan",
    "file",
    "berkas",
    "dokumen",
    "yang",
    "di",
    "dari",
    "bulan",
    "lalu",
    "ini",
    "minggu",
    "hari",
    "find",
    "search",
    "last",
    "month",
    "week",
    "this",
    "today",
    ...(extMatch?.[1] ? [extMatch[1]] : []),
  ]);

  const keywords = lower
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !stopWords.has(word))
    .slice(0, 8);

  return SearchFilterSchema.parse({
    extension,
    keywords,
    dateRange: { from, to },
  });
}

async function indexDirectory(
  rootDir: string,
  currentDir: string,
  pathGuard: PathGuard
): Promise<IndexedFileEntry[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const results: IndexedFileEntry[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    try {
      await pathGuard.validatePathStrict(fullPath);
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      const nested = await indexDirectory(rootDir, fullPath, pathGuard);
      results.push(...nested);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      results.push({
        fullPath,
        relativePath: path.relative(rootDir, fullPath),
        fileName: entry.name,
        extension: path.extname(entry.name).toLowerCase(),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime,
      });
    }
  }

  return results;
}

export function applySearchFilter(
  entries: readonly IndexedFileEntry[],
  filter: SearchFilter
): IndexedFileEntry[] {
  const normalizedExt = filter.extension
    ? filter.extension.startsWith(".")
      ? filter.extension.toLowerCase()
      : `.${filter.extension.toLowerCase()}`
    : null;

  const fromMs = filter.dateRange.from
    ? new Date(`${filter.dateRange.from}T00:00:00.000Z`).getTime()
    : null;
  const toMs = filter.dateRange.to
    ? new Date(`${filter.dateRange.to}T23:59:59.999Z`).getTime()
    : null;

  return entries.filter((entry) => {
    if (normalizedExt && entry.extension !== normalizedExt) {
      return false;
    }

    if (fromMs !== null && entry.modifiedAt.getTime() < fromMs) {
      return false;
    }
    if (toMs !== null && entry.modifiedAt.getTime() > toMs) {
      return false;
    }

    if (filter.keywords.length > 0) {
      const haystack = `${entry.fileName} ${entry.relativePath}`.toLowerCase();
      const matchedAny = filter.keywords.some((kw) => haystack.includes(kw.toLowerCase()));
      if (!matchedAny) {
        return false;
      }
    }

    return true;
  });
}

const PROMPT_LEAK_STOPWORDS = new Set<string>([
  "file",
  "files",
  "berkas",
  "dokumen",
  "document",
  "local",
  "lokal",
  "json",
  "sandbox",
  "folder",
  "semua",
  "all",
  "list",
  "daftar",
  "apa",
  "aja",
  "saja",
  "sih",
  "ada",
  "cari",
  "carikan",
  "lihat",
  "tampilkan",
  "show",
  "find",
  "search",
]);

const TIME_EXPRESSION_REGEX =
  /\b(hari\s+ini|kemarin|minggu|bulan|tahun|today|yesterday|week|month|year|lalu|terakhir|20\d{2}|jan|feb|mar|apr|mei|may|jun|jul|agu|aug|sep|okt|oct|nov|des|dec)\b/i;

/**
 * Guard anti-halusinasi untuk model kecil (Qwen 0.5B):
 * Mencegah kebocoran kata dari system prompt (mis. ".json", "local", "file", tanggal hari ini)
 * masuk ke filter jika pengguna tidak pernah menyebutkannya di kueri.
 */
export function sanitizeAiSearchFilter(query: string, aiFilter: SearchFilter): SearchFilter {
  const lowerQuery = query.toLowerCase();

  // 1. Validasi extension: hanya pertahankan jika disebut di kueri
  let extension = aiFilter.extension;
  if (extension) {
    const bareExt = extension.replace(/^\./, "").toLowerCase();
    const extMentioned = new RegExp(`\\b\\.?${bareExt}\\b`, "i").test(lowerQuery);
    if (!extMentioned) {
      extension = null;
    }
  }

  // 2. Validasi keywords: hapus kata bocoran prompt & kata yang tidak ada di kueri pengguna
  const keywords = aiFilter.keywords.filter((kw) => {
    const lowerKw = kw.toLowerCase().trim();
    if (lowerKw.length < 2 || PROMPT_LEAK_STOPWORDS.has(lowerKw)) {
      return false;
    }
    return lowerQuery.includes(lowerKw);
  });

  // 3. Validasi dateRange: hanya pertahankan jika kueri mengandung ekspresi waktu
  const hasTimeHint = TIME_EXPRESSION_REGEX.test(lowerQuery);
  const dateRange = hasTimeHint ? aiFilter.dateRange : { from: null, to: null };

  return SearchFilterSchema.parse({
    extension,
    keywords,
    dateRange,
  });
}

/**
 * Natural Language Local Search:
 * Menerjemahkan kueri santai ke SearchFilter JSON (pakai AI atau fallback heuristik)
 * lalu mencari file di indeks lokal sandbox.
 */
export async function runLocalNaturalSearch(options: {
  query: string;
  allowedDirectories: readonly string[];
  pathGuard: PathGuard;
  llmClient?: LlmInferenceClient;
  useAi: boolean;
  now?: Date;
}): Promise<LocalSearchResult> {
  const now = options.now ?? new Date();
  let filter: SearchFilter;
  let usedAi = false;

  if (options.useAi && options.llmClient) {
    const rawAiFilter = await options.llmClient.parseSearchQuery({
      query: options.query,
      currentDateIso: formatDateIso(now),
    });
    filter = sanitizeAiSearchFilter(options.query, rawAiFilter);
    usedAi = true;
  } else {
    filter = parseSearchQueryHeuristic(options.query, now);
  }

  const allEntries: IndexedFileEntry[] = [];
  for (const dir of options.allowedDirectories) {
    try {
      const validatedDir = await options.pathGuard.validatePathStrict(dir);
      const indexed = await indexDirectory(validatedDir, validatedDir, options.pathGuard);
      allEntries.push(...indexed);
    } catch {
      // Lewati direktori yang belum ada atau tidak valid
    }
  }

  const matches = applySearchFilter(allEntries, filter);
  return { filter, usedAi, matches };
}
