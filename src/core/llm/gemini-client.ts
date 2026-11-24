import type { ChatHistoryTurn } from "./llama-engine.js";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiReplyResult {
  reply: string;
  usedWebSearch: boolean;
  sources: Array<{ title: string; url: string }>;
}

/**
 * Menentukan apakah sebuah pertanyaan lebih cocok ditangani Gemini (riset internet / soal sulit / coding)
 * dibanding model lokal 1.5B.
 */
export function classifyCloudRouting(message: string): {
  useGemini: boolean;
  enableWebSearch: boolean;
  cleanedPrompt: string;
} {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // 1. Perintah eksplisit ke Gemini
  const explicitGemini = trimmed.match(/^(?:\/gemini|tanya\s+gemini|gemini)\s*:?\s+(.+)$/i);
  if (explicitGemini?.[1]) {
    const body = explicitGemini[1].trim();
    const wantsWeb = /\b(internet|terbaru|hari\s+ini|berita|harga|saham|riset|cari\s+tau|cari\s+tahu)\b/i.test(body);
    return { useGemini: true, enableWebSearch: wantsWeb, cleanedPrompt: body };
  }

  // 2. Riset internet / informasi terkini
  if (
    /\b(cari\s+di\s+internet|cari\s+tau|cari\s+tahu|di\s+internet|riset|berita\s+terbaru|harga\s+saham|kurs\s+dolar|cuaca\s+hari\s+ini)\b/.test(
      lower
    )
  ) {
    return { useGemini: true, enableWebSearch: true, cleanedPrompt: trimmed };
  }

  // 3. Pertanyaan kompleks, coding, analisis mendalam, atau prompt panjang (> 140 karakter)
  if (
    trimmed.length > 140 ||
    /\b(analisis|bandingkan|perbedaan|coding|koding|debug|error|stack\s*trace|algoritma|arsitektur|buatkan\s+(kode|script|program|esai|artikel)|jelaskan\s+mendalam)\b/.test(
      lower
    )
  ) {
    return { useGemini: true, enableWebSearch: false, cleanedPrompt: trimmed };
  }

  return { useGemini: false, enableWebSearch: false, cleanedPrompt: trimmed };
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
      }>;
    };
  }>;
  error?: { message?: string };
}

/**
 * Klien ringan Gemini REST API (0 dependensi eksternal, mendukung Google Search Grounding).
 * P0 Privacy: Tidak pernah mengirim path file atau isi dokumen lokal ke cloud.
 */
export async function askGeminiCloud(options: {
  apiKey: string;
  prompt: string;
  history: readonly ChatHistoryTurn[];
  enableWebSearch: boolean;
}): Promise<GeminiReplyResult> {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(options.apiKey)}`;

  const cleanPrompt = options.prompt.trim();
  let priorHistory = options.history;
  if (
    priorHistory.length > 0 &&
    priorHistory[priorHistory.length - 1]?.role === "user" &&
    priorHistory[priorHistory.length - 1]?.content.trim() === cleanPrompt
  ) {
    priorHistory = priorHistory.slice(0, -1);
  }

  const contents = [
    ...priorHistory.slice(-6).map((turn) => ({
      role: turn.role === "user" ? "user" : "model",
      parts: [{ text: turn.content.slice(0, 1000) }],
    })),
    {
      role: "user",
      parts: [{ text: cleanPrompt.slice(0, 4000) }],
    },
  ];

  const requestBody: Record<string, unknown> = {
    systemInstruction: {
      parts: [
        {
          text: "Kamu adalah aiKu, asisten pribadi cerdas, hangat, dan akrab milik pengguna di desktop Windows 11 mereka. Gunakan sapaan akrab ('aku' dan 'kamu'), jawab alami, nyambung dengan konteks obrolan sebelumnya, dan langsung ke inti dalam Bahasa Indonesia.",
        },
      ],
    },
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 700,
    },
  };

  if (options.enableWebSearch) {
    requestBody.tools = [{ google_search: {} }];
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(20_000),
  });

  const data = (await response.json()) as GeminiApiResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message ?? `Gemini HTTP ${response.status}`);
  }

  const candidate = data.candidates?.[0];
  const textParts = candidate?.content?.parts?.map((p) => p.text ?? "").filter(Boolean) ?? [];
  const replyText = textParts.join("\n").trim();

  if (!replyText) {
    throw new Error("Gemini mengembalikan respons kosong.");
  }

  const rawChunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const sources: Array<{ title: string; url: string }> = [];
  const seenUrls = new Set<string>();
  for (const chunk of rawChunks) {
    const uri = chunk.web?.uri;
    if (uri && !seenUrls.has(uri)) {
      seenUrls.add(uri);
      sources.push({ title: chunk.web?.title || uri, url: uri });
      if (sources.length >= 4) break;
    }
  }

  return {
    reply: replyText,
    usedWebSearch: options.enableWebSearch && sources.length > 0,
    sources,
  };
}
