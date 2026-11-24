import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import * as ort from "onnxruntime-node";
import { z } from "zod";
import { HUMAN_VOICE_PRESETS, HumanConversationalTtsClient, type HumanVoicePresetId } from "./human-tts.js";
import {
  checkVoiceEngineInstalled,
  ensureVoiceEngineDownloaded,
  getVoiceEnginePaths,
  type VoiceSetupProgress,
} from "./voice-downloader.js";
import {
  computeOpenVoiceSpectrogram,
  decodeWavBuffer,
  encodeWav16Bit,
  OPENVOICE_FREQ_BINS,
  OPENVOICE_SAMPLE_RATE,
  prepareReferenceVoiceSamples,
  resampleAudio,
} from "./wav-dsp.js";

export type TtsModeOption =
  | "ava_hd"
  | "andrew_hd"
  | "gadis_hd"
  | "ardi_hd"
  | "natural"
  | "clone"
  | "piper"
  | "system";

const StoredVoiceProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{3,48}$/),
    name: z.string().min(1).max(48),
    createdAt: z.string(),
    durationSec: z.number().positive(),
    embedding: z.array(z.number()).length(256),
  })
  .strict();

export type StoredVoiceProfile = z.infer<typeof StoredVoiceProfileSchema>;

export interface PublicVoiceProfile {
  id: string;
  name: string;
  createdAt: string;
  durationSec: number;
}

export interface VoiceStatusSummary {
  piperReady: boolean;
  openVoiceReady: boolean;
  fullyReady: boolean;
  ttsMode: TtsModeOption;
  activeProfileId: string | null;
  speed: number;
  profiles: PublicVoiceProfile[];
  activeSetup: VoiceSetupProgress | null;
}

/**
 * Membersihkan simbol tulisan/markdown agar saat diucapkan terdengar alami seperti lisan manusia
 * (tanpa membaca angka poin "1.", bintang markdown, atau simbol kode).
 */
export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " Berikut kodenya. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[[A-Z_]+:[^\]]*\]/g, " ")
    .replace(/<write_file[\s\S]*?<\/write_file>/gi, " Filenya sudah kusimpan. ")
    .replace(/(?:^|\n)\s*\d+[.)]\s+/g, ". ")
    .replace(/(?:^|\n)\s*[-•*]\s+/g, ", ")
    .replace(/https?:\/\/\S+/g, " tautan web ")
    .replace(/%/g, " persen ")
    .replace(/[#>_~|]/g, " ")
    .replace(/\s*\.\s*\./g, ".")
    .replace(/\s+/g, " ")
    .replace(/^[.,;\s]+/, "")
    .trim()
    .slice(0, 950);
}

/**
 * Memecah teks HANYA pada batas kalimat utuh (., !, ?) — TIDAK memotong di tanda koma (,)
 * agar alunan napas dan naik-turun intonasi kalimat terdengar natural seperti manusia berbicara!
 */
export function splitTextIntoRealtimeSpeechClauses(rawText: string): string[] {
  const cleaned = cleanTextForSpeech(rawText);
  if (!cleaned) return [];

  const clauses: string[] = [];
  let buffer = "";

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    buffer += ch;
    const nextCh = cleaned[i + 1] ?? " ";
    const minLen = clauses.length === 0 ? 16 : 36;

    const isSentenceEnd = (ch === "." || ch === "!" || ch === "?") && /\s/.test(nextCh);
    const isVeryLongSemi = (ch === ";" || ch === ":") && /\s/.test(nextCh) && buffer.trim().length >= 110;

    if ((isSentenceEnd && buffer.trim().length >= minLen) || isVeryLongSemi) {
      clauses.push(buffer.trim());
      buffer = "";
    }
  }

  if (buffer.trim().length > 0) {
    if (clauses.length > 0 && buffer.trim().length < 12) {
      clauses[clauses.length - 1] = `${clauses[clauses.length - 1]} ${buffer.trim()}`;
    } else {
      clauses.push(buffer.trim());
    }
  }

  return clauses;
}

/**
 * Akumulator streaming token -> hanya memotong pada akhir kalimat utuh (., !, ?, \n)
 * sehingga prosodi & intonasi suara mengalir mulus tanpa terputus kaku di tengah kalimat!
 */
export class StreamingSpeechClauseAccumulator {
  private buffer = "";
  private insideCodeFence = false;
  private emittedCount = 0;
  private readonly onClause: (clause: string) => void;

