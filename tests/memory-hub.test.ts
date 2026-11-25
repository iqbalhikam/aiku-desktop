import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AiMemoryHub } from "../src/core/graph/ai-memory-hub.js";

describe("AiMemoryHub (Unified Cross-AI Graph & Custom Nodes)", () => {
  const tempDirs: string[] = [];

  function makeTempBase(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiku-memhub-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("ingests across aiku-local and gemini-web and creates custom nodes with links", () => {
    const base = makeTempBase();
    const hub = new AiMemoryHub(base);

    hub.ingest({
      source: "aiku-local",
      prompt: "Belajar Rust dan Tauri untuk aplikasi desktop lokal",
      answer: "Rust sangat aman untuk aplikasi desktop Tauri.",
    });

    hub.ingest({
      source: "gemini-web",
      prompt: "Riset arsitektur Rust desktop agent terbaik",
      answer: "Gunakan Rust dengan IPC yang ketat.",
    });

    const snap1 = hub.addCustomNode({
      label: "Proyek aiku",
      note: "Target riset Rust dan desktop 2026",
      color: "#52C99A",
      connectTo: ["rust", "tauri"],
    });

    const customNode = snap1.nodes.find((n) => n.isCustom && n.label === "Proyek aiku");
    expect(customNode).toBeDefined();
    expect(customNode?.customColor).toBe("#52C99A");
    expect(snap1.sourceCounts.custom).toBe(1);
    expect(snap1.edges.some((e) => e.source === customNode?.id || e.target === customNode?.id)).toBe(true);

    // Persists across reload & deletes cleanly
    const hub2 = new AiMemoryHub(base);
    expect(hub2.getSnapshot().nodes.some((n) => n.isCustom && n.label === "Proyek aiku")).toBe(true);

    const afterDel = hub2.deleteCustomNode(customNode!.id);
    expect(afterDel.nodes.some((n) => n.isCustom && n.label === "Proyek aiku")).toBe(false);
    expect(afterDel.sourceCounts.custom).toBe(0);
  });
});
