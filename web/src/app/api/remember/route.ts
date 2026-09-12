import { NextResponse } from "next/server";
import { remember } from "../../../../../dist/src/tools/remember.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json();
  const started = Date.now();
  try {
    const result = await remember({ ...body, testRun: "demo" });
    return NextResponse.json({ ok: true, latencyMs: Date.now() - started, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 400 });
  }
}
