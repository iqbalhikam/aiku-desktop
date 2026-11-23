import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin, stdout } from "node:process";
import readline from "node:readline";
import { z } from "zod";
import { DEFAULT_CONFIG_FILENAME, loadOrCreateConfig } from "../config/loader.js";
import { listAvailableModels, MODEL_PRESETS } from "../config/models.js";
import { type AppConfig, resolveAppConfig } from "../config/schema.js";
import { askGeminiCloud, classifyCloudRouting } from "../core/llm/gemini-client.js";
import { LocalLlamaEngine } from "../core/llm/llama-engine.js";
import { ensureModelDownloaded, isModelDownloaded } from "../core/llm/model-downloader.js";
import { PathGuard } from "../core/security/path-guard.js";
import { SafeExecutor } from "../core/security/safe-executor.js";
import type { ExecutionPlan } from "../core/security/schemas.js";
import { scanHygieneIssues } from "../modules/file-manager/hygiene-detector.js";
import { runLocalNaturalSearch } from "../modules/file-manager/local-search.js";
import { buildOrganizePlan } from "../modules/file-manager/orchestrator.js";
import {
  queryWindowsAutoStart,
  resolveStartupLaunchCommand,
  setWindowsAutoStart,
} from "../modules/autostart/win-startup.js";
import { MediaControlActionSchema, queryWindowsMedia } from "../modules/media/media-bridge.js";
import { openWhatsAppReply, pollWindowsNotifications } from "../modules/notifications/win-notifications.js";
import {
  convertUnitExpression,
  evaluateSafeMathExpression,
  executeSafePresetCommand,
  extractTodoChecklist,
  formatBrokenPdfClipboard,
  generateSecurePassword,
  matchSafePresetCommand,
  openSafeBrowserTarget,
  QuickNotesStore,
  runQuickTldr,
  SafePresetCommandSchema,
} from "../modules/micro-assistant/index.js";

const RpcRequestSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    method: z.enum([
      "getStatus",
      "updateConfig",
      "chat",
      "planOrganize",
      "planHygiene",
      "executePlan",
      "search",
      "getHistory",
      "rollback",
      "setupModel",
      "warmupModel",
      "quickTldr",
      "formatClipboard",
      "extractTodos",
      "safeCommand",
      "openBrowserSearch",
      "mediaControl",
      "pollNotifications",
      "replyWhatsApp",
      "draftReply",
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

const OpenBrowserSearchParamsSchema = z
  .object({
    target: z.string().min(1).max(300),
  })
  .strict();

const MediaControlParamsSchema = z
  .object({
    action: MediaControlActionSchema.default("get"),
  })
  .strict();

const ReplyWhatsAppParamsSchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    phone: z.string().regex(/^\d{8,15}$/).optional(),
  })
  .strict();

const DraftReplyParamsSchema = z
  .object({
    sender: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(500),
  })
  .strict();

