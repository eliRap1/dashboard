import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
import { openFolder } from "@/lib/openTerminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const row = getDb().prepare("SELECT cwd FROM projects WHERE id=?").get(params.id) as any;
  if (!row?.cwd) return NextResponse.json({ error: "not found" }, { status: 404 });
  const r = openFolder(row.cwd);
  if (!r.ok) return NextResponse.json({ error: r.error ?? "spawn failed" }, { status: 500 });
  return NextResponse.json({ ok: true, cwd: row.cwd });
}
