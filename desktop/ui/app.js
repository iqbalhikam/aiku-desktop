const invoke = window.__TAURI__?.core?.invoke;
let rpcCounter = 1;
const chatHistory = [];
let activePlan = null;
let currentSandboxRoot = "";
let toastTimer = null;

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

const ISLAND_WINDOW_SIZES = {
  idle: { width: 250, height: 68 },
  active: { width: 440, height: 106 },
  palette: { width: 530, height: 450 },
  inspector: { width: 660, height: 470 },
  settings: { width: 580, height: 455 },
};
let draftAllowedDirs = [];

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
    // Tunggu animasi CSS morph mengecil selesai dulu sebelum menyusutkan jendela Tauri
    setTimeout(() => {
      if (document.getElementById("island")?.dataset.state === "idle") {
        resizeTauriWindow("idle");
      }
    }, 280);
  }

  if (state === "palette") {
    setTimeout(() => document.getElementById("palette-input")?.focus(), 90);
  }
}

function showToast(message, type = "ok") {
  const toast = document.getElementById("island-toast");
  toast.textContent = message;
  toast.className = `island-toast mono ${type}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4500);
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

    document.getElementById("idle-file-count").textContent = String(count);
    document.getElementById("chip-file-count").textContent = `${count}`;
    const sandboxPathEl = document.getElementById("palette-sandbox-path");
    if (sandboxPathEl) sandboxPathEl.textContent = `SANDBOX: ${status.primarySandbox}`;
    document.getElementById("inspector-sandbox").textContent = `TARGET SANDBOX: ${status.primarySandbox}`;

    const modelLabel = document.getElementById("palette-model-status");
    const idleLabel = document.getElementById("idle-label");
    if (status.modelReady) {
      modelLabel.textContent = "QWEN 0.5B";
      idleLabel.textContent = "AI Ready";
    } else {
      modelLabel.textContent = "NO MODEL";
      idleLabel.textContent = "Setup Model";
    }
  } catch (err) {
    showToast(`Status error: ${err}`, "err");
  }
}

function showActiveCapsule(title, subtitle = "Processing • Qwen2.5-0.5B Local") {
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

  const attachFooterExtras = () => {
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
    } else if (role === "assistant" && text.length > 24) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "msg-copy-btn mono";
      copyBtn.textContent = "Salin";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/\*\*([^*]+)\*\*/g, "$1"));
          copyBtn.textContent = "Tersalin ✓";
          setTimeout(() => (copyBtn.textContent = "Salin"), 1600);
        } catch {
          showToast("Gagal menyalin ke clipboard.", "err");
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
      const chunk = tokens.slice(idx, idx + 2).join("");
      built += chunk;
      idx += 2;
      bodyEl.innerHTML = `${formatSimpleMarkdown(built)}<span class="ai-caret"></span>`;
      stream.scrollTop = stream.scrollHeight;
      if (idx < tokens.length) {
        setTimeout(step, 26);
      } else {
        bodyEl.innerHTML = formatSimpleMarkdown(text);
        div.classList.remove("typing");
        attachFooterExtras();
      }
    };
    step();
  } else {
    bodyEl.innerHTML = role === "assistant" ? formatSimpleMarkdown(text) : escapeHtml(text);
    attachFooterExtras();
  }
}

function openInspectorWithPlan(plan, sandboxRoot, title = "Safe Dry-Run Preview") {
  activePlan = plan;
  currentSandboxRoot = sandboxRoot || currentSandboxRoot;

  document.getElementById("inspector-title").textContent = title;
  document.getElementById("inspector-sandbox").textContent = `TARGET SANDBOX: ${currentSandboxRoot}`;
  document.getElementById("inspector-count-pill").textContent = `${plan.operations.length} STAGED`;

  const applyBtn = document.getElementById("btn-inspector-apply");
  const applyLabel = document.getElementById("btn-apply-label");
  applyBtn.classList.remove("hidden");
  applyBtn.disabled = plan.operations.length === 0;
  applyLabel.textContent =
    plan.operations.length > 0
      ? `Apply ${plan.operations.length} Change${plan.operations.length > 1 ? "s" : ""}`
      : "No Changes";

  const list = document.getElementById("inspector-list");
  list.innerHTML = "";

  if (plan.operations.length === 0) {
    list.innerHTML = `<div class="op-row"><span class="op-reason mono">Sandbox sudah rapi — tidak ada operasi pemindahan yang diperlukan.</span></div>`;
  } else {
    for (const op of plan.operations) {
      const isQuarantine = op.origin === "HYGIENE_QUARANTINE";
      const badgeClass = isQuarantine ? "quarantine" : op.action === "RENAME" ? "rename" : "move";
      const badgeText = isQuarantine
        ? "SANDBOX QUARANTINE"
        : op.autoRenamed
          ? `${op.action} + SUFFIX`
          : op.action;

      const row = document.createElement("div");
      row.className = "op-row";
      row.innerHTML = `
        <div class="op-left">
          <div class="op-icon ${isQuarantine ? "quarantine" : ""}">
            <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${
                isQuarantine
                  ? '<path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'
                  : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'
              }
            </svg>
          </div>
          <div class="op-info">
            <div class="op-paths mono">
              <span class="op-src">${escapeHtml(toRelative(op.source, currentSandboxRoot))}</span>
              <span class="${isQuarantine ? "text-muted" : "text-cyan"}">→</span>
              <span class="op-dst ${isQuarantine ? "quarantine" : ""}">${escapeHtml(toRelative(op.destination, currentSandboxRoot))}</span>
            </div>
            <div class="op-reason mono">${escapeHtml(op.reason)}</div>
          </div>
        </div>
        <span class="op-badge mono ${badgeClass}">${escapeHtml(badgeText)}</span>
      `;
      list.appendChild(row);
    }
  }

  setIslandState("inspector");
}

async function openHistoryInspector() {
  showActiveCapsule('"Memuat Audit Log SHA-256..."', "Reading ./logs/history.json");
  try {
    const data = await rpc("getHistory");
    activePlan = null;

    document.getElementById("inspector-title").textContent = "SHA-256 Rollback Vault";
    document.getElementById("inspector-count-pill").textContent = `${data.records.length} LOGGED`;
    document.getElementById("btn-inspector-apply").classList.add("hidden");

    const list = document.getElementById("inspector-list");
    list.innerHTML = "";

    if (!data.records || data.records.length === 0) {
      list.innerHTML = `<div class="op-row"><span class="op-reason mono">Belum ada riwayat transaksi di ./logs/history.json.</span></div>`;
    } else {
      for (const rec of data.records.slice(0, 12)) {
        const row = document.createElement("div");
        row.className = "op-row";
        row.innerHTML = `
          <div class="op-left">
            <div class="op-info">
              <div class="op-paths mono">
                <span class="op-dst">${escapeHtml(toRelative(rec.destination, currentSandboxRoot))}</span>
                <span class="text-cyan">↩</span>
                <span class="op-src">${escapeHtml(toRelative(rec.source, currentSandboxRoot))}</span>
              </div>
              <div class="op-reason mono">SHA-256: ${escapeHtml(rec.sha256.slice(0, 20))}... • ${escapeHtml(rec.timestamp.slice(0, 19).replace("T", " "))}</div>
            </div>
          </div>
          ${
            rec.rolledBackAt
              ? `<span class="op-badge mono rename">ROLLED BACK</span>`
              : `<button type="button" class="op-badge mono rollback" data-tx-id="${escapeHtml(rec.transactionId)}">Rollback</button>`
          }
        `;
        const rbBtn = row.querySelector("button[data-tx-id]");
        if (rbBtn) {
          rbBtn.addEventListener("click", async () => {
            const txId = rbBtn.getAttribute("data-tx-id");
            rbBtn.disabled = true;
            rbBtn.textContent = "Verifying...";
            try {
              const res = await rpc("rollback", { transactionId: txId });
              showToast(`SHA-256 verified! Restored to ${toRelative(res.restoredTo, currentSandboxRoot)}`, "ok");
              await refreshStatus();
              await openHistoryInspector();
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

    setIslandState("inspector");
  } catch (err) {
    showToast(`Gagal memuat riwayat: ${err}`, "err");
    setIslandState("palette");
  }
}

async function handleChatPrompt(rawMessage) {
  const message = rawMessage.trim();
  if (!message) return;

  const enableAiForFiles = document.getElementById("chk-ai-docs").checked;
  chatHistory.push({ role: "user", content: message });
  appendPaletteMessage("user", message);

  showActiveCapsule(`"${message.slice(0, 44)}${message.length > 44 ? "..." : ""}"`, "Thinking • Qwen2.5-0.5B On-Demand");

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
      appendPaletteMessage("assistant", res.reply);
      await openHistoryInspector();
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
  const enableAi = document.getElementById("chk-ai-docs").checked;
  showActiveCapsule(
    '"Organize Sandbox (Dry-Run)..."',
    enableAi ? "Qwen2.5-0.5B Smart Categorizer" : "Rule-Based Fast Path (0 MB AI)"
  );
  try {
    const data = await rpc("planOrganize", { enableAi });
    openInspectorWithPlan(data.plan, data.sandboxRoot, "Safe Dry-Run Preview");
  } catch (err) {
    showToast(`Organize error: ${err}`, "err");
    setIslandState("palette");
  }
}

async function runQuickHygiene() {
  showActiveCapsule('"Scanning SHA-256 Duplicates..."', "Checking duplicates & old installers");
  try {
    const data = await rpc("planHygiene");
    openInspectorWithPlan(
      data.plan,
      data.sandboxRoot,
      `Quarantine Preview (${data.duplicateGroupsCount} dup, ${data.oldInstallersCount} old)`
    );
  } catch (err) {
    showToast(`Hygiene error: ${err}`, "err");
    setIslandState("palette");
  }
}

async function runSummarizeClipboard() {
  try {
    const clipText = (await navigator.clipboard.readText()).trim();
    if (!clipText) {
      showToast("Clipboard kosong. Salin teks dulu lalu klik Ringkas Clipboard.", "err");
      return;
    }
    showActiveCapsule('"Meringkas Clipboard (TL;DR)..."', "Qwen2.5-0.5B • Maks 1.500 kata");
    const res = await rpc("quickTldr", { text: clipText });
    const note = res.truncated ? ` _(dipotong ke 1.500 kata pertama)_` : "";
    appendPaletteMessage("assistant", `**Ringkasan Clipboard (${res.wordCount} kata)${note}:**\n${res.summary}`, null, true);
    setIslandState("palette");
  } catch (err) {
    showToast(`Gagal meringkas clipboard: ${err}`, "err");
    setIslandState("palette");
  }
}

async function runFormatPdfClipboard() {
  try {
    const clipText = (await navigator.clipboard.readText()).trim();
    if (!clipText) {
      showToast("Clipboard kosong. Salin teks PDF yang terpotong dulu.", "err");
      return;
    }
    const res = await rpc("formatClipboard", { text: clipText });
    await navigator.clipboard.writeText(res.formatted);
    appendPaletteMessage("assistant", `**Teks PDF dirapikan & otomatis disalin ke clipboard:**\n${res.formatted.slice(0, 420)}${res.formatted.length > 420 ? "..." : ""}`);
    showToast("Teks PDF rapi & sudah disalin ke clipboard!", "ok");
    setIslandState("palette");
  } catch (err) {
    showToast(`Gagal merapikan clipboard: ${err}`, "err");
  }
}

async function runOpenSandboxFolder() {
  try {
    const res = await rpc("safeCommand", { command: "OPEN_SANDBOX" });
    showToast(res.message.replace(/`/g, ""), "ok");
  } catch (err) {
    showToast(`Gagal membuka folder: ${err}`, "err");
  }
}

