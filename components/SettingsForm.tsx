"use client";
import { useEffect, useState } from "react";

export function SettingsForm() {
  const [s, setS] = useState<Record<string, string>>({});
  useEffect(() => { fetch("/api/settings").then(r => r.json()).then(setS); }, []);
  function set(k: string, v: string) { setS(curr => ({ ...curr, [k]: v })); }
  async function save() {
    const r = await fetch("/api/settings", {
      method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify(s)
    });
    alert(r.ok ? "saved" : `error: ${await r.text()}`);
  }
  return (
    <div className="grid gap-3 max-w-xl">
      <label className="grid">
        <span className="text-sm font-bold">Obsidian vault path</span>
        <input className="border p-2" value={s.obsidian_vault_path ?? ""} onChange={e => set("obsidian_vault_path", e.target.value)} placeholder="C:\Users\me\Obsidian" />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Notify webhook (Discord/Slack URL)</span>
        <input className="border p-2" value={s.notify_webhook ?? ""} onChange={e => set("notify_webhook", e.target.value)} />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Health weights (JSON)</span>
        <input className="border p-2 font-mono text-xs" value={s.health_weights ?? ""} onChange={e => set("health_weights", e.target.value)} />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Concurrency caps (JSON)</span>
        <input className="border p-2 font-mono text-xs" value={s.concurrency_caps ?? ""} onChange={e => set("concurrency_caps", e.target.value)} />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Quota threshold (tokens)</span>
        <input className="border p-2" value={s.quota_threshold ?? ""} onChange={e => set("quota_threshold", e.target.value)} />
      </label>
      <label className="grid">
        <span className="text-sm font-bold">Project HP strategy</span>
        <select className="border p-2" value={s.project_hp_strategy ?? "max"} onChange={e => set("project_hp_strategy", e.target.value)}>
          <option value="max">max</option>
          <option value="avg">avg</option>
        </select>
      </label>
      <button onClick={save} className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200">Save</button>
    </div>
  );
}
