/* ============================================================================
   aiku Browser Bridge — Local-Only Ingest for Gemini Web / ChatGPT / Claude
   Sends conversation topic summaries ONLY to http://127.0.0.1:47891/ingest
   ============================================================================ */

(function () {
  const INGEST_URL = "http://127.0.0.1:47891/ingest";
  let lastSentHash = "";
  let debounceTimer = null;

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return String(h);
  }

  function extractLatestTurn() {
    const host = location.hostname;
    let prompt = "";
    let answer = "";

    if (host.includes("gemini.google.com")) {
      const userEls = document.querySelectorAll(
        "user-query, .user-query-container, [data-test-id='user-query']"
      );
      const modelEls = document.querySelectorAll(
        "model-response, .model-response-text, message-content"
      );
      const lastUser = userEls[userEls.length - 1];
      const lastModel = modelEls[modelEls.length - 1];
      prompt = (lastUser?.innerText || "").trim();
      answer = (lastModel?.innerText || "").trim();
    } else if (host.includes("chatgpt.com")) {
      const userEls = document.querySelectorAll("[data-message-author-role='user']");
      const modelEls = document.querySelectorAll("[data-message-author-role='assistant']");
      prompt = (userEls[userEls.length - 1]?.innerText || "").trim();
      answer = (modelEls[modelEls.length - 1]?.innerText || "").trim();
    } else if (host.includes("claude.ai")) {
      const userEls = document.querySelectorAll("[data-testid='user-message']");
      const modelEls = document.querySelectorAll(".font-claude-message, [data-testid='assistant-message']");
      prompt = (userEls[userEls.length - 1]?.innerText || "").trim();
      answer = (modelEls[modelEls.length - 1]?.innerText || "").trim();
    }

    return {
      title: (document.title || host).replace(/\s*[-|]\s*(Google Gemini|ChatGPT|Claude).*$/i, "").trim(),
      prompt: prompt.slice(0, 1600),
      answer: answer.slice(0, 1800),
    };
  }

  async function pushToAikuHub() {
    const turn = extractLatestTurn();
    if (!turn.prompt || turn.prompt.length < 6) return;

    const hash = simpleHash(`${turn.prompt}|${turn.answer.slice(0, 240)}`);
    if (hash === lastSentHash) return;
    lastSentHash = hash;

    try {
      await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "gemini-web",
          title: turn.title,
          prompt: turn.prompt,
          answer: turn.answer,
        }),
      });
    } catch {
      // aiku sedang tidak berjalan — abaikan diam-diam
    }
  }

  function scheduleSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void pushToAikuHub();
    }, 3200);
  }

  const observer = new MutationObserver(() => {
    scheduleSync();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: false,
  });

  // Initial sync setelah halaman selesai memuat
  setTimeout(scheduleSync, 4000);
})();
