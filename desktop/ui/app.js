const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
let rpcCounter = 1;
const chatHistory = [];
let activePlan = null;
let currentSandboxRoot = "";
let draftAllowedDirs = [];
let toastTimer = null;
let liveVoiceActive = false;
let activeRecognition = null;
let chatStyle = localStorage.getItem("aiku_chat_style") === "gemini" ? "gemini" : "default";
let timerInterval = null;
let timerRemainingSec = 0;
let timerCustomLabel = "";
const clipboardHistory = [];
let currentMediaStatus = { active: false };
let bootGreetingActive = false;
let latestStatusCache = null;
let browserSearchMode = false;
let notifDurationSec = 4;
let activeNotifTimer = null;
let activeNotifMode = false;
let lastKnownFileCount = null;
let inboxItems = [];
const seenNotifIds = new Set();
let notifBridgeInitialized = false;
let unreadNotifCount = 0;
let inboxFilter = "all";
let selectedInboxId = null;
let lastActiveNotifInboxId = null;

const ALERT_SVG_ICONS = {
  ok: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4M12 16h.01"/></svg>`,
  err: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
};

const HOVER_SVG_ICONS = {
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"/></svg>`,
  code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  app: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8"/></svg>`,
  music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.3 6.8L21 11l-6.7 2.2L12 20l-2.3-6.8L3 11l6.7-2.2L12 2z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  cpu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2.5"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></svg>`,
  file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 11h8M8 15h5"/></svg>`,
};

const DEFAULT_HOVER_SHORTCUTS = [
  { id: "sc-chrome", type: "app", target: "OPEN_CHROME", label: "Chrome", icon: "globe" },
  { id: "sc-vscode", type: "app", target: "OPEN_VSCODE", label: "VS Code", icon: "code" },
  { id: "sc-search", type: "web", target: "PROMPT_SEARCH", label: "Search", icon: "search" },
  { id: "sc-sandbox", type: "system", target: "OPEN_SANDBOX", label: "Folder", icon: "folder" },
];

const APP_PRESET_META = {
  OPEN_CHROME: { label: "Chrome", icon: "globe" },
  OPEN_VSCODE: { label: "VS Code", icon: "code" },
  OPEN_SPOTIFY: { label: "Spotify", icon: "music" },
  OPEN_EXPLORER: { label: "Explorer", icon: "folder" },
  OPEN_NOTEPAD: { label: "Notepad", icon: "file" },
  OPEN_CALCULATOR: { label: "Kalkulator", icon: "app" },
  OPEN_WHATSAPP: { label: "WhatsApp", icon: "app" },
  OPEN_YOUTUBE: { label: "YouTube", icon: "globe" },
  OPEN_WINDOWS_SETTINGS: { label: "Settings", icon: "cpu" },
  OPEN_TASK_MANAGER: { label: "Task Mgr", icon: "cpu" },
  OPEN_EDGE: { label: "Edge", icon: "globe" },
  OPEN_PAINT: { label: "Paint", icon: "app" },
};

const SYSTEM_PRESET_META = {
  OPEN_SANDBOX: { label: "Sandbox", icon: "folder" },
  QUICK_ORGANIZE: { label: "Rapikan", icon: "folder" },
  QUICK_HYGIENE: { label: "Duplikat", icon: "spark" },
  SUMMARIZE_CLIP: { label: "Ringkas", icon: "file" },
  FORMAT_PDF: { label: "Teks PDF", icon: "file" },
  EXTRACT_TODO: { label: "To-Do", icon: "file" },
  FOCUS_TIMER: { label: "Fokus 25m", icon: "clock" },
  CHECK_SPECS: { label: "Spek PC", icon: "cpu" },
  LIVE_VOICE: { label: "Voice AI", icon: "spark" },
};

function loadHoverShortcuts() {
  try {
    const raw = localStorage.getItem("aiku_hover_shortcuts");
    if (!raw) return [...DEFAULT_HOVER_SHORTCUTS];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 5);
    }
  } catch {}
  return [...DEFAULT_HOVER_SHORTCUTS];
}

let hoverShortcuts = loadHoverShortcuts();

function saveHoverShortcuts() {
  localStorage.setItem("aiku_hover_shortcuts", JSON.stringify(hoverShortcuts));
  renderHoverShortcuts();
}

function setBrowserSearchInputMode(enabled) {
  browserSearchMode = enabled;
  const input = document.getElementById("palette-input");
  if (!input) return;
  if (enabled) {
    input.placeholder = "Ketik pencarian Google atau URL website lalu tekan Enter...";
  } else {
    input.placeholder = "Ask AI, hitung, cari file, atau ketik perintah...";
  }
}

async function executeHoverShortcut(sc) {
  try {
    if (sc.type === "app") {
      const res = await rpc("safeCommand", { command: sc.target });
      showToast(res.message.replace(/\*\*/g, "").replace(/`/g, ""), "ok");
      return;
    }

    if (sc.type === "web") {
      if (!sc.target || sc.target === "PROMPT_SEARCH") {
        setIslandState("palette");
        setBrowserSearchInputMode(true);
        setTimeout(() => document.getElementById("palette-input")?.focus(), 70);
        return;
      }
      const res = await rpc("openBrowserSearch", { target: sc.target });
      showToast(res.message, "ok");
      return;
    }

    if (sc.type === "system") {
      switch (sc.target) {
        case "OPEN_SANDBOX": {
          const res = await rpc("safeCommand", { command: "OPEN_SANDBOX" });
          showToast(res.message.replace(/`/g, ""), "ok");
          break;
        }
        case "QUICK_ORGANIZE":
          await runQuickOrganize();
          break;
        case "QUICK_HYGIENE":
          await runQuickHygiene();
          break;
        case "SUMMARIZE_CLIP":
          await runSummarizeClipboard();
          break;
        case "FORMAT_PDF":
          await runFormatPdfClipboard();
          break;
        case "EXTRACT_TODO":
          await runExtractTodoClipboard();
          break;
        case "FOCUS_TIMER":
          if (timerRemainingSec > 0) {
            stopFocusTimer(false);
          } else {
            startFocusTimer(25 * 60);
            showToast("Timer fokus 25 menit dimulai!", "ok");
          }
          break;
        case "CHECK_SPECS":
          setIslandState("palette");
          await handleChatPrompt("Spek laptop saya dan sisa RAM sekarang");
          break;
        case "LIVE_VOICE":
          startVoiceInput();
          break;
      }
    }
  } catch (err) {
    showToast(`Gagal menjalankan shortcut: ${err}`, "err");
  }
}

