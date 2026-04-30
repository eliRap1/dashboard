import { ensureBoot } from "@/lib/singletons";
import { bus } from "@/lib/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const fn = (d: any) => {
        if (d?.sessionId === params.id) {
          controller.enqueue(enc.encode(`event: session:msg\ndata: ${JSON.stringify(d)}\n\n`));
        }
      };
      bus.on("session:msg", fn);
      const ka = setInterval(() => controller.enqueue(enc.encode(": ka\n\n")), 15000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ka);
        bus.off("session:msg", fn);
        try { controller.close(); } catch { /* ignore */ }
      });
    }
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "connection": "keep-alive" }
  });
}
