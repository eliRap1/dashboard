import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const body = await req.json();
  const cols = ["name", "kind", "config"].filter(c => c in body);
  if (cols.length === 0) return NextResponse.json({ error: "no fields" }, { status: 400 });
  const sql = `UPDATE project_tasks SET ${cols.map(c => `${c}=?`).join(",")} WHERE id=?`;
  const args = cols.map(c => c === "config" && typeof body.config !== "string" ? JSON.stringify(body.config) : body[c]);
  getDb().prepare(sql).run(...args, params.id);
  const row = getDb().prepare("SELECT * FROM project_tasks WHERE id=?").get(params.id) as any;
  return NextResponse.json({ ...row });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  getDb().prepare("DELETE FROM project_tasks WHERE id=?").run(params.id);
  return NextResponse.json({ ok: true });
}
