import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import AdmZip from "adm-zip";

export interface VoiceEnginePaths {
  voiceRootDir: string;
  piperDir: string;
  piperExePath: string;
  piperModelPath: string;
  piperConfigPath: string;
  openVoiceDir: string;
  toneExtractPath: string;
  toneColorPath: string;
  profilesDir: string;
}

export interface VoiceSetupProgress {
  stage: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  status: "downloading" | "extracting" | "done" | "error";
  error?: string;
}

const PIPER_WIN_ZIP_URL =
  "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";

const PIPER_ID_ONNX_URL =
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx";

const PIPER_ID_JSON_URL =
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx.json";

const TONE_EXTRACT_URLS = [
  "https://huggingface.co/Hinotsuba/OpenVoice-ONNX-v2/resolve/main/tone_extract.onnx",
  "https://huggingface.co/Miyauel/openvoice-v2-onnx/resolve/main/tone_encoder.onnx",
];

const TONE_COLOR_URLS = [
  "https://huggingface.co/Hinotsuba/OpenVoice-ONNX-v2/resolve/main/tone_color.onnx",
  "https://huggingface.co/Miyauel/openvoice-v2-onnx/resolve/main/tone_converter.onnx",
];

// Perkiraan ukuran total (~198 MB) agar bar persentase gabungan mulus sejak awal
const ESTIMATED_TOTAL_BYTES = 198 * 1024 * 1024;

export function getVoiceEnginePaths(modelsDir: string): VoiceEnginePaths {
  const voiceRootDir = path.resolve(modelsDir, "voice");
  const piperDir = path.join(voiceRootDir, "piper");
  const openVoiceDir = path.join(voiceRootDir, "openvoice");
  const profilesDir = path.join(voiceRootDir, "profiles");

  return {
    voiceRootDir,
    piperDir,
    piperExePath: path.join(piperDir, "piper.exe"),
    piperModelPath: path.join(piperDir, "id_ID-news_tts-medium.onnx"),
    piperConfigPath: path.join(piperDir, "id_ID-news_tts-medium.onnx.json"),
    openVoiceDir,
    toneExtractPath: path.join(openVoiceDir, "tone_extract.onnx"),
    toneColorPath: path.join(openVoiceDir, "tone_color.onnx"),
    profilesDir,
  };
}

async function fileExistsWithMinSize(filePath: string, minBytes: number): Promise<boolean> {
  try {
    const st = await fsp.stat(filePath);
    return st.isFile() && st.size >= minBytes;
  } catch {
    return false;
  }
}

export async function checkVoiceEngineInstalled(modelsDir: string): Promise<{
  piperReady: boolean;
  openVoiceReady: boolean;
  fullyReady: boolean;
}> {
  const p = getVoiceEnginePaths(modelsDir);
  const [hasPiperExe, hasPiperModel, hasPiperJson, hasExtract, hasColor] = await Promise.all([
    fileExistsWithMinSize(p.piperExePath, 50_000),
    fileExistsWithMinSize(p.piperModelPath, 5_000_000),
    fileExistsWithMinSize(p.piperConfigPath, 200),
    fileExistsWithMinSize(p.toneExtractPath, 500_000),
    fileExistsWithMinSize(p.toneColorPath, 10_000_000),
  ]);

  const piperReady = hasPiperExe && hasPiperModel && hasPiperJson;
  const openVoiceReady = hasExtract && hasColor;
  return {
    piperReady,
    openVoiceReady,
    fullyReady: piperReady && openVoiceReady,
  };
}

async function downloadFileWithMirrors(
  urls: readonly string[],
  destPath: string,
  minExpectedBytes: number,
  onDeltaBytes: (delta: number) => void
): Promise<void> {
  if (await fileExistsWithMinSize(destPath, minExpectedBytes)) {
    const st = await fsp.stat(destPath);
    onDeltaBytes(st.size);
    return;
  }

  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const tempPath = `${destPath}.part`;
  let lastError: unknown = null;

  for (const url of urls) {
    let addedInAttempt = 0;
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "aiKu-voice-clone-offline/1.0",
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText} (${url})`);
      }

      const nodeReadable = Readable.fromWeb(response.body as unknown as NodeWebReadableStream);
      nodeReadable.on("data", (chunk: Buffer) => {
        addedInAttempt += chunk.length;
        onDeltaBytes(chunk.length);
      });

      const writeStream = fs.createWriteStream(tempPath);
      await pipeline(nodeReadable, writeStream);

      const st = await fsp.stat(tempPath);
      if (st.size < minExpectedBytes) {
        throw new Error(`Ukuran unduhan tidak lengkap (${st.size} bytes < ${minExpectedBytes} bytes).`);
      }

      await fsp.rename(tempPath, destPath);
      return;
    } catch (err: unknown) {
      lastError = err;
      if (addedInAttempt > 0) {
        onDeltaBytes(-addedInAttempt);
      }
      try {
        await fsp.rm(tempPath, { force: true });
      } catch {
        // Abaikan error pembersihan .part
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Gagal mengunduh komponen suara ke ${path.basename(destPath)}`);
}

