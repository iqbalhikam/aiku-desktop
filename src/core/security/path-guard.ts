import fs from "node:fs/promises";
import path from "node:path";

export type SecurityViolationCode =
  | "PATH_TRAVERSAL"
  | "OUTSIDE_SANDBOX"
  | "SENSITIVE_PATH"
  | "INVALID_FILENAME"
  | "SYMLINK_ESCAPE"
  | "FORBIDDEN_ACTION";

export class SecurityViolationError extends Error {
  public readonly code: SecurityViolationCode;
  public readonly targetPath: string | undefined;

  constructor(code: SecurityViolationCode, message: string, targetPath?: string) {
    super(`[SECURITY:${code}] ${message}`);
    this.name = "SecurityViolationError";
    this.code = code;
    this.targetPath = targetPath;
  }
}

const SENSITIVE_PATH_SEGMENTS = new Set<string>([
  ".git",
  ".ssh",
  ".env",
  ".gnupg",
  ".aws",
  ".kube",
  "node_modules",
  "windows",
  "system32",
  "syswow64",
  "program files",
  "program files (x86)",
  "programdata",
  "appdata",
  "$recycle.bin",
  "system volume information",
]);

const SENSITIVE_UNIX_ROOTS = ["/etc", "/usr", "/bin", "/sbin", "/var", "/root", "/proc", "/sys"];

