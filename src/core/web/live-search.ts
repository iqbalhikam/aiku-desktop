export interface LiveWebSnippet {
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string | undefined;
  source?: string | undefined;
}

export interface LiveWebSearchResult {
  query: string;
  fetchedAtIso: string;
  kind: "weather" | "finance" | "news_web";
  summaryFacts: string[];
  snippets: LiveWebSnippet[];
}

const LOCAL_DESKTOP_EXCLUSION_RE =
  /\b(file\s+saya|folder\s+saya|folder\s+desktop|di\s+desktop|di\s+sandbox|spek\s+laptop|ram\s+laptop|cpu\s+laptop|catatan\s+saya|timer|pengingat|stopwatch|alarm|volume|kecerahan|brightness|screenshot|tangkapan\s+layar|rapikan\s+file|duplikat\s+file|buatkan\s+file|simpan\s+file)\b/i;

const LIVE_INFO_TRIGGER_RE =
  /\b(terbaru|terkini|terupdate|hari\s+ini|sekarang|saat\s+ini|minggu\s+ini|bulan\s+ini|tahun\s+ini|kemarin|semalam|tadi\s+malam|barusan|lagi\s+viral|trending|breaking|berita|news|cuaca|suhu|hujan|prakiraan\s+cuaca|kurs|nilai\s+tukar|dolar|dollar|usd|idr|rupiah|harga\s+(?:emas|bitcoin|btc|eth|ethereum|sol|solana|saham|bbm|minyak|beras|iphone|hp|laptop)|ihsg|crypto|kripto|bitcoin|btc|ethereum|skor|klasemen|hasil\s+pertandingan|jadwal\s+pertandingan|presiden|menteri|gubernur|pemenang|juara|rilis\s+terbaru|versi\s+terbaru|film\s+terbaru|riset|research|cari\s+info|cari\s+di\s+internet|cari\s+tau|cari\s+tahu|googling|browsing|2025|2026|2027)\b/i;

/**
 * Mendeteksi apakah pertanyaan pengguna membutuhkan informasi terkini dari internet
 * (berita, cuaca, kurs, kripto, peristiwa terbaru, dsb.) sekaligus mengabaikan perintah lokal PC.
 */
export function needsLiveWebInfo(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 4) return false;
  if (LOCAL_DESKTOP_EXCLUSION_RE.test(trimmed)) return false;

  // Jangan anggap perintah buka aplikasi ("buka chrome sekarang") sebagai pencarian berita
  if (
    /^(?:tolong\s+|coba\s+)?(?:buka|bukain|bukakan|open|jalankan|putar|putarkan|stel)\s+(?:aplikasi\s+|lagu\s+)?/i.test(
      trimmed
    ) &&
    !/\b(berita|cuaca|kurs|harga|cari\s+di\s+internet|cari\s+tahu|cari\s+tau)\b/i.test(trimmed)
  ) {
    return false;
  }

  return LIVE_INFO_TRIGGER_RE.test(trimmed);
}

/**
 * Sanitasi ketat P0 terhadap teks dari internet agar halaman web berbahaya tidak bisa menyisipkan
 * tag aksi desktop ([OPEN_APP:...], [RUN_CMD:...], <write_file>) ke dalam prompt Qwen 3B.
 */
