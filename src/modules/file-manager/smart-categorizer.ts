import fs from "node:fs/promises";
import path from "node:path";
import type { LlmInferenceClient } from "../../core/llm/llama-engine.js";
import { type PathGuard, sanitizeFileName } from "../../core/security/path-guard.js";
import {
  AiFileSuggestionSchema,
  type FileOperationProposal,
} from "../../core/security/schemas.js";
import { extractSafeDocumentSnippet, isSupportedDocument } from "./text-extractor.js";

const CLEAN_DATED_PREFIX = /^\d{4}-\d{2}_[A-Za-z0-9][A-Za-z0-9_-]{2,}$/;

/**
 * Menentukan apakah nama dokumen terlihat belum rapi / tidak jelas
 * (misal: doc1.pdf, scan_002.pdf, untitled.txt, IMG_1234.pdf, dsb.).
 */
export function needsSmartCategorization(filePath: string): boolean {
  if (!isSupportedDocument(filePath)) {
    return false;
  }
  const baseName = path.parse(filePath).name;
  // Jika sudah mengikuti format YYYY-MM_Judul-Singkat, tidak perlu di-rename lagi
  return !CLEAN_DATED_PREFIX.test(baseName);
}

function formatYearMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function ensureExtension(proposedName: string, originalExt: string): string {
  const safeName = sanitizeFileName(proposedName);
  const lowerExt = originalExt.toLowerCase();
  if (safeName.toLowerCase().endsWith(lowerExt)) {
    return safeName;
  }
  const parsed = path.parse(safeName);
  return `${parsed.name}${lowerExt}`;
}

export interface SmartCategorizerOptions {
  llmClient: LlmInferenceClient;
  pathGuard: PathGuard;
  categories: readonly string[];
}

/**
 * AI Smart Categorizer & Renamer:
 * Menggunakan Qwen2.5-0.5B-Instruct (via GBNF Grammar) hanya sebagai pemberi saran JSON.
 * Tidak ada eksekusi fs di sini — hanya mengembalikan FileOperationProposal tervalidasi.
 */
export async function buildSmartDocumentProposal(
  sourceFilePath: string,
  sandboxRoot: string,
  options: SmartCategorizerOptions
): Promise<FileOperationProposal> {
  const validatedSource = await options.pathGuard.validatePathStrict(sourceFilePath);
  const originalExt = path.extname(validatedSource);
  const originalBaseName = path.basename(validatedSource);

  const stat = await fs.stat(validatedSource);
  const currentYearMonth = formatYearMonth(stat.mtime);

  const safeDocumentSnippet = await extractSafeDocumentSnippet(validatedSource, options.pathGuard);

  const rawSuggestion = await options.llmClient.suggestFileOrganization({
    fileName: originalBaseName,
    extension: originalExt,
    safeDocumentSnippet,
    categories: options.categories,
    currentYearMonth,
  });

  // Validasi ulang ketat dengan Zod (memastikan tidak ada DELETE atau field liar)
  const suggestion = AiFileSuggestionSchema.parse(rawSuggestion);

  if (suggestion.action === "SKIP") {
    return {
      action: "SKIP",
      source: validatedSource,
      destination: validatedSource,
      reason: `AI menyarankan SKIP: ${suggestion.reason}`,
      origin: "AI_CATEGORIZER",
    };
  }

  const chosenCategory =
    suggestion.category && options.categories.includes(suggestion.category)
      ? suggestion.category
      : (options.categories[options.categories.length - 1] ?? "Dokumen_Umum");

  const finalFileName = suggestion.suggestedFileName
    ? ensureExtension(suggestion.suggestedFileName, originalExt)
    : sanitizeFileName(originalBaseName);

  const destination =
    suggestion.action === "RENAME"
      ? path.join(path.dirname(validatedSource), finalFileName)
      : path.join(sandboxRoot, chosenCategory, finalFileName);

  // Pastikan path hasil saran AI lolos PathGuard sebelum masuk Execution Plan
  const validatedDestination = await options.pathGuard.validatePathStrict(destination);

  return {
    action: suggestion.action,
    source: validatedSource,
    destination: validatedDestination,
    reason: `AI (${chosenCategory}): ${suggestion.reason}`,
    origin: "AI_CATEGORIZER",
  };
}
