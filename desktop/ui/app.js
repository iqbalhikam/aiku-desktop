const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
let rpcCounter = 1;
const chatHistory = [];
let activePlan = null;
let currentSandboxRoot = "";
let draftAllowedDirs = [];
let toastTimer = null;

const ISLAND_WINDOW_SIZES = {
  idle: { width: 232, height: 50 },
  active: { width: 416, height: 96 },
  palette: { width: 516, height: 390 },
  inspector: { width: 656, height: 390 },
  security: { width: 656, height: 380 },
};

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

function resizeTauriWindow(state) {
  if (typeof invoke !== "function") return;
  const dims = ISLAND_WINDOW_SIZES[state] ?? ISLAND_WINDOW_SIZES.palette;
  void invoke("resize_island", dims);
}

function setIslandState(state) {
  const island = document.getElementById("island");
  const prevState = island.dataset.state;
  const isShrinking = state === "idle" && prevState !== "idle";

  if (!isShrinking) {
    resizeTauriWindow(state);
  }

  island.className = `island state-${state}`;
  island.dataset.state = state;

  if (isShrinking) {
    setTimeout(() => {
      if (document.getElementById("island")?.dataset.state === "idle") {
        resizeTauriWindow("idle");
      }
    }, 260);
  }

  if (state === "palette") {
    setTimeout(() => document.getElementById("palette-input")?.focus(), 80);
  }
}

function showToast(message, type = "ok") {
  const toast = document.getElementById("island-toast");
  toast.textContent = message;
  toast.className = `island-toast mono ${type}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4000);
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

    currentSandboxRoot = status.primarySandbox;
    const count = filesRes.matches?.length ?? 0;

    document.getElementById("idle-file-count").textContent = `${count} file`;
    document.getElementById("idle-label").textContent = status.modelReady ? "AI Ready" : "Setup AI";
    document.getElementById("inspector-sandbox").textContent = `Sandbox: ${status.primarySandbox}`;
  } catch (err) {
    showToast(`Status error: ${err}`, "err");
  }
}

function showActiveCapsule(title, subtitle = "Offline Local AI • Qwen 0.5B") {
  document.getElementById("active-title").textContent = title;
  document.getElementById("active-subtitle").textContent = subtitle;
  setIslandState("active");
}

function appendPaletteMessage(role, text, files = null, animate = false) {
  const stream = document.getElementById("palette-chat-stream");
  stream.classList.remove("hidden");

  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "msg-user" : "msg-ai"}`;
  const bodyEl = document.createElement("div");
  div.appendChild(bodyEl);

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
    } else if (role === "assistant" && text.length > 20) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "msg-copy-btn mono";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/\*\*([^*]+)\*\*/g, "$1"));
          copyBtn.textContent = "Copied ✓";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
        } catch {
          showToast("Gagal menyalin.", "err");
        }
      });
      div.appendChild(copyBtn);
    }
    stream.scrollTop = stream.scrollHeight;
  };

  stream.appendChild(div);

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
  const isSandbox = tab === "sandbox";
  document.getElementById("seg-sandbox").classList.toggle("active", isSandbox);
  document.getElementById("seg-history").classList.toggle("active", !isSandbox);
  document.getElementById("settings-form").classList.toggle("active", isSandbox);
  document.getElementById("history-panel").classList.toggle("active", !isSandbox);
}

