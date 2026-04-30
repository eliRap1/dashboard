import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = new Set([
  "health_weights","concurrency_caps","quota_threshold","project_hp_strategy",
  "notify_webhook","obsidian_vault_path"
]);

export async function GET() {
  await ensureBoot();
  const rows = getDb().prepare("SELECT key,value FROM settings").all() as any[];
  return NextResponse.json(Object.fromEntries(rows.map((r: any) => [r.key, r.value])));
}
export async function PATCH(req: Request) {
  await ensureBoot();
  const body = await req.json();
  const stmt = getDb().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED.has(k)) return NextResponse.json({ error: `unknown key ${k}` }, { status: 400 });
    stmt.run(k, String(v));
  }
  return NextResponse.json({ ok: true });
}
