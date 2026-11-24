import crypto from "node:crypto";
import https from "node:https";
import { MPEGDecoder } from "mpg123-decoder";

export const HUMAN_VOICE_PRESETS = {
  ava_hd: {
    id: "ava_hd",
    voiceName: "en-US-AvaMultilingualNeural",
    locale: "id-ID",
    label: "Ava Conversational HD (Wanita — Sangat Natural)",
    geminiVoice: "Aoede",
  },
  andrew_hd: {
    id: "andrew_hd",
    voiceName: "en-US-AndrewMultilingualNeural",
    locale: "id-ID",
    label: "Andrew Conversational HD (Pria — Sangat Natural)",
    geminiVoice: "Puck",
  },
  gadis_hd: {
    id: "gadis_hd",
    voiceName: "id-ID-GadisNeural",
    locale: "id-ID",
    label: "Gadis Bahasa Indonesia HD (Wanita)",
    geminiVoice: "Kore",
  },
  ardi_hd: {
    id: "ardi_hd",
    voiceName: "id-ID-ArdiNeural",
    locale: "id-ID",
    label: "Ardi Bahasa Indonesia HD (Pria)",
    geminiVoice: "Charon",
  },
} as const;

export type HumanVoicePresetId = keyof typeof HUMAN_VOICE_PRESETS;

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const OUTPUT_FORMAT_24K_MP3 = "audio-24khz-48kbitrate-mono-mp3";
const JSON_XML_DELIM = "\r\n\r\n";
const AUDIO_DELIM = "Path:audio\r\n";
const EDGE_COPYRIGHT = "Copyright (C) Microsoft Corporation. All rights reserved.";

// Paksa IPv4 (family: 4) + TLS Session Reuse agar tidak terkena delay 4 detik IPv6 timeout di Windows Wi-Fi!
const IPV4_TLS_AGENT = new https.Agent({
  family: 4,
  keepAlive: true,
  maxSockets: 4,
});

const SWAP_FIRST_WORD = { swappedWord: 0xef0569fb, swappedSum: 0x76f50f34, swappedProduct: 0xc3efea97 };
const SWAP_SECOND_WORD = { swappedWord: 0xc31713db, swappedSum: 0x1881ce3c, swappedProduct: 0x35bd1ec9 };
const MIX_FIRST_WORD = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83] as const;
const MIX_SECOND_WORD = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69] as const;

function swapHalves(value: number): number {
  return ((value << 16) | (value >>> 16)) >>> 0;
}

function swapTerm(
  word: number,
  key: number,
  multipliers: { swappedWord: number; swappedSum: number; swappedProduct: number }
): number {
  const sum = Math.imul(word, key) + Math.imul(swapHalves(word), multipliers.swappedWord);
  const product = Math.imul(swapHalves(sum), multipliers.swappedSum) >>> 0;
  return (Math.imul(swapHalves(product), multipliers.swappedProduct) + product) >>> 0;
}

function swapAndMultiply(value: number, multipliers: readonly number[]): number {
  let cur = value;
  for (const m of multipliers) {
    cur = Math.imul(swapHalves(cur), m) >>> 0;
  }
  return cur;
}

function toUpperHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out.toUpperCase();
}

function computeSecMsGecV2(ticksAndToken: string): string {
  const message = new TextEncoder().encode(EDGE_COPYRIGHT + ticksAndToken);
  const digest = new Uint8Array(crypto.createHash("sha256").update(message).digest());

  const digestView = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const firstKey = (digestView.getUint32(0, true) | 1) >>> 0;
  const secondKey = (digestView.getUint32(4, true) | 1) >>> 0;

  const padded = new Uint8Array(Math.ceil(message.length / 8) * 8);
  padded.set(message);
  const words = new DataView(padded.buffer);

  let swapSum = 0;
  let lastSwap = 0;
  let mix = 0;
  let mixSum = 0;

  for (let offset = 0; offset < padded.length; offset += 8) {
    const firstWord = words.getUint32(offset, true);
    const secondWord = words.getUint32(offset + 4, true);
    const firstSwap = swapTerm(firstWord, firstKey, SWAP_FIRST_WORD);
    lastSwap = swapTerm(secondWord, secondKey, SWAP_SECOND_WORD);
    swapSum = (swapSum + firstSwap + lastSwap) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + firstWord, firstKey), MIX_FIRST_WORD);
    mixSum = (mixSum + mix) >>> 0;
    mix = swapAndMultiply(Math.imul(mix + secondWord, secondKey), MIX_SECOND_WORD);
    mixSum = (mixSum + mix) >>> 0;
  }

  const checksum = new Uint8Array(8);
  const checksumView = new DataView(checksum.buffer);
  checksumView.setUint32(0, lastSwap ^ mix, true);
  checksumView.setUint32(4, swapSum ^ mixSum, true);

  return `${toUpperHex(checksum)}-${toUpperHex(digest)}`;
}

function escapeSsmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface PendingSynthesisTurn {
  chunks: Buffer[];
  resolve: (mp3: Buffer) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Mesin Suara Percakapan Manusia HD (24kHz 96kbps Conversational Neural Prosody).
 * Menggunakan koneksi WebSocket keep-alive agar kalimat ke-2 dst selesai dalam ~200-350ms!
 */
export class HumanConversationalTtsClient {
  private clockOffsetMs = 0;
  private wsInstance: import("ws").WebSocket | null = null;
  private connectingPromise: Promise<import("ws").WebSocket> | null = null;
  private readonly pendingTurns = new Map<string, PendingSynthesisTurn>();
  private mp3Decoder: MPEGDecoder | null = null;

  private buildSynthUrl(): string {
    const connId = crypto.randomBytes(16).toString("hex");
    const ticks = Math.floor((Date.now() + this.clockOffsetMs) / 1000) + 11644473600;
    const rounded = ticks - (ticks % 300);
    const winTicks = rounded * 10_000_000;
    const secMsGec = computeSecMsGecV2(`${winTicks}${TRUSTED_CLIENT_TOKEN}`);
    return `${WSS_BASE_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=2-143.0.3650.96&ConnectionId=${connId}`;
  }

  private async getConnectedSocket(allowClockRetry = true): Promise<import("ws").WebSocket> {
    const wsModule = await import("ws");
    const WS = wsModule.WebSocket ?? wsModule.default;

    if (this.wsInstance && this.wsInstance.readyState === WS.OPEN) {
      return this.wsInstance;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = new Promise<import("ws").WebSocket>((resolve, reject) => {
      const url = this.buildSynthUrl();
      const ws = new WS(url, {
        agent: IPV4_TLS_AGENT,
        family: 4,
        handshakeTimeout: 5000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
          Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        },
      });

      let settled = false;
      const connTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.terminate();
          reject(new Error("Timeout koneksi Human Neural TTS (5.5s)."));
        }
      }, 5500);

      ws.once("unexpected-response", (_req, res) => {
        clearTimeout(connTimer);
        const serverDate = res.headers.date;
        res.resume();
        ws.terminate();
        if (!settled) {
          settled = true;
          if (allowClockRetry && res.statusCode === 403 && serverDate) {
            const parsedTime = Date.parse(serverDate);
            if (Number.isFinite(parsedTime)) {
              this.clockOffsetMs = parsedTime - Date.now();
              this.connectingPromise = null;
              this.getConnectedSocket(false).then(resolve, reject);
              return;
            }
          }
          reject(new Error(`Handshake Human Neural TTS ditolak (${res.statusCode}).`));
        }
      });

      ws.on("open", () => {
        clearTimeout(connTimer);
        const configPayload =
          `Content-Type:application/json; charset=utf-8\r\nPath:speech.config${JSON_XML_DELIM}` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: "false",
                    wordBoundaryEnabled: "false",
                  },
                  outputFormat: OUTPUT_FORMAT_24K_MP3,
                },
              },
            },
          });

        ws.send(configPayload, (err) => {
          if (settled) return;
          settled = true;
          if (err) {
            ws.terminate();
            reject(err);
          } else {
            this.wsInstance = ws;
            resolve(ws);
          }
        });
      });

      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        const buf = Buffer.isBuffer(data)
          ? data
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : Buffer.concat(data);

        if (isBinary) {
          const delimIdx = buf.indexOf(AUDIO_DELIM);
          if (delimIdx !== -1) {
            const headerStr = buf.subarray(0, delimIdx).toString("utf8");
            const reqId = /X-RequestId:([a-f0-9]+)/i.exec(headerStr)?.[1];
            const audioBytes = buf.subarray(delimIdx + AUDIO_DELIM.length);
            if (reqId && audioBytes.byteLength > 0) {
              this.pendingTurns.get(reqId)?.chunks.push(audioBytes);
            }
          }
          return;
        }

        const textMsg = buf.toString("utf8");
        const reqId = /X-RequestId:([a-f0-9]+)/i.exec(textMsg)?.[1];
        if (reqId && textMsg.includes("Path:turn.end")) {
          const turn = this.pendingTurns.get(reqId);
          if (turn) {
            clearTimeout(turn.timer);
            this.pendingTurns.delete(reqId);
            turn.resolve(Buffer.concat(turn.chunks));
          }
        }
      });

      const failAllPending = (reason: Error): void => {
        if (this.wsInstance === ws) {
          this.wsInstance = null;
        }
        for (const [id, turn] of this.pendingTurns.entries()) {
          clearTimeout(turn.timer);
          this.pendingTurns.delete(id);
          turn.reject(reason);
        }
      };

      ws.on("close", () => {
        clearTimeout(connTimer);
        if (!settled) {
          settled = true;
          reject(new Error("Soket Human Neural TTS tertutup saat inisialisasi."));
        }
        failAllPending(new Error("Soket Human Neural TTS terputus sebelum selesai."));
      });

      ws.on("error", (err) => {
        clearTimeout(connTimer);
        if (!settled) {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
        failAllPending(err instanceof Error ? err : new Error(String(err)));
      });
    }).finally(() => {
      this.connectingPromise = null;
    });

    return this.connectingPromise;
  }

  /**
   * Sintesis langsung ke 24kHz 96kbps MP3 (~40 KB/kalimat, langsung diputar oleh Audio player tanpa transkoding).
   */
  public async synthesizeMp3Buffer(options: {
    text: string;
    presetId?: HumanVoicePresetId;
    speed?: number;
  }): Promise<Buffer> {
    const preset = HUMAN_VOICE_PRESETS[options.presetId ?? "ava_hd"];
    const speed = Math.min(1.5, Math.max(0.7, options.speed ?? 1.03));
    const ratePct = Math.round((speed - 1) * 100);
    const rateAttr = `${ratePct >= 0 ? "+" : ""}${ratePct}%`;

    const ws = await this.getConnectedSocket();
    const reqId = crypto.randomBytes(16).toString("hex");
    const ssml =
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${preset.locale}">` +
      `<voice name="${preset.voiceName}">` +
      `<prosody rate="${rateAttr}" pitch="+0Hz" volume="+0%">${escapeSsmlText(options.text)}</prosody>` +
      `</voice></speak>`;

    const payload = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml${JSON_XML_DELIM}${ssml}`;

    const mp3Buf = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTurns.delete(reqId);
        reject(new Error("Timeout sintesis suara manusia HD (8s)."));
      }, 8000);

      this.pendingTurns.set(reqId, {
        chunks: [],
        resolve,
        reject,
        timer,
      });

      ws.send(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingTurns.delete(reqId);
          reject(err);
        }
      });
    });

    if (mp3Buf.byteLength < 64) {
      throw new Error("Audio MP3 kosong dari server Human Neural TTS.");
    }

    return mp3Buf;
  }

  /**
   * Sintesis suara manusia 24kHz HD dan dekode ke Float32Array PCM (~2ms via WASM mpg123) untuk sumber prosodi OpenVoice V2!
   */
  public async synthesize24k(options: {
    text: string;
    presetId?: HumanVoicePresetId;
    speed?: number;
  }): Promise<{ samples24k: Float32Array; sampleRate: number; mp3Buffer: Buffer }> {
    const mp3Buffer = await this.synthesizeMp3Buffer(options);
    if (!this.mp3Decoder) {
      this.mp3Decoder = new MPEGDecoder({ enableGapless: true });
    }
    await this.mp3Decoder.ready;
    await this.mp3Decoder.reset();
    const decoded = this.mp3Decoder.decode(new Uint8Array(mp3Buffer));
    const samples = decoded.channelData[0];
    if (!samples || samples.length < 64) {
      throw new Error("Gagal mendekode sampel PCM dari MP3 Human Neural TTS.");
    }
    // Salin dari memori WASM agar aman setelah reset berikutnya
    const safeCopy = new Float32Array(samples);
    return {
      samples24k: safeCopy,
      sampleRate: decoded.sampleRate || 24000,
      mp3Buffer,
    };
  }

  public dispose(): void {
    if (this.mp3Decoder) {
      try {
        this.mp3Decoder.free();
      } catch {
        // Abaikan
      }
      this.mp3Decoder = null;
    }
    if (this.wsInstance) {
      try {
        this.wsInstance.close();
      } catch {
        // Abaikan
      }
      this.wsInstance = null;
    }
  }
}
