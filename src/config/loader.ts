import fs from "node:fs/promises";
import path from "node:path";
import { type AppConfig, resolveAppConfig } from "./schema.js";

export const DEFAULT_CONFIG_FILENAME = "aiku.config.json";

export function createDefaultConfigObject(): Record<string, unknown> {
  return {
    allowedDirectories: ["./sandbox"],
    quarantineDirName: "_AI_Karantina",
    categories: ["Keuangan", "Pekerjaan", "Kuliah", "Pribadi", "Dokumen_Umum"],
    oldInstallerDays: 30,
    historyLogPath: "./logs/history.json",
    llm: {
      modelsDir: "./models",
      modelFileName: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
      modelDownloadUrl:
        "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
      threads: 4,
      contextSize: 2048,
    },
  };
}

export async function loadOrCreateConfig(
  configPath: string = path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME)
): Promise<{ config: AppConfig; configPath: string; created: boolean }> {
  const resolvedPath = path.resolve(configPath);
  const baseDir = path.dirname(resolvedPath);

  try {
    const content = await fs.readFile(resolvedPath, "utf8");
    const parsedJson: unknown = JSON.parse(content);
    const config = resolveAppConfig(parsedJson, baseDir);
    return { config, configPath: resolvedPath, created: false };
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      const defaults = createDefaultConfigObject();
      await fs.writeFile(resolvedPath, JSON.stringify(defaults, null, 2) + "\n", "utf8");
      const config = resolveAppConfig(defaults, baseDir);
      // Pastikan folder sandbox default tersedia agar siap dipakai
      for (const dir of config.allowedDirectories) {
        await fs.mkdir(dir, { recursive: true });
      }
      return { config, configPath: resolvedPath, created: true };
    }
    throw error;
  }
}
