"use client";
import Link from "next/link";

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

export function PetCard({ pet }: { pet: Pet }) {
  const hp = pet.hp ?? 0;
  return (
    <Link href={pet.href} className={`tama-card ${pet.active ? "tama-card-active" : ""}`}>
      <div className={`tama-screen ${screenBg(pet.hp)}`}>
        <div className="tama-face">{pet.face ?? "(?_?)"}</div>
        <div className="tama-mood">{moodText(pet.hp)}</div>
      </div>
      <div className="tama-name">{pet.name}</div>
      {pet.subline && <div className="text-[10px] font-mono text-stone-700">{pet.subline}</div>}
      <div className="tama-bar"><div className={`tama-bar-fill ${barColor(pet.hp)}`} style={{ width: `${hp}%` }} /></div>
      <div className="tama-stats"><span>HP {hp}</span><span>{relTime(pet.lastMsgAt)}</span></div>
    </Link>
  );
}
