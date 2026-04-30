import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Db = DatabaseSync;

let _db: Db | null = null;

export function getDb(): Db {
  if (_db) return _db;
  const dataDir = path.resolve(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.DASHBOARD_DB ?? path.join(dataDir, "dashboard.db");
  _db = new DatabaseSync(dbPath);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  runMigrations(_db);
  return _db;
}

function runMigrations(db: Db) {
  const sqlPath = path.resolve(process.cwd(), "lib/migrations/001_init.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");
  db.exec(sql);
}

/** Run fn inside a transaction. Rolls back on throw. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}

export function _resetDbForTests() {
  try { _db?.close(); } catch {}
  _db = null;
}