  constructor(onClause: (clause: string) => void) {
    this.onClause = onClause;
  }

  public pushTokenChunk(chunk: string): void {
    this.buffer += chunk;

    while (this.buffer.includes("```")) {
      const idx = this.buffer.indexOf("```");
      if (!this.insideCodeFence) {
        const before = this.buffer.slice(0, idx).trim();
        if (before.length >= 4) {
          this.emitClean(before);
        }
        this.buffer = this.buffer.slice(idx + 3);
        this.insideCodeFence = true;
      } else {
        this.buffer = this.buffer.slice(idx + 3);
        this.insideCodeFence = false;
      }
    }

    if (this.insideCodeFence) {
      return;
    }

    const minSentenceLen = this.emittedCount === 0 ? 16 : 36;
    let cutIdx = -1;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      const ch = this.buffer[i]!;
      const next = this.buffer[i + 1]!;
      if (ch === "\n" && i >= minSentenceLen) {
        cutIdx = i + 1;
        break;
      }
      if ((ch === "." || ch === "!" || ch === "?") && /\s/.test(next) && i >= minSentenceLen) {
        cutIdx = i + 1;
        break;
      }
      if ((ch === ";" || ch === ":") && /\s/.test(next) && i >= 115) {
        cutIdx = i + 1;
        break;
      }
    }

    if (cutIdx > 0) {
      const candidate = this.buffer.slice(0, cutIdx);
      this.buffer = this.buffer.slice(cutIdx);
      this.emitClean(candidate);
    }
  }

  public flush(): void {
    if (!this.insideCodeFence && this.buffer.trim().length > 0) {
      this.emitClean(this.buffer);
    }
    this.buffer = "";
  }

  private emitClean(raw: string): void {
    const cleaned = cleanTextForSpeech(raw);
    if (cleaned.length >= 2) {
      this.emittedCount += 1;
      this.onClause(cleaned);
    }
  }
}

interface HotPiperDaemon {
  child: ChildProcessWithoutNullStreams;
  rl: readline.Interface;
  lengthScale: string;
}

function mapModeToHumanPreset(mode: TtsModeOption): HumanVoicePresetId | null {
  if (mode === "ava_hd" || mode === "natural") return "ava_hd";
  if (mode === "andrew_hd") return "andrew_hd";
  if (mode === "gadis_hd") return "gadis_hd";
  if (mode === "ardi_hd") return "ardi_hd";
  return null;
}

export class OfflineVoiceCloneEngine {
  private modelsDir: string;
  private threads: number;
  private readonly humanTts = new HumanConversationalTtsClient();
  private extractSession: ort.InferenceSession | null = null;
  private colorSession: ort.InferenceSession | null = null;
  private cachedBaseEmbeddings = new Map<string, Float32Array>();
  private cachedTargetProfiles = new Map<string, Float32Array>();
  private hotPiper: HotPiperDaemon | null = null;
  private piperJobChain: Promise<unknown> = Promise.resolve();
  private activeSetup: VoiceSetupProgress | null = null;
  private setupPromise: Promise<void> | null = null;
  private warmupPromise: Promise<void> | null = null;

  constructor(options: { modelsDir: string; threads?: number }) {
    this.modelsDir = path.resolve(options.modelsDir);
    this.threads = Math.min(8, Math.max(4, options.threads ?? 6));
  }

  public updateOptions(options: { modelsDir: string; threads: number }): void {
    const nextDir = path.resolve(options.modelsDir);
    const nextThreads = Math.min(8, Math.max(4, options.threads));
    if (nextDir !== this.modelsDir || nextThreads !== this.threads) {
      this.modelsDir = nextDir;
      this.threads = nextThreads;
      this.extractSession = null;
      this.colorSession = null;
      this.cachedBaseEmbeddings.clear();
      this.cachedTargetProfiles.clear();
      this.disposeHotPiper();
    }
  }

  public disposeHotPiper(): void {
    this.humanTts.dispose();
    if (this.hotPiper) {
      try {
        this.hotPiper.rl.close();
        this.hotPiper.child.kill();
      } catch {
        // Abaikan
      }
      this.hotPiper = null;
    }
  }

