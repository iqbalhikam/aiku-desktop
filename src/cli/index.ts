#!/usr/bin/env node
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { loadOrCreateConfig } from "../config/loader.js";
import type { AppConfig } from "../config/schema.js";
import { LocalLlamaEngine } from "../core/llm/llama-engine.js";
import {
  type DownloadProgress,
  ensureModelDownloaded,
  isModelDownloaded,
} from "../core/llm/model-downloader.js";
import { SafeExecutor } from "../core/security/safe-executor.js";
import type { ExecutionPlan } from "../core/security/schemas.js";
import { scanHygieneIssues } from "../modules/file-manager/hygiene-detector.js";
import { runLocalNaturalSearch } from "../modules/file-manager/local-search.js";
import { buildOrganizePlan } from "../modules/file-manager/orchestrator.js";

interface ParsedCliArgs {
  command: string | undefined;
  positional: string[];
  dryRun: boolean;
  execute: boolean;
  yes: boolean;
  noAi: boolean;
  configPath: string | undefined;
}

function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const positional: string[] = [];
  let dryRun = true;
  let execute = false;
  let yes = false;
  let noAi = false;
  let configPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (arg === "--execute") {
      execute = true;
      dryRun = false;
    } else if (arg === "--dry-run") {
      dryRun = true;
      execute = false;
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--no-ai") {
      noAi = true;
    } else if (arg === "--config" && argv[i + 1]) {
      configPath = argv[i + 1];
      i += 1;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return {
    command: positional[0],
    positional: positional.slice(1),
    dryRun,
    execute,
    yes,
    noAi,
    configPath,
  };
}

function renderProgress(progress: DownloadProgress): void {
  const downloadedMb = (progress.downloadedBytes / (1024 * 1024)).toFixed(1);
  if (progress.totalBytes && progress.percent !== null) {
    const totalMb = (progress.totalBytes / (1024 * 1024)).toFixed(1);
    output.write(`\rMengunduh model Qwen2.5-0.5B GGUF: ${downloadedMb}/${totalMb} MB (${progress.percent}%)`);
  } else {
    output.write(`\rMengunduh model Qwen2.5-0.5B GGUF: ${downloadedMb} MB`);
  }
}

function printExecutionPlan(plan: ExecutionPlan, sandboxRoot: string): void {
  console.log(`\n=== EXECUTION PLAN (ID: ${plan.planId}) ===`);
  if (plan.operations.length === 0) {
    console.log("Tidak ada operasi pemindahan/rename yang perlu dilakukan.");
  } else {
    plan.operations.forEach((op, idx) => {
      const relSrc = path.relative(sandboxRoot, op.source) || op.source;
      const relDst = path.relative(sandboxRoot, op.destination) || op.destination;
      const badge = op.autoRenamed ? " [ANTI-OVERWRITE SUFFIX]" : "";
      console.log(`${idx + 1}. [${op.action}] [${op.origin}]${badge}`);
      console.log(`   Source : ${relSrc}`);
      console.log(`   Target : ${relDst}`);
      console.log(`   Alasan : ${op.reason}`);
    });
  }

  if (plan.skipped.length > 0) {
    console.log(`\nDilewati (${plan.skipped.length}):`);
    for (const item of plan.skipped) {
      const relSrc = path.relative(sandboxRoot, item.source) || item.source;
      console.log(` - ${relSrc}: ${item.reason}`);
    }
  }
  console.log("============================================\n");
}

async function confirmAndExecutePlan(params: {
  plan: ExecutionPlan;
  safeExecutor: SafeExecutor;
  dryRun: boolean;
  autoConfirm: boolean;
  rl?: readline.Interface;
}): Promise<void> {
  if (params.plan.operations.length === 0) {
    return;
  }

  if (params.dryRun) {
    console.log("[DRY-RUN MODE] Tidak ada file yang diubah. Jalankan dengan --execute untuk menerapkan rencana.");
    return;
  }

  let confirmed = params.autoConfirm;
  if (!confirmed) {
    const localRl = params.rl ?? readline.createInterface({ input, output });
    try {
      const answer = await localRl.question('Konfirmasi eksekusi? Ketik "YA" untuk melanjutkan: ');
      confirmed = answer.trim().toUpperCase() === "YA";
    } finally {
      if (!params.rl) {
        localRl.close();
      }
    }
  }

  if (!confirmed) {
    console.log("Eksekusi dibatalkan oleh pengguna. Tidak ada perubahan pada disk.");
    return;
  }

  const result = await params.safeExecutor.executePlan(params.plan, { dryRun: false });
  console.log(`\nBerhasil mengeksekusi ${result.executedCount} operasi. Audit log SHA-256 tersimpan.`);
  for (const tx of result.transactions) {
    console.log(` - TX ${tx.transactionId} | SHA-256: ${tx.sha256.slice(0, 16)}...`);
  }
}

