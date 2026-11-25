/* ============================================================================
   aiku — Interactive Obsidian Vault Galaxy Live Wallpaper
   Exact Aesthetic: Matte Charcoal (#161619) • Fine Hairline Edges •
   Coral Red Core Hubs • Indigo Antigravity Cluster • Butter Yellow Satellites •
   Full Pan / Zoom / Drag-Node / Hover-Spotlight / Click-Inspector Interactivity
   ============================================================================ */

(function () {
  const HUB_URL = "http://127.0.0.1:47891/graph";

  // Obsidian Galaxy Palette matching user's reference visual
  const COLOR_CORAL = "#E05252";   // Core hubs / aiku Local / Cross-AI bridges
  const COLOR_INDIGO = "#5C6CF5";  // Antigravity cluster
  const COLOR_YELLOW = "#E5D96B";  // Gemini Web / outer satellite & leaf nodes
  const COLOR_SILVER = "#C4C6CE";  // Secondary hub nodes
  const COLOR_SLATE = "#626573";   // Deep background supporting nodes

  const canvas = document.getElementById("wallpaper-canvas");
  const ctx = canvas.getContext("2d");

  let width = window.innerWidth;
  let height = window.innerHeight;
  let nodes = [];
  let edges = [];
  let clusters = [];
  let lastVersion = -1;
  let simAlpha = 1.0; // D3/Obsidian-style cooling: mulai 1.0 -> tenang sempurna ke 0.0!
  let animTime = 0;
  let orbitAngle = 0;

  // Motion & Animation Customizer State (persisted in localStorage)
  const MOTION_STORAGE_KEY = "aiku_wallpaper_motion_v1";
  let motionCfg = {
    mode: "still", // "still" | "float" | "orbit" | "pulse"
    speed: 0.8,
    spread: 1.0,
    edgeAlpha: 0.13,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(MOTION_STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") {
      if (["still", "float", "orbit", "pulse"].includes(saved.mode)) motionCfg.mode = saved.mode;
      if (Number.isFinite(Number(saved.speed))) motionCfg.speed = Math.max(0.2, Math.min(2.0, Number(saved.speed)));
      if (Number.isFinite(Number(saved.spread))) motionCfg.spread = Math.max(0.65, Math.min(1.6, Number(saved.spread)));
      if (Number.isFinite(Number(saved.edgeAlpha))) motionCfg.edgeAlpha = Math.max(0.04, Math.min(0.38, Number(saved.edgeAlpha)));
    }
  } catch {}

  function saveMotionCfg() {
    try {
      localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify(motionCfg));
    } catch {}
  }

  function getRenderPos(n, idx) {
    let x = n.x;
    let y = n.y;
    if (motionCfg.mode === "float" && n !== draggedNode) {
      const amp = 4.5 + (idx % 3) * 1.4;
      x += Math.sin(animTime * 0.75 + idx * 1.37) * amp;
      y += Math.cos(animTime * 0.65 + idx * 1.13) * amp;
    } else if (motionCfg.mode === "orbit" && n !== draggedNode) {
      const cx = width / 2;
      const cy = height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const cosA = Math.cos(orbitAngle);
      const sinA = Math.sin(orbitAngle);
      x = cx + dx * cosA - dy * sinA;
      y = cy + dx * sinA + dy * cosA;
    }
    return { x, y };
  }

  // Camera transform (Pan & Zoom)
  let camX = 0;
  let camY = 0;
  let zoom = 1;

  // Interactive pointer state
  let hoveredNode = null;
  let selectedNode = null;
  let draggedNode = null;
  let isPanning = false;
  let pointerDownPos = { x: 0, y: 0 };
  let panStartCam = { x: 0, y: 0 };
  let didDragMove = false;

  function resize() {
    width = Math.max(800, window.innerWidth);
    height = Math.max(500, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resize);
  resize();

  function screenToWorld(sx, sy) {
    return {
      x: (sx - width / 2 - camX) / zoom + width / 2,
      y: (sy - height / 2 - camY) / zoom + height / 2,
    };
  }

  function pickNodeColor(node, degree, rank, total) {
    if (node.isCustom && node.customColor) {
      return node.customColor;
    }
    const sources = Array.isArray(node.sources) ? node.sources : [];
    const isCrossAi = sources.length > 1;
    // Cross-AI bridges & top core hubs -> Coral Red (like central red nodes in reference)
    if (isCrossAi || (node.primarySource === "aiku-local" && rank <= Math.max(12, total * 0.2))) {
      return COLOR_CORAL;
    }
    // High-centrality core hubs -> Coral Red or Silver
    if (rank <= Math.max(8, total * 0.14)) {
      return node.cluster % 3 === 1 ? COLOR_INDIGO : COLOR_CORAL;
    }
    // Antigravity tight cluster -> Indigo Blue (top-left blue cluster in reference)
    if (node.primarySource === "antigravity" && node.cluster === 1) {
      return COLOR_INDIGO;
    }
    // Gemini Web or outer low-degree leaf/satellite nodes -> Butter Yellow (outer yellow dots in reference)
    if (node.primarySource === "gemini-web" || degree <= 2) {
      return COLOR_YELLOW;
    }
    // Mid-tier connectors -> Silver or Slate
    return degree >= 5 ? COLOR_SILVER : COLOR_SLATE;
  }

  function applySnapshot(snap) {
    if (!snap || !Array.isArray(snap.nodes)) return;
    if (snap.version === lastVersion) return;
    lastVersion = snap.version;

    const prevMap = new Map(nodes.map((n) => [n.id, n]));
    const cx = width / 2;
    const cy = height / 2;
    const rawNodes = snap.nodes;
    const rawEdges = snap.edges || [];

    // Compute degree for visual sizing & outer-ring placement
    const degMap = new Map();
    for (const e of rawEdges) {
      degMap.set(e.source, (degMap.get(e.source) || 0) + 1);
      degMap.set(e.target, (degMap.get(e.target) || 0) + 1);
    }

    const maxW = Math.max(1, ...rawNodes.map((n) => Number(n.weight) || 1));
    const galaxyR = Math.min(width, height) * 0.36;

    nodes = rawNodes.map((n, idx) => {
      const old = prevMap.get(n.id);
      const deg = degMap.get(n.id) || 0;
      const normW = (Number(n.weight) || 1) / maxW;
      const radius = deg <= 1 ? 2.6 : 2.8 + Math.pow(normW, 0.8) * 6.8;
      const color = pickNodeColor(n, deg, idx + 1, rawNodes.length);

      // Organic Obsidian Galaxy initial placement:
      // - Indigo cluster grouped cleanly at upper-left
      // - Core hubs near center
      // - Low-degree yellow satellites orbiting outer arc
      let initX, initY;
      if (color === COLOR_INDIGO) {
        const a = idx * 2.39996;
        const r = 18 + (idx % 12) * 7;
        initX = cx - galaxyR * 0.42 + Math.cos(a) * r;
        initY = cy - galaxyR * 0.56 + Math.sin(a) * r;
      } else if (deg <= 1) {
        const a = (idx / Math.max(1, rawNodes.length)) * Math.PI * 2;
        const r = galaxyR * (1.02 + (idx % 4) * 0.07);
        initX = cx + Math.cos(a) * r;
        initY = cy + Math.sin(a) * r;
      } else {
        const a = idx * 2.39996; // Golden angle spiral for natural galaxy distribution
        const r = Math.sqrt((idx + 1) / Math.max(1, rawNodes.length)) * galaxyR * 0.92;
        initX = cx + Math.cos(a) * r;
        initY = cy + Math.sin(a) * r;
      }

      return {
        ...n,
        rank: idx + 1,
        degree: deg,
        radius,
        color,
        x: old ? old.x : initX,
        y: old ? old.y : initY,
        vx: old ? old.vx * 0.4 : 0,
        vy: old ? old.vy * 0.4 : 0,
        fx: old ? old.fx : null,
        fy: old ? old.fy : null,
      };
    });

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    edges = rawEdges
      .map((e) => ({
        source: nodeMap.get(e.source),
        target: nodeMap.get(e.target),
        weight: Number(e.weight) || 1,
      }))
      .filter((e) => e.source && e.target);

    clusters = snap.clusters || [];
    // Pre-settle 80 iterasi diam-diam agar saat tampil langsung rapi & tenang (tanpa ledakan acak!)
    simAlpha = 0.85;
    for (let k = 0; k < 80; k++) {
      stepPhysics(true);
    }
    simAlpha = 0.25;

    // Update HUD counters
    const sc = snap.sourceCounts || {};
    const elLocal = document.getElementById("cnt-local");
    const elAg = document.getElementById("cnt-ag");
    const elGem = document.getElementById("cnt-gem");
    const elInsight = document.getElementById("hud-insight");
    if (elLocal) elLocal.textContent = String(sc["aiku-local"] || 0);
    if (elAg) elAg.textContent = String(sc.antigravity || 0);
    if (elGem) elGem.textContent = String(sc["gemini-web"] || 0);
    if (elInsight && nodes.length > 0) {
      elInsight.textContent = `${nodes.length} node • ${edges.length} koneksi • Scroll zoom • Drag & klik node`;
    }
  }

  async function pollGraph() {
    const urls = [HUB_URL, "/api/memory-graph"];
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && Array.isArray(data.nodes)) {
          applySnapshot(data);
          return;
        }
      } catch {}
    }
  }

  function findNodeAtWorld(wx, wy) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const pos = getRenderPos(n, i);
      const hitR = Math.max(7 / zoom, n.radius + 4 / zoom);
      if (Math.hypot(wx - pos.x, wy - pos.y) <= hitR) return n;
    }
    return null;
  }

  function openNodeInspector(node) {
    selectedNode = node;
    const card = document.getElementById("node-card");
    const dot = document.getElementById("nc-dot");
    const label = document.getElementById("nc-label");
    const meta = document.getElementById("nc-meta");
    const nbBox = document.getElementById("nc-neighbors");
    if (!card || !node) return;

    card.classList.remove("hidden");
    if (dot) dot.style.background = node.color;
    if (label) label.textContent = node.label;
    if (meta) meta.textContent = `${node.meta || node.clusterName} • ${node.degree} koneksi`;

    const delBtn = document.getElementById("nc-delete");
    if (delBtn) {
      delBtn.classList.toggle("hidden", !node.isCustom);
      delBtn.onclick = async () => {
        try {
          const res = await fetch("http://127.0.0.1:47891/custom-node/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: node.id }),
          });
          const data = await res.json();
          if (data?.graph) {
            selectedNode = null;
            card.classList.add("hidden");
            applySnapshot(data.graph);
          }
        } catch {}
      };
    }

    if (nbBox) {
      nbBox.innerHTML = "";
      const neighbors = [];
      for (const e of edges) {
        if (e.source.id === node.id) neighbors.push(e.target);
        else if (e.target.id === node.id) neighbors.push(e.source);
      }
      neighbors
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 14)
        .forEach((nb) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "nb-chip";
          btn.textContent = nb.label;
          btn.addEventListener("click", () => {
            openNodeInspector(nb);
            camX = (width / 2 - nb.x) * zoom;
            camY = (height / 2 - nb.y) * zoom;
          });
          nbBox.appendChild(btn);
        });
    }
  }

  // Interactive Pointer + Wheel Handlers
  canvas.addEventListener("pointerdown", (e) => {
    const world = screenToWorld(e.clientX, e.clientY);
    pointerDownPos = { x: e.clientX, y: e.clientY };
    didDragMove = false;
    const hit = findNodeAtWorld(world.x, world.y);

    if (hit) {
      draggedNode = hit;
      hit.fx = world.x;
      hit.fy = world.y;
      canvas.classList.add("grabbing");
    } else {
      isPanning = true;
      panStartCam = { x: camX, y: camY };
      canvas.classList.add("grabbing");
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  });

  canvas.addEventListener("pointermove", (e) => {
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (Math.hypot(dx, dy) > 4) didDragMove = true;

    const world = screenToWorld(e.clientX, e.clientY);

    if (draggedNode) {
      draggedNode.fx = world.x;
      draggedNode.fy = world.y;
      draggedNode.x = world.x;
      draggedNode.y = world.y;
      simAlpha = Math.max(simAlpha, 0.35); // Bangunkan pegas halus saat node ditarik
      return;
    }

    if (isPanning) {
      camX = panStartCam.x + dx;
      camY = panStartCam.y + dy;
      return;
    }

    const hit = findNodeAtWorld(world.x, world.y);
    hoveredNode = hit;
    canvas.classList.toggle("hovering", Boolean(hit));
  });

  const endPointer = () => {
    if (draggedNode) {
      const clicked = !didDragMove ? draggedNode : null;
      draggedNode.fx = null;
      draggedNode.fy = null;
      draggedNode = null;
      if (clicked) openNodeInspector(clicked);
    } else if (isPanning && !didDragMove) {
      selectedNode = null;
      document.getElementById("node-card")?.classList.add("hidden");
    }
    isPanning = false;
    canvas.classList.remove("grabbing");
  };

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const nextZoom = Math.max(0.45, Math.min(3.5, zoom * factor));
      const ratio = nextZoom / zoom;
      const mx = e.clientX - width / 2;
      const my = e.clientY - height / 2;
      camX = mx - (mx - camX) * ratio;
      camY = my - (my - camY) * ratio;
      zoom = nextZoom;
    },
    { passive: false }
  );

  // Controls
  document.getElementById("btn-zoom-in")?.addEventListener("click", () => {
    zoom = Math.min(3.5, zoom * 1.22);
  });
  document.getElementById("btn-zoom-out")?.addEventListener("click", () => {
    zoom = Math.max(0.45, zoom * 0.82);
  });
  document.getElementById("btn-reset-view")?.addEventListener("click", () => {
    camX = 0;
    camY = 0;
    zoom = 1;
    selectedNode = null;
    document.getElementById("node-card")?.classList.add("hidden");
  });
  document.getElementById("nc-close")?.addEventListener("click", () => {
    selectedNode = null;
    document.getElementById("node-card")?.classList.add("hidden");
  });

  // Custom Node Creator UI
  const customModal = document.getElementById("custom-node-modal");
  const cmLabel = document.getElementById("cm-label");
  const cmConnect = document.getElementById("cm-connect");
  const cmNote = document.getElementById("cm-note");
  let chosenCustomColor = "#E05252";

  document.getElementById("cm-colors")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".cm-swatch");
    if (!btn) return;
    chosenCustomColor = btn.dataset.color || "#E05252";
    document.querySelectorAll(".cm-swatch").forEach((s) => s.classList.toggle("active", s === btn));
  });

  document.getElementById("btn-add-node")?.addEventListener("click", () => {
    if (!customModal) return;
    const willOpen = customModal.classList.contains("hidden");
    customModal.classList.toggle("hidden", !willOpen);
    if (willOpen) {
      if (selectedNode && cmConnect && !cmConnect.value) {
        cmConnect.value = selectedNode.label;
      }
      setTimeout(() => cmLabel?.focus(), 30);
    }
  });

  document.getElementById("cm-cancel")?.addEventListener("click", () => {
    customModal?.classList.add("hidden");
  });

  customModal?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = (cmLabel?.value || "").trim();
    if (!label) return;
    const connectTo = (cmConnect?.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const note = (cmNote?.value || "").trim();

    try {
      const res = await fetch("http://127.0.0.1:47891/custom-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, note, color: chosenCustomColor, connectTo }),
      });
      const data = await res.json();
      if (data?.graph) {
        applySnapshot(data.graph);
        if (cmLabel) cmLabel.value = "";
        if (cmConnect) cmConnect.value = "";
        if (cmNote) cmNote.value = "";
        customModal.classList.add("hidden");
      }
    } catch {}
  });

  function stepPhysics(isPreSettle = false) {
    if (nodes.length === 0) return;
    if (!isPreSettle && simAlpha < 0.004 && !draggedNode) return;

    const alpha = isPreSettle ? 0.65 : simAlpha;
    const spread = motionCfg.spread || 1.0;
    const cx = width / 2;
    const cy = height / 2;
    const galaxyR = Math.min(width, height) * 0.35 * spread;

    // 1. Repulsion lembut dengan jarak aman minimum (anti ledakan/getar!)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > 26000 * spread) continue;
        const safeDistSq = Math.max(220, distSq);
        const dist = Math.sqrt(safeDistSq);
        const rep = ((a.cluster === b.cluster ? 95 : 165) * spread / safeDistSq) * alpha;
        const fx = (dx / dist) * rep;
        const fy = (dy / dist) * rep;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // 2. Pegas halus antar koneksi
    for (const e of edges) {
      const a = e.source;
      const b = e.target;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = (a.cluster === b.cluster ? 52 : 96) * spread;
      const f = (dist - target) * 0.0065 * alpha;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // 3. Gravitasi galaksi yang tenang + redaman kuat + batas kecepatan ketat
    const maxSpeed = isPreSettle ? 4.5 : 2.6;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.fx !== null && n.fy !== null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }

      if (n.color === COLOR_INDIGO) {
        const tx = cx - galaxyR * 0.44;
        const ty = cy - galaxyR * 0.56;
        n.vx += (tx - n.x) * 0.004 * alpha;
        n.vy += (ty - n.y) * 0.004 * alpha;
      } else if (n.degree <= 1) {
        const dx = n.x - cx;
        const dy = n.y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const desiredR = galaxyR * 1.06;
        const pull = (desiredR - dist) * 0.0035 * alpha;
        n.vx += (dx / dist) * pull;
        n.vy += (dy / dist) * pull;
      } else {
        n.vx += (cx - n.x) * 0.0022 * alpha;
        n.vy += (cy - n.y) * 0.0022 * alpha;
      }

      // Redaman tinggi -> gerakan super kalem & stabil seperti Obsidian
      n.vx *= 0.72;
      n.vy *= 0.72;

      const spd = Math.hypot(n.vx, n.vy);
      if (spd > maxSpeed) {
        n.vx = (n.vx / spd) * maxSpeed;
        n.vy = (n.vy / spd) * maxSpeed;
      }

      n.x += n.vx;
      n.y += n.vy;
    }

    if (!isPreSettle && !draggedNode) {
      simAlpha *= 0.965; // Mendingin halus lalu diam tenang (0% jitter!)
    }
  }

  function render() {
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Matte Dark Charcoal Obsidian Background (matches reference image)
    ctx.fillStyle = "#161619";
    ctx.fillRect(0, 0, width, height);

    // Apply Camera Pan + Zoom
    ctx.translate(width / 2 + camX, height / 2 + camY);
    ctx.scale(zoom, zoom);
    ctx.translate(-width / 2, -height / 2);

    const focusNode = hoveredNode || selectedNode;
    const focusSet = new Set();
    if (focusNode) {
      focusSet.add(focusNode.id);
      for (const e of edges) {
        if (e.source.id === focusNode.id) focusSet.add(e.target.id);
        if (e.target.id === focusNode.id) focusSet.add(e.source.id);
      }
    }

    const renderPosMap = new Map();
    for (let i = 0; i < nodes.length; i++) {
      renderPosMap.set(nodes[i].id, getRenderPos(nodes[i], i));
    }

    // 1. Ultra-Fine Straight Hairline Edges (Obsidian Vault signature look)
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei];
      const pA = renderPosMap.get(e.source.id) || e.source;
      const pB = renderPosMap.get(e.target.id) || e.target;
      const isFocus = focusNode && (e.source.id === focusNode.id || e.target.id === focusNode.id);
      const dimmed = focusNode && !isFocus;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      if (isFocus) {
        ctx.strokeStyle = focusNode.color;
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1.1 / zoom;
      } else {
        ctx.strokeStyle = "#d4d4dc";
        ctx.globalAlpha = dimmed ? 0.03 : motionCfg.edgeAlpha;
        ctx.lineWidth = 0.65 / zoom;
      }
      ctx.stroke();

      // Mode "Aliran Sinyal" (Pulse): percikan sinyal saraf AI meluncur halus sepanjang koneksi
      if (motionCfg.mode === "pulse" && !dimmed && ei % 2 === 0) {
        const t = (animTime * 0.24 + ei * 0.173) % 1;
        const sx = pA.x + (pB.x - pA.x) * t;
        const sy = pA.y + (pB.y - pA.y) * t;
        ctx.beginPath();
        ctx.arc(sx, sy, 1.8 / Math.sqrt(zoom), 0, Math.PI * 2);
        ctx.fillStyle = e.source.color;
        ctx.globalAlpha = 0.78;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // 2. Crisp Colored Nodes (Coral / Indigo / Yellow / Silver / Slate)
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const pos = renderPosMap.get(n.id) || n;
      const isMain = focusNode && focusNode.id === n.id;
      const isNeighbor = focusNode && focusSet.has(n.id);
      const dimmed = focusNode && !isNeighbor;

      const pulseR =
        motionCfg.mode === "pulse" && n.rank <= 10
          ? Math.sin(animTime * 2.2 + i) * 1.4 + 1.4
          : 0;

      if (isMain || pulseR > 0.2) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, n.radius + (isMain ? 6 : 3.5 + pulseR) / zoom, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.globalAlpha = isMain ? 0.24 : 0.14;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.globalAlpha = dimmed ? 0.18 : 0.95;
      ctx.fill();

      if (isMain) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.4 / zoom;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // 3. Clean Labels — hidden at rest (artwork look!), smoothly revealed on hover / selection / zoom > 1.45x
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const pos = renderPosMap.get(n.id) || n;
      const isMain = focusNode && focusNode.id === n.id;
      const isNeighbor = focusNode && focusSet.has(n.id);
      const showByZoom = zoom >= 1.45 && (n.rank <= 32 || zoom >= 2.1);
      if (!isMain && !isNeighbor && !showByZoom) continue;

      const fontSize = (isMain ? 12.5 : 10.2) / Math.pow(zoom, 0.45);
      ctx.font = `${isMain ? "600" : "400"} ${fontSize}px "Segoe UI Variable Text", Inter, sans-serif`;
      const tx = pos.x + n.radius + 5 / zoom;
      const ty = pos.y;

      ctx.fillStyle = isMain ? "#ffffff" : "rgba(228, 228, 231, 0.82)";
      ctx.fillText(n.label, tx, ty);
    }

    ctx.restore();
  }

  // Wire Motion & Animation Customizer UI
  const motionModal = document.getElementById("motion-modal");
  const slSpeed = document.getElementById("sl-speed");
  const slSpread = document.getElementById("sl-spread");
  const slEdge = document.getElementById("sl-edge");
  const valSpeed = document.getElementById("val-speed");
  const valSpread = document.getElementById("val-spread");
  const valEdge = document.getElementById("val-edge");

  function syncMotionUi() {
    document.querySelectorAll(".motion-mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === motionCfg.mode);
    });
    if (slSpeed) slSpeed.value = String(motionCfg.speed);
    if (slSpread) slSpread.value = String(motionCfg.spread);
    if (slEdge) slEdge.value = String(motionCfg.edgeAlpha);
    if (valSpeed) valSpeed.textContent = `${motionCfg.speed.toFixed(1)}x`;
    if (valSpread) valSpread.textContent = `${motionCfg.spread.toFixed(2)}x`;
    if (valEdge) valEdge.textContent = `${Math.round(motionCfg.edgeAlpha * 100)}%`;
  }
  syncMotionUi();

  document.getElementById("btn-motion-cfg")?.addEventListener("click", () => {
    if (!motionModal) return;
    customModal?.classList.add("hidden");
    motionModal.classList.toggle("hidden");
  });
  document.getElementById("mm-close")?.addEventListener("click", () => {
    motionModal?.classList.add("hidden");
  });
  document.getElementById("motion-modes")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".motion-mode-btn");
    if (!btn) return;
    motionCfg.mode = btn.dataset.mode || "still";
    if (motionCfg.mode !== "orbit") orbitAngle = 0;
    syncMotionUi();
    saveMotionCfg();
  });
  slSpeed?.addEventListener("input", () => {
    motionCfg.speed = Number(slSpeed.value) || 0.8;
    syncMotionUi();
    saveMotionCfg();
  });
  slSpread?.addEventListener("input", () => {
    motionCfg.spread = Number(slSpread.value) || 1.0;
    simAlpha = Math.max(simAlpha, 0.45);
    syncMotionUi();
    saveMotionCfg();
  });
  slEdge?.addEventListener("input", () => {
    motionCfg.edgeAlpha = Number(slEdge.value) || 0.13;
    syncMotionUi();
    saveMotionCfg();
  });

  function loop() {
    if (!document.hidden) {
      const spd = motionCfg.speed || 0.8;
      animTime += 0.016 * spd;
      if (motionCfg.mode === "orbit") {
        orbitAngle += 0.00085 * spd;
      }
      stepPhysics(false);
      render();
    }
    requestAnimationFrame(loop);
  }

  void pollGraph();
  setInterval(pollGraph, 2500);
  requestAnimationFrame(loop);
})();
