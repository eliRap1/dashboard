"use client";
import { useEffect, useRef, useState } from "react";

export function LiveTailPanel({ sessionId }: { sessionId: string }) {
  const [msgs, setMsgs] = useState<{ role: string; content: string; ts: number }[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const es = new EventSource(`/api/sessions/${sessionId}/live`);
    const onMsg = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setMsgs(curr => [...curr, { role: d.role, content: d.content, ts: d.ts }].slice(-50));
        requestAnimationFrame(() => ref.current?.scrollTo({ top: ref.current.scrollHeight }));
      } catch { /* ignore */ }
    };
    es.addEventListener("session:msg", onMsg as any);
    return () => { es.removeEventListener("session:msg", onMsg as any); es.close(); };
  }, [sessionId]);
  return (
    <div className="border-2 border-stone-900 rounded-md bg-amber-50 p-3 h-[60vh] overflow-y-auto font-mono text-xs" ref={ref}>
      <div className="text-stone-600 mb-2">Live tail (last 50 messages while session is active)</div>
      {msgs.map((m, i) => (
        <div key={i} className="border-b border-stone-200 py-1">
          <span className="font-bold">{m.role}</span>
          <pre className="whitespace-pre-wrap">{m.content}</pre>
        </div>
      ))}
    </div>
  );
}
