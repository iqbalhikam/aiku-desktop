import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export interface WindowsNotificationItem {
  id: string;
  appId: string;
  appName: string;
  isWhatsApp: boolean;
  sender: string;
  body: string;
  arrivalTimeMs: number;
}

interface SqliteStatement {
  all: () => ReadonlyArray<Record<string, unknown>>;
}

interface SqliteDatabase {
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
}

interface NodeSqliteModule {
  DatabaseSync: new (location: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

let cachedSqliteModule: NodeSqliteModule | null | undefined = undefined;

async function loadNodeSqlite(): Promise<NodeSqliteModule | null> {
  if (cachedSqliteModule !== undefined) {
    return cachedSqliteModule;
  }
  try {
    const modName = "node:sqlite";
    const mod = (await import(modName)) as unknown as Partial<NodeSqliteModule>;
    if (typeof mod.DatabaseSync === "function") {
      cachedSqliteModule = { DatabaseSync: mod.DatabaseSync };
      return cachedSqliteModule;
    }
  } catch {
    // Node < 22.5 tidak memiliki node:sqlite bawaan
  }
  cachedSqliteModule = null;
  return null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .trim();
}

function parseToastXml(xml: string): { sender: string; body: string } | null {
  const matches: string[] = [];
  const regex = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    const decoded = decodeXmlEntities(m[1] ?? "");
    if (decoded.length > 0) {
      matches.push(decoded);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  const sender = matches[0] ?? "Notifikasi";
  const body = matches.slice(1).join(" — ") || sender;
  return { sender, body };
}

function resolveFriendlyApp(appId: string): { appName: string; isWhatsApp: boolean } {
  const lower = appId.toLowerCase();
  if (lower.includes("whatsapp")) {
    return { appName: "WhatsApp", isWhatsApp: true };
  }
  if (lower.includes("telegram")) {
    return { appName: "Telegram", isWhatsApp: false };
  }
  if (lower.includes("discord")) {
    return { appName: "Discord", isWhatsApp: false };
  }
  if (lower.includes("teams")) {
    return { appName: "Microsoft Teams", isWhatsApp: false };
  }
  if (lower.includes("outlook") || lower.includes("mail")) {
    return { appName: "Mail / Outlook", isWhatsApp: false };
  }
  if (lower.includes("chrome")) {
    return { appName: "Google Chrome", isWhatsApp: false };
  }
  if (lower.includes("msedge") || lower.includes("edge")) {
    return { appName: "Microsoft Edge", isWhatsApp: false };
  }
  if (lower.includes("spotify")) {
    return { appName: "Spotify", isWhatsApp: false };
  }
  if (lower.includes("slack")) {
    return { appName: "Slack", isWhatsApp: false };
  }

  // Ambil segmen nama aplikasi yang paling bersih dari AppUserModelId
  const cleaned = appId.split("!").pop() ?? appId;
  const short = cleaned.split(".").pop() ?? cleaned;
  return {
    appName: short.slice(0, 22) || "Windows",
    isWhatsApp: false,
  };
}

function filetimeToUnixMs(rawTime: unknown): number {
  const num = typeof rawTime === "bigint" ? Number(rawTime) : Number(rawTime);
  if (!Number.isFinite(num) || num <= 0) {
    return Date.now();
  }
  // Windows FILETIME (100-nanosecond intervals since 1601-01-01) -> Unix epoch ms
  const unixMs = Math.floor(num / 10_000 - 11_644_473_600_000);
  return unixMs > 946_684_800_000 ? unixMs : Date.now();
}

/**
 * Membaca daftar notifikasi terbaru (WhatsApp Desktop & aplikasi Windows 11 lainnya)
 * secara READ-ONLY dari wpndatabase.db milik Windows Notification Center.
 */
export async function pollWindowsNotifications(limit = 20): Promise<{
  supported: boolean;
  items: WindowsNotificationItem[];
}> {
  if (process.platform !== "win32") {
    return { supported: false, items: [] };
  }

  const sqlite = await loadNodeSqlite();
  if (!sqlite) {
    return { supported: false, items: [] };
  }

  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const wpnDir = path.join(localAppData, "Microsoft", "Windows", "Notifications");
  const dbPath = path.join(wpnDir, "wpndatabase.db");

  try {
    await fs.access(dbPath);
  } catch {
    return { supported: false, items: [] };
  }

  let db: SqliteDatabase | null = null;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const stmt = db.prepare(`
      SELECT
        n.Id AS Id,
        n.ArrivalTime AS ArrivalTime,
        COALESCE(h.PrimaryId, '') AS AppId,
        CAST(n.Payload AS TEXT) AS PayloadXml
      FROM Notification n
      LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId
      WHERE n.Type = 'toast'
      ORDER BY n.ArrivalTime DESC
      LIMIT ${safeLimit}
    `);

    const rows = stmt.all();
    const items: WindowsNotificationItem[] = [];

    for (const row of rows) {
      const xml = typeof row.PayloadXml === "string" ? row.PayloadXml : "";
      const parsed = parseToastXml(xml);
      if (!parsed) continue;

      const appId = typeof row.AppId === "string" ? row.AppId : "";
      const { appName, isWhatsApp } = resolveFriendlyApp(appId);
      const id = String(row.Id ?? `${appId}-${row.ArrivalTime ?? Date.now()}`);

      items.push({
        id,
        appId,
        appName,
        isWhatsApp,
        sender: parsed.sender.slice(0, 80),
        body: parsed.body.slice(0, 260),
        arrivalTimeMs: filetimeToUnixMs(row.ArrivalTime),
      });
    }

    return { supported: true, items };
  } catch {
    return { supported: false, items: [] };
  } finally {
    try {
      db?.close();
    } catch {
      // Abaikan error close
    }
  }
}

const WhatsAppReplySchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    phone: z
      .string()
      .regex(/^\d{8,15}$/)
      .optional(),
  })
  .strict();

/**
 * Membuka WhatsApp Desktop dengan teks balasan siap kirim melalui protokol resmi whatsapp://
 * (tanpa cmd.exe -> zero shell injection, 100% aman dan resmi).
 */
export function openWhatsAppReply(input: { text: string; phone?: string }): {
  launched: boolean;
  message: string;
} {
  const parsed = WhatsAppReplySchema.parse(input);
  const query = parsed.phone
    ? `phone=${encodeURIComponent(parsed.phone)}&text=${encodeURIComponent(parsed.text)}`
    : `text=${encodeURIComponent(parsed.text)}`;
  const uri = `whatsapp://send?${query}`;

  if (process.platform === "win32") {
    const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", uri], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }

  return {
    launched: true,
    message: "WhatsApp Desktop dibuka dengan draf balasan siap kirim.",
  };
}
