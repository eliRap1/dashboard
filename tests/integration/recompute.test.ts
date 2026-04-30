import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { _resetDbForTests, getDb } from "@/lib/db";
import { recomputeSessionHealth, recomputeProjectHealth } from "@/lib/health/recompute";

beforeEach(() => { process.env.DASHBOARD_DB = path.join(os.tmpdir(), `health-${Date.now()}.db`); });
afterEach(() => {
  _resetDbForTests();
  if (process.env.DASHBOARD_DB && fs.existsSync(process.env.DASHBOARD_DB)) fs.unlinkSync(process.env.DASHBOARD_DB);
  delete process.env.DASHBOARD_DB;
});

describe("recompute", () => {
  it("writes pet_health row for a session", () => {
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p1","D:\\x","x",1,1);
    db.prepare(`INSERT INTO sessions(id,project_id,jsonl_path,started_at,last_msg_at,msg_count,tokens_in,tokens_out,model,status,tail_offset,error_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run("s1","p1","/x.jsonl",1, Date.now()-60000, 5, 100, 50, "claude-opus-4-7", "idle", 0, 0);
    recomputeSessionHealth("s1");
    const row = db.prepare("SELECT * FROM pet_health WHERE scope='session' AND target_id='s1'").get() as any;
    expect(row.hp).toBeGreaterThan(0);
    expect(row.face.length).toBeGreaterThan(2);
  });
  it("project HP = max of session HPs (default)", () => {
    const db = getDb();
    db.prepare("INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)").run("p1","D:\\x","x",1,1);
    const insS = db.prepare(`INSERT INTO sessions(id,project_id,jsonl_path,started_at,last_msg_at,msg_count,tokens_in,tokens_out,model,status,tail_offset,error_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    insS.run("a","p1","/x.jsonl",1, Date.now()-60000,        5, 100, 50, "m", "idle", 0, 0);
    insS.run("b","p1","/y.jsonl",1, Date.now()-7*86400000,   5, 100, 50, "m", "idle", 0, 5);
    recomputeSessionHealth("a"); recomputeSessionHealth("b");
    recomputeProjectHealth("p1");
    const a = db.prepare("SELECT hp FROM pet_health WHERE target_id='a'").get() as any;
    const b = db.prepare("SELECT hp FROM pet_health WHERE target_id='b'").get() as any;
    const p = db.prepare("SELECT hp FROM pet_health WHERE target_id='p1'").get() as any;
    expect(p.hp).toBe(Math.max(a.hp, b.hp));
  });
});
