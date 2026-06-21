"use client";
import { useState } from "react";

type Hit = { session_id: string; role: string; snippet: string; ts: number };

/**
 * Sanitize an FTS snippet so that only <mark> tags survive.
 * The snippet text comes from user-controlled JSONL content and may contain
 * arbitrary HTML — escaping everything first, then restoring the safe
 * placeholder tokens prevents XSS while still highlighting matches.
 */
function sanitizeSnippet(raw: string): string {
  const MARK_OPEN  = "\x00MO\x00";
  const MARK_CLOSE = "\x00MC\x00";
  // Swap the sentinel markers out before escaping
  const swapped = raw
    .replace(/<mark>/g,  MARK_OPEN)
    .replace(/<\/mark>/g, MARK_CLOSE);
  // Escape all remaining HTML
  const escaped = swapped
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  // Restore <mark> tags
  return escaped
    .replace(/\x00MO\x00/g,  "<mark>")
    .replace(/\x00MC\x00/g, "</mark>");
}

export function SearchBar() {
  const [q, setQ]       = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [err, setErr]   = useState<string | null>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? "search failed"); return; }
    setHits(j);
  }
  return (
    <div>
      <form onSubmit={go} className="flex gap-2 mb-4">
        <input className="border p-2 flex-1" value={q} onChange={e => setQ(e.target.value)} placeholder="search messages..." />
        <button className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200">Go</button>
      </form>
      {err && <div className="text-red-600 text-sm mb-2">{err}</div>}
      <ul className="space-y-2">
        {hits.map((h, i) => (
          <li key={i} className="border-2 border-stone-900 rounded-md p-3 bg-white">
            <div className="text-xs text-stone-500">{new Date(h.ts).toLocaleString()} - {h.role}</div>
            <a className="underline text-sm" href={`/s/${h.session_id}`}>session {h.session_id.slice(0, 8)}</a>
            <div className="font-mono text-xs mt-1" dangerouslySetInnerHTML={{ __html: sanitizeSnippet(h.snippet) }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
