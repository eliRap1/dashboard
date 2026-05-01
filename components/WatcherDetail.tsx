"use client";
import { useEffect, useState } from "react";
import { useEventStream } from "./useEventStream";

type Watcher = {
  id: number; scope: string; target_id: string | null; name: string;
  prompt: string; trigger_kind: string; trigger_value: string;
  enabled: number; notify_webhook: string | null; created_at: number;
};
type Run = {
  id: number; watcher_id: number; started_at: number; ended_at: number | null;
  status: string | null; output: string | null; alert_msg: string | null;
};

export function WatcherDetail({ watcherId }: { watcherId: string }) {
  const [w, setW]       = useState<Watcher | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [wr, rr] = await Promise.all([
      fetch(`/api/watchers/${watcherId}`).then(r => r.json()),
      fetch(`/api/watchers/${watcherId}/runs`).then(r => r.json()),
    ]);
    if (!wr?.error) setW(wr);
    setRuns(Array.isArray(rr) ? rr : []);
  };
  useEffect(() => { refresh(); }, [watcherId]);

  // Auto-refresh on any watcher event
  useEventStream({
    "watcher:run-started": (d: any) => { if (String(d.watcherId) === watcherId) refresh(); },
    "watcher:done":        (d: any) => { if (String(d.watcherId) === watcherId) refresh(); },
    "watcher:alert":       (d: any) => { if (String(d.watcherId) === watcherId) refresh(); },
  });

  async function runNow() {
    setBusy(true);
    try { await fetch(`/api/watchers/${watcherId}/run`, { method: "POST" }); }
    finally { setBusy(false); refresh(); }
  }

  if (!w) return <main className="p-6">loading...</main>;

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <a href="/watchers" className="text-sm underline">← all watchers</a>
      <div className="flex items-center justify-between mt-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold">{w.name}</h1>
          <div className="text-xs text-stone-600">[{w.scope}{w.target_id ? `:${w.target_id}` : ""}] · {w.trigger_kind} · {w.trigger_value}</div>
        </div>
        <button onClick={runNow} disabled={busy}
          className="border-2 border-stone-900 rounded-md px-3 py-1 bg-emerald-200 text-sm font-bold disabled:opacity-50">
          {busy ? "running..." : "Run now"}
        </button>
      </div>

      <section className="bg-amber-100 border-2 border-stone-900 rounded-md p-3 mb-4">
        <div className="font-bold">Prompt</div>
        <pre className="whitespace-pre-wrap font-mono text-xs">{w.prompt}</pre>
      </section>

      <h2 className="font-bold mb-2">Run history ({runs.length})</h2>
      {runs.length === 0 && <div className="text-stone-500 text-sm">No runs yet. Click <em>Run now</em> to fire one.</div>}
      <ul className="space-y-2">
        {runs.map(r => {
          const dur = r.ended_at ? Math.round((r.ended_at - r.started_at) / 1000) : null;
          const statusColor =
            r.status === "ok"      ? "bg-green-200" :
            r.status === "alert"   ? "bg-red-200"   :
            r.status === "error"   ? "bg-orange-200":
            r.status === "running" ? "bg-blue-200 animate-pulse" :
                                     "bg-stone-200";
          return (
            <li key={r.id} className="border-2 border-stone-900 rounded-md p-3 bg-white">
              <div className="flex items-center gap-3 text-xs">
                <span className={`px-2 py-1 rounded ${statusColor} font-bold uppercase`}>{r.status ?? "?"}</span>
                <span className="text-stone-600" suppressHydrationWarning>{new Date(r.started_at).toLocaleString()}</span>
                {dur != null && <span className="text-stone-500">· {dur}s</span>}
                {r.alert_msg && <span className="text-red-700 font-bold">· {r.alert_msg}</span>}
              </div>
              {r.output && (
                <pre className="mt-2 bg-black text-green-300 p-2 rounded font-mono text-[10px] max-h-48 overflow-y-auto whitespace-pre-wrap">{r.output}</pre>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
