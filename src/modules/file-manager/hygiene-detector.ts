import fs from "node:fs/promises";
import path from "node:path";
import { computeFileSha256 } from "../../core/security/hash.js";
import type { SafeExecutor } from "../../core/security/safe-executor.js";
import type { FileOperationProposal } from "../../core/security/schemas.js";

const INSTALLER_EXTENSIONS = new Set<string>([
  ".exe",
  ".msi",
  ".msix",
  ".dmg",
  ".pkg",
  ".deb",
  ".appimage",
]);

export interface HygieneScanResult {
  proposals: FileOperationProposal[];
  duplicateGroupsCount: number;
  oldInstallersCount: number;
}

async function collectFilesRecursively(
  dirPath: string,
  quarantineDirName: string,
  safeExecutor: SafeExecutor
): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.toLowerCase() === quarantineDirName.toLowerCase()) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    try {
      await safeExecutor.getPathGuard().validatePathStrict(fullPath);
    } catch {
      // Lewati file/folder sensitif atau symlink keluar sandbox secara aman
      continue;
    }

    if (entry.isDirectory()) {
      const nested = await collectFilesRecursively(fullPath, quarantineDirName, safeExecutor);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Duplicate & Old Installer Detector:
 * 1. Mendeteksi file duplikat menggunakan hashing SHA-256 (mempertahankan file tertua).
 * 2. Mendeteksi installer lama (> oldInstallerDays, default 30 hari).
 * 3. Mengusulkan pemindahan ke folder _AI_Karantina (SOFT DELETE, tanpa fs.unlink).
 */
export async function scanHygieneIssues(options: {
  sandboxDir: string;
  quarantineDirName: string;
  oldInstallerDays: number;
  safeExecutor: SafeExecutor;
  now?: Date;
}): Promise<HygieneScanResult> {
  const validatedSandbox = await options.safeExecutor
    .getPathGuard()
    .validatePathStrict(options.sandboxDir);
  const files = await collectFilesRecursively(
    validatedSandbox,
    options.quarantineDirName,
    options.safeExecutor
  );

  const nowMs = (options.now ?? new Date()).getTime();
  const thresholdMs = options.oldInstallerDays * 24 * 60 * 60 * 1000;

  const proposals: FileOperationProposal[] = [];
  const proposedSources = new Set<string>();

  // 1. Deteksi Duplikat berdasarkan ukuran dulu (optimasi), lalu verifikasi SHA-256
  const filesBySize = new Map<number, Array<{ filePath: string; mtimeMs: number }>>();

  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    const list = filesBySize.get(stat.size) ?? [];
    list.push({ filePath, mtimeMs: stat.mtimeMs });
    filesBySize.set(stat.size, list);

    // 2. Sekaligus cek installer lama (> 30 hari)
    const ext = path.extname(filePath).toLowerCase();
    const ageMs = nowMs - stat.mtimeMs;
    if (INSTALLER_EXTENSIONS.has(ext) && ageMs > thresholdMs) {
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      const destination = options.safeExecutor.buildQuarantineDestination(filePath);
      proposals.push({
        action: "MOVE",
        source: filePath,
        destination,
        reason: `Installer lama (${ageDays} hari > batas ${options.oldInstallerDays} hari) -> karantina`,
        origin: "HYGIENE_QUARANTINE",
      });
      proposedSources.add(filePath);
    }
  }

  let duplicateGroupsCount = 0;

  for (const [, sameSizeFiles] of filesBySize) {
    if (sameSizeFiles.length < 2) {
      continue;
    }

    const byHash = new Map<string, Array<{ filePath: string; mtimeMs: number }>>();
    for (const item of sameSizeFiles) {
      const hash = await computeFileSha256(item.filePath);
      const bucket = byHash.get(hash) ?? [];
      bucket.push(item);
      byHash.set(hash, bucket);
    }

    for (const [hash, duplicates] of byHash) {
      if (duplicates.length < 2) {
        continue;
      }
      duplicateGroupsCount += 1;

      // Urutkan berdasarkan mtime terlama -> pertahankan yang pertama sebagai file utama
      duplicates.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const canonical = duplicates[0];
      if (!canonical) {
        continue;
      }

      for (let i = 1; i < duplicates.length; i += 1) {
        const dup = duplicates[i];
        if (!dup || proposedSources.has(dup.filePath)) {
          continue;
        }
        const destination = options.safeExecutor.buildQuarantineDestination(dup.filePath);
        proposals.push({
          action: "MOVE",
          source: dup.filePath,
          destination,
          reason: `Duplikat SHA-256 (${hash.slice(0, 12)}...) dari "${path.basename(canonical.filePath)}" -> karantina`,
          origin: "HYGIENE_QUARANTINE",
        });
        proposedSources.add(dup.filePath);
      }
    }
  }

  const oldInstallersCount = proposals.filter((p) => p.reason.startsWith("Installer lama")).length;

  return {
    proposals,
    duplicateGroupsCount,
    oldInstallersCount,
  };
}
