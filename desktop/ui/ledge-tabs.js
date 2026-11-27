/* ============================================================================
   aiku — Top-Mounted Dynamic Ledge 9-Tab Hub & Multi-Theme Engine
   Tabs: AI • Home • Timer • Clipboard • File Tray • Notes • Monitor • Calendar • Settings
   ============================================================================ */

(function () {
  const STORAGE_KEYS = {
    theme: "aiku_ledge_theme_v1",
    size: "aiku_ledge_size_v1",
    openHover: "aiku_ledge_open_hover_v1",
    idleStats: "aiku_ledge_idle_stats_v1",
    notes: "aiku_ledge_scratchpad_v1",
    clips: "aiku_ledge_clipboard_v1",
    tray: "aiku_ledge_tray_v1",
  };

  const CIRCUMFERENCE = 2 * Math.PI * 54; // 339.292

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatBytesRate(bps) {
    const n = Number(bps) || 0;
    if (n < 1024) return `${Math.round(n)} B/s`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB/s`;
  }

  function formatClockSec(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }

  function getIsoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }

  function initAikuLedgeHub(bridge) {
    // bridge: { rpc, showToast, setIslandState, trackHitBox }
    const island = document.getElementById("island");
    let activeTab = "ai";

    // -------------------------------------------------------------------------
    // 1. MULTI-THEME & LEDGE PREFERENCES
    // -------------------------------------------------------------------------
    let currentTheme = localStorage.getItem(STORAGE_KEYS.theme) || "mono";
    let currentSize = localStorage.getItem(STORAGE_KEYS.size) || "M";
    let openOnHover = localStorage.getItem(STORAGE_KEYS.openHover) === "1";
    let liveStatsWhenIdle = localStorage.getItem(STORAGE_KEYS.idleStats) === "1";

    function applyTheme(theme) {
      currentTheme = ["mono", "ledge", "ice", "rose"].includes(theme) ? theme : "mono";
      document.body.dataset.aikuTheme = currentTheme;
      localStorage.setItem(STORAGE_KEYS.theme, currentTheme);
      document.querySelectorAll("#ls-theme-pills .ls-pill").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.theme === currentTheme);
      });
    }

    function applySize(size) {
      currentSize = ["S", "M", "L", "XL"].includes(size) ? size : "M";
      if (island) island.dataset.ledgeSize = currentSize;
      localStorage.setItem(STORAGE_KEYS.size, currentSize);
      document.querySelectorAll("#ls-size-pills .ls-size-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.size === currentSize);
      });
      bridge.trackHitBox(340);
    }

    applyTheme(currentTheme);
    applySize(currentSize);

    const chkOpenHover = document.getElementById("ls-open-hover");
    const chkIdleStats = document.getElementById("ls-idle-stats");
    if (chkOpenHover) chkOpenHover.checked = openOnHover;
    if (chkIdleStats) chkIdleStats.checked = liveStatsWhenIdle;

    document.getElementById("ls-theme-pills")?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".ls-pill");
      if (btn?.dataset.theme) applyTheme(btn.dataset.theme);
    });
    document.getElementById("ls-size-pills")?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".ls-size-btn");
      if (btn?.dataset.size) applySize(btn.dataset.size);
    });
    chkOpenHover?.addEventListener("change", () => {
      openOnHover = Boolean(chkOpenHover.checked);
      localStorage.setItem(STORAGE_KEYS.openHover, openOnHover ? "1" : "0");
    });
    chkIdleStats?.addEventListener("change", () => {
      liveStatsWhenIdle = Boolean(chkIdleStats.checked);
      localStorage.setItem(STORAGE_KEYS.idleStats, liveStatsWhenIdle ? "1" : "0");
      syncIdleStatsPill();
      if (liveStatsWhenIdle) void pollTelemetry();
    });
    document.getElementById("ls-open-full-ai")?.addEventListener("click", () => {
      document.getElementById("btn-open-security")?.click();
    });

    // -------------------------------------------------------------------------
    // 2. TOP ICON NAVIGATION BAR (Dynamic Customizable Pins: Default 5, Max 8)
    // -------------------------------------------------------------------------
    const SUBTOOL_TITLES = {
      home: "Home — Media, Kontrol Cepat & Volume",
      timer: "Timer & Fokus Countdown",
      clipboard: "Clipboard Manager",
      "screen-rec": "Screen Recorder Pro",
      ocr: "OCR Gambar & Screenshot Offline",
      "img-conv": "Image Compressor & Converter",
      "pdf-tools": "PDF Merger & Page Splitter",
      translate: "Quick Translate & Paraphrase",
      converter: "Smart Converter, Password & UUID",
      ports: "Dev Port & Process Manager",
      "net-diag": "Network Ping & Wi-Fi Diagnostics",
      diff: "Diff Checker (Bandingkan Teks/Kode)",
      tray: "File Tray (Rak Simpan Cepat)",
      notes: "Scratchpad Notes",
      monitor: "System Monitor (CPU, RAM & Disk)",
      calendar: "Kalender & Jam",
      "ledge-settings": "Tampilan, Tema & Ukuran Notch",
    };

    function isTabInTopNav(tabId) {
      return Boolean(document.querySelector(`#ledge-nav .ledge-nav-btn[data-ledge-tab="${tabId}"]`));
    }

    function switchTab(tabId) {
      activeTab = tabId;
      const isTop = isTabInTopNav(tabId);
      const navTarget = isTop ? tabId : "all-features";

      document.querySelectorAll("#ledge-nav .ledge-nav-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.ledgeTab === navTarget);
      });
      document.querySelectorAll("#view-palette .ledge-pane").forEach((pane) => {
        pane.classList.toggle("active", pane.id === `ledge-pane-${tabId}`);
      });

      const backBar = document.getElementById("subtool-back-bar");
      const titleEl = document.getElementById("subtool-active-title");
      if (backBar) {
        backBar.classList.toggle("hidden", isTop);
        if (!isTop && titleEl) {
          titleEl.textContent = SUBTOOL_TITLES[tabId] || "Fitur";
        }
      }

      if (tabId === "clipboard") {
        void tryGrabSystemClipboardSilent();
        renderClipboardList();
      } else if (tabId === "monitor" || tabId === "home") {
        void pollTelemetry();
      } else if (tabId === "calendar") {
        renderCalendar();
      } else if (tabId === "ai") {
        setTimeout(() => document.getElementById("palette-input")?.focus(), 40);
      }

      if (typeof window.aikuOnSubtoolOpened === "function") {
        window.aikuOnSubtoolOpened(tabId);
      }

      bridge.trackHitBox(360);
    }

    document.getElementById("btn-back-all-features")?.addEventListener("click", () => {
      switchTab("all-features");
    });

    document.getElementById("ledge-nav")?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".ledge-nav-btn");
      if (!btn?.dataset.ledgeTab) return;
      if (btn.dataset.ledgeTab === "action:graph-widget") {
        document.getElementById("btn-palette-graph")?.click();
        return;
      }
      switchTab(btn.dataset.ledgeTab);
    });

    // -------------------------------------------------------------------------
    // 3. PANE 1: HOME (MEDIA + QUICK CONTROLS + VOLUME)
    // -------------------------------------------------------------------------
    let keepAwakeOn = false;
    let volDebounce = null;

    function updateMediaView(media) {
      const titleEl = document.getElementById("lh-title");
      const artistEl = document.getElementById("lh-artist");
      const eqEl = document.getElementById("lh-eq");
      const playIcon = document.getElementById("lh-play-icon");
      if (!titleEl || !artistEl) return;

      if (media && media.active && media.title) {
        titleEl.textContent = media.title;
        artistEl.textContent = media.artist || "Sedang diputar";
        const playing = media.status === "Playing";
        eqEl?.classList.toggle("paused", !playing);
        if (playIcon) {
          playIcon.innerHTML = playing
            ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
            : '<path d="M8 5v14l11-7z"/>';
        }
      } else {
        titleEl.textContent = "Tidak ada media diputar";
        artistEl.textContent = "Putar lagu di Spotify / YouTube / Browser";
        eqEl?.classList.add("paused");
        if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
      }
    }

    document.getElementById("lh-prev")?.addEventListener("click", () => {
      void bridge.rpc("mediaControl", { action: "prev" }).catch(() => {});
    });
    document.getElementById("lh-play")?.addEventListener("click", () => {
      void bridge.rpc("mediaControl", { action: "play_pause" }).catch(() => {});
    });
    document.getElementById("lh-next")?.addEventListener("click", () => {
      void bridge.rpc("mediaControl", { action: "next" }).catch(() => {});
    });

    document.getElementById("qc-awake")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      keepAwakeOn = !keepAwakeOn;
      btn.classList.toggle("active", keepAwakeOn);
      try {
        const res = await bridge.rpc("ledgeControl", { action: "TOGGLE_KEEP_AWAKE", enabled: keepAwakeOn });
        bridge.showToast(res.message, "ok");
      } catch (err) {
        bridge.showToast(`Gagal mengatur Keep Awake: ${err}`, "err");
      }
    });
    document.getElementById("qc-shot")?.addEventListener("click", async () => {
      bridge.setIslandState("idle");
      setTimeout(() => {
        void bridge.rpc("ledgeControl", { action: "TAKE_SCREENSHOT" }).catch(() => {});
      }, 180);
    });
    document.getElementById("qc-dark")?.addEventListener("click", async () => {
      try {
        const res = await bridge.rpc("ledgeControl", { action: "TOGGLE_DARK_MODE" });
        bridge.showToast(res.message, "ok");
      } catch (err) {
        bridge.showToast(`Gagal ubah tema Windows: ${err}`, "err");
      }
    });
    document.getElementById("qc-bright")?.addEventListener("click", async () => {
      try {
        const res = await bridge.rpc("ledgeControl", { action: "CYCLE_BRIGHTNESS" });
        bridge.showToast(res.message, "ok");
      } catch (err) {
        bridge.showToast(`Gagal ubah kecerahan: ${err}`, "err");
      }
    });
    document.getElementById("qc-lock")?.addEventListener("click", () => {
      void bridge.rpc("ledgeControl", { action: "LOCK_SCREEN" }).catch(() => {});
    });

    const volSlider = document.getElementById("lh-vol-slider");
    const volVal = document.getElementById("lh-vol-val");
    volSlider?.addEventListener("input", () => {
      const v = Number(volSlider.value) || 0;
      if (volVal) volVal.textContent = String(v);
      if (volDebounce) clearTimeout(volDebounce);
      volDebounce = setTimeout(() => {
        void bridge.rpc("ledgeControl", { action: "SET_VOLUME", value: v }).catch(() => {});
      }, 150);
    });

    // -------------------------------------------------------------------------
    // 4. PANE 2: CIRCULAR COUNTDOWN TIMER
    // -------------------------------------------------------------------------
    let timerTotalSec = 25 * 60;
    let timerRemSec = 25 * 60;
    let timerRunning = false;
    let timerInterval = null;

    function syncTimerUi() {
      const disp = document.getElementById("lt-time-display");
      const stateLbl = document.getElementById("lt-state-label");
      const subCap = document.getElementById("lt-sub-caption");
      const prog = document.getElementById("lt-ring-prog");
      const toggleIcon = document.getElementById("lt-toggle-icon");
      const idlePill = document.getElementById("idle-timer-pill");

      if (disp) disp.textContent = formatClockSec(timerRemSec);
      if (stateLbl) stateLbl.textContent = timerRunning ? "running" : timerRemSec < timerTotalSec ? "paused" : "ready";
      if (subCap) subCap.textContent = `Counting down from ${formatClockSec(timerTotalSec)}`;
      if (prog) {
        const ratio = timerTotalSec > 0 ? Math.max(0, Math.min(1, timerRemSec / timerTotalSec)) : 0;
        prog.style.strokeDashoffset = (CIRCUMFERENCE * (1 - ratio)).toFixed(2);
      }
      if (toggleIcon) {
        toggleIcon.innerHTML = timerRunning
          ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
          : '<path d="M8 5v14l11-7z"/>';
      }
      if (idlePill) {
        const showIdle = timerRunning || timerRemSec < timerTotalSec;
        idlePill.classList.toggle("hidden", !showIdle);
        if (showIdle) idlePill.textContent = formatClockSec(timerRemSec);
      }
    }

    function stopLedgeTimer(reset = false) {
      timerRunning = false;
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      if (reset) timerRemSec = timerTotalSec;
      syncTimerUi();
    }

    document.getElementById("lt-btn-toggle")?.addEventListener("click", () => {
      if (timerRunning) {
        stopLedgeTimer(false);
        return;
      }
      if (timerRemSec <= 0) timerRemSec = timerTotalSec;
      timerRunning = true;
      syncTimerUi();
      timerInterval = setInterval(() => {
        timerRemSec = Math.max(0, timerRemSec - 1);
        syncTimerUi();
        if (timerRemSec <= 0) {
          stopLedgeTimer(true);
          bridge.showToast("Waktu Timer selesai!", "ok");
        }
      }, 1000);
    });

    document.getElementById("lt-btn-reset")?.addEventListener("click", () => {
      stopLedgeTimer(true);
    });

    document.querySelector(".lt-delta-pills")?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".lt-delta-btn");
      if (!btn) return;
      const delta = Number(btn.dataset.delta) || 0;
      timerRemSec = Math.max(60, Math.min(180 * 60, timerRemSec + delta));
      if (!timerRunning || timerRemSec > timerTotalSec) {
        timerTotalSec = timerRemSec;
      }
      syncTimerUi();
    });
    syncTimerUi();

    // -------------------------------------------------------------------------
    // 5. PANE 3: CLIPBOARD MANAGER (SEARCH + PIN)
    // -------------------------------------------------------------------------
    let clipItems = [];
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.clips) || "[]");
      if (Array.isArray(saved)) clipItems = saved.slice(0, 30);
    } catch {}

    function saveClips() {
      try {
        localStorage.setItem(STORAGE_KEYS.clips, JSON.stringify(clipItems.slice(0, 30)));
      } catch {}
    }

    function recordClip(rawText) {
      const text = String(rawText ?? "").trim();
      if (!text) return;
      const existing = clipItems.find((c) => c.text === text);
      if (existing) {
        existing.ts = Date.now();
      } else {
        clipItems.unshift({ id: `c_${Date.now()}`, text: text.slice(0, 1200), pinned: false, ts: Date.now() });
      }
      clipItems.sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.ts - a.ts));
      if (clipItems.length > 30) clipItems = clipItems.slice(0, 30);
      saveClips();
      if (activeTab === "clipboard") renderClipboardList();
    }

    async function tryGrabSystemClipboardSilent() {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) recordClip(text);
      } catch {}
    }

    function renderClipboardList() {
      const list = document.getElementById("lc-items-list");
      const query = (document.getElementById("lc-search-input")?.value || "").trim().toLowerCase();
      if (!list) return;
      list.innerHTML = "";

      const filtered = clipItems.filter((c) => !query || c.text.toLowerCase().includes(query));
      if (filtered.length === 0) {
        list.innerHTML = `<div class="lc-item-row"><span class="lc-item-text" style="color:#71717a">Belum ada teks tersimpan. Salin teks atau klik tombol + di kanan atas.</span></div>`;
        return;
      }

      filtered.forEach((item) => {
        const row = document.createElement("div");
        row.className = "lc-item-row";
        row.innerHTML = `
          <div class="lc-item-left">
            <button type="button" class="lc-pin-btn ${item.pinned ? "pinned" : ""}" title="${item.pinned ? "Lepas Pin" : "Sematkan di atas"}">
              <svg viewBox="0 0 24 24" fill="${item.pinned ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.9" width="13" height="13">
                <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z"/>
              </svg>
            </button>
            <span class="lc-item-text">${esc(item.text.replace(/\s+/g, " "))}</span>
          </div>
        `;
        row.querySelector(".lc-pin-btn")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          item.pinned = !item.pinned;
          clipItems.sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.ts - a.ts));
          saveClips();
          renderClipboardList();
        });
        row.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(item.text);
            bridge.showToast("Teks disalin ke clipboard!", "ok");
          } catch {}
        });
        list.appendChild(row);
      });
    }

    document.getElementById("lc-search-input")?.addEventListener("input", renderClipboardList);
    document.getElementById("lc-btn-grab")?.addEventListener("click", async () => {
      await tryGrabSystemClipboardSilent();
      renderClipboardList();
    });
    document.getElementById("lc-btn-clear")?.addEventListener("click", () => {
      clipItems = clipItems.filter((c) => c.pinned);
      saveClips();
      renderClipboardList();
    });

    // -------------------------------------------------------------------------
    // 6. PANE 4: FILE TRAY (4-SLOT DRAG & DROP SHELF)
    // -------------------------------------------------------------------------
    let trayFiles = [];
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.tray) || "[]");
      if (Array.isArray(saved)) trayFiles = saved.slice(0, 8);
    } catch {}

    function saveTray() {
      try {
        localStorage.setItem(STORAGE_KEYS.tray, JSON.stringify(trayFiles.slice(0, 8)));
      } catch {}
    }

    function renderTray() {
      const cardsEl = document.getElementById("lf-cards");
      const countEl = document.getElementById("lf-count");
      if (!cardsEl) return;
      if (countEl) countEl.textContent = String(trayFiles.length);
      cardsEl.innerHTML = "";

      const slots = Math.max(4, Math.min(4, trayFiles.length || 4));
      for (let i = 0; i < slots; i++) {
        const item = trayFiles[i];
        const card = document.createElement("div");
        if (!item) {
          card.className = "lf-card empty-slot";
          card.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="22" height="22">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 12v6M9 15h6"/>
            </svg>
            <span class="lf-name">Drop file</span>
          `;
          card.addEventListener("click", () => document.getElementById("lf-file-input")?.click());
        } else {
          const ext = (item.name.split(".").pop() || "FILE").slice(0, 4).toUpperCase();
          card.className = "lf-card";
          card.title = `${item.name} • Klik untuk tanya aiku / salin nama`;
          card.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="#d4d4d8" stroke-width="1.6" width="26" height="26">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
            </svg>
            <span class="lf-ext-badge mono">${esc(ext)}</span>
            <span class="lf-name">${esc(item.name)}</span>
          `;
          card.addEventListener("click", () => {
            switchTab("ai");
            const inp = document.getElementById("palette-input");
            if (inp) {
              inp.value = `Analisis atau rangkum file ${item.name}`;
              inp.focus();
            }
          });
        }
        cardsEl.appendChild(card);
      }
    }

    function addFilesToTray(fileList) {
      Array.from(fileList || []).forEach((f) => {
        if (!f?.name) return;
        trayFiles = trayFiles.filter((x) => x.name !== f.name);
        trayFiles.unshift({ name: f.name, size: f.size || 0 });
      });
      trayFiles = trayFiles.slice(0, 8);
      saveTray();
      renderTray();
    }

    const dropzone = document.getElementById("lf-dropzone");
    dropzone?.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    });
    dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
      if (e.dataTransfer?.files?.length) addFilesToTray(e.dataTransfer.files);
    });
    document.getElementById("lf-btn-add")?.addEventListener("click", () => {
      document.getElementById("lf-file-input")?.click();
    });
    document.getElementById("lf-file-input")?.addEventListener("change", (e) => {
      if (e.target.files?.length) addFilesToTray(e.target.files);
      e.target.value = "";
    });
    document.getElementById("lf-btn-clear")?.addEventListener("click", () => {
      trayFiles = [];
      saveTray();
      renderTray();
    });
    renderTray();

    // -------------------------------------------------------------------------
    // 7. PANE 5: NOTES / SCRATCHPAD
    // -------------------------------------------------------------------------
    const noteArea = document.getElementById("ln-textarea");
    let noteSaveTimer = null;
    if (noteArea) {
      noteArea.value = localStorage.getItem(STORAGE_KEYS.notes) || "";
      noteArea.addEventListener("input", () => {
        if (noteSaveTimer) clearTimeout(noteSaveTimer);
        noteSaveTimer = setTimeout(() => {
          localStorage.setItem(STORAGE_KEYS.notes, noteArea.value);
        }, 200);
      });
    }

    // -------------------------------------------------------------------------
    // 8. PANE 6: SYSTEM MONITOR (LIVE SPARKLINES)
    // -------------------------------------------------------------------------
    const cpuHist = Array(22).fill(8);
    const memHist = Array(22).fill(45);
    const netHist = Array(22).fill(0);
    let latestTelemetry = null;

    function drawSparkline(svgId, values, maxScale) {
      const svg = document.getElementById(svgId);
      if (!svg || values.length < 2) return;
      const w = 120;
      const h = 28;
      const hi = Math.max(maxScale, ...values, 1);
      const pts = values.map((v, idx) => {
        const x = (idx / (values.length - 1)) * w;
        const y = h - 2 - (Math.min(hi, Math.max(0, v)) / hi) * (h - 5);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      const polyPoints = pts.join(" ");
      const areaPoints = `0,${h} ${polyPoints} ${w},${h}`;
      svg.innerHTML = `
        <polygon points="${areaPoints}" fill="currentColor" fill-opacity="0.12"></polygon>
        <polyline points="${polyPoints}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></polyline>
      `;
    }

    function syncIdleStatsPill() {
      const el = document.getElementById("idle-live-stats");
      if (!el) return;
      if (!liveStatsWhenIdle || !latestTelemetry) {
        el.classList.add("hidden");
        return;
      }
      el.classList.remove("hidden");
      el.textContent = `${latestTelemetry.cpuPercent}% • ${latestTelemetry.memoryPercent}%`;
    }

    async function pollTelemetry() {
      try {
        const snap = await bridge.rpc("getSystemTelemetry");
        if (!snap) return;
        latestTelemetry = snap;

        cpuHist.push(snap.cpuPercent);
        if (cpuHist.length > 22) cpuHist.shift();
        memHist.push(snap.memoryPercent);
        if (memHist.length > 22) memHist.shift();
        netHist.push((snap.netRxBytesPerSec || 0) / 1024);
        if (netHist.length > 22) netHist.shift();

        const cpuEl = document.getElementById("lm-cpu-val");
        const memEl = document.getElementById("lm-mem-val");
        const netEl = document.getElementById("lm-net-val");
        const netUpEl = document.getElementById("lm-net-up");
        const pwrEl = document.getElementById("lm-power-val");
        const pwrFill = document.getElementById("lm-power-fill");
        const dskEl = document.getElementById("lm-disk-val");
        const dskFill = document.getElementById("lm-disk-fill");

        if (cpuEl) cpuEl.textContent = `${snap.cpuPercent}%`;
        if (memEl) memEl.textContent = `${snap.memoryPercent}%`;
        if (netEl) netEl.textContent = formatBytesRate(snap.netRxBytesPerSec);
        if (netUpEl) netUpEl.textContent = `↑ ${formatBytesRate(snap.netTxBytesPerSec)}`;
        if (pwrEl) pwrEl.textContent = `${snap.powerStatus} • ${snap.batteryPercent}%`;
        if (pwrFill) pwrFill.style.width = `${snap.batteryPercent}%`;
        if (dskEl) dskEl.textContent = `${snap.diskUsedPercent}%`;
        if (dskFill) dskFill.style.width = `${snap.diskUsedPercent}%`;

        drawSparkline("lm-cpu-spark", cpuHist, 100);
        drawSparkline("lm-mem-spark", memHist, 100);
        drawSparkline("lm-net-spark", netHist, 64);

        if (volSlider && document.activeElement !== volSlider && typeof snap.volumePercent === "number") {
          volSlider.value = String(snap.volumePercent);
          if (volVal) volVal.textContent = String(snap.volumePercent);
        }

        syncIdleStatsPill();
      } catch {}
    }

    setInterval(() => {
      const isPaletteOpen = island?.dataset.state === "palette";
      if ((isPaletteOpen && (activeTab === "monitor" || activeTab === "home")) || liveStatsWhenIdle) {
        void pollTelemetry();
      }
    }, 2600);

    // -------------------------------------------------------------------------
    // 9. PANE 7: INTERACTIVE CALENDAR & LIVE CLOCK
    // -------------------------------------------------------------------------
    let calViewYear = new Date().getFullYear();
    let calViewMonth = new Date().getMonth();

    function renderCalendar() {
      const now = new Date();
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];

      const wdEl = document.getElementById("lcal-weekday");
      const dnEl = document.getElementById("lcal-daynum");
      const myEl = document.getElementById("lcal-monthyear");
      const ckEl = document.getElementById("lcal-clock");
      const wkEl = document.getElementById("lcal-weeknum");
      const vtEl = document.getElementById("lcal-view-title");
      const gridEl = document.getElementById("lcal-days-grid");

      if (wdEl) wdEl.textContent = dayNames[now.getDay()];
      if (dnEl) dnEl.textContent = String(now.getDate());
      if (myEl) myEl.textContent = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
      if (ckEl) ckEl.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (wkEl) wkEl.textContent = `Week ${getIsoWeek(now)}`;
      if (vtEl) vtEl.textContent = `${monthNames[calViewMonth]} ${calViewYear}`;

      if (!gridEl) return;
      gridEl.innerHTML = "";

      const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
      const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
      const prevMonthDays = new Date(calViewYear, calViewMonth, 0).getDate();

      for (let i = firstDay - 1; i >= 0; i--) {
        const s = document.createElement("span");
        s.className = "lcal-day muted";
        s.textContent = String(prevMonthDays - i);
        gridEl.appendChild(s);
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const s = document.createElement("span");
        const isToday =
          d === now.getDate() && calViewMonth === now.getMonth() && calViewYear === now.getFullYear();
        s.className = `lcal-day${isToday ? " today" : ""}`;
        s.textContent = String(d);
        gridEl.appendChild(s);
      }
    }

    document.getElementById("lcal-prev")?.addEventListener("click", () => {
      calViewMonth -= 1;
      if (calViewMonth < 0) {
        calViewMonth = 11;
        calViewYear -= 1;
      }
      renderCalendar();
    });
    document.getElementById("lcal-next")?.addEventListener("click", () => {
      calViewMonth += 1;
      if (calViewMonth > 11) {
        calViewMonth = 0;
        calViewYear += 1;
      }
      renderCalendar();
    });
    document.getElementById("lcal-today-btn")?.addEventListener("click", () => {
      const now = new Date();
      calViewYear = now.getFullYear();
      calViewMonth = now.getMonth();
      renderCalendar();
    });

    setInterval(() => {
      if (island?.dataset.state === "palette" && activeTab === "calendar") {
        renderCalendar();
      }
    }, 15000);
    renderCalendar();

    return {
      switchTab,
      recordClip,
      updateMediaView,
      shouldOpenFullOnHover: () => openOnHover,
      refreshTelemetry: pollTelemetry,
    };
  }

  window.initAikuLedgeHub = initAikuLedgeHub;
})();