export function sanitizeWebTextForPrompt(raw: string, maxLen: number = 320): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(
      /\[(OPEN_APP|OPEN_FILE|OPEN_CHROME|OPEN_WEB|SEARCH_YT|SEARCH_WEB|SYS_CONTROL|SET_BRIGHTNESS|CREATE_FOLDER|RUN_CMD)\s*:/gi,
      "(tag:"
    )
    .replace(/<\/?write_file[^>]*>/gi, "")
    .replace(/<\/?LIVE_WEB_DATA>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function cleanSearchQuery(raw: string): string {
  return raw
    .replace(
      /^(?:tolong\s+|coba\s+|hei\s+aiku\s+|aiku\s+)?(?:carikan|cari\s+di\s+internet|cari\s+tahu|cari\s+tau|cek|kasih\s+tau|beri\s+tahu|apa|berapa|bagaimana|siapa|kapan)\s+/i,
      ""
    )
    .replace(/[?!.]+$/g, "")
    .trim()
    .slice(0, 140);
}

/**
 * Memperkaya pertanyaan lanjutan singkat (mis. "Kalau yang naik sekarang apa?", "Coba bacain")
 * dengan kata kunci dari percakapan sebelumnya agar riset latar belakang tetap tepat sasaran.
 */
export function buildContextualSearchQuery(
  message: string,
  history: ReadonlyArray<{ role: "user" | "assistant"; content: string }>
): string {
  const cleaned = cleanSearchQuery(message) || message.trim();
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const isShortFollowUp =
    wordCount <= 6 ||
    /\b(yang\s+(?:naik|turun|terbaru|bagus|mahal|murah)|kalau\s+itu|gimana\s+dengan|coba\s+bacain|bacakan|detailnya|maksudnya)\b/i.test(
      message
    );

  if (!isShortFollowUp || history.length === 0) {
    return cleaned;
  }

  // Ambil 1-2 pesan terakhir untuk mengambil konteks topik (mis. "emas Antam", "bitcoin", "saham")
  const recentContext = history
    .slice(-3)
    .map((h) => h.content)
    .join(" ")
    .replace(/\b(oke|siap|ngomong-ngomong|bisa|baca|di\s+sini|info\s+terbaru|cek\s+aja|untuk|sekarang|kalau|yang|apa|mana|coba|bacain)\b/gi, " ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const contextTokens = recentContext
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 6)
    .join(" ");

  if (!contextTokens) return cleaned;
  return `${contextTokens} ${cleaned}`.trim().slice(0, 140);
}

async function fetchWeatherFact(message: string): Promise<LiveWebSearchResult | null> {
  const lower = message.toLowerCase();
  if (!/\b(cuaca|suhu|hujan|prakiraan\s+cuaca|panas|mendung)\b/.test(lower)) {
    return null;
  }

  const cityMatch = message.match(
    /\b(?:di|kota|daerah|wilayah|cuaca|suhu)\s+([A-Za-z][A-Za-z\s-]{2,28}?)(?:\s+(?:hari\s+ini|sekarang|saat\s+ini|besok|malam\s+ini|pagi\s+ini|siang\s+ini)|[?.!,]|$)/i
  );
  const candidateCity = cityMatch?.[1]?.trim();
  const skipWords = new Set(["hari ini", "sekarang", "saat ini", "besok", "terbaru", "terkini", "ini"]);
  const city =
    candidateCity && !skipWords.has(candidateCity.toLowerCase()) ? candidateCity : "Jakarta";

  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      headers: { "User-Agent": "aiKu-Desktop/1.6" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current_condition?: Array<{
        temp_C?: string;
        FeelsLikeC?: string;
        humidity?: string;
        windspeedKmph?: string;
        weatherDesc?: Array<{ value?: string }>;
      }>;
      nearest_area?: Array<{ areaName?: Array<{ value?: string }> }>;
    };
    const cur = data.current_condition?.[0];
    if (!cur?.temp_C) return null;

    const areaName = sanitizeWebTextForPrompt(data.nearest_area?.[0]?.areaName?.[0]?.value || city, 60);
    const desc = sanitizeWebTextForPrompt(cur.weatherDesc?.[0]?.value || "Cerah berawan", 80);
    const fact = `Cuaca real-time di ${areaName}: ${cur.temp_C}°C (terasa seperti ${cur.FeelsLikeC ?? cur.temp_C}°C), kondisi ${desc}, kelembapan ${cur.humidity ?? "-"}%, kecepatan angin ${cur.windspeedKmph ?? "-"} km/jam.`;

    return {
      query: `Cuaca ${areaName}`,
      fetchedAtIso: new Date().toISOString(),
      kind: "weather",
      summaryFacts: [fact],
      snippets: [
        {
          title: `Cuaca Real-Time ${areaName}`,
          snippet: fact,
          url: `https://wttr.in/${encodeURIComponent(areaName)}`,
          source: "wttr.in",
        },
      ],
    };
  } catch {
    return null;
  }
}

async function fetchFinanceFact(message: string): Promise<LiveWebSearchResult | null> {
  const lower = message.toLowerCase();
  const wantsFx = /\b(kurs|nilai\s+tukar|dolar|dollar|usd|euro|eur|yen|jpy|sgd|ringgit|myr)\b/.test(lower);
  const wantsCrypto = /\b(bitcoin|btc|ethereum|eth|solana|sol|crypto|kripto|dogecoin|doge|bnb)\b/.test(lower);
  if (!wantsFx && !wantsCrypto) return null;

  const summaryFacts: string[] = [];
  const snippets: LiveWebSnippet[] = [];

  if (wantsFx) {
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD", {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          time_last_update_utc?: string;
          rates?: Record<string, number>;
        };
        const idr = data.rates?.IDR;
        const eur = data.rates?.EUR;
        const sgd = data.rates?.SGD;
        if (typeof idr === "number") {
          const usdIdr = Math.round(idr).toLocaleString("id-ID");
          const parts = [`1 USD = Rp ${usdIdr}`];
          if (typeof sgd === "number" && sgd > 0) {
            parts.push(`1 SGD = Rp ${Math.round(idr / sgd).toLocaleString("id-ID")}`);
          }
          if (typeof eur === "number" && eur > 0) {
            parts.push(`1 EUR = Rp ${Math.round(idr / eur).toLocaleString("id-ID")}`);
          }
          const fact = `Kurs mata uang real-time (${data.time_last_update_utc ?? "hari ini"}): ${parts.join(", ")}.`;
          summaryFacts.push(fact);
          snippets.push({
            title: "Kurs Mata Uang Real-Time (USD/IDR)",
            snippet: fact,
            url: "https://open.er-api.com/",
            source: "ExchangeRate-API",
          });
        }
      }
    } catch {
      // Abaikan jika gagal
    }
  }

  if (wantsCrypto) {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin&vs_currencies=idr,usd&include_24hr_change=true",
        {
          headers: { "User-Agent": "aiKu-Desktop/1.6" },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as Record<
          string,
          { idr?: number; usd?: number; usd_24h_change?: number }
        >;
        const coinLines: string[] = [];
        for (const [id, label] of [
          ["bitcoin", "Bitcoin (BTC)"],
          ["ethereum", "Ethereum (ETH)"],
          ["solana", "Solana (SOL)"],
          ["binancecoin", "BNB"],
        ] as const) {
          const c = data[id];
          if (c && typeof c.usd === "number" && typeof c.idr === "number") {
            const chg =
              typeof c.usd_24h_change === "number"
                ? ` (${c.usd_24h_change >= 0 ? "+" : ""}${c.usd_24h_change.toFixed(2)}% 24 jam)`
                : "";
            coinLines.push(
              `${label}: $${Math.round(c.usd).toLocaleString("en-US")} / Rp ${Math.round(c.idr).toLocaleString("id-ID")}${chg}`
            );
          }
        }
        if (coinLines.length > 0) {
          const fact = `Harga kripto real-time saat ini: ${coinLines.join("; ")}.`;
          summaryFacts.push(fact);
          snippets.push({
            title: "Harga Kripto Real-Time (CoinGecko)",
            snippet: fact,
            url: "https://www.coingecko.com/",
            source: "CoinGecko",
          });
        }
      }
    } catch {
      // Abaikan jika gagal
    }
  }

  if (summaryFacts.length === 0) return null;
  return {
    query: cleanSearchQuery(message),
    fetchedAtIso: new Date().toISOString(),
    kind: "finance",
    summaryFacts,
    snippets,
  };
}

