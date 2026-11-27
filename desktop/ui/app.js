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
let ledgeHub = null;
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

const BRAND_SHORTCUT_SVGS = {
  OPEN_CHROME: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#EA4335"/><path d="M12 12L21.5 9A10 10 0 0 1 12 22Z" fill="#FBBC05"/><path d="M12 12L12 22A10 10 0 0 1 2.8 8Z" fill="#34A853"/><circle cx="12" cy="12" r="4.5" fill="#FFFFFF"/><circle cx="12" cy="12" r="3.4" fill="#4285F4"/></svg>`,
  OPEN_VSCODE: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 2L22 4.2v15.6L17.5 22 9 14.5 4.2 18 2 16.8V7.2L4.2 6 9 9.5 17.5 2Z" fill="#007ACC"/><path d="M17.5 6.8L11.8 12l5.7 5.2V6.8Z" fill="#0D0D12"/></svg>`,
  OPEN_SPOTIFY: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#1DB954"/><path d="M7 9.5c3.5-1 7.5-.7 10.5 1M7.8 12.8c2.8-.8 6-.5 8.5.9M8.5 15.8c2.2-.6 4.7-.4 6.6.7" stroke="#0B0B0F" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>`,
  OPEN_YOUTUBE: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" fill="#FF0000"/><polygon points="10,9 16,12 10,15" fill="#FFFFFF"/></svg>`,
  OPEN_WHATSAPP: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#25D366"/><path d="M9.5 8.5c.3-.5.7-.5 1 0l.8 1.6c.2.4.1.8-.2 1.1l-.5.5c.5 1 1.3 1.8 2.3 2.3l.5-.5c.3-.3.7-.4 1.1-.2l1.6.8c.5.3.5.7 0 1-.8.8-2 1-3.2.5-2.1-.9-4.1-2.9-5-5-.5-1.2-.3-2.4.6-3.1Z" fill="#FFFFFF"/></svg>`,
};

const AIKU_ACOUSTIC_LOGO_SVG = `<svg class="gemini-spark aiku-logo-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 11.2a3.8 3.8 0 1 0 0 5.6v-5.6ZM13.5 14v3.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.9 10.6a5.4 5.4 0 0 1 0 6.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.82"/><path d="M19.5 8.4a8.4 8.4 0 0 1 0 11.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.45"/></svg>`;

function getShortcutIconSvg(sc) {
  if (sc && sc.type === "app" && BRAND_SHORTCUT_SVGS[sc.target]) {
    return BRAND_SHORTCUT_SVGS[sc.target];
  }
  return HOVER_SVG_ICONS[sc?.icon] || HOVER_SVG_ICONS.app;
}

const DEFAULT_HOVER_SHORTCUTS = [
  { id: "sc-chrome", type: "app", target: "OPEN_CHROME", label: "Google Chrome", icon: "globe" },
  { id: "sc-vscode", type: "app", target: "OPEN_VSCODE", label: "VS Code", icon: "code" },
  { id: "sc-spotify", type: "app", target: "OPEN_SPOTIFY", label: "Spotify", icon: "music" },
  { id: "sc-youtube", type: "app", target: "OPEN_YOUTUBE", label: "YouTube", icon: "globe" },
  { id: "sc-whatsapp", type: "app", target: "OPEN_WHATSAPP", label: "WhatsApp", icon: "app" },
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
    input.placeholder = "Tanya aiku, hitung, cari file, atau ketik perintah...";
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
      btn.dataset.tip = `${sc.label} • Klik untuk membuka`;
      btn.setAttribute("aria-label", sc.label);
      const svg = getShortcutIconSvg(sc);
      btn.innerHTML = svg;
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
      const svg = getShortcutIconSvg(sc);
      chip.innerHTML = `<span style="width:14px;height:14px;display:inline-flex;color:#d4d4d8">${svg}</span><span>${escapeHtml(sc.label)}</span><span class="sc-chip-type">${escapeHtml(sc.type)}</span>`;
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
  if (lower.includes("qwen3") && lower.includes("4b")) return "Qwen3 4B";
  if (lower.includes("qwen3") && lower.includes("1.7b")) return "Qwen3 1.7B";
  if (lower.includes("gemma-3") || (lower.includes("gemma") && lower.includes("4b"))) return "Gemma3 4B";
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
        ? `${shortModel} · Hybrid`
        : `${shortModel} · Lokal`;
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
  const aiPane = document.getElementById("ledge-pane-ai");
  const inboxOpen = inboxPanel && !inboxPanel.classList.contains("hidden");
  const hasMessages = stream && stream.children.length > 0;

  aiPane?.classList.toggle("has-chat", Boolean(hasMessages || inboxOpen));

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
    document.getElementById("more-tools-grid")?.classList.add("hidden");
    welcomeCard?.classList.remove("hidden");
    chatToolbar?.classList.add("hidden");
    stream?.classList.add("hidden");
  }
  trackHitBoxForMs(260);
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
  void rpc("resetChat").catch(() => {});
  updateWelcomeCard();
  syncWelcomeVisibility();
  document.getElementById("palette-input")?.focus();
}

function runBootWelcomeAnimation() {
  const island = document.getElementById("island");
  const idleLabel = document.getElementById("idle-label");
  if (!island || !idleLabel) return;

  // Stage 1: Appear (126px) — simple, clean pure monochrome pill with Acoustic a logo
  bootGreetingActive = true;
  island.classList.remove("boot-greeting");
  island.classList.add("boot-appear");
  idleLabel.textContent = "aiku";

  // Stage 2: Greeting (316px) — smooth subtle expansion with friendly greeting
  setTimeout(() => {
    if (!bootGreetingActive) return;
    island.classList.remove("boot-appear");
    island.classList.add("boot-greeting");
    idleLabel.textContent = `${getTimeGreeting()} • aiku siap`;
  }, 680);

  // Stage 3: Idle Ready (220px) — smoothly settles into Idle Pill
  setTimeout(() => {
    bootGreetingActive = false;
    island.classList.remove("boot-appear", "boot-greeting");
    if (timerRemainingSec === 0) {
      if (currentMediaStatus?.active && currentMediaStatus?.status === "Playing" && currentMediaStatus?.title) {
        const t = currentMediaStatus.title;
        idleLabel.textContent = `${t.slice(0, 14)}${t.length > 14 ? "…" : ""}`;
      } else {
        idleLabel.textContent = latestStatusCache && !latestStatusCache.modelReady ? "Setup AI" : "aiku";
      }
    }
  }, 2400);
}

function recordClipboardEntry(text) {
  const clean = text.trim();
  if (!clean) return;
  const existingIdx = clipboardHistory.indexOf(clean);
  if (existingIdx !== -1) clipboardHistory.splice(existingIdx, 1);
  clipboardHistory.unshift(clean);
  if (clipboardHistory.length > 10) clipboardHistory.pop();
  ledgeHub?.recordClip(clean);
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
    ledgeHub?.updateMediaView(media);
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
        idleLabel.textContent = latestStatusCache && !latestStatusCache.modelReady ? "Setup AI" : "aiku";
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
  if (idleLabel) idleLabel.textContent = "aiku";
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

let activeOfflineAudio = null;
let activeSpeechSessionId = 0;
let autoSpeakChat = localStorage.getItem("aiku_auto_speak") === "1";
let chatThinkingEnabled = localStorage.getItem("aiku_chat_thinking") === "1";
let wakeWordEnabled = localStorage.getItem("aiku_wake_word") !== "0";
let wakeWordRecognition = null;
let wakeWordRestartTimer = null;
let wakeWordBlockedByPermission = false;
let liveSilenceCommitTimer = null;
let liveIdleTimeoutTimer = null;
let liveMicMeterCtx = null;
let liveMicMeterStream = null;
let liveMicMeterRaf = null;
let voiceSetupPollTimer = null;
let voiceRecorder = null;
let voiceRecordStream = null;
let voiceRecordChunks = [];
let voiceRecordCountdownTimer = null;
let voiceRecordSecLeft = 0;

function stopActiveSpeech() {
  activeSpeechSessionId += 1;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (activeOfflineAudio) {
    try {
      activeOfflineAudio.pause();
      activeOfflineAudio.src = "";
    } catch {}
    activeOfflineAudio = null;
  }
}

function selectPreferredIndonesianVoice(preferNaturalNeural = true) {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const idVoices = voices.filter((v) => v.lang.toLowerCase().startsWith("id"));
  if (idVoices.length === 0) return null;
  if (preferNaturalNeural) {
    const natural = idVoices.find((v) => /natural|neural|gadis|ardi|online/i.test(v.name));
    if (natural) return natural;
  }
  return idVoices[0] || null;
}

function speakWithWebSpeech(clean, speed, onEnd, preferNatural = true) {
  if (!("speechSynthesis" in window)) {
    if (onEnd) onEnd();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "id-ID";
  utterance.rate = Number.isFinite(speed) ? speed : 1.05;
  const chosenVoice = selectPreferredIndonesianVoice(preferNatural);
  if (chosenVoice) utterance.voice = chosenVoice;
  utterance.onend = () => {
    if (onEnd) onEnd();
  };
  utterance.onerror = () => {
    if (onEnd) onEnd();
  };
  window.speechSynthesis.speak(utterance);
}

function toPlayableAudioDataUri(payload) {
  if (!payload) return "";
  if (payload.startsWith("data:audio/")) return payload;
  const mime = payload.startsWith("UklGR") ? "audio/wav" : "audio/mpeg";
  return `data:${mime};base64,${payload}`;
}

function isHumanConversationalMode(mode) {
  return (
    mode === "ava_hd" ||
    mode === "andrew_hd" ||
    mode === "gadis_hd" ||
    mode === "ardi_hd" ||
    mode === "natural"
  );
}

function isServerWavVoiceMode(mode, vStatus) {
  if (isHumanConversationalMode(mode)) return true;
  if (mode === "clone") return Boolean(vStatus?.openVoiceReady || vStatus?.piperReady);
  if (mode === "piper") return Boolean(vStatus?.piperReady);
  return false;
}

function describeVoiceModeLabel(mode) {
  switch (mode) {
    case "ava_hd":
    case "natural":
      return "Manusia HD — Ava Conversational (24kHz)";
    case "andrew_hd":
      return "Manusia HD — Andrew Conversational (24kHz)";
    case "gadis_hd":
      return "Manusia HD — Gadis Indonesia (24kHz)";
    case "ardi_hd":
      return "Manusia HD — Ardi Indonesia (24kHz)";
    case "clone":
      return "Custom Voice Clone + Intonasi Manusia";
    case "piper":
      return "Piper Offline Murni (Tanpa Internet)";
    default:
      return "Suara Sistem Windows (SAPI5)";
  }
}

function stripEmojisForSpeechClient(str) {
  return String(str || "")
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF\uFE00-\uFE0F\u200D\u20E3]/gu, " ")
    .replace(/(^|\s)(?:[:;=8][\-^']?[)DdpP(/\\|oO3*]+|<3|\^_\^|\^\^|>_<|T_T|-_-|o_O|O_o|[xX]D)(?=\s|[.,!?;:]|$)/g, "$1");
}

function splitSpeechClausesClient(rawText) {
  const cleaned = stripEmojisForSpeechClient(rawText)
    .replace(/```[\s\S]*?```/g, " Berikut kodenya. ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(?:^|\n)\s*\d+[.)]\s+/g, ". ")
    .replace(/(?:^|\n)\s*[-•*]\s+/g, ", ")
    .replace(/[#>_~|]/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s*\.\s*\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const clauses = [];
  let buf = "";
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1] || " ";
    buf += ch;
    const minLen = clauses.length === 0 ? 16 : 36;
    const isSentenceEnd = (ch === "." || ch === "!" || ch === "?") && /\s/.test(next);
    const isLongSemi = (ch === ";" || ch === ":") && /\s/.test(next) && buf.trim().length >= 110;
    if ((isSentenceEnd && buf.trim().length >= minLen) || isLongSemi) {
      clauses.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) {
    if (clauses.length > 0 && buf.trim().length < 12) {
      clauses[clauses.length - 1] = `${clauses[clauses.length - 1]} ${buf.trim()}`;
    } else {
      clauses.push(buf.trim());
    }
  }
  return clauses;
}

/**
 * Sesi pemutar audio streaming real-time (tanpa jeda antar kalimat / gapless queue).
 * Mendukung mode Server 24kHz HD WAV Chunks (Manusia HD / Voice Clone / Piper) maupun WebSpeech per-kalimat utuh!
 */
function createRealtimeVoiceSession(onAllDone = null) {
  stopActiveSpeech();
  const sessionId = activeSpeechSessionId;
  const vStatus = latestStatusCache?.voiceStatus;
  const mode = vStatus?.ttsMode || "ava_hd";
  const speed = Number(vStatus?.speed || 1.03);
  const useOfflineWav = isServerWavVoiceMode(mode, vStatus);

  const wavQueue = [];
  let playingWav = false;
  let streamFinished = false;
  let pendingWebUtterances = 0;
  let textBuf = "";
  let inCodeFence = false;
  let emittedClauses = 0;

  const checkDone = () => {
    if (sessionId !== activeSpeechSessionId) return;
    if (useOfflineWav) {
      if (streamFinished && !playingWav && wavQueue.length === 0) {
        if (onAllDone) onAllDone();
      }
    } else if (streamFinished && pendingWebUtterances <= 0) {
      if (onAllDone) onAllDone();
    }
  };

  const pumpNextWav = () => {
    if (sessionId !== activeSpeechSessionId) return;
    if (playingWav || wavQueue.length === 0) {
      checkDone();
      return;
    }
    playingWav = true;
    const nextB64 = wavQueue.shift();
    const audio = new Audio(toPlayableAudioDataUri(nextB64));
    activeOfflineAudio = audio;
    const finishOne = () => {
      if (activeOfflineAudio === audio) activeOfflineAudio = null;
      playingWav = false;
      pumpNextWav();
    };
    audio.onended = finishOne;
    audio.onerror = finishOne;
    void audio.play().catch(finishOne);
  };

  const enqueueWebClause = (clauseText) => {
    const clean = stripEmojisForSpeechClient(clauseText)
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s+([.,!?;:])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean || !("speechSynthesis" in window) || sessionId !== activeSpeechSessionId) return;
    pendingWebUtterances += 1;
    const utt = new SpeechSynthesisUtterance(clean);
    utt.lang = "id-ID";
    utt.rate = speed;
    const voice = selectPreferredIndonesianVoice(mode !== "system");
    if (voice) utt.voice = voice;
    const doneUtt = () => {
      pendingWebUtterances = Math.max(0, pendingWebUtterances - 1);
      checkDone();
    };
    utt.onend = doneUtt;
    utt.onerror = doneUtt;
    window.speechSynthesis.speak(utt);
  };

  return {
    useOfflineWav,
    pushAudioBase64(wavBase64) {
      if (sessionId !== activeSpeechSessionId || !wavBase64) return;
      wavQueue.push(wavBase64);
      pumpNextWav();
    },
    pushTextToken(chunk) {
      if (useOfflineWav || sessionId !== activeSpeechSessionId) return;
      textBuf += chunk;
      while (textBuf.includes("```")) {
        const idx = textBuf.indexOf("```");
        if (!inCodeFence) {
          const pre = textBuf.slice(0, idx).trim();
          if (pre.length >= 3) enqueueWebClause(pre);
          textBuf = textBuf.slice(idx + 3);
          inCodeFence = true;
        } else {
          textBuf = textBuf.slice(idx + 3);
          inCodeFence = false;
        }
      }
      if (inCodeFence) return;

      const minHard = emittedClauses === 0 ? 16 : 36;
      let cut = -1;
      for (let i = 0; i < textBuf.length - 1; i++) {
        const c = textBuf[i];
        const nx = textBuf[i + 1];
        if (c === "\n" && i >= minHard) {
          cut = i + 1;
          break;
        }
        if ((c === "." || c === "!" || c === "?") && /\s/.test(nx) && i >= minHard) {
          cut = i + 1;
          break;
        }
        if ((c === ";" || c === ":") && /\s/.test(nx) && i >= 110) {
          cut = i + 1;
          break;
        }
      }
      if (cut > 0) {
        const part = textBuf.slice(0, cut);
        textBuf = textBuf.slice(cut);
        emittedClauses += 1;
        enqueueWebClause(part);
      }
    },
    finishStream() {
      if (sessionId !== activeSpeechSessionId) return;
      if (!useOfflineWav && !inCodeFence && textBuf.trim().length > 0) {
        enqueueWebClause(textBuf.trim());
        textBuf = "";
      }
      streamFinished = true;
      checkDone();
    },
  };
}

function speakText(text, onEnd, overrideOptions = null) {
  stopActiveSpeech();
  const sessionId = activeSpeechSessionId;
  const clauses = splitSpeechClausesClient(text);
  if (clauses.length === 0) {
    if (onEnd) onEnd();
    return;
  }

  const vStatus = latestStatusCache?.voiceStatus;
  const mode = overrideOptions?.mode || vStatus?.ttsMode || "ava_hd";
  const speed = Number(overrideOptions?.speed || vStatus?.speed || 1.03);
  const profileId = overrideOptions?.profileId ?? vStatus?.activeProfileId ?? undefined;

  if (isServerWavVoiceMode(mode, vStatus)) {
    // Sintesis kalimat pertama langsung putar (~250ms), sambil kalimat berikutnya di-prefetch paralel di latar belakang!
    const audioQueue = [];
    let playing = false;
    let synthDone = false;

    const tryPlayNext = () => {
      if (sessionId !== activeSpeechSessionId) return;
      if (playing) return;
      if (audioQueue.length === 0) {
        if (synthDone && onEnd) onEnd();
        return;
      }
      playing = true;
      const b64 = audioQueue.shift();
      const audio = new Audio(toPlayableAudioDataUri(b64));
      activeOfflineAudio = audio;
      const nextStep = () => {
        if (activeOfflineAudio === audio) activeOfflineAudio = null;
        playing = false;
        tryPlayNext();
      };
      audio.onended = nextStep;
      audio.onerror = nextStep;
      void audio.play().catch(nextStep);
    };

    void (async () => {
      try {
        for (const clause of clauses) {
          if (sessionId !== activeSpeechSessionId) return;
          const res = await rpc("synthesizeSpeech", {
            text: clause,
            mode,
            speed,
            ...(profileId ? { profileId } : {}),
          });
          if (sessionId !== activeSpeechSessionId) return;
          if (res?.wavBase64) {
            audioQueue.push(res.wavBase64);
            tryPlayNext();
          }
        }
        synthDone = true;
        tryPlayNext();
      } catch {
        if (sessionId === activeSpeechSessionId) {
          speakWithWebSpeech(clauses.join(" "), speed, onEnd, true);
        }
      }
    })();
    return;
  }

  speakWithWebSpeech(clauses.join(" "), speed, onEnd, mode !== "system");
}

function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

async function decodeBlobOrArrayBufferToWavBase64(arrayBuffer) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return uint8ArrayToBase64(new Uint8Array(arrayBuffer));
  }

  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channels = decoded.numberOfChannels;
    const srcLen = decoded.length;
    const srcRate = decoded.sampleRate;
    const mono = new Float32Array(srcLen);

    for (let ch = 0; ch < channels; ch++) {
      const chData = decoded.getChannelData(ch);
      for (let i = 0; i < srcLen; i++) {
        mono[i] += chData[i] / channels;
      }
    }

    const targetRate = 22050;
    const ratio = srcRate / targetRate;
    // Ambil maksimal 20 detik pertama agar payload RPC ringan (~1.1 MB) & ekstraksi instan
    const outLen = Math.min(targetRate * 20, Math.max(1, Math.round(srcLen / ratio)));
    const resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = mono[Math.min(srcLen - 1, idx)] || 0;
      const s1 = mono[Math.min(srcLen - 1, idx + 1)] || 0;
      resampled[i] = s0 + (s1 - s0) * frac;
    }

    const wavBytes = new ArrayBuffer(44 + outLen * 2);
    const view = new DataView(wavBytes);
    const writeAscii = (off, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };

    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + outLen * 2, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, "data");
    view.setUint32(40, outLen * 2, true);

    for (let i = 0; i < outLen; i++) {
      const clamped = Math.max(-1, Math.min(1, resampled[i]));
      const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      view.setInt16(44 + i * 2, int16, true);
    }

    return uint8ArrayToBase64(new Uint8Array(wavBytes));
  } finally {
    void ctx.close().catch(() => {});
  }
}

