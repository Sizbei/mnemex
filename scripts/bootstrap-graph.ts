import { SCHEMA_STATEMENTS } from "../src/graph/schema.js";
import { runQuery, closeDriver } from "../src/graph/driver.js";

for (const statement of SCHEMA_STATEMENTS) {
  await runQuery(statement);
  console.log("applied:", statement.split("\n")[0].trim());
}
await closeDriver();
console.log(`\n${SCHEMA_STATEMENTS.length} statements applied.`);