function parseGoogleNewsRssItems(xml: string, limit: number = 5): LiveWebSnippet[] {
  const items: LiveWebSnippet[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null && items.length < limit) {
    const block = match[1] ?? "";
    const titleRaw = /<title>([\s\S]*?)<\/title>/i.exec(block)?.[1] ?? "";
    const linkRaw = /<link>([\s\S]*?)<\/link>/i.exec(block)?.[1] ?? "";
    const pubRaw = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block)?.[1] ?? "";
    const sourceRaw = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(block)?.[1] ?? "";

    const title = sanitizeWebTextForPrompt(titleRaw, 200);
    const url = linkRaw.trim();
    const publishedAt = sanitizeWebTextForPrompt(pubRaw, 60);
    const source = sanitizeWebTextForPrompt(sourceRaw, 60);

    if (title.length >= 8 && url.startsWith("http")) {
      items.push({
        title,
        snippet: publishedAt ? `${title} (${source || "Berita"}, ${publishedAt})` : title,
        url,
        publishedAt: publishedAt || undefined,
        source: source || undefined,
      });
    }
  }

  return items;
}

async function fetchGoogleNewsRss(query: string): Promise<LiveWebSnippet[]> {
  const isGeneralNews =
    /^(?:berita|news|kabar|info|informasi|update)?\s*(?:terbaru|terkini|hari\s+ini|terupdate|sekarang|saat\s+ini)?\s*(?:hari\s+ini|terbaru|terkini|sekarang)?\s*(?:di\s+)?(?:indonesia|dunia|nasional)?$/i.test(
      query.trim()
    );
  const url = isGeneralNews
    ? "https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id"
    : `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) aiKu-Desktop/1.6",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseGoogleNewsRssItems(xml, 5);
  } catch {
    return [];
  }
}

async function fetchWikipediaSummary(query: string): Promise<LiveWebSnippet[]> {
  try {
    const url = `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=2`;
    const res = await fetch(url, {
      headers: { "User-Agent": "aiKu-Desktop/1.6" },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: { search?: Array<{ title?: string; snippet?: string }> };
    };
    const rows = data.query?.search ?? [];
    return rows
      .filter((r) => Boolean(r.title && r.snippet))
      .map((r) => {
        const title = sanitizeWebTextForPrompt(r.title!, 120);
        const snippet = sanitizeWebTextForPrompt(r.snippet!, 260);
        return {
          title,
          snippet: `${title}: ${snippet}`,
          url: `https://id.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`,
          source: "Wikipedia ID",
        };
      });
  } catch {
    return [];
  }
}