function renderHoverShortcuts() {
  const hoverContainer = document.getElementById("hover-shortcuts-list");
  if (hoverContainer) {
    hoverContainer.innerHTML = "";
    hoverShortcuts.forEach((sc) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hover-sc-btn";
      btn.dataset.type = sc.type;
      btn.title = `${sc.label} (${sc.type.toUpperCase()})`;
      const svg = HOVER_SVG_ICONS[sc.icon] || HOVER_SVG_ICONS.app;
      btn.innerHTML = `${svg}<span>${escapeHtml(sc.label)}</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void executeHoverShortcut(sc);
      });
      hoverContainer.appendChild(btn);
    });
  }

  const settingsList = document.getElementById("sc-active-list");
  if (settingsList) {
    settingsList.innerHTML = "";
    hoverShortcuts.forEach((sc, idx) => {
      const chip = document.createElement("span");
      chip.className = "dir-chip mono";
      const svg = HOVER_SVG_ICONS[sc.icon] || HOVER_SVG_ICONS.app;
      chip.innerHTML = `<span style="width:12px;height:12px;display:inline-flex;color:#d4d4d8">${svg}</span><span>${escapeHtml(sc.label)}</span><span class="sc-chip-type">${escapeHtml(sc.type)}</span>`;
      if (hoverShortcuts.length > 1) {
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "dir-chip-remove";
        rm.textContent = "×";
        rm.title = "Hapus shortcut";
        rm.addEventListener("click", () => {
          hoverShortcuts.splice(idx, 1);
          saveHoverShortcuts();
        });
        chip.appendChild(rm);
      }
      settingsList.appendChild(chip);
    });
  }
}

function syncShortcutBuilderFields() {
  const typeEl = document.getElementById("sc-type");
  const appWrap = document.getElementById("sc-target-app-wrap");
  const webWrap = document.getElementById("sc-target-web-wrap");
  const sysWrap = document.getElementById("sc-target-sys-wrap");
  const labelInput = document.getElementById("sc-label");
  const iconSelect = document.getElementById("sc-icon");
  if (!typeEl) return;

  const chosenType = typeEl.value;
  appWrap?.classList.toggle("hidden", chosenType !== "app");
  webWrap?.classList.toggle("hidden", chosenType !== "web");
  sysWrap?.classList.toggle("hidden", chosenType !== "system");

  if (chosenType === "app") {
    const appVal = document.getElementById("sc-target-app")?.value || "OPEN_CHROME";
    const meta = APP_PRESET_META[appVal];
    if (meta && labelInput) labelInput.value = meta.label;
    if (meta && iconSelect) iconSelect.value = meta.icon;
  } else if (chosenType === "web") {
    if (labelInput) labelInput.value = "Search";
    if (iconSelect) iconSelect.value = "search";
  } else if (chosenType === "system") {
    const sysVal = document.getElementById("sc-target-sys")?.value || "OPEN_SANDBOX";
    const meta = SYSTEM_PRESET_META[sysVal];
    if (meta && labelInput) labelInput.value = meta.label;
    if (meta && iconSelect) iconSelect.value = meta.icon;
  }
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 11) return "Selamat Pagi";
  if (hour >= 11 && hour < 15) return "Selamat Siang";
  if (hour >= 15 && hour < 18) return "Selamat Sore";
  return "Selamat Malam";
}

function formatShortModelName(modelFileName = "") {
  const lower = String(modelFileName).toLowerCase();
  if (lower.includes("0.5b")) return "Qwen 0.5B";
  if (lower.includes("1.5b")) return "Qwen 1.5B";
  if (lower.includes("3b")) return "Qwen 3B";
  if (lower.includes("llama")) return "Llama 1B";
  if (lower.includes("gemma")) return "Gemma 2B";
  return "Local AI";
}

function updateWelcomeCard(status = latestStatusCache, fileCount = null) {
  const greetingEl = document.getElementById("welcome-greeting");
  const subEl = document.getElementById("welcome-sub");
  const badgeEl = document.getElementById("welcome-engine-badge");
  const chatIndicatorEl = document.getElementById("chat-engine-indicator");

  if (greetingEl) {
    greetingEl.textContent = `${getTimeGreeting()}, siap beraktivitas?`;
  }

  if (status) {
    const shortModel = formatShortModelName(status.modelFileName);
    const isHybrid = status.aiMode === "hybrid" && status.hasGeminiApiKey;
    const badgeLabel = isHybrid ? `${shortModel} + Gemini` : shortModel;
    if (badgeEl) badgeEl.textContent = badgeLabel;
    if (chatIndicatorEl) {
      chatIndicatorEl.textContent = isHybrid
        ? `Hybrid Active (${shortModel} + Gemini 2.5)`
        : `Offline Local (${shortModel})`;
    }
    if (subEl) {
      const folderCount = Array.isArray(status.allowedDirectories) ? status.allowedDirectories.length : 1;
      const countInfo = fileCount !== null ? ` • ${formatCompactCount(fileCount)} file siap` : "";
      subEl.textContent = `${folderCount} folder terhubung${countInfo} • Klik pintasan atau ketik`;
    }
  }
}

function syncWelcomeVisibility() {
  const welcomeCard = document.getElementById("palette-welcome");
  const chatToolbar = document.getElementById("chat-toolbar");
  const stream = document.getElementById("palette-chat-stream");
  const inboxPanel = document.getElementById("inbox-panel");
  const inboxOpen = inboxPanel && !inboxPanel.classList.contains("hidden");
  const hasMessages = stream && stream.children.length > 0;

  if (inboxOpen) {
    welcomeCard?.classList.add("hidden");
    chatToolbar?.classList.add("hidden");
    stream?.classList.add("hidden");
    return;
  }

  if (hasMessages) {
    welcomeCard?.classList.add("hidden");
    chatToolbar?.classList.remove("hidden");
    stream?.classList.remove("hidden");
  } else {
    welcomeCard?.classList.remove("hidden");
    chatToolbar?.classList.add("hidden");
    stream?.classList.add("hidden");
  }
}

function formatRelativeTime(ms) {
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return "Baru saja";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  return `${Math.floor(hrs / 24)}h lalu`;
}

function updateInboxBadge() {
  const badge = document.getElementById("inbox-unread-badge");
  if (!badge) return;
  if (unreadNotifCount > 0) {
    badge.textContent = unreadNotifCount > 9 ? "9+" : String(unreadNotifCount);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function renderInboxList() {
  const listEl = document.getElementById("inbox-list");
  const replyBox = document.getElementById("inbox-reply-box");
  const replyTarget = document.getElementById("inbox-reply-target");
  const sendBtn = document.getElementById("btn-inbox-send");
  if (!listEl) return;

  const filtered = inboxFilter === "wa" ? inboxItems.filter((it) => it.isWhatsApp) : inboxItems;
  listEl.innerHTML = "";

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="inbox-empty mono">${
      inboxFilter === "wa"
        ? "Belum ada notifikasi WhatsApp masuk. Pastikan notifikasi Windows untuk WhatsApp Desktop aktif, atau klik Tes WA."
        : "Belum ada notifikasi Windows terbaru. Klik Tes WA untuk simulasi."
    }</div>`;
    replyBox?.classList.add("hidden");
    return;
  }

  if (!filtered.some((it) => it.id === selectedInboxId)) {
    selectedInboxId = filtered[0]?.id ?? null;
  }

  for (const item of filtered) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `inbox-item${item.id === selectedInboxId ? " selected" : ""}`;
    btn.innerHTML = `
      <div class="inbox-item-top">
        <span class="inbox-sender truncate">${escapeHtml(item.sender)}</span>
        <div class="inbox-meta-right">
          <span class="inbox-app-tag mono${item.isWhatsApp ? " wa" : ""}">${escapeHtml(item.appName)}</span>
          <span class="inbox-time mono">${escapeHtml(formatRelativeTime(item.arrivalTimeMs))}</span>
        </div>
      </div>
      <div class="inbox-body">${escapeHtml(item.body)}</div>
    `;
    btn.addEventListener("click", () => {
      selectedInboxId = item.id;
      renderInboxList();
      document.getElementById("inbox-reply-input")?.focus();
    });
    listEl.appendChild(btn);
  }

  const selected = filtered.find((it) => it.id === selectedInboxId);
  if (selected && replyBox) {
    replyBox.classList.remove("hidden");
    if (replyTarget) {
      replyTarget.textContent = `Membalas: ${selected.sender} (${selected.appName})`;
    }
    if (sendBtn) {
      sendBtn.textContent = selected.isWhatsApp ? "Kirim WA" : "Salin Balasan";
    }
  } else {
    replyBox?.classList.add("hidden");
  }
}

function openInboxPanel(preselectId = null) {
  const panel = document.getElementById("inbox-panel");
  if (!panel) return;
  if (preselectId) {
    selectedInboxId = preselectId;
  }
  unreadNotifCount = 0;
  updateInboxBadge();
  panel.classList.remove("hidden");
  syncWelcomeVisibility();
  renderInboxList();
}

function closeInboxPanel() {
  document.getElementById("inbox-panel")?.classList.add("hidden");
  syncWelcomeVisibility();
}

async function pollIncomingWindowsNotifications() {
  try {
    const res = await rpc("pollNotifications");
    if (!res?.supported || !Array.isArray(res.items)) return;

    const newlyArrived = [];
    for (const item of res.items) {
      if (!seenNotifIds.has(item.id)) {
        seenNotifIds.add(item.id);
        if (notifBridgeInitialized) {
          newlyArrived.push(item);
        }
      }
    }

    // Gabungkan notifikasi nyata dengan item simulasi lokal (jika ada)
    const simulated = inboxItems.filter((it) => it.id.startsWith("sim-"));
    inboxItems = [...simulated, ...res.items].sort((a, b) => b.arrivalTimeMs - a.arrivalTimeMs).slice(0, 30);

    if (!notifBridgeInitialized) {
      notifBridgeInitialized = true;
      return;
    }

    if (newlyArrived.length > 0) {
      unreadNotifCount += newlyArrived.length;
      updateInboxBadge();
      const latest = newlyArrived[0];
      lastActiveNotifInboxId = latest.id;
      const inboxPanel = document.getElementById("inbox-panel");
      if (inboxPanel && !inboxPanel.classList.contains("hidden")) {
        renderInboxList();
      }
      showIslandNotification(
        `${latest.appName} • ${latest.sender}`,
        latest.body,
        "info",
        true
      );
    }
  } catch {
    // Abaikan jika polling notifikasi sedang tidak tersedia
  }
}

function clearChatConversation() {
  chatHistory.length = 0;
  const stream = document.getElementById("palette-chat-stream");
  if (stream) stream.innerHTML = "";
  updateWelcomeCard();
  syncWelcomeVisibility();
  document.getElementById("palette-input")?.focus();
}

function runBootWelcomeAnimation() {
  const island = document.getElementById("island");
  const idleLabel = document.getElementById("idle-label");
  if (!island || !idleLabel) return;

  bootGreetingActive = true;
  island.classList.add("boot-greeting");
  idleLabel.textContent = `${getTimeGreeting()}`;

  setTimeout(() => {
    bootGreetingActive = false;
    island.classList.remove("boot-greeting");
    if (timerRemainingSec === 0) {
      if (currentMediaStatus?.active && currentMediaStatus?.status === "Playing" && currentMediaStatus?.title) {
        const t = currentMediaStatus.title;
        idleLabel.textContent = `${t.slice(0, 14)}${t.length > 14 ? "…" : ""}`;
      } else {
        idleLabel.textContent = latestStatusCache && !latestStatusCache.modelReady ? "Setup AI" : "AI Ready";
      }
    }
  }, 2600);
}

function recordClipboardEntry(text) {
  const clean = text.trim();
  if (!clean) return;
  const existingIdx = clipboardHistory.indexOf(clean);
  if (existingIdx !== -1) clipboardHistory.splice(existingIdx, 1);
  clipboardHistory.unshift(clean);
  if (clipboardHistory.length > 10) clipboardHistory.pop();
}

function showClipboardHistory() {
  if (clipboardHistory.length === 0) {
    showToast("Belum ada riwayat copy di sesi ini.", "err");
    return;
  }
  const stream = document.getElementById("palette-chat-stream");
  stream.classList.remove("hidden");
  const div = document.createElement("div");
  div.className = "msg msg-ai";
  div.innerHTML = `<strong>Riwayat Clipboard (${clipboardHistory.length} terakhir — klik untuk salin):</strong>`;
  const list = document.createElement("div");
  list.className = "mini-file-list";
  clipboardHistory.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "mini-file-row mono";
    row.style.cursor = "pointer";
    row.innerHTML = `<span class="truncate">${escapeHtml(entry.slice(0, 72))}</span><span class="text-cyan">Copy</span>`;
    row.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(entry);
        showToast("Disalin ulang ke clipboard!", "ok");
      } catch {
        showToast("Gagal menyalin.", "err");
      }
    });
    list.appendChild(row);
  });
  div.appendChild(list);
  stream.appendChild(div);
  syncWelcomeVisibility();
  stream.scrollTop = stream.scrollHeight;
}

async function pollMediaPlayer(action = "get") {
  try {
    const media = await rpc("mediaControl", { action });
    currentMediaStatus = media;
    const bar = document.getElementById("media-bar");
    const idleLabel = document.getElementById("idle-label");

    if (media.active && media.title) {
      bar?.classList.remove("hidden");
      document.getElementById("media-title").textContent = media.title;
      document.getElementById("media-artist").textContent =
        `${media.artist || "Media"} • ${media.status || ""}`;
      if (!bootGreetingActive && timerRemainingSec === 0 && idleLabel && media.status === "Playing") {
        idleLabel.textContent = `${media.title.slice(0, 14)}${media.title.length > 14 ? "…" : ""}`;
      }
    } else {
      bar?.classList.add("hidden");
      if (!bootGreetingActive && timerRemainingSec === 0 && idleLabel) {
        idleLabel.textContent = latestStatusCache && !latestStatusCache.modelReady ? "Setup AI" : "AI Ready";
      }
    }
  } catch {
    // Abaikan jika tidak ada media player aktif
  }
}

function formatTimerClock(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function playSoftChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25); // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.65);
  } catch {}
}

function stopFocusTimer(silent = false) {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerRemainingSec = 0;
  const idleLabel = document.getElementById("idle-label");
  if (idleLabel) idleLabel.textContent = "AI Ready";
  const pomoLabel = document.getElementById("chip-pomodoro-label");
  if (pomoLabel) pomoLabel.textContent = "Fokus 25m";
  if (!silent) showToast("Timer fokus dihentikan.", "ok");
}

