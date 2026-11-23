import path from "node:path";
import { stdin, stdout } from "node:process";
import readline from "node:readline";
import { z } from "zod";
import { loadOrCreateConfig } from "../config/loader.js";
import type { AppConfig } from "../config/schema.js";
import { LocalLlamaEngine } from "../core/llm/llama-engine.js";
import { ensureModelDownloaded, isModelDownloaded } from "../core/llm/model-downloader.js";
import { SafeExecutor } from "../core/security/safe-executor.js";
import type { ExecutionPlan } from "../core/security/schemas.js";
import { scanHygieneIssues } from "../modules/file-manager/hygiene-detector.js";
import { runLocalNaturalSearch } from "../modules/file-manager/local-search.js";
import { buildOrganizePlan } from "../modules/file-manager/orchestrator.js";
import {
  executeSafePresetCommand,
  formatBrokenPdfClipboard,
  matchSafePresetCommand,
  runQuickTldr,
  SafePresetCommandSchema,
} from "../modules/micro-assistant/index.js";

const RpcRequestSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    method: z.enum([
      "getStatus",
      "chat",
      "planOrganize",
      "planHygiene",
      "executePlan",
      "search",
      "getHistory",
      "rollback",
      "setupModel",
      "quickTldr",
      "formatClipboard",
      "safeCommand",
    ]),
    params: z.record(z.unknown()).default({}),
  })
  .strict();

const ChatParamsSchema = z
  .object({
    message: z.string().min(1).max(2000),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(1500),
          })
          .strict()
      )
      .max(12)
      .default([]),
    enableAiForFiles: z.boolean().default(false),
  })
  .strict();

const PlanOrganizeParamsSchema = z
  .object({
    enableAi: z.boolean().default(false),
  })
  .strict();

const ExecutePlanParamsSchema = z
  .object({
    planId: z.string().min(1),
    confirmToken: z.literal("CONFIRM_EXECUTE"),
  })
  .strict();

const SearchParamsSchema = z
  .object({
    query: z.string().min(1).max(300),
    useAi: z.boolean().default(false),
  })
  .strict();

const RollbackParamsSchema = z
  .object({
    transactionId: z.string().min(1),
  })
  .strict();

const QuickTldrParamsSchema = z
  .object({
    text: z.string().min(1).max(25_000),
  })
  .strict();

const FormatClipboardParamsSchema = z
  .object({
    text: z.string().min(1).max(25_000),
  })
  .strict();

const SafeCommandParamsSchema = z
  .object({
    command: SafePresetCommandSchema,
  })
  .strict();

interface RpcSuccessResponse {
  id: string | number;
  ok: true;
  result: unknown;
}

interface RpcErrorResponse {
  id: string | number | null;
  ok: false;
  error: string;
}

type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

export class AiKuRpcWorker {
  private readonly config: AppConfig;
  private readonly safeExecutor: SafeExecutor;
  private readonly llmEngine: LocalLlamaEngine;
  private readonly pendingPlans = new Map<string, ExecutionPlan>();

  constructor(config: AppConfig) {
    this.config = config;
    this.safeExecutor = new SafeExecutor({
      allowedDirectories: config.allowedDirectories,
      historyLogPath: config.historyLogPath,
      quarantineDirName: config.quarantineDirName,
    });
    this.llmEngine = new LocalLlamaEngine({
      llmConfig: config.llm,
    });
  }