async function fetchDuckDuckGoLiteSnippets(query: string): Promise<LiveWebSnippet[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
      },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results: LiveWebSnippet[] = [];

    const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const titles: Array<{ url: string; title: string }> = [];
    let tm: RegExpExecArray | null;
    while ((tm = titleRe.exec(html)) !== null && titles.length < 4) {
      const title = sanitizeWebTextForPrompt(tm[2] ?? "", 160);
      const url = (tm[1] ?? "").trim();
      if (title.length >= 6) titles.push({ url, title });
    }

    const snippets: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = snippetRe.exec(html)) !== null && snippets.length < 4) {
      snippets.push(sanitizeWebTextForPrompt(sm[1] ?? "", 280));
    }

    for (let i = 0; i < titles.length; i++) {
      const t = titles[i]!;
      const s = snippets[i] ?? "";
      results.push({
        title: t.title,
        snippet: s ? `${t.title} — ${s}` : t.title,
        url: t.url,
        source: "Web Research",
      });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Mengambil informasi real-time dari internet secara gratis di latar belakang tanpa membuka browser:
 * - Cuaca real-time (wttr.in)
 * - Kurs mata uang & Kripto real-time (ExchangeRate-API + CoinGecko)
 * - Berita terkini & riset artikel web (Google News Indonesia RSS + DuckDuckGo Snippets + Wikipedia ID)
 */
export async function fetchLiveWebSnippets(
  message: string,
  history: ReadonlyArray<{ role: "user" | "assistant"; content: string }> = []
): Promise<LiveWebSearchResult | null> {
  const contextualQuery = buildContextualSearchQuery(message, history);

  // 1. Cek sumber khusus real-time (cuaca & finansial) terlebih dahulu
  const [weatherRes, financeRes] = await Promise.all([
    fetchWeatherFact(contextualQuery),
    fetchFinanceFact(contextualQuery),
  ]);
  if (weatherRes) return weatherRes;
  if (financeRes) return financeRes;

  // 2. Riset latar belakang paralel: DuckDuckGo snippets (isi paragraf nyata) + Google News RSS + Wikipedia ID
  const [ddgItems, newsItems, wikiItems] = await Promise.all([
    fetchDuckDuckGoLiteSnippets(contextualQuery),
    fetchGoogleNewsRss(contextualQuery),
    fetchWikipediaSummary(contextualQuery),
  ]);

  const combined = [...ddgItems.slice(0, 3), ...newsItems.slice(0, 3), ...wikiItems.slice(0, 1)];
  if (combined.length === 0) return null;

  return {
    query: contextualQuery,
    fetchedAtIso: new Date().toISOString(),
    kind: "news_web",
    summaryFacts: combined.map((item) => item.snippet),
    snippets: combined,
  };
}

/**
 * Memformat hasil web real-time menjadi blok konteks pasif yang aman untuk Qwen 2.5 3B.
 */
export function formatLiveWebObservation(result: LiveWebSearchResult): string {
  const todayFormatted = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const lines = result.summaryFacts.map((fact, idx) => `- [${idx + 1}] ${fact}`);
  return [
    `HASIL RISET LATAR BELAKANG REAL-TIME (${todayFormatted}, topik: "${result.query}") — LANGSUNG bacakan dan rangkum fakta/angka penting di bawah ini ke pengguna secara jelas & natural. DILARANG menyuruh pengguna membuka link/browser atau menulis "baca di sini" / "[SEARCH_WEB:...]":`,
    `<LIVE_WEB_DATA>`,
    ...lines,
    `</LIVE_WEB_DATA>`,
  ].join("\n");
}
