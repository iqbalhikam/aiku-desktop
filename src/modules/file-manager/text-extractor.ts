import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import type { PathGuard } from "../../core/security/path-guard.js";
import {
  buildSafeDocumentSnippet,
  MAX_DOCUMENT_SNIPPET_CHARS,
} from "../../core/security/prompt-guard.js";

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set<string>([".txt", ".md", ".pdf", ".docx"]);

const MAX_PLAIN_TEXT_READ_BYTES = 4096;

export function isSupportedDocument(filePath: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function readPlainTextHead(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_PLAIN_TEXT_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_PLAIN_TEXT_READ_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readDocxTextHead(filePath: string): Promise<string> {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) {
    return "";
  }
  const xml = entry.getData().toString("utf8");
  const stripped = xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  return stripped.slice(0, MAX_DOCUMENT_SNIPPET_CHARS * 2);
}

async function readPdfTextHead(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  // Import dinamis agar pdf-parse tidak membebani startup saat tidak memproses PDF
  const pdfParseModule = (await import("pdf-parse")) as unknown as {
    default?: (dataBuffer: Buffer, options?: { max?: number }) => Promise<{ text: string }>;
  };
  const pdfParse = pdfParseModule.default;
  if (typeof pdfParse !== "function") {
    return "";
  }
  const parsed = await pdfParse(buffer, { max: 1 });
  return parsed.text.slice(0, MAX_DOCUMENT_SNIPPET_CHARS * 2);
}

/**
 * Mengekstrak cuplikan teks dokumen secara aman (wajib lolos PathGuard,
 * dipotong maksimal 400 karakter, dan dibungkus <DOCUMENT_DATA>...</DOCUMENT_DATA>).
 */
export async function extractSafeDocumentSnippet(
  filePath: string,
  pathGuard: PathGuard
): Promise<string> {
  const validatedPath = await pathGuard.validatePathStrict(filePath);
  const ext = path.extname(validatedPath).toLowerCase();

  let rawText = "";
  try {
    if (ext === ".txt" || ext === ".md") {
      rawText = await readPlainTextHead(validatedPath);
    } else if (ext === ".docx") {
      rawText = await readDocxTextHead(validatedPath);
    } else if (ext === ".pdf") {
      rawText = await readPdfTextHead(validatedPath);
    }
  } catch {
    // Jika file terenkripsi/korup/scan-only, tetap kembalikan snippet kosong yang aman
    rawText = "";
  }

  return buildSafeDocumentSnippet(rawText);
}
