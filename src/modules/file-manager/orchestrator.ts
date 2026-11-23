import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../config/schema.js";
import type { LlmInferenceClient } from "../../core/llm/llama-engine.js";
import type { SafeExecutor } from "../../core/security/safe-executor.js";
import type { ExecutionPlan, FileOperationProposal } from "../../core/security/schemas.js";
import { buildFastPathProposal } from "./fast-path.js";
import { buildSmartDocumentProposal, needsSmartCategorization } from "./smart-categorizer.js";

export interface OrganizeOptions {
  targetDir: string;
  config: AppConfig;
  safeExecutor: SafeExecutor;
  llmClient?: LlmInferenceClient;
  enableAi: boolean;
  onStatus?: (message: string) => void;
}

/**
 * Orkestrator Fase 1 (Hybrid File Manager):
 * 1. Memindai file tingkat atas di direktori sandbox.
 * 2. Menjalankan Rule-Based Fast Path (tanpa memuat AI) untuk media/arsip/installer.
 * 3. Jika enableAi=true, menjalankan AI Smart Categorizer & Renamer khusus dokumen (.pdf, .docx, .txt, .md).
 * 4. Mengembalikan ExecutionPlan yang sudah divalidasi SafeExecutor (siap Dry-Run preview).
 */
export async function buildOrganizePlan(options: OrganizeOptions): Promise<ExecutionPlan> {
  const pathGuard = options.safeExecutor.getPathGuard();
  const validatedDir = await pathGuard.validatePathStrict(options.targetDir);
  const sandboxRoot = pathGuard.findSandboxRoot(validatedDir);

  const entries = await fs.readdir(validatedDir, { withFileTypes: true });
  const proposals: FileOperationProposal[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const fullPath = path.join(validatedDir, entry.name);
    try {
      await pathGuard.validatePathStrict(fullPath);
    } catch {
      continue;
    }

    // 1. Rule-Based Fast Path (0 MB AI RAM)
    const fastPathProposal = buildFastPathProposal(fullPath, sandboxRoot);
    if (fastPathProposal !== null) {
      proposals.push(fastPathProposal);
      continue;
    }

    // 2. AI Smart Categorizer & Renamer khusus dokumen bernama tidak jelas
    if (needsSmartCategorization(fullPath)) {
      if (options.enableAi && options.llmClient) {
        options.onStatus?.(`Menganalisis dokumen dengan Qwen 0.5B: ${entry.name}...`);
        const aiProposal = await buildSmartDocumentProposal(fullPath, sandboxRoot, {
          llmClient: options.llmClient,
          pathGuard,
          categories: options.config.categories,
        });
        proposals.push(aiProposal);
      } else {
        proposals.push({
          action: "SKIP",
          source: fullPath,
          destination: fullPath,
          reason: "Dokumen memerlukan mode AI (nonaktif via --no-ai).",
          origin: "AI_CATEGORIZER",
        });
      }
    }
  }

  return options.safeExecutor.createPlan(proposals);
}
