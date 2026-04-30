import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { scanAll } from "@/lib/indexer/scan";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "ccdash-"));
  fs.mkdirSync(path.join(tmpHome, "projects/-tmp-myproj"), { recursive: true });
  fs.copyFileSync(
    path.resolve(process.cwd(), "tests/fixtures/session-simple.jsonl"),
    path.join(tmpHome, "projects/-tmp-myproj/aaa.jsonl")
  );
  process.env.CLAUDE_HOME   = tmpHome;
  process.env.DASHBOARD_DB  = path.join(tmpHome, "test.db");
});

afterEach(() => {
  _resetDbForTests();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.CLAUDE_HOME;
  delete process.env.DASHBOARD_DB;
});

describe("scanAll", () => {
  it("upserts projects and sessions, populates messages_fts", async () => {
    await scanAll();
    const db = getDb();
    const projects = db.prepare("SELECT * FROM projects").all() as any[];
    expect(projects.length).toBe(1);
    expect(projects[0].name).toBe("myproj");
    const sessions = db.prepare("SELECT * FROM sessions").all() as any[];
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe("aaa");
    expect(sessions[0].msg_count).toBe(3);
    const ftsRows = db.prepare("SELECT count(*) c FROM messages_fts").get() as any;
    expect(ftsRows.c).toBe(3);
  });
  it("re-scan is idempotent", async () => {
    await scanAll();
    await scanAll();
    const ftsRows = getDb().prepare("SELECT count(*) c FROM messages_fts").get() as any;
    expect(ftsRows.c).toBe(3);
  });
});
