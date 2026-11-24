/**
 * Pure TypeScript Audio DSP & Exact OpenVoice V2 Spectrogram Engine
 * - RIFF WAV Decoder (8/16/24/32-bit PCM & 32-bit Float, multi-chunk safe, stereo->mono)
 * - Anti-aliased Resampler -> 22,050 Hz
 * - Precomputed Radix-2 1024-pt FFT + Reflect-Padded Periodic Hann STFT (n_fft=1024, hop=256, 513 bins)
 * - Clean 16-bit Mono PCM WAV Encoder with anti-pop micro-fade & soft peak limiter
 */

export const OPENVOICE_SAMPLE_RATE = 22050;
export const OPENVOICE_N_FFT = 1024;
export const OPENVOICE_HOP_LENGTH = 256;
export const OPENVOICE_WIN_LENGTH = 1024;
export const OPENVOICE_FREQ_BINS = 513; // (1024 / 2) + 1
export const OPENVOICE_REFLECT_PAD = 384; // (1024 - 256) / 2

export interface DecodedWav {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  durationSec: number;
}

export interface OpenVoiceSpectrogram {
  /** Layout [frames, 513] flattened -> shape [1, frames, 513] for tone_extract.onnx */
  timeFirst: Float32Array;
  /** Layout [513, frames] flattened -> shape [1, 513, frames] for tone_color.onnx */
  freqFirst: Float32Array;
  frames: number;
  bins: number;
}

// Precompute Periodic Hann Window (matches torch.hann_window(1024, periodic=True))
const HANN_WINDOW_1024 = new Float32Array(OPENVOICE_WIN_LENGTH);
for (let n = 0; n < OPENVOICE_WIN_LENGTH; n++) {
  HANN_WINDOW_1024[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / OPENVOICE_WIN_LENGTH));
}

// Precompute Radix-2 Bit-Reversal Table & Twiddle Factors for N = 1024
const BIT_REV_1024 = new Uint16Array(OPENVOICE_N_FFT);
{
  const bits = 10; // 2^10 = 1024
  for (let i = 0; i < OPENVOICE_N_FFT; i++) {
    let rev = 0;
    let val = i;
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (val & 1);
      val >>= 1;
    }
    BIT_REV_1024[i] = rev;
  }
}

const TWIDDLE_COS = new Float64Array(OPENVOICE_N_FFT / 2);
const TWIDDLE_SIN = new Float64Array(OPENVOICE_N_FFT / 2);
for (let k = 0; k < OPENVOICE_N_FFT / 2; k++) {
  const angle = (-2 * Math.PI * k) / OPENVOICE_N_FFT;
  TWIDDLE_COS[k] = Math.cos(angle);
  TWIDDLE_SIN[k] = Math.sin(angle);
}

/**
 * In-place Radix-2 Cooley-Tukey Complex FFT for N = 1024
 */
function fft1024InPlace(real: Float64Array, imag: Float64Array): void {
  for (let i = 0; i < OPENVOICE_N_FFT; i++) {
    const j = BIT_REV_1024[i]!;
    if (j > i) {
      const tr = real[i]!;
      real[i] = real[j]!;
      real[j] = tr;
      const ti = imag[i]!;
      imag[i] = imag[j]!;
      imag[j] = ti;
    }
  }

  for (let size = 2; size <= OPENVOICE_N_FFT; size <<= 1) {
    const half = size >> 1;
    const tableStep = OPENVOICE_N_FFT / size;
    for (let start = 0; start < OPENVOICE_N_FFT; start += size) {
      let twIdx = 0;
      for (let k = 0; k < half; k++) {
        const evenIdx = start + k;
        const oddIdx = evenIdx + half;
        const wr = TWIDDLE_COS[twIdx]!;
        const wi = TWIDDLE_SIN[twIdx]!;
        const or = real[oddIdx]!;
        const oi = imag[oddIdx]!;

        const tr = wr * or - wi * oi;
        const ti = wr * oi + wi * or;

        real[oddIdx] = real[evenIdx]! - tr;
        imag[oddIdx] = imag[evenIdx]! - ti;
        real[evenIdx] = real[evenIdx]! + tr;
        imag[evenIdx] = imag[evenIdx]! + ti;

        twIdx += tableStep;
      }
    }
  }
}

