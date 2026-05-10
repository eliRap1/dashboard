import { NextResponse } from "next/server";
import { getDb, tx } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
import { registerCronWatcher, unregisterCron } from "@/lib/scheduler/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const w = getDb().prepare("SELECT * FROM watchers WHERE id=?").get(params.id) as any;
  if (!w) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...w });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const body = await req.json();
  const cols = ["name","prompt","trigger_kind","trigger_value","enabled","notify_webhook"].filter(c => c in body);
  if (cols.length === 0) return NextResponse.json({ error: "no fields" }, { status: 400 });
  const sql = `UPDATE watchers SET ${cols.map(c => `${c}=?`).join(",")} WHERE id=?`;
  getDb().prepare(sql).run(...cols.map(c => body[c]), params.id);
  const w = getDb().prepare("SELECT * FROM watchers WHERE id=?").get(params.id) as any;
  registerCronWatcher(w);
  return NextResponse.json({ ...w });
}
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  unregisterCron(parseInt(params.id, 10));
  const db = getDb();
  tx(db, () => {
    db.prepare("DELETE FROM watcher_runs WHERE watcher_id=?").run(params.id);
    db.prepare("DELETE FROM watchers WHERE id=?").run(params.id);
  });
  return NextResponse.json({ ok: true });
}
