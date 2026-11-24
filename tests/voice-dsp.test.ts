import { describe, expect, it } from "vitest";
import { resolveAppConfig } from "../src/config/schema.js";
import {
  cleanTextForSpeech,
  splitTextIntoRealtimeSpeechClauses,
  StreamingSpeechClauseAccumulator,
} from "../src/core/voice/voice-clone-engine.js";
import {
  computeOpenVoiceSpectrogram,
  decodeWavBuffer,
  encodeWav16Bit,
  OPENVOICE_FREQ_BINS,
  OPENVOICE_SAMPLE_RATE,
  prepareReferenceVoiceSamples,
  resampleAudio,
} from "../src/core/voice/wav-dsp.js";

describe("Offline Voice Clone DSP & Config Schema", () => {
  it("encodes and decodes 16-bit PCM WAV accurately", () => {
    const numSamples = OPENVOICE_SAMPLE_RATE; // 1.0s
    const sine = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      sine[i] = 0.6 * Math.sin((2 * Math.PI * 440 * i) / OPENVOICE_SAMPLE_RATE);
    }

    const wavBuf = encodeWav16Bit(sine, OPENVOICE_SAMPLE_RATE);
    const decoded = decodeWavBuffer(wavBuf);

    expect(decoded.sampleRate).toBe(OPENVOICE_SAMPLE_RATE);
    expect(decoded.channels).toBe(1);
    expect(decoded.samples.length).toBe(numSamples);
    // Mid-buffer sample fidelity check (outside micro-fade edges)
    const midIdx = Math.floor(numSamples / 2) + 37;
    expect(Math.abs(decoded.samples[midIdx]! - sine[midIdx]!)).toBeLessThan(0.01);
  });

  it("resamples 48kHz audio cleanly down to 22050Hz", () => {
    const srcRate = 48000;
    const src = new Float32Array(srcRate * 2); // 2s
    for (let i = 0; i < src.length; i++) {
      src[i] = 0.5 * Math.sin((2 * Math.PI * 300 * i) / srcRate);
    }

    const resampled = resampleAudio(src, srcRate, OPENVOICE_SAMPLE_RATE);
    expect(resampled.length).toBe(OPENVOICE_SAMPLE_RATE * 2);
  });

  it("trims leading/trailing silence and rejects silent recordings", () => {
    const silent = new Float32Array(OPENVOICE_SAMPLE_RATE * 3);
    expect(() => prepareReferenceVoiceSamples(silent, OPENVOICE_SAMPLE_RATE)).toThrow();

    // 0.5s silence + 3.0s voice + 0.5s silence = 4.0s total -> trimmed ~3.16s
    const total = OPENVOICE_SAMPLE_RATE * 4;
    const paddedVoice = new Float32Array(total);
    const activeStart = Math.floor(OPENVOICE_SAMPLE_RATE * 0.5);
    const activeEnd = Math.floor(OPENVOICE_SAMPLE_RATE * 3.5);
    for (let i = activeStart; i < activeEnd; i++) {
      paddedVoice[i] = 0.25 * Math.sin((2 * Math.PI * 220 * i) / OPENVOICE_SAMPLE_RATE);
    }

    const prepared = prepareReferenceVoiceSamples(paddedVoice, OPENVOICE_SAMPLE_RATE);
    expect(prepared.durationSec).toBeGreaterThanOrEqual(3.0);
    expect(prepared.durationSec).toBeLessThanOrEqual(3.3);
  });

  it("computes exact OpenVoice V2 513-bin magnitude spectrogram in both layouts", () => {
    const samples = new Float32Array(OPENVOICE_SAMPLE_RATE); // 22050 samples (1s)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / OPENVOICE_SAMPLE_RATE);
    }

    const spec = computeOpenVoiceSpectrogram(samples);
    const expectedFrames = Math.floor((samples.length + 768 - 1024) / 256) + 1;

    expect(spec.bins).toBe(OPENVOICE_FREQ_BINS);
    expect(spec.frames).toBe(expectedFrames);
    expect(spec.timeFirst.length).toBe(expectedFrames * 513);
    expect(spec.freqFirst.length).toBe(513 * expectedFrames);

    // Check transpose consistency: timeFirst[t, f] === freqFirst[f, t]
    const t = 15;
    const f = 20;
    expect(spec.timeFirst[t * 513 + f]).toBeCloseTo(spec.freqFirst[f * expectedFrames + t]!, 6);
  });

  it("maintains backward compatibility on AppConfigSchema and splits realtime speech clauses on full sentences", () => {
    const cfg = resolveAppConfig({
      allowedDirectories: ["./sandbox"],
    });
    expect(cfg.voice.ttsMode).toBe("ava_hd");
    expect(cfg.voice.speed).toBe(1.03);
    expect(cleanTextForSpeech("Halo **Iqbal**! [OPEN_CHROME: https://youtube.com] Diskon 50%.")).toBe(
      "Halo Iqbal! Diskon 50 persen ."
    );
    expect(cleanTextForSpeech("1. Buka aplikasi\n2. Simpan catatan")).toBe(
      "Buka aplikasi. Simpan catatan"
    );

    const clauses = splitTextIntoRealtimeSpeechClauses(
      "Halo Iqbal, senang bertemu lagi hari ini! Cuaca sedang cerah, jadi semua pekerjaan kamu sudah siap dijalankan sekarang."
    );
    expect(clauses).toEqual([
      "Halo Iqbal, senang bertemu lagi hari ini!",
      "Cuaca sedang cerah, jadi semua pekerjaan kamu sudah siap dijalankan sekarang.",
    ]);

    const streamed: string[] = [];
    const acc = new StreamingSpeechClauseAccumulator((c) => streamed.push(c));
    acc.pushTokenChunk("Siap Iqbal, aku bantu ");
    acc.pushTokenChunk("sekarang juga! ");
    acc.pushTokenChunk("Ini kalimat keduanya, mengalir mulus tanpa jeda patah.");
    acc.flush();
    expect(streamed).toEqual([
      "Siap Iqbal, aku bantu sekarang juga!",
      "Ini kalimat keduanya, mengalir mulus tanpa jeda patah.",
    ]);
  });
});
