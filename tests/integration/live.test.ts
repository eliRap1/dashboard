import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { syncLiveOnce } from "@/lib/indexer/live";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ccdash-live-"));
  fs.mkdirSync(path.join(tmpHome, "sessions"), { recursive: true });
  process.env.CLAUDE_HOME  = tmpHome;
  process.env.DASHBOARD_DB = path.join(tmpHome, "t.db");
});
afterEach(() => {
  _resetDbForTests();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.CLAUDE_HOME; delete process.env.DASHBOARD_DB;
});

describe("syncLiveOnce", () => {
  it("upserts live_sessions from json files", async () => {
    fs.writeFileSync(
      path.join(tmpHome, "sessions/1234.json"),
      JSON.stringify({ pid: 1234, sessionId: "abc", cwd: "D:\\proj", status: "busy", updatedAt: Date.now() })
    );
    await syncLiveOnce();
    const rows = getDb().prepare("SELECT * FROM live_sessions").all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe("abc");
  });
  it("removes stale rows when file deleted", async () => {
    const f = path.join(tmpHome, "sessions/1.json");
    fs.writeFileSync(f, JSON.stringify({ pid: 1, sessionId: "x", cwd: "/p", status: "idle", updatedAt: Date.now() }));
    await syncLiveOnce();
    fs.unlinkSync(f);
    await syncLiveOnce();
    const rows = getDb().prepare("SELECT * FROM live_sessions").all();
    expect(rows.length).toBe(0);
  });
});
