/**
 * Bulk-load conversation turns into graph memory from a JSON file.
 *
 * This is not extraction. The file supplies the same structure the `remember` tool takes,
 * and every turn goes through that tool, so an imported graph is indistinguishable from one
 * built by an assistant during a conversation. Deriving that structure from raw prose is an
 * explicit non-goal; a person or a model writes the file.
 *
 *   npm run import -- conversations/pricing.json
 *   npm run import -- conversations/pricing.json --tag demo --reset
 *
 * --tag  marks every node written, so it can be removed again. Default "demo".
 * --reset deletes everything carrying that tag first.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { remember } from "../src/tools/remember.js";
import { runQuery, closeDriver } from "../src/graph/driver.js";

const Turn = z.object({
  sessionId: z.string().min(1),
  sessionTitle: z.string().optional(),
  speaker: z.string().min(1),
  claims: z.array(z.string().min(1)).min(1),
  topic: z.string().optional(),
  decision: z
    .object({ statement: z.string().min(1), stance: z.enum(["supports", "disagrees", "proposes"]) })
    .optional(),
});
const File = z.array(Turn).min(1);

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
const tag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : "demo";
const reset = args.includes("--reset");

if (!path) {
  console.error("usage: npm run import -- <file.json> [--tag <name>] [--reset]");
  process.exit(1);
}

const parsed = File.safeParse(JSON.parse(await readFile(path, "utf8")));
if (!parsed.success) {
  console.error(`${path} does not match the turn schema:`);
  for (const issue of parsed.error.issues) {
    console.error(`  [${issue.path.join(".")}] ${issue.message}`);
  }
  process.exit(1);
}
const turns = parsed.data;

// Claims are embedded whole and both providers cap at 512 tokens, so a long claim would be
// silently truncated into a vector that no longer matches its own text. Refuse instead.
const MAX_WORDS = 300;
const tooLong = turns.flatMap((t, i) =>
  t.claims.filter((c) => c.split(/\s+/).length > MAX_WORDS).map((c) => ({ i, c })),
);
if (tooLong.length) {
  console.error(`${tooLong.length} claim(s) exceed ${MAX_WORDS} words and would be truncated when embedded:`);
  for (const { i, c } of tooLong) console.error(`  turn ${i}: ${c.slice(0, 70)}…`);
  console.error("Split them into separate claims. One claim should be one thing somebody said.");
  process.exit(1);
}

if (reset) {
  const [{ n }] = await runQuery<{ n: number }>(
    "MATCH (x) WHERE x.testRun = $tag RETURN count(x) AS n", { tag },
  );
  await runQuery("MATCH (x) WHERE x.testRun = $tag DETACH DELETE x", { tag });
  console.log(`cleared ${n} nodes tagged "${tag}"\n`);
}

let claims = 0, merged = 0;
// Several turns reference the same decision, so count distinct ids rather than calls.
const decisionIds = new Set<string>();
const degradedSeen = new Set<string>();

for (const [i, turn] of turns.entries()) {
  const result = await remember({ ...turn, testRun: tag });
  claims += result.claimIds.length;
  merged += result.merged.claims;
  if (result.decisionId) decisionIds.add(result.decisionId);
  for (const d of result.degraded) degradedSeen.add(d);
  const stance = turn.decision ? ` (${turn.decision.stance})` : "";
  console.log(`${String(i + 1).padStart(3)}. ${turn.speaker}${stance}: ${turn.claims[0].slice(0, 64)}`);
}

await closeDriver();
console.log(
  `\n${turns.length} turns imported. ${claims} claims, ${decisionIds.size} distinct decisions, ${merged} duplicate claims merged.`,
);
console.log(`degraded: ${degradedSeen.size ? [...degradedSeen].join(", ") : "none"}`);
console.log(`Remove again with: npm run import -- ${path} --tag ${tag} --reset`);