function populateVoiceStudio(vStatus) {
  if (!vStatus) return;
  const dot = document.getElementById("voice-engine-dot");
  const sub = document.getElementById("voice-engine-sub");
  const setupBtn = document.getElementById("btn-voice-setup");
  const modeSel = document.getElementById("voice-tts-mode");
  const profSel = document.getElementById("voice-profile-select");
  const delBtn = document.getElementById("btn-voice-del-profile");
  const speedSel = document.getElementById("voice-speed");
  const foot = document.getElementById("voice-status-footnote");

  if (dot) {
    dot.className = vStatus.fullyReady ? "status-dot dot-emerald" : "status-dot dot-muted";
  }
  if (sub) {
    if (vStatus.fullyReady) {
      sub.textContent = `Siap 100% Offline • ${vStatus.profiles?.length || 0} profil suara tersimpan`;
    } else if (vStatus.piperReady) {
      sub.textContent = "Piper siap • OpenVoice ONNX belum lengkap";
    } else {
      sub.textContent = "Belum terpasang • ~198 MB • 100% Lokal di CPU";
    }
  }
  if (setupBtn) {
    if (vStatus.activeSetup?.status === "downloading" || vStatus.activeSetup?.status === "extracting") {
      setupBtn.disabled = true;
      setupBtn.textContent = `Unduh ${Math.round(vStatus.activeSetup.percent || 0)}%`;
      startVoiceSetupPolling();
    } else if (vStatus.fullyReady) {
      setupBtn.disabled = true;
      setupBtn.textContent = "Siap Offline";
    } else {
      setupBtn.disabled = false;
      setupBtn.textContent = "Unduh Mesin Suara";
    }
  }

  if (modeSel) {
    const normalized = vStatus.ttsMode === "natural" ? "ava_hd" : vStatus.ttsMode || "ava_hd";
    modeSel.value = normalized;
  }
  if (speedSel && vStatus.speed) {
    const spdStr = String(vStatus.speed);
    if ([...speedSel.options].some((o) => o.value === spdStr)) {
      speedSel.value = spdStr;
    } else {
      speedSel.value = "1.03";
    }
  }
  if (profSel) {
    const profiles = Array.isArray(vStatus.profiles) ? vStatus.profiles : [];
    if (profiles.length === 0) {
      profSel.innerHTML = `<option value="">Belum ada sampel suara (rekam/upload)</option>`;
      if (delBtn) delBtn.disabled = true;
    } else {
      profSel.innerHTML = profiles
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${Number(p.durationSec).toFixed(1)}s)</option>`
        )
        .join("");
      if (vStatus.activeProfileId && profiles.some((p) => p.id === vStatus.activeProfileId)) {
        profSel.value = vStatus.activeProfileId;
      }
      if (delBtn) delBtn.disabled = false;
    }
  }
  if (foot) {
    foot.textContent = `Aktif: ${describeVoiceModeLabel(vStatus.ttsMode || "ava_hd")}`;
  }
}

function startVoiceSetupPolling() {
  if (voiceSetupPollTimer) return;
  const wrap = document.getElementById("voice-dl-wrap");
  const stageEl = document.getElementById("voice-dl-stage");
  const statsEl = document.getElementById("voice-dl-stats");
  const fillEl = document.getElementById("voice-dl-fill");
  const idleLabel = document.getElementById("idle-label");
  wrap?.classList.remove("hidden");

  voiceSetupPollTimer = setInterval(async () => {
    try {
      const vStatus = await rpc("getVoiceStatus");
      if (latestStatusCache) {
        latestStatusCache.voiceStatus = vStatus;
      }
      const prog = vStatus.activeSetup;
      if (!prog) {
        clearInterval(voiceSetupPollTimer);
        voiceSetupPollTimer = null;
        wrap?.classList.add("hidden");
        populateVoiceStudio(vStatus);
        if (idleLabel && timerRemainingSec === 0) idleLabel.textContent = "aiku";
        return;
      }

      if (prog.status === "downloading" || prog.status === "extracting") {
        const mb = (prog.downloadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = prog.totalBytes ? (prog.totalBytes / (1024 * 1024)).toFixed(0) : "198";
        const pct = prog.percent ?? 0;
        if (stageEl) stageEl.textContent = prog.stage || "Mengunduh...";
        if (statsEl) statsEl.textContent = `${mb} / ${totalMb} MB (${pct.toFixed(0)}%)`;
        if (fillEl) fillEl.style.width = `${Math.max(4, pct)}%`;
        if (idleLabel && timerRemainingSec === 0) idleLabel.textContent = `Voice ${Math.round(pct)}%`;
      } else if (prog.status === "done") {
        if (fillEl) fillEl.style.width = "100%";
        if (statsEl) statsEl.textContent = "100% • Siap";
        clearInterval(voiceSetupPollTimer);
        voiceSetupPollTimer = null;
        setTimeout(() => wrap?.classList.add("hidden"), 1800);
        if (idleLabel && timerRemainingSec === 0) idleLabel.textContent = "aiku";
        populateVoiceStudio(vStatus);
        showIslandNotification(
          "Mesin Suara Offline Siap",
          "Piper ID + OpenVoice ONNX berhasil dipasang",
          "ok",
          true
        );
      } else if (prog.status === "error") {
        clearInterval(voiceSetupPollTimer);
        voiceSetupPollTimer = null;
        wrap?.classList.add("hidden");
        if (idleLabel && timerRemainingSec === 0) idleLabel.textContent = "aiku";
        populateVoiceStudio(vStatus);
        showToast(`Gagal mengunduh mesin suara: ${prog.error || "Network error"}`, "err");
      }
      trackHitBoxForMs(200);
    } catch {}
  }, 1200);
}

async function submitVoiceSampleArrayBuffer(arrayBuffer) {
  const nameInput = document.getElementById("voice-new-name");
  const recBtn = document.getElementById("btn-voice-record");
  const recLabel = document.getElementById("btn-voice-record-label");
  const upBtn = document.getElementById("btn-voice-upload");
  const profileName = nameInput?.value.trim() || "Suara Saya";

  if (recBtn) recBtn.disabled = true;
  if (upBtn) upBtn.disabled = true;
  if (recLabel) recLabel.textContent = "Mengekstrak...";

  try {
    const wavBase64 = await decodeBlobOrArrayBufferToWavBase64(arrayBuffer);
    const res = await rpc("saveVoiceSample", {
      name: profileName,
      wavBase64,
    });
    if (latestStatusCache && res.voiceStatus) {
      latestStatusCache.voiceStatus = res.voiceStatus;
    }
    populateVoiceStudio(res.voiceStatus);
    showIslandNotification(
      "Voice Clone Tersimpan",
      `${res.profile.name} (${res.profile.durationSec}s) • Aktif 100% Offline`,
      "ok",
      true
    );
  } catch (err) {
    showToast(`Gagal memproses sampel suara: ${err}`, "err");
  } finally {
    if (recBtn) {
      recBtn.disabled = false;
      recBtn.classList.remove("recording");
    }
    if (upBtn) upBtn.disabled = false;
    if (recLabel) recLabel.textContent = "Rekam 10s";
  }
}

function stopVoiceSampleRecording() {
  if (voiceRecordCountdownTimer) {
    clearInterval(voiceRecordCountdownTimer);
    voiceRecordCountdownTimer = null;
  }
  if (voiceRecorder && voiceRecorder.state !== "inactive") {
    try {
      voiceRecorder.stop();
    } catch {}
  }
}

async function toggleVoiceSampleRecording() {
  const vStatus = latestStatusCache?.voiceStatus;
  if (!vStatus?.openVoiceReady) {
    showToast("Klik 'Unduh Mesin Suara' terlebih dahulu sebelum merekam sampel clone.", "err");
    return;
  }

  if (voiceRecorder && voiceRecorder.state === "recording") {
    stopVoiceSampleRecording();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Akses mikrofon tidak didukung di lingkungan ini. Gunakan tombol Upload Audio.", "err");
    return;
  }

  const recBtn = document.getElementById("btn-voice-record");
  const recLabel = document.getElementById("btn-voice-record-label");

  try {
    voiceRecordStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    voiceRecordChunks = [];
    voiceRecorder = new MediaRecorder(voiceRecordStream);

    voiceRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        voiceRecordChunks.push(ev.data);
      }
    };

    voiceRecorder.onstop = async () => {
      if (voiceRecordStream) {
        voiceRecordStream.getTracks().forEach((t) => t.stop());
        voiceRecordStream = null;
      }
      const blob = new Blob(voiceRecordChunks, { type: voiceRecorder?.mimeType || "audio/webm" });
      voiceRecorder = null;
      if (blob.size < 1024) {
        if (recBtn) recBtn.classList.remove("recording");
        if (recLabel) recLabel.textContent = "Rekam 10s";
        showToast("Rekaman kosong atau terlalu singkat.", "err");
        return;
      }
      const buf = await blob.arrayBuffer();
      await submitVoiceSampleArrayBuffer(buf);
    };

    voiceRecordSecLeft = 10;
    recBtn?.classList.add("recording");
    if (recLabel) recLabel.textContent = `Selesai (${voiceRecordSecLeft}s)`;
    voiceRecorder.start();

    voiceRecordCountdownTimer = setInterval(() => {
      voiceRecordSecLeft -= 1;
      if (voiceRecordSecLeft <= 0) {
        stopVoiceSampleRecording();
      } else if (recLabel) {
        recLabel.textContent = `Selesai (${voiceRecordSecLeft}s)`;
      }
    }, 1000);
  } catch (err) {
    showToast(`Mikrofon ditolak atau gagal dibuka: ${err}`, "err");
  }
}

function pickBestRecognitionAlternative(result) {
  if (!result || result.length === 0) return "";
  let bestText = result[0]?.transcript || "";
  let bestScore = typeof result[0]?.confidence === "number" ? result[0].confidence : 0.5;

  // Periksa hingga 3 kandidat alternatif dari mesin STT (memilih yang paling natural & akurat untuk istilah umum)
  const techHintRe = /\b(aiku|chrome|vs\s*code|visual\s+studio|youtube|spotify|whatsapp|notepad|bitcoin|chatgpt|github|windows|powershell|folder|desktop|emas|dolar|cuaca|berita)\b/i;
  for (let a = 0; a < Math.min(3, result.length); a++) {
    const alt = result[a];
    if (!alt?.transcript) continue;
    const baseConf = typeof alt.confidence === "number" && alt.confidence > 0 ? alt.confidence : 0.5 - a * 0.05;
    const bonus = techHintRe.test(alt.transcript) ? 0.14 : 0;
    const score = baseConf + bonus;
    if (score > bestScore) {
      bestScore = score;
      bestText = alt.transcript;
    }
  }
  return bestText;
}

function pulseListeningOrbVisual(intensity = 0.65) {
  const orb = document.querySelector(".ai-orb");
  if (orb) {
    orb.classList.add("listening");
    orb.style.setProperty("--mic-level", String(Math.max(0, Math.min(1, intensity))));
  }
  const bars = Array.from(document.querySelectorAll("#active-voice-visual .waveform .bar"));
  bars.forEach((bar, idx) => {
    const phase = 0.6 + ((idx % 3) * 0.18);
    const scale = Math.max(0.35, Math.min(1.25, 0.35 + intensity * 0.95 * phase));
    bar.style.transform = `scaleY(${scale.toFixed(2)})`;
  });
}

function stopLiveMicMeter() {
  if (liveMicMeterRaf) {
    cancelAnimationFrame(liveMicMeterRaf);
    liveMicMeterRaf = null;
  }
  if (liveMicMeterStream) {
    liveMicMeterStream.getTracks().forEach((t) => t.stop());
    liveMicMeterStream = null;
  }
  if (liveMicMeterCtx) {
    void liveMicMeterCtx.close().catch(() => {});
    liveMicMeterCtx = null;
  }
  const orb = document.querySelector(".ai-orb");
  if (orb) {
    orb.classList.remove("listening");
    orb.style.setProperty("--mic-level", "0");
  }
  document.querySelectorAll("#active-voice-visual .waveform .bar").forEach((bar) => {
    bar.style.transform = "";
  });
}

function clearLiveListeningTimers() {
  if (liveSilenceCommitTimer) {
    clearTimeout(liveSilenceCommitTimer);
    liveSilenceCommitTimer = null;
  }
  if (liveIdleTimeoutTimer) {
    clearTimeout(liveIdleTimeoutTimer);
    liveIdleTimeoutTimer = null;
  }
}

function normalizeIndonesianSpokenText(raw) {
  return String(raw || "")
    .replace(/\b(?:ai\s*ku|ay\s*ku|ayku|aiko|eiku|haiku)\b/gi, "aiKu")
    .replace(/\b(?:ps\s*code|vs\s*code|visual\s+studio\s+port|visual\s+studio\s+kot)\b/gi, "VS Code")
    .replace(/\b(?:google\s+krom|google\s+crome|krom|crome)\b/gi, "Chrome")
    .replace(/\b(?:yutub|yu\s*tub)\b/gi, "YouTube")
    .replace(/\b(?:whats\s*app|watsap|wasap)\b/gi, "WhatsApp")
    .replace(/\b(?:chat\s*gpt|cet\s*gpt)\b/gi, "ChatGPT")
    .replace(/\b(?:bit\s*koin)\b/gi, "Bitcoin")
    .replace(/\s+/g, " ")
    .trim();
}

function stopLiveVoice(returnToPalette = true) {
  liveVoiceActive = false;
  clearLiveListeningTimers();
  stopLiveMicMeter();
  if (activeRecognition) {
    try {
      activeRecognition.onend = null;
      activeRecognition.onerror = null;
      activeRecognition.stop();
    } catch {}
    activeRecognition = null;
  }
  stopActiveSpeech();
  document.querySelector(".ai-orb")?.classList.remove("speaking");
  if (returnToPalette) {
    setIslandState("palette");
  }
  scheduleWakeWordRestart(750);
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

function highlightCodeMonochrome(escapedCode) {
  const tokens = [];
  const stash = (cls, text) => {
    const id = tokens.length;
    tokens.push(`<span class="${cls}">${text}</span>`);
    return `\u0001TOK_${id}\u0001`;
  };

  let out = escapedCode
    // Line comments (// ... or # ...)
    .replace(/(^|\s)(\/\/[^\n]*|#(?![0-9a-fA-F]{3,6}\b)[^\n]*)/gm, (_m, lead, cmt) => `${lead}${stash("tok-cmt", cmt)}`)
    // Block comments /* ... */
    .replace(/\/\*[\s\S]*?\*\//g, (m) => stash("tok-cmt", m))
    // Double, single, backtick strings (already HTML-escaped)
    .replace(/(&quot;(?:\\.|(?!&quot;)[^\\\n])*&quot;|&#39;(?:\\.|(?!&#39;)[^\\\n])*&#39;|`(?:\\.|[^`\\])*`)/g, (m) =>
      stash("tok-str", m)
    )
    // Common keywords
    .replace(
      /\b(const|let|var|function|return|async|await|if|else|for|while|switch|case|break|continue|class|extends|import|export|from|default|try|catch|finally|throw|new|typeof|def|elif|pass|with|as|lambda|yield|True|False|None|fn|pub|struct|enum|impl|match|mut|use|mod|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE)\b/g,
      '<span class="tok-kw">$1</span>'
    )
    // Numbers
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');

  tokens.forEach((html, idx) => {
    out = out.replace(`\u0001TOK_${idx}\u0001`, html);
  });
  return out;
}

function buildCodeBlockHtml(lang, code) {
  const cleanLang = (lang || "code").trim();
  const cleanCode = String(code).replace(/^\n/, "").replace(/\n$/, "");
  const highlighted = highlightCodeMonochrome(escapeHtml(cleanCode));
  return `<div class="ai-code-wrap"><div class="ai-code-header"><span class="ai-code-lang mono">${escapeHtml(cleanLang)}</span><button type="button" class="ai-code-copy-btn" data-copy-code="1" title="Salin kode"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Salin</span></button></div><pre class="ai-code-block mono"><code>${highlighted}</code></pre></div>`;
}

function formatInlineMarkdown(raw) {
  const inlineCodes = [];
  let s = escapeHtml(raw).replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="md-inline-code mono">${code}</code>`);
    return `\u0002IC_${idx}\u0002`;
  });

  s = s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  inlineCodes.forEach((html, idx) => {
    s = s.replace(`\u0002IC_${idx}\u0002`, html);
  });
  return s;
}

function formatSimpleMarkdown(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const codeBlocks = [];

  // 1. Extract closed fenced code blocks
  let withPlaceholders = normalized.replace(/```([a-zA-Z0-9_+-]*)[ \t]*\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(buildCodeBlockHtml(lang, code));
    return `\n\u0000CODEBLOCK_${idx}\u0000\n`;
  });

  // 2. Gracefully handle an unclosed fenced code block while streaming
  withPlaceholders = withPlaceholders.replace(/```([a-zA-Z0-9_+-]*)[ \t]*\n([\s\S]*)$/, (_m, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(buildCodeBlockHtml(lang, code));
    return `\n\u0000CODEBLOCK_${idx}\u0000\n`;
  });

  const lines = withPlaceholders.split("\n");
  const htmlParts = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Codeblock placeholder
    const cbMatch = trimmed.match(/^\u0000CODEBLOCK_(\d+)\u0000$/);
    if (cbMatch) {
      htmlParts.push(codeBlocks[Number(cbMatch[1])] || "");
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      htmlParts.push('<hr class="md-hr" />');
      i++;
      continue;
    }

    // Headings
    const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      htmlParts.push(`<div class="md-h md-h${level}">${formatInlineMarkdown(hMatch[2])}</div>`);
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      const qLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        qLines.push(formatInlineMarkdown(lines[i].trim().replace(/^>\s?/, "")));
        i++;
      }
      htmlParts.push(`<blockquote class="md-quote">${qLines.join("<br />")}</blockquote>`);
      continue;
    }

    // Markdown table (| a | b | followed by |---|---|)
    if (
      trimmed.startsWith("|") &&
      i + 1 < lines.length &&
      /^\|?[\s:-]+\|[\s|:-]+$/.test(lines[i + 1].trim())
    ) {
      const parseCells = (row) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => formatInlineMarkdown(c.trim()));
      const headers = parseCells(lines[i]);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        bodyRows.push(parseCells(lines[i]));
        i++;
      }
      const thHtml = headers.map((h) => `<th>${h}</th>`).join("");
      const tbHtml = bodyRows
        .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
        .join("");
      htmlParts.push(
        `<div class="md-table-wrap"><table class="md-table"><thead><tr>${thHtml}</tr></thead><tbody>${tbHtml}</tbody></table></div>`
      );
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInlineMarkdown(lines[i].trim().replace(/^[-*•]\s+/, ""))}</li>`);
        i++;
      }
      htmlParts.push(`<ul class="md-list">${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInlineMarkdown(lines[i].trim().replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      htmlParts.push(`<ol class="md-list md-olist">${items.join("")}</ol>`);
      continue;
    }

    // Regular paragraph (group consecutive plain text lines)
    const pLines = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (
        !cur ||
        /^\u0000CODEBLOCK_\d+\u0000$/.test(cur) ||
        /^(#{1,4})\s+/.test(cur) ||
        /^[-*•]\s+/.test(cur) ||
        /^\d+\.\s+/.test(cur) ||
        /^>\s?/.test(cur) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(cur)
      ) {
        break;
      }
      pLines.push(formatInlineMarkdown(lines[i]));
      i++;
    }
    if (pLines.length > 0) {
      htmlParts.push(`<p class="md-p">${pLines.join("<br />")}</p>`);
    }
  }

  return `<div class="md-root">${htmlParts.join("")}</div>`;
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
  const earLeft = document.querySelector(".ear-left");
  const earRight = document.querySelector(".ear-right");
  if (wrapper) {
    wrapper.classList.remove("stretching");
    wrapper.style.transform = "";
    wrapper.style.transformOrigin = "50% top";
  }
  if (island) {
    island.style.borderBottomLeftRadius = "";
    island.style.borderBottomRightRadius = "";
    island.style.boxShadow = "";
  }
  if (earLeft) earLeft.style.transform = "";
  if (earRight) earRight.style.transform = "";
}

let isIdleHovered = false;
let currentStretchDragging = false;
let hitBoxTrackUntil = 0;
let hitBoxAnimId = null;
let lastSentHitBox = "";

function pushHitBox(draggingOverride = null) {
  if (typeof invoke !== "function") return;
  const island = document.getElementById("island");
  if (!island) return;

  const rect = island.getBoundingClientRect();
  const toast = document.getElementById("island-toast");
  const hasToast = Boolean(toast && !toast.classList.contains("hidden"));
  const tRect = hasToast ? toast.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };

  // Saat elemen <select> native sedang dibuka di Settings, beri ruang ekstra ke bawah agar opsi dropdown leluasa diklik
  const selectOpen = document.activeElement?.tagName === "SELECT" && island.dataset.state === "security";
  const padX = selectOpen ? 20 : 1;
  const padBottom = selectOpen ? 220 : 1;

  const left = Math.round(rect.left - padX);
  const top = Math.round(Math.min(0, rect.top));
  const right = Math.round(rect.right + padX);
  const bottom = Math.round(rect.bottom + padBottom);
  const toastLeft = Math.round(tRect.left);
  const toastTop = Math.round(tRect.top);
  const toastRight = Math.round(tRect.right);
  const toastBottom = Math.round(tRect.bottom);
  const dragging = draggingOverride !== null ? draggingOverride : currentStretchDragging;

  const key = `${left},${top},${right},${bottom},${toastLeft},${toastTop},${toastRight},${toastBottom},${hasToast ? 1 : 0},${dragging ? 1 : 0}`;
  if (key === lastSentHitBox) return;
  lastSentHitBox = key;

  void invoke("update_hit_box", {
    left,
    top,
    right,
    bottom,
    toastLeft,
    toastTop,
    toastRight,
    toastBottom,
    hasToast,
    dragging,
  }).catch(() => {});
}

function trackHitBoxForMs(durationMs = 420) {
  if (typeof invoke !== "function") return;
  const now = performance.now();
  hitBoxTrackUntil = Math.max(hitBoxTrackUntil, now + durationMs);
  if (hitBoxAnimId !== null) return;

  const step = (ts) => {
    pushHitBox();
    if (ts < hitBoxTrackUntil) {
      hitBoxAnimId = requestAnimationFrame(step);
    } else {
      hitBoxAnimId = null;
      pushHitBox();
    }
  };
  hitBoxAnimId = requestAnimationFrame(step);
}

function setIdleHovered(hovered) {
  const island = document.getElementById("island");
  if (!island) return;
  if (hovered && island.dataset.state === "idle" && ledgeHub?.shouldOpenFullOnHover()) {
    setIslandState("palette");
    return;
  }
  const next = Boolean(hovered && island.dataset.state === "idle");
  if (isIdleHovered === next && island.classList.contains("is-hovered") === next) return;
  isIdleHovered = next;
  island.classList.toggle("is-hovered", next);
  trackHitBoxForMs(380);
}

function clearActiveNotifVisuals() {
  if (activeNotifTimer) {
    clearTimeout(activeNotifTimer);
    activeNotifTimer = null;
  }
  activeNotifMode = false;
  document.getElementById("island")?.classList.remove("is-notif");
  document.getElementById("active-notif-track")?.classList.add("hidden");
  document.getElementById("active-notif-visual")?.classList.add("hidden");
  document.getElementById("btn-active-notif-action")?.classList.add("hidden");
  document.getElementById("active-voice-visual")?.classList.remove("hidden");
}

function setIslandState(state) {
  const wrapper = document.querySelector(".notch-wrapper");
  const island = document.getElementById("island");
  resetBalloonVisuals();
  wrapper?.classList.remove("island-hidden");

  if (state !== "active" && activeNotifMode) {
    clearActiveNotifVisuals();
  }
  if (state !== "idle") {
    isIdleHovered = false;
  }

  island.className = `island state-${state}${chatStyle === "gemini" ? " chat-gemini" : ""}${
    state === "idle" && isIdleHovered ? " is-hovered" : ""
  }${state === "active" && activeNotifMode ? " is-notif" : ""}`;
  island.dataset.state = state;
  trackHitBoxForMs(420);

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
  if ((currentState === "idle" || forceFase2) && !liveVoiceActive) {
    if (activeNotifTimer) {
      clearTimeout(activeNotifTimer);
      activeNotifTimer = null;
    }
    activeNotifMode = true;

    document.getElementById("active-voice-visual")?.classList.add("hidden");
    const notifVisual = document.getElementById("active-notif-visual");
    const notifOrb = document.getElementById("active-notif-orb");
    const notifTrack = document.getElementById("active-notif-track");
    const notifBar = document.getElementById("active-notif-bar");
    const notifActionBtn = document.getElementById("btn-active-notif-action");

    notifVisual?.classList.remove("hidden");
    const isWhatsAppNotif = /whatsapp|wa\b/i.test(`${title} ${subtitle}`);
    if (notifOrb) {
      notifOrb.className = `notif-orb ${variant}`;
      notifOrb.innerHTML = isWhatsAppNotif
        ? BRAND_SHORTCUT_SVGS.OPEN_WHATSAPP
        : ALERT_SVG_ICONS[variant] || ALERT_SVG_ICONS.ok;
    }
    if (notifActionBtn) {
      notifActionBtn.textContent = isWhatsAppNotif ? "Balas" : "Buka";
      notifActionBtn.classList.remove("hidden");
      notifActionBtn.onclick = (e) => {
        e.stopPropagation();
        clearActiveNotifVisuals();
        setIslandState("palette");
        if (isWhatsAppNotif) {
          document.getElementById("btn-open-inbox")?.click();
        }
      };
    }

    document.getElementById("active-title").textContent = title;
    document.getElementById("active-subtitle").textContent =
      subtitle || `Notifikasi • Mengecil otomatis (${notifDurationSec}s)`;

    notifTrack?.classList.remove("hidden");

    // Ubah ke state-active DULU agar #view-active tampil (bukan display:none), baru mulai animasi progress bar!
    setIslandState("active");

    if (notifBar) {
      notifBar.style.transition = "none";
      notifBar.style.transform = "scaleX(1)";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!activeNotifMode) return;
          notifBar.style.transition = `transform ${durationMs}ms linear`;
          notifBar.style.transform = "scaleX(0)";
        });
      });
    }

    activeNotifTimer = setTimeout(() => {
      clearActiveNotifVisuals();
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
  trackHitBoxForMs(320);
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
    trackHitBoxForMs(150);
  }, durationMs);
}

function showToast(message, type = "ok", subtitle = "", forceFase2 = false) {
  showIslandNotification(message, subtitle, type, forceFase2);
}

let activeChunkHandler = null;
let activeAudioChunkHandler = null;

async function rpcStream(method, params = {}, onChunk = null, onAudioChunk = null) {
  if (typeof invoke === "function") {
    activeChunkHandler = onChunk;
    activeAudioChunkHandler = onAudioChunk;
    try {
      return await invoke("rpc_call", { method, params });
    } finally {
      activeChunkHandler = null;
      activeAudioChunkHandler = null;
    }
  }

  const res = await fetch("/api/rpc-stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AiKu-Token": getSessionToken(),
    },
    body: JSON.stringify({ id: rpcCounter++, method, params }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      const obj = JSON.parse(line);
      if (typeof obj.stream === "string") {
        onChunk?.(obj.stream);
      } else if (typeof obj.audio === "string") {
        onAudioChunk?.(obj.audio);
      } else if ("ok" in obj) {
        finalPayload = obj;
      }
    }
  }

  if (buffer.trim()) {
    const obj = JSON.parse(buffer.trim());
    if ("ok" in obj) finalPayload = obj;
  }

  if (!finalPayload || !finalPayload.ok) {
    throw new Error(finalPayload?.error || "Stream RPC gagal.");
  }
  return finalPayload.result;
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
    const status = await rpc("getStatus");

    latestStatusCache = status;
    currentSandboxRoot = status.primarySandbox;
    if (typeof status.notifDurationSec === "number") {
      notifDurationSec = status.notifDurationSec;
    }
    if (typeof status.hotkey === "string" && typeof invoke === "function") {
      void invoke("set_global_hotkey", { hotkey: status.hotkey }).catch(() => {});
    }
    const count = typeof status.fileCount === "number" ? status.fileCount : 0;

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
      document.getElementById("idle-label").textContent = status.modelReady ? "aiku" : "Setup AI";
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
  const earLeft = document.querySelector(".ear-left");
  const earRight = document.querySelector(".ear-right");
  if (!wrapper || !island) return;

  let dragging = false;
  let movedEnough = false;
  let startX = 0;
  let startY = 0;
  let lastDy = 0;
  let animFrameId = null;

  // State fisika membran kain karet (scale, shift, skew, 3D tilt, & intensitas lengkungan)
  let curSx = 1, curSy = 1, curTx = 0, curSkew = 0, curRotX = 0, curRotY = 0, curStretchX = 0, curStretchY = 0;
  let velSx = 0, velSy = 0, velTx = 0, velSkew = 0, velRotX = 0, velRotY = 0, velStretchX = 0, velStretchY = 0;

  function stopSpringLoop() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function applyRubberMembraneTransform() {
    wrapper.style.transformOrigin = "50% top";
    // Pure 2D transform + 2px top anchor bleed: tepi atas terkunci 100% rapat di y=0 tanpa celah 1px!
    wrapper.style.transform =
      `translateX(${curTx.toFixed(2)}px) scale(${curSx.toFixed(4)}, ${curSy.toFixed(4)}) skewX(${curSkew.toFixed(2)}deg)`;

    // Lengkungan sudut bawah elips asimetris seperti kain karet yang melar mengikuti titik tarikan
    const downPull = Math.max(0, curStretchY);
    const leftPull = Math.max(0, -curStretchX);
    const rightPull = Math.max(0, curStretchX);
    const tension = Math.min(1, Math.hypot(curStretchX, downPull));

    if (tension > 0.015) {
      const baseR = island.dataset.state === "idle" ? 16 : 24;
      const lx = Math.round(baseR + downPull * 24 + leftPull * 42 - rightPull * 6);
      const ly = Math.round(baseR + downPull * 46 + leftPull * 56 - rightPull * 4);
      const rx = Math.round(baseR + downPull * 24 + rightPull * 42 - leftPull * 6);
      const ry = Math.round(baseR + downPull * 46 + rightPull * 56 - leftPull * 4);

      island.style.borderBottomLeftRadius = `${Math.max(14, lx)}px ${Math.max(14, ly)}px`;
      island.style.borderBottomRightRadius = `${Math.max(14, rx)}px ${Math.max(14, ry)}px`;
      island.style.boxShadow = `inset 0 -1.5px 0 rgba(255, 255, 255, ${(0.1 + tension * 0.18).toFixed(3)})`;

      // Telinga lengkung notch atas ikut melar elastis seperti sambungan kain karet di tepi layar
      if (earLeft) {
        const elSx = 1 + leftPull * 0.95 + downPull * 0.25;
        const elSy = 1 + downPull * 1.25 + leftPull * 0.45;
        earLeft.style.transform = `scale(${elSx.toFixed(3)}, ${elSy.toFixed(3)})`;
      }
      if (earRight) {
        const erSx = 1 + rightPull * 0.95 + downPull * 0.25;
        const erSy = 1 + downPull * 1.25 + rightPull * 0.45;
        earRight.style.transform = `scale(${erSx.toFixed(3)}, ${erSy.toFixed(3)})`;
      }
    } else {
      island.style.borderBottomLeftRadius = "";
      island.style.borderBottomRightRadius = "";
      island.style.boxShadow = "";
      if (earLeft) earLeft.style.transform = "";
      if (earRight) earRight.style.transform = "";
    }

    pushHitBox();
  }

  function runBalloonSpringBounce() {
    stopSpringLoop();
    const stiffness = 285;
    const damping = 8.4;
    let lastTime = performance.now();

    const tick = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.032);
      lastTime = now;

      // Hukum Hooke teredam (damped harmonic oscillator) -> membal kenyal seperti kain karet!
      velSx += ((1 - curSx) * stiffness - velSx * damping) * dt;
      velSy += ((1 - curSy) * stiffness - velSy * damping) * dt;
      velTx += ((0 - curTx) * stiffness - velTx * damping) * dt;
      velSkew += ((0 - curSkew) * stiffness - velSkew * damping) * dt;
      velRotX += ((0 - curRotX) * stiffness - velRotX * damping) * dt;
      velRotY += ((0 - curRotY) * stiffness - velRotY * damping) * dt;
      velStretchX += ((0 - curStretchX) * stiffness - velStretchX * damping) * dt;
      velStretchY += ((0 - curStretchY) * stiffness - velStretchY * damping) * dt;

      curSx += velSx * dt;
      curSy += velSy * dt;
      curTx += velTx * dt;
      curSkew += velSkew * dt;
      curRotX += velRotX * dt;
      curRotY += velRotY * dt;
      curStretchX += velStretchX * dt;
      curStretchY += velStretchY * dt;

      applyRubberMembraneTransform();

      const energy =
        Math.abs(1 - curSx) + Math.abs(1 - curSy) + Math.abs(curTx) * 0.01 +
        Math.abs(curSkew) * 0.015 + Math.abs(curStretchX) * 0.08 + Math.abs(curStretchY) * 0.08 +
        Math.abs(velSx) * 0.05 + Math.abs(velSy) * 0.05;

      if (energy > 0.002) {
        animFrameId = requestAnimationFrame(tick);
      } else {
        curSx = 1; curSy = 1; curTx = 0; curSkew = 0;
        curRotX = 0; curRotY = 0; curStretchX = 0; curStretchY = 0;
        velSx = 0; velSy = 0; velTx = 0; velSkew = 0;
        velRotX = 0; velRotY = 0; velStretchX = 0; velStretchY = 0;
        resetBalloonVisuals();
        animFrameId = null;
        pushHitBox(false);
      }
    };

    animFrameId = requestAnimationFrame(tick);
  }

  let activePointerId = null;

  island.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input, select, button, textarea, canvas")) return;
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
      currentStretchDragging = true;
      if (activePointerId !== null) {
        try {
          island.setPointerCapture(activePointerId);
        } catch {}
      }
    }
    lastDy = dy;
    wrapper.classList.add("stretching");

    // Efek tarik kain karet yang sangat elastis & 100% mengikuti arah kursor
    const pullY = Math.max(-34, Math.min(200, dy));
    const pullX = Math.max(-210, Math.min(210, dx));

    const downFactor = Math.tanh(Math.max(0, pullY) / 105);
    const upFactor = Math.tanh(Math.max(0, -pullY) / 48);
    const signedX = Math.tanh(pullX / 125);
    const sideFactor = Math.abs(signedX);

    // Volume-preserving rubber fabric physics:
    // - Tarik ke bawah -> melar vertikal tinggi (hingga 1.46x) & pinggang sedikit menyempit seperti kain karet
    // - Tarik ke kanan/kiri -> condong (skewX positif) & bergeser mulus MENGIKUTI arah kursor
    curSy = 1 + downFactor * 0.46 - upFactor * 0.18 - sideFactor * 0.06;
    curSx = 1 + sideFactor * 0.24 - downFactor * 0.13 + upFactor * 0.09;
    curTx = signedX * 44;
    curSkew = signedX * 11.5;
    curRotX = downFactor * 4.5 - upFactor * 2.5;
    curRotY = signedX * 5.5;
    curStretchX = signedX;
    curStretchY = downFactor;

    applyRubberMembraneTransform();
  });

  const endStretch = () => {
    if (!dragging) return;
    dragging = false;
    currentStretchDragging = false;
    activePointerId = null;
    wrapper.classList.remove("stretching");

    if (movedEnough) {
      suppressNextClick = true;
      setTimeout(() => {
        suppressNextClick = false;
      }, 130);

      runBalloonSpringBounce();

      if (island.dataset.state === "idle" && lastDy > 56) {
        setIslandState("palette");
      } else if (island.dataset.state !== "idle" && lastDy < -26) {
        setIslandState("idle");
      }
    } else {
      pushHitBox(false);
    }
  };

  island.addEventListener("pointerup", endStretch);
  island.addEventListener("pointercancel", endStretch);
  window.addEventListener("pointerup", endStretch);
  window.addEventListener("blur", () => {
    dragging = false;
    currentStretchDragging = false;
    activePointerId = null;
    stopSpringLoop();
    curSx = 1; curSy = 1; curTx = 0; curSkew = 0;
    curRotX = 0; curRotY = 0; curStretchX = 0; curStretchY = 0;
    velSx = 0; velSy = 0; velTx = 0; velSkew = 0;
    velRotX = 0; velRotY = 0; velStretchX = 0; velStretchY = 0;
    resetBalloonVisuals();
    pushHitBox(false);
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
    row.innerHTML = AIKU_ACOUSTIC_LOGO_SVG;
    bodyEl = document.createElement("div");
    bodyEl.className = "gemini-ai-content";
    row.appendChild(bodyEl);
    div.appendChild(row);
  } else {
    bodyEl = document.createElement("div");
    div.appendChild(bodyEl);
  }

  const formatFileSizeBytes = (b) => {
    const num = Number(b) || 0;
    if (num <= 0) return "Cloud";
    if (num >= 1024 * 1024 * 1024) return `${(num / 1024 ** 3).toFixed(2)} GB`;
    if (num >= 1024 * 1024) return `${(num / 1024 ** 2).toFixed(1)} MB`;
    if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${num} B`;
  };

  const attachExtras = () => {
    if (files && files.length > 0) {
      const list = document.createElement("div");
      list.className = "mini-file-list";
      list.innerHTML = files
        .map(
          (f) => `
            <div class="mini-file-row mono">
              <span class="truncate">${escapeHtml(f.relativePath)}</span>
              <span class="text-muted">${formatFileSizeBytes(f.sizeBytes)}</span>
            </div>
          `
        )
        .join("");
      div.appendChild(list);
    }
    if (role === "assistant" && text.length > 12) {
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

function populateSettingsForm(status) {
  if (!status) return;
  draftAllowedDirs = [...(status.allowedDirectories || [])];
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

  document.getElementById("settings-categories").value = (status.categories || []).join(", ");
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
  document.getElementById("settings-days").value = String(status.oldInstallerDays ?? 30);
  const notifDurInput = document.getElementById("settings-notif-duration");
  if (notifDurInput) {
    notifDurInput.value = String(status.notifDurationSec ?? notifDurationSec);
  }
  const autoStartChk = document.getElementById("chk-autostart");
  if (autoStartChk) {
    autoStartChk.checked = Boolean(status.autoStartOnBoot);
  }
  document.getElementById("settings-threads").value = String(status.threads ?? 4);
  if (status.voiceStatus) {
    populateVoiceStudio(status.voiceStatus);
  }
  if (Array.isArray(status.skills)) {
    renderSkillsList(status.skills);
  }
}

function renderSkillsList(skills) {
  const list = document.getElementById("skills-list");
  if (!list) return;
  list.innerHTML = "";
  if (!Array.isArray(skills) || skills.length === 0) {
    list.innerHTML = `<div class="skill-row"><span class="skill-desc">Belum ada skill terpasang. Klik + Upload SKILL.md untuk menambahkan.</span></div>`;
    return;
  }

  skills.forEach((sk) => {
    const row = document.createElement("div");
    row.className = "skill-row";
    const badges = [
      `<span class="skill-pill mono">/${escapeHtml(sk.id)}</span>`,
      sk.useWebSearch ? `<span class="skill-pill mono">Web</span>` : "",
      sk.alwaysActive ? `<span class="skill-pill mono">Selalu Aktif</span>` : "",
    ]
      .filter(Boolean)
      .join("");

    row.innerHTML = `
      <div class="skill-row-left">
        <input type="checkbox" class="skill-toggle" ${sk.enabled ? "checked" : ""} title="Aktifkan / Nonaktifkan skill" />
        <div class="skill-meta">
          <div class="skill-title-line">
            <span class="skill-name">${escapeHtml(sk.name)}</span>
            ${badges}
          </div>
          <div class="skill-desc">${escapeHtml(sk.description || "")}</div>
        </div>
      </div>
      ${
        sk.builtIn
          ? `<span class="skill-pill mono">Bawaan</span>`
          : `<button type="button" class="icon-btn-tiny skill-del-btn" title="Hapus skill">
              <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
            </button>`
      }
    `;

    row.querySelector(".skill-toggle")?.addEventListener("change", async (e) => {
      const enabled = Boolean(e.target.checked);
      try {
        const res = await rpc("toggleSkill", { id: sk.id, enabled });
        renderSkillsList(res.skills);
        showToast(`Skill ${sk.name} ${enabled ? "diaktifkan" : "dinonaktifkan"}.`, "ok");
      } catch (err) {
        showToast(`Gagal mengubah skill: ${err}`, "err");
      }
    });

    row.querySelector(".skill-del-btn")?.addEventListener("click", async () => {
      try {
        const res = await rpc("deleteSkill", { id: sk.id });
        renderSkillsList(res.skills);
        showToast(`Skill ${sk.name} dihapus.`, "ok");
      } catch (err) {
        showToast(`Gagal menghapus skill: ${err}`, "err");
      }
    });

    list.appendChild(row);
  });
}

async function loadSecurityHistory() {
  const list = document.getElementById("history-list");
  if (!list) return;
  list.innerHTML = `<div class="op-row"><span class="op-paths mono text-muted">Memuat riwayat aksi...</span></div>`;

  try {
    const hist = await rpc("getHistory");
    list.innerHTML = "";
    const records = hist.records ?? [];
    if (records.length === 0) {
      list.innerHTML = `<div class="op-row"><span class="op-paths mono text-muted">Belum ada riwayat perubahan file.</span></div>`;
      return;
    }

    for (const rec of records.slice(0, 10)) {
      const row = document.createElement("div");
      row.className = "op-row";
      row.innerHTML = `
        <div class="op-paths mono">
          <span>${escapeHtml(toRelative(rec.destination, currentSandboxRoot))}</span>
          <span class="text-muted"> ↩ ${escapeHtml(toRelative(rec.source, currentSandboxRoot))}</span>
        </div>
        <div class="header-right-group">
          <span class="op-badge mono sha">Tercatat</span>
          ${
            rec.rolledBackAt
              ? `<span class="op-badge mono rename">Dikembalikan</span>`
              : `<button type="button" class="pill-btn-muted mono btn-rb" data-tx-id="${escapeHtml(rec.transactionId)}">Kembalikan</button>`
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
            showToast("Berhasil! File dikembalikan ke posisi semula.", "ok");
            void refreshStatus();
            await loadSecurityHistory();
          } catch (err) {
            showToast(`Pengembalian dibatalkan: ${err}`, "err");
            rbBtn.disabled = false;
            rbBtn.textContent = "Kembalikan";
          }
        });
      }
      list.appendChild(row);
    }
  } catch (err) {
    list.innerHTML = `<div class="op-row"><span class="op-paths mono text-muted">Gagal memuat riwayat: ${escapeHtml(String(err))}</span></div>`;
  }
}

function switchSecurityTab(tab) {
  document.getElementById("seg-sandbox")?.classList.toggle("active", tab === "sandbox");
  document.getElementById("seg-voice")?.classList.toggle("active", tab === "voice");
  document.getElementById("seg-shortcuts")?.classList.toggle("active", tab === "shortcuts");
  document.getElementById("seg-history")?.classList.toggle("active", tab === "history");
  document.getElementById("settings-form")?.classList.toggle("active", tab === "sandbox");
  document.getElementById("voice-panel")?.classList.toggle("active", tab === "voice");
  document.getElementById("shortcuts-panel")?.classList.toggle("active", tab === "shortcuts");
  document.getElementById("history-panel")?.classList.toggle("active", tab === "history");
  if (tab === "voice") {
    if (latestStatusCache?.voiceStatus) {
      populateVoiceStudio(latestStatusCache.voiceStatus);
    }
    void rpc("getVoiceStatus")
      .then((vs) => {
        if (latestStatusCache) latestStatusCache.voiceStatus = vs;
        populateVoiceStudio(vs);
      })
      .catch(() => {});
  } else if (tab === "shortcuts") {
    renderHoverShortcuts();
    syncShortcutBuilderFields();
  } else if (tab === "history") {
    void loadSecurityHistory();
  }
  trackHitBoxForMs(250);
}

async function openSecurityDrawer(initialTab = "sandbox") {
  // INSTANT 0ms OPEN: langsung tampilkan form dari cache memori tanpa menunggu RPC!
  if (latestStatusCache) {
    populateSettingsForm(latestStatusCache);
  }
  switchSecurityTab(initialTab);
  setIslandState("security");

  // Sinkronkan status terbaru secara non-blocking di latar belakang
  try {
    const status = await rpc("getStatus");
    latestStatusCache = status;
    // Hanya timpa form jika user masih di halaman security & belum mulai mengedit input
    if (
      document.getElementById("island")?.dataset.state === "security" &&
      !["INPUT", "SELECT"].includes(document.activeElement?.tagName || "")
    ) {
      populateSettingsForm(status);
    }
  } catch (err) {
    if (!latestStatusCache) {
      showToast(`Gagal memuat pengaturan: ${err}`, "err");
    }
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

function appendCommandApprovalCard(cmdData) {
  const stream = document.getElementById("palette-chat-stream");
  if (!stream || !cmdData?.cmdId) return;
  stream.classList.remove("hidden");

  const card = document.createElement("div");
  card.className = "security-alert-card";

  card.innerHTML = `
    <div class="security-alert-Card-top">
      <div class="security-alert-head">
        <div class="security-alert-icon">${ALERT_SVG_ICONS.info}</div>
        <div class="security-alert-title">Konfirmasi Eksekusi Perintah Sistem</div>
      </div>
      <span class="security-alert-badge mono">POWERSHELL AGENT</span>
    </div>
    <div class="security-alert-desc">Tinjau perintah berikut sebelum dijalankan di direktori <code class="mono">${escapeHtml(cmdData.cwd || ".")}</code>:</div>
    <div class="security-diff-box mono">${escapeHtml(cmdData.command || "")}</div>
  `;

  const outputWrap = document.createElement("div");
  outputWrap.className = "cmd-output-box mono hidden";
  card.appendChild(outputWrap);

  const actions = document.createElement("div");
  actions.className = "security-alert-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-sec-cancel mono";
  cancelBtn.textContent = "Batalkan";

  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "btn-sec-approve mono";
  approveBtn.textContent = "Setujui & Jalankan";

  cancelBtn.addEventListener("click", () => {
    approveBtn.disabled = true;
    cancelBtn.disabled = true;
    cancelBtn.textContent = "Dibatalkan";
    showIslandNotification("Perintah Dibatalkan", cmdData.command, "warn");
  });

  approveBtn.addEventListener("click", async () => {
    approveBtn.disabled = true;
    cancelBtn.disabled = true;
    approveBtn.textContent = "Menjalankan...";
    try {
      const res = await rpc("executeApprovedCommand", {
        cmdId: cmdData.cmdId,
        confirmToken: "USER_APPROVED_CMD",
      });
      approveBtn.textContent = `Selesai (${res.durationMs}ms)`;
      outputWrap.textContent = res.output || "(Selesai tanpa output)";
      outputWrap.classList.remove("hidden");
      chatHistory.push({
        role: "assistant",
        content: `[Hasil eksekusi perintah "${res.command}" (exit ${res.exitCode}):\n${res.output}]`.slice(0, 3800),
      });
      stream.scrollTop = stream.scrollHeight;
      trackHitBoxForMs(250);
    } catch (err) {
      approveBtn.textContent = "Gagal";
      outputWrap.textContent = String(err);
      outputWrap.classList.remove("hidden");
      showIslandNotification("Eksekusi Perintah Gagal", String(err), "err");
    }
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(approveBtn);
  card.appendChild(actions);

  stream.appendChild(card);
  syncWelcomeVisibility();
  stream.scrollTop = stream.scrollHeight;
}

function attachAssistantActions(div, text, stream) {
  if (!text || text.length <= 12) return;
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
  if (stream) stream.scrollTop = stream.scrollHeight;
}

function splitStreamedThinkAndAnswer(raw) {
  const startIdx = raw.indexOf("<think>");
  if (startIdx === -1) {
    return { hasThink: false, inThink: false, thought: "", answer: raw };
  }
  const afterStart = raw.slice(startIdx + 7);
  const endIdx = afterStart.indexOf("</think>");
  if (endIdx === -1) {
    return {
      hasThink: true,
      inThink: true,
      thought: afterStart.trimStart(),
      answer: raw.slice(0, startIdx).trim(),
    };
  }
  const thought = afterStart.slice(0, endIdx).trim();
  const answer = `${raw.slice(0, startIdx)}${afterStart.slice(endIdx + 8)}`.trimStart();
  return { hasThink: true, inThink: false, thought, answer };
}

function createThoughtDetailsElement() {
  const details = document.createElement("details");
  details.className = "ai-thought-box";
  details.innerHTML = `<summary class="ai-thought-summary"><span class="ai-thought-label">Thinking...</span><svg class="ai-thought-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg></summary><div class="ai-thought-body"></div>`;
  return details;
}

async function handleChatPrompt(rawMessage) {
  const message = rawMessage.trim();
  if (!message) return;

  const enableAiForFiles = document.getElementById("chk-ai-docs")?.checked ?? false;
  chatHistory.push({ role: "user", content: message });
  appendPaletteMessage("user", message);

  const stream = document.getElementById("palette-chat-stream");
  const thinkingEl = appendThinkingBubble();
  let streamedText = "";
  let liveBodyEl = null;
  let thoughtBoxEl = null;
  let answerBodyEl = null;
  let thinkStartMs = null;
  let thinkEndMs = null;
  let thinkTickTimer = null;
  let userToggledThought = false;
  let lastGraphSyncMs = 0;

  const stopThinkTicker = () => {
    if (thinkTickTimer) {
      clearInterval(thinkTickTimer);
      thinkTickTimer = null;
    }
  };

  const voiceSession = autoSpeakChat ? createRealtimeVoiceSession() : null;

  const ensureLiveContainers = () => {
    if (liveBodyEl) return;
    thinkingEl.innerHTML = "";
    if (chatStyle === "gemini") {
      const row = document.createElement("div");
      row.className = "gemini-ai-row";
      row.innerHTML = AIKU_ACOUSTIC_LOGO_SVG;
      liveBodyEl = document.createElement("div");
      liveBodyEl.className = "gemini-ai-content";
      row.appendChild(liveBodyEl);
      thinkingEl.appendChild(row);
    } else {
      liveBodyEl = document.createElement("div");
      thinkingEl.appendChild(liveBodyEl);
    }
    answerBodyEl = document.createElement("div");
    liveBodyEl.appendChild(answerBodyEl);
  };

  const onTokenChunk = (chunk) => {
    ensureLiveContainers();
    streamedText += chunk;
    const parsed = splitStreamedThinkAndAnswer(streamedText);

    if (parsed.hasThink) {
      if (!thoughtBoxEl) {
        thoughtBoxEl = createThoughtDetailsElement();
        thoughtBoxEl.open = true; // Otomatis terbuka saat sedang berpikir (seperti screenshot)
        thoughtBoxEl.querySelector(".ai-thought-summary")?.addEventListener("click", () => {
          userToggledThought = true;
        });
        liveBodyEl.insertBefore(thoughtBoxEl, answerBodyEl);
        thinkStartMs = Date.now();
        thinkTickTimer = setInterval(() => {
          if (!thoughtBoxEl || !thoughtBoxEl.classList.contains("is-thinking")) {
            stopThinkTicker();
            return;
          }
          const lEl = thoughtBoxEl.querySelector(".ai-thought-label");
          const sec = Math.max(1, Math.round((Date.now() - (thinkStartMs || Date.now())) / 1000));
          if (lEl) lEl.textContent = `Thinking for ${sec}s`;
        }, 1000);
      }
      const labelEl = thoughtBoxEl.querySelector(".ai-thought-label");
      const bodyEl = thoughtBoxEl.querySelector(".ai-thought-body");
      if (parsed.inThink) {
        thoughtBoxEl.classList.add("is-thinking");
        const sec = Math.max(1, Math.round((Date.now() - (thinkStartMs || Date.now())) / 1000));
        if (labelEl) labelEl.textContent = `Thinking for ${sec}s`;
      } else {
        if (!thinkEndMs) {
          thinkEndMs = Date.now();
          stopThinkTicker();
          if (!userToggledThought) {
            thoughtBoxEl.open = false; // Otomatis menutup rapi begitu mulai menjawab
          }
        }
        thoughtBoxEl.classList.remove("is-thinking");
        const sec = Math.max(1, Math.round((thinkEndMs - (thinkStartMs || thinkEndMs)) / 1000));
        if (labelEl) labelEl.textContent = `Thought for ${sec}s`;
      }
      if (bodyEl) {
        bodyEl.textContent = parsed.thought.trim().replace(/\n{3,}/g, "\n\n");
        bodyEl.scrollTop = bodyEl.scrollHeight;
      }
    }

    if (!parsed.inThink) {
      voiceSession?.pushTextToken(chunk.replace(/<\/?think>/gi, ""));
      if (answerBodyEl) {
        answerBodyEl.innerHTML = parsed.answer
          ? `${formatSimpleMarkdown(parsed.answer)}<span class="ai-caret"></span>`
          : `<span class="ai-caret"></span>`;
      }
    }
    const nowMs = Date.now();
    if (nowMs - lastGraphSyncMs >= 320) {
      lastGraphSyncMs = nowMs;
      syncLiveReasoningGraph(message, parsed.thought, parsed.answer, true);
    }
    if (stream) stream.scrollTop = stream.scrollHeight;
  };

  try {
    const res = await rpcStream(
      "chat",
      {
        message,
        history: chatHistory.slice(-8),
        enableAiForFiles,
        streamVoice: Boolean(voiceSession?.useOfflineWav),
        enableThinking: Boolean(chatThinkingEnabled && !autoSpeakChat),
      },
      onTokenChunk,
      (wavB64) => voiceSession?.pushAudioBase64(wavB64)
    );
    stopThinkTicker();
    voiceSession?.finishStream();
    if (autoSpeakChat && !streamedText.trim() && res.reply) {
      speakText(res.reply);
    }

    let historyContent = res.reply;
    if (res.attachment?.type === "files" && Array.isArray(res.attachment.files) && res.attachment.files.length > 0) {
      const topNames = res.attachment.files
        .slice(0, 8)
        .map((f) => f.relativePath)
        .join(", ");
      historyContent = `${res.reply}\n[File terlampir: ${topNames}]`.slice(0, 3800);
    }
    chatHistory.push({ role: "assistant", content: historyContent.slice(0, 3800) });

    // Jika token sudah di-stream langsung dari model lokal secara real-time, finalisasi di bubble yang sama!
    if (liveBodyEl && !res.attachment) {
      if (res.thinking) {
        if (!thoughtBoxEl) {
          thoughtBoxEl = createThoughtDetailsElement();
          liveBodyEl.insertBefore(thoughtBoxEl, answerBodyEl);
        }
        thoughtBoxEl.classList.remove("is-thinking");
        const labelEl = thoughtBoxEl.querySelector(".ai-thought-label");
        const bodyEl = thoughtBoxEl.querySelector(".ai-thought-body");
        if (labelEl) labelEl.textContent = `Thought for ${res.thinkingDurationSec || 1}s`;
        if (bodyEl) bodyEl.textContent = String(res.thinking).trim().replace(/\n{3,}/g, "\n\n");
      } else if (thoughtBoxEl) {
        thoughtBoxEl.remove();
      }
      if (answerBodyEl) {
        answerBodyEl.innerHTML = formatSimpleMarkdown(res.reply);
      }
      syncLiveReasoningGraph(message, res.thinking || "", res.reply || "", false);
      thinkingEl.classList.remove("typing");
      attachAssistantActions(thinkingEl, res.reply, stream);
      return;
    }

    thinkingEl.remove();

    if (res.attachment?.type === "plan" && res.attachment.plan) {
      appendPaletteMessage("assistant", res.reply);
      openInspectorWithPlan(res.attachment.plan, res.attachment.sandboxRoot);
    } else if (res.attachment?.type === "history") {
      await openSecurityDrawer("history");
    } else if (res.attachment?.type === "timer" && res.attachment.seconds) {
      startFocusTimer(res.attachment.seconds);
      appendPaletteMessage("assistant", res.reply, null, false);
    } else if (res.attachment?.type === "reminder" && res.attachment.seconds) {
      startFocusTimer(res.attachment.seconds, res.attachment.text || "Pengingat");
      appendPaletteMessage("assistant", res.reply, null, false);
    } else if (res.attachment?.type === "setting_applied") {
      appendPaletteMessage("assistant", res.reply, null, false);
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
      void refreshStatus();
      showIslandNotification(
        res.attachment.notifTitle || "Pengaturan Diperbarui",
        res.attachment.notifSub || "Diterapkan oleh Asisten AI",
        "ok"
      );
    } else if (res.attachment?.type === "sensitive_alert") {
      appendPaletteMessage("assistant", res.reply, null, false);
      appendSensitiveAlertCard(res.attachment);
    } else if (res.attachment?.type === "command_approval") {
      appendPaletteMessage("assistant", res.reply, null, false);
      appendCommandApprovalCard(res.attachment);
    } else if (res.attachment?.type === "files") {
      appendPaletteMessage("assistant", res.reply, res.attachment.files, false);
    } else {
      appendPaletteMessage("assistant", res.reply, null, false);
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
  showActiveCapsule("Mencari File Kembar...", "Memeriksa file duplikat & installer lama");
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
  showActiveCapsule("Menerapkan Perubahan...", "Menyimpan catatan riwayat aman");
  try {
    const res = await rpc("executePlan", { planId: activePlan.planId, confirmToken: "CONFIRM_EXECUTE" });
    activePlan = null;
    showToast(`Berhasil menerapkan ${res.executedCount} perubahan • Bisa dibatalkan di Riwayat Aksi`, "ok");
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

  const saveBtn = document.getElementById("btn-settings-save");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Menyimpan...";
  }

  try {
    if (typeof invoke === "function") {
      void invoke("set_global_hotkey", { hotkey: hotkeyVal }).catch(() => {});
    }
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

    // Perbarui cache lokal seketika & jalankan refresh di latar belakang (non-blocking!)
    if (latestStatusCache) {
      latestStatusCache = {
        ...latestStatusCache,
        allowedDirectories: [...draftAllowedDirs],
        categories,
        oldInstallerDays,
        notifDurationSec: nextNotifDuration,
        autoStartOnBoot,
        hotkey: hotkeyVal,
        threads,
        aiMode,
        ...(modelFileName ? { modelFileName } : {}),
        ...(rawGeminiKey ? { hasGeminiApiKey: true } : {}),
      };
    }

    showIslandNotification(
      "Pengaturan Tersimpan",
      `Hotkey: ${hotkeyVal} • Notif: ${nextNotifDuration}s`,
      "ok",
      true
    );
    void refreshStatus();
  } catch (err) {
    showToast(`Ditolak: ${err}`, "err");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Simpan Pengaturan";
    }
  }
}

function extractWakeWordCommand(transcript) {
  const clean = String(transcript || "").trim();
  if (!clean) return null;

  // Cocokkan berbagai pelafalan STT bahasa Indonesia untuk "Halo aiKu" / "Hai aiKu" / "aiKu ..."
  const greetingWakeRe =
    /\b(?:halo|hallo|hello|hai|hey|hei|oke|ok|oi)\s+(?:ai\s*ku|aiku|ay\s*ku|ayku|aiko|eiku|haiku|i\s*ku|iku)\b[,.:!\s-]*(.*)$/i;
  const m1 = clean.match(greetingWakeRe);
  if (m1) {
    return { triggered: true, command: (m1[1] || "").trim() };
  }

  const directWakeRe = /^(?:ai\s*ku|aiku|ayku|aiko|eiku)\b[,.:!\s-]*(.*)$/i;
  const m2 = clean.match(directWakeRe);
  if (m2) {
    return { triggered: true, command: (m2[1] || "").trim() };
  }

  return null;
}

function stopWakeWordListener() {
  if (wakeWordRestartTimer) {
    clearTimeout(wakeWordRestartTimer);
    wakeWordRestartTimer = null;
  }
  if (wakeWordRecognition) {
    try {
      wakeWordRecognition.onend = null;
      wakeWordRecognition.onerror = null;
      wakeWordRecognition.onresult = null;
      wakeWordRecognition.stop();
    } catch {}
    wakeWordRecognition = null;
  }
}

function scheduleWakeWordRestart(delayMs = 500) {
  if (!wakeWordEnabled || wakeWordBlockedByPermission || liveVoiceActive || voiceRecorder) return;
  if (wakeWordRestartTimer) clearTimeout(wakeWordRestartTimer);
  wakeWordRestartTimer = setTimeout(() => {
    wakeWordRestartTimer = null;
    startWakeWordListener();
  }, delayMs);
}

function startWakeWordListener() {
  if (!wakeWordEnabled || wakeWordBlockedByPermission || liveVoiceActive || voiceRecorder || wakeWordRecognition) {
    return;
  }
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return;

  try {
    const rec = new SpeechRec();
    wakeWordRecognition = rec;
    rec.lang = "id-ID";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let wakeDebounceTimer = null;
    let pendingWakeCommand = "";

    const activateFromWakeWord = (cmd) => {
      if (wakeDebounceTimer) {
        clearTimeout(wakeDebounceTimer);
        wakeDebounceTimer = null;
      }
      stopWakeWordListener();
      playSoftChime();
      liveVoiceActive = true;
      if (cmd && cmd.length >= 3) {
        void processLiveVoicePrompt(cmd);
      } else {
        listenOnceForLiveVoice('"Ya, ada apa? Aku mendengarkan..."');
      }
    };

    rec.onresult = (ev) => {
      if (liveVoiceActive || activeOfflineAudio) return;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const transcript = res?.[0]?.transcript || "";
        const matched = extractWakeWordCommand(transcript);
        if (!matched) continue;

        if (res.isFinal) {
          activateFromWakeWord(matched.command);
          return;
        }

        // Jika masih berbicara kalimat setelah "Halo aiKu...", tunggu jeda 650ms agar perintahnya utuh
        pendingWakeCommand = matched.command;
        if (wakeDebounceTimer) clearTimeout(wakeDebounceTimer);
        wakeDebounceTimer = setTimeout(() => {
          activateFromWakeWord(pendingWakeCommand);
        }, 650);
      }
    };

    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        wakeWordBlockedByPermission = true;
        stopWakeWordListener();
      }
    };

    rec.onend = () => {
      if (wakeWordRecognition === rec) {
        wakeWordRecognition = null;
      }
      if (wakeWordEnabled && !wakeWordBlockedByPermission && !liveVoiceActive && !voiceRecorder) {
        scheduleWakeWordRestart(450);
      }
    };

    rec.start();
  } catch {
    wakeWordRecognition = null;
  }
}

async function processLiveVoicePrompt(rawSpoken) {
  if (!liveVoiceActive) return;
  clearLiveListeningTimers();
  stopLiveMicMeter();

  const spoken = normalizeIndonesianSpokenText(rawSpoken);
  if (!spoken) {
    listenOnceForLiveVoice();
    return;
  }

  // Perintah suara untuk menutup sesi Live Voice hands-free kembali ke siaga "Halo aiKu"
  if (/^(?:stop|berhenti|cukup|selesai|sudah|makasih\s+aiku|terima\s+kasih\s+aiku|tidur\s+aiku)[!.]*$/i.test(spoken)) {
    stopLiveVoice(false);
    setIslandState("idle");
    return;
  }

  const modelShort = formatShortModelName(latestStatusCache?.modelFileName);
  chatHistory.push({ role: "user", content: spoken });
  appendPaletteMessage("user", spoken);
  showActiveCapsule(`"${spoken.slice(0, 44)}"`, `Live Voice • ${modelShort} berpikir...`);

  let liveTranscript = "";
  let startedSpeakingVisual = false;
  const voiceSession = createRealtimeVoiceSession(() => {
    if (liveVoiceActive) {
      // Jeda 350ms agar sisa gema speaker laptop hilang total sebelum mikrofon mendengarkan lagi
      setTimeout(() => {
        if (liveVoiceActive) listenOnceForLiveVoice();
      }, 350);
    }
  });

  const markSpeaking = () => {
    if (startedSpeakingVisual || !liveVoiceActive) return;
    startedSpeakingVisual = true;
    document.querySelector(".ai-orb")?.classList.add("speaking");
    const subEl = document.getElementById("active-subtitle");
    if (subEl) subEl.textContent = "Live Voice • aiKu berbicara (klik orb untuk menyela)";
  };

  try {
    const res = await rpcStream(
      "chat",
      {
        message: spoken,
        history: chatHistory.slice(-8),
        enableAiForFiles: document.getElementById("chk-ai-docs")?.checked ?? false,
        streamVoice: Boolean(voiceSession.useOfflineWav),
        enableThinking: false,
      },
      (chunk) => {
        if (!liveVoiceActive) return;
        liveTranscript += chunk;
        voiceSession.pushTextToken(chunk);
        if (!voiceSession.useOfflineWav && liveTranscript.length >= 16) {
          markSpeaking();
        }
        const titleEl = document.getElementById("active-title");
        if (titleEl) {
          titleEl.textContent = liveTranscript.trim().slice(-56);
        }
      },
      (wavB64) => {
        if (!liveVoiceActive) return;
        markSpeaking();
        voiceSession.pushAudioBase64(wavB64);
      }
    );

    chatHistory.push({ role: "assistant", content: res.reply.slice(0, 3800) });
    appendPaletteMessage("assistant", res.reply, res.attachment?.files ?? null, false);

    if (res.attachment?.type === "plan" && res.attachment.plan) {
      stopLiveVoice(false);
      openInspectorWithPlan(res.attachment.plan, res.attachment.sandboxRoot);
      speakText(res.reply);
      return;
    }

    if (!liveTranscript.trim() && res.reply) {
      markSpeaking();
      speakText(res.reply, () => {
        if (liveVoiceActive) listenOnceForLiveVoice();
      });
      return;
    }

    voiceSession.finishStream();
  } catch (err) {
    showToast(`Live Voice error: ${err}`, "err");
    stopLiveVoice(true);
  }
}

/**
 * Mode Mendengarkan Akurat ala Gemini Live:
 * - Eksklusif 1 jalur mikrofon (tanpa bentrok WASAPI) + maxAlternatives=3 + tunggu koreksi kalimat final (isFinal)!
 * - Smart Adaptive Silence VAD: memberi ruang tarik napas 1.1-1.45 detik, lalu memicu finalisasi STT sebelum mengirim teks.
 * - Auto-timeout tenang (14 detik sunyi -> kembali ke siaga "Halo aiKu").
 */
function listenOnceForLiveVoice(promptLabel = '"Silakan bicara..."') {
  if (!liveVoiceActive) return;
  stopWakeWordListener();
  clearLiveListeningTimers();
  stopLiveMicMeter();

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    stopLiveVoice(true);
    showToast("Mikrofon/SpeechRecognition tidak tersedia di WebView ini.", "err");
    return;
  }

  document.querySelector(".ai-orb")?.classList.remove("speaking");
  showActiveCapsule(promptLabel, "Live Voice • Mendengarkan alami...");
  pulseListeningOrbVisual(0.2);

  const recognition = new SpeechRec();
  activeRecognition = recognition;
  recognition.lang = "id-ID";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  let committed = false;
  let waitingFinalFlush = false;
  let accumulatedFinal = "";
  let latestInterim = "";

  const finalizeAndSend = () => {
    if (committed || !liveVoiceActive) return;
    const fullSpoken = normalizeIndonesianSpokenText(`${accumulatedFinal} ${latestInterim}`);
    if (!fullSpoken) return;
    committed = true;
    clearLiveListeningTimers();
    stopLiveMicMeter();
    if (activeRecognition === recognition) activeRecognition = null;
    void processLiveVoicePrompt(fullSpoken);
  };

  const requestGracefulCommit = () => {
    if (committed || waitingFinalFlush || !liveVoiceActive) return;
    clearLiveListeningTimers();
    // Jika masih ada kata interim yang belum difinalisasi oleh mesin STT, panggil stop() dulu
    // dan tunggu event onend agar koreksi kalimat final (isFinal=true) masuk lebih dulu!
    if (latestInterim) {
      waitingFinalFlush = true;
      const subEl = document.getElementById("active-subtitle");
      if (subEl) subEl.textContent = "Live Voice • Menyempurnakan teks...";
      try {
        recognition.stop();
      } catch {
        finalizeAndSend();
      }
      // Pengaman jika onend tidak datang dalam 600ms
      liveSilenceCommitTimer = setTimeout(() => {
        finalizeAndSend();
      }, 600);
      return;
    }
    try {
      recognition.onend = null;
      recognition.stop();
    } catch {}
    finalizeAndSend();
  };

  // Jika 14 detik tidak ada suara sama sekali, tutup dengan tenang ke Idle Pill & kembali siaga "Halo aiKu"
  liveIdleTimeoutTimer = setTimeout(() => {
    if (!committed && liveVoiceActive && !accumulatedFinal && !latestInterim) {
      stopLiveVoice(false);
      setIslandState("idle");
    }
  }, 14_000);

  recognition.onspeechstart = () => {
    if (liveVoiceActive) pulseListeningOrbVisual(0.82);
  };

  recognition.onspeechend = () => {
    if (liveVoiceActive) pulseListeningOrbVisual(0.25);
  };

  recognition.onresult = (e) => {
    if (committed || !liveVoiceActive) return;

    let finalPart = "";
    let interimPart = "";
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      if (!res) continue;
      if (res.isFinal) {
        finalPart += `${pickBestRecognitionAlternative(res)} `;
      } else {
        interimPart += res[0]?.transcript || "";
      }
    }

    accumulatedFinal = finalPart.trim();
    latestInterim = interimPart.trim();
    const preview = normalizeIndonesianSpokenText(`${accumulatedFinal} ${latestInterim}`);

    if (preview) {
      if (liveIdleTimeoutTimer) {
        clearTimeout(liveIdleTimeoutTimer);
        liveIdleTimeoutTimer = null;
      }
      pulseListeningOrbVisual(latestInterim ? 0.78 : 0.42);
      const titleEl = document.getElementById("active-title");
      const subEl = document.getElementById("active-subtitle");
      if (titleEl) titleEl.textContent = `"${preview.slice(-58)}"`;
      if (subEl) subEl.textContent = "Live Voice • Mendengarkan...";

      if (waitingFinalFlush) {
        return;
      }

      // Smart Adaptive Silence VAD:
      // Tunggu 1.1s jika segmen terakhir sudah isFinal, atau 1.45s jika masih interim agar tidak terpotong!
      const lastWasFinal = Boolean(e.results[e.results.length - 1]?.isFinal);
      const wordCount = preview.split(/\s+/).filter(Boolean).length;
      const silenceMs = lastWasFinal && wordCount >= 3 ? 1100 : 1450;

      if (liveSilenceCommitTimer) clearTimeout(liveSilenceCommitTimer);
      liveSilenceCommitTimer = setTimeout(() => {
        requestGracefulCommit();
      }, silenceMs);
    }
  };

  recognition.onend = () => {
    if (activeRecognition === recognition) activeRecognition = null;
    if (committed || !liveVoiceActive) return;

    const leftover = normalizeIndonesianSpokenText(`${accumulatedFinal} ${latestInterim}`);
    if (leftover) {
      finalizeAndSend();
      return;
    }
    setTimeout(() => {
      if (liveVoiceActive && !committed) listenOnceForLiveVoice(promptLabel);
    }, 300);
  };

  recognition.onerror = (ev) => {
    if (activeRecognition === recognition) activeRecognition = null;
    if (committed || !liveVoiceActive) return;
    if (ev.error === "no-speech" || ev.error === "aborted") {
      const leftover = normalizeIndonesianSpokenText(`${accumulatedFinal} ${latestInterim}`);
      if (leftover) {
        finalizeAndSend();
      } else {
        setTimeout(() => {
          if (liveVoiceActive && !committed) listenOnceForLiveVoice(promptLabel);
        }, 350);
      }
    } else if (ev.error === "network" && liveVoiceNetworkRetries < 2) {
      liveVoiceNetworkRetries += 1;
      setTimeout(() => {
        if (liveVoiceActive && !committed) listenOnceForLiveVoice(promptLabel);
      }, 650);
    } else {
      const friendlyErr =
        ev.error === "network"
          ? "Layanan Speech-to-Text butuh koneksi internet stabil (atau diblokir WebView/VPN)."
          : ev.error === "not-allowed"
            ? "Izin mikrofon ditolak — aktifkan izin mic untuk aiku di Windows Settings."
            : `Mic error: ${ev.error}`;
      showToast(friendlyErr, "err");
      stopLiveVoice(true);
    }
  };

  recognition.start();
}

