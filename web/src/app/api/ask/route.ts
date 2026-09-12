import { NextResponse } from "next/server";
import { recall } from "../../../../../dist/src/tools/recall.js";
import { timeline } from "../../../../../dist/src/tools/timeline.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { question, topic } = (await request.json()) as { question: string; topic?: string };
  if (!question?.trim()) {
    return NextResponse.json({ ok: false, error: "question is required" }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await recall({ question });
    const history = topic?.trim() ? await timeline({ topic }) : { entries: [] };
    return NextResponse.json({
      ok: true,
      question,
      latencyMs: Date.now() - started,
      degraded: result.degraded,
      decisions: result.decisions,
      timeline: history.entries,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
