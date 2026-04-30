import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { appendDailyNote } from "@/lib/obsidian/writer";

let vault: string;
beforeEach(() => { vault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-")); });
afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

describe("obsidian writer", () => {
  it("creates daily note and appends", async () => {
    await appendDailyNote(vault, { title: "T", summary: "S", recommendation: "R", project: "p", sessionShort: "abc", time: "12:00" });
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(vault, "Claude Sessions", `${today}.md`);
    expect(fs.existsSync(file)).toBe(true);
    const txt = fs.readFileSync(file, "utf8");
    expect(txt).toContain("**Title:** T");
    expect(txt).toContain("**Summary:** S");
  });
});
