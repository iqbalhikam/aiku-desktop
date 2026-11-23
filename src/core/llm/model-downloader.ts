import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import type { LlmConfig } from "../../config/schema.js";

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export function getModelFilePath(llmConfig: LlmConfig): string {
  return path.resolve(llmConfig.modelsDir, llmConfig.modelFileName);
}

export async function isModelDownloaded(llmConfig: LlmConfig): Promise<boolean> {
  const modelPath = getModelFilePath(llmConfig);
  try {
    const stat = await fsp.stat(modelPath);
    // File GGUF Qwen2.5-0.5B Q4_K_M seharusnya ratusan MB; pastikan tidak kosong/korup
    return stat.isFile() && stat.size > 1_000_000;
  } catch {
    return false;
  }
}

/**
 * Auto-download model Qwen2.5-0.5B-Instruct GGUF (Q4_K_M) dari Hugging Face Hub
 * jika belum ada di ./models/. Menggunakan file sementara (.part) agar atomik.
 */
export async function ensureModelDownloaded(
  llmConfig: LlmConfig,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  const modelPath = getModelFilePath(llmConfig);

  if (await isModelDownloaded(llmConfig)) {
    return modelPath;
  }

  await fsp.mkdir(llmConfig.modelsDir, { recursive: true });
  const tempPath = `${modelPath}.part`;

  const response = await fetch(llmConfig.modelDownloadUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "aiKu-local-assistant/1.0",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Gagal mengunduh model dari Hugging Face Hub (${response.status} ${response.statusText}): ${llmConfig.modelDownloadUrl}`
    );
  }

  const contentLengthHeader = response.headers.get("content-length");
  const totalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : null;
  let downloadedBytes = 0;

  const nodeReadable = Readable.fromWeb(response.body as unknown as NodeWebReadableStream);
  nodeReadable.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    if (onProgress) {
      const percent =
        totalBytes && totalBytes > 0
          ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 1000) / 10)
          : null;
      onProgress({ downloadedBytes, totalBytes, percent });
    }
  });

  const writeStream = fs.createWriteStream(tempPath);

  try {
    await pipeline(nodeReadable, writeStream);
    await fsp.rename(tempPath, modelPath);
  } catch (error: unknown) {
    try {
      await fsp.rm(tempPath, { force: true });
    } catch {
      // Abaikan kegagalan cleanup file .part
    }
    throw error;
  }

  return modelPath;
}
