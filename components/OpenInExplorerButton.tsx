"use client";
import { useState } from "react";

export function OpenInExplorerButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);
  async function open() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/explorer`, { method: "POST" });
      const j = await r.json();
      setMsg(r.ok ? `opened: ${j.cwd}` : `error: ${j.error ?? r.status}`);
    } catch (e: any) {
      setMsg(`error: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={open} disabled={busy}
        className="border-2 border-stone-900 rounded-md px-3 py-1 bg-sky-200 disabled:opacity-50 text-sm font-bold">
        {busy ? "opening..." : "Open in File Explorer"}
      </button>
      {msg && <span className="text-xs text-stone-700">{msg}</span>}
    </span>
  );
}