function startFocusTimer(seconds, reminderText = "") {
  stopFocusTimer(true);
  timerRemainingSec = Math.max(5, Math.floor(seconds));
  timerCustomLabel = reminderText;

  const renderTick = () => {
    const clock = formatTimerClock(timerRemainingSec);
    const idleLabel = document.getElementById("idle-label");
    if (idleLabel) idleLabel.textContent = `${timerCustomLabel ? "Alarm" : "Fokus"} ${clock}`;
    const pomoLabel = document.getElementById("chip-pomodoro-label");
    if (pomoLabel) pomoLabel.textContent = `Stop ${clock}`;
  };

  renderTick();
  timerInterval = setInterval(() => {
    timerRemainingSec -= 1;
    if (timerRemainingSec <= 0) {
      const doneReminder = timerCustomLabel;
      timerCustomLabel = "";
      stopFocusTimer(true);
      playSoftChime();
      if (doneReminder) {
        showIslandNotification("Pengingat Selesai", doneReminder, "info", true);
        speakText(`Pengingat Anda: ${doneReminder}`);
      } else {
        showIslandNotification("Waktu Fokus Selesai", "Saatnya istirahat sebentar", "ok", true);
        speakText("Waktu fokus selesai. Saatnya istirahat sebentar.");
      }
    } else {
      renderTick();
    }
  }, 1000);
}

function applyChatStyle(style) {
  chatStyle = style === "gemini" ? "gemini" : "default";
  localStorage.setItem("aiku_chat_style", chatStyle);
  const island = document.getElementById("island");
  if (island) {
    island.classList.toggle("chat-gemini", chatStyle === "gemini");
  }
}

function speakText(text, onEnd) {
  if (!("speechSynthesis" in window)) {
    if (onEnd) onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const clean = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
  if (!clean) {
    if (onEnd) onEnd();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "id-ID";
  utterance.rate = 1.06;
  const voices = window.speechSynthesis.getVoices();
  const idVoice = voices.find((v) => v.lang.toLowerCase().startsWith("id"));
  if (idVoice) utterance.voice = idVoice;
  utterance.onend = () => {
    if (onEnd) onEnd();
  };
  utterance.onerror = () => {
    if (onEnd) onEnd();
  };
  window.speechSynthesis.speak(utterance);
}

function stopLiveVoice(returnToPalette = true) {
  liveVoiceActive = false;
  if (activeRecognition) {
    try {
      activeRecognition.onend = null;
      activeRecognition.stop();
    } catch {}
    activeRecognition = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  document.querySelector(".ai-orb")?.classList.remove("speaking");
  if (returnToPalette) {
    setIslandState("palette");
  }
}

function formatCompactCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function getSessionToken() {
  return document.querySelector('meta[name="aiku-session-token"]')?.getAttribute("content") ?? "";
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatSimpleMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="mono">$1</code>')
    .replace(/\n/g, "<br />");
}

function toRelative(fullPath, rootPath) {
  if (!rootPath) return fullPath;
  const normFull = fullPath.replaceAll("\\", "/");
  const normRoot = rootPath.replaceAll("\\", "/").replace(/\/$/, "");
  if (normFull.toLowerCase().startsWith(`${normRoot.toLowerCase()}/`)) {
    return normFull.slice(normRoot.length + 1);
  }
  return fullPath;
}

function resetBalloonVisuals() {
  const wrapper = document.querySelector(".notch-wrapper");
  const island = document.getElementById("island");
  if (wrapper) {
    wrapper.classList.remove("stretching");
    wrapper.style.transform = "";
    wrapper.style.transformOrigin = "top center";
  }
  if (island) {
    island.style.borderBottomLeftRadius = "";
    island.style.borderBottomRightRadius = "";
  }
}

function setIslandState(state) {
  const wrapper = document.querySelector(".notch-wrapper");
  const island = document.getElementById("island");
  resetBalloonVisuals();
  wrapper?.classList.remove("island-hidden");

  // Besarkan jendela dulu hanya jika keluar dari Idle (700px agar kapsul 650px + kuping notch 28px tidak terpotong)
  if (state !== "idle" && island.dataset.state === "idle" && typeof invoke === "function") {
    void invoke("resize_island", { width: 700, height: 440 });
  }

  island.className = `island state-${state}${chatStyle === "gemini" ? " chat-gemini" : ""}`;
  island.dataset.state = state;

  // Setelah animasi mengecil ke Idle selesai (280ms), susutkan jendela ke ukuran cukup untuk hover Quick Access (426x94) tanpa kedip
  if (state === "idle" && typeof invoke === "function") {
    setTimeout(() => {
      if (document.getElementById("island")?.dataset.state === "idle") {
        void invoke("resize_island", { width: 426, height: 94 });
      }
    }, 280);
  }

  if (state === "palette") {
    setBrowserSearchInputMode(false);
    updateWelcomeCard();
    syncWelcomeVisibility();
    // Predictive Pre-Warm: mulai muat model diam-diam selagi user mengetik -> pesan PERTAMA langsung instan!
    void rpc("warmupModel").catch(() => {});
    setTimeout(() => document.getElementById("palette-input")?.focus(), 70);
  }
}

function hideIslandSmoothly() {
  const wrapper = document.querySelector(".notch-wrapper");
  wrapper?.classList.add("island-hidden");
  setTimeout(() => {
    if (typeof invoke === "function") {
      void invoke("hide_island");
    }
  }, 210);
}

function showIslandNotification(title, subtitle = "", type = "ok", forceFase2 = false) {
  const durationMs = Math.max(1000, Math.min(30000, (Number(notifDurationSec) || 4) * 1000));
  const island = document.getElementById("island");
  const currentState = island?.dataset.state || "idle";
  const variant = type === "err" ? "err" : type === "warn" ? "warn" : type === "info" ? "info" : "ok";

  // Jika sedang di Fase 1 (Idle) atau dipaksa masuk Fase 2 (mis. timer selesai / file baru / tes notif)
  // -> Dynamic Island membesar ke Fase 2 lalu mengecil otomatis ke Fase 1 setelah notifDurationSec!
  if ((currentState === "idle" || forceFase2 || activeNotifMode) && !liveVoiceActive) {
    if (activeNotifTimer) clearTimeout(activeNotifTimer);
    activeNotifMode = true;

    document.getElementById("active-voice-visual")?.classList.add("hidden");
    const notifVisual = document.getElementById("active-notif-visual");
    const notifOrb = document.getElementById("active-notif-orb");
    const notifTrack = document.getElementById("active-notif-track");
    const notifBar = document.getElementById("active-notif-bar");

    notifVisual?.classList.remove("hidden");
    if (notifOrb) {
      notifOrb.className = `notif-orb ${variant}`;
      notifOrb.innerHTML = ALERT_SVG_ICONS[variant] || ALERT_SVG_ICONS.ok;
    }

    document.getElementById("active-title").textContent = title;
    document.getElementById("active-subtitle").textContent =
      subtitle || `Notifikasi • Mengecil otomatis (${notifDurationSec}s)`;

    notifTrack?.classList.remove("hidden");
    if (notifBar) {
      notifBar.style.transition = "none";
      notifBar.style.transform = "scaleX(1)";
      void notifBar.offsetWidth;
      notifBar.style.transition = `transform ${durationMs}ms linear`;
      notifBar.style.transform = "scaleX(0)";
    }

    setIslandState("active");

    activeNotifTimer = setTimeout(() => {
      activeNotifMode = false;
      activeNotifTimer = null;
      notifTrack?.classList.add("hidden");
      notifVisual?.classList.add("hidden");
      document.getElementById("active-voice-visual")?.classList.remove("hidden");
      if (document.getElementById("island")?.dataset.state === "active" && !liveVoiceActive) {
        setIslandState("idle");
      }
    }, durationMs);
    return;
  }

  // Jika sedang membuka Fase 3/4/5 -> tampilkan Unified Obsidian Alert Banner selaras tema
  const toast = document.getElementById("island-toast");
  const iconEl = document.getElementById("toast-icon");
  const titleEl = document.getElementById("toast-title");
  const subEl = document.getElementById("toast-sub");
  const barEl = document.getElementById("toast-bar");
  if (!toast) return;

  toast.className = `island-toast ${variant}`;
  if (iconEl) iconEl.innerHTML = ALERT_SVG_ICONS[variant] || ALERT_SVG_ICONS.ok;
  if (titleEl) titleEl.textContent = title;
  if (subEl) {
    subEl.textContent = subtitle || (variant === "err" ? "Peringatan Sistem" : "Status Sistem • aiKu");
  }
  if (barEl) {
    barEl.style.transition = "none";
    barEl.style.transform = "scaleX(1)";
    void barEl.offsetWidth;
    barEl.style.transition = `transform ${durationMs}ms linear`;
    barEl.style.transform = "scaleX(0)";
  }

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), durationMs);
}

function showToast(message, type = "ok", subtitle = "", forceFase2 = false) {
  showIslandNotification(message, subtitle, type, forceFase2);
}

async function rpc(method, params = {}) {
  if (typeof invoke === "function") {
    return invoke("rpc_call", { method, params });
  }
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AiKu-Token": getSessionToken(),
    },
    body: JSON.stringify({ id: rpcCounter++, method, params }),
  });
  const payload = await res.json();
  if (!res.ok || !payload.ok) {
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  return payload.result;
}

async function refreshStatus() {
  try {
    const [status, filesRes] = await Promise.all([
      rpc("getStatus"),
      rpc("search", { query: "semua file", useAi: false }),
    ]);

    latestStatusCache = status;
    currentSandboxRoot = status.primarySandbox;
    if (typeof status.notifDurationSec === "number") {
      notifDurationSec = status.notifDurationSec;
    }
    if (typeof status.hotkey === "string" && typeof invoke === "function") {
      void invoke("set_global_hotkey", { hotkey: status.hotkey }).catch(() => {});
    }
    const count = filesRes.matches?.length ?? 0;

    if (lastKnownFileCount !== null && count !== lastKnownFileCount) {
      const diff = count - lastKnownFileCount;
      if (diff > 0 && document.getElementById("island")?.dataset.state === "idle") {
        showIslandNotification(
          `${diff} File Baru Terdeteksi`,
          `Total ${formatCompactCount(count)} file di folder terdaftar`,
          "info",
          true
        );
      }
    }
    lastKnownFileCount = count;

    document.getElementById("idle-file-count").textContent = formatCompactCount(count);
    if (!bootGreetingActive && timerRemainingSec === 0) {
      document.getElementById("idle-label").textContent = status.modelReady ? "AI Ready" : "Setup AI";
    }
    document.getElementById("inspector-sandbox").textContent = `Sandbox: ${status.primarySandbox}`;
    updateWelcomeCard(status, count);
  } catch (err) {
    showToast(`Status error: ${err}`, "err");
  }
}

