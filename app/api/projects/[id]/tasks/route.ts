import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const rows = getDb()
    .prepare("SELECT * FROM project_tasks WHERE project_id=? ORDER BY id ASC")
    .all(params.id)
    .map((r: any) => ({ ...r }));
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const body = await req.json();
  if (!body.name || !body.kind || !body.config) {
    return NextResponse.json({ error: "missing name/kind/config" }, { status: 400 });
  }
  if (!["open_url", "run_command", "tail_log"].includes(body.kind)) {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }
  const cfg = typeof body.config === "string" ? body.config : JSON.stringify(body.config);
  const id = (getDb()
    .prepare(`INSERT INTO project_tasks(project_id,name,kind,config,created_at) VALUES (?,?,?,?,?)`)
    .run(params.id, body.name, body.kind, cfg, Date.now()).lastInsertRowid) as number;
  const row = getDb().prepare("SELECT * FROM project_tasks WHERE id=?").get(id) as any;
  return NextResponse.json({ ...row });
}
