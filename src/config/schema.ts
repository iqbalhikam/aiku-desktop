import path from "node:path";
import { z } from "zod";

export const LlmConfigSchema = z
  .object({
    modelsDir: z.string().min(1).default("./models"),
    modelFileName: z.string().min(1).default("qwen2.5-0.5b-instruct-q4_k_m.gguf"),
    modelDownloadUrl: z
      .string()
      .url()
      .default(
        "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
      ),
    threads: z.number().int().min(1).max(4).default(4),
    contextSize: z.number().int().min(512).max(4096).default(2048),
  })
  .strict();

export const AppConfigSchema = z
  .object({
    allowedDirectories: z
      .array(z.string().min(1))
      .min(1, "Minimal satu direktori sandbox harus dikonfigurasi di allowedDirectories."),
    quarantineDirName: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, "Nama folder karantina hanya boleh berisi huruf, angka, _ atau -.")
      .default("_AI_Karantina"),
    categories: z
      .array(
        z
          .string()
          .min(1)
          .max(48)
          .regex(/^[a-zA-Z0-9_-]+$/, "Nama kategori hanya boleh berisi huruf, angka, _ atau -.")
      )
      .min(1)
      .default(["Keuangan", "Pekerjaan", "Kuliah", "Pribadi", "Dokumen_Umum"]),
    oldInstallerDays: z.number().int().min(1).max(3650).default(30),
    historyLogPath: z.string().min(1).default("./logs/history.json"),
    llm: LlmConfigSchema.default({}),
  })
  .strict();

export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

export function resolveAppConfig(raw: unknown, baseDir: string = process.cwd()): AppConfig {
  const parsed = AppConfigSchema.parse(raw);
  return {
    ...parsed,
    allowedDirectories: parsed.allowedDirectories.map((dir) => path.resolve(baseDir, dir)),
    historyLogPath: path.resolve(baseDir, parsed.historyLogPath),
    llm: {
      ...parsed.llm,
      modelsDir: path.resolve(baseDir, parsed.llm.modelsDir),
    },
  };
}
