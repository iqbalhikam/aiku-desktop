import fs from "node:fs";
import path from "node:path";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  alwaysActive: boolean;
  useWebSearch: boolean;
  enabled: boolean;
  builtIn: boolean;
  filePath: string;
  body: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  alwaysActive: boolean;
  useWebSearch: boolean;
  enabled: boolean;
  builtIn: boolean;
  sizeBytes: number;
  updatedAt: string;
}

interface SkillRegistryState {
  disabledIds: string[];
}

const MAX_SKILL_BYTES = 64 * 1024;
const MAX_INJECTED_CHARS = 2600;

const DEFAULT_RESEARCH_SKILL_MD = `---
name: deep-research
description: Riset mendalam berbasis sumber web lokal & analisis terstruktur (ringkasan, temuan utama, perbandingan, dan kesimpulan).
triggers: research, riset, teliti, analisis mendalam, bandingkan, perbandingan, cari tahu mendalam, deep research
useWebSearch: true
alwaysActive: false
---

# Deep Research Skill (aiku)

Saat skill ini aktif, bertindaklah sebagai asisten riset pribadi yang teliti, objektif, dan terstruktur:

1. **Ringkasan Inti (TL;DR):** Awali dengan 2-3 kalimat padat yang langsung menjawab inti pertanyaan pengguna.
2. **Temuan Utama:** Sajikan poin-poin penting secara rapi dengan data, angka, atau fakta konkret dari hasil pencarian web/dokumen yang tersedia.
3. **Perbandingan (jika relevan):** Jika pengguna membandingkan beberapa opsi/produk/teknologi, tampilkan tabel Markdown ringkas agar mudah dipindai.
4. **Kelebihan & Risiko / Catatan Penting:** Berikan sudut pandang seimbang tanpa melebih-lebihkan.
5. **Sumber & Transparansi:** Jika menggunakan data web terkini, sebutkan sumber singkatnya; jika suatu fakta belum terverifikasi, nyatakan secara jujur dan jangan mengarang.
6. **Gaya Bahasa:** Gunakan Bahasa Indonesia yang jernih, langsung ke inti, tanpa basa-basi pembuka yang panjang.
`;

function sanitizeSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || "custom-skill";
}

function parseBool(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "yes" || v === "1") return true;
  if (v === "false" || v === "no" || v === "0") return false;
  return fallback;
}

export function parseSkillMarkdown(
  rawContent: string,
  fallbackName: string
): {
  name: string;
  description: string;
  triggers: string[];
  alwaysActive: boolean;
  useWebSearch: boolean;
  body: string;
} {
  const normalized = rawContent.replace(/\r\n/g, "\n").trim();
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  const meta: Record<string, string> = {};
  let body = normalized;

  if (fmMatch) {
    const fmBlock = fmMatch[1] ?? "";
    body = (fmMatch[2] ?? "").trim();
    const lines = fmBlock.split("\n");
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = line
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key && val) {
        meta[key] = val;
      }
    }
  }

  const headingMatch = body.match(/^#\s+(.+)$/m);
  const derivedName = meta.name || headingMatch?.[1]?.trim() || fallbackName.replace(/\.md$/i, "");

  let description = meta.description || "";
  if (!description) {
    const firstPara = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("```"));
    description = firstPara ? firstPara.slice(0, 140) : "Custom skill lokal untuk aiku";
  }

  const rawTriggers = meta.triggers || meta.keywords || "";
  const triggers = rawTriggers
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/^["']|["']$/g, ""))
    .filter((t) => t.length >= 2);

  const alwaysActive = parseBool(meta.alwaysactive || meta["always-active"] || meta.always, false);
  const useWebSearch = parseBool(
    meta.usewebsearch || meta["use-web-search"] || meta.websearch || meta.research,
    /research|riset/i.test(`${derivedName} ${description}`)
  );

  return {
    name: derivedName.slice(0, 64),
    description: description.slice(0, 200),
    triggers,
    alwaysActive,
    useWebSearch,
    body,
  };
}

export class SkillManager {
  private readonly skillsRoot: string;
  private readonly registryPath: string;

  public constructor(baseDir: string) {
    this.skillsRoot = path.join(baseDir, "skills");
    this.registryPath = path.join(this.skillsRoot, "registry.json");
    this.ensureDefaults();
  }