/**
 * Decode standard RIFF WAVE buffer into normalized mono Float32Array [-1, 1]
 */
export function decodeWavBuffer(buffer: Buffer): DecodedWav {
  if (buffer.byteLength < 44) {
    throw new Error("File WAV terlalu kecil atau rusak.");
  }
  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Format audio harus berupa file WAV standar (RIFF/WAVE).");
  }

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataByteLength = 0;

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkBodyStart = offset + 8;

    if (chunkId === "fmt " && chunkSize >= 16 && chunkBodyStart + 16 <= buffer.byteLength) {
      audioFormat = buffer.readUInt16LE(chunkBodyStart);
      channels = buffer.readUInt16LE(chunkBodyStart + 2);
      sampleRate = buffer.readUInt32LE(chunkBodyStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkBodyStart + 14);
      // Handle WAVE_FORMAT_EXTENSIBLE (0xFFFE)
      if (audioFormat === 0xfffe && chunkSize >= 40 && chunkBodyStart + 26 <= buffer.byteLength) {
        audioFormat = buffer.readUInt16LE(chunkBodyStart + 24);
      }
    } else if (chunkId === "data") {
      dataOffset = chunkBodyStart;
      dataByteLength = Math.min(chunkSize, buffer.byteLength - chunkBodyStart);
      break;
    }

    // Word-aligned RIFF chunk advance
    offset = chunkBodyStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || dataByteLength <= 0 || channels < 1 || sampleRate < 4000) {
    throw new Error("Header atau chunk data WAV tidak valid.");
  }
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Format kompresi WAV tidak didukung (format=${audioFormat}). Gunakan PCM/Float WAV.`);
  }

  const bytesPerSample = bitsPerSample >> 3;
  if (![1, 2, 3, 4].includes(bytesPerSample)) {
    throw new Error(`Kedalaman bit WAV tidak didukung (${bitsPerSample}-bit).`);
  }

  const frameSize = bytesPerSample * channels;
  const totalFrames = Math.floor(dataByteLength / frameSize);
  const mono = new Float32Array(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    const frameBase = dataOffset + i * frameSize;
    for (let ch = 0; ch < channels; ch++) {
      const samplePos = frameBase + ch * bytesPerSample;
      let val = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        val = buffer.readFloatLE(samplePos);
      } else if (bitsPerSample === 16) {
        val = buffer.readInt16LE(samplePos) / 32768;
      } else if (bitsPerSample === 24) {
        const b0 = buffer[samplePos]!;
        const b1 = buffer[samplePos + 1]!;
        const b2 = buffer[samplePos + 2]!;
        const int24 = ((b2 << 24) | (b1 << 16) | (b0 << 8)) >> 8;
        val = int24 / 8388608;
      } else if (bitsPerSample === 32) {
        val = buffer.readInt32LE(samplePos) / 2147483648;
      } else if (bitsPerSample === 8) {
        val = (buffer.readUInt8(samplePos) - 128) / 128;
      }
      sum += Number.isFinite(val) ? val : 0;
    }
    mono[i] = Math.max(-1, Math.min(1, sum / channels));
  }

  return {
    samples: mono,
    sampleRate,
    channels,
    durationSec: totalFrames / sampleRate,
  };
}

/**
 * Anti-aliased audio resampler to target sample rate (e.g. 22050 Hz)
 */
export function resampleAudio(samples: Float32Array, fromRate: number, toRate: number = OPENVOICE_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate || samples.length === 0) {
    return samples;
  }

  let src = samples;
  // Lightweight 5-tap lowpass smoothing prior to downsampling to prevent high-frequency aliasing
  if (fromRate > toRate * 1.15 && samples.length > 8) {
    const filtered = new Float32Array(samples.length);
    filtered[0] = samples[0]!;
    filtered[1] = samples[1]!;
    filtered[samples.length - 2] = samples[samples.length - 2]!;
    filtered[samples.length - 1] = samples[samples.length - 1]!;
    for (let i = 2; i < samples.length - 2; i++) {
      filtered[i] =
        0.1 * samples[i - 2]! +
        0.2 * samples[i - 1]! +
        0.4 * samples[i]! +
        0.2 * samples[i + 1]! +
        0.1 * samples[i + 2]!;
    }
    src = filtered;
  }

  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(src.length / ratio));
  const out = new Float32Array(outLength);
  const maxIdx = src.length - 1;

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = src[Math.min(maxIdx, idx)]!;
    const s1 = src[Math.min(maxIdx, idx + 1)]!;
    out[i] = s0 + (s1 - s0) * frac;
  }

  return out;
}

/**
 * Trim dead silence, validate duration, and peak-normalize reference voice audio at 22050 Hz
 */
export function prepareReferenceVoiceSamples(samples: Float32Array, sampleRate: number): {
  samples22k: Float32Array;
  durationSec: number;
} {
  const resampled = resampleAudio(samples, sampleRate, OPENVOICE_SAMPLE_RATE);

  // Measure peak first so relative silence threshold adapts to quiet mics
  let rawPeak = 0;
  for (let i = 0; i < resampled.length; i++) {
    const a = Math.abs(resampled[i]!);
    if (a > rawPeak) rawPeak = a;
  }
  if (rawPeak < 0.004) {
    throw new Error("Rekaman suara terlalu pelan atau hening. Pastikan mikrofon aktif lalu bicara lebih dekat.");
  }

  const threshold = Math.max(0.005, rawPeak * 0.045);
  const padSamples = Math.floor(OPENVOICE_SAMPLE_RATE * 0.08);
  let start = 0;
  let end = resampled.length - 1;

  while (start < end && Math.abs(resampled[start]!) < threshold) start++;
  while (end > start && Math.abs(resampled[end]!) < threshold) end--;

  start = Math.max(0, start - padSamples);
  end = Math.min(resampled.length, end + padSamples);

  // Cap max reference length at 18s for blazing-fast speaker embedding extraction
  const maxSamples = OPENVOICE_SAMPLE_RATE * 18;
  const trimmedLen = Math.min(maxSamples, Math.max(0, end - start));
  const minSamples = Math.floor(OPENVOICE_SAMPLE_RATE * 1.5);

  if (trimmedLen < minSamples) {
    throw new Error("Sampel suara efektif kurang dari 2 detik. Rekam atau unggah suara berbicara minimal 4–10 detik.");
  }

  const out = new Float32Array(trimmedLen);
  const scale = 0.9 / rawPeak;
  for (let i = 0; i < trimmedLen; i++) {
    out[i] = Math.max(-1, Math.min(1, resampled[start + i]! * scale));
  }

  return {
    samples22k: out,
    durationSec: Math.round((trimmedLen / OPENVOICE_SAMPLE_RATE) * 10) / 10,
  };
}

/**
 * Exact OpenVoice V2 Linear Magnitude Spectrogram
 * Mirrors PyTorch:
 *   y = F.pad(y, (384, 384), mode="reflect")
 *   spec = torch.stft(y, 1024, hop_length=256, win_length=1024, window=hann_window(1024), center=False)
 *   spec = torch.sqrt(spec.pow(2).sum(-1) + 1e-6)
 */
export function computeOpenVoiceSpectrogram(samples22k: Float32Array): OpenVoiceSpectrogram {
  const minInputLen = OPENVOICE_REFLECT_PAD + 64;
  let signal = samples22k;
  if (signal.length < minInputLen) {
    const grown = new Float32Array(minInputLen);
    grown.set(signal, 0);
    signal = grown;
  }

  const n = signal.length;
  const pad = OPENVOICE_REFLECT_PAD;
  const paddedLen = n + pad * 2;
  const padded = new Float32Array(paddedLen);

  // Left reflect pad
  for (let i = 0; i < pad; i++) {
    const mirrorIdx = Math.min(n - 1, Math.max(0, pad - i));
    padded[i] = signal[mirrorIdx]!;
  }
  // Center signal
  padded.set(signal, pad);
  // Right reflect pad
  for (let i = 0; i < pad; i++) {
    const mirrorIdx = Math.max(0, Math.min(n - 1, n - 2 - i));
    padded[pad + n + i] = signal[mirrorIdx]!;
  }

  const frames = Math.max(1, Math.floor((paddedLen - OPENVOICE_WIN_LENGTH) / OPENVOICE_HOP_LENGTH) + 1);
  const timeFirst = new Float32Array(frames * OPENVOICE_FREQ_BINS);
  const freqFirst = new Float32Array(OPENVOICE_FREQ_BINS * frames);

  const real = new Float64Array(OPENVOICE_N_FFT);
  const imag = new Float64Array(OPENVOICE_N_FFT);

  for (let t = 0; t < frames; t++) {
    const base = t * OPENVOICE_HOP_LENGTH;
    for (let k = 0; k < OPENVOICE_WIN_LENGTH; k++) {
      real[k] = padded[base + k]! * HANN_WINDOW_1024[k]!;
      imag[k] = 0;
    }

    fft1024InPlace(real, imag);

    const tfRowBase = t * OPENVOICE_FREQ_BINS;
    for (let f = 0; f < OPENVOICE_FREQ_BINS; f++) {
      const re = real[f]!;
      const im = imag[f]!;
      const mag = Math.sqrt(re * re + im * im + 1e-6);
      timeFirst[tfRowBase + f] = mag;
      freqFirst[f * frames + t] = mag;
    }
  }

  return {
    timeFirst,
    freqFirst,
    frames,
    bins: OPENVOICE_FREQ_BINS,
  };
}

/**
 * Encode normalized mono Float32Array into clean 16-bit PCM RIFF WAVE Buffer
 */
export function encodeWav16Bit(samples: Float32Array, sampleRate: number = OPENVOICE_SAMPLE_RATE): Buffer {
  const numSamples = samples.length;
  const dataByteLen = numSamples * 2;
  const out = Buffer.allocUnsafe(44 + dataByteLen);

  // Measure peak to prevent harsh digital clipping while keeping healthy volume
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const v = samples[i]!;
    if (Number.isFinite(v)) {
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
    }
  }
  const gain = peak > 0.96 ? 0.95 / peak : peak > 0.02 && peak < 0.35 ? Math.min(2.4, 0.78 / peak) : 1.0;
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.008), Math.floor(numSamples / 8));

  // RIFF Header
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataByteLen, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16); // PCM chunk size
  out.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  out.writeUInt16LE(1, 22); // Mono = 1 channel
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  out.writeUInt16LE(2, 32); // BlockAlign
  out.writeUInt16LE(16, 34); // BitsPerSample
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataByteLen, 40);

  for (let i = 0; i < numSamples; i++) {
    let v = Number.isFinite(samples[i]!) ? samples[i]! * gain : 0;
    if (fadeSamples > 0) {
      if (i < fadeSamples) {
        v *= i / fadeSamples;
      } else if (i >= numSamples - fadeSamples) {
        v *= (numSamples - 1 - i) / fadeSamples;
      }
    }
    const clamped = Math.max(-1, Math.min(1, v));
    const pcm16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    out.writeInt16LE(pcm16, 44 + i * 2);
  }

  return out;
}
