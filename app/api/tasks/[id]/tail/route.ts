import { NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import chokidar from "chokidar";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
import { assertUnderClaudeHome } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TAIL_BYTES = 100_000;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const t = getDb().prepare("SELECT * FROM project_tasks WHERE id=?").get(params.id) as any;
  if (!t || t.kind !== "tail_log") {
    return NextResponse.json({ error: "task not a tail_log" }, { status: 400 });
  }
  let cfg: any = {};
  try { cfg = JSON.parse(t.config); } catch { /* empty */ }
  const file: string = cfg.file_path;
  if (!file) return NextResponse.json({ error: "config.file_path missing" }, { status: 400 });
  try { assertUnderClaudeHome(file); } catch {
    return NextResponse.json({ error: "file_path must be inside claude home" }, { status: 403 });
  }

  const enc = new TextEncoder();
  let offset = 0;
  try {
    const st = await fsp.stat(file);
    offset = Math.max(0, st.size - MAX_TAIL_BYTES);
  } catch { offset = 0; }

  const stream = new ReadableStream({
    async start(controller) {
      const sendChunk = (text: string) => controller.enqueue(enc.encode(`event: chunk\ndata: ${JSON.stringify(text)}\n\n`));
      const sendErr   = (msg: string)  => controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify(msg)}\n\n`));

      // initial read of tail
      try {
        const buf = await fsp.readFile(file, "utf8");
        const initial = buf.length > MAX_TAIL_BYTES ? buf.slice(-MAX_TAIL_BYTES) : buf;
        sendChunk(initial);
        const st = await fsp.stat(file);
        offset = st.size;
      } catch (e: any) { sendErr(`could not read ${file}: ${e?.message ?? e}`); }

      const watcher = chokidar.watch(file, { persistent: true, ignoreInitial: true });
      const onChange = async () => {
        try {
          const st = await fsp.stat(file);
          if (st.size < offset) { offset = 0; }
          if (st.size === offset) return;
          const fd = await fsp.open(file, "r");
          const len = st.size - offset;
          const b = Buffer.allocUnsafe(len);
          await fd.read(b, 0, len, offset);
          await fd.close();
          offset = st.size;
          sendChunk(b.toString("utf8"));
        } catch (e: any) { sendErr(String(e)); }
      };
      watcher.on("change", onChange);
      watcher.on("add",    onChange);

      const ka = setInterval(() => controller.enqueue(enc.encode(": ka\n\n")), 15000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ka);
        watcher.close().catch(() => {});
        try { controller.close(); } catch { /* ignore */ }
      });
    }
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "connection": "keep-alive" }
  });
}
