"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegenerateSummaryButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function regen() {
    setBusy(true); setMsg("running claude -p... (~30s)");
    try {
      const r = await fetch(`/api/sessions/${sessionId}/summarize`, { method: "POST" });
      const j = await r.json();
      if (r.ok) { setMsg("done"); router.refresh(); }
      else      { setMsg(`error: ${j.error ?? r.status}`); }
    } catch (e: any) {
      setMsg(`error: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 5000);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={regen} disabled={busy}
        className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200 disabled:opacity-50 text-sm font-bold">
        {busy ? "regenerating..." : "Regenerate summary"}
      </button>
      {msg && <span className="text-xs text-stone-700">{msg}</span>}
    </span>
  );
}