/**
 * Mengunduh & menyiapkan seluruh paket Voice Clone Offline (~198 MB):
 * 1. Piper Neural TTS Engine (Windows x64) + Suara Bahasa Indonesia (id_ID-news_tts-medium)
 * 2. OpenVoice V2 Tone Extractor ONNX + Tone Color Converter ONNX
 */
export async function ensureVoiceEngineDownloaded(
  modelsDir: string,
  onProgress?: (progress: VoiceSetupProgress) => void
): Promise<VoiceEnginePaths> {
  const paths = getVoiceEnginePaths(modelsDir);
  await Promise.all([
    fsp.mkdir(paths.piperDir, { recursive: true }),
    fsp.mkdir(paths.openVoiceDir, { recursive: true }),
    fsp.mkdir(paths.profilesDir, { recursive: true }),
  ]);

  let cumulativeBytes = 0;
  let currentStage = "Menyiapkan direktori mesin suara...";

  const emit = (status: VoiceSetupProgress["status"] = "downloading"): void => {
    if (!onProgress) return;
    const pct = Math.min(99.5, Math.max(0, Math.round((cumulativeBytes / ESTIMATED_TOTAL_BYTES) * 1000) / 10));
    onProgress({
      stage: currentStage,
      downloadedBytes: Math.max(0, cumulativeBytes),
      totalBytes: ESTIMATED_TOTAL_BYTES,
      percent: status === "done" ? 100 : pct,
      status,
    });
  };

  const addDelta = (delta: number): void => {
    cumulativeBytes += delta;
    emit("downloading");
  };

  // 1. Piper Binary (piper_windows_amd64.zip -> extract ke models/voice/piper/)
  if (!(await fileExistsWithMinSize(paths.piperExePath, 50_000))) {
    currentStage = "Mengunduh Piper Neural TTS (Windows x64)...";
    emit("downloading");
    const zipTempPath = path.join(paths.voiceRootDir, "piper_windows_amd64.zip");
    await downloadFileWithMirrors([PIPER_WIN_ZIP_URL], zipTempPath, 5_000_000, addDelta);

    currentStage = "Mengekstrak mesin Piper TTS...";
    emit("extracting");
    const zip = new AdmZip(zipTempPath);
    // piper_windows_amd64.zip memiliki root folder "piper/" di dalamnya -> ekstrak ke voiceRootDir
    zip.extractAllTo(paths.voiceRootDir, true);

    // Jika struktur zip berbeda (langsung di root), salin ke paths.piperDir
    if (!(await fileExistsWithMinSize(paths.piperExePath, 50_000))) {
      const altExe = path.join(paths.voiceRootDir, "piper.exe");
      if (await fileExistsWithMinSize(altExe, 50_000)) {
        zip.extractAllTo(paths.piperDir, true);
      }
    }

    try {
      await fsp.rm(zipTempPath, { force: true });
    } catch {
      // Abaikan jika gagal hapus zip sementara
    }
  } else {
    cumulativeBytes += 22 * 1024 * 1024;
  }

  // 2. Piper Indonesian Voice Model (.onnx + .onnx.json)
  currentStage = "Mengunduh model suara Bahasa Indonesia (Piper)...";
  emit("downloading");
  await downloadFileWithMirrors([PIPER_ID_JSON_URL], paths.piperConfigPath, 200, addDelta);
  await downloadFileWithMirrors([PIPER_ID_ONNX_URL], paths.piperModelPath, 15_000_000, addDelta);

  // 3. OpenVoice V2 Speaker Tone Extractor ONNX
  currentStage = "Mengunduh OpenVoice V2 Tone Extractor (ONNX)...";
  emit("downloading");
  await downloadFileWithMirrors(TONE_EXTRACT_URLS, paths.toneExtractPath, 500_000, addDelta);

  // 4. OpenVoice V2 Tone Color Converter ONNX
  currentStage = "Mengunduh OpenVoice V2 Tone Converter (ONNX)...";
  emit("downloading");
  await downloadFileWithMirrors(TONE_COLOR_URLS, paths.toneColorPath, 20_000_000, addDelta);

  currentStage = "Mesin Voice Clone Offline siap digunakan";
  emit("done");
  return paths;
}
