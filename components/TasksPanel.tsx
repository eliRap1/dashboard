"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Task = { id: number; project_id: string; name: string; kind: string; config: string; created_at: number };

function parseCfg(s: string): any { try { return JSON.parse(s); } catch { return {}; } }

type Stats = { count: number; wins: number; losses: number; pnl: number; lastEvent?: any };

function emptyStats(): Stats { return { count: 0, wins: 0, losses: 0, pnl: 0 }; }

function aggregateLine(s: Stats, raw: string): Stats {
  const trimmed = raw.trim();
  if (!trimmed) return s;
  let obj: any;
  try { obj = JSON.parse(trimmed); } catch { return s; }
  s.count += 1;
  s.lastEvent = obj;
  // Heuristic field detection
  let win: number | null = null;
  if (typeof obj.win === "number")  win = obj.win;
  else if (typeof obj.wins === "number") win = obj.wins;
  else if (obj.outcome === "win" || obj.result === "win") win = 1;
  let loss: number | null = null;
  if (typeof obj.loss === "number") loss = obj.loss;
  else if (typeof obj.losses === "number") loss = obj.losses;
  else if (obj.outcome === "loss" || obj.result === "loss") loss = 1;
  if (win  != null) s.wins   += win;
  if (loss != null) s.losses += loss;
  const pnl = obj.pnl ?? obj.profit ?? obj.delta ?? obj.amount;
  if (typeof pnl === "number") s.pnl += pnl;
  return s;
}

function StatsCard({ stats }: { stats: Stats }) {
  const winRate = stats.count > 0 && (stats.wins + stats.losses) > 0
    ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
    : null;
  const pnlColor = stats.pnl > 0 ? "text-green-600" : stats.pnl < 0 ? "text-red-600" : "text-stone-700";
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
      <div className="border-2 border-stone-900 rounded-md p-2 bg-white">
        <div className="text-[10px] uppercase tracking-wider text-stone-500">events</div>
        <div className="text-xl font-bold font-mono">{stats.count}</div>
      </div>
      <div className="border-2 border-stone-900 rounded-md p-2 bg-white">
        <div className="text-[10px] uppercase tracking-wider text-stone-500">w / l</div>
        <div className="text-xl font-bold font-mono">
          <span className="text-green-600">{stats.wins}</span>
          <span className="text-stone-400"> / </span>
          <span className="text-red-600">{stats.losses}</span>
        </div>
      </div>
      <div className="border-2 border-stone-900 rounded-md p-2 bg-white">
        <div className="text-[10px] uppercase tracking-wider text-stone-500">win rate</div>
        <div className="text-xl font-bold font-mono">{winRate == null ? "—" : `${winRate}%`}</div>
      </div>
      <div className="border-2 border-stone-900 rounded-md p-2 bg-white">
        <div className="text-[10px] uppercase tracking-wider text-stone-500">total pnl</div>
        <div className={`text-xl font-bold font-mono ${pnlColor}`}>{stats.pnl.toFixed(2)}</div>
      </div>
    </div>
  );
}

function TailViewer({ taskId, jsonl }: { taskId: number; jsonl: boolean }) {
  const [text, setText] = useState("");
  const [stats, setStats] = useState<Stats>(emptyStats());
  const ref = useRef<HTMLDivElement>(null);
  // Buffer for partial lines when computing stats
  const tailBuf = useRef<string>("");

  useEffect(() => {
    setText(""); setStats(emptyStats()); tailBuf.current = "";
    const es = new EventSource(`/api/tasks/${taskId}/tail`);
    const onChunk = (e: MessageEvent) => {
      try {
        const piece = JSON.parse(e.data);
        setText(t => (t + piece).slice(-120_000));
        if (jsonl) {
          tailBuf.current += piece;
          const lines = tailBuf.current.split(/\r?\n/);
          tailBuf.current = lines.pop() ?? "";
          if (lines.length > 0) {
            setStats(prev => {
              const next = { ...prev };
              for (const ln of lines) aggregateLine(next, ln);
              return next;
            });
          }
        }
        requestAnimationFrame(() => ref.current?.scrollTo({ top: ref.current.scrollHeight }));
      } catch { /* ignore */ }
    };
    const onErr = (e: MessageEvent) => { setText(t => t + `\n[error: ${e.data}]\n`); };
    es.addEventListener("chunk", onChunk as any);
    es.addEventListener("error", onErr as any);
    return () => { es.removeEventListener("chunk", onChunk as any); es.removeEventListener("error", onErr as any); es.close(); };
  }, [taskId, jsonl]);

  return (
    <div>
      {jsonl && <StatsCard stats={stats} />}
      <div ref={ref} className="border-2 border-stone-900 rounded-md bg-black text-green-300 p-3 max-h-72 overflow-y-auto font-mono text-xs whitespace-pre-wrap">
        {text || "(waiting for log content...)"}
      </div>
    </div>
  );
}

