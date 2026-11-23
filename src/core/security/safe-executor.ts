import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { computeFileSha256 } from "./hash.js";
import { PathGuard, SecurityViolationError, sanitizeFileName } from "./path-guard.js";
import {
  AiActionTypeSchema,
  type ExecutionPlan,
  type FileOperationProposal,
  FileOperationProposalSchema,
  type PlannedOperation,
  type TransactionRecord,
} from "./schemas.js";
import { TransactionLog } from "./transaction-log.js";

export class IntegrityViolationError extends Error {
  public readonly expectedSha256: string;
  public readonly actualSha256: string;

  constructor(transactionId: string, expectedSha256: string, actualSha256: string) {
    super(
      `[INTEGRITY_ERROR] Rollback dibatalkan untuk transaksi ${transactionId}: hash SHA-256 tidak cocok (expected: ${expectedSha256}, actual: ${actualSha256}).`
    );
    this.name = "IntegrityViolationError";
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

export interface ExecutionResult {
  dryRun: boolean;
  planId: string;
  executedCount: number;
  skippedCount: number;
  transactions: TransactionRecord[];
}

export interface RollbackResult {
  transactionId: string;
  restoredFrom: string;
  restoredTo: string;
  sha256: string;
  autoRenamedOnRestore: boolean;
}

export class SafeExecutor {
  private readonly pathGuard: PathGuard;
  private readonly transactionLog: TransactionLog;
  private readonly quarantineDirName: string;

  constructor(options: {
    allowedDirectories: readonly string[];
    historyLogPath: string;
    quarantineDirName?: string;
  }) {
    this.pathGuard = new PathGuard(options.allowedDirectories);
    this.transactionLog = new TransactionLog(options.historyLogPath);
    this.quarantineDirName = options.quarantineDirName ?? "_AI_Karantina";
  }

  public getPathGuard(): PathGuard {
    return this.pathGuard;
  }

  public getTransactionLog(): TransactionLog {
    return this.transactionLog;
  }

  /**
   * Memvalidasi aksi mentah (mis. dari AI) agar hanya MOVE | RENAME | SKIP yang lolos.
   * Menolak DELETE atau aksi asing secara mutlak.
   */
  public assertAllowedAction(rawAction: unknown): "MOVE" | "RENAME" | "SKIP" {
    const result = AiActionTypeSchema.safeParse(rawAction);
    if (!result.success) {
      throw new SecurityViolationError(
        "FORBIDDEN_ACTION",
        `Aksi "${String(rawAction)}" ditolak secara mutlak. Hanya MOVE, RENAME, atau SKIP yang diizinkan.`
      );
    }
    return result.data;
  }

  /**
   * Menghasilkan path karantina (soft delete) di dalam sandbox.
   * Tidak pernah memanggil fs.unlink.
   */
  public buildQuarantineDestination(sourcePath: string): string {
    const validatedSource = this.pathGuard.validatePath(sourcePath);
    const sandboxRoot = this.pathGuard.findSandboxRoot(validatedSource);
    const safeBaseName = sanitizeFileName(path.basename(validatedSource));
    const destination = path.join(sandboxRoot, this.quarantineDirName, safeBaseName);
    return this.pathGuard.validatePath(destination);
  }

  /**
   * Anti-Overwrite: jika file tujuan sudah ada (atau sudah dipesan dalam batch yang sama),
   * otomatis tambahkan suffix angka berurutan: nama_file_1.pdf, nama_file_2.pdf, dst.
   */
  public async resolveNonOverwritingPath(
    targetPath: string,
    reservedPaths: ReadonlySet<string> = new Set<string>()
  ): Promise<{ resolvedPath: string; autoRenamed: boolean }> {
    const validatedTarget = await this.pathGuard.validatePathStrict(targetPath);
    const parsed = path.parse(validatedTarget);

    let candidate = validatedTarget;
    let counter = 1;
    let autoRenamed = false;

    while (await this.pathExistsOrReserved(candidate, reservedPaths)) {
      const nextName = `${parsed.name}_${counter}${parsed.ext}`;
      candidate = path.join(parsed.dir, nextName);
      await this.pathGuard.validatePathStrict(candidate);
      counter += 1;
      autoRenamed = true;
    }

    return { resolvedPath: candidate, autoRenamed };
  }

  /**
   * Menyusun Execution Plan (preview) yang wajib dilihat user sebelum eksekusi.
   */
  public async createPlan(proposals: readonly FileOperationProposal[]): Promise<ExecutionPlan> {
    const operations: PlannedOperation[] = [];
    const skipped: Array<{ source: string; reason: string }> = [];
    const reservedDestinations = new Set<string>();

    for (const rawProposal of proposals) {
      const proposal = FileOperationProposalSchema.parse(rawProposal);
      this.assertAllowedAction(proposal.action);

      const validatedSource = await this.pathGuard.validatePathStrict(proposal.source);

      if (proposal.action === "SKIP") {
        skipped.push({ source: validatedSource, reason: proposal.reason });
        continue;
      }

      const validatedDestination = await this.pathGuard.validatePathStrict(proposal.destination);

      // Jika source === destination (case-insensitive di Windows), lewati
      if (this.normalizeKey(validatedSource) === this.normalizeKey(validatedDestination)) {
        skipped.push({
          source: validatedSource,
          reason: "File sudah berada di lokasi dan nama tujuan.",
        });
        continue;
      }

      const { resolvedPath, autoRenamed } = await this.resolveNonOverwritingPath(
        validatedDestination,
        reservedDestinations
      );
      reservedDestinations.add(this.normalizeKey(resolvedPath));

      operations.push({
        id: crypto.randomUUID(),
        action: proposal.action,
        source: validatedSource,
        destination: resolvedPath,
        reason: proposal.reason,
        origin: proposal.origin,
        autoRenamed,
      });
    }

    return {
      planId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      operations,
      skipped,
    };
  }

  /**
   * Mengeksekusi Execution Plan. Default selalu dryRun = true (tidak ada perubahan disk).
   */
  public async executePlan(
    plan: ExecutionPlan,
    options: { dryRun: boolean } = { dryRun: true }
  ): Promise<ExecutionResult> {
    if (options.dryRun) {
      return {
        dryRun: true,
        planId: plan.planId,
        executedCount: 0,
        skippedCount: plan.skipped.length,
        transactions: [],
      };
    }

    const transactions: TransactionRecord[] = [];

    for (const op of plan.operations) {
      this.assertAllowedAction(op.action);
      if (op.action === "SKIP") {
        continue;
      }

      // Re-validasi ketat tepat sebelum eksekusi (mencegah TOCTOU / symlink swap)
      const validatedSource = await this.pathGuard.validatePathStrict(op.source);
      const { resolvedPath: finalDestination } = await this.resolveNonOverwritingPath(
        op.destination
      );

      // Hitung SHA-256 sebelum memindahkan file
      const sha256 = await computeFileSha256(validatedSource);

      // Pastikan folder tujuan berada di dalam sandbox sebelum dibuat
      const destinationDir = path.dirname(finalDestination);
      await this.pathGuard.validatePathStrict(destinationDir);
      await fs.mkdir(destinationDir, { recursive: true });

      // Pindahkan / rename secara atomik (tanpa fs.unlink)
      await fs.rename(validatedSource, finalDestination);

      const record: TransactionRecord = {
        transactionId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        action: op.action,
        source: validatedSource,
        destination: finalDestination,
        sha256,
        reason: op.reason,
      };

      await this.transactionLog.append(record);
      transactions.push(record);
    }

    return {
      dryRun: false,
      planId: plan.planId,
      executedCount: transactions.length,
      skippedCount: plan.skipped.length,
      transactions,
    };
  }

  /**
   * Mengembalikan file ke posisi semula setelah memverifikasi kecocokan SHA-256.
   */
  public async rollback(transactionId: string): Promise<RollbackResult> {
    const record = await this.transactionLog.findById(transactionId);
    if (!record) {
      throw new Error(`Transaksi dengan ID "${transactionId}" tidak ditemukan di history log.`);
    }
    if (record.rolledBackAt) {
      throw new Error(
        `Transaksi "${transactionId}" sudah pernah di-rollback pada ${record.rolledBackAt}.`
      );
    }

    const validatedCurrentPath = await this.pathGuard.validatePathStrict(record.destination);
    const validatedOriginalPath = await this.pathGuard.validatePathStrict(record.source);

    // Verifikasi integritas SHA-256 sebelum memindahkan balik
    const currentHash = await computeFileSha256(validatedCurrentPath);
    if (currentHash !== record.sha256) {
      throw new IntegrityViolationError(transactionId, record.sha256, currentHash);
    }

    // Anti-overwrite juga berlaku saat rollback agar tidak menimpa file baru di lokasi asal
    const { resolvedPath: finalRestorePath, autoRenamed } = await this.resolveNonOverwritingPath(
      validatedOriginalPath
    );

    const restoreDir = path.dirname(finalRestorePath);
    await this.pathGuard.validatePathStrict(restoreDir);
    await fs.mkdir(restoreDir, { recursive: true });

    await fs.rename(validatedCurrentPath, finalRestorePath);
    await this.transactionLog.markRolledBack(transactionId, new Date().toISOString());

    return {
      transactionId,
      restoredFrom: validatedCurrentPath,
      restoredTo: finalRestorePath,
      sha256: currentHash,
      autoRenamedOnRestore: autoRenamed,
    };
  }

  private normalizeKey(targetPath: string): string {
    const resolved = path.resolve(targetPath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  private async pathExistsOrReserved(
    targetPath: string,
    reservedPaths: ReadonlySet<string>
  ): Promise<boolean> {
    if (reservedPaths.has(this.normalizeKey(targetPath))) {
      return true;
    }
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