let suppressNextClick = false;

function initElasticJellyPhysics() {
  const wrapper = document.querySelector(".notch-wrapper");
  const island = document.getElementById("island");
  if (!wrapper || !island) return;

  let dragging = false;
  let movedEnough = false;
  let startX = 0;
  let startY = 0;
  let lastDy = 0;
  let animFrameId = null;

  // State fisika pegas balon (scaleX, scaleY, shiftX, skewX)
  let curSx = 1, curSy = 1, curTx = 0, curSkew = 0;
  let velSx = 0, velSy = 0, velTx = 0, velSkew = 0;

  function stopSpringLoop() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function applyBalloonTransform() {
    wrapper.style.transform =
      `translateX(${curTx.toFixed(2)}px) scale(${curSx.toFixed(4)}, ${curSy.toFixed(4)}) skewX(${curSkew.toFixed(2)}deg)`;
  }

  function runBalloonSpringBounce() {
    stopSpringLoop();
    const stiffness = 240;
    const damping = 10.5;
    let lastTime = performance.now();

    const tick = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.032);
      lastTime = now;

      // Hukum Hooke teredam (damped harmonic oscillator) -> efek membal balon asli!
      velSx += ((1 - curSx) * stiffness - velSx * damping) * dt;
      velSy += ((1 - curSy) * stiffness - velSy * damping) * dt;
      velTx += ((0 - curTx) * stiffness - velTx * damping) * dt;
      velSkew += ((0 - curSkew) * stiffness - velSkew * damping) * dt;

      curSx += velSx * dt;
      curSy += velSy * dt;
      curTx += velTx * dt;
      curSkew += velSkew * dt;

      applyBalloonTransform();

      const energy =
        Math.abs(1 - curSx) + Math.abs(1 - curSy) + Math.abs(curTx) * 0.01 +
        Math.abs(velSx) * 0.05 + Math.abs(velSy) * 0.05;

      if (energy > 0.0025) {
        animFrameId = requestAnimationFrame(tick);
      } else {
        curSx = 1; curSy = 1; curTx = 0; curSkew = 0;
        velSx = 0; velSy = 0; velTx = 0; velSkew = 0;
        wrapper.style.transform = "";
        wrapper.style.transformOrigin = "top center";
        island.style.borderBottomLeftRadius = "";
        island.style.borderBottomRightRadius = "";
        animFrameId = null;
      }
    };

    animFrameId = requestAnimationFrame(tick);
  }

  let activePointerId = null;

  island.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input, select, button, textarea")) return;
    stopSpringLoop();
    dragging = true;
    movedEnough = false;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lastDy = 0;
  });

  island.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!movedEnough && Math.hypot(dx, dy) < 8) return;

    if (!movedEnough) {
      movedEnough = true;
      if (activePointerId !== null) {
        try {
          island.setPointerCapture(activePointerId);
        } catch {}
      }
    }
    lastDy = dy;
    wrapper.classList.add("stretching");

    // Efek tarik balon yang melar dramatis & menggelembung ke arah tarikan kursor
    const pullY = Math.max(-28, Math.min(150, dy));
    const pullX = Math.max(-150, Math.min(150, dx));

    // Geser titik jangkar sedikit berlawanan agar sisi yang ditarik terasa melar seperti balon
    if (pullX > 18) {
      wrapper.style.transformOrigin = "20% top";
    } else if (pullX < -18) {
      wrapper.style.transformOrigin = "80% top";
    } else {
      wrapper.style.transformOrigin = "50% top";
    }

    const downFactor = Math.tanh(Math.max(0, pullY) / 95);
    const upFactor = Math.tanh(Math.max(0, -pullY) / 50);
    const sideFactor = Math.tanh(Math.abs(pullX) / 110);

    // Volume-preserving balloon squash & stretch (terkontrol agar teks tetap rapi)
    curSy = 1 + downFactor * 0.34 - upFactor * 0.16 - sideFactor * 0.08;
    curSx = 1 + sideFactor * 0.24 - downFactor * 0.12 + upFactor * 0.08;
    curTx = Math.tanh(pullX / 120) * 26;
    curSkew = Math.tanh(pullX / 150) * -6.5;

    // Ujung bawah ikut membulat seperti ujung balon yang ditarik
    const extraRadius = Math.round(20 + downFactor * 26);
    const leftBulge = pullX < 0 ? extraRadius + Math.round(sideFactor * 14) : extraRadius;
    const rightBulge = pullX > 0 ? extraRadius + Math.round(sideFactor * 14) : extraRadius;
    island.style.borderBottomLeftRadius = `${leftBulge}px`;
    island.style.borderBottomRightRadius = `${rightBulge}px`;

    applyBalloonTransform();
  });

  const endStretch = () => {
    if (!dragging) return;
    dragging = false;
    activePointerId = null;
    wrapper.classList.remove("stretching");

    if (movedEnough) {
      suppressNextClick = true;
      setTimeout(() => {
        suppressNextClick = false;
      }, 130);

      island.style.borderBottomLeftRadius = "";
      island.style.borderBottomRightRadius = "";
      runBalloonSpringBounce();

      if (island.dataset.state === "idle" && lastDy > 56) {
        setIslandState("palette");
      } else if (island.dataset.state !== "idle" && lastDy < -26) {
        setIslandState("idle");
      }
    }
  };

  island.addEventListener("pointerup", endStretch);
  island.addEventListener("pointercancel", endStretch);
  window.addEventListener("pointerup", endStretch);
  window.addEventListener("blur", () => {
    dragging = false;
    activePointerId = null;
    stopSpringLoop();
    curSx = 1; curSy = 1; curTx = 0; curSkew = 0;
    velSx = 0; velSy = 0; velTx = 0; velSkew = 0;
    resetBalloonVisuals();
  });
}

function showActiveCapsule(title, subtitle = "Offline Local AI • Qwen 0.5B") {
  if (activeNotifTimer) {
    clearTimeout(activeNotifTimer);
    activeNotifTimer = null;
  }
  activeNotifMode = false;
  document.getElementById("active-notif-visual")?.classList.add("hidden");
  document.getElementById("active-notif-track")?.classList.add("hidden");
  document.getElementById("active-voice-visual")?.classList.remove("hidden");
  document.getElementById("active-title").textContent = title;
  document.getElementById("active-subtitle").textContent = subtitle;
  setIslandState("active");
}

