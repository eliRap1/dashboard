import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  await ensureBoot();
  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "100", 10), 500);
  return NextResponse.json(
    getDb().prepare("SELECT * FROM feed ORDER BY ts DESC LIMIT ?").all(limit).map((r: any) => ({ ...r }))
  );
}
