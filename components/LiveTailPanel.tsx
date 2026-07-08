"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: string; content: string; ts: number };

export function LiveTailPanel({ sessionId }: { sessionId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "idle">("connecting");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    // Seed with last 30 messages from history so the panel isn't blank.
    fetch(`/api/sessions/${sessionId}/messages?limit=500`)
      .then(r => r.json())
      .then((all: Msg[]) => {
        if (cancelled || !Array.isArray(all)) return;
        setMsgs(curr => curr.length > 0 ? curr : all.slice(-30));
        requestAnimationFrame(() => ref.current?.scrollTo({ top: ref.current.scrollHeight }));
      })
      .catch(() => {});

    const es = new EventSource(`/api/sessions/${sessionId}/live`);
    es.onopen = () => setStatus("idle");
    es.onerror = () => setStatus("connecting");

    const onMsg = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setMsgs(curr => [...curr, { role: d.role, content: d.content, ts: d.ts }].slice(-100));
        setStatus("live");
        setLastEventAt(Date.now());
        requestAnimationFrame(() => ref.current?.scrollTo({ top: ref.current.scrollHeight }));
      } catch { /* ignore */ }
    };
    es.addEventListener("session:msg", onMsg as any);

    return () => {
      cancelled = true;
      es.removeEventListener("session:msg", onMsg as any);
      es.close();
    };
  }, [sessionId]);

  const dot =
    status === "live" ? "bg-green-500 animate-pulse" :
    status === "idle" ? "bg-amber-400" :
                        "bg-red-400";

  return (
    <div className="border-2 border-stone-900 rounded-md bg-amber-50 p-3 h-[60vh] overflow-y-auto font-mono text-xs" ref={ref}>
      <div className="flex items-center gap-2 mb-2 sticky top-0 bg-amber-50 pb-2 border-b border-stone-300">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-stone-700">
          {status === "live"
            ? `live${lastEventAt ? ` · last event ${Math.floor((Date.now() - lastEventAt)/1000)}s ago` : ""}`
            : status === "idle"
              ? "subscribed · waiting for new turns"
              : "connecting..."}
        </span>
        <span className="text-stone-500">· seeded with last 30 messages</span>
      </div>
      {msgs.length === 0 && <div className="text-stone-500">no messages yet</div>}
      {msgs.map((m, i) => (
        <div key={i} className="border-b border-stone-200 py-1">
          <span className="font-bold">{m.role}</span>
          <span className="text-stone-500" suppressHydrationWarning> · {new Date(m.ts).toLocaleTimeString()}</span>
          <pre className="whitespace-pre-wrap">{m.content}</pre>
        </div>
      ))}
    </div>
  );
}
