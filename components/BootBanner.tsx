"use client";
import { useEffect, useState } from "react";

export function BootBanner() {
  const [s, setS] = useState<{ claude_ok: boolean } | null>(null);
  useEffect(() => { fetch("/api/health").then(r => r.json()).then(setS); }, []);
  if (!s || s.claude_ok) return null;
  return (
    <div className="bg-red-200 border-b-4 border-red-700 text-red-900 px-4 py-2 text-sm">
      ⚠ <strong>claude</strong> CLI not on PATH. Watcher runs and summaries are disabled until you install Claude Code or set <code>CLAUDE_BIN</code>.
    </div>
  );
}
