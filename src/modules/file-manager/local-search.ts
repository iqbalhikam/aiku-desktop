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
  depth: number;
}

export interface SandboxOverview {
  totalIndexedFiles: number;
  topFolders: string[];
  topFiles: IndexedFileEntry[];
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

export function formatHumanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * Fallback parser deterministik (tanpa AI) untuk kueri sederhana bahasa Indonesia/Inggris.
 */
export function parseSearchQueryHeuristic(query: string, now: Date = new Date()): SearchFilter {
  const lower = query.toLowerCase();

  // Deteksi ekstensi umum
  const extMatch = lower.match(/\b(pdf|docx|doc|txt|md|jpg|jpeg|png|mp4|mkv|avi|mp3|wav|zip|rar|exe|msi|xlsx|pptx)\b/);
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
    "sebutkan",
    "kasih",
    "tahu",
    "tau",
    "sandbox",
    "folder",
    "direktori",
    "directory",
    "desktop",
    "isi",
    "isinya",
    "dalam",
    "terdaftar",
    "daftar",
    "list",
    "saya",
    "aku",
    "ku",
    "kamu",
    "anda",
    "kita",
    "nya",
    "itu",
    "ini",
    "tadi",
    "tersebut",
    "salah",
    "satu",
    "satunya",
    "namanya",
    "nama",
    "contoh",
    "contohnya",
    "misalnya",
    "mana",
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
    "pada",
    "sekarang",
    "bulan",
    "lalu",
    "minggu",
    "hari",
    "find",
    "search",
    "show",
    "all",
    "my",
    "the",
    "in",
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

const IGNORED_HEAVY_DIRS = new Set<string>([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "_ai_karantina",
]);

const MAX_INDEXED_FILES = 5000;
const INDEX_CACHE_TTL_MS = 20_000;

interface CachedFileIndex {
  dirsKey: string;
  timestampMs: number;
  entries: IndexedFileEntry[];
  topFolders: string[];
}

let cachedFileIndex: CachedFileIndex | null = null;

export function invalidateLocalSearchCache(): void {
  cachedFileIndex = null;
}

/**
 * Penelusuran Breadth-First (BFS) per level kedalaman:
 * Memastikan 100% file & folder utama di root Desktop (depth 0 & depth 1) selalu terindeks
 * lebih dulu dan tidak pernah tertelan oleh subfolder dalam (seperti folder recovery ribuan file).
 */
async function indexDirectoryBreadthFirst(
  rootDir: string,
  pathGuard: PathGuard,
  collector: IndexedFileEntry[],
  topFolders: string[]
): Promise<void> {
  const queue: Array<{ dirPath: string; depth: number }> = [{ dirPath: rootDir, depth: 0 }];
  let qIdx = 0;

  while (qIdx < queue.length && collector.length < MAX_INDEXED_FILES) {
    const current = queue[qIdx++]!;
    if (current.depth > 5) continue;

    let dirEntries;
    try {
      dirEntries = await fs.readdir(current.dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of dirEntries) {
      if (collector.length >= MAX_INDEXED_FILES) break;
      if (entry.isSymbolicLink()) continue;

      const lowerName = entry.name.toLowerCase();
      if (entry.isDirectory() && (IGNORED_HEAVY_DIRS.has(lowerName) || lowerName.startsWith("."))) {
        continue;
      }

      const fullPath = path.join(current.dirPath, entry.name);
      try {
        pathGuard.validatePath(fullPath);
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        if (current.depth === 0 && topFolders.length < 40) {
          topFolders.push(entry.name);
        }
        queue.push({ dirPath: fullPath, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        if (lowerName === "desktop.ini" || lowerName === "thumbs.db") {
          continue;
        }
        try {
          const stat = await fs.stat(fullPath);
          collector.push({
            fullPath,
            relativePath: path.relative(rootDir, fullPath),
            fileName: entry.name,
            extension: path.extname(entry.name).toLowerCase(),
            sizeBytes: stat.size,
            modifiedAt: stat.mtime,
            depth: current.depth,
          });
        } catch {
          // Abaikan file yang terkunci sementara
        }
      }
    }
  }
}

async function ensureIndexCache(
  allowedDirectories: readonly string[],
  pathGuard: PathGuard
): Promise<CachedFileIndex> {
  const dirsKey = allowedDirectories.join("|").toLowerCase();
  const nowMs = Date.now();
  if (
    cachedFileIndex !== null &&
    cachedFileIndex.dirsKey === dirsKey &&
    nowMs - cachedFileIndex.timestampMs < INDEX_CACHE_TTL_MS
  ) {
    return cachedFileIndex;
  }

  const allEntries: IndexedFileEntry[] = [];
  const topFolders: string[] = [];

  for (const dir of allowedDirectories) {
    if (allEntries.length >= MAX_INDEXED_FILES) break;
    try {
      const validatedDir = await pathGuard.validatePathStrict(dir);
      await indexDirectoryBreadthFirst(validatedDir, pathGuard, allEntries, topFolders);
    } catch {
      // Lewati direktori yang belum ada atau tidak valid
    }
  }

  // Urutkan agar file dokumen nyata (bukan shortcut .lnk) di root Desktop & terbaru selalu tampil paling atas!
  allEntries.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const aIsShortcut = a.extension === ".lnk" || a.extension === ".url" ? 1 : 0;
    const bIsShortcut = b.extension === ".lnk" || b.extension === ".url" ? 1 : 0;
    if (aIsShortcut !== bIsShortcut) return aIsShortcut - bIsShortcut;
    return b.modifiedAt.getTime() - a.modifiedAt.getTime();
  });

  cachedFileIndex = {
    dirsKey,
    timestampMs: nowMs,
    entries: allEntries,
    topFolders,
  };
  return cachedFileIndex;
}

export async function getIndexedEntriesCached(
  allowedDirectories: readonly string[],
  pathGuard: PathGuard
): Promise<IndexedFileEntry[]> {
  const cache = await ensureIndexCache(allowedDirectories, pathGuard);
  return cache.entries;
}

export async function getSandboxOverviewCached(
  allowedDirectories: readonly string[],
  pathGuard: PathGuard
): Promise<SandboxOverview> {
  const cache = await ensureIndexCache(allowedDirectories, pathGuard);
  return {
    totalIndexedFiles: cache.entries.length,
    topFolders: cache.topFolders,
    topFiles: cache.entries.slice(0, 15),
  };
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
  "direktori",
  "isi",
  "isinya",
  "saya",
  "aku",
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

export function sanitizeAiSearchFilter(query: string, aiFilter: SearchFilter): SearchFilter {
  const lowerQuery = query.toLowerCase();

  let extension = aiFilter.extension;
  if (extension) {
    const bareExt = extension.replace(/^\./, "").toLowerCase();
    const extMentioned = new RegExp(`\\b\\.?${bareExt}\\b`, "i").test(lowerQuery);
    if (!extMentioned) {
      extension = null;
    }
  }

  const keywords = aiFilter.keywords.filter((kw) => {
    const lowerKw = kw.toLowerCase().trim();
    if (lowerKw.length < 2 || PROMPT_LEAK_STOPWORDS.has(lowerKw)) {
      return false;
    }
    return lowerQuery.includes(lowerKw);
  });

  const hasTimeHint = TIME_EXPRESSION_REGEX.test(lowerQuery);
  const dateRange = hasTimeHint ? aiFilter.dateRange : { from: null, to: null };

  return SearchFilterSchema.parse({
    extension,
    keywords,
    dateRange,
  });
}

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

  const allEntries = await getIndexedEntriesCached(options.allowedDirectories, options.pathGuard);
  const matches = applySearchFilter(allEntries, filter);
  return { filter, usedAi, matches };
}