  public async warmupEngine(activeProfileId?: string): Promise<void> {
    if (this.warmupPromise) return this.warmupPromise;

    this.warmupPromise = (async () => {
      try {
        const installed = await checkVoiceEngineInstalled(this.modelsDir);
        if (!installed.piperReady) return;

        const warmBuf = await this.synthesizeBasePiperWav("siap", 1.03);

        if (installed.openVoiceReady) {
          const session = await this.ensureColorSession();
          const decoded = decodeWavBuffer(warmBuf);
          const samples22k = resampleAudio(decoded.samples, decoded.sampleRate, OPENVOICE_SAMPLE_RATE);
          const srcVec = await this.getOrExtractBaseEmbedding("piper_base_se", samples22k);
          if (activeProfileId) {
            await this.getTargetEmbeddingCached(activeProfileId).catch(() => {});
          }
          const dummyFrames = 32;
          const specT = new ort.Tensor("float32", new Float32Array(OPENVOICE_FREQ_BINS * dummyFrames), [
            1,
            OPENVOICE_FREQ_BINS,
            dummyFrames,
          ]);
          const lenT = new ort.Tensor("int64", BigInt64Array.from([BigInt(dummyFrames)]), [1]);
          const seT = new ort.Tensor("float32", srcVec, [1, 256, 1]);
          const tauT = new ort.Tensor("float32", Float32Array.from([0.3]), [1]);
          const feeds: Record<string, ort.Tensor> = {};
          for (const name of session.inputNames) {
            const l = name.toLowerCase();
            if (l.includes("len")) feeds[name] = lenT;
            else if (l.includes("src") || l.includes("source") || l.includes("dest") || l.includes("target"))
              feeds[name] = seT;
            else if (l === "tau") feeds[name] = tauT;
            else feeds[name] = specT;
          }
          await session.run(feeds);
        }
      } catch {
        // Abaikan kendala pre-warm latar belakang
      } finally {
        this.warmupPromise = null;
      }
    })();

    return this.warmupPromise;
  }

  public getActiveSetup(): VoiceSetupProgress | null {
    return this.activeSetup;
  }

  public async getStatus(voiceConfig: {
    ttsMode: TtsModeOption;
    activeProfileId?: string | undefined;
    speed: number;
  }): Promise<VoiceStatusSummary> {
    const [installed, profiles] = await Promise.all([
      checkVoiceEngineInstalled(this.modelsDir),
      this.listProfiles(),
    ]);

    const normalizedMode: TtsModeOption =
      voiceConfig.ttsMode === "natural" ? "ava_hd" : voiceConfig.ttsMode;

    return {
      ...installed,
      ttsMode: normalizedMode,
      activeProfileId: voiceConfig.activeProfileId ?? (profiles[0]?.id ?? null),
      speed: voiceConfig.speed,
      profiles,
      activeSetup: this.activeSetup,
    };
  }

  public startBackgroundSetup(): VoiceSetupProgress {
    if (this.setupPromise && this.activeSetup && this.activeSetup.status !== "error") {
      return this.activeSetup;
    }

    this.activeSetup = {
      stage: "Memulai pengunduhan mesin suara offline...",
      downloadedBytes: 0,
      totalBytes: 198 * 1024 * 1024,
      percent: 0,
      status: "downloading",
    };

    this.setupPromise = ensureVoiceEngineDownloaded(this.modelsDir, (prog) => {
      this.activeSetup = prog;
    })
      .then(() => {
        this.activeSetup = {
          stage: "Mesin Voice Clone Offline siap digunakan",
          downloadedBytes: 198 * 1024 * 1024,
          totalBytes: 198 * 1024 * 1024,
          percent: 100,
          status: "done",
        };
        void this.warmupEngine();
        setTimeout(() => {
          if (this.activeSetup?.status === "done") {
            this.activeSetup = null;
          }
        }, 5000);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.activeSetup = {
          stage: "Gagal mengunduh mesin suara",
          downloadedBytes: 0,
          totalBytes: null,
          percent: null,
          status: "error",
          error: msg,
        };
      })
      .finally(() => {
        this.setupPromise = null;
      });

    return this.activeSetup;
  }

