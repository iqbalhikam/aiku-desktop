import fs from "node:fs/promises";
import path from "node:path";
import { type TransactionRecord, TransactionHistorySchema } from "./schemas.js";

export class TransactionLog {
  private readonly logFilePath: string;

  constructor(logFilePath: string) {
    this.logFilePath = path.resolve(logFilePath);
  }

  public getLogFilePath(): string {
    return this.logFilePath;
  }

  public async readAll(): Promise<TransactionRecord[]> {
    try {
      const raw = await fs.readFile(this.logFilePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      return TransactionHistorySchema.parse(parsed);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
  }

  public async append(record: TransactionRecord): Promise<void> {
    const records = await this.readAll();
    records.push(record);
    await this.writeAllAtomic(records);
  }

  public async findById(transactionId: string): Promise<TransactionRecord | undefined> {
    const records = await this.readAll();
    return records.find((item) => item.transactionId === transactionId);
  }

  public async markRolledBack(transactionId: string, rolledBackAt: string): Promise<void> {
    const records = await this.readAll();
    const updated = records.map((item) =>
      item.transactionId === transactionId ? { ...item, rolledBackAt } : item
    );
    await this.writeAllAtomic(updated);
  }

  private async writeAllAtomic(records: readonly TransactionRecord[]): Promise<void> {
    const dir = path.dirname(this.logFilePath);
    await fs.mkdir(dir, { recursive: true });

    const tempPath = `${this.logFilePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(records, null, 2) + "\n", "utf8");
    await fs.rename(tempPath, this.logFilePath);
  }
}
