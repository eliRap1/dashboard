import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { runWatcher } from "@/lib/scheduler/runner";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-")); process.env.DASHBOARD_DB = path.join(tmp, "t.db"); });
afterEach(() => {
  _resetDbForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DASHBOARD_DB; delete process.env.FAKE_CLAUDE_ENV;
});

describe("runWatcher", () => {
  it("ok status writes watcher_run + feed", async () => {
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p", process.cwd(), "p", 1, 1);
    const w = db.prepare(`INSERT INTO watchers(scope,target_id,name,prompt,trigger_kind,trigger_value,enabled,created_at)
                          VALUES('project','p','w','say hi','cron','* * * * *',1,?)`).run(Date.now()).lastInsertRowid as number;
    await runWatcher(w, { bin: process.execPath, args: [path.resolve(process.cwd(),"scripts/fake-claude.cjs"), "-p"] });
    const run = db.prepare("SELECT * FROM watcher_runs WHERE watcher_id=?").get(w) as any;
    expect(run.status).toBe("ok");
    const feed = db.prepare("SELECT * FROM feed WHERE kind='watcher_done'").all();
    expect(feed.length).toBe(1);
  });
  it("alert status writes feed kind=watcher_alert", async () => {
    process.env.FAKE_CLAUDE_ENV = "alert";
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p", process.cwd(), "p", 1, 1);
    const w = db.prepare(`INSERT INTO watchers(scope,target_id,name,prompt,trigger_kind,trigger_value,enabled,created_at)
                          VALUES('project','p','w','x','cron','* * * * *',1,?)`).run(Date.now()).lastInsertRowid as number;
    await runWatcher(w, { bin: process.execPath, args: [path.resolve(process.cwd(),"scripts/fake-claude.cjs"), "-p"] });
    const feed = db.prepare("SELECT * FROM feed WHERE kind='watcher_alert'").get() as any;
    expect(feed).toBeTruthy();
  });
});
