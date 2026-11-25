import path from "node:path";

export interface GraphNodePayload {
  id: string;
  label: string;
  cluster: number;
  clusterName: string;
  weight: number;
  kind: "folder" | "file" | "concept";
  meta?: string;
}

export interface GraphEdgePayload {
  source: string;
  target: string;
  weight: number;
}

export interface WorkspaceGraphPayload {
  nodes: GraphNodePayload[];
  edges: GraphEdgePayload[];
  clusters: Array<{ id: number; name: string; count: number }>;
  totalFilesScanned: number;
}

export interface IndexedFileLike {
  relativePath: string;
  sizeBytes: number;
}

const STOP_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "new",
  "copy",
  "final",
  "v1",
  "v2",
  "v3",
  "file",
  "data",
  "doc",
  "img",
  "pdf",
  "txt",
  "png",
  "jpg",
  "jpeg",
  "docx",
  "xlsx",
  "dan",
  "yang",
  "dari",
  "untuk",
  "ini",
  "itu",
]);

function extractNameTokens(fileName: string): string[] {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return stem
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t) && !/^\d+$/.test(t));
}

function classifyClusterName(relativePath: string): string {
  const norm = relativePath.replaceAll("\\", "/");
  const parts = norm.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0]) {
    return parts[0];
  }
  const ext = path.extname(norm).toLowerCase();
  if ([".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".pptx", ".xlsx", ".csv"].includes(ext)) {
    return "Dokumen";
  }
  if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".html", ".css", ".json"].includes(ext)) {
    return "Kode";
  }
  if ([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".bmp"].includes(ext)) {
    return "Gambar";
  }
  if ([".mp3", ".wav", ".m4a", ".mp4", ".mkv", ".mov"].includes(ext)) {
    return "Media";
  }
  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) {
    return "Arsip";
  }
  return "Umum";
}

export function buildWorkspaceGraph(
  entries: IndexedFileLike[],
  maxFiles: number = 64
): WorkspaceGraphPayload {
  const sampled = entries.slice(0, maxFiles);
  const clusterIds = new Map<string, number>();
  const clusterCounts = new Map<number, { name: string; count: number }>();

  const getClusterId = (name: string): number => {
    const existing = clusterIds.get(name);
    if (existing !== undefined) return existing;
    const nextId = clusterIds.size;
    clusterIds.set(name, nextId);
    clusterCounts.set(nextId, { name, count: 0 });
    return nextId;
  };

  const nodes: GraphNodePayload[] = [];
  const edges: GraphEdgePayload[] = [];
  const edgeKeys = new Set<string>();
  const tokenToFiles = new Map<string, string[]>();

  const addEdge = (a: string, b: string, weight: number): void => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source: a, target: b, weight });
  };

  // 1. Create folder/category hub nodes + file nodes
  const folderHubCreated = new Set<number>();
  for (let i = 0; i < sampled.length; i++) {
    const entry = sampled[i];
    if (!entry) continue;
    const norm = entry.relativePath.replaceAll("\\", "/");
    const baseName = path.basename(norm);
    const clusterName = classifyClusterName(norm);
    const clusterId = getClusterId(clusterName);
    const hubId = `hub:${clusterId}`;

    if (!folderHubCreated.has(clusterId)) {
      folderHubCreated.add(clusterId);
      nodes.push({
        id: hubId,
        label: clusterName,
        cluster: clusterId,
        clusterName,
        weight: 2.2,
        kind: "folder",
        meta: `Klaster ${clusterName}`,
      });
    }

    const fileId = `file:${i}`;
    nodes.push({
      id: fileId,
      label: baseName.length > 22 ? `${baseName.slice(0, 19)}…` : baseName,
      cluster: clusterId,
      clusterName,
      weight: 1,
      kind: "file",
      meta: norm,
    });

    const cStat = clusterCounts.get(clusterId);
    if (cStat) cStat.count += 1;

    addEdge(hubId, fileId, 1.4);

    // Track filename keywords to connect semantically related files across folders
    const tokens = extractNameTokens(baseName);
    for (const tok of tokens) {
      const list = tokenToFiles.get(tok) ?? [];
      list.push(fileId);
      tokenToFiles.set(tok, list);
    }
  }

  // 2. Semantic keyword edges between files sharing meaningful tokens
  for (const [, fileIds] of tokenToFiles.entries()) {
    if (fileIds.length < 2 || fileIds.length > 10) continue;
    for (let i = 0; i < fileIds.length; i++) {
      for (let j = i + 1; j < fileIds.length; j++) {
        const a = fileIds[i];
        const b = fileIds[j];
        if (a && b) addEdge(a, b, 0.9);
      }
    }
  }

  // 3. Re-rank node weights by degree centrality (InfraNodus style)
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + e.weight);
    degree.set(e.target, (degree.get(e.target) ?? 0) + e.weight);
  }
  for (const node of nodes) {
    const deg = degree.get(node.id) ?? 0;
    node.weight = Number((node.kind === "folder" ? 1.8 + deg * 0.35 : 0.8 + deg * 0.45).toFixed(2));
  }

  const clusters = [...clusterCounts.entries()].map(([id, info]) => ({
    id,
    name: info.name,
    count: info.count,
  }));

  return {
    nodes,
    edges,
    clusters,
    totalFilesScanned: entries.length,
  };
}