function renderSettingsDirs() {
  const container = document.getElementById("settings-dirs-list");
  container.innerHTML = "";
  draftAllowedDirs.forEach((dir, idx) => {
    const chip = document.createElement("span");
    chip.className = "dir-chip mono";
    chip.innerHTML = `<span>${escapeHtml(dir)}</span>`;
    if (draftAllowedDirs.length > 1) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "dir-chip-remove";
      rm.textContent = "×";
      rm.title = "Hapus folder dari sandbox";
      rm.addEventListener("click", () => {
        draftAllowedDirs.splice(idx, 1);
        renderSettingsDirs();
      });
      chip.appendChild(rm);
    }
    container.appendChild(chip);
  });
}

async function openSettingsPanel() {
  try {
    const status = await rpc("getStatus");
    draftAllowedDirs = [...status.allowedDirectories];
    renderSettingsDirs();
    document.getElementById("settings-categories").value = status.categories.join(", ");
    document.getElementById("settings-days").value = String(status.oldInstallerDays);
    document.getElementById("settings-threads").value = String(status.threads);
    setIslandState("settings");
  } catch (err) {
    showToast(`Gagal memuat pengaturan: ${err}`, "err");
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const saveBtn = document.getElementById("btn-settings-save");
  const categories = document
    .getElementById("settings-categories")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const oldInstallerDays = Number.parseInt(document.getElementById("settings-days").value, 10);
  const threads = Number.parseInt(document.getElementById("settings-threads").value, 10);

  saveBtn.disabled = true;
  saveBtn.textContent = "Menyimpan...";
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
    showToast(`Pengaturan ditolak: ${err}`, "err");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Simpan Pengaturan";
  }
}

