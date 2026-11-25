/* ============================================================================
   aiku — Interactive InfraNodus-Style Knowledge & Reasoning Graph View
   100% Local HTML5 Canvas • 60fps Force-Directed Physics • Zero Dependencies
   ============================================================================ */

(function () {
  const CLUSTER_PALETTE = [
    "#5B9BF8", // Soft Cobalt
    "#9E8CFC", // Soft Violet
    "#52C99A", // Sage Mint
    "#F0B866", // Warm Amber
    "#E57CA8", // Soft Rose
    "#5AC4E6", // Ice Sky
  ];

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
    "contoh", "berikut", "pertama", "kedua", "ketiga", "utama", "penting", "hal", "cara",
    // English
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "have", "has",
    "had", "will", "would", "should", "could", "can", "into", "onto", "about", "their", "there",
    "they", "them", "then", "than", "what", "when", "where", "which", "while", "how", "why",
    "user", "wants", "need", "needs", "okay", "let", "start", "first", "next", "also", "just",
    "make", "like", "such", "more", "most", "some", "very", "only", "your", "you", "our", "not",
    "but", "out", "use", "using", "used", "based", "each", "over", "under", "between", "through",
  ]);

  function clusterColor(clusterId) {
    const idx = Math.abs(Number(clusterId) || 0) % CLUSTER_PALETTE.length;
    return CLUSTER_PALETTE[idx];
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function tokenizeSentence(sentence) {
    return sentence
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9\u00c0-\u024f_-]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && w.length <= 24 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  }

  /**
   * InfraNodus-style text -> concept graph extractor (co-occurrence + label propagation clustering + ranking)
   */
  function extractReasoningGraph(promptText, thoughtText, answerText, maxNodes = 26) {
    const combined = [promptText || "", thoughtText || "", answerText || ""].filter(Boolean).join("\n");
    if (!combined.trim()) {
      return { nodes: [], edges: [], clusters: [], topConcepts: [], gapHint: "" };
    }

    const sentences = combined
      .split(/[\n.!?;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 2);

    const freq = new Map();
    const pairWeights = new Map();

    for (const sent of sentences) {
      const toks = tokenizeSentence(sent);
      if (toks.length === 0) continue;
      for (let i = 0; i < toks.length; i++) {
        const w = toks[i];
        freq.set(w, (freq.get(w) || 0) + 1);
        // Sliding window of 4 words for semantic co-occurrence
        for (let j = i + 1; j < Math.min(toks.length, i + 5); j++) {
          const w2 = toks[j];
          if (w === w2) continue;
          const key = w < w2 ? `${w}|${w2}` : `${w2}|${w}`;
          pairWeights.set(key, (pairWeights.get(key) || 0) + (j === i + 1 ? 1.4 : 0.8));
        }
      }
    }

    // Pick top concepts by frequency
    const rankedTerms = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxNodes)
      .map(([term]) => term);

    const allowed = new Set(rankedTerms);
    const edges = [];
    const adj = new Map();
    for (const t of rankedTerms) adj.set(t, []);

    for (const [key, w] of pairWeights.entries()) {
      const [a, b] = key.split("|");
      if (!allowed.has(a) || !allowed.has(b)) continue;
      edges.push({ source: a, target: b, weight: Number(w.toFixed(2)) });
      adj.get(a).push({ to: b, w });
      adj.get(b).push({ to: a, w });
    }

    // Label propagation clustering (6 iterations) -> groups strongly connected concepts
    const clusterOf = new Map();
    rankedTerms.forEach((t, idx) => clusterOf.set(t, idx % 6));

    for (let iter = 0; iter < 6; iter++) {
      for (const term of rankedTerms) {
        const neighbors = adj.get(term) || [];
        if (neighbors.length === 0) continue;
        const scores = new Map();
        for (const nb of neighbors) {
          const c = clusterOf.get(nb.to);
          scores.set(c, (scores.get(c) || 0) + nb.w);
        }
        let bestC = clusterOf.get(term);
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

    // Compact cluster IDs to 0..k-1
    const compactMap = new Map();
    const clusterCounts = new Map();
    for (const term of rankedTerms) {
      const rawC = clusterOf.get(term);
      if (!compactMap.has(rawC)) compactMap.set(rawC, compactMap.size);
      const cid = compactMap.get(rawC);
      clusterOf.set(term, cid);
      clusterCounts.set(cid, (clusterCounts.get(cid) || 0) + 1);
    }

    // Weighted degree ranking (InfraNodus centrality proxy)
    const nodes = rankedTerms.map((term) => {
      const neighbors = adj.get(term) || [];
      const degWeight = neighbors.reduce((acc, nb) => acc + nb.w, 0);
      const tf = freq.get(term) || 1;
      const cid = clusterOf.get(term) || 0;
      return {
        id: term,
        label: term,
        cluster: cid,
        clusterName: `Klaster ${cid + 1}`,
        weight: Number((tf * 0.7 + degWeight * 0.9).toFixed(2)),
        kind: "concept",
        meta: `${tf}x muncul • ${neighbors.length} koneksi`,
      };
    });

    nodes.sort((a, b) => b.weight - a.weight);
    const topConcepts = nodes.slice(0, 3).map((n) => n.label);

    // Find a structural gap: top node of cluster 0 vs top node of cluster 1 if not directly linked
    let gapHint = "";
    if (compactMap.size >= 2) {
      const topByCluster = new Map();
      for (const n of nodes) {
        if (!topByCluster.has(n.cluster)) topByCluster.set(n.cluster, n);
      }
      const hubs = [...topByCluster.values()];
      if (hubs.length >= 2) {
        const a = hubs[0];
        const b = hubs[1];
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

    return { nodes, edges, clusters, topConcepts, gapHint };
  }

  class AikuGraphView {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.onNodeClick = opts.onNodeClick || (() => {});
      this.onStatsUpdate = opts.onStatsUpdate || (() => {});

      this.nodes = [];
      this.edges = [];
      this.clusters = [];
      this.topConcepts = [];
      this.gapHint = "";
      this.isStreaming = false;
      this.mode = "reasoning"; // "reasoning" | "workspace"

      this.hoveredNode = null;
      this.draggedNode = null;
      this.dragMoved = false;
      this.width = 600;
      this.height = 246;
      this.rafId = null;
      this.active = false;
      this.pulsePhase = 0;

      this._bindEvents();
    }

    _bindEvents() {
      const getPos = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      };

      this.canvas.addEventListener("pointerdown", (e) => {
        const pos = getPos(e);
        const hit = this._findNodeAt(pos.x, pos.y);
        if (hit) {
          this.draggedNode = hit;
          this.dragMoved = false;
          hit.fx = pos.x;
          hit.fy = pos.y;
          try {
            this.canvas.setPointerCapture(e.pointerId);
          } catch {}
        }
      });

      this.canvas.addEventListener("pointermove", (e) => {
        const pos = getPos(e);
        if (this.draggedNode) {
          this.dragMoved = true;
          this.draggedNode.fx = Math.max(18, Math.min(this.width - 18, pos.x));
          this.draggedNode.fy = Math.max(18, Math.min(this.height - 18, pos.y));
          this.draggedNode.x = this.draggedNode.fx;
          this.draggedNode.y = this.draggedNode.fy;
          this.canvas.style.cursor = "grabbing";
          return;
        }
        const hit = this._findNodeAt(pos.x, pos.y);
        this.hoveredNode = hit;
        this.canvas.style.cursor = hit ? "pointer" : "default";
      });

      const releaseDrag = (e) => {
        if (!this.draggedNode) return;
        const clicked = !this.dragMoved ? this.draggedNode : null;
        this.draggedNode.fx = null;
        this.draggedNode.fy = null;
        this.draggedNode = null;
        this.canvas.style.cursor = this.hoveredNode ? "pointer" : "default";
        if (clicked) {
          this.onNodeClick(clicked, this.mode);
        }
      };

      this.canvas.addEventListener("pointerup", releaseDrag);
      this.canvas.addEventListener("pointercancel", releaseDrag);
      this.canvas.addEventListener("pointerleave", () => {
        if (!this.draggedNode) {
          this.hoveredNode = null;
          this.canvas.style.cursor = "default";
        }
      });
    }

    _findNodeAt(x, y) {
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const n = this.nodes[i];
        const r = Math.max(10, n.radius + 5);
        if (Math.hypot(x - n.x, y - n.y) <= r) return n;
      }
      return null;
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(300, Math.round(rect.width || 600));
      const h = Math.max(180, Math.round(rect.height || 246));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = w;
      this.height = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    start() {
      if (this.active) return;
      this.active = true;
      this.resize();
      const loop = () => {
        if (!this.active) return;
        this.pulsePhase += 0.045;
        this._stepPhysics();
        this._render();
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }

    stop() {
      this.active = false;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    resetLayout() {
      const cx = this.width / 2;
      const cy = this.height / 2;
      for (let i = 0; i < this.nodes.length; i++) {
        const angle = (i / Math.max(1, this.nodes.length)) * Math.PI * 2;
        const rad = 36 + (i % 4) * 24;
        this.nodes[i].x = cx + Math.cos(angle) * rad;
        this.nodes[i].y = cy + Math.sin(angle) * rad;
        this.nodes[i].vx = 0;
        this.nodes[i].vy = 0;
      }
    }

    setData(payload, mode = "reasoning") {
      this.mode = mode;
      const prevById = new Map(this.nodes.map((n) => [n.id, n]));
      const cx = this.width / 2;
      const cy = this.height / 2;

      const rawNodes = payload.nodes || [];
      const maxW = Math.max(1, ...rawNodes.map((n) => Number(n.weight) || 1));

      this.nodes = rawNodes.map((n, idx) => {
        const old = prevById.get(n.id);
        const normW = (Number(n.weight) || 1) / maxW;
        const radius = Math.round(4.5 + normW * 9.5);
        const clusterAngle = ((n.cluster || 0) / Math.max(1, (payload.clusters?.length || 4))) * Math.PI * 2;
        const jitter = (idx % 5) * 10 + 18;
        return {
          ...n,
          rank: idx + 1,
          radius,
          x: old ? old.x : cx + Math.cos(clusterAngle + idx * 0.65) * (40 + jitter),
          y: old ? old.y : cy + Math.sin(clusterAngle + idx * 0.65) * (32 + jitter * 0.7),
          vx: old ? old.vx * 0.5 : 0,
          vy: old ? old.vy * 0.5 : 0,
          fx: old ? old.fx : null,
          fy: old ? old.fy : null,
        };
      });

      const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
      this.edges = (payload.edges || [])
        .map((e) => ({
          source: nodeMap.get(e.source),
          target: nodeMap.get(e.target),
          weight: Number(e.weight) || 1,
        }))
        .filter((e) => e.source && e.target);

      this.clusters = payload.clusters || [];
      this.topConcepts = payload.topConcepts || this.nodes.slice(0, 3).map((n) => n.label);
      this.gapHint = payload.gapHint || "";

      this.onStatsUpdate({
        mode: this.mode,
        nodeCount: this.nodes.length,
        edgeCount: this.edges.length,
        clusterCount: this.clusters.length,
        topConcepts: this.topConcepts,
        gapHint: this.gapHint,
        isStreaming: this.isStreaming,
      });
    }

    updateReasoning(promptText, thoughtText, answerText, isStreaming = false) {
      this.isStreaming = isStreaming;
      const graph = extractReasoningGraph(promptText, thoughtText, answerText, 26);
      this.setData(graph, "reasoning");
    }

    _stepPhysics() {
      const nodes = this.nodes;
      const edges = this.edges;
      if (nodes.length === 0) return;

      const cx = this.width / 2;
      const cy = this.height / 2;
      const clusterCount = Math.max(1, this.clusters.length);

      // 1. Repulsion (Coulomb)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distSq = dx * dx + dy * dy + 0.5;
          if (distSq > 36000) continue;
          const dist = Math.sqrt(distSq);
          const repulse = (a.cluster === b.cluster ? 520 : 880) / distSq;
          const fx = (dx / dist) * repulse;
          const fy = (dy / dist) * repulse;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // 2. Edge springs (Hooke)
      for (const e of edges) {
        const a = e.source;
        const b = e.target;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = a.cluster === b.cluster ? 52 : 84;
        const force = (dist - targetDist) * 0.018 * Math.min(2, e.weight);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      // 3. Soft cluster gravity + center gravity + damping
      for (const n of nodes) {
        if (n.fx !== null && n.fy !== null) {
          n.x = n.fx;
          n.y = n.fy;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        const angle = ((n.cluster || 0) / clusterCount) * Math.PI * 2;
        const anchorX = cx + Math.cos(angle) * Math.min(this.width * 0.22, 110);
        const anchorY = cy + Math.sin(angle) * Math.min(this.height * 0.2, 48);

        n.vx += (anchorX - n.x) * 0.008 + (cx - n.x) * 0.005;
        n.vy += (anchorY - n.y) * 0.008 + (cy - n.y) * 0.005;

        n.vx *= 0.84;
        n.vy *= 0.84;
        n.x = Math.max(24, Math.min(this.width - 24, n.x + n.vx));
        n.y = Math.max(22, Math.min(this.height - 22, n.y + n.vy));
      }
    }

    _render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      // Subtle obsidian radial backdrop
      const bg = ctx.createRadialGradient(
        this.width * 0.5,
        this.height * 0.48,
        12,
        this.width * 0.5,
        this.height * 0.5,
        this.width * 0.65
      );
      bg.addColorStop(0, "#0e0e14");
      bg.addColorStop(1, "#07070a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.width, this.height);

      if (this.nodes.length === 0) {
        ctx.fillStyle = "#71717a";
        ctx.font = '12px "Segoe UI Variable Text", Inter, sans-serif';
        ctx.textAlign = "center";
        ctx.fillText(
          this.mode === "reasoning"
            ? "Kirim pertanyaan atau /research untuk melihat peta pikiran AI secara live..."
            : "Memuat peta file folder Sandbox...",
          this.width / 2,
          this.height / 2
        );
        return;
      }

      const hovered = this.hoveredNode;
      const connectedSet = new Set();
      if (hovered) {
        connectedSet.add(hovered.id);
        for (const e of this.edges) {
          if (e.source.id === hovered.id) connectedSet.add(e.target.id);
          if (e.target.id === hovered.id) connectedSet.add(e.source.id);
        }
      }

      // 1. Curved Bezier Edges (InfraNodus style)
      for (const e of this.edges) {
        const isFocus = hovered && (e.source.id === hovered.id || e.target.id === hovered.id);
        const dimmed = hovered && !isFocus;
        const col = clusterColor(e.source.cluster);
        ctx.beginPath();
        const mx = (e.source.x + e.target.x) / 2;
        const my = (e.source.y + e.target.y) / 2;
        const dx = e.target.x - e.source.x;
        const dy = e.target.y - e.source.y;
        const curve = 0.14;
        const cpx = mx - dy * curve;
        const cpy = my + dx * curve;
        ctx.moveTo(e.source.x, e.source.y);
        ctx.quadraticCurveTo(cpx, cpy, e.target.x, e.target.y);
        ctx.strokeStyle = hexToRgba(col, dimmed ? 0.06 : isFocus ? 0.72 : 0.28);
        ctx.lineWidth = isFocus ? 1.5 : Math.min(1.4, 0.55 + e.weight * 0.25);
        ctx.stroke();
      }

      // 2. Nodes + Glow
      for (const n of this.nodes) {
        const isHover = hovered && hovered.id === n.id;
        const isNeighbor = hovered && connectedSet.has(n.id);
        const dimmed = hovered && !isNeighbor;
        const col = clusterColor(n.cluster);

        // Live pulse on top 3 ranked nodes while AI is streaming
        const livePulse =
          this.isStreaming && n.rank <= 3 ? Math.sin(this.pulsePhase + n.rank) * 2.2 + 2.2 : 0;

        if (isHover || n.rank <= 3 || livePulse > 0) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius + 5 + livePulse, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(col, dimmed ? 0.03 : isHover ? 0.28 : 0.14);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = dimmed ? hexToRgba(col, 0.22) : col;
        ctx.fill();

        if (isHover || n.rank <= 3) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
          ctx.lineWidth = isHover ? 1.6 : 0.9;
          ctx.stroke();
        }
      }

      // 3. Ranked Labels (Top hubs in [[concept]] style, secondary subtle)
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (const n of this.nodes) {
        const isHover = hovered && hovered.id === n.id;
        const isNeighbor = hovered && connectedSet.has(n.id);
        const dimmed = hovered && !isNeighbor;
        const showLabel = isHover || isNeighbor || n.rank <= 10 || n.kind === "folder";
        if (!showLabel) continue;

        const isTopHub = n.rank <= 3;
        const fontSize = isHover ? 12 : isTopHub ? 11.5 : 9.8;
        ctx.font = `${isHover || isTopHub ? "600" : "400"} ${fontSize}px "Segoe UI Variable Text", Inter, sans-serif`;
        const text = isTopHub && this.mode === "reasoning" ? `[[${n.label}]]` : n.label;
        const tx = n.x + n.radius + 5;
        const ty = n.y;

        if (isHover || isTopHub) {
          const metrics = ctx.measureText(text);
          ctx.fillStyle = "rgba(7, 7, 10, 0.76)";
          ctx.fillRect(tx - 3, ty - fontSize * 0.65, metrics.width + 6, fontSize * 1.3);
        }

        ctx.fillStyle = dimmed
          ? "rgba(161, 161, 170, 0.22)"
          : isHover || isTopHub
            ? "#f4f4f5"
            : "rgba(228, 228, 231, 0.78)";
        ctx.fillText(text, tx, ty);
      }

      // 4. Hover Meta Pill at top-left
      if (hovered) {
        const caption = `${hovered.label} • ${hovered.clusterName}${hovered.meta ? ` • ${hovered.meta}` : ""}`;
        ctx.font = '10.5px "JetBrains Mono", Consolas, monospace';
        const w = ctx.measureText(caption).width + 14;
        ctx.fillStyle = "rgba(12, 12, 16, 0.92)";
        ctx.fillRect(10, 10, w, 22);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
        ctx.lineWidth = 1;
        ctx.strokeRect(10, 10, w, 22);
        ctx.fillStyle = "#e4e4e7";
        ctx.fillText(caption, 17, 21);
      }
    }
  }

  window.AikuGraphView = AikuGraphView;
  window.extractReasoningGraph = extractReasoningGraph;
})();
