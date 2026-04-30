import { ensureBoot } from "@/lib/singletons";
import { bus } from "@/lib/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVENTS = [
  "session:new","session:msg","session:error",
  "live:change","live:gone",
  "watcher:done","watcher:alert","feed:new","health:change"
];

export async function GET(req: Request) {
  await ensureBoot();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: any) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const subs: Array<[string, (d: any) => void]> = [];
      for (const e of EVENTS) {
        const fn = (d: any) => send(e, d);
        bus.on(e, fn);
        subs.push([e, fn]);
      }
      const ka = setInterval(() => controller.enqueue(enc.encode(": ka\n\n")), 15000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ka);
        for (const [e, fn] of subs) bus.off(e, fn);
        try { controller.close(); } catch { /* ignore */ }
      });
    }
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "connection": "keep-alive" }
  });
}
