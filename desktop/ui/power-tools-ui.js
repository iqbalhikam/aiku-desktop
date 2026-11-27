/* ============================================================================
   aiku — Vertical App Drawer ("Semua Fitur") + 100% Local Power Tools Engine
   Includes: Screen Recorder Pro (FPS/Res/Bitrate/Audio), Offline OCR,
   Image Compressor/Converter, Local PDF Merger/Splitter, Quick Translate,
   Smart Converter + Password/UUID, Dev Port Killer, Network Ping, Diff Checker
   ============================================================================ */

(function () {
  const NAV_PIN_STORAGE_KEY = "aiku_navbar_pins_v1";
  const DEFAULT_NAV_PINS = ["home", "timer", "clipboard"];
  const MAX_NAV_TOTAL = 8; // 2 ikon tetap (aiku + Semua Fitur) + maksimal 6 pin kustom = 8
  const MAX_CUSTOM_PINS = MAX_NAV_TOTAL - 2;

  const AI_NAV_SVG =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 11.2a3.8 3.8 0 1 0 0 5.6v-5.6ZM13.5 14v3.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><path d="M16.9 10.6a5.4 5.4 0 0 1 0 6.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><path d="M19.5 8.4a8.4 8.4 0 0 1 0 11.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6" /></svg>';
  const ALL_FEATURES_NAV_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" opacity="0.65" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" opacity="0.65" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg>';

  const DRAWER_CATALOG = [
    {
      category: "Inti & Kontrol",
      items: [
        {
          id: "home",
          title: "Home",
          desc: "Media player, kontrol cepat, kecerahan & volume sistem",
          keywords: "home media volume brightness kontrol cepat",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5"/></svg>',
        },
        {
          id: "timer",
          title: "Timer & Fokus",
          desc: "Pomodoro & countdown melingkar langsung di Dynamic Island",
          keywords: "timer fokus pomodoro countdown jam",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2h5"/></svg>',
        },
        {
          id: "clipboard",
          title: "Clipboard Manager",
          desc: "Riwayat copy-paste instan dengan pencarian & fitur Pin",
          keywords: "clipboard copy paste salin riwayat",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1.2"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
        },
        {
          id: "ledge-settings",
          title: "Tema & Pengaturan",
          desc: "Ganti tema (Mono / Ledge / Ice / Rose), ukuran notch, Voice Studio & SKILL.md",
          keywords: "settings pengaturan tema warna ukuran voice skill",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.2" fill="currentColor"/><circle cx="15" cy="17" r="2.2" fill="currentColor"/></svg>',
        },
      ],
    },
    {
      category: "Media & Dokumen",
      items: [
        {
          id: "screen-rec",
          title: "Screen Recorder Pro",
          desc: "Rekam layar & aplikasi dengan pilihan FPS (24/30/60), Resolusi, Bitrate & Audio",
          keywords: "rekam layar screen recorder video fps bitrate",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="2" y="5" width="14" height="14" rx="2.5"/><polygon points="22 7 16 12 22 17 22 7"/></svg>',
        },
        {
          id: "ocr",
          title: "OCR Gambar & Screenshot Offline",
          desc: "Paste screenshot (Ctrl+V) atau drop gambar untuk ekstrak teks tanpa internet",
          keywords: "ocr teks gambar screenshot ekstrak baca",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
        },
        {
          id: "img-conv",
          title: "Image Compressor & Converter",
          desc: "Kompres ukuran foto hingga 80% lebih ringan & konversi PNG / WEBP / JPG",
          keywords: "kompres gambar foto convert webp png jpg ukuran",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
        },
        {
          id: "pdf-tools",
          title: "Local PDF Merger & Splitter",
          desc: "Gabungkan beberapa PDF jadi satu atau potong halaman tertentu 100% lokal",
          keywords: "pdf gabung merge potong split halaman dokumen",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6"/></svg>',
        },
        {
          id: "tray",
          title: "File Tray (Rak Simpan Cepat)",
          desc: "Tarik & simpan sementara file kerja penting agar gampang diakses",
          keywords: "file tray rak drop shelf simpan",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
        },
      ],
    },
    {
      category: "AI, Catatan & Produktivitas",
      items: [
        {
          id: "translate",
          title: "Quick Translate & Paraphrase",
          desc: "Terjemah Indo ↔ Inggris & perhalus kalimat (Formal, Santai, Ringkas) via Qwen3",
          keywords: "translate terjemah inggris indonesia formal paraphrase",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>',
        },
        {
          id: "converter",
          title: "Smart Converter, Password & UUID",
          desc: "Konversi satuan instan (px/rem, MB/GB, suhu) + generator Password aman & UUID v4",
          keywords: "converter konversi kalkulator password uuid px rem suhu",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="16" x2="12" y2="16"/></svg>',
        },
        {
          id: "notes",
          title: "Scratchpad Notes",
          desc: "Catatan cepat bebas gangguan yang tersimpan otomatis saat mengetik",
          keywords: "notes catatan scratchpad memo tulis",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
        },
        {
          id: "calendar",
          title: "Kalender & Jam",
          desc: "Lihat tanggal hari ini, minggu ke-berapa, dan kalender bulanan interaktif",
          keywords: "kalender calendar tanggal jam jadwal",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="4" width="18" height="18" rx="2.5"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
        },
      ],
    },
    {
      category: "Developer, Jaringan & Sistem",
      items: [
        {
          id: "ports",
          title: "Dev Port & Process Manager",
          desc: "Pantau port lokal yang aktif (3000, 5173, 8080) & matikan proses nyangkut 1-klik",
          keywords: "port process kill localhost 3000 5173 8080 node pid",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
        },
        {
          id: "net-diag",
          title: "Network Ping, IP Lokal & Wi-Fi",
          desc: "Cek kualitas ping (ms), jitter, nama Wi-Fi, IPv4 lokal, & server DNS",
          keywords: "network ping wifi ip internet dns latency rto",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>',
        },
        {
          id: "diff",
          title: "Diff Checker (Bandingkan Kode / Teks)",
          desc: "Bandingkan dua versi teks atau kode untuk melihat baris yang ditambah & dihapus",
          keywords: "diff bandingkan compare kode teks perbedaan",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3v18M3 8h6M6 5v6M15 16h6"/></svg>',
        },
        {
          id: "monitor",
          title: "System Monitor (CPU, RAM & Disk)",
          desc: "Grafik live penggunaan CPU, Memory, kecepatan Network, baterai & disk C:",
          keywords: "system monitor cpu ram memory baterai disk",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
        },
        {
          id: "action:graph-widget",
          title: "Knowledge Graph Widget",
          desc: "Buka/tutup widget peta pengetahuan lintas-AI (Lokal, Antigravity & Gemini)",
          keywords: "graph widget node peta ai",
          svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.8"/><path d="M8.2 7.2 15.6 7.1M7.3 8.2l3.4 7.3M16.7 9.2l-3.3 6.3"/></svg>',
        },
      ],
    },
  ];

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Gagal membaca file"));
      reader.readAsDataURL(file);
    });
  }

  function triggerDownloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function initAikuPowerTools(bridge) {
    // bridge: { rpc, showToast, switchTab, setIslandState, trackHitBox }

    // -------------------------------------------------------------------------
    // 1. ICON-ONLY "SEMUA FITUR" GRID + CUSTOMIZABLE NAVBAR PINS (DEFAULT 5, MAX 8)
    // -------------------------------------------------------------------------
    const drawerList = document.getElementById("af-drawer-list");
    const drawerSearch = document.getElementById("af-search-input");
    const navBarEl = document.getElementById("ledge-nav");
    const pinModeBtn = document.getElementById("af-btn-pin-mode");
    const pinCountEl = document.getElementById("af-pin-count");
    const pinResetBtn = document.getElementById("af-btn-pin-reset");
    const hoverTitleEl = document.getElementById("af-hover-title");
    const hoverDescEl = document.getElementById("af-hover-desc");

    const CATALOG_BY_ID = new Map();
    DRAWER_CATALOG.forEach((sec) => {
      sec.items.forEach((it) => CATALOG_BY_ID.set(it.id, it));
    });

    function loadNavbarPins() {
      try {
        const raw = localStorage.getItem(NAV_PIN_STORAGE_KEY);
        if (!raw) return [...DEFAULT_NAV_PINS];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid = [];
          for (const id of parsed) {
            if (typeof id === "string" && CATALOG_BY_ID.has(id) && !valid.includes(id)) {
              valid.push(id);
            }
            if (valid.length >= MAX_CUSTOM_PINS) break;
          }
          return valid;
        }
      } catch {}
      return [...DEFAULT_NAV_PINS];
    }

    let pinnedNavIds = loadNavbarPins();
    let pinEditMode = false;

    function saveNavbarPins() {
      localStorage.setItem(NAV_PIN_STORAGE_KEY, JSON.stringify(pinnedNavIds));
    }

    function setHoverPreview(title, desc) {
      if (hoverTitleEl) hoverTitleEl.textContent = title;
      if (hoverDescEl) hoverDescEl.textContent = desc;
    }

    function resetHoverPreview() {
      const total = pinnedNavIds.length + 2;
      if (pinEditMode) {
        setHoverPreview(
          `Mode Atur Pin (${total}/${MAX_NAV_TOTAL})`,
          "Klik ikon mana saja untuk pasang/lepas dari navbar atas"
        );
      } else {
        setHoverPreview(
          "Semua Fitur",
          `Arahkan kursor ke ikon untuk deskripsi • Klik kanan / tombol Pin untuk atur navbar (${total}/${MAX_NAV_TOTAL})`
        );
      }
    }

    function renderNavbar() {
      if (!navBarEl) return;
      const activePane = document.querySelector("#view-palette .ledge-pane.active");
      const activePaneId = activePane ? activePane.id.replace(/^ledge-pane-/, "") : "ai";
      const total = pinnedNavIds.length + 2;

      if (pinCountEl) pinCountEl.textContent = `Pin ${total}/${MAX_NAV_TOTAL}`;

      const frag = document.createDocumentFragment();

      const makeNavBtn = (tabId, svg, tip) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ledge-nav-btn";
        b.dataset.ledgeTab = tabId;
        b.dataset.tip = tip;
        b.setAttribute("aria-label", tip);
        b.innerHTML = svg;
        return b;
      };

      // 1. Fixed Start Anchor: aiku AI
      frag.appendChild(makeNavBtn("ai", AI_NAV_SVG, "aiku AI Assistant"));

      // 2. Custom Pinned Feature Icons (0..6)
      pinnedNavIds.forEach((id) => {
        const item = CATALOG_BY_ID.get(id);
        if (!item) return;
        frag.appendChild(makeNavBtn(item.id, item.svg, `${item.title} — ${item.desc}`));
      });

      // 3. Fixed End Anchor: Semua Fitur (icon-only)
      frag.appendChild(makeNavBtn("all-features", ALL_FEATURES_NAV_SVG, "Semua Fitur"));

      navBarEl.innerHTML = "";
      navBarEl.appendChild(frag);

      // Sync active pill highlight on the newly built navbar
      const isInNav = Boolean(navBarEl.querySelector(`.ledge-nav-btn[data-ledge-tab="${activePaneId}"]`));
      const targetNav = isInNav ? activePaneId : "all-features";
      navBarEl.querySelectorAll(".ledge-nav-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.ledgeTab === targetNav);
      });
    }

    function togglePinFeature(item) {
      const idx = pinnedNavIds.indexOf(item.id);
      if (idx !== -1) {
        pinnedNavIds.splice(idx, 1);
        saveNavbarPins();
        renderNavbar();
        renderDrawer();
        bridge.showToast(`"${item.title}" dilepas dari navbar (${pinnedNavIds.length + 2}/${MAX_NAV_TOTAL}).`, "info");
        return;
      }
      if (pinnedNavIds.length >= MAX_CUSTOM_PINS) {
        bridge.showToast(`Navbar sudah penuh (${MAX_NAV_TOTAL}/${MAX_NAV_TOTAL}). Lepas 1 ikon dulu.`, "warn");
        return;
      }
      pinnedNavIds.push(item.id);
      saveNavbarPins();
      renderNavbar();
      renderDrawer();
      bridge.showToast(`"${item.title}" di-pin ke navbar (${pinnedNavIds.length + 2}/${MAX_NAV_TOTAL})!`, "ok");
    }

    function renderDrawer() {
      if (!drawerList) return;
      const q = (drawerSearch?.value || "").trim().toLowerCase();
      drawerList.innerHTML = "";
      drawerList.classList.toggle("pin-editing", pinEditMode);

      DRAWER_CATALOG.forEach((sec) => {
        const matched = sec.items.filter(
          (it) =>
            !q ||
            it.title.toLowerCase().includes(q) ||
            it.desc.toLowerCase().includes(q) ||
            it.keywords.includes(q)
        );
        if (matched.length === 0) return;

        const secEl = document.createElement("div");
        secEl.className = "af-section";
        secEl.innerHTML = `<div class="af-sec-title">${sec.category}</div>`;

        const gridEl = document.createElement("div");
        gridEl.className = "af-icon-grid";

        matched.forEach((it) => {
          const isPinned = pinnedNavIds.includes(it.id);
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `af-icon-tile${isPinned ? " is-pinned" : ""}`;
          btn.dataset.tip = `${it.title} — ${it.desc}`;
          btn.setAttribute("aria-label", it.title);
          btn.innerHTML = `${it.svg}${isPinned ? '<span class="af-pin-dot" aria-hidden="true"></span>' : ""}`;

          btn.addEventListener("mouseenter", () => {
            const suffix = pinEditMode
              ? isPinned
                ? " (Klik untuk lepas dari navbar)"
                : " (Klik untuk pin ke navbar)"
              : isPinned
                ? " • Terpasang di Navbar"
                : "";
            setHoverPreview(it.title, `${it.desc}${suffix}`);
          });
          btn.addEventListener("focus", () => {
            setHoverPreview(it.title, it.desc);
          });
          btn.addEventListener("mouseleave", () => {
            resetHoverPreview();
          });

          btn.addEventListener("click", () => {
            if (pinEditMode) {
              togglePinFeature(it);
              return;
            }
            if (it.id === "action:graph-widget") {
              document.getElementById("btn-palette-graph")?.click();
              return;
            }
            bridge.switchTab(it.id);
          });

          btn.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            togglePinFeature(it);
          });

          gridEl.appendChild(btn);
        });

        secEl.appendChild(gridEl);
        drawerList.appendChild(secEl);
      });

      resetHoverPreview();
    }

    pinModeBtn?.addEventListener("click", () => {
      pinEditMode = !pinEditMode;
      pinModeBtn.classList.toggle("active", pinEditMode);
      pinResetBtn?.classList.toggle("hidden", !pinEditMode);
      renderDrawer();
    });

    pinResetBtn?.addEventListener("click", () => {
      pinnedNavIds = [...DEFAULT_NAV_PINS];
      saveNavbarPins();
      renderNavbar();
      renderDrawer();
      bridge.showToast("Navbar dikembalikan ke 5 ikon default.", "ok");
    });

    drawerSearch?.addEventListener("input", () => {
      renderDrawer();
      bridge.trackHitBox(260);
    });

    renderNavbar();
    renderDrawer();

    // -------------------------------------------------------------------------
    // 2. SCREEN RECORDER PRO (FPS, RESOLUTION, BITRATE, SYSTEM + MIC AUDIO)
    // -------------------------------------------------------------------------
    let mediaRecorder = null;
    let recChunks = [];
    let recStreams = [];
    let recAudioCtx = null;
    let recStartMs = 0;
    let recTimer = null;

    const srBtn = document.getElementById("sr-btn-toggle");
    const srStatus = document.getElementById("sr-status-text");
    const idleTimerPill = document.getElementById("idle-timer-pill");

    function cleanupRecordingStreams() {
      if (recTimer) {
        clearInterval(recTimer);
        recTimer = null;
      }
      recStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      recStreams = [];
      if (recAudioCtx) {
        void recAudioCtx.close().catch(() => {});
        recAudioCtx = null;
      }
      if (idleTimerPill && idleTimerPill.textContent?.startsWith("REC")) {
        idleTimerPill.classList.add("hidden");
      }
    }

    function stopScreenRecording() {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      } else {
        cleanupRecordingStreams();
      }
    }

    srBtn?.addEventListener("click", async () => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        stopScreenRecording();
        return;
      }

      const fps = Number(document.getElementById("sr-fps")?.value) || 30;
      const resH = Number(document.getElementById("sr-res")?.value) || 0;
      const bitrate = Number(document.getElementById("sr-bitrate")?.value) || 6000000;
      const audioMode = document.getElementById("sr-audio")?.value || "system";

      try {
        const videoConstraints = {
          frameRate: { ideal: fps, max: fps },
          ...(resH > 0 ? { height: { ideal: resH, max: resH } } : {}),
        };
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: audioMode !== "none",
        });
        recStreams.push(displayStream);

        let finalStream = displayStream;
        if (audioMode === "both") {
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            recStreams.push(micStream);
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            recAudioCtx = new AudioCtx();
            const dest = recAudioCtx.createMediaStreamDestination();
            if (displayStream.getAudioTracks().length > 0) {
              recAudioCtx.createMediaStreamSource(displayStream).connect(dest);
            }
            if (micStream.getAudioTracks().length > 0) {
              recAudioCtx.createMediaStreamSource(micStream).connect(dest);
            }
            finalStream = new MediaStream([
              ...displayStream.getVideoTracks(),
              ...dest.stream.getAudioTracks(),
            ]);
          } catch {
            // Fallback ke audio sistem saja bila mic ditolak
          }
        }

        const mimeCandidates = [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
        ];
        const chosenMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";

        recChunks = [];
        mediaRecorder = new MediaRecorder(finalStream, {
          ...(chosenMime ? { mimeType: chosenMime } : {}),
          videoBitsPerSecond: bitrate,
        });

        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) recChunks.push(ev.data);
        };

        mediaRecorder.onstop = () => {
          cleanupRecordingStreams();
          if (srBtn) srBtn.textContent = "Mulai Rekam Layar";
          if (recChunks.length > 0) {
            const blob = new Blob(recChunks, { type: chosenMime || "video/webm" });
            const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const fname = `aiku-record-${stamp}-${fps}fps.webm`;
            triggerDownloadBlob(blob, fname);
            if (srStatus) srStatus.textContent = `Tersimpan: ${fname} (${formatSize(blob.size)})`;
            bridge.showToast(`Rekaman disimpan (${formatSize(blob.size)})!`, "ok");
          }
          mediaRecorder = null;
        };

        displayStream.getVideoTracks()[0]?.addEventListener("ended", () => {
          stopScreenRecording();
        });

        mediaRecorder.start(500);
        recStartMs = Date.now();
        if (srBtn) srBtn.textContent = "Hentikan & Simpan";
        const updateRecElapsed = () => {
          const sec = Math.floor((Date.now() - recStartMs) / 1000);
          const mm = String(Math.floor(sec / 60)).padStart(2, "0");
          const ss = String(sec % 60).padStart(2, "0");
          if (srStatus) srStatus.textContent = `Merekam (${fps}fps • ${(bitrate / 1e6).toFixed(1)}Mbps) — ${mm}:${ss}`;
          if (idleTimerPill) {
            idleTimerPill.classList.remove("hidden");
            idleTimerPill.textContent = `REC ${mm}:${ss}`;
          }
        };
        updateRecElapsed();
        recTimer = setInterval(updateRecElapsed, 1000);
        // Kecilkan ke Idle Pill agar layar leluasa direkam!
        bridge.setIslandState("idle");
      } catch (err) {
        cleanupRecordingStreams();
        if (srStatus) srStatus.textContent = "Rekaman dibatalkan.";
      }
    });

    // -------------------------------------------------------------------------
    // 3. OFFLINE WINDOWS OCR (PASTE CTRL+V / DROP / PICK)
    // -------------------------------------------------------------------------
    const ocrOut = document.getElementById("ocr-output");
    const ocrMeta = document.getElementById("ocr-meta");

    async function processOcrFile(file) {
      if (!file) return;
      if (ocrMeta) ocrMeta.textContent = "Membaca teks gambar secara offline...";
      try {
        const b64 = await fileToBase64(file);
        const res = await bridge.rpc("ocrImage", { imageBase64: b64 });
        if (ocrOut) ocrOut.value = res.text || "";
        if (ocrMeta) {
          ocrMeta.textContent = res.text
            ? `Berhasil membaca ${res.lines} baris teks`
            : "Tidak ada teks yang terdeteksi di gambar ini";
        }
      } catch (err) {
        if (ocrMeta) ocrMeta.textContent = `Gagal OCR: ${err}`;
      }
    }

    document.getElementById("ocr-btn-pick")?.addEventListener("click", () => {
      document.getElementById("ocr-file-input")?.click();
    });
    document.getElementById("ocr-file-input")?.addEventListener("change", (e) => {
      if (e.target.files?.[0]) void processOcrFile(e.target.files[0]);
      e.target.value = "";
    });
    document.getElementById("ocr-dropzone")?.addEventListener("dragover", (e) => e.preventDefault());
    document.getElementById("ocr-dropzone")?.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.[0]) void processOcrFile(e.dataTransfer.files[0]);
    });
    document.addEventListener("paste", (e) => {
      const pane = document.getElementById("ledge-pane-ocr");
      if (!pane || !pane.classList.contains("active")) return;
      const items = Array.from(e.clipboardData?.items || []);
      const imgItem = items.find((it) => it.type.startsWith("image/"));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) void processOcrFile(file);
      }
    });
    document.getElementById("ocr-btn-copy")?.addEventListener("click", async () => {
      if (!ocrOut?.value) return;
      await navigator.clipboard.writeText(ocrOut.value);
      bridge.showToast("Hasil OCR disalin ke clipboard!", "ok");
    });

    // -------------------------------------------------------------------------
    // 4. IMAGE COMPRESSOR & FORMAT CONVERTER (PNG / WEBP / JPG)
    // -------------------------------------------------------------------------
    let loadedImgFile = null;
    let compressedBlob = null;
    const icFormat = document.getElementById("ic-format");
    const icQual = document.getElementById("ic-quality");
    const icQualVal = document.getElementById("ic-qual-val");
    const icStats = document.getElementById("ic-stats");
    const icSaveBtn = document.getElementById("ic-btn-save");

    async function recomputeImageCompression() {
      if (!loadedImgFile) return;
      const mime = icFormat?.value || "image/webp";
      const q = (Number(icQual?.value) || 80) / 100;
      if (icQualVal) icQualVal.textContent = `${Math.round(q * 100)}%`;

      const bmp = await createImageBitmap(loadedImgFile);
      const cvs = document.createElement("canvas");
      cvs.width = bmp.width;
      cvs.height = bmp.height;
      const c2d = cvs.getContext("2d");
      if (mime === "image/jpeg") {
        c2d.fillStyle = "#ffffff";
        c2d.fillRect(0, 0, cvs.width, cvs.height);
      }
      c2d.drawImage(bmp, 0, 0);
      bmp.close?.();

      compressedBlob = await new Promise((res) => cvs.toBlob(res, mime, q));
      if (compressedBlob && icStats) {
        const savedPct = Math.round((1 - compressedBlob.size / loadedImgFile.size) * 100);
        const diffTag = savedPct > 0 ? `hemat ${savedPct}%` : `${Math.abs(savedPct)}% lebih besar`;
        icStats.textContent = `${formatSize(loadedImgFile.size)} → ${formatSize(compressedBlob.size)} (${diffTag})`;
        if (icSaveBtn) icSaveBtn.disabled = false;
      }
    }

    document.getElementById("ic-btn-pick")?.addEventListener("click", () => {
      document.getElementById("ic-file-input")?.click();
    });
    document.getElementById("ic-file-input")?.addEventListener("change", (e) => {
      if (e.target.files?.[0]) {
        loadedImgFile = e.target.files[0];
        void recomputeImageCompression();
      }
      e.target.value = "";
    });
    icFormat?.addEventListener("change", () => void recomputeImageCompression());
    icQual?.addEventListener("input", () => void recomputeImageCompression());
    icSaveBtn?.addEventListener("click", () => {
      if (!compressedBlob || !loadedImgFile) return;
      const mime = icFormat?.value || "image/webp";
      const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
      const stem = loadedImgFile.name.replace(/\.[^.]+$/, "");
      triggerDownloadBlob(compressedBlob, `${stem}-aiku.${ext}`);
    });

    // -------------------------------------------------------------------------
    // 5. LOCAL PDF MERGER & PAGE SPLITTER
    // -------------------------------------------------------------------------
    let pdfMode = "merge";
    let selectedPdfs = [];
    const pdfInfo = document.getElementById("pdf-files-info");
    const pdfSplitRow = document.getElementById("pdf-split-row");

    document.getElementById("pdf-mode-pills")?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".ls-pill");
      if (!btn?.dataset.pdfMode) return;
      pdfMode = btn.dataset.pdfMode;
      document.querySelectorAll("#pdf-mode-pills .ls-pill").forEach((b) => b.classList.toggle("active", b === btn));
      pdfSplitRow?.classList.toggle("hidden", pdfMode !== "split");
      selectedPdfs = [];
      if (pdfInfo) {
        pdfInfo.textContent =
          pdfMode === "merge"
            ? "Pilih minimal 2 file PDF untuk digabungkan."
            : "Pilih 1 file PDF lalu isi nomor halaman yang ingin diambil.";
      }
      bridge.trackHitBox(260);
    });
    document.getElementById("pdf-btn-pick")?.addEventListener("click", () => {
      const inp = document.getElementById("pdf-file-input");
      if (!inp) return;
      inp.multiple = pdfMode === "merge";
      inp.click();
    });
    document.getElementById("pdf-file-input")?.addEventListener("change", (e) => {
      selectedPdfs = Array.from(e.target.files || []);
      if (pdfInfo && selectedPdfs.length > 0) {
        pdfInfo.textContent = `${selectedPdfs.length} file siap: ${selectedPdfs.map((f) => f.name).join(", ")}`;
      }
      e.target.value = "";
    });
    document.getElementById("pdf-btn-run")?.addEventListener("click", async () => {
      try {
        if (pdfMode === "merge") {
          if (selectedPdfs.length < 2) {
            bridge.showToast("Pilih minimal 2 file PDF dulu.", "err");
            return;
          }
          const b64List = await Promise.all(selectedPdfs.map(fileToBase64));
          const res = await bridge.rpc("pdfMerge", { filesBase64: b64List });
          const bytes = Uint8Array.from(atob(res.pdfBase64), (c) => c.charCodeAt(0));
          triggerDownloadBlob(new Blob([bytes], { type: "application/pdf" }), "aiku-merged.pdf");
          bridge.showToast(`PDF berhasil digabung (${res.totalPages} halaman)!`, "ok");
        } else {
          if (selectedPdfs.length < 1) {
            bridge.showToast("Pilih 1 file PDF dulu.", "err");
            return;
          }
          const rangeSpec = (document.getElementById("pdf-range-input")?.value || "").trim();
          if (!rangeSpec) {
            bridge.showToast("Isi rentang halaman dulu (mis. 1-3, 5).", "err");
            return;
          }
          const b64 = await fileToBase64(selectedPdfs[0]);
          const res = await bridge.rpc("pdfSplit", { pdfBase64: b64, rangeSpec });
          const bytes = Uint8Array.from(atob(res.pdfBase64), (c) => c.charCodeAt(0));
          triggerDownloadBlob(new Blob([bytes], { type: "application/pdf" }), "aiku-split.pdf");
          bridge.showToast(`Berhasil mengambil ${res.extractedPages} halaman!`, "ok");
        }
      } catch (err) {
        bridge.showToast(`Gagal memproses PDF: ${err}`, "err");
      }
    });

    // -------------------------------------------------------------------------
    // 6. QUICK TRANSLATE & PARAPHRASE (REAL-TIME AUTO STREAMING + DUAL COPY)
    // -------------------------------------------------------------------------
    const trInput = document.getElementById("tr-input");
    const trOut = document.getElementById("tr-output");
    const trLang = document.getElementById("tr-lang");
    const trStyle = document.getElementById("tr-style");
    const trSwapBtn = document.getElementById("tr-btn-swap");
    const trCopyInputBtn = document.getElementById("tr-copy-input");
    const trCopyOutputBtn = document.getElementById("tr-copy-output");
    const trLiveBadge = document.getElementById("tr-live-status");
    const trLiveText = document.getElementById("tr-live-text");

    let trDebounceTimer = null;
    let trRequestSeq = 0;

    function setTranslateLiveState(mode, text) {
      if (!trLiveBadge || !trLiveText) return;
      trLiveBadge.classList.remove("busy", "ready");
      if (mode === "busy") trLiveBadge.classList.add("busy");
      if (mode === "ready") trLiveBadge.classList.add("ready");
      trLiveText.textContent = text;
    }

    function cleanTranslateOutput(raw) {
      return String(raw || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<think>[\s\S]*$/gi, "")
        .replace(/^["“”]+|["“”]+$/g, "")
        .trimStart();
    }

    async function runRealtimeTranslate() {
      const text = (trInput?.value || "").trim();
      if (!text) {
        trRequestSeq++;
        if (trOut) trOut.value = "";
        setTranslateLiveState("idle", "Live Otomatis");
        return;
      }

      const mySeq = ++trRequestSeq;
      const targetLang = trLang?.value || "en";
      const style = trStyle?.value || "natural";
      let streamedRaw = "";

      setTranslateLiveState("busy", "Menerjemahkan...");

      try {
        if (typeof bridge.rpcStream === "function") {
          const res = await bridge.rpcStream(
            "quickTranslate",
            { text, targetLang, style },
            (chunk) => {
              if (mySeq !== trRequestSeq) return;
              streamedRaw += chunk;
              if (trOut) {
                trOut.value = cleanTranslateOutput(streamedRaw);
              }
            }
          );
          if (mySeq !== trRequestSeq || res?.aborted) return;
          if (trOut) {
            trOut.value = cleanTranslateOutput(res?.result || streamedRaw).trim();
          }
        } else {
          const res = await bridge.rpc("quickTranslate", { text, targetLang, style });
          if (mySeq !== trRequestSeq || res?.aborted) return;
          if (trOut) {
            trOut.value = cleanTranslateOutput(res?.result || "").trim();
          }
        }
        setTranslateLiveState("ready", "Selesai • Live");
      } catch (err) {
        if (mySeq !== trRequestSeq) return;
        setTranslateLiveState("idle", "Live Otomatis");
        bridge.showToast(`Gagal menerjemahkan: ${err}`, "err");
      }
    }

    function scheduleRealtimeTranslate(delayMs = 340) {
      if (trDebounceTimer) clearTimeout(trDebounceTimer);
      const val = (trInput?.value || "").trim();
      if (!val) {
        trRequestSeq++;
        if (trOut) trOut.value = "";
        setTranslateLiveState("idle", "Live Otomatis");
        return;
      }
      setTranslateLiveState("busy", "Mengetik...");
      trDebounceTimer = setTimeout(() => {
        void runRealtimeTranslate();
      }, delayMs);
    }

    trInput?.addEventListener("input", () => scheduleRealtimeTranslate(340));
    trInput?.addEventListener("paste", () => scheduleRealtimeTranslate(80));
    trLang?.addEventListener("change", () => scheduleRealtimeTranslate(0));
    trStyle?.addEventListener("change", () => scheduleRealtimeTranslate(0));

    trSwapBtn?.addEventListener("click", () => {
      if (!trLang) return;
      trLang.value = trLang.value === "en" ? "id" : "en";
      const prevOut = (trOut?.value || "").trim();
      if (prevOut && trInput) {
        trInput.value = prevOut;
      }
      scheduleRealtimeTranslate(0);
    });

    function wireTranslateCopyBtn(btnEl, textareaEl, toastMsg) {
      if (!btnEl || !textareaEl) return;
      const copyIconSvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      const checkIconSvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>';

      btnEl.addEventListener("click", async () => {
        const val = (textareaEl.value || "").trim();
        if (!val) {
          bridge.showToast("Kotak teks masih kosong.", "info");
          return;
        }
        try {
          await navigator.clipboard.writeText(val);
          bridge.recordClip?.(val);
          btnEl.classList.add("copied");
          btnEl.innerHTML = `${checkIconSvg}<span class="tr-copy-label">Tersalin</span>`;
          bridge.showToast(toastMsg, "ok");
          setTimeout(() => {
            btnEl.classList.remove("copied");
            btnEl.innerHTML = `${copyIconSvg}<span class="tr-copy-label">Salin</span>`;
          }, 1500);
        } catch {
          bridge.showToast("Gagal menyalin teks ke clipboard.", "err");
        }
      });
    }

    wireTranslateCopyBtn(trCopyInputBtn, trInput, "Teks asli disalin ke clipboard!");
    wireTranslateCopyBtn(trCopyOutputBtn, trOut, "Hasil terjemahan disalin ke clipboard!");

    // -------------------------------------------------------------------------
    // 7. SMART CONVERTER + PASSWORD & UUID GENERATOR
    // -------------------------------------------------------------------------
    const cvInput = document.getElementById("cv-input");
    const cvResult = document.getElementById("cv-result");

    function evalSmartConverter(raw) {
      const s = raw.trim().toLowerCase();
      if (!s) return "Ketik ekspresi di atas untuk hasil instan";

      // px <-> rem
      let m = s.match(/^([\d.]+)\s*px(?:\s+(?:to|ke|in)\s+rem)?$/);
      if (m) return `${(Number(m[1]) / 16).toFixed(4).replace(/\.?0+$/, "")}rem (basis 16px)`;
      m = s.match(/^([\d.]+)\s*rem(?:\s+(?:to|ke|in)\s+px)?$/);
      if (m) return `${(Number(m[1]) * 16).toFixed(2).replace(/\.?0+$/, "")}px`;

      // Data sizes
      const dataUnits = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
      m = s.match(/^([\d.]+)\s*(b|kb|mb|gb|tb)\s+(?:to|ke|in)\s+(b|kb|mb|gb|tb)$/);
      if (m) {
        const val = (Number(m[1]) * dataUnits[m[2]]) / dataUnits[m[3]];
        return `${val.toFixed(4).replace(/\.?0+$/, "")} ${m[3].toUpperCase()}`;
      }

      // Temp C <-> F
      m = s.match(/^(-?[\d.]+)\s*c\s+(?:to|ke|in)\s+f$/);
      if (m) return `${((Number(m[1]) * 9) / 5 + 32).toFixed(2)} °F`;
      m = s.match(/^(-?[\d.]+)\s*f\s+(?:to|ke|in)\s+c$/);
      if (m) return `${(((Number(m[1]) - 32) * 5) / 9).toFixed(2)} °C`;

      // Length km/m/cm <-> mi/ft/in
      const lenM = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, mi: 1609.344 };
      m = s.match(/^([\d.]+)\s*(mm|cm|m|km|in|ft|mi)\s+(?:to|ke|in)\s+(mm|cm|m|km|in|ft|mi)$/);
      if (m) {
        const val = (Number(m[1]) * lenM[m[2]]) / lenM[m[3]];
        return `${val.toFixed(4).replace(/\.?0+$/, "")} ${m[3]}`;
      }

      // Percentage e.g. "25% of 350000" or safe arithmetic
      const pctOf = s.match(/^([\d.]+)%\s*(?:of|dari|\*)\s*([\d.]+)$/);
      if (pctOf) {
        const v = (Number(pctOf[1]) / 100) * Number(pctOf[2]);
        return v.toLocaleString("id-ID");
      }

      if (/^[\d+\-*/().%\s]+$/.test(s)) {
        try {
          const normalized = s.replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
          const val = Function(`"use strict"; return (${normalized});`)();
          if (typeof val === "number" && Number.isFinite(val)) {
            return val.toLocaleString("id-ID", { maximumFractionDigits: 6 });
          }
        } catch {}
      }

      return "Format contoh: 24px to rem • 1500 mb to gb • 100 f to c • 15% * 250000";
    }

    cvInput?.addEventListener("input", () => {
      if (cvResult) cvResult.textContent = evalSmartConverter(cvInput.value);
    });
    cvResult?.addEventListener("click", async () => {
      if (!cvResult.textContent) return;
      await navigator.clipboard.writeText(cvResult.textContent);
      bridge.showToast("Hasil disalin!", "ok");
    });

    function genSecurePass(len) {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=";
      const arr = new Uint32Array(len);
      crypto.getRandomValues(arr);
      return Array.from(arr, (x) => chars[x % chars.length]).join("");
    }

    document.getElementById("cv-btn-pass16")?.addEventListener("click", async () => {
      const p = genSecurePass(16);
      if (cvResult) cvResult.textContent = p;
      await navigator.clipboard.writeText(p);
      bridge.showToast("Password 16 karakter disalin!", "ok");
    });
    document.getElementById("cv-btn-pass24")?.addEventListener("click", async () => {
      const p = genSecurePass(24);
      if (cvResult) cvResult.textContent = p;
      await navigator.clipboard.writeText(p);
      bridge.showToast("Password 24 karakter disalin!", "ok");
    });
    document.getElementById("cv-btn-uuid")?.addEventListener("click", async () => {
      const u = crypto.randomUUID();
      if (cvResult) cvResult.textContent = u;
      await navigator.clipboard.writeText(u);
      bridge.showToast("UUID v4 disalin!", "ok");
    });

    // -------------------------------------------------------------------------
    // 8. DEV PORT & PROCESS MANAGER
    // -------------------------------------------------------------------------
    let cachedPorts = [];
    const dpList = document.getElementById("dp-list");
    const dpFilter = document.getElementById("dp-filter");

    function renderPorts() {
      if (!dpList) return;
      const q = (dpFilter?.value || "").trim().toLowerCase();
      const filtered = cachedPorts.filter(
        (p) => !q || String(p.port).includes(q) || p.processName.toLowerCase().includes(q)
      );
      dpList.innerHTML = "";
      if (filtered.length === 0) {
        dpList.innerHTML = `<div class="lc-item-row"><span class="lc-item-text" style="color:#71717a">Tidak ada port yang cocok.</span></div>`;
        return;
      }
      filtered.forEach((p) => {
        const row = document.createElement("div");
        row.className = "lc-item-row";
        row.innerHTML = `
          <div class="lc-item-left mono">
            <strong style="color:#ffffff">:${p.port}</strong>
            <span class="lc-item-text">${p.processName} <span style="color:#686875">(PID ${p.pid} • ${p.address})</span></span>
          </div>
          <button type="button" class="dp-kill-btn mono">Kill</button>
        `;
        row.querySelector(".dp-kill-btn")?.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          try {
            const res = await bridge.rpc("killDevPort", { pid: p.pid });
            bridge.showToast(res.message, "ok");
            void refreshPorts();
          } catch (err) {
            bridge.showToast(`Gagal menghentikan port: ${err}`, "err");
          }
        });
        dpList.appendChild(row);
      });
    }

    async function refreshPorts() {
      if (dpList) dpList.innerHTML = `<div class="lc-item-row"><span class="lc-item-text">Memindai port aktif...</span></div>`;
      try {
        const res = await bridge.rpc("listDevPorts");
        cachedPorts = res.ports || [];
        renderPorts();
        bridge.trackHitBox(260);
      } catch {}
    }

    dpFilter?.addEventListener("input", renderPorts);
    document.getElementById("dp-btn-refresh")?.addEventListener("click", () => void refreshPorts());

    // -------------------------------------------------------------------------
    // 9. NETWORK PING, LOCAL IP & WI-FI DIAGNOSTICS
    // -------------------------------------------------------------------------
    async function runNetDiag() {
      const cfEl = document.getElementById("nd-cf");
      const ggEl = document.getElementById("nd-gg");
      const stEl = document.getElementById("nd-status");
      if (cfEl) cfEl.textContent = "...";
      if (ggEl) ggEl.textContent = "...";
      try {
        const d = await bridge.rpc("netDiagnostics");
        if (cfEl) cfEl.textContent = d.cloudflareMs !== null ? `${d.cloudflareMs} ms` : "Timeout";
        if (ggEl) ggEl.textContent = d.googleMs !== null ? `${d.googleMs} ms` : "Timeout";
        if (stEl) stEl.textContent = `${d.status} (±${d.jitterMs}ms)`;
        const ssidEl = document.getElementById("nd-ssid");
        const ipEl = document.getElementById("nd-ip");
        const dnsEl = document.getElementById("nd-dns");
        if (ssidEl) ssidEl.textContent = d.ssid;
        if (ipEl) ipEl.textContent = d.localIpv4;
        if (dnsEl) dnsEl.textContent = (d.dnsServers || []).join(", ") || "-";
      } catch {}
    }
    document.getElementById("nd-btn-run")?.addEventListener("click", () => void runNetDiag());

    // -------------------------------------------------------------------------
    // 10. DIFF CHECKER (INLINE LINE-BY-LINE LCS DIFF)
    // -------------------------------------------------------------------------
    const dfLeft = document.getElementById("df-left");
    const dfRight = document.getElementById("df-right");
    const dfOut = document.getElementById("df-output");

    function computeLineDiff() {
      if (!dfOut) return;
      const a = (dfLeft?.value || "").split("\n");
      const b = (dfRight?.value || "").split("\n");
      if (!dfLeft?.value && !dfRight?.value) {
        dfOut.textContent = "Ketik atau tempel dua potongan teks di atas untuk melihat perbedaan baris.";
        return;
      }

      const maxLines = 120;
      const aSlice = a.slice(0, maxLines);
      const bSlice = b.slice(0, maxLines);
      const html = [];
      let i = 0;
      let j = 0;

      while (i < aSlice.length || j < bSlice.length) {
        const la = aSlice[i];
        const lb = bSlice[j];
        const escLine = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

        if (i < aSlice.length && j < bSlice.length && la === lb) {
          html.push(`<div style="color:#787886">  ${escLine(la)}</div>`);
          i++;
          j++;
        } else if (j < bSlice.length && (i >= aSlice.length || aSlice[i + 1] === lb)) {
          if (i < aSlice.length) {
            html.push(`<div class="df-del">− ${escLine(la)}</div>`);
            i++;
          } else {
            html.push(`<div class="df-add">+ ${escLine(lb)}</div>`);
            j++;
          }
        } else if (i < aSlice.length && j < bSlice.length && bSlice[j + 1] === la) {
          html.push(`<div class="df-add">+ ${escLine(lb)}</div>`);
          j++;
        } else {
          if (i < aSlice.length) {
            html.push(`<div class="df-del">− ${escLine(la)}</div>`);
            i++;
          }
          if (j < bSlice.length) {
            html.push(`<div class="df-add">+ ${escLine(lb)}</div>`);
            j++;
          }
        }
      }
      dfOut.innerHTML = html.join("");
    }

    dfLeft?.addEventListener("input", computeLineDiff);
    dfRight?.addEventListener("input", computeLineDiff);

    // Auto-load live data when subtool opens
    window.aikuOnSubtoolOpened = (tabId) => {
      if (tabId === "ports") void refreshPorts();
      else if (tabId === "net-diag") void runNetDiag();
      else if (tabId === "all-features") renderDrawer();
    };
  }

  window.initAikuPowerTools = initAikuPowerTools;
})();