function appendPaletteMessage(role, text, files = null, animate = false) {
  const stream = document.getElementById("palette-chat-stream");
  stream.classList.remove("hidden");

  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "msg-user" : "msg-ai"}`;

  let bodyEl;
  if (role === "assistant" && chatStyle === "gemini") {
    const row = document.createElement("div");
    row.className = "gemini-ai-row";
    row.innerHTML = `<svg class="gemini-spark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2z"/></svg>`;
    bodyEl = document.createElement("div");
    bodyEl.className = "gemini-ai-content";
    row.appendChild(bodyEl);
    div.appendChild(row);
  } else {
    bodyEl = document.createElement("div");
    div.appendChild(bodyEl);
  }

  const attachExtras = () => {
    if (files && files.length > 0) {
      const list = document.createElement("div");
      list.className = "mini-file-list";
      list.innerHTML = files
        .map(
          (f) => `
            <div class="mini-file-row mono">
              <span class="truncate">${escapeHtml(f.relativePath)}</span>
              <span class="text-muted">${f.sizeBytes} B</span>
            </div>
          `
        )
        .join("");
      div.appendChild(list);
    } else if (role === "assistant" && text.length > 12) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      const speakBtn = document.createElement("button");
      speakBtn.type = "button";
      speakBtn.className = "msg-copy-btn mono";
      speakBtn.innerHTML = `<svg class="icon-inline-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1.5px;margin-right:3px"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>Bacakan`;
      speakBtn.addEventListener("click", () => {
        speakText(text);
      });

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "msg-copy-btn mono";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/\*\*([^*]+)\*\*/g, "$1"));
          copyBtn.textContent = "Copied";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
        } catch {
          showToast("Gagal menyalin.", "err");
        }
      });

      actions.appendChild(speakBtn);
      actions.appendChild(copyBtn);
      div.appendChild(actions);
    }
    stream.scrollTop = stream.scrollHeight;
  };

  stream.appendChild(div);
  syncWelcomeVisibility();

  if (role === "assistant" && animate) {
    div.classList.add("typing");
    const tokens = text.split(/(\s+)/);
    let idx = 0;
    let built = "";
    const step = () => {
      built += tokens.slice(idx, idx + 2).join("");
      idx += 2;
      bodyEl.innerHTML = `${formatSimpleMarkdown(built)}<span class="ai-caret"></span>`;
      stream.scrollTop = stream.scrollHeight;
      if (idx < tokens.length) {
        setTimeout(step, 24);
      } else {
        bodyEl.innerHTML = formatSimpleMarkdown(text);
        div.classList.remove("typing");
        attachExtras();
      }
    };
    step();
  } else {
    bodyEl.innerHTML = role === "assistant" ? formatSimpleMarkdown(text) : escapeHtml(text);
    attachExtras();
  }
}

function openInspectorWithPlan(plan, sandboxRoot, title = "Safe Dry-Run Preview") {
  activePlan = plan;
  currentSandboxRoot = sandboxRoot || currentSandboxRoot;

  document.getElementById("inspector-title").textContent = title;
  document.getElementById("inspector-sandbox").textContent = `Sandbox: ${currentSandboxRoot}`;
  document.getElementById("inspector-meta").textContent = `${plan.operations.length} staged • Local AI`;

  const applyBtn = document.getElementById("btn-inspector-apply");
  applyBtn.disabled = plan.operations.length === 0;
  applyBtn.textContent =
    plan.operations.length > 0 ? `Apply ${plan.operations.length} Changes` : "No Changes";

  const list = document.getElementById("inspector-list");
  list.innerHTML = "";

  if (plan.operations.length === 0) {
    list.innerHTML = `<div class="op-row"><span class="op-paths mono text-muted">Sandbox sudah rapi — tidak ada file yang perlu dipindahkan.</span></div>`;
  } else {
    for (const op of plan.operations) {
      const isQ = op.origin === "HYGIENE_QUARANTINE";
      const badgeClass = isQ ? "quarantine" : op.action === "RENAME" ? "rename" : "move";
      const badgeText = isQ ? "QUARANTINE" : op.autoRenamed ? `${op.action} + SUFFIX` : op.action;

      const row = document.createElement("div");
      row.className = "op-row";
      row.innerHTML = `
        <div class="op-paths mono">
          <span class="op-src">${escapeHtml(toRelative(op.source, currentSandboxRoot))}</span>
          <span class="text-cyan"> → </span>
          <span>${escapeHtml(toRelative(op.destination, currentSandboxRoot))}</span>
        </div>
        <span class="op-badge mono ${badgeClass}">${escapeHtml(badgeText)}</span>
      `;
      list.appendChild(row);
    }
  }

  setIslandState("inspector");
}

let currentAvailableModels = [];
let downloadPollTimer = null;

function startDownloadProgressPolling() {
  if (downloadPollTimer) return;
  downloadPollTimer = setInterval(async () => {
    try {
      const status = await rpc("getStatus");
      const dl = status.activeDownload;
      const btn = document.getElementById("btn-download-model");
      const idleLabel = document.getElementById("idle-label");

      const wrap = document.getElementById("download-progress-wrap");
      const nameEl = document.getElementById("dl-progress-name");
      const statsEl = document.getElementById("dl-progress-stats");
      const fillEl = document.getElementById("dl-progress-fill");

      if (!dl) {
        wrap?.classList.add("hidden");
        clearInterval(downloadPollTimer);
        downloadPollTimer = null;
        return;
      }

      if (dl.status === "downloading") {
        const mb = (dl.downloadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = dl.totalBytes ? (dl.totalBytes / (1024 * 1024)).toFixed(0) : null;
        const pctNum = dl.percent !== null ? Math.min(100, Math.max(0, dl.percent)) : 0;
        const pctLabel = dl.percent !== null ? `${pctNum.toFixed(1)}%` : `${mb} MB`;

        wrap?.classList.remove("hidden");
        if (nameEl) nameEl.textContent = dl.fileName;
        if (statsEl) statsEl.textContent = totalMb ? `${mb} / ${totalMb} MB (${pctLabel})` : `${mb} MB`;
        if (fillEl) fillEl.style.width = `${dl.percent !== null ? pctNum : 15}%`;

        if (btn) {
          btn.disabled = true;
          btn.textContent = `DL ${Math.round(pctNum)}%`;
        }
        if (idleLabel && timerRemainingSec === 0) {
          idleLabel.textContent = `DL ${Math.round(pctNum)}%`;
        }
      } else if (dl.status === "done") {
        if (fillEl) fillEl.style.width = "100%";
        if (statsEl) statsEl.textContent = "100% • Selesai";
        setTimeout(() => wrap?.classList.add("hidden"), 2000);
        clearInterval(downloadPollTimer);
        downloadPollTimer = null;
        showToast(`Model ${dl.fileName} selesai diunduh & siap offline!`, "ok");
        await refreshStatus();
        if (document.getElementById("island")?.dataset.state === "security") {
          await openSecurityDrawer("sandbox");
        }
      } else if (dl.status === "error") {
        wrap?.classList.add("hidden");
        clearInterval(downloadPollTimer);
        downloadPollTimer = null;
        showToast(`Download gagal: ${dl.error || "Network error"}`, "err");
        await refreshStatus();
        updateDownloadModelButton();
      }
    } catch {}
  }, 1500);
}

function updateDownloadModelButton() {
  const select = document.getElementById("settings-model");
  const btn = document.getElementById("btn-download-model");
  if (!select || !btn) return;

  const selected = currentAvailableModels.find((m) => m.fileName === select.value);
  if (selected?.downloaded) {
    btn.textContent = "Siap";
    btn.disabled = true;
  } else {
    btn.textContent = `Unduh (${selected?.sizeHint || ""})`;
    btn.disabled = false;
  }
}

function renderSettingsDirs() {
  const container = document.getElementById("settings-dirs-list");
  container.innerHTML = "";
  draftAllowedDirs.forEach((dir, idx) => {
    const chip = document.createElement("span");
    chip.className = "dir-chip mono";
    chip.innerHTML = `<span>${escapeHtml(dir)} ✓</span>`;
    if (draftAllowedDirs.length > 1) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "dir-chip-remove";
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        draftAllowedDirs.splice(idx, 1);
        renderSettingsDirs();
      });
      chip.appendChild(rm);
    }
    container.appendChild(chip);
  });
}

function switchSecurityTab(tab) {
  document.getElementById("seg-sandbox")?.classList.toggle("active", tab === "sandbox");
  document.getElementById("seg-shortcuts")?.classList.toggle("active", tab === "shortcuts");
  document.getElementById("seg-history")?.classList.toggle("active", tab === "history");
  document.getElementById("settings-form")?.classList.toggle("active", tab === "sandbox");
  document.getElementById("shortcuts-panel")?.classList.toggle("active", tab === "shortcuts");
  document.getElementById("history-panel")?.classList.toggle("active", tab === "history");
  if (tab === "shortcuts") {
    renderHoverShortcuts();
    syncShortcutBuilderFields();
  }
}

async function openSecurityDrawer(initialTab = "sandbox") {
  try {
    const [status, hist] = await Promise.all([rpc("getStatus"), rpc("getHistory")]);

    draftAllowedDirs = [...status.allowedDirectories];
    renderSettingsDirs();

    const modelSelect = document.getElementById("settings-model");
    if (modelSelect && Array.isArray(status.availableModels)) {
      currentAvailableModels = status.availableModels;
      modelSelect.innerHTML = status.availableModels
        .map((m) => {
          const badge = m.downloaded ? "Siap Offline" : `Unduh ${m.sizeHint}`;
          return `<option value="${escapeHtml(m.fileName)}">${escapeHtml(m.label)} — ${badge}</option>`;
        })
        .join("");
      modelSelect.value = status.modelFileName;
      updateDownloadModelButton();
      if (status.activeDownload?.status === "downloading") {
        startDownloadProgressPolling();
      }
    }

    document.getElementById("settings-categories").value = status.categories.join(", ");
    document.getElementById("settings-chat-style").value = chatStyle;
    const hotkeyInput = document.getElementById("settings-hotkey");
    if (hotkeyInput) {
      hotkeyInput.value = status.hotkey || "Alt+Space";
      hotkeyInput.classList.remove("recording");
    }
    document.getElementById("settings-ai-mode").value = status.aiMode || "hybrid";
    const keyInput = document.getElementById("settings-gemini-key");
    if (keyInput) {
      keyInput.value = "";
      keyInput.placeholder = status.hasGeminiApiKey
        ? "API Key tersimpan (isi baru untuk mengganti)"
        : "AIza... (opsional untuk soal sulit & riset web)";
    }
    document.getElementById("settings-days").value = String(status.oldInstallerDays);
    const notifDurInput = document.getElementById("settings-notif-duration");
    if (notifDurInput) {
      notifDurInput.value = String(status.notifDurationSec ?? notifDurationSec);
    }
    const autoStartChk = document.getElementById("chk-autostart");
    if (autoStartChk) {
      autoStartChk.checked = Boolean(status.autoStartOnBoot);
    }
    document.getElementById("settings-threads").value = String(status.threads);

    const list = document.getElementById("history-list");
    list.innerHTML = "";
    const records = hist.records ?? [];
    if (records.length === 0) {
      list.innerHTML = `<div class="op-row"><span class="op-paths mono text-muted">Belum ada riwayat transaksi SHA-256.</span></div>`;
    } else {
      for (const rec of records.slice(0, 10)) {
        const row = document.createElement("div");
        row.className = "op-row";
        row.innerHTML = `
          <div class="op-paths mono">
            <span>${escapeHtml(toRelative(rec.destination, currentSandboxRoot))}</span>
            <span class="text-muted"> ↩ ${escapeHtml(toRelative(rec.source, currentSandboxRoot))}</span>
          </div>
          <div class="header-right-group">
            <span class="op-badge mono sha">SHA-256 ✓</span>
            ${
              rec.rolledBackAt
                ? `<span class="op-badge mono rename">DONE</span>`
                : `<button type="button" class="pill-btn-muted mono btn-rb" data-tx-id="${escapeHtml(rec.transactionId)}">Rollback</button>`
            }
          </div>
        `;
        const rbBtn = row.querySelector(".btn-rb");
        if (rbBtn) {
          rbBtn.addEventListener("click", async () => {
            const txId = rbBtn.getAttribute("data-tx-id");
            rbBtn.disabled = true;
            rbBtn.textContent = "...";
            try {
              await rpc("rollback", { transactionId: txId });
              showToast("SHA-256 verified! File dikembalikan.", "ok");
              await refreshStatus();
              await openSecurityDrawer("history");
            } catch (err) {
              showToast(`Rollback dibatalkan: ${err}`, "err");
              rbBtn.disabled = false;
              rbBtn.textContent = "Rollback";
            }
          });
        }
        list.appendChild(row);
      }
    }

    switchSecurityTab(initialTab);
    setIslandState("security");
  } catch (err) {
    showToast(`Gagal memuat Security & Rollback: ${err}`, "err");
  }
}

function appendThinkingBubble() {
  const stream = document.getElementById("palette-chat-stream");
  stream.classList.remove("hidden");
  const div = document.createElement("div");
  div.className = "msg msg-ai typing";
  div.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div>`;
  stream.appendChild(div);
  syncWelcomeVisibility();
  stream.scrollTop = stream.scrollHeight;
  return div;
}

