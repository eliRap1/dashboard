"use client";
import { useEffect, useState } from "react";

export function WatcherList() {
  const [items, setItems] = useState<any[]>([]);
  const refresh = () => fetch("/api/watchers").then(r => r.json()).then(setItems);
  useEffect(() => { refresh(); }, []);
  async function runNow(id: number) { await fetch(`/api/watchers/${id}/run`, { method: "POST" }); refresh(); }
  async function toggle(w: any)     {
    await fetch(`/api/watchers/${w.id}`, { method: "PATCH", headers: {"content-type":"application/json"},
      body: JSON.stringify({ enabled: w.enabled ? 0 : 1 }) });
    refresh();
  }
  async function remove(id: number) { if (!confirm("delete watcher?")) return; await fetch(`/api/watchers/${id}`, { method: "DELETE" }); refresh(); }
  return (
    <ul className="grid gap-2">
      {items.map(w => (
        <li key={w.id} className="border-2 border-stone-900 rounded-md p-3 bg-white flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${w.enabled ? "bg-green-500" : "bg-stone-400"}`} />
          <div className="flex-1">
            <div className="font-bold">{w.name} <span className="text-stone-500 text-xs">[{w.scope}{w.target_id ? `:${w.target_id}` : ""}]</span></div>
            <div className="text-xs text-stone-600">{w.trigger_kind} · {w.trigger_value}</div>
            <div className="text-xs">{w.prompt}</div>
          </div>
          <a href={`/watchers/${w.id}`} className="border px-2 py-1 text-xs underline">View</a>
          <button onClick={() => runNow(w.id)} className="border px-2 py-1 text-xs">Run</button>
          <button onClick={() => toggle(w)}    className="border px-2 py-1 text-xs">{w.enabled ? "Disable" : "Enable"}</button>
          <button onClick={() => remove(w.id)} className="border px-2 py-1 text-xs">Delete</button>
        </li>
      ))}
    </ul>
  );
}
