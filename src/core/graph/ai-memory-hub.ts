import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

export type AiMemorySource = "aiku-local" | "antigravity" | "gemini-web" | "custom";

export interface CustomNodeRecord {
  id: string;
  label: string;
  note?: string;
  color?: string;
  connectTo: string[];
  createdAt: string;
}

export interface AiMemoryEntry {
  id: string;
  source: AiMemorySource;
  title?: string;
  prompt: string;
  answer?: string;
  timestamp: string;
}

export interface UnifiedGraphNode {
  id: string;
  label: string;
  cluster: number;
  clusterName: string;
  weight: number;
  sources: AiMemorySource[];
  primarySource: AiMemorySource;
  customColor?: string;
  customNote?: string;
  isCustom?: boolean;
  count: number;
  meta: string;
}

export interface UnifiedGraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface UnifiedGraphSnapshot {
  version: number;
  updatedAt: string;
  nodes: UnifiedGraphNode[];
  edges: UnifiedGraphEdge[];
  clusters: Array<{ id: number; name: string; count: number }>;
  sourceCounts: {
    "aiku-local": number;
    antigravity: number;
    "gemini-web": number;
    custom: number;
  };
  topConcepts: string[];
  gapHint: string;
  recentEvents: Array<{ source: AiMemorySource; title: string; timestamp: string }>;
}

const MAX_MEMORY_ENTRIES = 160;
const MAX_GRAPH_NODES = 220;
export const AI_MEMORY_HUB_PORT = 47891;

