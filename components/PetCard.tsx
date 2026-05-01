"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export type Pet = {
  scope: "project" | "session";
  id: string;
  name: string;
  hp: number | null;
  face: string | null;
  lastMsgAt: number | null;
  active: boolean;
  href: string;
  subline?: string;
};

function relTime(ms: number | null): string {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function RelTime({ ms }: { ms: number | null }) {
  const [text, setText] = useState<string>("—");
  useEffect(() => {
    const tick = () => setText(relTime(ms));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [ms]);
  return <span suppressHydrationWarning>{text}</span>;
}

function moodText(hp: number | null): string {
  if (hp == null) return "no data";
  if (hp >= 80) return "working hard";
  if (hp >= 50) return "on watch";
  if (hp >= 25) return "zzz";
  return "help me!";
}
function screenBg(hp: number | null): string {
  if (hp == null) return "bg-stone-300";
  if (hp >= 80) return "bg-green-300";
  if (hp >= 50) return "bg-emerald-200";
  if (hp >= 25) return "bg-stone-300";
  return "bg-red-300";
}
function barColor(hp: number | null): string {
  if (hp == null) return "bg-stone-400";
  if (hp >= 50) return "bg-green-500";
  if (hp >= 25) return "bg-stone-500";
  return "bg-red-500";
}

async function postAction(url: string, label: string) {
  try {
    const r = await fetch(url, { method: "POST" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`${label}: error ${j.error ?? r.status}`);
    }
  } catch (e: any) {
    alert(`${label}: ${e?.message ?? e}`);
  }
}

function QuickActions({ pet }: { pet: Pet }) {
  // Stop click propagation so the pet card link doesn't fire.
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  if (pet.scope === "project") {
    return (
      <div className="absolute top-1 right-1 flex gap-1 z-10">
        <button title="Open folder"
          onClick={e => { stop(e); postAction(`/api/projects/${pet.id}/explorer`, "Open folder"); }}
          className="bg-sky-200 hover:bg-sky-300 border border-stone-900 rounded px-1 text-[11px] leading-none py-0.5 font-mono">📁</button>
        <button title="Open in Claude Code"
          onClick={e => { stop(e); postAction(`/api/projects/${pet.id}/open`, "Open in Claude"); }}
          className="bg-emerald-200 hover:bg-emerald-300 border border-stone-900 rounded px-1 text-[11px] leading-none py-0.5 font-mono">⚡</button>
      </div>
    );
  }
  // session scope
  return (
    <div className="absolute top-1 right-1 flex gap-1 z-10">
      <button title="Resume in Claude Code"
        onClick={e => { stop(e); postAction(`/api/sessions/${pet.id}/open`, "Resume"); }}
        className="bg-emerald-200 hover:bg-emerald-300 border border-stone-900 rounded px-1 text-[11px] leading-none py-0.5 font-mono">⚡</button>
    </div>
  );
}

export function PetCard({ pet }: { pet: Pet }) {
  const hp = pet.hp ?? 0;
  return (
    <div className="relative">
      <QuickActions pet={pet} />
      <Link href={pet.href} className={`tama-card ${pet.active ? "tama-card-active" : ""}`}>
        <div className={`tama-screen ${screenBg(pet.hp)}`}>
          <div className="tama-face">{pet.face ?? "(?_?)"}</div>
          <div className="tama-mood">{moodText(pet.hp)}</div>
        </div>
        <div className="tama-name">{pet.name}</div>
        {pet.subline && <div className="text-[10px] font-mono text-stone-700">{pet.subline}</div>}
        <div className="tama-bar"><div className={`tama-bar-fill ${barColor(pet.hp)}`} style={{ width: `${hp}%` }} /></div>
        <div className="tama-stats"><span>HP {hp}</span><RelTime ms={pet.lastMsgAt} /></div>
      </Link>
    </div>
  );
}