  public getSkillsRoot(): string {
    return this.skillsRoot;
  }

  private ensureDefaults(): void {
    fs.mkdirSync(this.skillsRoot, { recursive: true });
    const researchDir = path.join(this.skillsRoot, "deep-research");
    const researchFile = path.join(researchDir, "SKILL.md");
    if (!fs.existsSync(researchFile)) {
      fs.mkdirSync(researchDir, { recursive: true });
      fs.writeFileSync(researchFile, DEFAULT_RESEARCH_SKILL_MD, "utf8");
    }
  }

  private readRegistry(): SkillRegistryState {
    try {
      if (!fs.existsSync(this.registryPath)) {
        return { disabledIds: [] };
      }
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, "utf8")) as Partial<SkillRegistryState>;
      const disabledIds = Array.isArray(parsed.disabledIds)
        ? parsed.disabledIds.filter((x): x is string => typeof x === "string")
        : [];
      return { disabledIds };
    } catch {
      return { disabledIds: [] };
    }
  }

  private writeRegistry(state: SkillRegistryState): void {
    fs.mkdirSync(this.skillsRoot, { recursive: true });
    fs.writeFileSync(this.registryPath, JSON.stringify(state, null, 2), "utf8");
  }

  public listSkills(): SkillDefinition[] {
    this.ensureDefaults();
    const registry = this.readRegistry();
    const disabledSet = new Set(registry.disabledIds);
    const results: SkillDefinition[] = [];

    const entries = fs.readdirSync(this.skillsRoot, { withFileTypes: true });
    for (const entry of entries) {
      let skillId = "";
      let filePath = "";

      if (entry.isDirectory()) {
        const candidate = path.join(this.skillsRoot, entry.name, "SKILL.md");
        if (!fs.existsSync(candidate)) continue;
        skillId = sanitizeSlug(entry.name);
        filePath = candidate;
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        skillId = sanitizeSlug(entry.name);
        filePath = path.join(this.skillsRoot, entry.name);
      } else {
        continue;
      }

      try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_SKILL_BYTES) continue;
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = parseSkillMarkdown(raw, skillId);
        results.push({
          id: skillId,
          name: parsed.name,
          description: parsed.description,
          triggers: parsed.triggers,
          alwaysActive: parsed.alwaysActive,
          useWebSearch: parsed.useWebSearch,
          enabled: !disabledSet.has(skillId),
          builtIn: skillId === "deep-research",
          filePath,
          body: parsed.body,
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      } catch {
        // Skip unreadable skill file
      }
    }

    return results.sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  public listSkillSummaries(): SkillSummary[] {
    return this.listSkills().map(({ body: _body, filePath: _fp, ...rest }) => rest);
  }

  public uploadSkill(input: { filename: string; content: string }): SkillSummary {
    const content = input.content.trim();
    if (!content) {
      throw new Error("Isi file SKILL.md tidak boleh kosong.");
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_SKILL_BYTES) {
      throw new Error("Ukuran file SKILL.md melebihi batas aman 64 KB.");
    }

    const baseName = path.basename(input.filename || "custom-skill.md");
    const parsed = parseSkillMarkdown(content, baseName);
    const id = sanitizeSlug(
      parsed.name && parsed.name.toLowerCase() !== "skill" ? parsed.name : baseName
    );

    const skillDir = path.join(this.skillsRoot, id);
    const resolvedDir = path.resolve(skillDir);
    const resolvedRoot = path.resolve(this.skillsRoot);
    if (!resolvedDir.startsWith(resolvedRoot + path.sep)) {
      throw new Error("Nama skill tidak valid.");
    }

    fs.mkdirSync(skillDir, { recursive: true });
    const targetFile = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(targetFile, `${content}\n`, "utf8");

    // Pastikan skill yang baru di-upload langsung aktif
    const registry = this.readRegistry();
    if (registry.disabledIds.includes(id)) {
      registry.disabledIds = registry.disabledIds.filter((d) => d !== id);
      this.writeRegistry(registry);
    }

    const found = this.listSkillSummaries().find((s) => s.id === id);
    if (!found) {
      throw new Error("Gagal membaca ulang skill yang baru disimpan.");
    }
    return found;
  }

  public toggleSkill(id: string, enabled: boolean): SkillSummary[] {
    const cleanId = sanitizeSlug(id);
    const registry = this.readRegistry();
    const set = new Set(registry.disabledIds);
    if (enabled) {
      set.delete(cleanId);
    } else {
      set.add(cleanId);
    }
    this.writeRegistry({ disabledIds: [...set] });
    return this.listSkillSummaries();
  }

  public deleteSkill(id: string): SkillSummary[] {
    const cleanId = sanitizeSlug(id);
    const dirTarget = path.resolve(this.skillsRoot, cleanId);
    const fileTarget = path.resolve(this.skillsRoot, `${cleanId}.md`);
    const resolvedRoot = path.resolve(this.skillsRoot);

    if (dirTarget.startsWith(resolvedRoot + path.sep) && fs.existsSync(dirTarget)) {
      fs.rmSync(dirTarget, { recursive: true, force: true });
    }
    if (fileTarget.startsWith(resolvedRoot + path.sep) && fs.existsSync(fileTarget)) {
      fs.rmSync(fileTarget, { force: true });
    }

    const registry = this.readRegistry();
    if (registry.disabledIds.includes(cleanId)) {
      registry.disabledIds = registry.disabledIds.filter((d) => d !== cleanId);
      this.writeRegistry(registry);
    }
    return this.listSkillSummaries();
  }

  public matchSkillsForMessage(rawMessage: string): {
    cleanedMessage: string;
    matched: SkillDefinition[];
    shouldRunWebSearch: boolean;
    promptBlock: string;
  } {
    const allEnabled = this.listSkills().filter((s) => s.enabled);
    if (allEnabled.length === 0) {
      return {
        cleanedMessage: rawMessage,
        matched: [],
        shouldRunWebSearch: false,
        promptBlock: "",
      };
    }

    let cleanedMessage = rawMessage.trim();
    const lower = cleanedMessage.toLowerCase();
    const chosen: SkillDefinition[] = [];
    const chosenIds = new Set<string>();

    // 1. Explicit slash command: /deep-research ... or /research ... or /<skill-id> ...
    const slashMatch = cleanedMessage.match(/^\/([a-z0-9_-]+)\s*([\s\S]*)$/i);
    if (slashMatch) {
      const cmd = (slashMatch[1] ?? "").toLowerCase();
      const rest = (slashMatch[2] ?? "").trim();
      const direct = allEnabled.find(
        (s) =>
          s.id === cmd ||
          s.name.toLowerCase() === cmd ||
          (cmd === "research" && s.id === "deep-research") ||
          (cmd === "riset" && s.id === "deep-research")
      );
      if (direct) {
        chosen.push(direct);
        chosenIds.add(direct.id);
        if (rest.length > 0) {
          cleanedMessage = rest;
        }
      }
    }

    // 2. Always-active or trigger-matched skills (max 2 total to keep Qwen3 4B fast)
    for (const skill of allEnabled) {
      if (chosen.length >= 2) break;
      if (chosenIds.has(skill.id)) continue;

      if (skill.alwaysActive) {
        chosen.push(skill);
        chosenIds.add(skill.id);
        continue;
      }

      const matchedTrigger = skill.triggers.some((t) => lower.includes(t));
      if (matchedTrigger) {
        chosen.push(skill);
        chosenIds.add(skill.id);
      }
    }

    if (chosen.length === 0) {
      return {
        cleanedMessage,
        matched: [],
        shouldRunWebSearch: false,
        promptBlock: "",
      };
    }

    const shouldRunWebSearch = chosen.some((s) => s.useWebSearch);
    const sections = chosen.map((s) => {
      const bodySnippet = s.body.slice(0, Math.floor(MAX_INJECTED_CHARS / chosen.length));
      return `[SKILL AKTIF: ${s.name}]\n${bodySnippet}`;
    });

    const promptBlock = [
      "INSTRUKSI SKILL KUSTOM PENGGUNA (ikuti gaya & struktur berikut saat menjawab):",
      ...sections,
    ].join("\n\n");

    return {
      cleanedMessage,
      matched: chosen,
      shouldRunWebSearch,
      promptBlock,
    };
  }
}