async function handleOrganize(
  config: AppConfig,
  safeExecutor: SafeExecutor,
  llmEngine: LocalLlamaEngine,
  options: { targetDir?: string; dryRun: boolean; yes: boolean; noAi: boolean; rl?: readline.Interface }
): Promise<void> {
  const targetDir = path.resolve(options.targetDir ?? config.allowedDirectories[0] ?? "./sandbox");
  const plan = await buildOrganizePlan({
    targetDir,
    config,
    safeExecutor,
    llmClient: llmEngine,
    enableAi: !options.noAi,
    onStatus: (msg) => console.log(`[AI] ${msg}`),
  });

  printExecutionPlan(plan, targetDir);
  await confirmAndExecutePlan({
    plan,
    safeExecutor,
    dryRun: options.dryRun,
    autoConfirm: options.yes,
    ...(options.rl ? { rl: options.rl } : {}),
  });
}

async function handleHygiene(
  config: AppConfig,
  safeExecutor: SafeExecutor,
  options: { targetDir?: string; dryRun: boolean; yes: boolean; rl?: readline.Interface }
): Promise<void> {
  const targetDir = path.resolve(options.targetDir ?? config.allowedDirectories[0] ?? "./sandbox");
  const scan = await scanHygieneIssues({
    sandboxDir: targetDir,
    quarantineDirName: config.quarantineDirName,
    oldInstallerDays: config.oldInstallerDays,
    safeExecutor,
  });

  console.log(
    `\nHasil Pemindaian Kebersihan: ${scan.duplicateGroupsCount} grup duplikat SHA-256, ${scan.oldInstallersCount} installer lama (> ${config.oldInstallerDays} hari).`
  );

  const plan = await safeExecutor.createPlan(scan.proposals);
  printExecutionPlan(plan, targetDir);
  await confirmAndExecutePlan({
    plan,
    safeExecutor,
    dryRun: options.dryRun,
    autoConfirm: options.yes,
    ...(options.rl ? { rl: options.rl } : {}),
  });
}

async function handleSearch(
  config: AppConfig,
  safeExecutor: SafeExecutor,
  llmEngine: LocalLlamaEngine,
  query: string,
  noAi: boolean
): Promise<void> {
  const result = await runLocalNaturalSearch({
    query,
    allowedDirectories: config.allowedDirectories,
    pathGuard: safeExecutor.getPathGuard(),
    llmClient: llmEngine,
    useAi: !noAi,
  });

  console.log(`\nFilter Terstruktur (${result.usedAi ? "Qwen 0.5B" : "Heuristik Lokal"}):`);
  console.log(JSON.stringify(result.filter, null, 2));
  console.log(`\nDitemukan ${result.matches.length} file:`);
  for (const item of result.matches) {
    console.log(
      ` - ${item.relativePath} (${item.sizeBytes} bytes, diubah: ${item.modifiedAt.toISOString().slice(0, 10)})`
    );
  }
}

async function handleHistory(safeExecutor: SafeExecutor): Promise<void> {
  const records = await safeExecutor.getTransactionLog().readAll();
  if (records.length === 0) {
    console.log("\nBelum ada riwayat transaksi di history log.");
    return;
  }

  console.log(`\n=== RIWAYAT TRANSAKSI (${records.length}) ===`);
  for (const rec of records.slice(-20)) {
    const status = rec.rolledBackAt ? `ROLLED BACK (${rec.rolledBackAt})` : "ACTIVE";
    console.log(`[${rec.transactionId}] ${rec.action} | ${status}`);
    console.log(`  Waktu  : ${rec.timestamp}`);
    console.log(`  Asal   : ${rec.source}`);
    console.log(`  Tujuan : ${rec.destination}`);
    console.log(`  SHA256 : ${rec.sha256}`);
  }
}

async function handleRollback(safeExecutor: SafeExecutor, transactionId: string): Promise<void> {
  const result = await safeExecutor.rollback(transactionId);
  console.log(`\nRollback BERHASIL untuk transaksi ${result.transactionId}`);
  console.log(`  Dikembalikan dari : ${result.restoredFrom}`);
  console.log(`  Dikembalikan ke   : ${result.restoredTo}`);
  console.log(`  Verifikasi SHA256 : COCOK (${result.sha256})`);
  if (result.autoRenamedOnRestore) {
    console.log("  Catatan           : Nama file diberi suffix anti-overwrite saat restore.");
  }
}

