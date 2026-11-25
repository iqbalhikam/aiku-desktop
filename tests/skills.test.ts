import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSkillMarkdown, SkillManager } from "../src/core/skills/skill-manager.js";

describe("SkillManager (SKILL.md Custom Skills)", () => {
  const tempDirs: string[] = [];

  function makeTempBase(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiku-skills-test-"));
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

  it("auto-installs built-in deep-research skill and matches /research or riset triggers", () => {
    const mgr = new SkillManager(makeTempBase());
    const skills = mgr.listSkillSummaries();
    expect(skills.some((s) => s.id === "deep-research" && s.useWebSearch)).toBe(true);

    const slash = mgr.matchSkillsForMessage("/research perbandingan Rust vs Go 2026");
    expect(slash.matched.map((m) => m.id)).toContain("deep-research");
    expect(slash.cleanedMessage).toBe("perbandingan Rust vs Go 2026");
    expect(slash.shouldRunWebSearch).toBe(true);
    expect(slash.promptBlock).toContain("Deep Research Skill");
  });

  it("uploads, parses frontmatter, toggles, and deletes custom SKILL.md", () => {
    const mgr = new SkillManager(makeTempBase());
    const uploaded = mgr.uploadSkill({
      filename: "SKILL.md",
      content: `---
name: research-validator
description: Validasi klaim dan sumber riset secara ketat
triggers: validasi, cek fakta, verifikasi
useWebSearch: true
---
# Research Validator
Selalu verifikasi setiap angka dengan minimal 2 sumber kredibel.`,
    });

    expect(uploaded.id).toBe("research-validator");
    expect(uploaded.useWebSearch).toBe(true);
    expect(uploaded.enabled).toBe(true);

    const matched = mgr.matchSkillsForMessage("Tolong cek fakta berita inflasi hari ini");
    expect(matched.matched.some((m) => m.id === "research-validator")).toBe(true);
    expect(matched.shouldRunWebSearch).toBe(true);

    // Disable skill -> should no longer match
    mgr.toggleSkill("research-validator", false);
    const afterDisable = mgr.matchSkillsForMessage("Tolong cek fakta berita inflasi hari ini");
    expect(afterDisable.matched.some((m) => m.id === "research-validator")).toBe(false);

    // Delete skill
    const afterDelete = mgr.deleteSkill("research-validator");
    expect(afterDelete.some((s) => s.id === "research-validator")).toBe(false);
  });

  it("parses plain markdown files without YAML frontmatter", () => {
    const parsed = parseSkillMarkdown("# Copywriter Santai\nTulis teks promosi singkat.", "promo.md");
    expect(parsed.name).toBe("Copywriter Santai");
    expect(parsed.description).toContain("Tulis teks promosi singkat.");
  });
});
