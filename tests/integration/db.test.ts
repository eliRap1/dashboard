import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getDb, _resetDbForTests, tx } from "@/lib/db";

describe("db", () => {
  afterEach(() => { _resetDbForTests(); });

  it("creates db file and migrates schema", () => {
    const tmp = path.join(process.cwd(), "data/test-db-1.db");
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    process.env.DASHBOARD_DB = tmp;
    const db = getDb();
    const row = db.prepare("SELECT version FROM schema_version").get() as any;
    expect(row.version).toBe(1);
    expect(fs.existsSync(tmp)).toBe(true);
    db.close();
    fs.unlinkSync(tmp);
    delete process.env.DASHBOARD_DB;
  });

  it("seeds default settings", () => {
    const tmp = path.join(process.cwd(), "data/test-db-2.db");
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    process.env.DASHBOARD_DB = tmp;
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key='quota_threshold'").get() as any;
    expect(row.value).toBe("5000000");
    db.close();
    fs.unlinkSync(tmp);
    delete process.env.DASHBOARD_DB;
  });

  it("tx() commits on success and rolls back on throw", () => {
    const tmp = path.join(process.cwd(), "data/test-db-3.db");
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    process.env.DASHBOARD_DB = tmp;
    const db = getDb();
    db.exec("CREATE TABLE t (a INTEGER)");
    tx(db, () => { db.prepare("INSERT INTO t VALUES (1)").run(); });
    expect((db.prepare("SELECT count(*) c FROM t").get() as any).c).toBe(1);

    expect(() => tx(db, () => {
      db.prepare("INSERT INTO t VALUES (2)").run();
      throw new Error("boom");
    })).toThrow("boom");
    expect((db.prepare("SELECT count(*) c FROM t").get() as any).c).toBe(1);
    db.close();
    fs.unlinkSync(tmp);
    delete process.env.DASHBOARD_DB;
  });
});
