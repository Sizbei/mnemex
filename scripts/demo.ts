import { recall } from "../src/tools/recall.js";
import { timeline } from "../src/tools/timeline.js";
import { runQuery, closeDriver } from "../src/graph/driver.js";

const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m";
const G = "\x1b[32m", Y = "\x1b[33m", C = "\x1b[36m";
const rule = (t: string) => console.log(`\n${B}${C}${t}${R}\n${D}${"-".repeat(72)}${R}`);

rule("1. WHAT IS IN THE GRAPH");
const [counts] = await runQuery<Record<string, number>>(`
  MATCH (p:Person) WITH count(p) AS people
  MATCH (c:Claim) WITH people, count(c) AS claims
  MATCH (d:Decision) WITH people, claims, count(d) AS decisions
  MATCH ()-[r:DISAGREES_WITH]->() WITH people, claims, decisions, count(r) AS dissent
  MATCH ()-[s:SUPERSEDES]->() RETURN people, claims, decisions, dissent, count(s) AS supersessions`);
console.log(`  people ${counts.people}   claims ${counts.claims}   decisions ${counts.decisions}` +
  `   dissent edges ${counts.dissent}   supersessions ${counts.supersessions}`);

const question = "what did we decide about the storage engine, and who disagreed?";
rule("2. THE QUESTION FLAT VECTOR SEARCH CANNOT ANSWER");
console.log(`  ${D}"${question}"${R}`);

const t0 = Date.now();
const result = await recall({ question });
const ms = Date.now() - t0;

rule("3. WHAT MNEMEX RETURNS");
for (const d of result.decisions) {
  const badge = d.status === "current" ? `${G}CURRENT${R}` : `${Y}${d.status.toUpperCase()}${R}`;
  console.log(`\n  [${badge}] ${B}${d.statement}${R}`);
  if (d.supersedes.length) console.log(`      ${D}overrules:${R} ${d.supersedes.join("; ")}`);
  if (d.supersededBy.length) console.log(`      ${D}overruled by:${R} ${d.supersededBy.join("; ")}`);
  for (const p of d.positions) {
    const mark = p.stance === "DISAGREES_WITH" ? `${Y}objected${R}` : `${G}supported${R}`;
    console.log(`      ${p.person} ${mark}: ${D}${p.claim}${R}`);
  }
}

rule("4. DECISION HISTORY FOR THE TOPIC");
const t = await timeline({ topic: "storage engine" });
for (const e of t.entries) {
  const badge = e.status === "current" ? `${G}CURRENT${R}` : `${Y}SUPERSEDED${R}`;
  console.log(`  ${e.decidedAt.slice(0, 19)}  [${badge}] ${e.statement}`);
  if (e.supersedes) console.log(`      ${D}replaced: ${e.supersedes}${R}`);
  if (e.dissenters.length) console.log(`      ${D}dissent from: ${e.dissenters.join(", ")}${R}`);
}

rule("5. HONESTY CHECK");
console.log(`  recall latency      ${ms} ms`);
console.log(`  degraded subsystems ${result.degraded.length ? result.degraded.join(", ") : "none"}`);
console.log(`  ${D}A flat vector store would return the text of these claims with no${R}`);
console.log(`  ${D}speaker attached, and no way to tell which decision still stands.${R}\n`);

await closeDriver();