const STOPWORDS = new Set([
  // Indonesian
  "yang", "dan", "di", "ke", "dari", "pada", "untuk", "dengan", "adalah", "ini", "itu",
  "atau", "juga", "tidak", "bisa", "akan", "sudah", "saya", "anda", "kamu", "kita", "mereka",
  "lebih", "sangat", "dalam", "sebagai", "seperti", "karena", "jika", "kalau", "agar", "supaya",
  "namun", "tetapi", "tapi", "oleh", "saat", "ketika", "masih", "hanya", "dapat", "harus",
  "memiliki", "menjadi", "melakukan", "membuat", "digunakan", "gunakan", "secara", "semua",
  "setiap", "antara", "sehingga", "bahwa", "tersebut", "lain", "lainnya", "banyak", "sedikit",
  "ada", "jadi", "sama", "cukup", "perlu", "ingin", "mau", "tolong", "coba", "bagaimana",
  "mengapa", "kenapa", "apa", "siapa", "kapan", "dimana", "mana", "berapa", "tentang", "soal",
  "bukan", "tanpa", "serta", "hingga", "sampai", "paling", "baru", "lama", "baik", "tepat",
  "contoh", "berikut", "pertama", "kedua", "ketiga", "utama", "penting", "hal", "cara", "kok",
  "sih", "deh", "ya", "dong", "aja", "lagi", "biar", "buat", "nggak", "gak", "oke", "trus",
  // English
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "have", "has",
  "had", "will", "would", "should", "could", "can", "into", "onto", "about", "their", "there",
  "they", "them", "then", "than", "what", "when", "where", "which", "while", "how", "why",
  "user", "wants", "need", "needs", "okay", "let", "start", "first", "next", "also", "just",
  "make", "like", "such", "more", "most", "some", "very", "only", "your", "you", "our", "not",
  "but", "out", "use", "using", "used", "based", "each", "over", "under", "between", "through",
  "please", "help", "file", "code", "message", "system", "prompt", "response", "text",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\u00c0-\u024f_-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 24 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function sourceDisplayName(src: AiMemorySource): string {
  if (src === "aiku-local") return "aiku Local";
  if (src === "antigravity") return "Antigravity";
  if (src === "custom") return "Custom Node";
  return "Gemini Web";
}

export function buildUnifiedKnowledgeGraph(
  entries: AiMemoryEntry[],
  version: number,
  customNodes: CustomNodeRecord[] = []
): UnifiedGraphSnapshot {
  const sourceCounts = {
    "aiku-local": 0,
    antigravity: 0,
    "gemini-web": 0,
    custom: customNodes.length,
  };

  for (const e of entries) {
    sourceCounts[e.source] += 1;
  }

  const freq = new Map<string, number>();
  const termSources = new Map<string, Set<AiMemorySource>>();
  const pairWeights = new Map<string, number>();

  for (const entry of entries) {
    const combined = [entry.title ?? "", entry.prompt, (entry.answer ?? "").slice(0, 1200)]
      .filter(Boolean)
      .join("\n");
    const sentences = combined
      .split(/[\n.!?;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 2);

    for (const sent of sentences) {
      const toks = tokenize(sent);
      if (toks.length === 0) continue;
      for (let i = 0; i < toks.length; i++) {
        const w = toks[i];
        if (!w) continue;
        freq.set(w, (freq.get(w) ?? 0) + 1);
        let srcSet = termSources.get(w);
        if (!srcSet) {
          srcSet = new Set<AiMemorySource>();
          termSources.set(w, srcSet);
        }
        srcSet.add(entry.source);

        for (let j = i + 1; j < Math.min(toks.length, i + 5); j++) {
          const w2 = toks[j];
          if (!w2 || w === w2) continue;
          const key = w < w2 ? `${w}|${w2}` : `${w2}|${w}`;
          pairWeights.set(key, (pairWeights.get(key) ?? 0) + (j === i + 1 ? 1.4 : 0.8));
        }
      }
    }
  }

  // Score terms: frequency + cross-AI bridge bonus
  const rankedTerms = [...freq.entries()]
    .map(([term, count]) => {
      const srcCount = termSources.get(term)?.size ?? 1;
      return { term, score: count * (1 + (srcCount - 1) * 0.6) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_GRAPH_NODES)
    .map((x) => x.term);

  const allowed = new Set(rankedTerms);
  const edges: UnifiedGraphEdge[] = [];
  const adj = new Map<string, Array<{ to: string; w: number }>>();
  for (const t of rankedTerms) adj.set(t, []);

  for (const [key, w] of pairWeights.entries()) {
    const parts = key.split("|");
    const a = parts[0];
    const b = parts[1];
    if (!a || !b || !allowed.has(a) || !allowed.has(b)) continue;
    edges.push({ source: a, target: b, weight: Number(w.toFixed(2)) });
    adj.get(a)?.push({ to: b, w });
    adj.get(b)?.push({ to: a, w });
  }

  // Label propagation clustering (6 iterations)
  const clusterOf = new Map<string, number>();
  rankedTerms.forEach((t, idx) => clusterOf.set(t, idx % 6));

  for (let iter = 0; iter < 6; iter++) {
    for (const term of rankedTerms) {
      const neighbors = adj.get(term) ?? [];
      if (neighbors.length === 0) continue;
      const scores = new Map<number, number>();
      for (const nb of neighbors) {
        const c = clusterOf.get(nb.to) ?? 0;
        scores.set(c, (scores.get(c) ?? 0) + nb.w);
      }
      let bestC = clusterOf.get(term) ?? 0;
      let bestS = -1;
      for (const [c, s] of scores.entries()) {
        if (s > bestS) {
          bestS = s;
          bestC = c;
        }
      }
      clusterOf.set(term, bestC);
    }
  }

  const compactMap = new Map<number, number>();
  const clusterCounts = new Map<number, number>();
  for (const term of rankedTerms) {
    const rawC = clusterOf.get(term) ?? 0;
    if (!compactMap.has(rawC)) compactMap.set(rawC, compactMap.size);
    const cid = compactMap.get(rawC) ?? 0;
    clusterOf.set(term, cid);
    clusterCounts.set(cid, (clusterCounts.get(cid) ?? 0) + 1);
  }

  const nodes: UnifiedGraphNode[] = rankedTerms.map((term) => {
    const neighbors = adj.get(term) ?? [];
    const degWeight = neighbors.reduce((acc, nb) => acc + nb.w, 0);
    const count = freq.get(term) ?? 1;
    const sources = [...(termSources.get(term) ?? new Set<AiMemorySource>(["aiku-local"]))];
    const primarySource = sources[0] ?? "aiku-local";
    const crossAiBonus = sources.length > 1 ? 1.35 : 1;
    const cid = clusterOf.get(term) ?? 0;
    const srcLabel = sources.map(sourceDisplayName).join(" + ");

    return {
      id: term,
      label: term,
      cluster: cid,
      clusterName: `Klaster ${cid + 1}`,
      weight: Number(((count * 0.75 + degWeight * 0.85) * crossAiBonus).toFixed(2)),
      sources,
      primarySource,
      count,
      meta: `${srcLabel} • ${count}x`,
    };
  });

  // Merge user Custom Nodes into the galaxy graph
  const existingById = new Map(nodes.map((n) => [n.id.toLowerCase(), n]));
  const edgeKeys = new Set(edges.map((e) => (e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`)));
  const maxExistingWeight = Math.max(2, ...nodes.map((n) => n.weight));

  for (const cn of customNodes) {
    const cNodeId = cn.id;
    const nodeObj: UnifiedGraphNode = {
      id: cNodeId,
      label: cn.label,
      cluster: 0,
      clusterName: "Custom Node",
      weight: Number((maxExistingWeight * 0.85).toFixed(2)),
      sources: ["custom"],
      primarySource: "custom",
      isCustom: true,
      ...(cn.color ? { customColor: cn.color } : {}),
      ...(cn.note ? { customNote: cn.note } : {}),
      count: 1,
      meta: cn.note ? `Custom • ${cn.note.slice(0, 60)}` : "Custom Node",
    };
    nodes.push(nodeObj);
    existingById.set(cNodeId.toLowerCase(), nodeObj);
    existingById.set(cn.label.toLowerCase(), nodeObj);

    const candidateTargets = [
      ...cn.connectTo,
      ...tokenize(`${cn.label} ${cn.note ?? ""}`),
    ];
    for (const rawTarget of candidateTargets) {
      const targetKey = rawTarget.trim().toLowerCase();
      if (!targetKey) continue;
      const targetNode = existingById.get(targetKey);
      if (!targetNode || targetNode.id === cNodeId) continue;
      const ek = cNodeId < targetNode.id ? `${cNodeId}|${targetNode.id}` : `${targetNode.id}|${cNodeId}`;
      if (edgeKeys.has(ek)) continue;
      edgeKeys.add(ek);
      edges.push({ source: cNodeId, target: targetNode.id, weight: 1.6 });
    }
  }

  nodes.sort((a, b) => b.weight - a.weight);
  const topConcepts = nodes.slice(0, 4).map((n) => n.label);

  let gapHint = "";
  if (compactMap.size >= 2) {
    const topByCluster = new Map<number, UnifiedGraphNode>();
    for (const n of nodes) {
      if (!topByCluster.has(n.cluster)) topByCluster.set(n.cluster, n);
    }
    const hubs = [...topByCluster.values()];
    const a = hubs[0];
    const b = hubs[1];
    if (a && b) {
      const linked = edges.some(
        (e) => (e.source === a.id && e.target === b.id) || (e.source === b.id && e.target === a.id)
      );
      if (!linked) {
        gapHint = `Celah ide: ${a.label} ↔ ${b.label}`;
      }
    }
  }

  const clusters = [...clusterCounts.entries()].map(([id, count]) => ({
    id,
    name: `Klaster ${id + 1}`,
    count,
  }));

  const recentEvents = entries
    .slice(-6)
    .reverse()
    .map((e) => ({
      source: e.source,
      title: (e.title || e.prompt).replace(/\s+/g, " ").trim().slice(0, 64),
      timestamp: e.timestamp,
    }));

  return {
    version,
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
    clusters,
    sourceCounts,
    topConcepts,
    gapHint,
    recentEvents,
  };
}

export class AiMemoryHub {
  private readonly storePath: string;
  private entries: AiMemoryEntry[] = [];
  private customNodes: CustomNodeRecord[] = [];
  private version = 1;
  private cachedSnapshot: UnifiedGraphSnapshot;
  private server: http.Server | null = null;
  private syncTimer: NodeJS.Timeout | null = null;

  public constructor(baseDir: string) {
    this.storePath = path.join(baseDir, "data", "ai-memory-graph.json");
    this.loadFromDisk();
    this.cachedSnapshot = buildUnifiedKnowledgeGraph(this.entries, this.version, this.customNodes);
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as {
        entries?: AiMemoryEntry[];
        customNodes?: CustomNodeRecord[];
      };
      if (Array.isArray(parsed.entries)) {
        this.entries = parsed.entries.slice(-MAX_MEMORY_ENTRIES);
      }
      if (Array.isArray(parsed.customNodes)) {
        this.customNodes = parsed.customNodes.slice(-80);
      }
    } catch {
      this.entries = [];
      this.customNodes = [];
    }
  }

  private saveToDisk(): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(
        this.storePath,
        JSON.stringify(
          {
            entries: this.entries.slice(-MAX_MEMORY_ENTRIES),
            customNodes: this.customNodes.slice(-80),
          },
          null,
          2
        ),
        "utf8"
      );
    } catch {
      // Ignore disk persistence error
    }
  }

  private rebuild(): void {
    this.version += 1;
    this.cachedSnapshot = buildUnifiedKnowledgeGraph(this.entries, this.version, this.customNodes);
  }

  public addCustomNode(input: {
    label: string;
    note?: string;
    color?: string;
    connectTo?: string[];
  }): UnifiedGraphSnapshot {
    const label = input.label.trim().slice(0, 48);
    if (!label) {
      throw new Error("Nama custom node tidak boleh kosong.");
    }
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    const id = `custom:${slug || Date.now()}`;
    const validColor =
      typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color.trim())
        ? input.color.trim()
        : "#E05252";
    const connectTo = Array.isArray(input.connectTo)
      ? input.connectTo.map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 12)
      : [];
    const note = input.note?.trim().slice(0, 200);

    const record: CustomNodeRecord = {
      id,
      label,
      color: validColor,
      connectTo,
      createdAt: new Date().toISOString(),
      ...(note ? { note } : {}),
    };

    const idx = this.customNodes.findIndex((c) => c.id === id);
    if (idx !== -1) {
      this.customNodes[idx] = record;
    } else {
      this.customNodes.push(record);
    }

    this.saveToDisk();
    this.rebuild();
    return this.cachedSnapshot;
  }

  public deleteCustomNode(id: string): UnifiedGraphSnapshot {
    this.customNodes = this.customNodes.filter((c) => c.id !== id);
    this.saveToDisk();
    this.rebuild();
    return this.cachedSnapshot;
  }

  public getSnapshot(): UnifiedGraphSnapshot {
    return this.cachedSnapshot;
  }

  public ingest(input: {
    id?: string;
    source: AiMemorySource;
    title?: string;
    prompt: string;
    answer?: string;
    timestamp?: string;
  }): UnifiedGraphSnapshot {
    const prompt = input.prompt.trim().slice(0, 2400);
    if (!prompt) return this.cachedSnapshot;
    const answer = input.answer ? input.answer.trim().slice(0, 2400) : undefined;
    const id = input.id || `${input.source}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;

    const existingIdx = this.entries.findIndex((e) => e.id === id);
    const record: AiMemoryEntry = {
      id,
      source: input.source,
      prompt,
      timestamp: input.timestamp || new Date().toISOString(),
      ...(input.title ? { title: input.title.trim().slice(0, 120) } : {}),
      ...(answer ? { answer } : {}),
    };

    if (existingIdx !== -1) {
      this.entries[existingIdx] = record;
    } else {
      this.entries.push(record);
      if (this.entries.length > MAX_MEMORY_ENTRIES) {
        this.entries = this.entries.slice(-MAX_MEMORY_ENTRIES);
      }
    }

    this.saveToDisk();
    this.rebuild();
    return this.cachedSnapshot;
  }

  /**
   * Read-only scanner for local Antigravity brain directory (~/.gemini/antigravity/brain)
   * Pulls user prompts & conversation topics into the unified wallpaper knowledge graph.
   */
  public syncAntigravityBrain(customBrainDir?: string): number {
    const brainRoot = customBrainDir || path.join(os.homedir(), ".gemini", "antigravity", "brain");
    if (!fs.existsSync(brainRoot)) return 0;

    let added = 0;
    try {
      const convDirs = fs
        .readdirSync(brainRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => {
          const full = path.join(brainRoot, d.name);
          let mtimeMs = 0;
          try {
            mtimeMs = fs.statSync(full).mtimeMs;
          } catch {}
          return { name: d.name, full, mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 24);

      for (const conv of convDirs) {
        const transcriptPath = path.join(conv.full, ".system_generated", "logs", "transcript.jsonl");
        if (!fs.existsSync(transcriptPath)) continue;

        try {
          const stat = fs.statSync(transcriptPath);
          if (stat.size === 0 || stat.size > 24 * 1024 * 1024) continue;
          const raw = fs.readFileSync(transcriptPath, "utf8");
          const lines = raw.split("\n");
          const userPrompts: string[] = [];

          for (const line of lines) {
            if (!line.includes("USER_INPUT")) continue;
            try {
              const obj = JSON.parse(line) as { type?: string; content?: string };
              if (obj.type === "USER_INPUT" && typeof obj.content === "string") {
                const reqMatch = obj.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
                const rawText = reqMatch?.[1] ?? obj.content;
                const clean = rawText
                  .replace(/<[^>]+>/g, " ")
                  .replace(/\s+/g, " ")
                  .trim();
                if (clean.length >= 6) {
                  userPrompts.push(clean.slice(0, 260));
                }
              }
            } catch {
              // Skip malformed line
            }
          }

          if (userPrompts.length === 0) continue;
          const entryId = `antigravity:${conv.name}`;
          const combinedPrompt = userPrompts.slice(-14).join(" . ");
          const prev = this.entries.find((e) => e.id === entryId);
          if (prev && prev.prompt === combinedPrompt) continue;

          this.ingest({
            id: entryId,
            source: "antigravity",
            title: userPrompts[0]?.slice(0, 64) || "Antigravity Session",
            prompt: combinedPrompt,
            timestamp: new Date(stat.mtimeMs).toISOString(),
          });
          added += 1;
        } catch {
          // Skip unreadable conversation
        }
      }
    } catch {
      // Ignore fs error
    }

    return added;
  }

  public startLocalServer(port: number = AI_MEMORY_HUB_PORT): void {
    if (this.server) return;

    // Initial read-only sync of Antigravity brain + periodic background sync every 2 minutes
    this.syncAntigravityBrain();
    this.syncTimer = setInterval(() => {
      this.syncAntigravityBrain();
    }, 120_000);
    this.syncTimer.unref?.();

    const server = http.createServer((req, res) => {
      const origin = req.headers.origin || "";
      const allowOrigin =
        origin.startsWith("chrome-extension://") ||
        origin.startsWith("extension://") ||
        origin.startsWith("https://gemini.google.com") ||
        origin.startsWith("https://chatgpt.com") ||
        origin.startsWith("https://claude.ai") ||
        origin.startsWith("http://127.0.0.1") ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("http://tauri.localhost") ||
        origin.startsWith("tauri://")
          ? origin
          : "*";

      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const urlPath = (req.url || "/").split("?")[0];

      if (req.method === "GET" && (urlPath === "/" || urlPath === "/wallpaper.html" || urlPath === "/wallpaper.js")) {
        const uiDir = path.resolve(path.dirname(path.dirname(this.storePath)), "desktop", "ui");
        const targetName = urlPath === "/wallpaper.js" ? "wallpaper.js" : "wallpaper.html";
        const filePath = path.join(uiDir, targetName);
        if (fs.existsSync(filePath)) {
          const ct = targetName.endsWith(".js")
            ? "application/javascript; charset=utf-8"
            : "text/html; charset=utf-8";
          res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-store" });
          res.end(fs.readFileSync(filePath, "utf8"));
          return;
        }
      }

      if (req.method === "GET" && urlPath === "/health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, service: "aiku-memory-hub", port }));
        return;
      }

      if (req.method === "GET" && urlPath === "/graph") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(this.getSnapshot()));
        return;
      }

      if (req.method === "POST" && urlPath === "/sync-antigravity") {
        const added = this.syncAntigravityBrain();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, added, version: this.version }));
        return;
      }

      if (req.method === "POST" && (urlPath === "/custom-node" || urlPath === "/custom-node/delete")) {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
          if (body.length > 16384) req.destroy();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body || "{}") as {
              id?: string;
              label?: string;
              note?: string;
              color?: string;
              connectTo?: string[];
            };
            if (urlPath === "/custom-node/delete") {
              if (!payload.id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Missing id" }));
                return;
              }
              const snap = this.deleteCustomNode(payload.id);
              res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ ok: true, graph: snap }));
              return;
            }
            if (!payload.label || typeof payload.label !== "string") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: "Missing label" }));
              return;
            }
            const snap = this.addCustomNode({
              label: payload.label,
              ...(typeof payload.note === "string" ? { note: payload.note } : {}),
              ...(typeof payload.color === "string" ? { color: payload.color } : {}),
              ...(Array.isArray(payload.connectTo) ? { connectTo: payload.connectTo } : {}),
            });
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, graph: snap }));
          } catch (err: unknown) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Invalid payload" }));
          }
        });
        return;
      }

      if (req.method === "POST" && urlPath === "/ingest") {
        let body = "";
        let tooLarge = false;
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
          if (body.length > 65536) {
            tooLarge = true;
            req.destroy();
          }
        });
        req.on("end", () => {
          if (tooLarge) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Payload too large" }));
            return;
          }
          try {
            const payload = JSON.parse(body) as {
              source?: string;
              title?: string;
              prompt?: string;
              answer?: string;
            };
            const source: AiMemorySource =
              payload.source === "gemini-web" || payload.source === "antigravity" || payload.source === "aiku-local"
                ? payload.source
                : "gemini-web";
            if (!payload.prompt || typeof payload.prompt !== "string") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: "Missing prompt" }));
              return;
            }
            const snap = this.ingest({
              source,
              prompt: payload.prompt,
              ...(typeof payload.title === "string" ? { title: payload.title } : {}),
              ...(typeof payload.answer === "string" ? { answer: payload.answer } : {}),
            });
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, version: snap.version, nodeCount: snap.nodes.length }));
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
          }
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
    });

    server.on("error", () => {
      // If port already bound by another instance, fail gracefully without crashing worker
    });

    server.listen(port, "127.0.0.1");
    this.server = server;
  }

  public stopLocalServer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
