import fs from "node:fs/promises";
import path from "node:path";

export interface ModelPreset {
  id: string;
  label: string;
  sizeHint: string;
  fileName: string;
  downloadUrl: string;
}

export interface AvailableModelInfo extends ModelPreset {
  downloaded: boolean;
  isCustomLocal: boolean;
}

export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    id: "qwen3-4b",
    label: "Qwen3 4B Hybrid (Auto-Think • Rekomendasi)",
    sizeHint: "~2.5 GB",
    fileName: "Qwen3-4B-Q4_K_M.gguf",
    downloadUrl:
      "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
  },
  {
    id: "qwen3-1.7b",
    label: "Qwen3 1.7B Hybrid (Cepat • Live Voice)",
    sizeHint: "~1.1 GB",
    fileName: "Qwen3-1.7B-Q8_0.gguf",
    downloadUrl:
      "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf",
  },
  {
    id: "gemma-3-4b",
    label: "Gemma 3 4B IT (Bahasa Indonesia Natural)",
    sizeHint: "~2.5 GB",
    fileName: "gemma-3-4b-it-Q4_K_M.gguf",
    downloadUrl:
      "https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf",
  },
  {
    id: "qwen2.5-3b",
    label: "Qwen2.5 3B Instruct (Cerdas)",
    sizeHint: "~1.9 GB",
    fileName: "qwen2.5-3b-instruct-q4_k_m.gguf",
    downloadUrl:
      "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
  },
  {
    id: "qwen2.5-1.5b",
    label: "Qwen2.5 1.5B Instruct (Seimbang)",
    sizeHint: "~1.0 GB",
    fileName: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    downloadUrl:
      "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  },
  {
    id: "qwen2.5-0.5b",
    label: "Qwen2.5 0.5B Instruct (Super Ringan)",
    sizeHint: "~400 MB",
    fileName: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    downloadUrl:
      "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
  },
  {
    id: "llama-3.2-1b",
    label: "Llama 3.2 1B Instruct (Cepat)",
    sizeHint: "~800 MB",
    fileName: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    downloadUrl:
      "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "gemma-2-2b",
    label: "Gemma 2 2B Instruct (Natural)",
    sizeHint: "~1.6 GB",
    fileName: "gemma-2-2b-it-Q4_K_M.gguf",
    downloadUrl:
      "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf",
  },
];

export async function listAvailableModels(modelsDir: string): Promise<AvailableModelInfo[]> {
  const localFiles = new Set<string>();
  try {
    const entries = await fs.readdir(modelsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf")) {
        const stat = await fs.stat(path.join(modelsDir, entry.name));
        if (stat.size > 1_000_000) {
          localFiles.add(entry.name);
        }
      }
    }
  } catch {
    // Folder models belum ada -> semua preset berstatus belum terunduh
  }

  const presetFileNames = new Set(MODEL_PRESETS.map((p) => p.fileName.toLowerCase()));
  const result: AvailableModelInfo[] = MODEL_PRESETS.map((preset) => ({
    ...preset,
    downloaded: localFiles.has(preset.fileName),
    isCustomLocal: false,
  }));

  // Sertakan file .gguf lokal lain yang ditaruh manual oleh user di ./models/
  for (const fileName of localFiles) {
    if (!presetFileNames.has(fileName.toLowerCase())) {
      result.push({
        id: `local:${fileName}`,
        label: `${fileName} (Lokal)`,
        sizeHint: "Lokal",
        fileName,
        downloadUrl: MODEL_PRESETS[0]!.downloadUrl,
        downloaded: true,
        isCustomLocal: true,
      });
    }
  }

  return result;
}
