"use client";
import { useState } from "react";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// FTS5 snippet() places <mark>...</mark> around matched terms. The surrounding
// text is NOT HTML-escaped by SQLite, so we must escape it ourselves and then
// restore the known-safe <mark> tags.
function safeSnippet(raw: string): string {
  const OPEN = "\x00MARK_OPEN\x00";
  const CLOSE = "\x00MARK_CLOSE\x00";
  const withPlaceholders = raw.replace(/<mark>/g, OPEN).replace(/<\/mark>/g, CLOSE);
  const escaped = escapeHtml(withPlaceholders);
  return escaped.replace(new RegExp(OPEN, "g"), "<mark>").replace(new RegExp(CLOSE, "g"), "</mark>");
}

type Hit = { session_id: string; role: string; snippet: string; ts: number };

export function SearchBar() {
  const [q, setQ]       = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    setHits(await r.json());
  }
  return (
    <div>
      <form onSubmit={go} className="flex gap-2 mb-4">
        <input className="border p-2 flex-1" value={q} onChange={e => setQ(e.target.value)} placeholder="search messages..." />
        <button className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200">Go</button>
      </form>
      <ul className="space-y-2">
        {hits.map((h, i) => (
          <li key={i} className="border-2 border-stone-900 rounded-md p-3 bg-white">
            <div className="text-xs text-stone-500">{new Date(h.ts).toLocaleString()} - {h.role}</div>
            <a className="underline text-sm" href={`/s/${h.session_id}`}>session {h.session_id.slice(0, 8)}</a>
            <div className="font-mono text-xs mt-1" dangerouslySetInnerHTML={{ __html: safeSnippet(h.snippet) }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
