import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
import { openTerminal, openUrl } from "@/lib/openTerminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const t = getDb().prepare(`
    SELECT t.*, p.cwd AS pcwd FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?
  `).get(params.id) as any;
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });

  let cfg: any = {};
  try { cfg = JSON.parse(t.config); } catch { /* leave empty */ }

  if (t.kind === "open_url") {
    if (!cfg.url) return NextResponse.json({ error: "config.url missing" }, { status: 400 });
    const r = openUrl(cfg.url);
    return r.ok
      ? NextResponse.json({ ok: true, kind: t.kind, url: cfg.url })
      : NextResponse.json({ error: r.error ?? "spawn failed" }, { status: 500 });
  }

  if (t.kind === "run_command") {
    if (!cfg.command) return NextResponse.json({ error: "config.command missing" }, { status: 400 });
    const r = openTerminal({ cwd: t.pcwd, command: cfg.command, keepOpen: cfg.keep_open !== false });
    return r.ok
      ? NextResponse.json({ ok: true, kind: t.kind, cwd: t.pcwd, command: cfg.command })
      : NextResponse.json({ error: r.error ?? "spawn failed" }, { status: 500 });
  }

  if (t.kind === "tail_log") {
    return NextResponse.json({ ok: true, kind: t.kind, message: "open the inline tail viewer from the UI" });
  }

  return NextResponse.json({ error: `unknown kind ${t.kind}` }, { status: 400 });
}