  public async handleRequest(rawLine: string): Promise<RpcResponse> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawLine);
    } catch {
      return { id: null, ok: false, error: "Invalid JSON payload." };
    }

    const parsedReq = RpcRequestSchema.safeParse(parsedJson);
    if (!parsedReq.success) {
      const maybeId =
        typeof parsedJson === "object" &&
        parsedJson !== null &&
        "id" in parsedJson &&
        (typeof (parsedJson as { id: unknown }).id === "string" ||
          typeof (parsedJson as { id: unknown }).id === "number")
          ? (parsedJson as { id: string | number }).id
          : null;
      return {
        id: maybeId,
        ok: false,
        error: `Invalid RPC request: ${parsedReq.error.issues.map((i) => i.message).join("; ")}`,
      };
    }

    const { id, method, params } = parsedReq.data;

    try {
      const result = await this.dispatch(method, params);
      return { id, ok: true, result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { id, ok: false, error: message };
    }
  }

  private async dispatch(
    method: z.infer<typeof RpcRequestSchema>["method"],
    params: Record<string, unknown>
  ): Promise<unknown> {
    const primarySandbox = path.resolve(this.config.allowedDirectories[0] ?? "./sandbox");

    switch (method) {
      case "getStatus": {
        const modelReady = await isModelDownloaded(this.config.llm);
        return {
          allowedDirectories: this.config.allowedDirectories,
          primarySandbox,
          quarantineDirName: this.config.quarantineDirName,
          categories: this.config.categories,
          oldInstallerDays: this.config.oldInstallerDays,
          modelReady,
          modelFileName: this.config.llm.modelFileName,
          threads: this.config.llm.threads,
        };
      }

      case "chat": {
        const parsed = ChatParamsSchema.parse(params);
        return this.handleChatIntent(parsed, primarySandbox);
      }

      case "planOrganize": {
        const parsed = PlanOrganizeParamsSchema.parse(params);
        const plan = await buildOrganizePlan({
          targetDir: primarySandbox,
          config: this.config,
          safeExecutor: this.safeExecutor,
          llmClient: this.llmEngine,
          enableAi: parsed.enableAi,
        });
        this.storePendingPlan(plan);
        return { plan, sandboxRoot: primarySandbox };
      }

      case "planHygiene": {
        const scan = await scanHygieneIssues({
          sandboxDir: primarySandbox,
          quarantineDirName: this.config.quarantineDirName,
          oldInstallerDays: this.config.oldInstallerDays,
          safeExecutor: this.safeExecutor,
        });
        const plan = await this.safeExecutor.createPlan(scan.proposals);
        this.storePendingPlan(plan);
        return {
          plan,
          sandboxRoot: primarySandbox,
          duplicateGroupsCount: scan.duplicateGroupsCount,
          oldInstallersCount: scan.oldInstallersCount,
        };
      }

      case "executePlan": {
        const parsed = ExecutePlanParamsSchema.parse(params);
        const plan = this.pendingPlans.get(parsed.planId);
        if (!plan) {
          throw new Error(
            `Execution Plan "${parsed.planId}" tidak ditemukan atau sudah dieksekusi. Jalankan Preview Dry-Run terlebih dahulu.`
          );
        }
        const executionResult = await this.safeExecutor.executePlan(plan, { dryRun: false });
        this.pendingPlans.delete(parsed.planId);
        return executionResult;
      }

      case "search": {
        const parsed = SearchParamsSchema.parse(params);
        const searchResult = await runLocalNaturalSearch({
          query: parsed.query,
          allowedDirectories: this.config.allowedDirectories,
          pathGuard: this.safeExecutor.getPathGuard(),
          llmClient: this.llmEngine,
          useAi: parsed.useAi,
        });
        return {
          filter: searchResult.filter,
          usedAi: searchResult.usedAi,
          matches: searchResult.matches.map((m) => ({
            fullPath: m.fullPath,
            relativePath: m.relativePath,
            fileName: m.fileName,
            extension: m.extension,
            sizeBytes: m.sizeBytes,
            modifiedAt: m.modifiedAt.toISOString(),
          })),
        };
      }

      case "getHistory": {
        const records = await this.safeExecutor.getTransactionLog().readAll();
        return { records: [...records].reverse() };
      }

      case "rollback": {
        const parsed = RollbackParamsSchema.parse(params);
        return this.safeExecutor.rollback(parsed.transactionId);
      }

      case "setupModel": {
        const modelPath = await ensureModelDownloaded(this.config.llm);
        return { modelReady: true, modelPath };
      }

      case "quickTldr": {
        const parsed = QuickTldrParamsSchema.parse(params);
        return runQuickTldr(parsed.text, this.llmEngine);
      }

      case "formatClipboard": {
        const parsed = FormatClipboardParamsSchema.parse(params);
        return { formatted: formatBrokenPdfClipboard(parsed.text) };
      }

      case "safeCommand": {
        const parsed = SafeCommandParamsSchema.parse(params);
        return executeSafePresetCommand({
          command: parsed.command,
          sandboxRoot: primarySandbox,
          quarantineDirName: this.config.quarantineDirName,
          pathGuard: this.safeExecutor.getPathGuard(),
        });
      }
    }
  }

  private async handleChatIntent(
    input: z.infer<typeof ChatParamsSchema>,
    primarySandbox: string
  ): Promise<unknown> {
    const lower = input.message.toLowerCase().trim();

    // 0. Intent: Safe Command Launcher (preset aman ter-hardcode, bukan shell bebas)
    const matchedPreset = matchSafePresetCommand(input.message);
    if (matchedPreset !== null) {
      const cmdResult = await executeSafePresetCommand({
        command: matchedPreset,
        sandboxRoot: primarySandbox,
        quarantineDirName: this.config.quarantineDirName,
        pathGuard: this.safeExecutor.getPathGuard(),
      });
      return {
        reply: cmdResult.message,
        attachment: null,
      };
    }

    // 1. Intent: Rapikan / Organize file (wajib Dry-Run preview dulu)
    if (/\b(rapikan|rapihin|organize|organisir|kelompokkan|beresin|bereskan)\b/.test(lower)) {
      const wantAi = input.enableAiForFiles || /\b(pakai ai|dengan ai|smart|qwen)\b/.test(lower);
      const plan = await buildOrganizePlan({
        targetDir: primarySandbox,
        config: this.config,
        safeExecutor: this.safeExecutor,
        llmClient: this.llmEngine,
        enableAi: wantAi,
      });
      this.storePendingPlan(plan);
      const reply =
        plan.operations.length > 0
          ? `Saya sudah menyiapkan rencana perapian (**Dry-Run Preview**) untuk **${plan.operations.length} file** di sandbox${wantAi ? " (dengan AI Qwen 0.5B)" : " (Fast Path)"}. Silakan tinjau dulu sebelum klik **Konfirmasi & Eksekusi**.`
          : "Semua file di root sandbox sudah rapi atau tidak ada yang perlu dipindahkan saat ini.";
      return {
        reply,
        attachment: { type: "plan", plan, sandboxRoot: primarySandbox },
      };
    }

    // 2. Intent: Cek duplikat / installer lama -> Karantina (Soft Delete)
    if (/\b(duplikat|duplicate|kembar|karantina|installer\s+lama|bersihkan|hygiene)\b/.test(lower)) {
      const scan = await scanHygieneIssues({
        sandboxDir: primarySandbox,
        quarantineDirName: this.config.quarantineDirName,
        oldInstallerDays: this.config.oldInstallerDays,
        safeExecutor: this.safeExecutor,
      });
      const plan = await this.safeExecutor.createPlan(scan.proposals);
      this.storePendingPlan(plan);
      const reply =
        plan.operations.length > 0
          ? `Ditemukan **${scan.duplicateGroupsCount} grup duplikat SHA-256** dan **${scan.oldInstallersCount} installer lama**. Demi keamanan (tanpa hapus permanen), file diusulkan pindah ke folder \`${this.config.quarantineDirName}\`.`
          : "Sandbox bersih! Tidak ditemukan file duplikat SHA-256 maupun installer lama.";
      return {
        reply,
        attachment: { type: "plan", plan, sandboxRoot: primarySandbox },
      };
    }

    // 3. Intent: Lihat riwayat transaksi / rollback
    if (/\b(riwayat|history|rollback|undo|kembalikan\s+file)\b/.test(lower)) {
      const records = [...(await this.safeExecutor.getTransactionLog().readAll())].reverse().slice(0, 10);
      const reply =
        records.length > 0
          ? `Berikut ${records.length} transaksi terakhir dari audit log SHA-256. Anda bisa klik **Rollback** pada transaksi aktif.`
          : "Belum ada riwayat pemindahan file di `./logs/history.json`.";
      return {
        reply,
        attachment: { type: "history", records },
      };
    }

    // 4. Intent: Daftar isi file / cari file di sandbox
    if (
      /\b(ada\s+(file\s+)?apa\s*(aja|saja)?|isinya\s+apa|apa\s+(aja|saja)\s+isinya|isi\s+sandbox|isi\s+folder|daftar\s+file|list\s+file|lihat\s+file|semua\s+file)\b/.test(
        lower
      ) ||
      /\b(cari|carikan|temukan)\b/.test(lower)
    ) {
      const searchResult = await runLocalNaturalSearch({
        query: input.message,
        allowedDirectories: this.config.allowedDirectories,
        pathGuard: this.safeExecutor.getPathGuard(),
        llmClient: this.llmEngine,
        useAi: false,
      });
      const files = searchResult.matches.map((m) => ({
        relativePath: m.relativePath,
        extension: m.extension,
        sizeBytes: m.sizeBytes,
        modifiedAt: m.modifiedAt.toISOString(),
      }));
      const reply =
        files.length > 0
          ? `Di dalam folder sandbox ditemukan **${files.length} file** yang cocok:`
          : "Tidak ada file yang cocok dengan kueri tersebut di folder sandbox.";
      return {
        reply,
        attachment: { type: "files", files },
      };
    }

    // 5. Obrolan bebas / tanya jawab / ringkas teks / tugas mikro -> Qwen2.5-0.5B On-Demand
    const allFiles = await runLocalNaturalSearch({
      query: "semua file",
      allowedDirectories: this.config.allowedDirectories,
      pathGuard: this.safeExecutor.getPathGuard(),
      useAi: false,
    });
    const sampleNames = allFiles.matches
      .slice(0, 12)
      .map((f) => f.relativePath)
      .join(", ");
    const sandboxContextSummary = `Folder sandbox berisi ${allFiles.matches.length} file (${sampleNames || "kosong"}).`;

    const reply = await this.llmEngine.chat({
      message: input.message,
      history: input.history,
      sandboxContextSummary,
    });

    return {
      reply,
      attachment: null,
    };
  }

  private storePendingPlan(plan: ExecutionPlan): void {
    // Batasi maksimal 20 plan tersimpan di memori agar tetap ringan
    if (this.pendingPlans.size >= 20) {
      const oldestKey = this.pendingPlans.keys().next().value;
      if (oldestKey) {
        this.pendingPlans.delete(oldestKey);
      }
    }
    this.pendingPlans.set(plan.planId, plan);
  }
}

async function runStdioServer(): Promise<void> {
  // Redirect console.log/info/warn ke stderr agar stdout 100% steril hanya untuk NDJSON JSON-RPC
  const rawStdoutWrite = stdout.write.bind(stdout);
  const redirectToStderr = (...args: unknown[]): void => {
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  };
  console.log = redirectToStderr;
  console.info = redirectToStderr;
  console.warn = redirectToStderr;

  const { config } = await loadOrCreateConfig();
  const worker = new AiKuRpcWorker(config);

  const rl = readline.createInterface({
    input: stdin,
    crlfDelay: Infinity,
    terminal: false,
  });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }
    void worker.handleRequest(trimmed).then((response) => {
      rawStdoutWrite(`${JSON.stringify(response)}\n`);
    });
  });
}

// Hanya jalankan loop stdio jika dieksekusi langsung sebagai entrypoint
const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).endsWith(path.join("rpc", "worker.js"));

if (isDirectRun) {
  runStdioServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[RPC_FATAL] ${message}\n`);
    process.exitCode = 1;
  });
}