  public async listProfiles(): Promise<PublicVoiceProfile[]> {
    const { profilesDir } = getVoiceEnginePaths(this.modelsDir);
    try {
      const entries = await fsp.readdir(profilesDir, { withFileTypes: true });
      const profiles: PublicVoiceProfile[] = [];
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          !entry.name.endsWith(".json") ||
          entry.name.startsWith("piper_base_") ||
          entry.name.startsWith("human_base_")
        ) {
          continue;
        }
        try {
          const raw = await fsp.readFile(path.join(profilesDir, entry.name), "utf8");
          const parsed = StoredVoiceProfileSchema.safeParse(JSON.parse(raw));
          if (parsed.success) {
            profiles.push({
              id: parsed.data.id,
              name: parsed.data.name,
              createdAt: parsed.data.createdAt,
              durationSec: parsed.data.durationSec,
            });
          }
        } catch {
          // Lewati profil korup
        }
      }
      profiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return profiles;
    } catch {
      return [];
    }
  }

  private async getTargetEmbeddingCached(profileId: string): Promise<Float32Array> {
    const cached = this.cachedTargetProfiles.get(profileId);
    if (cached) return cached;

    if (!/^[a-z0-9_-]{3,48}$/.test(profileId)) {
      throw new Error("ID profil suara tidak valid.");
    }
    const { profilesDir } = getVoiceEnginePaths(this.modelsDir);
    const jsonPath = path.join(profilesDir, `${profileId}.json`);
    const raw = await fsp.readFile(jsonPath, "utf8");
    const parsed = StoredVoiceProfileSchema.parse(JSON.parse(raw));
    const vec = Float32Array.from(parsed.embedding);
    this.cachedTargetProfiles.set(profileId, vec);
    return vec;
  }

  public async deleteProfile(profileId: string): Promise<void> {
    if (!/^[a-z0-9_-]{3,48}$/.test(profileId)) {
      throw new Error("ID profil suara tidak valid.");
    }
    this.cachedTargetProfiles.delete(profileId);
    const { profilesDir } = getVoiceEnginePaths(this.modelsDir);
    await Promise.all([
      fsp.rm(path.join(profilesDir, `${profileId}.json`), { force: true }),
      fsp.rm(path.join(profilesDir, `${profileId}.wav`), { force: true }),
    ]);
  }

  private async ensureExtractSession(): Promise<ort.InferenceSession> {
    if (this.extractSession) return this.extractSession;
    const paths = getVoiceEnginePaths(this.modelsDir);
    this.extractSession = await ort.InferenceSession.create(paths.toneExtractPath, {
      executionProviders: ["cpu"],
      intraOpNumThreads: this.threads,
      interOpNumThreads: 1,
      graphOptimizationLevel: "all",
    });
    return this.extractSession;
  }

  private async ensureColorSession(): Promise<ort.InferenceSession> {
    if (this.colorSession) return this.colorSession;
    const paths = getVoiceEnginePaths(this.modelsDir);
    this.colorSession = await ort.InferenceSession.create(paths.toneColorPath, {
      executionProviders: ["cpu"],
      intraOpNumThreads: this.threads,
      interOpNumThreads: 1,
      graphOptimizationLevel: "all",
    });
    return this.colorSession;
  }

  private async extractToneEmbedding(samples22k: Float32Array): Promise<Float32Array> {
    const session = await this.ensureExtractSession();
    const spec = computeOpenVoiceSpectrogram(samples22k);
    const inputName = session.inputNames[0] ?? "input";
    const inputTensor = new ort.Tensor("float32", spec.timeFirst, [1, spec.frames, OPENVOICE_FREQ_BINS]);

    const outputMap = await session.run({ [inputName]: inputTensor });
    const outputName = session.outputNames[0];
    const outTensor = outputName ? outputMap[outputName] : undefined;
    if (!outTensor || !(outTensor.data instanceof Float32Array) || outTensor.data.length < 256) {
      throw new Error("Output tensor tone_extract.onnx tidak valid.");
    }

    const vec = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      vec[i] = outTensor.data[i]!;
    }
    return vec;
  }

  public async createProfileFromWavBase64(name: string, wavBase64: string): Promise<PublicVoiceProfile> {
    const cleanName = name.trim().slice(0, 40) || "Suara Custom";
    const installed = await checkVoiceEngineInstalled(this.modelsDir);
    if (!installed.openVoiceReady) {
      throw new Error("Mesin OpenVoice ONNX belum terpasang. Klik 'Unduh Mesin Suara' terlebih dahulu.");
    }

    const stripped = wavBase64.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "");
    const wavBuffer = Buffer.from(stripped, "base64");
    if (wavBuffer.byteLength > 25 * 1024 * 1024) {
      throw new Error("Ukuran file sampel WAV maksimal 25 MB.");
    }

    const decoded = decodeWavBuffer(wavBuffer);
    const { samples22k, durationSec } = prepareReferenceVoiceSamples(decoded.samples, decoded.sampleRate);
    const embeddingVec = await this.extractToneEmbedding(samples22k);

    const id = `voice_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
    const createdAt = new Date().toISOString();
    const { profilesDir } = getVoiceEnginePaths(this.modelsDir);
    await fsp.mkdir(profilesDir, { recursive: true });

    const profileData: StoredVoiceProfile = {
      id,
      name: cleanName,
      createdAt,
      durationSec,
      embedding: Array.from(embeddingVec),
    };

    const normalizedWav = encodeWav16Bit(samples22k, OPENVOICE_SAMPLE_RATE);
    await Promise.all([
      fsp.writeFile(path.join(profilesDir, `${id}.json`), JSON.stringify(profileData, null, 2), "utf8"),
      fsp.writeFile(path.join(profilesDir, `${id}.wav`), normalizedWav),
    ]);

    this.cachedTargetProfiles.set(id, embeddingVec);
    void this.warmupEngine(id);

    return {
      id,
      name: cleanName,
      createdAt,
      durationSec,
    };
  }

  private ensureHotPiperDaemon(lengthScale: string): HotPiperDaemon {
    if (
      this.hotPiper &&
      this.hotPiper.lengthScale === lengthScale &&
      this.hotPiper.child.exitCode === null &&
      !this.hotPiper.child.killed
    ) {
      return this.hotPiper;
    }

    this.disposeHotPiper();
    const paths = getVoiceEnginePaths(this.modelsDir);
    // Parameter prosodi ekspresif (--noise_scale 0.78 --noise_w 0.90) mengurangi kesan datar/monoton saat full offline
    const child = spawn(
      paths.piperExePath,
      [
        "--model",
        paths.piperModelPath,
        "--config",
        paths.piperConfigPath,
        "--length_scale",
        lengthScale,
        "--noise_scale",
        "0.78",
        "--noise_w",
        "0.90",
        "--sentence_silence",
        "0.12",
        "--json-input",
      ],
      {
        cwd: paths.piperDir,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    child.on("exit", () => {
      if (this.hotPiper?.child === child) {
        this.hotPiper = null;
      }
    });

    const rl = readline.createInterface({ input: child.stdout });
    this.hotPiper = { child, rl, lengthScale };
    return this.hotPiper;
  }

  private synthesizeBasePiperWav(text: string, speed: number): Promise<Buffer> {
    const clampedSpeed = Math.min(1.6, Math.max(0.65, speed));
    const lengthScale = (1 / clampedSpeed).toFixed(3);

    const runJob = async (): Promise<Buffer> => {
      const tempOutPath = path.join(
        os.tmpdir(),
        `aiku_hot_piper_${process.pid}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.wav`
      );
      const daemon = this.ensureHotPiperDaemon(lengthScale);

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.disposeHotPiper();
            reject(new Error("Waktu sintesis Piper habis (timeout 12s)."));
          }, 12_000);

          const onLine = (): void => {
            clearTimeout(timer);
            daemon.child.off("exit", onUnexpectedExit);
            resolve();
          };

          const onUnexpectedExit = (code: number | null): void => {
            clearTimeout(timer);
            daemon.rl.off("line", onLine);
            reject(new Error(`Proses Piper tertutup tak terduga (kode ${code}).`));
          };

          daemon.rl.once("line", onLine);
          daemon.child.once("exit", onUnexpectedExit);
          daemon.child.stdin.write(`${JSON.stringify({ text, output_file: tempOutPath })}\n`, "utf8");
        });

        return await fsp.readFile(tempOutPath);
      } finally {
        void fsp.rm(tempOutPath, { force: true }).catch(() => {});
      }
    };

    const queued = this.piperJobChain.then(runJob, runJob);
    this.piperJobChain = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  private async getOrExtractBaseEmbedding(cacheKey: string, fallbackSamples22k: Float32Array): Promise<Float32Array> {
    const mem = this.cachedBaseEmbeddings.get(cacheKey);
    if (mem) return mem;

    const { profilesDir } = getVoiceEnginePaths(this.modelsDir);
    const cacheFile = path.join(profilesDir, `${cacheKey}.json`);

    try {
      const raw = await fsp.readFile(cacheFile, "utf8");
      const arr = z.array(z.number()).length(256).parse(JSON.parse(raw));
      const vec = Float32Array.from(arr);
      this.cachedBaseEmbeddings.set(cacheKey, vec);
      return vec;
    } catch {
      let refSamples = fallbackSamples22k;
      if (refSamples.length < OPENVOICE_SAMPLE_RATE * 1.8) {
        if (cacheKey === "piper_base_se") {
          const calibWav = await this.synthesizeBasePiperWav(
            "Halo, selamat datang di asisten pribadi aiKu yang siap menemani dan membantu aktivitas kamu.",
            1.0
          );
          const decoded = decodeWavBuffer(calibWav);
          refSamples = resampleAudio(decoded.samples, decoded.sampleRate, OPENVOICE_SAMPLE_RATE);
        } else if (cacheKey === "human_base_andrew_hd") {
          const calibHuman = await this.humanTts.synthesize24k({
            text: "Halo, selamat datang di asisten pribadi aiKu yang siap menemani dan membantu aktivitas kamu setiap hari.",
            presetId: "andrew_hd",
            speed: 1.0,
          });
          refSamples = resampleAudio(calibHuman.samples24k, calibHuman.sampleRate, OPENVOICE_SAMPLE_RATE);
        }
      }

      const vec = await this.extractToneEmbedding(refSamples);
      this.cachedBaseEmbeddings.set(cacheKey, vec);
      try {
        await fsp.mkdir(profilesDir, { recursive: true });
        await fsp.writeFile(cacheFile, JSON.stringify(Array.from(vec)), "utf8");
      } catch {
        // Abaikan
      }
      return vec;
    }
  }

  private async convertVoiceToneColor(
    sourceSamples22k: Float32Array,
    srcEmbedding: Float32Array,
    destEmbedding: Float32Array,
    tau: number = 0.25
  ): Promise<Float32Array> {
    const session = await this.ensureColorSession();
    const spec = computeOpenVoiceSpectrogram(sourceSamples22k);

    const specTensor = new ort.Tensor("float32", spec.freqFirst, [1, OPENVOICE_FREQ_BINS, spec.frames]);
    const lenTensor = new ort.Tensor("int64", BigInt64Array.from([BigInt(spec.frames)]), [1]);
    const srcTensor = new ort.Tensor("float32", srcEmbedding, [1, 256, 1]);
    const dstTensor = new ort.Tensor("float32", destEmbedding, [1, 256, 1]);
    const tauTensor = new ort.Tensor("float32", Float32Array.from([tau]), [1]);

    const feeds: Record<string, ort.Tensor> = {};
    for (const inputName of session.inputNames) {
      const lower = inputName.toLowerCase();
      if (lower.includes("len")) {
        feeds[inputName] = lenTensor;
      } else if (lower.includes("src") || lower.includes("source")) {
        feeds[inputName] = srcTensor;
      } else if (lower.includes("dest") || lower.includes("dst") || lower.includes("target") || lower.includes("tgt")) {
        feeds[inputName] = dstTensor;
      } else if (lower === "tau") {
        feeds[inputName] = tauTensor;
      } else {
        feeds[inputName] = specTensor;
      }
    }

    const outputs = await session.run(feeds);
    const outName = session.outputNames[0];
    const outTensor = outName ? outputs[outName] : undefined;
    if (!outTensor || !(outTensor.data instanceof Float32Array) || outTensor.data.length === 0) {
      throw new Error("Output gelombang suara dari tone_color.onnx kosong.");
    }

    return outTensor.data;
  }

  /**
   * Sintesis utama:
   * - Mode "ava_hd" | "andrew_hd" | "gadis_hd" | "ardi_hd" | "natural": Suara Percakapan Manusia 24kHz HD (fallback otomatis ke Piper jika internet mati!)
   * - Mode "clone": Menggabungkan Intonasi Napas Manusia 24kHz HD + Warna Suara Clone Pengguna via OpenVoice V2 ONNX (fallback otomatis ke Piper + OpenVoice saat full offline!)
   * - Mode "piper": 100% Piper Offline Murni
   */
  public async synthesizeToWavBase64(options: {
    text: string;
    mode: TtsModeOption;
    profileId?: string | undefined;
    speed?: number | undefined;
  }): Promise<{ wavBase64: string; usedMode: string; latencyMs: number }> {
    const t0 = performance.now();
    const cleanedText = cleanTextForSpeech(options.text);
    if (!cleanedText) {
      throw new Error("Teks kosong setelah pembersihan simbol.");
    }

    const speed = options.speed ?? 1.03;
    const humanPreset = mapModeToHumanPreset(options.mode);

    // 1. Mode Suara Percakapan Manusia HD (24kHz 96kbps Conversational Prosody)
    if (humanPreset !== null) {
      try {
        const mp3Buffer = await this.humanTts.synthesizeMp3Buffer({
          text: cleanedText,
          presetId: humanPreset,
          speed,
        });
        return {
          wavBase64: mp3Buffer.toString("base64"),
          usedMode: humanPreset,
          latencyMs: Math.round(performance.now() - t0),
        };
      } catch {
        // Jika laptop sedang 100% offline tanpa Wi-Fi, otomatis fallback ke Piper lokal jika tersedia
        const installed = await checkVoiceEngineInstalled(this.modelsDir);
        if (installed.piperReady) {
          const fallbackWav = await this.synthesizeBasePiperWav(cleanedText, speed);
          return {
            wavBase64: fallbackWav.toString("base64"),
            usedMode: "piper_fallback",
            latencyMs: Math.round(performance.now() - t0),
          };
        }
        throw new Error("Koneksi suara HD tidak tersedia dan mesin Piper offline belum terpasang.");
      }
    }

    const installed = await checkVoiceEngineInstalled(this.modelsDir);

    // 2. Mode Custom Voice Clone: gunakan intonasi bicara manusia HD ("andrew_hd" yang natural) sebagai prosodi sumber,
    //    lalu ubah warna suaranya ke suara pengguna dengan OpenVoice V2 lokal! (Otomatis pakai Piper saat full offline)
    if (options.mode === "clone" && options.profileId && installed.openVoiceReady) {
      const destEmbedding = await this.getTargetEmbeddingCached(options.profileId);

      try {
        const humanSource = await this.humanTts.synthesize24k({
          text: cleanedText,
          presetId: "andrew_hd",
          speed,
        });
        const sourceSamples22k = resampleAudio(humanSource.samples24k, humanSource.sampleRate, OPENVOICE_SAMPLE_RATE);
        const srcEmbedding = await this.getOrExtractBaseEmbedding("human_base_andrew_hd", sourceSamples22k);
        const converted = await this.convertVoiceToneColor(sourceSamples22k, srcEmbedding, destEmbedding, 0.25);
        const finalWav = encodeWav16Bit(converted, OPENVOICE_SAMPLE_RATE);
        return {
          wavBase64: finalWav.toString("base64"),
          usedMode: "clone_human_prosody",
          latencyMs: Math.round(performance.now() - t0),
        };
      } catch {
        // Offline fallback: Piper lokal + OpenVoice V2
        if (!installed.piperReady) {
          throw new Error("Mesin Piper belum terpasang untuk mode offline.");
        }
        const basePiperWav = await this.synthesizeBasePiperWav(cleanedText, speed);
        const decodedBase = decodeWavBuffer(basePiperWav);
        const baseSamples22k = resampleAudio(decodedBase.samples, decodedBase.sampleRate, OPENVOICE_SAMPLE_RATE);
        const srcEmbedding = await this.getOrExtractBaseEmbedding("piper_base_se", baseSamples22k);
        const converted = await this.convertVoiceToneColor(baseSamples22k, srcEmbedding, destEmbedding, 0.25);
        const finalWav = encodeWav16Bit(converted, OPENVOICE_SAMPLE_RATE);
        return {
          wavBase64: finalWav.toString("base64"),
          usedMode: "clone_offline_piper",
          latencyMs: Math.round(performance.now() - t0),
        };
      }
    }

    // 3. Mode Piper Offline Murni
    if (!installed.piperReady) {
      throw new Error("Mesin Piper Indonesia belum terpasang. Unduh di tab Voice Clone terlebih dahulu.");
    }
    const basePiperWav = await this.synthesizeBasePiperWav(cleanedText, speed);
    return {
      wavBase64: basePiperWav.toString("base64"),
      usedMode: "piper",
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}

export { HUMAN_VOICE_PRESETS };