const WINDOWS_RESERVED_NAMES = new Set<string>([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function normalizeForComparison(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInsideDirectory(candidatePath: string, allowedDir: string): boolean {
  const normCandidate = normalizeForComparison(candidatePath);
  const normAllowed = normalizeForComparison(allowedDir);

  if (normCandidate === normAllowed) {
    return true;
  }

  const allowedPrefix = normAllowed.endsWith(path.sep) ? normAllowed : normAllowed + path.sep;
  return normCandidate.startsWith(allowedPrefix);
}

/**
 * Memastikan path tidak menyentuh direktori/file sensitif sistem atau kredensial.
 */
export function assertNotSensitivePath(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const normalizedUnix = resolved.replace(/\\/g, "/").toLowerCase();

  for (const unixRoot of SENSITIVE_UNIX_ROOTS) {
    if (normalizedUnix === unixRoot || normalizedUnix.startsWith(`${unixRoot}/`)) {
      throw new SecurityViolationError(
        "SENSITIVE_PATH",
        `Akses ditolak ke direktori sistem sensitif: ${targetPath}`,
        targetPath
      );
    }
  }

  // Deteksi pola C:\Windows atau Windows\System32 di lintas platform
  if (/(^|[\\/])(windows|program files|program files \(x86\)|system32)([\\/]|$)/i.test(resolved)) {
    throw new SecurityViolationError(
      "SENSITIVE_PATH",
      `Akses ditolak ke direktori sistem sensitif: ${targetPath}`,
      targetPath
    );
  }

  const segments = resolved
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());

  for (const segment of segments) {
    if (SENSITIVE_PATH_SEGMENTS.has(segment)) {
      throw new SecurityViolationError(
        "SENSITIVE_PATH",
        `Akses ditolak ke segmen sensitif "${segment}": ${targetPath}`,
        targetPath
      );
    }
    if (segment === ".env" || segment.startsWith(".env.")) {
      throw new SecurityViolationError(
        "SENSITIVE_PATH",
        `Akses ditolak ke file environment sensitif "${segment}": ${targetPath}`,
        targetPath
      );
    }
  }
}

/**
 * Membersihkan nama file usulan AI agar tidak bisa menyuntikkan path traversal atau karakter ilegal.
 */
export function sanitizeFileName(rawName: string): string {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    throw new SecurityViolationError("INVALID_FILENAME", "Nama file tidak boleh kosong.", rawName);
  }
  if (trimmed.includes("\0") || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new SecurityViolationError(
      "PATH_TRAVERSAL",
      `Nama file mengandung karakter path traversal ilegal: "${rawName}"`,
      rawName
    );
  }

  // Ganti karakter tidak valid Windows/POSIX dengan tanda hubung
  const cleaned = trimmed
    .replace(/[<>:"|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

  if (cleaned.length === 0) {
    throw new SecurityViolationError(
      "INVALID_FILENAME",
      `Nama file menjadi kosong setelah sanitasi: "${rawName}"`,
      rawName
    );
  }

  const baseNameWithoutExt = path.parse(cleaned).name.toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(baseNameWithoutExt)) {
    throw new SecurityViolationError(
      "INVALID_FILENAME",
      `Nama file menggunakan nama perangkat cadangan sistem: "${cleaned}"`,
      rawName
    );
  }

  return cleaned.slice(0, 140);
}

export class PathGuard {
  private readonly allowedDirectories: readonly string[];

  constructor(allowedDirectories: readonly string[]) {
    if (allowedDirectories.length === 0) {
      throw new SecurityViolationError(
        "OUTSIDE_SANDBOX",
        "Konfigurasi allowedDirectories tidak boleh kosong."
      );
    }

    const resolvedDirs = allowedDirectories.map((dir) => path.resolve(dir));
    for (const dir of resolvedDirs) {
      assertNotSensitivePath(dir);
    }
    this.allowedDirectories = resolvedDirs;
  }

  public getAllowedDirectories(): readonly string[] {
    return this.allowedDirectories;
  }

  /**
   * Validasi sinkron untuk path (anti null-byte, anti-traversal, anti-sensitive, strict sandbox).
   */
  public validatePath(rawPath: string): string {
    if (rawPath.trim().length === 0 || rawPath.includes("\0")) {
      throw new SecurityViolationError(
        "INVALID_FILENAME",
        "Path kosong atau mengandung null-byte.",
        rawPath
      );
    }

    // Cek NTFS Alternate Data Stream (tanda ':' selain huruf drive Windows seperti C:\)
    const withoutDrivePrefix = rawPath.replace(/^[a-zA-Z]:/, "");
    if (withoutDrivePrefix.includes(":")) {
      throw new SecurityViolationError(
        "INVALID_FILENAME",
        `Path mengandung karakter ':' ilegal (kemungkinan NTFS ADS): ${rawPath}`,
        rawPath
      );
    }

    const resolved = path.resolve(rawPath);
    assertNotSensitivePath(resolved);

    const matchedSandbox = this.allowedDirectories.find((allowed) =>
      isPathInsideDirectory(resolved, allowed)
    );

    if (!matchedSandbox) {
      const isTraversalAttempt = /(^|[\\/])\.\.([\\/]|$)/.test(rawPath);
      throw new SecurityViolationError(
        isTraversalAttempt ? "PATH_TRAVERSAL" : "OUTSIDE_SANDBOX",
        `Path "${rawPath}" (resolved: "${resolved}") berada di luar direktori sandbox yang diizinkan.`,
        rawPath
      );
    }

    return resolved;
  }

  /**
   * Validasi asinkron yang juga mengecek symlink escape melalui fs.realpath.
   */
  public async validatePathStrict(rawPath: string): Promise<string> {
    const resolved = this.validatePath(rawPath);

    // Jika file sudah ada, cek realpath target; jika belum, cek realpath direktori induk terdekat yang ada.
    const existingAncestor = await this.findNearestExistingPath(resolved);
    if (existingAncestor !== null) {
      const realAncestor = await fs.realpath(existingAncestor);
      assertNotSensitivePath(realAncestor);

      const allowedRealDirs = await Promise.all(
        this.allowedDirectories.map(async (dir) => {
          try {
            return await fs.realpath(dir);
          } catch {
            return dir;
          }
        })
      );

      const insideRealSandbox = allowedRealDirs.some((realAllowed) =>
        isPathInsideDirectory(realAncestor, realAllowed)
      );

      if (!insideRealSandbox) {
        throw new SecurityViolationError(
          "SYMLINK_ESCAPE",
          `Symlink escape terdeteksi: "${resolved}" mengarah ke "${realAncestor}" di luar sandbox.`,
          rawPath
        );
      }
    }

    return resolved;
  }

  /**
   * Mengembalikan root sandbox tempat path berada.
   */
  public findSandboxRoot(rawPath: string): string {
    const resolved = this.validatePath(rawPath);
    const root = this.allowedDirectories.find((allowed) => isPathInsideDirectory(resolved, allowed));
    if (!root) {
      throw new SecurityViolationError(
        "OUTSIDE_SANDBOX",
        `Path "${resolved}" tidak termasuk dalam direktori sandbox manapun.`,
        rawPath
      );
    }
    return root;
  }

  private async findNearestExistingPath(targetPath: string): Promise<string | null> {
    let current = targetPath;
    while (true) {
      try {
        await fs.lstat(current);
        return current;
      } catch {
        const parent = path.dirname(current);
        if (parent === current) {
          return null;
        }
        current = parent;
      }
    }
  }
}
