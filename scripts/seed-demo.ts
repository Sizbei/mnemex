import { remember } from "../src/tools/remember.js";
import { runQuery, closeDriver } from "../src/graph/driver.js";
import { FIXTURE } from "../tests/fixtures/conversation.js";

const reset = process.argv.includes("--reset");
if (reset) {
  await runQuery("MATCH (n) WHERE n.testRun = 'demo' DETACH DELETE n");
  console.log("cleared previous demo data\n");
}

for (const turn of FIXTURE) {
  const result = await remember({ ...turn, testRun: "demo" });
  const flags = result.degraded.length ? `  [${result.degraded.join(", ")}]` : "";
  const stance = turn.decision ? ` (${turn.decision.stance})` : "";
  console.log(`${turn.speaker}${stance}: ${turn.claims[0]}${flags}`);
}

await closeDriver();
console.log(`\nSeeded ${FIXTURE.length} turns across 2 sessions.`);
