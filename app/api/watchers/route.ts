import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
import { registerCronWatcher, isValidCronExpression } from "@/lib/scheduler/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await ensureBoot();
  return NextResponse.json(
    getDb().prepare("SELECT * FROM watchers ORDER BY id DESC").all().map((r: any) => ({ ...r }))
  );
}
export async function POST(req: Request) {
  await ensureBoot();
  const body = await req.json();
  const required = ["scope", "name", "prompt", "trigger_kind", "trigger_value"];
  for (const k of required) if (!body[k]) return NextResponse.json({ error: `missing ${k}` }, { status: 400 });
  if (body.trigger_kind === "cron" && !isValidCronExpression(body.trigger_value)) {
    return NextResponse.json({ error: `invalid cron expression: ${body.trigger_value}` }, { status: 400 });
  }
  const id = (getDb().prepare(`INSERT INTO watchers(scope,target_id,name,prompt,trigger_kind,trigger_value,enabled,notify_webhook,created_at)
                               VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(body.scope, body.target_id ?? null, body.name, body.prompt, body.trigger_kind, body.trigger_value,
         body.enabled === false ? 0 : 1, body.notify_webhook ?? null, Date.now()).lastInsertRowid) as number;
  const w = getDb().prepare("SELECT * FROM watchers WHERE id=?").get(id) as any;
  registerCronWatcher(w);
  return NextResponse.json({ ...w });
}
