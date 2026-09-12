/**
 * Turn a raw conversation transcript into structured turns, for review, then import.
 *
 * Extraction is the least reliable part of this system, which is why it does NOT write to
 * the graph by default. It prints what it extracted and saves a JSON file you can read,
 * correct by hand, and then load with `npm run import`. Pass --write to skip the review
 * step once you trust a given transcript.
 *
 *   npm run ingest -- transcripts/standup.txt
 *   npm run ingest -- transcripts/standup.txt --out conversations/standup.json
 *   npm run ingest -- transcripts/standup.txt --write --tag demo
 *
 * The transcript is chopped into batches of lines rather than sent whole, because the chat
 * model holds 16k tokens and a real meeting transcript will not fit.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, basename, extname } from "node:path";
import { z } from "zod";
import { loadConfig } from "../src/config.js";

const Turn = z.object({
  speaker: z.string().min(1),
  claims: z.array(z.string().min(1)).min(1),
  topic: z.string().optional(),
  decision: z
    .object({ statement: z.string().min(1), stance: z.enum(["supports", "disagrees", "proposes"]) })
    .optional(),
});
type Turn = z.infer<typeof Turn>;

const argv = process.argv.slice(2);

// Walk the list once. Indexing back from a flag's position wraps to -1 when the flag is
// absent, which silently swallowed the positional argument.
const VALUE_FLAGS = new Set(["--out", "--tag", "--session"]);
const flags: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (VALUE_FLAGS.has(a)) { flags[a] = argv[i + 1] ?? ""; i += 1; }
  else if (a.startsWith("--")) flags[a] = "true";
  else positional.push(a);
}

const path = positional[0];
const flag = (name: string) => flags[name] || undefined;
const write = flags["--write"] === "true";
const tag = flag("--tag") ?? "demo";
const sessionId = flag("--session") ?? `t_${Date.now().toString(36)}`;

if (!path) {
  console.error("usage: npm run ingest -- <transcript.txt> [--out file.json] [--write] [--session id] [--tag name]");
  process.exit(1);
}

const outPath = flag("--out") ?? `conversations/${basename(path, extname(path))}.json`;
const { nosana } = loadConfig();
const chatEndpoint = (process.env.NOSANA_CHAT_ENDPOINT ?? "").trim();
if (!chatEndpoint) {
  console.error("NOSANA_CHAT_ENDPOINT is not set. Extraction needs the chat model; deploy it with npm run deploy:chat.");
  process.exit(1);
}
void nosana;

const SYSTEM = [
  "You extract structured memory from a meeting transcript. Return ONLY a JSON array, no prose.",
  "",
  "Each element is one thing a person said:",
  '{"speaker": "Name", "claims": ["what they said, in their own words"], "topic": "short subject",',
  ' "decision": {"statement": "the outcome being discussed", "stance": "supports|disagrees|proposes"}}',
  "",
  "Rules.",
  "claims: one short sentence each, quoting their actual argument. Never longer than 40 words.",
  "topic: two or three words, the same string for every turn about the same subject.",
  "decision: include ONLY when the speaker took a position on an outcome. Omit it otherwise.",
  "stance: proposes when they put the outcome forward or reverse an earlier one, disagrees when",
  "they object to it, supports when they back it.",
  "Use the same decision statement string for every speaker discussing that same outcome.",
  "Skip greetings, scheduling and small talk. Extract nothing rather than invent anything.",
].join("\n");

/** Batch by lines: a real transcript will not fit in the model's 16k window. */
function batches(text: string, linesPerBatch = 40): string[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerBatch) out.push(lines.slice(i, i + linesPerBatch).join("\n"));
  return out;
}

/** Models wrap JSON in prose or fences no matter how firmly you ask them not to. */
function extractJsonArray(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error(`no JSON array in model output: ${text.slice(0, 160)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}

const url = chatEndpoint.replace(/\/+$/, "").endsWith("/v1")
  ? `${chatEndpoint.replace(/\/+$/, "")}/chat/completions`
  : `${chatEndpoint.replace(/\/+$/, "")}/v1/chat/completions`;

const transcript = await readFile(path, "utf8");
const parts = batches(transcript);
console.log(`${path}: ${transcript.split("\n").filter((l) => l.trim()).length} lines in ${parts.length} batch(es)\n`);

const turns: Turn[] = [];
for (const [i, part] of parts.entries()) {
  process.stdout.write(`  batch ${i + 1}/${parts.length} `);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.NOSANA_CHAT_MODEL?.trim() || "chat",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: part },
      ],
      temperature: 0,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    console.log(`failed: ${res.status}`);
    continue;
  }
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  let raw: unknown;
  try {
    raw = extractJsonArray(body.choices[0].message.content);
  } catch (err) {
    console.log(`unparseable: ${String(err).slice(0, 80)}`);
    continue;
  }
  const parsed = z.array(Turn).safeParse(raw);
  if (!parsed.success) {
    // Salvage the valid elements. One malformed turn should not lose the whole batch.
    const salvaged = (Array.isArray(raw) ? raw : []).flatMap((t) => {
      const one = Turn.safeParse(t);
      return one.success ? [one.data] : [];
    });
    console.log(`${salvaged.length} turn(s), ${(raw as unknown[]).length - salvaged.length} rejected`);
    turns.push(...salvaged);
    continue;
  }
  console.log(`${parsed.data.length} turn(s)`);
  turns.push(...parsed.data);
}

if (!turns.length) {
  console.error("\nNothing extracted. Check the transcript has identifiable speakers and real decisions.");
  process.exit(1);
}

const withSession = turns.map((t) => ({ ...t, sessionId, sessionTitle: basename(path, extname(path)) }));

console.log(`\nExtracted ${withSession.length} turns:\n`);
for (const t of withSession) {
  const stance = t.decision ? `  →  ${t.decision.stance} "${t.decision.statement}"` : "";
  console.log(`  ${t.speaker} [${t.topic ?? "no topic"}]: ${t.claims[0].slice(0, 60)}${stance}`);
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(withSession, null, 2)}\n`);
console.log(`\nSaved to ${outPath}`);

if (!write) {
  console.log("\nNothing was written to the graph. Extraction is the least reliable part of this");
  console.log("system, so read the file, fix anything wrong, then load it:");
  console.log(`  npm run import -- ${outPath}`);
  process.exit(0);
}

const { remember } = await import("../src/tools/remember.js");
const { closeDriver } = await import("../src/graph/driver.js");
for (const turn of withSession) await remember({ ...turn, testRun: tag });
await closeDriver();
console.log(`\nWrote ${withSession.length} turns to the graph, tagged "${tag}".`);