export function TasksPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Task[]>([]);
  const [adding, setAdding] = useState(false);
  const [openedTail, setOpenedTail] = useState<number | null>(null);

  const refresh = () => fetch(`/api/projects/${projectId}/tasks`).then(r => r.json()).then(setItems);
  useEffect(() => { refresh(); }, [projectId]);

  async function run(t: Task) {
    if (t.kind === "tail_log") { setOpenedTail(openedTail === t.id ? null : t.id); return; }
    const r = await fetch(`/api/tasks/${t.id}/run`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) alert(`error: ${j.error ?? r.status}`);
  }
  async function remove(id: number) {
    if (!confirm("delete task?")) return;
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <section className="my-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold">Tasks</h2>
        <button onClick={() => setAdding(a => !a)}
          className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200 text-sm">
          {adding ? "Cancel" : "+ Add task"}
        </button>
      </div>

      {adding && <TaskForm projectId={projectId} onDone={() => { setAdding(false); refresh(); }} />}

      <ul className="grid gap-2 mt-2">
        {items.length === 0 && <li className="text-stone-500 text-sm">No tasks yet.</li>}
        {items.map(t => {
          const cfg = parseCfg(t.config);
          const isJsonl = t.kind === "tail_log" && cfg.format === "jsonl";
          return (
            <li key={t.id} className="border-2 border-stone-900 rounded-md p-3 bg-white">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-bold">{t.name} <span className="text-stone-500 text-xs">[{t.kind}{isJsonl ? " · jsonl" : ""}]</span></div>
                  <div className="text-xs text-stone-600 font-mono break-all">
                    {t.kind === "open_url"    && cfg.url}
                    {t.kind === "run_command" && cfg.command}
                    {t.kind === "tail_log"    && cfg.file_path}
                  </div>
                </div>
                <button onClick={() => run(t)} className="border-2 border-stone-900 rounded-md px-3 py-1 bg-emerald-200 text-sm font-bold">
                  {t.kind === "open_url" ? "Open" : t.kind === "run_command" ? "Run" : (openedTail === t.id ? "Hide" : "Tail")}
                </button>
                <button onClick={() => remove(t.id)} className="border px-2 py-1 text-xs">Delete</button>
              </div>
              {openedTail === t.id && t.kind === "tail_log" && (
                <div className="mt-3"><TailViewer taskId={t.id} jsonl={isJsonl} /></div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TaskForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"open_url" | "run_command" | "tail_log">("run_command");
  const [url,  setUrl]  = useState("");
  const [cmd,  setCmd]  = useState("");
  const [keepOpen, setKeepOpen] = useState(true);
  const [filePath, setFilePath] = useState("");
  const [format,   setFormat]   = useState<"text" | "jsonl">("text");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let config: any = {};
    if (kind === "open_url")    config = { url };
    if (kind === "run_command") config = { command: cmd, keep_open: keepOpen };
    if (kind === "tail_log")    config = { file_path: filePath, format };
    const r = await fetch(`/api/projects/${projectId}/tasks`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, kind, config })
    });
    if (!r.ok) { alert(`error: ${(await r.json()).error}`); return; }
    onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-2 border-2 border-stone-900 rounded-md p-3 bg-amber-50">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Task name (e.g. 'Open chromecuts site')" className="border p-1" required />
      <select value={kind} onChange={e => setKind(e.target.value as any)} className="border p-1">
        <option value="run_command">run_command (open terminal, run command)</option>
        <option value="open_url">open_url (open URL in browser)</option>
        <option value="tail_log">tail_log (live-tail a file in the UI)</option>
      </select>
      {kind === "open_url" && (
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://localhost:3000/" className="border p-1" required />
      )}
      {kind === "run_command" && (
        <>
          <input value={cmd} onChange={e => setCmd(e.target.value)} placeholder="npm run dev   (cwd is project root)" className="border p-1" required />
          <label className="flex gap-2 text-xs">
            <input type="checkbox" checked={keepOpen} onChange={e => setKeepOpen(e.target.checked)} />
            keep terminal open after command finishes
          </label>
        </>
      )}
      {kind === "tail_log" && (
        <>
          <input value={filePath} onChange={e => setFilePath(e.target.value)} placeholder={`D:\\path\\to\\bot.log`} className="border p-1 font-mono text-xs" required />
          <label className="flex gap-2 text-xs items-center">
            format:
            <select value={format} onChange={e => setFormat(e.target.value as any)} className="border p-0.5">
              <option value="text">text (raw)</option>
              <option value="jsonl">jsonl (parse each line; show w/l/pnl counters)</option>
            </select>
          </label>
        </>
      )}
      <button className="border-2 border-stone-900 rounded-md px-3 py-1 bg-amber-200 text-sm font-bold">Create</button>
    </form>
  );
}
