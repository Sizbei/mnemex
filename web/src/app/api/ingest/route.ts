import { NextResponse } from "next/server";
import { extractTurns } from "../../../../../dist/src/ingest/extract.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Extracts only. Writing is a separate, explicit step after the user has reviewed. */
export async function POST(request: Request) {
  const { transcript } = (await request.json()) as { transcript?: string };
  if (!transcript?.trim()) {
    return NextResponse.json({ ok: false, error: "Paste or upload a transcript first." }, { status: 400 });
  }

  const endpoint = (process.env.NOSANA_CHAT_ENDPOINT ?? "").trim();
  if (!endpoint) {
    return NextResponse.json(
      { ok: false, error: "No chat model is configured, so a transcript cannot be read. Set NOSANA_CHAT_ENDPOINT." },
      { status: 503 },
    );
  }

  const started = Date.now();
  try {
    const result = await extractTurns(transcript, {
      endpoint,
      model: (process.env.NOSANA_CHAT_MODEL ?? "").trim() || "chat",
    });
    return NextResponse.json({ ok: true, latencyMs: Date.now() - started, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
