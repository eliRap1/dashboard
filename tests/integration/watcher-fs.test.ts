import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { startFsWatcher, stopFsWatcher } from "@/lib/watcher/fs";
import { _resetDbForTests } from "@/lib/db";
import { bus } from "@/lib/bus";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsw-"));
  fs.mkdirSync(path.join(tmp, "projects/D--p"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "plans"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "todos"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
  process.env.CLAUDE_HOME  = tmp;
  process.env.DASHBOARD_DB = path.join(tmp, "t.db");
});
afterEach(async () => {
  await stopFsWatcher(); _resetDbForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.CLAUDE_HOME; delete process.env.DASHBOARD_DB;
});

describe("fs watcher", () => {
  it("emits session:new when a new jsonl appears", async () => {
    const got: any[] = [];
    const onNew = (d: any) => got.push(d);
    bus.on("session:new", onNew);
    await startFsWatcher();
    await new Promise(r => setTimeout(r, 300));
    fs.writeFileSync(
      path.join(tmp, "projects/D--p/new.jsonl"),
      '{"type":"user","timestamp":"2026-04-30T12:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n'
    );
    await new Promise(r => setTimeout(r, 1500));
    bus.off("session:new", onNew);
    expect(got.some((g: any) => g.sessionId === "new")).toBe(true);
  }, 10000);
});
