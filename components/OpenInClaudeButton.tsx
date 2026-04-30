"use client";
import { useState } from "react";

type Props = { kind: "project" | "session"; id: string; label?: string };

export function OpenInClaudeButton({ kind, id, label }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);
  async function open() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/${kind === "project" ? "projects" : "sessions"}/${id}/open`, { method: "POST" });
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
        className="border-2 border-stone-900 rounded-md px-3 py-1 bg-emerald-200 disabled:opacity-50 text-sm font-bold">
        {busy ? "opening..." : (label ?? "Open in Claude Code")}
      </button>
      {msg && <span className="text-xs text-stone-700">{msg}</span>}
    </span>
  );
}
