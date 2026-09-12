import { loadConfig } from "../config.js";

const dims = loadConfig().embeddingDimensions;

export const SCHEMA_STATEMENTS: string[] = [
  "CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE",
  "CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.id IS UNIQUE",
  "CREATE CONSTRAINT session_id IF NOT EXISTS FOR (s:Session) REQUIRE s.id IS UNIQUE",
  "CREATE CONSTRAINT claim_id IF NOT EXISTS FOR (c:Claim) REQUIRE c.id IS UNIQUE",
  "CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE",
  "CREATE INDEX topic_slug IF NOT EXISTS FOR (t:Topic) ON (t.slug)",
  `CREATE VECTOR INDEX claim_embedding IF NOT EXISTS
   FOR (c:Claim) ON (c.embedding)
   OPTIONS { indexConfig: {
     \`vector.dimensions\`: ${dims},
     \`vector.similarity_function\`: 'cosine'
   }}`,
  `CREATE VECTOR INDEX decision_embedding IF NOT EXISTS
   FOR (d:Decision) ON (d.embedding)
   OPTIONS { indexConfig: {
     \`vector.dimensions\`: ${dims},
     \`vector.similarity_function\`: 'cosine'
   }}`,
];