async function openSecurityDrawer(initialTab = "sandbox") {
  try {
    const [status, hist] = await Promise.all([rpc("getStatus"), rpc("getHistory")]);

    draftAllowedDirs = [...status.allowedDirectories];
    renderSettingsDirs();
    document.getElementById("settings-categories").value = status.categories.join(", ");
    document.getElementById("settings-days").value = String(status.oldInstallerDays);
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

async function handleChatPrompt(rawMessage) {
  const message = rawMessage.trim();
  if (!message) return;

  const enableAiForFiles = document.getElementById("chk-ai-docs")?.checked ?? false;
  chatHistory.push({ role: "user", content: message });
  appendPaletteMessage("user", message);

  showActiveCapsule(`"${message.slice(0, 42)}${message.length > 42 ? "..." : ""}"`, "Thinking • Local Qwen 0.5B");

  try {
    const res = await rpc("chat", {
      message,
      history: chatHistory.slice(-6),
      enableAiForFiles,
    });
    chatHistory.push({ role: "assistant", content: res.reply });

    if (res.attachment?.type === "plan" && res.attachment.plan) {
      appendPaletteMessage("assistant", res.reply);
      openInspectorWithPlan(res.attachment.plan, res.attachment.sandboxRoot);
    } else if (res.attachment?.type === "history") {
      await openSecurityDrawer("history");
    } else if (res.attachment?.type === "files") {
      appendPaletteMessage("assistant", res.reply, res.attachment.files, true);
      setIslandState("palette");
    } else {
      appendPaletteMessage("assistant", res.reply, null, true);
      setIslandState("palette");
    }
  } catch (err) {
    showToast(`Error: ${err}`, "err");
    setIslandState("palette");
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
    const res = await rpc("formatClipboard", { text: clipText });
    await navigator.clipboard.writeText(res.formatted);
    appendPaletteMessage("assistant", `**Teks PDF dirapikan & disalin:**\n${res.formatted.slice(0, 350)}`, null, true);
    showToast("Teks PDF rapi & tersalin!", "ok");
    setIslandState("palette");
  } catch (err) {
    showToast(`Gagal merapikan: ${err}`, "err");
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
  const categories = document
    .getElementById("settings-categories")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const oldInstallerDays = Number.parseInt(document.getElementById("settings-days").value, 10);
  const threads = Number.parseInt(document.getElementById("settings-threads").value, 10);

  try {
    await rpc("updateConfig", {
      allowedDirectories: draftAllowedDirs,
      categories,
      oldInstallerDays,
      threads,
    });
    showToast("Pengaturan tersimpan & langsung aktif!", "ok");
    await refreshStatus();
    setIslandState("palette");
  } catch (err) {
    showToast(`Ditolak: ${err}`, "err");
  }
}

function startVoiceInput() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    setIslandState("palette");
    showToast("Voice input tidak didukung di WebView ini — ketik langsung.", "err");
    return;
  }
  const recognition = new SpeechRec();
  recognition.lang = "id-ID";
  recognition.interimResults = true;
  showActiveCapsule('"Mendengarkan..."', "Listening • Offline Voice");

  let finalText = "";
  recognition.onresult = (e) => {
    const t = Array.from(e.results)
      .map((r) => r[0].transcript)
      .join("");
    document.getElementById("active-title").textContent = `"${t}"`;
    if (e.results[0]?.isFinal) finalText = t;
  };
  recognition.onend = () => {
    if (finalText.trim()) void handleChatPrompt(finalText);
    else setIslandState("palette");
  };
  recognition.onerror = () => setIslandState("palette");
  document.getElementById("btn-active-stop").onclick = () => {
    recognition.stop();
    setIslandState("palette");
  };
  recognition.start();
}

document.addEventListener("DOMContentLoaded", () => {
  // Auto-collapse ke Idle Pill saat user klik aplikasi lain (perilaku Dynamic Island asli!)
  if (typeof listen === "function") {
    void listen("island-blur", () => {
      const current = document.getElementById("island")?.dataset.state;
      if (current && current !== "idle" && current !== "active") {
        setIslandState("idle");
      }
    });
  }

  document.getElementById("view-idle").addEventListener("click", (e) => {
    if (e.target.closest("#btn-idle-mic")) return;
    setIslandState("palette");
  });
  document.getElementById("btn-idle-mic").addEventListener("click", (e) => {
    e.stopPropagation();
    startVoiceInput();
  });
  document.getElementById("btn-active-stop").addEventListener("click", () => setIslandState("palette"));

  document.getElementById("palette-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("palette-input");
    const val = input.value;
    input.value = "";
    void handleChatPrompt(val);
  });
  document.getElementById("btn-palette-mic").addEventListener("click", startVoiceInput);
  document.getElementById("btn-open-security").addEventListener("click", () => void openSecurityDrawer("sandbox"));
  document.getElementById("btn-quit-app").addEventListener("click", () => {
    if (typeof invoke === "function") void invoke("quit_app");
    else window.close();
  });

  document.getElementById("chip-organize").addEventListener("click", () => void runQuickOrganize());
  document.getElementById("chip-clipboard").addEventListener("click", () => void runSummarizeClipboard());
  document.getElementById("chip-hygiene").addEventListener("click", () => void runQuickHygiene());
  document.getElementById("chip-format-pdf").addEventListener("click", () => void runFormatPdfClipboard());

  document.getElementById("btn-inspector-gear").addEventListener("click", () => void openSecurityDrawer("sandbox"));
  document.getElementById("btn-inspector-undo").addEventListener("click", () => void openSecurityDrawer("history"));
  document.getElementById("btn-inspector-cancel").addEventListener("click", () => setIslandState("palette"));
  document.getElementById("btn-inspector-apply").addEventListener("click", () => void applyActivePlan());

  document.getElementById("btn-security-back").addEventListener("click", () => setIslandState("palette"));
  document.getElementById("seg-sandbox").addEventListener("click", () => switchSecurityTab("sandbox"));
  document.getElementById("seg-history").addEventListener("click", () => switchSecurityTab("history"));
  document.getElementById("settings-form").addEventListener("submit", (e) => void saveSettings(e));
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

  void refreshStatus();
});