async function applyActivePlan() {
  if (!activePlan || activePlan.operations.length === 0) return;
  const applyBtn = document.getElementById("btn-inspector-apply");
  applyBtn.disabled = true;

  showActiveCapsule('"Applying Sandboxed Changes..."', "Computing SHA-256 & writing audit log");
  try {
    const res = await rpc("executePlan", {
      planId: activePlan.planId,
      confirmToken: "CONFIRM_EXECUTE",
    });
    activePlan = null;
    showToast(`Applied ${res.executedCount} file ops • SHA-256 logged`, "ok");
    await refreshStatus();
    setIslandState("idle");
  } catch (err) {
    showToast(`Eksekusi gagal: ${err}`, "err");
    setIslandState("inspector");
    applyBtn.disabled = false;
  }
}

function startVoiceInput() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    setIslandState("palette");
    showToast("Voice recognition tidak tersedia di mode ini — ketik langsung di Ask AI.", "err");
    return;
  }

  const recognition = new SpeechRec();
  recognition.lang = "id-ID";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  showActiveCapsule('"Mendengarkan..."', "Listening • Speech to Local AI");

  let finalTranscript = "";
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((r) => r[0].transcript)
      .join("");
    document.getElementById("active-title").textContent = `"${transcript}"`;
    if (event.results[0]?.isFinal) {
      finalTranscript = transcript;
    }
  };

  recognition.onend = () => {
    if (finalTranscript.trim()) {
      void handleChatPrompt(finalTranscript);
    } else {
      setIslandState("palette");
    }
  };

  recognition.onerror = () => {
    setIslandState("palette");
  };

  document.getElementById("btn-active-stop").onclick = () => {
    recognition.stop();
    setIslandState("palette");
  };

  recognition.start();
}

