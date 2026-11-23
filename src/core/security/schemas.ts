import { z } from "zod";

/**
 * Daftar aksi file yang diizinkan secara mutlak.
 * "DELETE" DILARANG KERAS ada di dalam kamus atau skema ini.
 */
export const ALLOWED_FILE_ACTIONS = ["MOVE", "RENAME", "SKIP"] as const;

export const AiActionTypeSchema = z.enum(ALLOWED_FILE_ACTIONS);
export type AiActionType = z.infer<typeof AiActionTypeSchema>;

/**
 * Skema output JSON yang wajib dipatuhi AI (dikunci ganda oleh GBNF Grammar + Zod).
 */
export const AiFileSuggestionSchema = z
  .object({
    action: AiActionTypeSchema,
    category: z.string().min(1).max(64).nullable().optional(),
    suggestedFileName: z.string().min(1).max(160).nullable().optional(),
    reason: z.string().min(1).max(300),
  })
  .strict();

export type AiFileSuggestion = z.infer<typeof AiFileSuggestionSchema>;

/**
 * Skema filter pencarian lokal dari Natural Language Search.
 */
export const SearchFilterSchema = z
  .object({
    extension: z
      .string()
      .regex(/^\.?[a-zA-Z0-9]{1,12}$/)
      .nullable(),
    keywords: z.array(z.string().min(1).max(64)).max(10),
    dateRange: z
      .object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      })
      .strict(),
  })
  .strict();

export type SearchFilter = z.infer<typeof SearchFilterSchema>;

/**
 * Proposal operasi sebelum divalidasi oleh SafeExecutor.
 */
export const FileOperationProposalSchema = z
  .object({
    action: AiActionTypeSchema,
    source: z.string().min(1),
    destination: z.string().min(1),
    reason: z.string().min(1).max(300),
    origin: z.enum(["FAST_PATH", "AI_CATEGORIZER", "HYGIENE_QUARANTINE"]),
  })
  .strict();

export type FileOperationProposal = z.infer<typeof FileOperationProposalSchema>;

/**
 * Operasi yang sudah divalidasi dan siap ditampilkan pada Dry-Run Execution Plan.
 */
export const PlannedOperationSchema = z
  .object({
    id: z.string().min(1),
    action: AiActionTypeSchema,
    source: z.string().min(1),
    destination: z.string().min(1),
    reason: z.string().min(1).max(300),
    origin: z.enum(["FAST_PATH", "AI_CATEGORIZER", "HYGIENE_QUARANTINE"]),
    autoRenamed: z.boolean(),
  })
  .strict();

export type PlannedOperation = z.infer<typeof PlannedOperationSchema>;

export const ExecutionPlanSchema = z
  .object({
    planId: z.string().min(1),
    createdAt: z.string().datetime(),
    operations: z.array(PlannedOperationSchema),
    skipped: z.array(
      z
        .object({
          source: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict()
    ),
  })
  .strict();

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

/**
 * Catatan transaksi untuk audit log dan SHA-256 Rollback.
 */
export const TransactionRecordSchema = z
  .object({
    transactionId: z.string().min(1),
    timestamp: z.string().datetime(),
    action: z.enum(["MOVE", "RENAME"]),
    source: z.string().min(1),
    destination: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().min(1).max(300),
    rolledBackAt: z.string().datetime().optional(),
  })
  .strict();

export type TransactionRecord = z.infer<typeof TransactionRecordSchema>;
export const TransactionHistorySchema = z.array(TransactionRecordSchema);