const UpdateConfigParamsSchema = z
  .object({
    allowedDirectories: z.array(z.string().min(1)).min(1).optional(),
    categories: z.array(z.string().min(1).max(48)).min(1).optional(),
    oldInstallerDays: z.number().int().min(1).max(3650).optional(),
    notifDurationSec: z.number().int().min(1).max(30).optional(),
    autoStartOnBoot: z.boolean().optional(),
    hotkey: z.string().trim().min(1).max(40).optional(),
    threads: z.number().int().min(1).max(4).optional(),
    modelFileName: z.string().min(1).max(180).optional(),
    aiMode: z.enum(["offline", "hybrid"]).optional(),
    geminiApiKey: z.string().max(256).optional(),
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

interface ActiveDownloadState {
  fileName: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  status: "downloading" | "done" | "error";
  error?: string;
}

export class AiKuRpcWorker {
  private config: AppConfig;
  private readonly configPath: string;
  private safeExecutor: SafeExecutor;
  private llmEngine: LocalLlamaEngine;
  private readonly notesStore: QuickNotesStore;
  private readonly pendingPlans = new Map<string, ExecutionPlan>();
  private activeDownload: ActiveDownloadState | null = null;

  constructor(config: AppConfig, configPath: string = path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME)) {
    this.config = config;
    this.configPath = path.resolve(configPath);
    this.notesStore = new QuickNotesStore(path.join(path.dirname(config.historyLogPath), "notes.json"));
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
        const [modelReady, availableModels, regAutoStart] = await Promise.all([
          isModelDownloaded(this.config.llm),
          listAvailableModels(this.config.llm.modelsDir),
          queryWindowsAutoStart(),
        ]);
        return {
          allowedDirectories: this.config.allowedDirectories,
          primarySandbox: primarySandbox,
          quarantineDirName: this.config.quarantineDirName,
          categories: this.config.categories,
          oldInstallerDays: this.config.oldInstallerDays,
          notifDurationSec: this.config.notifDurationSec,
          autoStartOnBoot: regAutoStart || this.config.autoStartOnBoot,
          hotkey: this.config.hotkey,
          modelReady,
          modelFileName: this.config.llm.modelFileName,
          availableModels,
          activeDownload: this.activeDownload,
          threads: this.config.llm.threads,
          aiMode: this.config.llm.aiMode,
          hasGeminiApiKey: Boolean(this.config.llm.geminiApiKey && this.config.llm.geminiApiKey.trim().length > 0),
        };
      }

      case "updateConfig": {
        const parsed = UpdateConfigParamsSchema.parse(params);
        let nextModelFileName = this.config.llm.modelFileName;
        let nextModelUrl = this.config.llm.modelDownloadUrl;

        if (parsed.modelFileName) {
          // Pastikan nama file model tidak mengandung path traversal
          if (
            parsed.modelFileName.includes("/") ||
            parsed.modelFileName.includes("\\") ||
            parsed.modelFileName.includes("..")
          ) {
            throw new Error("Nama file model tidak valid.");
          }
          nextModelFileName = parsed.modelFileName;
          const matchedPreset = MODEL_PRESETS.find((p) => p.fileName === parsed.modelFileName);
          if (matchedPreset) {
            nextModelUrl = matchedPreset.downloadUrl;
          }
        }

        const nextGeminiKey =
          parsed.geminiApiKey !== undefined
            ? parsed.geminiApiKey.trim() || undefined
            : this.config.llm.geminiApiKey;

        const nextRaw = {
          allowedDirectories: parsed.allowedDirectories ?? this.config.allowedDirectories,
          quarantineDirName: this.config.quarantineDirName,
          categories: parsed.categories ?? this.config.categories,
          oldInstallerDays: parsed.oldInstallerDays ?? this.config.oldInstallerDays,
          notifDurationSec: parsed.notifDurationSec ?? this.config.notifDurationSec,
          autoStartOnBoot: parsed.autoStartOnBoot ?? this.config.autoStartOnBoot,
          hotkey: parsed.hotkey ?? this.config.hotkey,
          historyLogPath: this.config.historyLogPath,
          llm: {
            ...this.config.llm,
            modelFileName: nextModelFileName,
            modelDownloadUrl: nextModelUrl,
            threads: parsed.threads ?? this.config.llm.threads,
            aiMode: parsed.aiMode ?? this.config.llm.aiMode,
            ...(nextGeminiKey ? { geminiApiKey: nextGeminiKey } : {}),
          },
        };
        if (parsed.geminiApiKey !== undefined && parsed.geminiApiKey.trim() === "") {
          delete (nextRaw.llm as { geminiApiKey?: string }).geminiApiKey;
        }

        // Validasi ketat Zod + PathGuard (menolak folder sensitif seperti C:\Windows / .ssh / AppData)
        const baseDir = path.dirname(this.configPath);
        const validatedConfig = resolveAppConfig(nextRaw, baseDir);
        new PathGuard(validatedConfig.allowedDirectories);

        if (parsed.autoStartOnBoot !== undefined) {
          await setWindowsAutoStart(parsed.autoStartOnBoot, baseDir);
        }

        for (const dir of validatedConfig.allowedDirectories) {
          await fs.mkdir(dir, { recursive: true });
        }

        const tempPath = `${this.configPath}.tmp-${process.pid}-${Date.now()}`;
        await fs.writeFile(tempPath, JSON.stringify(validatedConfig, null, 2) + "\n", "utf8");
        await fs.rename(tempPath, this.configPath);

        await this.llmEngine.disposeNow();
        this.config = validatedConfig;
        this.safeExecutor = new SafeExecutor({
          allowedDirectories: validatedConfig.allowedDirectories,
          historyLogPath: validatedConfig.historyLogPath,
          quarantineDirName: validatedConfig.quarantineDirName,
        });
        this.llmEngine = new LocalLlamaEngine({
          llmConfig: validatedConfig.llm,
        });
        this.pendingPlans.clear();

        return {
          saved: true,
          allowedDirectories: validatedConfig.allowedDirectories,
          categories: validatedConfig.categories,
          oldInstallerDays: validatedConfig.oldInstallerDays,
          notifDurationSec: validatedConfig.notifDurationSec,
          threads: validatedConfig.llm.threads,
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
        const requestedFile =
          typeof params.modelFileName === "string" && params.modelFileName.trim().length > 0
            ? params.modelFileName.trim()
            : this.config.llm.modelFileName;

        if (
          requestedFile.includes("/") ||
          requestedFile.includes("\\") ||
          requestedFile.includes("..")
        ) {
          throw new Error("Nama file model tidak valid.");
        }

        if (this.activeDownload && this.activeDownload.status === "downloading") {
          return { started: true, alreadyDownloading: true, activeDownload: this.activeDownload };
        }

        const preset = MODEL_PRESETS.find((p) => p.fileName === requestedFile);
        const targetLlmConfig = preset
          ? {
              ...this.config.llm,
              modelFileName: preset.fileName,
              modelDownloadUrl: preset.downloadUrl,
            }
          : this.config.llm;

        this.activeDownload = {
          fileName: targetLlmConfig.modelFileName,
          downloadedBytes: 0,
          totalBytes: null,
          percent: 0,
          status: "downloading",
        };

        // Jalankan di background agar HTTP/RPC tidak timeout dan tetap jalan saat Dynamic Island mengecil
        void ensureModelDownloaded(targetLlmConfig, (progress) => {
          if (this.activeDownload) {
            this.activeDownload = {
              fileName: targetLlmConfig.modelFileName,
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              percent: progress.percent,
              status: "downloading",
            };
          }
        })
          .then(() => {
            if (this.activeDownload) {
              this.activeDownload = {
                ...this.activeDownload,
                percent: 100,
                status: "done",
              };
            }
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.activeDownload = {
              fileName: targetLlmConfig.modelFileName,
              downloadedBytes: this.activeDownload?.downloadedBytes ?? 0,
              totalBytes: this.activeDownload?.totalBytes ?? null,
              percent: this.activeDownload?.percent ?? null,
              status: "error",
              error: msg,
            };
          });

        return { started: true, modelFileName: targetLlmConfig.modelFileName };
      }

      case "warmupModel": {
        const warmed = await this.llmEngine.warmupModel();
        return { warmed };
      }

      case "quickTldr": {
        const parsed = QuickTldrParamsSchema.parse(params);
        return runQuickTldr(parsed.text, this.llmEngine);
      }

      case "formatClipboard": {
        const parsed = FormatClipboardParamsSchema.parse(params);
        return { formatted: formatBrokenPdfClipboard(parsed.text) };
      }

      case "extractTodos": {
        const parsed = FormatClipboardParamsSchema.parse(params);
        return extractTodoChecklist(parsed.text);
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

      case "openBrowserSearch": {
        const parsed = OpenBrowserSearchParamsSchema.parse(params);
        return openSafeBrowserTarget(parsed.target);
      }

      case "mediaControl": {
        const parsed = MediaControlParamsSchema.parse(params);
        return queryWindowsMedia(parsed.action);
      }

      case "pollNotifications": {
        return pollWindowsNotifications(25);
      }

      case "replyWhatsApp": {
        const parsed = ReplyWhatsAppParamsSchema.parse(params);
        return openWhatsAppReply(
          parsed.phone ? { text: parsed.text, phone: parsed.phone } : { text: parsed.text }
        );
      }

      case "draftReply": {
        const parsed = DraftReplyParamsSchema.parse(params);
        const prompt = `Buatkan 1 kalimat balasan WhatsApp yang sopan, singkat, dan natural dalam bahasa Indonesia untuk pesan dari "${parsed.sender}": "${parsed.body}". Langsung tulis isi balasannya saja tanpa tanda kutip atau penjelasan.`;
        const draft = await this.llmEngine.chat({
          message: prompt,
          history: [],
          sandboxContextSummary: "Tugas membuat draf balasan pesan singkat.",
        });
        return { draft: draft.replace(/^["']|["']$/g, "").trim() };
      }
    }
  }

  private async handleChatIntent(
    input: z.infer<typeof ChatParamsSchema>,
    primarySandbox: string
  ): Promise<unknown> {
    const lower = input.message.toLowerCase().trim();

    // 0a. Intent: Sapaan / Terima kasih singkat (instan, natural, anti-ngaco)
    if (/^(halo|hai|hi|hello|pagi|selamat\s+pagi|siang|selamat\s+siang|sore|malam|tes|test)[!.?]*$/.test(lower)) {
      return {
        reply:
          "Halo! Saya **aiKu**, siap membantu merapikan file, cek duplikat, ringkas clipboard, atau menjawab pertanyaan Anda. Ada yang bisa saya bantu?",
        attachment: null,
      };
    }
    if (/^(makasih|terima\s+kasih|thanks|thank\s+you|oke|ok|siap|mantap)[!.?]*$/.test(lower)) {
      return {
        reply: "Sama-sama! Kalau butuh bantuan lagi, panggil saya kapan saja ya.",
        attachment: null,
      };
    }

    // 0b. Intent: Jam / Tanggal lokal
    if (/\b(jam\s+berapa|pukul\s+berapa|tanggal\s+berapa|hari\s+apa)\b/.test(lower)) {
      const now = new Date();
      const formatted = now.toLocaleString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      return {
        reply: `Sekarang **${formatted}** (waktu lokal laptop Anda).`,
        attachment: null,
      };
    }

    // 0b1. Intent: Kalkulator instan & Konverter Satuan (0 MB AI RAM, tanpa eval)
    const unitConverted = convertUnitExpression(input.message);
    if (unitConverted !== null) {
      return { reply: unitConverted, attachment: null };
    }
    const mathResult = evaluateSafeMathExpression(input.message);
    if (mathResult !== null) {
      return {
        reply: `\`${input.message.trim()}\` = **${mathResult.toLocaleString("id-ID", { maximumFractionDigits: 6 })}**`,
        attachment: null,
      };
    }

    // 0b1b. Intent: Generator Password Kuat Kriptografis (100% lokal)
    const pwMatch = lower.match(/\b(?:buat|bikin|generate)\s+password(?:\s+(\d{1,2}))?\b/);
    if (pwMatch) {
      const len = pwMatch[1] ? Number.parseInt(pwMatch[1], 10) : 16;
      const password = generateSecurePassword(len);
      return {
        reply: `Password kuat (${password.length} karakter, dibuat lokal):\n\`${password}\``,
        attachment: null,
      };
    }

    // 0b1c. Intent: Quick Reminder dengan Suara ("ingatkan aku/saya 5 detik lagi ...")
    const reminderMatch = input.message
      .trim()
      .match(/^(?:ingatkan(?:\s+(?:saya|aku|ku))?|remind(?:\s+me)?)\s+(\d{1,3})\s*(menit|detik|m|s)(?:\s+lagi)?(?:\s+(?:untuk\s+)?(.+))?$/i);
    if (reminderMatch?.[1] && reminderMatch[2]) {
      const amount = Number.parseInt(reminderMatch[1], 10);
      const unit = reminderMatch[2].toLowerCase();
      const rawNote = (reminderMatch[3] ?? "").replace(/^(ya|dong|deh|nih)[!.?]*$/i, "").trim();
      const reminderText = rawNote || "Waktu pengingat selesai";
      const seconds =
        unit === "detik" || unit === "s"
          ? Math.min(Math.max(amount, 5), 3600)
          : Math.min(Math.max(amount, 1), 180) * 60;
      const label = unit === "detik" || unit === "s" ? `${amount} detik` : `${amount} menit`;
      return {
        reply: `Siap! Pengingat diset **${label}** lagi: **"${reminderText}"** (akan berbunyi & dibacakan otomatis).`,
        attachment: { type: "reminder", seconds, text: reminderText },
      };
    }

    // 0b1d. Intent: Kontrol / Info Music Player Windows 11
    if (/\b(lagu\s+apa|musik\s+apa|now\s+playing|sedang\s+diputar)\b/.test(lower)) {
      const media = await queryWindowsMedia("get");
      return {
        reply: media.active
          ? `Sedang diputar (${media.status}): **${media.title || "Tanpa Judul"}**${media.artist ? ` — ${media.artist}` : ""}`
          : "Tidak ada pemutar musik yang sedang aktif saat ini.",
        attachment: null,
      };
    }
    if (/\b(pause\s+musik|play\s+musik|jeda\s+lagu|lanjut\s+lagu)\b/.test(lower)) {
      const media = await queryWindowsMedia("toggle");
      return {
        reply: media.active
          ? `Musik di-toggle (**${media.status}**): **${media.title || "Media"}**`
          : "Tidak ada pemutar musik yang aktif.",
        attachment: null,
      };
    }
    if (/\b(next\s+lagu|lagu\s+berikutnya|skip\s+lagu)\b/.test(lower)) {
      const media = await queryWindowsMedia("next");
      return {
        reply: media.active
          ? `Berpindah ke lagu berikutnya: **${media.title || "Media"}**`
          : "Tidak ada pemutar musik yang aktif.",
        attachment: null,
      };
    }

    // 0b2. Intent: Timer / Pomodoro Live Activity di Dynamic Island
    const timerMatch = lower.match(/\b(?:timer|pomodoro|fokus|hitung\s+mundur)(?:\s+(\d{1,3})\s*(menit|detik|m|s)?)?\b/);
    if (timerMatch) {
      const rawNum = timerMatch[1] ? Number.parseInt(timerMatch[1], 10) : 25;
      const unit = timerMatch[2] ?? "menit";
      const seconds =
        unit === "detik" || unit === "s"
          ? Math.min(Math.max(rawNum, 5), 3600)
          : Math.min(Math.max(rawNum, 1), 180) * 60;
      const label = unit === "detik" || unit === "s" ? `${rawNum} detik` : `${rawNum} menit`;
      return {
        reply: `Timer fokus **${label}** dimulai! Anda bisa mengecilkan Dynamic Island dan lihat hitung mundurnya langsung di kapsul atas.`,
        attachment: { type: "timer", seconds },
      };
    }

    // 0b3. Intent: Quick Sticky Notes lokal (catat ..., lihat catatan, hapus catatan N)
    const addNoteMatch = input.message.trim().match(/^(?:catat|simpan\s+catatan|note)\s*:?\s+(.+)$/i);
    if (addNoteMatch?.[1]) {
      const saved = await this.notesStore.add(addNoteMatch[1]);
      return {
        reply: `Catatan tersimpan: **"${saved.text}"** (ketik \`lihat catatan\` kapan saja untuk membukanya).`,
        attachment: null,
      };
    }

    const delNoteMatch = lower.match(/^hapus\s+catatan\s+#?(\d+)$/);
    if (delNoteMatch?.[1]) {
      const removed = await this.notesStore.removeByIndex(Number.parseInt(delNoteMatch[1], 10));
      return {
        reply: removed
          ? `Catatan **"${removed.text}"** sudah dihapus.`
          : "Nomor catatan tidak ditemukan. Ketik `lihat catatan` untuk melihat daftarnya.",
        attachment: null,
      };
    }

    if (/\b(lihat\s+catatan|catatan\s+saya|daftar\s+catatan|my\s+notes)\b/.test(lower)) {
      const notes = await this.notesStore.readAll();
      if (notes.length === 0) {
        return {
          reply: "Belum ada catatan tersimpan. Ketik `catat <isi catatan>` untuk membuat catatan cepat!",
          attachment: null,
        };
      }
      const list = notes.map((n, i) => `${i + 1}. ${n.text}`).join("\n");
      return {
        reply: `**Catatan Cepat Anda (${notes.length}):**\n${list}\n\n_(Ketik \`hapus catatan 1\` untuk menghapus)_`,
        attachment: null,
      };
    }

    // 0b4. Intent: Pengaturan dengan Bantuan AI (Non-Sensitif langsung diterapkan, Sensitif munculkan Security Alert!)
    const aiSettingRes = await this.tryHandleAiSettingIntent(input.message.trim(), lower);
    if (aiSettingRes !== null) {
      return aiSettingRes;
    }

    // 0c. Intent: Info Laptop Read-Only yang Aman (node:os, tanpa shell)
    if (
      /\b(laptop\s+(saya|ini|ku)|spek\s+laptop|spesifikasi|info\s+laptop|tentang\s+laptop|ram\s+(saya|tinggal|berapa)|cpu\s+(saya|apa))\b/.test(
        lower
      )
    ) {
      const cpuModel = os.cpus()[0]?.model?.trim() ?? "Tidak diketahui";
      const cpuCores = os.cpus().length;
      const totalGb = (os.totalmem() / 1024 ** 3).toFixed(1);
      const freeGb = (os.freemem() / 1024 ** 3).toFixed(1);
      const usedGb = ((os.totalmem() - os.freemem()) / 1024 ** 3).toFixed(1);
      const uptimeHours = (os.uptime() / 3600).toFixed(1);
      return {
        reply: [
          "Berikut informasi **read-only** yang saya ketahui tentang laptop Anda (tanpa akses sistem sensitif):",
          `• **Perangkat:** \`${os.hostname()}\` (Windows ${os.release()})`,
          `• **CPU:** ${cpuModel} (${cpuCores} threads, AI dibatasi maks ${this.config.llm.threads} threads)`,
          `• **RAM:** Terpakai **${usedGb} GB** / **${totalGb} GB** (tersisa **${freeGb} GB**)`,
          `• **Uptime:** ${uptimeHours} jam`,
          `• **Sandbox Aktif:** \`${primarySandbox}\``,
        ].join("\n"),
        attachment: null,
      };
    }

    // 0d. Intent: Menanyakan kemampuan / fitur aiKu
    if (
      /\b(apa\s+yang\s+bisa\s+(kamu|anda|kau|lu)\s+lakukan|bisa\s+ngapa\s*aja|bisa\s+ngapain|kamu\s+bisa\s+apa|anda\s+bisa\s+apa|bisa\s+bantu\s+apa|fitur\s+apa)\b/.test(
        lower
      )
    ) {
      return {
        reply:
          "Saya **aiKu**, asisten desktop lokal offline Anda. Saya bisa membantu:\n• **Rapikan File** di sandbox secara otomatis (dengan preview Dry-Run aman)\n• **Cek Duplikat SHA-256 & Installer Lama** ke `_AI_Karantina` (tanpa hapus permanen)\n• **Cari File Lokal** & **Undo / Rollback** dengan verifikasi SHA-256\n• **Info Laptop (CPU/RAM)**, **Ringkas Clipboard**, **Rapikan Teks PDF**, dan **Ngobrol Live** dengan suara!",
        attachment: null,
      };
    }

    // 0e. Intent: Safe Command Launcher (preset aman ter-hardcode, bukan shell bebas)
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

    // 4. Intent: Daftar isi file / cari file lokal (abaikan "cari tau / cari tahu / di internet" -> biarkan ke AI!)
    const isKnowledgeQuery = /\b(cari\s+tau|cari\s+tahu|di\s+internet|google|berita|harga\s+saham)\b/.test(lower);
    const isExplicitFileQuery =
      /\b(ada\s+(file\s+)?apa\s*(aja|saja)?|isinya\s+apa|apa\s+(aja|saja)\s+isinya|isi\s+sandbox|isi\s+folder|daftar\s+file|list\s+file|lihat\s+file|semua\s+file)\b/.test(
        lower
      ) ||
      (/\b(cari|carikan|temukan)\b/.test(lower) &&
        /\b(file|berkas|dokumen|pdf|docx|doc|txt|md|mp4|mkv|jpg|png|zip|rar|exe|folder)\b/.test(lower));

    if (!isKnowledgeQuery && isExplicitFileQuery) {
      const searchResult = await runLocalNaturalSearch({
        query: input.message,
        allowedDirectories: this.config.allowedDirectories,
        pathGuard: this.safeExecutor.getPathGuard(),
        llmClient: this.llmEngine,
        useAi: false,
      });
      const totalFound = searchResult.matches.length;
      const files = searchResult.matches.slice(0, 30).map((m) => ({
        relativePath: m.relativePath,
        extension: m.extension,
        sizeBytes: m.sizeBytes,
        modifiedAt: m.modifiedAt.toISOString(),
      }));
      const dirLabels = this.config.allowedDirectories.map((d) => path.basename(d) || d).join(", ");
      const reply =
        totalFound > 0
          ? `Ditemukan **${totalFound} file** di folder terdaftar (${dirLabels})${totalFound > 30 ? " — menampilkan 30 teratas" : ""}:`
          : `Tidak ada file yang cocok di folder terdaftar (${dirLabels}).`;
      return {
        reply,
        attachment: { type: "files", files },
      };
    }

    // 5. Hybrid Smart Routing: jika mode Hybrid & Gemini API Key aktif -> gunakan Gemini untuk riset/soal sulit!
    const routing = classifyCloudRouting(input.message);
    const geminiKey = this.config.llm.geminiApiKey?.trim();
    if (this.config.llm.aiMode === "hybrid" && geminiKey && routing.useGemini) {
      try {
        const cloudRes = await askGeminiCloud({
          apiKey: geminiKey,
          prompt: routing.cleanedPrompt,
          history: input.history.slice(-4),
          enableWebSearch: routing.enableWebSearch,
        });
        const sourceLines =
          cloudRes.sources.length > 0
            ? `\n\n**Sumber Web:**\n${cloudRes.sources.map((s) => `• ${s.title} (${s.url})`).join("\n")}`
            : "";
        const badge = cloudRes.usedWebSearch ? "**[Gemini + Google Search]**" : "**[Gemini 2.5 Flash]**";
        return {
          reply: `${badge}\n${cloudRes.reply}${sourceLines}`,
          attachment: null,
        };
      } catch {
        // Jika internet mati / kuota habis -> otomatis fallback mulus ke model lokal!
      }
    }

    // 6. Obrolan bebas / fallback lokal -> Model Lokal On-Demand (100% offline)
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

  /**
   * Memproses permintaan natural user untuk mengubah pengaturan via AI.
   * - Pengaturan non-sensitif (durasi notif, threads, mode AI, model lokal, tampilan chat, shortcut hover) -> diterapkan langsung.
   * - Pengaturan sensitif (menambah/menghapus folder Sandbox, mengubah/menghapus Gemini API Key) -> wajib memunculkan Security Alert konfirmasi.
   */
  private async tryHandleAiSettingIntent(rawMessage: string, lower: string): Promise<unknown | null> {
    const isSettingVerb = /\b(atur|setting|set|ubah|ganti|pakai|aktifkan|matikan|tambahkan|tambah|pasang|hapus|izinkan)\b/.test(
      lower
    );
    if (!isSettingVerb) {
      return null;
    }

    // 1. Durasi Notifikasi (Non-Sensitif)
    if (
      /\b(notif|notifikasi|durasi\s+mengecil|waktu\s+notif|durasi\s+notif)\b/.test(lower) &&
      /\b(\d{1,2})\s*(detik|s|sec|second)?\b/.test(lower)
    ) {
      const m = lower.match(/\b(\d{1,2})\s*(?:detik|s|sec|second)?\b/);
      if (m?.[1]) {
        const sec = Math.min(30, Math.max(1, Number.parseInt(m[1], 10)));
        await this.dispatch("updateConfig", { notifDurationSec: sec });
        return {
          reply: `Durasi notifikasi Dynamic Island sudah diatur menjadi **${sec} detik** sebelum mengecil otomatis ke Fase 1.`,
          attachment: {
            type: "setting_applied",
            setting: "notifDurationSec",
            value: sec,
            notifTitle: "Durasi Notifikasi Diperbarui",
            notifSub: `Kapsul Fase 2 mengecil otomatis dalam ${sec} detik`,
          },
        };
      }
    }

    // 2. CPU Threads (Non-Sensitif)
    if (/\b(thread|threads|cpu\s+thread)\b/.test(lower)) {
      const m = lower.match(/\b([1-4])\b/);
      if (m?.[1]) {
        const th = Number.parseInt(m[1], 10);
        await this.dispatch("updateConfig", { threads: th });
        return {
          reply: `Batas CPU Threads untuk model AI lokal berhasil diatur ke **${th} thread(s)**.`,
          attachment: {
            type: "setting_applied",
            setting: "threads",
            value: th,
            notifTitle: "CPU Threads Diperbarui",
            notifSub: `Model lokal berjalan dengan maks ${th} threads`,
          },
        };
      }
    }

    // 3. Mode AI: Offline vs Hybrid (Non-Sensitif)
    if (/\b(mode\s+ai|mode\s+hybrid|mode\s+offline|full\s+offline|100%\s+offline)\b/.test(lower)) {
      const nextMode: "offline" | "hybrid" =
        /\b(offline|matikan\s+hybrid)\b/.test(lower) ? "offline" : "hybrid";
      await this.dispatch("updateConfig", { aiMode: nextMode });
      return {
        reply:
          nextMode === "hybrid"
            ? "Mode AI berhasil diatur ke **Hybrid (Model Lokal + Gemini Cloud untuk riset/soal sulit)**."
            : "Mode AI berhasil diatur ke **100% Offline (Hanya Model Lokal di Laptop)**.",
        attachment: {
          type: "setting_applied",
          setting: "aiMode",
          value: nextMode,
          notifTitle: `Mode AI: ${nextMode === "hybrid" ? "Hybrid Cloud" : "100% Offline"}`,
          notifSub:
            nextMode === "hybrid"
              ? "Lokal untuk tugas cepat + Gemini untuk riset web"
              : "Seluruh pemrosesan 100% lokal tanpa internet",
        },
      };
    }

    // 4. Ganti Model AI Lokal (Non-Sensitif)
    if (/\b(ganti\s+model|ubah\s+model|pakai\s+model|set\s+model)\b/.test(lower)) {
      const chosen = MODEL_PRESETS.find(
        (p) =>
          (lower.includes("0.5b") && p.id.includes("0.5b")) ||
          (lower.includes("1.5b") && p.id.includes("1.5b")) ||
          (lower.includes("3b") && p.id.includes("3b")) ||
          (lower.includes("llama") && p.id.includes("llama")) ||
          (lower.includes("gemma") && p.id.includes("gemma"))
      );
      if (chosen) {
        await this.dispatch("updateConfig", { modelFileName: chosen.fileName });
        return {
          reply: `Model AI lokal utama berhasil diganti ke **${chosen.label}** (\`${chosen.fileName}\`).`,
          attachment: {
            type: "setting_applied",
            setting: "modelFileName",
            value: chosen.fileName,
            notifTitle: "Model AI Lokal Diganti",
            notifSub: chosen.label,
          },
        };
      }
    }

    // 5. Gaya Tampilan Chat: Default vs Gemini Style (Non-Sensitif)
    if (/\b(tampilan\s+chat|gaya\s+chat|style\s+chat|chat\s+style|mode\s+chat)\b/.test(lower)) {
      const nextStyle = /\b(gemini)\b/.test(lower) ? "gemini" : "default";
      return {
        reply: `Tampilan ruang chat berhasil diubah ke mode **${nextStyle === "gemini" ? "Gemini Style" : "Default Compact"}**.`,
        attachment: {
          type: "setting_applied",
          setting: "chatStyle",
          value: nextStyle,
          notifTitle: "Tampilan Chat Diperbarui",
          notifSub: `Mode ${nextStyle === "gemini" ? "Gemini Style" : "Default Compact"} aktif`,
        },
      };
    }

    // 6. Batas Hari Installer Lama (Non-Sensitif)
    if (/\b(hotkey|tombol\s+pintas|tombol\s+panggil)\b/.test(lower)) {
      const hkMatch = rawMessage.match(/(?:jadi|ke|menjadi|:)\s*([A-Za-z0-9+ ]{1,30})$/i);
      if (hkMatch?.[1]) {
        const parts = hkMatch[1]
          .trim()
          .split(/\s*\+\s*|\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .map((p) => (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()));
        if (parts.length >= 1 && parts.length <= 3) {
          const nextHotkey = parts.join("+");
          await this.dispatch("updateConfig", { hotkey: nextHotkey });
          return {
            reply: `Hotkey global untuk menyembunyikan/memunculkan Dynamic Island berhasil diubah menjadi **${nextHotkey}**.`,
            attachment: {
              type: "setting_applied",
              setting: "hotkey",
              value: nextHotkey,
              notifTitle: `Hotkey Global: ${nextHotkey}`,
              notifSub: "Tekan kombinasi tombol kapan saja untuk Hide/Show",
            },
          };
        }
      }
    }

    if (/\b(umur\s+installer|batas\s+installer|installer\s+lama)\b/.test(lower) && /\b(\d{1,4})\s*hari\b/.test(lower)) {
      const m = lower.match(/\b(\d{1,4})\s*hari\b/);
      if (m?.[1]) {
        const days = Math.min(3650, Math.max(1, Number.parseInt(m[1], 10)));
        await this.dispatch("updateConfig", { oldInstallerDays: days });
        return {
          reply: `Batas deteksi installer lama sudah diatur menjadi **${days} hari**.`,
          attachment: {
            type: "setting_applied",
            setting: "oldInstallerDays",
            value: days,
            notifTitle: "Deteksi Installer Diperbarui",
            notifSub: `Ambang karantina installer: ${days} hari`,
          },
        };
      }
    }

    // 6b. Tambah Shortcut ke Menu Hover Cepat via AI (Non-Sensitif)
    if (/\b(shortcut|pintasan)\b/.test(lower) && /\b(hover|menu\s+cepat|akses\s+cepat|tambah|pasang)\b/.test(lower)) {
      const appCandidates: Array<{ kw: RegExp; target: string; label: string; icon: string; type: "app" | "system" }> = [
        { kw: /\bspotify\b/, target: "OPEN_SPOTIFY", label: "Spotify", icon: "music", type: "app" },
        { kw: /\bchrome\b/, target: "OPEN_CHROME", label: "Chrome", icon: "globe", type: "app" },
        { kw: /\b(vscode|vs\s*code)\b/, target: "OPEN_VSCODE", label: "VS Code", icon: "code", type: "app" },
        { kw: /\bnotepad\b/, target: "OPEN_NOTEPAD", label: "Notepad", icon: "file", type: "app" },
        { kw: /\b(kalkulator|calc)\b/, target: "OPEN_CALCULATOR", label: "Kalkulator", icon: "app", type: "app" },
        { kw: /\b(whatsapp|wa)\b/, target: "OPEN_WHATSAPP", label: "WhatsApp", icon: "app", type: "app" },
        { kw: /\byoutube\b/, target: "OPEN_YOUTUBE", label: "YouTube", icon: "globe", type: "app" },
        { kw: /\bexplorer\b/, target: "OPEN_EXPLORER", label: "Explorer", icon: "folder", type: "app" },
        { kw: /\btask\s*manager\b/, target: "OPEN_TASK_MANAGER", label: "Task Mgr", icon: "cpu", type: "app" },
        { kw: /\bpaint\b/, target: "OPEN_PAINT", label: "Paint", icon: "app", type: "app" },
        { kw: /\brapikan\b/, target: "QUICK_ORGANIZE", label: "Rapikan", icon: "folder", type: "system" },
        { kw: /\bduplikat\b/, target: "QUICK_HYGIENE", label: "Duplikat", icon: "spark", type: "system" },
        { kw: /\bringkas\b/, target: "SUMMARIZE_CLIP", label: "Ringkas", icon: "file", type: "system" },
        { kw: /\b(spek|ram)\b/, target: "CHECK_SPECS", label: "Spek PC", icon: "cpu", type: "system" },
        { kw: /\b(timer|fokus)\b/, target: "FOCUS_TIMER", label: "Fokus 25m", icon: "clock", type: "system" },
      ];
      const matched = appCandidates.find((c) => c.kw.test(lower));
      if (matched) {
        return {
          reply: `Shortcut **${matched.label}** berhasil ditambahkan ke **Menu Akses Cepat Hover**! Arahkan kursor ke kapsul Idle Pill untuk mencobanya.`,
          attachment: {
            type: "setting_applied",
            setting: "addHoverShortcut",
            value: {
              id: `sc-${Date.now()}`,
              type: matched.type,
              target: matched.target,
              label: matched.label,
              icon: matched.icon,
            },
            notifTitle: `Shortcut Hover +${matched.label}`,
            notifSub: "Tersedia saat hover di kapsul atas",
          },
        };
      }
    }

    // 6c. SENSITIF: Auto-Start Saat Laptop Menyala (Windows Startup Registry HKCU\...\Run) -> WAJIB Security Alert!
    if (
      /\b(auto\s*start|autostart|startup|otomatis\s+(aktif|nyala|jalan|hidup|buka)|saat\s+laptop\s+(nyala|hidup)|pas\s+laptop\s+(nyala|hidup))\b/.test(
        lower
      )
    ) {
      const wantDisable = /\b(matikan|nonaktifkan|jangan|hapus|disable|off|nggak|tidak)\b/.test(lower);
      const nextAutoStart = !wantDisable;
      const baseDir = path.dirname(this.configPath);
      const launchTarget = await resolveStartupLaunchCommand(baseDir);

      return {
        reply: nextAutoStart
          ? "Permintaan terdeteksi sebagai **Pengaturan Sensitif Sistem (Windows Startup Auto-Run)**. Silakan tinjau dan setujui kartu keamanan di bawah untuk mengaktifkan:"
          : "Permintaan terdeteksi sebagai **Pengaturan Sensitif Sistem (Penonaktifan Windows Startup)**. Silakan konfirmasi pada kartu keamanan di bawah:",
        attachment: {
          type: "sensitive_alert",
          severity: "warning",
          title: nextAutoStart
            ? "Izin Aktif Otomatis Saat Laptop Menyala"
            : "Cabut Izin Auto-Start Windows",
          description: nextAutoStart
            ? "Mendaftarkan aiKu pada registry HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run agar Dynamic Island langsung aktif begitu Windows menyala."
            : "Menghapus entri aiKuDesktop dari registry Windows Startup sehingga aplikasi hanya berjalan saat Anda buka manual.",
          diffLabel: nextAutoStart
            ? `+ HKCU\\...\\Run\\aiKuDesktop = ${launchTarget}`
            : "- Hapus HKCU\\...\\Run\\aiKuDesktop",
          payload: { autoStartOnBoot: nextAutoStart },
        },
      };
    }

    // 7. SENSITIF: Mengubah / Memasang / Menghapus Gemini API Key -> WAJIB Security Alert!
    if (/\b(api\s*key|apikey|kunci\s+api)\b/.test(lower)) {
      if (/\b(hapus|reset|kosongkan|cabut)\b/.test(lower)) {
        return {
          reply:
            "Permintaan terdeteksi sebagai **Pengaturan Sensitif (Penghapusan Kredensial Cloud)**. Silakan konfirmasi pada kartu peringatan keamanan di bawah:",
          attachment: {
            type: "sensitive_alert",
            severity: "warning",
            title: "Konfirmasi Hapus Gemini API Key",
            description:
              "Anda akan menghapus kredensial Gemini API Key dari konfigurasi lokal. Fitur riset internet dan bantuan soal sulit via cloud akan dinonaktifkan.",
            diffLabel: "geminiApiKey: [TERSIMPAN] -> [DIHAPUS]",
            payload: { geminiApiKey: "" },
          },
        };
      }

      const keyMatch = rawMessage.match(/\b(AIza[0-9A-Za-z_-]{15,})\b/);
      if (keyMatch?.[1]) {
        const candidateKey = keyMatch[1];
        const masked = `${candidateKey.slice(0, 7)}••••••••${candidateKey.slice(-4)}`;
        return {
          reply:
            "Permintaan terdeteksi sebagai **Pengaturan Sensitif (Perubahan Kredensial API Cloud)**. Demi keamanan, konfirmasi perubahan berikut sebelum disimpan:",
          attachment: {
            type: "sensitive_alert",
            severity: "warning",
            title: "Izin Penyimpanan Kredensial Cloud",
            description:
              "Menyimpan Gemini API Key mengizinkan aiKu meneruskan pertanyaan riset web & soal rumit ke layanan Google Gemini dalam mode Hybrid.",
            diffLabel: `geminiApiKey -> ${masked}`,
            payload: { geminiApiKey: candidateKey, aiMode: "hybrid" },
          },
        };
      }
    }

    // 8. SENSITIF: Menambah / Mengizinkan / Menghapus Direktori Sandbox -> WAJIB Security Alert!
    if (
      /\b(folder|direktori|directory|sandbox)\b/.test(lower) &&
      /\b(tambah|tambahkan|izinkan|masukkan|akses|daftarkan|hapus|keluarkan)\b/.test(lower) &&
      !/\b(buka|lihat|isi|rapikan)\b/.test(lower)
    ) {
      const isRemove = /\b(hapus|keluarkan)\b/.test(lower);
      let targetDir: string | null = null;

      const explicitPath = rawMessage.match(/([A-Za-z]:\\[^\s"'`]+|\.[\\/][^\s"'`]+)/);
      if (explicitPath?.[1]) {
        targetDir = path.resolve(explicitPath[1]);
      } else if (/\bdesktop\b/.test(lower)) {
        targetDir = path.join(os.homedir(), "Desktop");
      } else if (/\bdownloads?\b/.test(lower)) {
        targetDir = path.join(os.homedir(), "Downloads");
      } else if (/\bdocuments?\b/.test(lower)) {
        targetDir = path.join(os.homedir(), "Documents");
      }

      if (targetDir) {
        if (isRemove) {
          const remaining = this.config.allowedDirectories.filter(
            (d) => d.toLowerCase() !== targetDir!.toLowerCase()
          );
          if (remaining.length === 0) {
            return {
              reply: "Ditolak: Minimal harus ada **1 folder Sandbox aktif** yang terdaftar.",
              attachment: {
                type: "sensitive_alert",
                severity: "danger",
                title: "Penghapusan Direktori Diblokir",
                description: "Sistem keamanan P0 mewajibkan minimal satu direktori sandbox tetap terdaftar.",
                diffLabel: `Blocked: ${targetDir}`,
                payload: null,
              },
            };
          }
          return {
            reply:
              "Permintaan terdeteksi sebagai **Pengaturan Sensitif (Pencabutan Akses Direktori)**. Silakan konfirmasi:",
            attachment: {
              type: "sensitive_alert",
              severity: "warning",
              title: "Konfirmasi Cabut Izin Direktori",
              description: "AI tidak akan lagi memiliki akses baca atau pemindahan file pada direktori berikut:",
              diffLabel: `- Cabut Akses: ${targetDir}`,
              payload: { allowedDirectories: remaining },
            },
          };
        }

        // Validasi dengan PathGuard terlebih dahulu apakah path tersebut terlarang (C:\Windows, AppData, .ssh, dll.)
        const nextDirs = Array.from(new Set([...this.config.allowedDirectories, targetDir]));
        try {
          new PathGuard(nextDirs);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          return {
            reply: `**Peringatan Keamanan P0:** Direktori \`${targetDir}\` ditolak oleh PathGuard.`,
            attachment: {
              type: "sensitive_alert",
              severity: "danger",
              title: "Akses Direktori Sistem Diblokir (P0 Guard)",
              description: reason,
              diffLabel: `DITOLAK: ${targetDir}`,
              payload: null,
            },
          };
        }

        return {
          reply:
            "Permintaan terdeteksi sebagai **Pengaturan Sensitif (Penambahan Izin Direktori Sandbox)**. Silakan tinjau & setujui pada alert keamanan di bawah:",
          attachment: {
            type: "sensitive_alert",
            severity: "warning",
            title: "Izin Akses Direktori Baru (Sandbox)",
            description:
              "Memberikan izin pada direktori ini memungkinkan AI membaca daftar file dan menjadwalkan pemindahan file (Dry-Run) di dalamnya.",
            diffLabel: `+ Izinkan Folder: ${targetDir}`,
            payload: { allowedDirectories: nextDirs },
          },
        };
      }
    }

    return null;
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

  const { config, configPath } = await loadOrCreateConfig();
  const worker = new AiKuRpcWorker(config, configPath);

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
