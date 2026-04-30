import { NextResponse } from "next/server";
import { ensureBoot } from "@/lib/singletons";
import { runWatcher } from "@/lib/scheduler/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  await runWatcher(parseInt(params.id, 10));
  return NextResponse.json({ ok: true });
}
