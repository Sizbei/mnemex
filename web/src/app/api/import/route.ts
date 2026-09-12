import { NextResponse } from "next/server";
import { remember, type RememberInput } from "../../../../../dist/src/tools/remember.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Writes turns the user has already seen and approved. */
export async function POST(request: Request) {
  const { turns, sessionTitle } = (await request.json()) as {
    turns?: Omit<RememberInput, "sessionId" | "sessionTitle" | "testRun">[];
    sessionTitle?: string;
  };
  if (!turns?.length) {
    return NextResponse.json({ ok: false, error: "No turns to import." }, { status: 400 });
  }

  const sessionId = `up_${Date.now().toString(36)}`;
  const degraded = new Set<string>();
  const decisionIds = new Set<string>();
  let claims = 0;

  try {
    for (const turn of turns) {
      const result = await remember({
        ...turn,
        sessionId,
        sessionTitle: sessionTitle || "Uploaded transcript",
        testRun: "demo",
      });
      claims += result.claimIds.length;
      if (result.decisionId) decisionIds.add(result.decisionId);
      for (const d of result.degraded) degraded.add(d);
    }
    return NextResponse.json({
      ok: true,
      sessionId,
      turns: turns.length,
      claims,
      decisions: decisionIds.size,
      degraded: [...degraded],
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