document.addEventListener("DOMContentLoaded", () => {
  // State 1 -> State 3
  document.getElementById("view-idle").addEventListener("click", (e) => {
    if (e.target.closest("#btn-idle-mic")) return;
    setIslandState("palette");
  });
  document.getElementById("btn-idle-mic").addEventListener("click", (e) => {
    e.stopPropagation();
    startVoiceInput();
  });

  // State 2 Stop -> State 3
  document.getElementById("btn-active-stop").addEventListener("click", () => {
    setIslandState("palette");
  });

  // State 3 Controls
  document.getElementById("btn-collapse-idle").addEventListener("click", () => setIslandState("idle"));
  document.getElementById("btn-palette-mic").addEventListener("click", startVoiceInput);
  document.getElementById("btn-quit-app")?.addEventListener("click", () => {
    if (typeof invoke === "function") {
      void invoke("quit_app");
    } else {
      window.close();
    }
  });
  document.getElementById("palette-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("palette-input");
    const val = input.value;
    input.value = "";
    void handleChatPrompt(val);
  });

  document.getElementById("chip-organize").addEventListener("click", () => void runQuickOrganize());
  document.getElementById("chip-clipboard").addEventListener("click", () => void runSummarizeClipboard());
  document.getElementById("chip-format-pdf")?.addEventListener("click", () => void runFormatPdfClipboard());
  document.getElementById("chip-hygiene").addEventListener("click", () => void runQuickHygiene());
  document.getElementById("chip-history").addEventListener("click", () => void openHistoryInspector());
  document.getElementById("btn-open-sandbox")?.addEventListener("click", () => void runOpenSandboxFolder());
  document.getElementById("btn-open-settings")?.addEventListener("click", () => void openSettingsPanel());
  document.getElementById("btn-settings-back")?.addEventListener("click", () => setIslandState("palette"));
  document.getElementById("btn-settings-cancel")?.addEventListener("click", () => setIslandState("palette"));
  document.getElementById("settings-form")?.addEventListener("submit", (e) => void saveSettings(e));
  document.getElementById("btn-add-dir")?.addEventListener("click", () => {
    const input = document.getElementById("settings-new-dir");
    const val = input.value.trim();
    if (val && !draftAllowedDirs.includes(val)) {
      draftAllowedDirs.push(val);
      input.value = "";
      renderSettingsDirs();
    }
  });
  document.getElementById("handle-palette")?.addEventListener("click", () => setIslandState("idle"));

  // Klik area transparan di luar kapsul -> otomatis mengecil ke Idle Notch
  document.querySelector(".stage")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget && document.getElementById("island")?.dataset.state !== "idle") {
      setIslandState("idle");
    }
  });

  // State 4 Controls
  document.getElementById("btn-inspector-dismiss").addEventListener("click", () => setIslandState("palette"));
  document.getElementById("btn-inspector-history").addEventListener("click", () => void openHistoryInspector());
  document.getElementById("btn-inspector-apply").addEventListener("click", () => void applyActivePlan());

  // Keyboard shortcuts: Alt+Space toggles Palette, Escape collapses to Idle
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "Space") {
      e.preventDefault();
      const current = document.getElementById("island").dataset.state;
      setIslandState(current === "idle" ? "palette" : "idle");
    } else if (e.key === "Escape") {
      setIslandState("idle");
    }
  });

  void refreshStatus();
});