async function runInteractiveMenu(
  config: AppConfig,
  safeExecutor: SafeExecutor,
  llmEngine: LocalLlamaEngine
): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log("\n==========================================");
    console.log("  aiKu - Local File Assistant (P0 Safe)");
    console.log("  Mode Default: DRY-RUN | Engine: CPU-Only");
    console.log("==========================================");
    console.log(`Sandbox aktif: ${config.allowedDirectories.join(", ")}`);
    const modelReady = await isModelDownloaded(config.llm);
    console.log(`Model AI (Qwen2.5-0.5B Q4_K_M): ${modelReady ? "SIAP (Lokal)" : "Belum diunduh (auto-download saat fitur AI dipakai)"}`);

    while (true) {
      console.log("\nPilih menu:");
      console.log("  1. Organize File (Dry-Run Preview)");
      console.log("  2. Organize File (Execute dengan Konfirmasi)");
      console.log("  3. Deteksi Duplikat & Installer Lama -> Karantina (Dry-Run / Execute)");
      console.log("  4. Pencarian Bahasa Natural (Local Search)");
      console.log("  5. Lihat Riwayat Transaksi (SHA-256 Log)");
      console.log("  6. Rollback Transaksi (Undo dengan Verifikasi SHA-256)");
      console.log("  7. Unduh / Verifikasi Model Qwen2.5-0.5B-Instruct (~400 MB)");
      console.log("  0. Keluar");

      const choice = (await rl.question("\nPilihan [0-7]: ")).trim();

      if (choice === "0") {
        console.log("Sampai jumpa.");
        break;
      }

      try {
        if (choice === "1" || choice === "2") {
          const useAiAnswer = (await rl.question("Gunakan AI untuk dokumen (.pdf/.docx/.txt)? [Y/n]: ")).trim().toLowerCase();
          const noAi = useAiAnswer === "n";
          await handleOrganize(config, safeExecutor, llmEngine, {
            dryRun: choice === "1",
            yes: false,
            noAi,
            rl,
          });
        } else if (choice === "3") {
          const mode = (await rl.question("Mode eksekusi? (d = Dry-Run [default], e = Execute): ")).trim().toLowerCase();
          await handleHygiene(config, safeExecutor, {
            dryRun: mode !== "e",
            yes: false,
            rl,
          });
        } else if (choice === "4") {
          const query = (await rl.question('Masukkan kueri (mis. "cari pdf tugas bulan lalu"): ')).trim();
          if (query.length > 0) {
            const useAiAnswer = (await rl.question("Terjemahkan kueri dengan AI Qwen 0.5B? [y/N]: ")).trim().toLowerCase();
            await handleSearch(config, safeExecutor, llmEngine, query, useAiAnswer !== "y");
          }
        } else if (choice === "5") {
          await handleHistory(safeExecutor);
        } else if (choice === "6") {
          const txId = (await rl.question("Masukkan Transaction ID untuk rollback: ")).trim();
          if (txId.length > 0) {
            await handleRollback(safeExecutor, txId);
          }
        } else if (choice === "7") {
          const modelPath = await ensureModelDownloaded(config.llm, renderProgress);
          console.log(`\nModel siap digunakan di: ${modelPath}`);
        } else {
          console.log("Pilihan tidak dikenali.");
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n[ERROR] ${message}`);
      }
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const { config, configPath, created } = await loadOrCreateConfig(args.configPath);

  if (created) {
    console.log(`[INIT] Konfigurasi default dibuat di: ${configPath}`);
    console.log(`[INIT] Folder sandbox default: ${config.allowedDirectories[0]}`);
  }

  const safeExecutor = new SafeExecutor({
    allowedDirectories: config.allowedDirectories,
    historyLogPath: config.historyLogPath,
    quarantineDirName: config.quarantineDirName,
  });

  const llmEngine = new LocalLlamaEngine({
    llmConfig: config.llm,
    onDownloadProgress: renderProgress,
  });

  if (!args.command) {
    await runInteractiveMenu(config, safeExecutor, llmEngine);
    return;
  }

  switch (args.command) {
    case "organize":
      await handleOrganize(config, safeExecutor, llmEngine, {
        ...(args.positional[0] ? { targetDir: args.positional[0] } : {}),
        dryRun: args.dryRun,
        yes: args.yes,
        noAi: args.noAi,
      });
      break;

    case "hygiene":
      await handleHygiene(config, safeExecutor, {
        ...(args.positional[0] ? { targetDir: args.positional[0] } : {}),
        dryRun: args.dryRun,
        yes: args.yes,
      });
      break;

    case "search": {
      const query = args.positional.join(" ").trim();
      if (!query) {
        throw new Error('Berikan kueri pencarian, contoh: aiku search "cari pdf tugas bulan lalu"');
      }
      await handleSearch(config, safeExecutor, llmEngine, query, args.noAi);
      break;
    }

    case "history":
      await handleHistory(safeExecutor);
      break;

    case "rollback": {
      const txId = args.positional[0];
      if (!txId) {
        throw new Error("Berikan Transaction ID, contoh: aiku rollback <transactionId>");
      }
      await handleRollback(safeExecutor, txId);
      break;
    }

    case "setup-model": {
      const modelPath = await ensureModelDownloaded(config.llm, renderProgress);
      console.log(`\nModel siap digunakan di: ${modelPath}`);
      break;
    }

    default:
      console.log("Perintah tersedia: organize | hygiene | search | history | rollback | setup-model");
      console.log("Flag: --dry-run (default) | --execute | --yes | --no-ai | --config <path>");
      break;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FATAL] ${message}`);
  process.exitCode = 1;
});
