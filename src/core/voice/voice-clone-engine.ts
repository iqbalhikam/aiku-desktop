import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as ort from "onnxruntime-node";
import { z } from "zod";
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
  ttsMode: "system" | "piper" | "clone";
  activeProfileId: string | null;
  speed: number;
  profiles: PublicVoiceProfile[];
  activeSetup: VoiceSetupProgress | null;
}

export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[[A-Z_]+:[^\]]*\]/g, " ")
    .replace(/https?:\/\/\S+/g, " tautan web ")
    .replace(/%/g, " persen ")
    .replace(/[#>_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

export class OfflineVoiceCloneEngine {
  private modelsDir: string;
  private threads: number;
  private extractSession: ort.InferenceSession | null = null;
  private colorSession: ort.InferenceSession | null = null;
  private cachedBasePiperEmbedding: Float32Array | null = null;
  private activeSetup: VoiceSetupProgress | null = null;
  private setupPromise: Promise<void> | null = null;

  constructor(options: { modelsDir: string; threads?: number }) {
    this.modelsDir = path.resolve(options.modelsDir);
    this.threads = Math.min(4, Math.max(1, options.threads ?? 4));
  }

  public updateOptions(options: { modelsDir: string; threads: number }): void {
    const nextDir = path.resolve(options.modelsDir);
    const nextThreads = Math.min(4, Math.max(1, options.threads));
    if (nextDir !== this.modelsDir || nextThreads !== this.threads) {
      this.modelsDir = nextDir;
      this.threads = nextThreads;
      this.extractSession = null;
      this.colorSession = null;
      this.cachedBasePiperEmbedding = null;
    }
  }

  public getActiveSetup(): VoiceSetupProgress | null {
    return this.activeSetup;
  }

  public async getStatus(voiceConfig: {
    ttsMode: "system" | "piper" | "clone";
    activeProfileId?: string | undefined;
    speed: number;
  }): Promise<VoiceStatusSummary> {
    const [installed, profiles] = await Promise.all([
      checkVoiceEngineInstalled(this.modelsDir),
      this.listProfiles(),
    ]);

    return {
      ...installed,
      ttsMode: voiceConfig.ttsMode,
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
        if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "piper_base_se.json") {
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
          // Lewati file profil korup
        }
      }
      profiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return profiles;
    } catch {
      return [];
    }
  }

  private async loadProfileWithEmbedding(profileId: string): Promise<StoredVoiceProfile> {
    if (!/^[a-z0-9_-]{3,48}$/.test(profileId)) {
      throw new Error("ID profil suara tidak valid.");
    }
    const { profilesDir } = getVoiceEnginePaths(this.modelsDir);
    const jsonPath = path.join(profilesDir, `${profileId}.json`);
    const raw = await fsp.readFile(jsonPath, "utf8");
    return StoredVoiceProfileSchema.parse(JSON.parse(raw));
  }

  public async deleteProfile(profileId: string): Promise<void> {
    if (!/^[a-z0-9_-]{3,48}$/.test(profileId)) {
      throw new Error("ID profil suara tidak valid.");
    }
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

  /**
   * Ekstrak vektor warna suara 256-dimensi dari audio 22,050 Hz menggunakan tone_extract.onnx
   */
  private async extractToneEmbedding(samples22k: Float32Array): Promise<Float32Array> {
    const session = await this.ensureExtractSession();
    const spec = computeOpenVoiceSpectrogram(samples22k);
    const inputName = session.inputNames[0] ?? "input";
    const inputTensor = new ort.Tensor("float32", spec.timeFirst, [1, spec.frames, OPENVOICE_FREQ_BINS]);

    const feeds: Record<string, ort.Tensor> = {
      [inputName]: inputTensor,
    };

    const outputMap = await session.run(feeds);
    const outputName = session.outputNames[0];
    const outTensor = outputName ? outputMap[outputName] : undefined;
    if (!outTensor || !(outTensor.data instanceof Float32Array) || outTensor.data.length < 256) {
      throw new Error("Output tensor tone_extract.onnx tidak valid (bukan 256-d float32).");
    }

    const vec = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      vec[i] = outTensor.data[i]!;
    }
    return vec;
  }

  /**
   * Simpan sampel suara pengguna (.wav base64), bersihkan noise/hening, ekstrak embedding 256-d
   */
  public async createProfileFromWavBase64(name: string, wavBase64: string): Promise<PublicVoiceProfile> {
    const cleanName = name.trim().slice(0, 40) || "Suara Custom";
    const installed = await checkVoiceEngineInstalled(this.modelsDir);
    if (!installed.openVoiceReady) {
      throw new Error("Mesin OpenVoice ONNX belum terpasang. Klik 'Unduh Mesin Suara Offline' terlebih dahulu.");
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

    return {
      id,
      name: cleanName,
      createdAt,
      durationSec,
    };
  }

  /**
   * Sintesis suara dasar Bahasa Indonesia via binary lokal Piper (100% offline, shell: false)
   */
  private async synthesizeBasePiperWav(text: string, speed: number): Promise<Buffer> {
    const paths = getVoiceEnginePaths(this.modelsDir);
    const tempOutPath = path.join(
      os.tmpdir(),
      `aiku_piper_${process.pid}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.wav`
    );
    const clampedSpeed = Math.min(1.6, Math.max(0.65, speed));
    const lengthScale = (1 / clampedSpeed).toFixed(3);

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          paths.piperExePath,
          [
            "--model",
            paths.piperModelPath,
            "--config",
            paths.piperConfigPath,
            "--output_file",
            tempOutPath,
            "--length_scale",
            lengthScale,
          ],
          {
            cwd: paths.piperDir,
            shell: false,
            windowsHide: true,
            stdio: ["pipe", "ignore", "pipe"],
          }
        );

        let stderrText = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Waktu sintesis Piper habis (timeout 20s)."));
        }, 20_000);

        child.stderr.on("data", (chunk: Buffer) => {
          stderrText += chunk.toString("utf8");
        });

        child.on("error", (err) => {
          clearTimeout(timer);
          reject(new Error(`Gagal menjalankan Piper TTS: ${err.message}`));
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Piper TTS berhenti dengan kode ${code}: ${stderrText.slice(-240)}`));
          }
        });

        child.stdin.write(`${text}\n`, "utf8");
        child.stdin.end();
      });

      return await fsp.readFile(tempOutPath);
    } finally {
      try {
        await fsp.rm(tempOutPath, { force: true });
      } catch {
        // Abaikan kegagalan hapus file temp
      }
    }
  }

  /**
   * Ambil atau ekstrak sekali embedding speaker dasar Piper agar konversi berikutnya instan
   */
  private async getOrExtractBasePiperEmbedding(piperSamples22k: Float32Array): Promise<Float32Array> {
    if (this.cachedBasePiperEmbedding) {
      return this.cachedBasePiperEmbedding;
    }

    const { profilesDir } = getVoiceEnginePaths(this.modelsDir);
    const cacheFile = path.join(profilesDir, "piper_base_se.json");

    try {
      const raw = await fsp.readFile(cacheFile, "utf8");
      const arr = z.array(z.number()).length(256).parse(JSON.parse(raw));
      this.cachedBasePiperEmbedding = Float32Array.from(arr);
      return this.cachedBasePiperEmbedding;
    } catch {
      // Belum ada cache -> ekstrak dari sampel kalimat Piper yang cukup panjang (>= 1.5s)
      let refSamples = piperSamples22k;
      if (refSamples.length < OPENVOICE_SAMPLE_RATE * 2) {
        const calibWav = await this.synthesizeBasePiperWav(
          "Halo, selamat datang di asisten pintar lokal aiKu yang berjalan seratus persen secara luring di perangkat Anda.",
          1.0
        );
        const decoded = decodeWavBuffer(calibWav);
        refSamples = resampleAudio(decoded.samples, decoded.sampleRate, OPENVOICE_SAMPLE_RATE);
      }

      const vec = await this.extractToneEmbedding(refSamples);
      this.cachedBasePiperEmbedding = vec;
      try {
        await fsp.mkdir(profilesDir, { recursive: true });
        await fsp.writeFile(cacheFile, JSON.stringify(Array.from(vec)), "utf8");
      } catch {
        // Abaikan jika gagal menyimpan cache
      }
      return vec;
    }
  }

  /**
   * Konversi warna suara menggunakan OpenVoice V2 tone_color.onnx
   */
  private async convertVoiceToneColor(
    sourceSamples22k: Float32Array,
    srcEmbedding: Float32Array,
    destEmbedding: Float32Array,
    tau: number = 0.3
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
        // Primary spectrogram tensor ("audio" / "spec" / "y")
        feeds[inputName] = specTensor;
      }
    }

    const outputs = await session.run(feeds);
    const outName = session.outputNames[0];
    const outTensor = outName ? outputs[outName] : undefined;
    if (!outTensor || !(outTensor.data instanceof Float32Array) || outTensor.data.length === 0) {
      throw new Error("Output gelombang suara dari tone_color.onnx kosong atau tidak valid.");
    }

    return outTensor.data;
  }

  /**
   * Sintesis teks ke WAV base64 (mode "piper" murni atau "clone" dengan OpenVoice V2)
   */
  public async synthesizeToWavBase64(options: {
    text: string;
    mode: "piper" | "clone";
    profileId?: string | undefined;
    speed?: number | undefined;
  }): Promise<{ wavBase64: string; usedMode: "piper" | "clone"; latencyMs: number }> {
    const t0 = performance.now();
    const cleanedText = cleanTextForSpeech(options.text);
    if (!cleanedText) {
      throw new Error("Teks kosong setelah pembersihan simbol.");
    }

    const installed = await checkVoiceEngineInstalled(this.modelsDir);
    if (!installed.piperReady) {
      throw new Error("Mesin Piper Indonesia belum terpasang. Unduh terlebih dahulu di Pengaturan Suara.");
    }

    const speed = options.speed ?? 1.05;
    const basePiperWav = await this.synthesizeBasePiperWav(cleanedText, speed);

    if (options.mode === "piper" || !options.profileId) {
      return {
        wavBase64: basePiperWav.toString("base64"),
        usedMode: "piper",
        latencyMs: Math.round(performance.now() - t0),
      };
    }

    if (!installed.openVoiceReady) {
      return {
        wavBase64: basePiperWav.toString("base64"),
        usedMode: "piper",
        latencyMs: Math.round(performance.now() - t0),
      };
    }

    const targetProfile = await this.loadProfileWithEmbedding(options.profileId);
    const decodedBase = decodeWavBuffer(basePiperWav);
    const baseSamples22k = resampleAudio(decodedBase.samples, decodedBase.sampleRate, OPENVOICE_SAMPLE_RATE);

    const srcEmbedding = await this.getOrExtractBasePiperEmbedding(baseSamples22k);
    const destEmbedding = Float32Array.from(targetProfile.embedding);
    const convertedWaveform = await this.convertVoiceToneColor(baseSamples22k, srcEmbedding, destEmbedding, 0.3);
    const finalWav = encodeWav16Bit(convertedWaveform, OPENVOICE_SAMPLE_RATE);

    return {
      wavBase64: finalWav.toString("base64"),
      usedMode: "clone",
      latencyMs: Math.round(performance.now() - t0),
    };
  }
}