let liveVoiceNetworkRetries = 0;

function startVoiceInput() {
  if (liveVoiceActive) {
    stopLiveVoice(true);
    return;
  }
  const hadWakeWord = Boolean(wakeWordRecognition);
  stopWakeWordListener();
  liveVoiceActive = true;
  liveVoiceNetworkRetries = 0;
  if (hadWakeWord) {
    // Beri jeda singkat agar WebView2 melepas sesi wake-word sebelum membuka sesi Live Voice
    setTimeout(() => {
      if (liveVoiceActive) listenOnceForLiveVoice();
    }, 180);
  } else {
    listenOnceForLiveVoice();
  }
}

let wallpaperGraphEnabled = localStorage.getItem("aiku_wallpaper_graph") === "1";

function syncLiveReasoningGraph() {
  // Data percakapan lokal otomatis masuk ke Unified AI Memory Hub (worker.ts) dan tampil di Live Wallpaper Graph.
}

function initGraphViewPanel() {
  const toggleBtn = document.getElementById("btn-palette-graph");
  if (!toggleBtn) return;

  const syncBtnVisual = (active) => {
    wallpaperGraphEnabled = Boolean(active);
    toggleBtn.classList.toggle("active", wallpaperGraphEnabled);
    toggleBtn.dataset.tip = wallpaperGraphEnabled
      ? "Knowledge Graph Widget: AKTIF (Klik untuk tutup)"
      : "Knowledge Graph Widget: NONAKTIF (Klik untuk buka widget ringan)";
  };

  const applyWallpaperState = async (enable, silent = false) => {
    try {
      if (typeof invoke === "function") {
        const res = await invoke("set_wallpaper_graph_enabled", { enabled: enable });
        syncBtnVisual(Boolean(res));
        localStorage.setItem("aiku_wallpaper_graph", res ? "1" : "0");
        if (res) {
          void rpc("syncAntigravityMemory").catch(() => {});
        }
        if (!silent) {
          showToast(
            res
              ? "Knowledge Graph Widget dibuka di pojok kanan bawah!"
              : "Knowledge Graph Widget ditutup.",
            "ok"
          );
        }
      } else {
        const resp = await fetch("/api/wallpaper-toggle", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AiKu-Token": getSessionToken(),
          },
          body: JSON.stringify({ enabled: enable }),
        });
        const data = await resp.json();
        const active = Boolean(data?.enabled);
        syncBtnVisual(active);
        localStorage.setItem("aiku_wallpaper_graph", active ? "1" : "0");
        if (active) {
          void rpc("syncAntigravityMemory").catch(() => {});
        }
        if (!silent) {
          showToast(
            active
              ? "Knowledge Graph Widget dibuka di pojok kanan bawah!"
              : "Knowledge Graph Widget ditutup.",
            "ok"
          );
        }
      }
    } catch (err) {
      showToast(`Gagal mengatur Live Wallpaper: ${err}`, "err");
    }
  };

  toggleBtn.addEventListener("click", () => {
    void applyWallpaperState(!wallpaperGraphEnabled, false);
  });

  // Pulihkan status wallpaper tersimpan saat startup
  if (typeof invoke === "function") {
    void invoke("get_wallpaper_graph_status")
      .then((running) => {
        if (running) {
          syncBtnVisual(true);
        } else if (wallpaperGraphEnabled) {
          void applyWallpaperState(true, true);
        } else {
          syncBtnVisual(false);
        }
      })
      .catch(() => syncBtnVisual(false));
  } else {
    syncBtnVisual(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Klik di luar Dynamic Island -> mengecil ke State 1 (Idle Pill), TIDAK auto-hide!
  // Tekan Ctrl 2x cepat -> Toggle Hide / Show penuh!
  if (typeof listen === "function") {
    void listen("island-blur", () => {
      setIdleHovered(false);
      const current = document.getElementById("island")?.dataset.state;
      if (current && current !== "idle" && (current !== "active" || activeNotifMode)) {
        setIslandState("idle");
      }
    });
    void listen("island-cursor-enter", () => {
      if (document.getElementById("island")?.dataset.state === "idle") {
        setIdleHovered(true);
      }
    });
    void listen("island-cursor-leave", () => {
      setIdleHovered(false);
    });
    void listen("island-toggle-hide", () => {
      setIdleHovered(false);
      hideIslandSmoothly();
    });
    void listen("island-summon", () => {
      setIslandState("palette");
    });
    void listen("ai-chat-chunk", (ev) => {
      if (typeof ev.payload === "string" && activeChunkHandler) {
        activeChunkHandler(ev.payload);
      }
    });
    void listen("ai-audio-chunk", (ev) => {
      if (typeof ev.payload === "string" && activeAudioChunkHandler) {
        activeAudioChunkHandler(ev.payload);
      }
    });
  }

  // Hover deterministik (berfungsi baik di Tauri maupun di preview browser lokal)
  const rootIslandEl = document.getElementById("island");
  rootIslandEl?.addEventListener("mouseenter", () => {
    if (rootIslandEl.dataset.state === "idle") {
      setIdleHovered(true);
    }
  });
  rootIslandEl?.addEventListener("mouseleave", () => {
    if (!currentStretchDragging) {
      setIdleHovered(false);
    }
  });

  // ResizeObserver & fokus <select> menjaga hit-box selalu presisi mengikuti ukuran nyata Dynamic Island!
  if (typeof ResizeObserver === "function" && rootIslandEl) {
    const ro = new ResizeObserver(() => {
      pushHitBox();
    });
    ro.observe(rootIslandEl);
    const toastEl = document.getElementById("island-toast");
    if (toastEl) ro.observe(toastEl);
  }
  document.addEventListener("focusin", () => pushHitBox());
  document.addEventListener("focusout", () => setTimeout(() => pushHitBox(), 60));
  document.addEventListener("change", () => setTimeout(() => pushHitBox(), 40));

  // Klik di mana pun di luar Dynamic Island (area kosong halaman, atau jendela lain / aplikasi lain) -> mengecil ke Idle Pill
  const collapseOnOutsideInteraction = () => {
    if (currentStretchDragging || liveVoiceActive) return;
    const current = document.getElementById("island")?.dataset.state;
    if (!current || current === "idle") return;
    if (current === "active" && !activeNotifMode) return;
    if (document.activeElement?.tagName === "SELECT") return;
    setIslandState("idle");
  };
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target instanceof Element && e.target.closest(".notch-wrapper, #island-toast")) return;
      collapseOnOutsideInteraction();
    },
    true
  );
  // Mode browser / jendela biasa: kehilangan fokus (klik jendela lain) juga mengecilkan kapsul
  window.addEventListener("blur", () => {
    if (typeof listen === "function") return; // Di Tauri sudah ditangani event native island-blur
    setTimeout(collapseOnOutsideInteraction, 80);
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
  document.getElementById("active-voice-visual")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!liveVoiceActive) return;
    // Tap-to-Interrupt (Barge-In ala Gemini Live): hentikan suara AI & langsung dengarkan lagi!
    stopActiveSpeech();
    document.querySelector(".ai-orb")?.classList.remove("speaking");
    listenOnceForLiveVoice('"Ya, lanjutkan..."');
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
  const thinkToggleBtn = document.getElementById("btn-palette-think");
  if (thinkToggleBtn) {
    thinkToggleBtn.classList.toggle("active", chatThinkingEnabled);
    thinkToggleBtn.addEventListener("click", () => {
      chatThinkingEnabled = !chatThinkingEnabled;
      localStorage.setItem("aiku_chat_thinking", chatThinkingEnabled ? "1" : "0");
      thinkToggleBtn.classList.toggle("active", chatThinkingEnabled);
      showToast(
        chatThinkingEnabled ? "Mode Thinking Chat: ON" : "Mode Thinking Chat: OFF",
        "info",
        chatThinkingEnabled
          ? "Berpikir mendalam aktif di Chat (tetap OFF saat Voice)"
          : "Jawaban langsung cepat tanpa jeda thinking"
      );
    });
  }
  const ttsToggleBtn = document.getElementById("btn-palette-tts");
  if (ttsToggleBtn) {
    ttsToggleBtn.classList.toggle("active", autoSpeakChat);
    ttsToggleBtn.addEventListener("click", () => {
      autoSpeakChat = !autoSpeakChat;
      localStorage.setItem("aiku_auto_speak", autoSpeakChat ? "1" : "0");
      ttsToggleBtn.classList.toggle("active", autoSpeakChat);
      if (!autoSpeakChat) stopActiveSpeech();
      showToast(
        autoSpeakChat ? "Auto-Bicara Realtime Aktif" : "Auto-Bicara Dimatikan",
        "info",
        autoSpeakChat ? "Balasan chat akan langsung disuarakan per-kalimat" : ""
      );
    });
  }
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

  // Klik area notifikasi Fase 2 -> jika dari Inbox/WA langsung buka Inbox; jika notif umum langsung tutup ke Idle
  document.getElementById("view-active")?.addEventListener("click", (e) => {
    if (e.target.closest("#btn-active-stop") || !activeNotifMode) return;
    const inboxId = lastActiveNotifInboxId;
    lastActiveNotifInboxId = null;
    clearActiveNotifVisuals();
    if (inboxId) {
      setIslandState("palette");
      openInboxPanel(inboxId);
    } else {
      setIslandState("idle");
    }
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

  // Poll ringan status Music Player (cache 0ms) & Notifikasi Windows/WhatsApp (lewati saat membuka Settings)
  void pollMediaPlayer("get");
  setInterval(() => {
    if (document.getElementById("island")?.dataset.state !== "security") {
      void pollMediaPlayer("get");
    }
  }, 8000);
  void pollIncomingWindowsNotifications();
  setInterval(() => {
    if (document.getElementById("island")?.dataset.state !== "security") {
      void pollIncomingWindowsNotifications();
    }
  }, 4500);

  document.getElementById("btn-inspector-gear").addEventListener("click", () => void openSecurityDrawer("sandbox"));
  document.getElementById("btn-inspector-undo").addEventListener("click", () => void openSecurityDrawer("history"));
  document.getElementById("btn-inspector-cancel").addEventListener("click", () => setIslandState("palette"));
  document.getElementById("btn-inspector-apply").addEventListener("click", () => void applyActivePlan());

  document.getElementById("btn-security-back").addEventListener("click", () => setIslandState("palette"));
  document.getElementById("seg-sandbox").addEventListener("click", () => switchSecurityTab("sandbox"));
  document.getElementById("seg-voice")?.addEventListener("click", () => switchSecurityTab("voice"));
  document.getElementById("seg-shortcuts")?.addEventListener("click", () => switchSecurityTab("shortcuts"));
  document.getElementById("seg-history").addEventListener("click", () => switchSecurityTab("history"));

  // Voice Clone Studio Event Handlers (100% Offline)
  document.getElementById("btn-voice-setup")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-voice-setup");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Memulai...";
    try {
      await rpc("setupVoiceEngine");
      startVoiceSetupPolling();
      showToast("Mengunduh Piper ID + OpenVoice ONNX di latar belakang...", "ok");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Unduh Mesin Suara";
      showToast(`Gagal memulai instalasi suara: ${err}`, "err");
    }
  });

  document.getElementById("btn-voice-record")?.addEventListener("click", () => {
    void toggleVoiceSampleRecording();
  });

  document.getElementById("btn-skill-upload")?.addEventListener("click", () => {
    document.getElementById("skill-file-input")?.click();
  });

  document.getElementById("skill-file-input")?.addEventListener("change", async (ev) => {
    const input = ev.target;
    const files = Array.from(input?.files ?? []);
    if (files.length === 0) return;
    try {
      let latestSkills = null;
      for (const file of files) {
        const content = await file.text();
        const res = await rpc("uploadSkill", { filename: file.name, content });
        latestSkills = res.skills;
      }
      if (latestSkills) {
        renderSkillsList(latestSkills);
      }
      showToast(
        files.length === 1
          ? `Skill "${files[0].name}" berhasil dipasang!`
          : `${files.length} file SKILL.md berhasil dipasang!`,
        "ok"
      );
    } catch (err) {
      showToast(`Gagal upload SKILL.md: ${err}`, "err");
    } finally {
      input.value = "";
    }
  });

  document.getElementById("btn-voice-upload")?.addEventListener("click", () => {
    const vStatus = latestStatusCache?.voiceStatus;
    if (!vStatus?.openVoiceReady) {
      showToast("Klik 'Unduh Mesin Suara' terlebih dahulu sebelum upload sampel clone.", "err");
      return;
    }
    document.getElementById("voice-file-input")?.click();
  });

  document.getElementById("voice-file-input")?.addEventListener("change", async (ev) => {
    const input = ev.target;
    const file = input?.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      await submitVoiceSampleArrayBuffer(buf);
    } finally {
      input.value = "";
    }
  });

  document.getElementById("btn-voice-del-profile")?.addEventListener("click", async () => {
    const profSel = document.getElementById("voice-profile-select");
    const profileId = profSel?.value;
    if (!profileId) return;
    try {
      const res = await rpc("deleteVoiceProfile", { profileId });
      if (latestStatusCache && res.voiceStatus) {
        latestStatusCache.voiceStatus = res.voiceStatus;
      }
      populateVoiceStudio(res.voiceStatus);
      showToast("Profil suara dihapus.", "ok");
    } catch (err) {
      showToast(`Gagal menghapus profil: ${err}`, "err");
    }
  });

  document.getElementById("btn-voice-test")?.addEventListener("click", () => {
    const mode = document.getElementById("voice-tts-mode")?.value || "ava_hd";
    const profileId = document.getElementById("voice-profile-select")?.value || undefined;
    const speed = Number.parseFloat(document.getElementById("voice-speed")?.value || "1.03") || 1.03;
    const testBtn = document.getElementById("btn-voice-test");
    const testLabel = document.getElementById("btn-voice-test-label");

    if (mode === "piper" && !latestStatusCache?.voiceStatus?.piperReady) {
      showToast("Mesin Piper offline belum terpasang. Klik 'Unduh Mesin Suara' atau gunakan mode Manusia HD.", "err");
      return;
    }
    if (mode === "clone") {
      if (!latestStatusCache?.voiceStatus?.openVoiceReady) {
        showToast("Mesin OpenVoice ONNX belum terpasang. Klik 'Unduh Mesin Suara' untuk memakai Voice Clone.", "err");
        return;
      }
      if (!profileId) {
        showToast("Rekam 10 detik atau upload sampel suara dulu untuk memakai Custom Voice Clone.", "err");
        return;
      }
    }

    if (testBtn) testBtn.disabled = true;
    if (testLabel) testLabel.textContent = "Mensintesis...";
    speakText(
      "Halo Iqbal, sekarang aku berbicara dengan alunan napas dan intonasi yang jauh lebih hangat seperti manusia sehari-hari. Ada yang ingin kamu kerjakan hari ini?",
      () => {
        if (testBtn) testBtn.disabled = false;
        if (testLabel) testLabel.textContent = "Tes Suara";
      },
      { mode, profileId, speed }
    );
    // Kembalikan tombol jika pemutaran berlangsung > 11 detik
    setTimeout(() => {
      if (testBtn) testBtn.disabled = false;
      if (testLabel) testLabel.textContent = "Tes Suara";
    }, 11500);
  });

  document.getElementById("btn-voice-save-cfg")?.addEventListener("click", async () => {
    const ttsMode = document.getElementById("voice-tts-mode")?.value || "ava_hd";
    const activeProfileId = document.getElementById("voice-profile-select")?.value || null;
    const voiceSpeed = Number.parseFloat(document.getElementById("voice-speed")?.value || "1.03") || 1.03;
    const saveBtn = document.getElementById("btn-voice-save-cfg");

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Menyimpan...";
    }
    try {
      await rpc("updateConfig", {
        ttsMode,
        activeProfileId,
        voiceSpeed,
      });
      if (latestStatusCache?.voiceStatus) {
        latestStatusCache.voiceStatus = {
          ...latestStatusCache.voiceStatus,
          ttsMode,
          activeProfileId,
          speed: voiceSpeed,
        };
        populateVoiceStudio(latestStatusCache.voiceStatus);
      }
      const modeLabel = describeVoiceModeLabel(ttsMode);
      showIslandNotification("Mode Suara Tersimpan", `Aktif: ${modeLabel}`, "ok", true);
      void refreshStatus();
    } catch (err) {
      showToast(`Gagal menyimpan mode suara: ${err}`, "err");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Simpan Mode Suara";
      }
    }
  });
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

  const wakeChk = document.getElementById("chk-wake-word");
  if (wakeChk) {
    wakeChk.checked = wakeWordEnabled;
    wakeChk.addEventListener("change", () => {
      wakeWordEnabled = Boolean(wakeChk.checked);
      localStorage.setItem("aiku_wake_word", wakeWordEnabled ? "1" : "0");
      if (wakeWordEnabled) {
        wakeWordBlockedByPermission = false;
        startWakeWordListener();
        showToast('Siaga suara "Halo aiKu" diaktifkan!', "ok");
      } else {
        stopWakeWordListener();
        showToast('Siaga suara "Halo aiKu" dimatikan.', "info");
      }
    });
  }

