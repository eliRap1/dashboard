"use client";
import { useState } from "react";

const PRESETS: Record<string, string> = {
  "Summarize new commits": "Look at git log since the last watcher run; summarize changes in 2 sentences. Reply ok unless something is broken.",
  "Check for failed tests": "Run the project's test command and report any failures. Reply alert if any test fails.",
  "Flag stuck tasks":       "Review ~/.claude/todos/ and ~/.claude/plans/. Reply alert if any item has been in_progress > 24h with no movement."
};

export function WatcherForm({ onCreated }: { onCreated: (w: any) => void }) {
  const [scope, setScope]                 = useState("project");
  const [targetId, setTargetId]           = useState("");
  const [name, setName]                   = useState("");
  const [prompt, setPrompt]               = useState("");
  const [trigger_kind, setKind]           = useState<"cron" | "event">("cron");
  const [trigger_value, setVal]           = useState("0 */30 * * *");
  const [enabled, setEnabled]             = useState(true);
  const [notify_webhook, setHook]         = useState("");

  return (
    <form onSubmit={async e => {
      e.preventDefault();
      const r = await fetch("/api/watchers", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, target_id: targetId || null, name, prompt, trigger_kind, trigger_value, enabled, notify_webhook: notify_webhook || null })
      });
      onCreated(await r.json());
    }} className="grid gap-2 border-2 border-stone-900 rounded-md p-3 bg-amber-50">
      <div className="grid grid-cols-3 gap-2">
        <select value={scope} onChange={e => setScope(e.target.value)} className="border p-1">
          <option value="project">project</option>
          <option value="session">session</option>
          <option value="global">global</option>
        </select>
        <input value={targetId} onChange={e => setTargetId(e.target.value)} placeholder="target id (project/session)" className="border p-1 col-span-2" />
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="watcher name" className="border p-1" required />
      <select onChange={e => { if (PRESETS[e.target.value]) setPrompt(PRESETS[e.target.value]); }} className="border p-1">
        <option value="">— preset —</option>
        {Object.keys(PRESETS).map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="prompt (free text)" className="border p-1 min-h-[80px]" required />
      <div className="grid grid-cols-2 gap-2">
        <select value={trigger_kind} onChange={e => setKind(e.target.value as any)} className="border p-1">
          <option value="cron">cron</option>
          <option value="event">event</option>
        </select>
        {trigger_kind === "cron" ? (
          <select value={trigger_value} onChange={e => setVal(e.target.value)} className="border p-1">
            <option value="*/15 * * * *">every 15m</option>
            <option value="*/30 * * * *">every 30m</option>
            <option value="0 * * * *">every 1h</option>
            <option value="0 */6 * * *">every 6h</option>
            <option value="0 9 * * *">daily 09:00</option>
          </select>
        ) : (
          <select value={trigger_value} onChange={e => setVal(e.target.value)} className="border p-1">
            <option value="on:session_new">on:session_new</option>
            <option value="on:session_msg">on:session_msg</option>
            <option value="on:error">on:error</option>
            <option value="on:plan_change">on:plan_change</option>
            <option value="on:todo_change">on:todo_change</option>
          </select>
        )}
      </div>
      <input value={notify_webhook} onChange={e => setHook(e.target.value)} placeholder="webhook URL (optional)" className="border p-1" />
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />enabled</label>
      <button className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200">Create watcher</button>
    </form>
  );
}
