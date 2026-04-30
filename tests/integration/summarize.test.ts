import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { summarizeSession } from "@/lib/ai/summarize";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sum-"));
  process.env.DASHBOARD_DB = path.join(tmp, "t.db");
});
afterEach(() => {
  _resetDbForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DASHBOARD_DB;
});

describe("summarizeSession", () => {
  it("writes summary using fake claude bin", async () => {
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p", process.cwd(), "p", 1, 1);
    db.prepare(`INSERT INTO sessions(id,project_id,jsonl_path,started_at,msg_count) VALUES('s','p',?,1,5)`)
      .run(path.resolve(process.cwd(), "tests/fixtures/session-simple.jsonl"));
    await summarizeSession("s", { bin: process.execPath, args: [path.resolve(process.cwd(), "scripts/fake-claude.cjs"), "-p"] });
    const row = db.prepare("SELECT * FROM summaries WHERE session_id='s'").get() as any;
    expect(row.title).toBe("stub");
    expect(row.summary).toBe("stub summary");
  });
});