function appendSensitiveAlertCard(alertData) {
  const stream = document.getElementById("palette-chat-stream");
  if (!stream) return;
  stream.classList.remove("hidden");

  const isDanger = alertData.severity === "danger";
  const card = document.createElement("div");
  card.className = `security-alert-card${isDanger ? " danger" : ""}`;

  const iconSvg = isDanger ? ALERT_SVG_ICONS.err : ALERT_SVG_ICONS.warn;
  const badgeLabel = isDanger ? "DIBLOKIR P0 GUARD" : "PENGATURAN SENSITIF";

  card.innerHTML = `
    <div class="security-alert-Card-top">
      <div class="security-alert-head">
        <div class="security-alert-icon">${iconSvg}</div>
        <div class="security-alert-title">${escapeHtml(alertData.title || "Konfirmasi Keamanan")}</div>
      </div>
      <span class="security-alert-badge mono">${badgeLabel}</span>
    </div>
    <div class="security-alert-desc">${escapeHtml(alertData.description || "")}</div>
    <div class="security-diff-box mono">${escapeHtml(alertData.diffLabel || "")}</div>
  `;

  if (alertData.payload && !isDanger) {
    const actions = document.createElement("div");
    actions.className = "security-alert-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-sec-cancel mono";
    cancelBtn.textContent = "Batalkan";

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "btn-sec-approve mono";
    approveBtn.textContent = "Setujui & Terapkan";

    cancelBtn.addEventListener("click", () => {
      approveBtn.disabled = true;
      cancelBtn.disabled = true;
      cancelBtn.textContent = "Dibatalkan";
      showIslandNotification("Perubahan Sensitif Dibatalkan", alertData.title, "warn");
    });

    approveBtn.addEventListener("click", async () => {
      approveBtn.disabled = true;
      cancelBtn.disabled = true;
      approveBtn.textContent = "Menerapkan...";
      try {
        await rpc("updateConfig", alertData.payload);
        approveBtn.textContent = "Diterapkan";
        await refreshStatus();
        showIslandNotification(
          "Pengaturan Sensitif Diterapkan",
          alertData.diffLabel || alertData.title,
          "ok"
        );
      } catch (err) {
        approveBtn.textContent = "Ditolak";
        showIslandNotification("Gagal Menerapkan Pengaturan", String(err), "err");
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(approveBtn);
    card.appendChild(actions);
  }

  stream.appendChild(card);
  syncWelcomeVisibility();
  stream.scrollTop = stream.scrollHeight;
}

async function handleChatPrompt(rawMessage) {
  const message = rawMessage.trim();
  if (!message) return;

  const enableAiForFiles = document.getElementById("chk-ai-docs")?.checked ?? false;
  chatHistory.push({ role: "user", content: message });
  appendPaletteMessage("user", message);

  // Tetap di State 3 (Chat) dengan animasi 3 titik berpikir — State 2 khusus Voice & Notifikasi!
  const thinkingEl = appendThinkingBubble();

  try {
    const res = await rpc("chat", {
      message,
      history: chatHistory.slice(-6),
      enableAiForFiles,
    });
    thinkingEl.remove();
    chatHistory.push({ role: "assistant", content: res.reply });

    if (res.attachment?.type === "plan" && res.attachment.plan) {
      appendPaletteMessage("assistant", res.reply);
      openInspectorWithPlan(res.attachment.plan, res.attachment.sandboxRoot);
    } else if (res.attachment?.type === "history") {
      await openSecurityDrawer("history");
    } else if (res.attachment?.type === "timer" && res.attachment.seconds) {
      startFocusTimer(res.attachment.seconds);
      appendPaletteMessage("assistant", res.reply, null, true);
    } else if (res.attachment?.type === "reminder" && res.attachment.seconds) {
      startFocusTimer(res.attachment.seconds, res.attachment.text || "Pengingat");
      appendPaletteMessage("assistant", res.reply, null, true);
    } else if (res.attachment?.type === "setting_applied") {
      appendPaletteMessage("assistant", res.reply, null, true);
      if (res.attachment.setting === "notifDurationSec") {
        notifDurationSec = Number(res.attachment.value) || 4;
      } else if (res.attachment.setting === "chatStyle") {
        applyChatStyle(res.attachment.value);
      } else if (res.attachment.setting === "hotkey" && typeof invoke === "function") {
        void invoke("set_global_hotkey", { hotkey: String(res.attachment.value) }).catch(() => {});
      } else if (res.attachment.setting === "addHoverShortcut" && res.attachment.value) {
        if (hoverShortcuts.length >= 5) hoverShortcuts.pop();
        hoverShortcuts.push(res.attachment.value);
        saveHoverShortcuts();
      }
      await refreshStatus();
      showIslandNotification(
        res.attachment.notifTitle || "Pengaturan Diperbarui",
        res.attachment.notifSub || "Diterapkan oleh Asisten AI",
        "ok"
      );
    } else if (res.attachment?.type === "sensitive_alert") {
      appendPaletteMessage("assistant", res.reply, null, false);
      appendSensitiveAlertCard(res.attachment);
    } else if (res.attachment?.type === "files") {
      appendPaletteMessage("assistant", res.reply, res.attachment.files, true);
    } else {
      appendPaletteMessage("assistant", res.reply, null, true);
    }
  } catch (err) {
    thinkingEl.remove();
    showToast(`Error: ${err}`, "err");
  }
}

async function runQuickOrganize() {
  const enableAi = document.getElementById("chk-ai-docs")?.checked ?? false;
  showActiveCapsule("Menyiapkan Safe Dry-Run...", enableAi ? "Qwen 0.5B Smart Docs" : "Fast Path (0 MB AI)");
  try {
    const data = await rpc("planOrganize", { enableAi });
    openInspectorWithPlan(data.plan, data.sandboxRoot, "Safe Dry-Run Preview");
  } catch (err) {
    showToast(`Organize error: ${err}`, "err");
    setIslandState("palette");
  }
}

async function runQuickHygiene() {
  showActiveCapsule("Memindai Duplikat SHA-256...", "Checking duplicates & old installers");
  try {
    const data = await rpc("planHygiene");
    openInspectorWithPlan(data.plan, data.sandboxRoot, "Quarantine Dry-Run");
  } catch (err) {
    showToast(`Hygiene error: ${err}`, "err");
    setIslandState("palette");
  }
}

async function runSummarizeClipboard() {
  try {
    const clipText = (await navigator.clipboard.readText()).trim();
    if (!clipText) {
      showToast("Clipboard kosong.", "err");
      return;
    }
    recordClipboardEntry(clipText);
    showActiveCapsule("Meringkas Clipboard...", "Quick TL;DR • Qwen 0.5B");
    const res = await rpc("quickTldr", { text: clipText });
    appendPaletteMessage("assistant", `**Ringkasan (${res.wordCount} kata):**\n${res.summary}`, null, true);
    setIslandState("palette");
  } catch (err) {
    showToast(`Gagal meringkas: ${err}`, "err");
    setIslandState("palette");
  }
}

async function runFormatPdfClipboard() {
  try {
    const clipText = (await navigator.clipboard.readText()).trim();
    if (!clipText) {
      showToast("Clipboard kosong.", "err");
      return;
    }
    recordClipboardEntry(clipText);
    const res = await rpc("formatClipboard", { text: clipText });
    await navigator.clipboard.writeText(res.formatted);
    appendPaletteMessage("assistant", `**Teks PDF dirapikan & disalin:**\n${res.formatted.slice(0, 350)}`, null, true);
    showToast("Teks PDF rapi & tersalin!", "ok");
    setIslandState("palette");
  } catch (err) {
    showToast(`Gagal merapikan: ${err}`, "err");
  }
}

async function runExtractTodoClipboard() {
  try {
    const clipText = (await navigator.clipboard.readText()).trim();
    if (!clipText) {
      showToast("Clipboard kosong. Salin teks catatan/tugas dulu.", "err");
      return;
    }
    const res = await rpc("extractTodos", { text: clipText });
    if (!res.items || res.items.length === 0) {
      showToast("Tidak ada item to-do yang terdeteksi di clipboard.", "err");
      return;
    }
    await navigator.clipboard.writeText(res.markdown);
    appendPaletteMessage(
      "assistant",
      `**${res.items.length} To-Do diekstrak & disalin (Markdown):**\n${res.markdown}`,
      null,
      true
    );
    showToast(`${res.items.length} To-Do disalin sebagai Markdown checklist!`, "ok");
    setIslandState("palette");
  } catch (err) {
    showToast(`Gagal ekstrak To-Do: ${err}`, "err");
  }
}

async function applyActivePlan() {
  if (!activePlan || activePlan.operations.length === 0) return;
  showActiveCapsule("Menerapkan Perubahan...", "Computing SHA-256 & audit log");
  try {
    const res = await rpc("executePlan", { planId: activePlan.planId, confirmToken: "CONFIRM_EXECUTE" });
    activePlan = null;
    showToast(`Applied ${res.executedCount} ops • SHA-256 logged`, "ok");
    await refreshStatus();
    setIslandState("idle");
  } catch (err) {
    showToast(`Eksekusi gagal: ${err}`, "err");
    setIslandState("inspector");
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const chosenStyle = document.getElementById("settings-chat-style")?.value ?? "default";
  applyChatStyle(chosenStyle);

  const categories = document
    .getElementById("settings-categories")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const oldInstallerDays = Number.parseInt(document.getElementById("settings-days").value, 10);
  const parsedNotifDur = Number.parseInt(
    document.getElementById("settings-notif-duration")?.value || "4",
    10
  );
  const nextNotifDuration = Math.min(30, Math.max(1, Number.isNaN(parsedNotifDur) ? 4 : parsedNotifDur));
  notifDurationSec = nextNotifDuration;
  const autoStartOnBoot = Boolean(document.getElementById("chk-autostart")?.checked);
  const hotkeyVal = document.getElementById("settings-hotkey")?.value.trim() || "Alt+Space";
  const threads = Number.parseInt(document.getElementById("settings-threads").value, 10);
  const modelFileName = document.getElementById("settings-model")?.value;
  const aiMode = document.getElementById("settings-ai-mode")?.value || "hybrid";
  const rawGeminiKey = document.getElementById("settings-gemini-key")?.value.trim();

  try {
    await rpc("updateConfig", {
      allowedDirectories: draftAllowedDirs,
      categories,
      oldInstallerDays,
      notifDurationSec: nextNotifDuration,
      autoStartOnBoot,
      hotkey: hotkeyVal,
      threads,
      aiMode,
      ...(modelFileName ? { modelFileName } : {}),
      ...(rawGeminiKey ? { geminiApiKey: rawGeminiKey } : {}),
    });
    if (typeof invoke === "function") {
      await invoke("set_global_hotkey", { hotkey: hotkeyVal });
    }
    await refreshStatus();
    showIslandNotification(
      "Pengaturan Tersimpan",
      `Hotkey: ${hotkeyVal} • Notif: ${nextNotifDuration}s`,
      "ok",
      true
    );
  } catch (err) {
    showToast(`Ditolak: ${err}`, "err");
  }
}

function listenOnceForLiveVoice() {
  if (!liveVoiceActive) return;
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    stopLiveVoice(true);
    showToast("Mikrofon/SpeechRecognition tidak tersedia di WebView ini.", "err");
    return;
  }

  document.querySelector(".ai-orb")?.classList.remove("speaking");
  showActiveCapsule('"Silakan bicara..."', "Live Voice • Mendengarkan (id-ID)");

  const recognition = new SpeechRec();
  activeRecognition = recognition;
  recognition.lang = "id-ID";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  recognition.onresult = (e) => {
    const t = Array.from(e.results)
      .map((r) => r[0].transcript)
      .join("");
    document.getElementById("active-title").textContent = `"${t}"`;
    if (e.results[e.results.length - 1]?.isFinal) {
      finalText = t.trim();
    }
  };

  recognition.onend = () => {
    activeRecognition = null;
    if (!liveVoiceActive) return;

    if (!finalText) {
      // Belum ada suara -> dengarkan lagi selama mode Live masih aktif
      setTimeout(() => listenOnceForLiveVoice(), 350);
      return;
    }

    void (async () => {
      const spoken = finalText;
      chatHistory.push({ role: "user", content: spoken });
      appendPaletteMessage("user", spoken);
      showActiveCapsule(`"${spoken.slice(0, 40)}"`, "Live Voice • Qwen 0.5B berpikir...");

      try {
        const res = await rpc("chat", {
          message: spoken,
          history: chatHistory.slice(-6),
          enableAiForFiles: document.getElementById("chk-ai-docs")?.checked ?? false,
        });
        chatHistory.push({ role: "assistant", content: res.reply });
        appendPaletteMessage("assistant", res.reply, res.attachment?.files ?? null, false);

        if (res.attachment?.type === "plan" && res.attachment.plan) {
          stopLiveVoice(false);
          openInspectorWithPlan(res.attachment.plan, res.attachment.sandboxRoot);
          speakText(res.reply);
          return;
        }

        if (!liveVoiceActive) return;
        document.querySelector(".ai-orb")?.classList.add("speaking");
        showActiveCapsule(res.reply.slice(0, 48), "Live Voice • aiKu berbicara...");
        speakText(res.reply, () => {
          if (liveVoiceActive) {
            listenOnceForLiveVoice();
          }
        });
      } catch (err) {
        showToast(`Live Voice error: ${err}`, "err");
        stopLiveVoice(true);
      }
    })();
  };

  recognition.onerror = (ev) => {
    activeRecognition = null;
    if (!liveVoiceActive) return;
    if (ev.error === "no-speech") {
      setTimeout(() => listenOnceForLiveVoice(), 350);
    } else {
      showToast(`Mic error: ${ev.error}`, "err");
      stopLiveVoice(true);
    }
  };

  recognition.start();
}

function startVoiceInput() {
  if (liveVoiceActive) {
    stopLiveVoice(true);
    return;
  }
  liveVoiceActive = true;
  listenOnceForLiveVoice();
}

document.addEventListener("DOMContentLoaded", () => {
  // Klik di luar Dynamic Island -> mengecil ke State 1 (Idle Pill), TIDAK auto-hide!
  // Tekan Ctrl 2x cepat -> Toggle Hide / Show penuh!
  if (typeof listen === "function") {
    void listen("island-blur", () => {
      const current = document.getElementById("island")?.dataset.state;
      if (current && current !== "idle" && current !== "active") {
        setIslandState("idle");
      }
    });
    void listen("island-toggle-hide", () => {
      hideIslandSmoothly();
    });
    void listen("island-summon", () => {
      setIslandState("palette");
    });
  }

  // Klik area transparan di dalam jendela di luar kapsul -> mengecil ke Idle Pill
  document.querySelector(".stage")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget && document.getElementById("island")?.dataset.state !== "idle") {
      setIslandState("idle");
    }
  });

  document.getElementById("view-idle").addEventListener("click", (e) => {
    if (suppressNextClick || e.target.closest("#btn-idle-mic, #idle-hover-dock")) return;
    setIslandState("palette");
  });
  document.getElementById("btn-customize-hover")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void openSecurityDrawer("shortcuts");
  });
  document.getElementById("btn-idle-mic").addEventListener("click", (e) => {
    e.stopPropagation();
    startVoiceInput();
  });
  document.getElementById("btn-active-stop").addEventListener("click", () => {
    if (activeNotifMode) {
      if (activeNotifTimer) clearTimeout(activeNotifTimer);
      activeNotifTimer = null;
      activeNotifMode = false;
      document.getElementById("active-notif-track")?.classList.add("hidden");
      document.getElementById("active-notif-visual")?.classList.add("hidden");
      document.getElementById("active-voice-visual")?.classList.remove("hidden");
      setIslandState("idle");
      return;
    }
    stopLiveVoice(true);
  });
  document.getElementById("chip-live-voice")?.addEventListener("click", () => startVoiceInput());

  document.getElementById("palette-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("palette-input");
    const val = input.value.trim();
    input.value = "";
    if (!val) return;
    if (browserSearchMode) {
      setBrowserSearchInputMode(false);
      void rpc("openBrowserSearch", { target: val })
        .then((res) => showToast(res.message, "ok"))
        .catch((err) => showToast(`Gagal membuka browser: ${err}`, "err"));
      return;
    }
    void handleChatPrompt(val);
  });
  document.getElementById("btn-palette-mic").addEventListener("click", startVoiceInput);
  document.getElementById("btn-open-inbox")?.addEventListener("click", () => {
    const panel = document.getElementById("inbox-panel");
    if (panel && !panel.classList.contains("hidden")) {
      closeInboxPanel();
    } else {
      openInboxPanel();
    }
  });
  document.getElementById("btn-inbox-close")?.addEventListener("click", () => closeInboxPanel());
  document.getElementById("inbox-filter-all")?.addEventListener("click", () => {
    inboxFilter = "all";
    document.getElementById("inbox-filter-all")?.classList.add("active");
    document.getElementById("inbox-filter-wa")?.classList.remove("active");
    renderInboxList();
  });
  document.getElementById("inbox-filter-wa")?.addEventListener("click", () => {
    inboxFilter = "wa";
    document.getElementById("inbox-filter-wa")?.classList.add("active");
    document.getElementById("inbox-filter-all")?.classList.remove("active");
    renderInboxList();
  });
  document.getElementById("btn-inbox-sim")?.addEventListener("click", () => {
    const now = Date.now();
    const samples = [
      {
        id: `sim-wa-${now}-1`,
        appId: "WhatsAppDesktop",
        appName: "WhatsApp",
        isWhatsApp: true,
        sender: "Raka Pratama",
        body: "Bro, file presentasi yang tadi sudah beres belum?",
        arrivalTimeMs: now,
      },
      {
        id: `sim-wa-${now}-2`,
        appId: "WhatsAppDesktop",
        appName: "WhatsApp",
        isWhatsApp: true,
        sender: "Dina Kartika",
        body: "Jadi meeting jam 10 nanti atau mundur ya?",
        arrivalTimeMs: now - 15000,
      },
    ];
    inboxItems = [...samples, ...inboxItems].slice(0, 30);
    selectedInboxId = samples[0].id;
    lastActiveNotifInboxId = samples[0].id;
    renderInboxList();
    showIslandNotification(
      `WhatsApp • ${samples[0].sender}`,
      samples[0].body,
      "info",
      true
    );
  });
  document.getElementById("btn-inbox-draft")?.addEventListener("click", async () => {
    const selected = inboxItems.find((it) => it.id === selectedInboxId);
    const input = document.getElementById("inbox-reply-input");
    const draftBtn = document.getElementById("btn-inbox-draft");
    if (!selected || !input || !draftBtn) return;
    draftBtn.disabled = true;
    draftBtn.textContent = "Menulis...";
    try {
      const res = await rpc("draftReply", { sender: selected.sender, body: selected.body });
      input.value = res.draft || "";
      input.focus();
    } catch (err) {
      showToast(`Gagal membuat draf: ${err}`, "err");
    } finally {
      draftBtn.disabled = false;
      draftBtn.textContent = "Draft AI";
    }
  });
  document.getElementById("inbox-reply-box")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const selected = inboxItems.find((it) => it.id === selectedInboxId);
    const input = document.getElementById("inbox-reply-input");
    const replyText = input?.value.trim();
    if (!selected || !replyText) return;
    try {
      await navigator.clipboard.writeText(replyText);
    } catch {}
    if (selected.isWhatsApp) {
      try {
        await rpc("replyWhatsApp", { text: replyText });
        if (input) input.value = "";
        showIslandNotification(
          `Membuka WhatsApp (${selected.sender})`,
          "Balasan siap kirim & sudah disalin ke clipboard",
          "ok"
        );
      } catch (err) {
        showToast(`Gagal membuka WhatsApp: ${err}`, "err");
      }
    } else {
      if (input) input.value = "";
      showIslandNotification("Balasan Disalin", `Teks balasan untuk ${selected.sender} disalin ke clipboard`, "ok");
    }
  });

  // Klik area notifikasi Fase 2 -> langsung buka Inbox Notifikasi dengan pesan tersebut terpilih
  document.getElementById("view-active")?.addEventListener("click", (e) => {
    if (e.target.closest("#btn-active-stop") || !activeNotifMode || !lastActiveNotifInboxId) return;
    if (activeNotifTimer) clearTimeout(activeNotifTimer);
    activeNotifTimer = null;
    activeNotifMode = false;
    document.getElementById("active-notif-track")?.classList.add("hidden");
    document.getElementById("active-notif-visual")?.classList.add("hidden");
    document.getElementById("active-voice-visual")?.classList.remove("hidden");
    setIslandState("palette");
    openInboxPanel(lastActiveNotifInboxId);
  });

  document.getElementById("btn-open-security").addEventListener("click", () => void openSecurityDrawer("sandbox"));
  document.getElementById("btn-quit-app").addEventListener("click", () => {
    if (typeof invoke === "function") void invoke("quit_app");
    else window.close();
  });

  document.getElementById("chip-organize").addEventListener("click", () => void runQuickOrganize());
  document.getElementById("chip-clipboard").addEventListener("click", () => void runSummarizeClipboard());
  document.getElementById("chip-hygiene").addEventListener("click", () => void runQuickHygiene());
  document.getElementById("chip-format-pdf").addEventListener("click", () => void runFormatPdfClipboard());
  document.getElementById("chip-extract-todo")?.addEventListener("click", () => void runExtractTodoClipboard());
  document.getElementById("chip-pomodoro")?.addEventListener("click", () => {
    if (timerRemainingSec > 0) {
      stopFocusTimer(false);
    } else {
      startFocusTimer(25 * 60);
      showToast("Timer fokus 25 menit dimulai! Lihat hitung mundur di Idle Pill.", "ok");
    }
  });
  document.getElementById("chip-more-tools")?.addEventListener("click", (e) => {
    const moreGrid = document.getElementById("more-tools-grid");
    const btn = e.currentTarget;
    if (moreGrid) {
      const isHidden = moreGrid.classList.toggle("hidden");
      btn.classList.toggle("active", !isHidden);
    }
  });
  document.getElementById("chip-clip-history")?.addEventListener("click", () => showClipboardHistory());

  // Tombol Quick-Start pada Welcoming Hero Card & Reset Chat
  document.querySelectorAll(".welcome-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const promptText = pill.getAttribute("data-prompt");
      if (promptText) {
        void handleChatPrompt(promptText);
      }
    });
  });
  document.getElementById("btn-clear-chat")?.addEventListener("click", () => clearChatConversation());

  // Music Player Controls (Windows 11 GSMTC)
  document.getElementById("btn-media-prev")?.addEventListener("click", () => void pollMediaPlayer("prev"));
  document.getElementById("btn-media-toggle")?.addEventListener("click", () => void pollMediaPlayer("toggle"));
  document.getElementById("btn-media-next")?.addEventListener("click", () => void pollMediaPlayer("next"));

  // Drag-and-Drop file langsung ke Dynamic Island -> ringkas cepat (aman, maks 1.500 kata)
  const islandEl = document.getElementById("island");
  islandEl?.addEventListener("dragover", (e) => {
    e.preventDefault();
    islandEl.classList.add("drag-over");
  });
  islandEl?.addEventListener("dragleave", () => islandEl.classList.remove("drag-over"));
  islandEl?.addEventListener("drop", async (e) => {
    e.preventDefault();
    islandEl.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.(txt|md|json|csv|log)$/i.test(file.name)) {
      const content = (await file.text()).slice(0, 6000);
      setIslandState("palette");
      showActiveCapsule(`Meringkas ${file.name}...`, "Drag & Drop Quick TL;DR");
      try {
        const res = await rpc("quickTldr", { text: content });
        appendPaletteMessage("assistant", `**Ringkasan ${file.name}:**\n${res.summary}`, null, true);
        setIslandState("palette");
      } catch (err) {
        showToast(`Gagal meringkas file: ${err}`, "err");
        setIslandState("palette");
      }
    } else {
      setIslandState("palette");
      showToast(`File "${file.name}" diterima — pindahkan ke folder sandbox untuk Organize/Rename otomatis.`, "ok");
    }
  });

  // Poll ringan status Music Player Windows setiap 5 detik & Notifikasi Windows/WhatsApp setiap 3.5 detik
  void pollMediaPlayer("get");
  setInterval(() => void pollMediaPlayer("get"), 5000);
  void pollIncomingWindowsNotifications();
  setInterval(() => void pollIncomingWindowsNotifications(), 3500);

  document.getElementById("btn-inspector-gear").addEventListener("click", () => void openSecurityDrawer("sandbox"));
  document.getElementById("btn-inspector-undo").addEventListener("click", () => void openSecurityDrawer("history"));
  document.getElementById("btn-inspector-cancel").addEventListener("click", () => setIslandState("palette"));
  document.getElementById("btn-inspector-apply").addEventListener("click", () => void applyActivePlan());

  document.getElementById("btn-security-back").addEventListener("click", () => setIslandState("palette"));
  document.getElementById("seg-sandbox").addEventListener("click", () => switchSecurityTab("sandbox"));
  document.getElementById("seg-shortcuts")?.addEventListener("click", () => switchSecurityTab("shortcuts"));
  document.getElementById("seg-history").addEventListener("click", () => switchSecurityTab("history"));
  document.getElementById("sc-type")?.addEventListener("change", syncShortcutBuilderFields);
  document.getElementById("sc-target-app")?.addEventListener("change", syncShortcutBuilderFields);
  document.getElementById("sc-target-sys")?.addEventListener("change", syncShortcutBuilderFields);
  document.getElementById("btn-sc-reset")?.addEventListener("click", () => {
    hoverShortcuts = [...DEFAULT_HOVER_SHORTCUTS];
    saveHoverShortcuts();
    showToast("Shortcut hover dikembalikan ke default.", "ok");
  });
  document.getElementById("btn-sc-add")?.addEventListener("click", () => {
    if (hoverShortcuts.length >= 5) {
      showToast("Maksimal 5 shortcut di bar hover. Hapus salah satu dulu.", "err");
      return;
    }
    const type = document.getElementById("sc-type")?.value || "app";
    const icon = document.getElementById("sc-icon")?.value || "app";
    let target = "";
    let defaultLabel = "Shortcut";

    if (type === "app") {
      target = document.getElementById("sc-target-app")?.value || "OPEN_CHROME";
      defaultLabel = APP_PRESET_META[target]?.label || "App";
    } else if (type === "web") {
      const rawWeb = document.getElementById("sc-target-web")?.value.trim() || "";
      target = rawWeb || "PROMPT_SEARCH";
      defaultLabel = rawWeb ? rawWeb.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 12) : "Search";
    } else if (type === "system") {
      target = document.getElementById("sc-target-sys")?.value || "OPEN_SANDBOX";
      defaultLabel = SYSTEM_PRESET_META[target]?.label || "Sistem";
    }

    const customLabel = document.getElementById("sc-label")?.value.trim();
    const label = (customLabel || defaultLabel).slice(0, 14);

    hoverShortcuts.push({
      id: `sc-${Date.now()}`,
      type,
      target,
      label,
      icon,
    });
    saveHoverShortcuts();
    const webInput = document.getElementById("sc-target-web");
    if (webInput) webInput.value = "";
    showToast(`Shortcut "${label}" ditambahkan ke menu Hover!`, "ok");
  });
  document.getElementById("settings-form").addEventListener("submit", (e) => void saveSettings(e));

  // Interactive 1-3 Key Hotkey Recorder
  const hotkeyInput = document.getElementById("settings-hotkey");
  if (hotkeyInput) {
    let recordingHotkey = false;
    hotkeyInput.addEventListener("focus", () => {
      recordingHotkey = true;
      hotkeyInput.classList.add("recording");
      hotkeyInput.dataset.prevVal = hotkeyInput.value;
      hotkeyInput.value = "Tekan 1–3 tombol...";
    });
    hotkeyInput.addEventListener("blur", () => {
      recordingHotkey = false;
      hotkeyInput.classList.remove("recording");
      if (hotkeyInput.value === "Tekan 1–3 tombol...") {
        hotkeyInput.value = hotkeyInput.dataset.prevVal || "Alt+Space";
      }
    });
    hotkeyInput.addEventListener("keydown", (e) => {
      if (!recordingHotkey) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        hotkeyInput.value = hotkeyInput.dataset.prevVal || "Alt+Space";
        hotkeyInput.blur();
        return;
      }

      const keys = [];
      if (e.ctrlKey) keys.push("Ctrl");
      if (e.altKey) keys.push("Alt");
      if (e.shiftKey) keys.push("Shift");

      const rawKey = e.key;
      const isModifierOnly = ["Control", "Alt", "Shift", "Meta"].includes(rawKey);
      if (!isModifierOnly) {
        let normalized = "";
        if (rawKey === " ") normalized = "Space";
        else if (rawKey === "`") normalized = "Backquote";
        else if (/^F([1-9]|1[0-2])$/i.test(rawKey)) normalized = rawKey.toUpperCase();
        else if (/^[a-zA-Z0-9]$/.test(rawKey)) normalized = rawKey.toUpperCase();
        else if (["Tab", "Enter", "Insert", "Delete", "Home", "End", "PageUp", "PageDown"].includes(rawKey)) {
          normalized = rawKey;
        }
        if (normalized && !keys.includes(normalized)) {
          keys.push(normalized);
        }
      }

      if (keys.length >= 1 && keys.length <= 3) {
        const combo = keys.slice(0, 3).join("+");
        hotkeyInput.value = combo;
        if (!isModifierOnly) {
          hotkeyInput.dataset.prevVal = combo;
          hotkeyInput.blur();
          showIslandNotification("Hotkey Direkam", `${combo} — klik Simpan untuk menerapkan`, "info");
        }
      }
    });
  }
  document.getElementById("btn-test-notif")?.addEventListener("click", () => {
    const durInput = document.getElementById("settings-notif-duration");
    if (durInput) {
      const val = Number.parseInt(durInput.value, 10);
      if (!Number.isNaN(val)) notifDurationSec = Math.min(30, Math.max(1, val));
    }
    showIslandNotification(
      "Notifikasi Dynamic Island Aktif",
      `Mengecil otomatis ke Fase 1 dalam ${notifDurationSec} detik`,
      "ok",
      true
    );
  });
  document.getElementById("settings-model")?.addEventListener("change", updateDownloadModelButton);
  document.getElementById("btn-download-model")?.addEventListener("click", async () => {
    const select = document.getElementById("settings-model");
    const btn = document.getElementById("btn-download-model");
    if (!select || !btn) return;
    const chosenFile = select.value;
    btn.disabled = true;
    btn.textContent = "Memulai...";
    showToast(`Mulai mengunduh ${chosenFile} di latar belakang...`, "ok");
    try {
      await rpc("setupModel", { modelFileName: chosenFile });
      startDownloadProgressPolling();
    } catch (err) {
      showToast(`Gagal memulai download: ${err}`, "err");
      updateDownloadModelButton();
    }
  });
  document.getElementById("btn-add-dir").addEventListener("click", () => {
    const input = document.getElementById("settings-new-dir");
    const val = input.value.trim();
    if (val && !draftAllowedDirs.includes(val)) {
      draftAllowedDirs.push(val);
      input.value = "";
      renderSettingsDirs();
    }
  });
  document.getElementById("btn-open-sandbox").addEventListener("click", async () => {
    try {
      const res = await rpc("safeCommand", { command: "OPEN_SANDBOX" });
      showToast(res.message.replace(/`/g, ""), "ok");
    } catch (err) {
      showToast(`${err}`, "err");
    }
  });

  ["handle-palette", "handle-inspector", "handle-security"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", () => setIslandState("idle"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setIslandState("idle");
  });

  // Aktifkan fisika karet elastis (tarik tepian Dynamic Island!)
  initElasticJellyPhysics();

  // Terapkan gaya chat tersimpan (default / gemini), render shortcut hover & mulai di State 1 (Idle Pill)
  localStorage.removeItem("aiku_ui_theme");
  applyChatStyle(chatStyle);
  renderHoverShortcuts();
  setIslandState("idle");
  runBootWelcomeAnimation();
  void refreshStatus();
});
