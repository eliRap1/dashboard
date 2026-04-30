import { NextResponse } from "next/server";
import { ensureBoot } from "@/lib/singletons";
import { summarizeSession } from "@/lib/ai/summarize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  await summarizeSession(params.id);
  return NextResponse.json({ ok: true });
}