function initModernHoverTooltips() {
  const tipEl = document.createElement("div");
  tipEl.id = "aiku-tooltip";
  tipEl.className = "aiku-tooltip";
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);

  let activeTarget = null;
  let showTimer = null;

  const hideTip = () => {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    activeTarget = null;
    tipEl.classList.remove("visible");
  };

  const positionAndShow = (target, text) => {
    tipEl.textContent = text;
    tipEl.style.left = "0px";
    tipEl.style.top = "0px";
    const rect = target.getBoundingClientRect();
    const tipRect = tipEl.getBoundingClientRect();
    const pad = 8;

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(pad, Math.min(window.innerWidth - tipRect.width - pad, left));

    let top = rect.bottom + 7;
    if (top + tipRect.height + pad > window.innerHeight) {
      top = Math.max(pad, rect.top - tipRect.height - 7);
    }

    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
    tipEl.classList.add("visible");
  };

  document.addEventListener(
    "pointerover",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest("[data-tip], [title]") : null;
      if (!el || el === activeTarget) return;

      // Ubah title bawaan browser menjadi data-tip agar tooltip kuning standar tidak bertumpuk
      if (!el.hasAttribute("data-tip") && el.hasAttribute("title")) {
        const t = el.getAttribute("title") || "";
        if (t.trim()) {
          el.setAttribute("data-tip", t.trim());
          el.removeAttribute("title");
        }
      }

      const text = el.getAttribute("data-tip");
      if (!text) return;

      hideTip();
      activeTarget = el;
      showTimer = setTimeout(() => {
        if (activeTarget === el && document.contains(el)) {
          positionAndShow(el, text);
        }
      }, 140);
    },
    true
  );

  document.addEventListener(
    "pointerout",
    (e) => {
      if (!activeTarget) return;
      const related = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      if (!related || !activeTarget.contains(related)) {
        hideTip();
      }
    },
    true
  );

  document.addEventListener("pointerdown", hideTip, true);
  window.addEventListener("blur", hideTip);
}

  // Inisialisasi 5-Core-Nav + Semua Fitur App Drawer & Power Tools
  if (typeof window.initAikuLedgeHub === "function") {
    ledgeHub = window.initAikuLedgeHub({
      rpc,
      showToast,
      setIslandState,
      trackHitBox: trackHitBoxForMs,
    });
    if (typeof window.initAikuPowerTools === "function" && ledgeHub) {
      window.initAikuPowerTools({
        rpc,
        rpcStream,
        recordClip: recordClipboardEntry,
        showToast,
        switchTab: ledgeHub.switchTab,
        setIslandState,
        trackHitBox: trackHitBoxForMs,
      });
    }
  }

  // Graph View (Live AI Reasoning + Workspace File Graph — InfraNodus Style)
  initGraphViewPanel();

  // Delegated Copy button handler untuk seluruh Code Output block di chat
  document.getElementById("palette-chat-stream")?.addEventListener("click", async (e) => {
    const copyBtn = e.target?.closest?.(".ai-code-copy-btn");
    if (!copyBtn) return;
    e.stopPropagation();
    const wrap = copyBtn.closest(".ai-code-wrap");
    const codeText = wrap?.querySelector("pre code")?.textContent ?? "";
    if (!codeText) return;
    try {
      await navigator.clipboard.writeText(codeText);
      const label = copyBtn.querySelector("span");
      copyBtn.classList.add("copied");
      if (label) label.textContent = "Tersalin";
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        if (label) label.textContent = "Salin";
      }, 1600);
    } catch {
      showToast("Gagal menyalin kode ke clipboard.", "err");
    }
  });

  // Aktifkan fisika karet elastis (tarik tepian Dynamic Island!) & Tooltip Hover Modern
  initModernHoverTooltips();
  initElasticJellyPhysics();

  // Terapkan gaya chat tersimpan (default / gemini), render shortcut hover & mulai di State 1 (Idle Pill)
  localStorage.removeItem("aiku_ui_theme");
  applyChatStyle(chatStyle);
  renderHoverShortcuts();
  setIslandState("idle");
  runBootWelcomeAnimation();
  trackHitBoxForMs(3000);
  void refreshStatus();
  // Pre-warm Qwen + preload System Prompt KV-Cache sejak awal agar chat pertama langsung responsif!
  setTimeout(() => {
    void rpc("warmupModel").catch(() => {});
  }, 400);

  // Mulai siaga Wake Word "Halo aiKu" otomatis (tanpa klik tombol mic!)
  if (wakeWordEnabled) {
    setTimeout(() => startWakeWordListener(), 1200);
    // Fallback jika browser menahan mikrofon sebelum ada 1 interaksi awal di tab
    const armWakeOnGesture = () => {
      if (wakeWordEnabled && !wakeWordRecognition && !liveVoiceActive) {
        startWakeWordListener();
      }
    };
    window.addEventListener("pointerdown", armWakeOnGesture, { once: true });
    window.addEventListener("keydown", armWakeOnGesture, { once: true });
  }
});
