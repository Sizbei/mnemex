// Each vector call is wrapped in an aggregating subquery. A bare
// db.index.vector.queryNodes that yields zero rows collapses the whole pipeline
// to zero rows, so on an empty graph the caller would destructure undefined.
// This shape returns [[], [], []] instead, which is what the first remember() needs.
export const FETCH_CANDIDATES = `
MATCH (p:Person) WITH collect({id: p.id, name: p.name}) AS people
CALL () {
  CALL db.index.vector.queryNodes('claim_embedding', 25, $probe) YIELD node AS c
  RETURN collect({id: c.id, text: c.text, embedding: c.embedding}) AS claims
}
CALL () {
  CALL db.index.vector.queryNodes('decision_embedding', 25, $probe) YIELD node AS d
  OPTIONAL MATCH (d)-[:ABOUT]->(dt:Topic)
  WITH d, collect(dt.id) AS topicIds
  RETURN collect({id: d.id, text: d.statement, embedding: d.embedding, topicIds: topicIds}) AS decisions
}
RETURN people, claims, decisions`;

export const APPLY_PLAN = `
MERGE (s:Session {id: $sessionId})
  ON CREATE SET s.title = $sessionTitle, s.startedAt = datetime(), s.testRun = $testRun

WITH s
CALL (s) {
  WITH s
  OPTIONAL MATCH (existing:Person {id: $personId})
  WITH s, existing
  FOREACH (_ IN CASE WHEN existing IS NULL THEN [1] ELSE [] END |
    CREATE (np:Person {id: $newPersonId, name: $speaker, testRun: $testRun}))
  RETURN 1 AS done
}
WITH s
MATCH (p:Person {id: coalesce($personId, $newPersonId)})
MERGE (p)-[:PARTICIPATED_IN]->(s)

WITH s, p
FOREACH (t IN CASE WHEN $topic IS NULL THEN [] ELSE [$topic] END |
  MERGE (topic:Topic {id: $topicId})
    ON CREATE SET topic.name = t, topic.slug = $topicSlug, topic.testRun = $testRun)

WITH s, p
UNWIND $newClaims AS nc
CREATE (c:Claim {id: nc.id, text: nc.text, embedding: nc.embedding, saidAt: datetime(), testRun: $testRun})
CREATE (c)-[:STATED_BY]->(p)
CREATE (c)-[:IN_SESSION]->(s)
FOREACH (_ IN CASE WHEN $topicId IS NULL THEN [] ELSE [1] END |
  MERGE (tp:Topic {id: $topicId}) MERGE (c)-[:ABOUT]->(tp))
RETURN collect(c.id) AS created`;

export const UPSERT_DECISION = `
MATCH (s:Session {id: $sessionId})
MERGE (d:Decision {id: $decisionId})
  ON CREATE SET d.statement = $statement, d.embedding = $embedding, d.status = 'current',
                d.decidedAt = datetime(), d.testRun = $testRun
MERGE (d)-[:DECIDED_IN]->(s)
WITH d
FOREACH (_ IN CASE WHEN $topicId IS NULL THEN [] ELSE [1] END |
  MERGE (tp:Topic {id: $topicId}) MERGE (d)-[:ABOUT]->(tp))
WITH d
CALL (d) {
  WITH d
  OPTIONAL MATCH (old:Decision {id: $supersedesId})
  FOREACH (o IN CASE WHEN old IS NULL THEN [] ELSE [old] END |
    MERGE (d)-[:SUPERSEDES]->(o) SET o.status = 'superseded')
  RETURN 1 AS done
}
RETURN d.id AS id`;

export const LINK_STANCE = `
MATCH (d:Decision {id: $decisionId})
UNWIND $claimIds AS cid
MATCH (c:Claim {id: cid})
CALL (c, d) {
  WITH c, d
  FOREACH (_ IN CASE WHEN $stance = 'disagrees' THEN [1] ELSE [] END | MERGE (c)-[:DISAGREES_WITH]->(d))
  FOREACH (_ IN CASE WHEN $stance <> 'disagrees' THEN [1] ELSE [] END | MERGE (c)-[:SUPPORTS]->(d))
  RETURN 1 AS done
}
RETURN count(*) AS linked`;

export const RECALL_TRAVERSAL = `
CALL db.index.vector.queryNodes('decision_embedding', $topK, $probe) YIELD node AS seed
WITH collect(seed) AS seeds
CALL db.index.vector.queryNodes('claim_embedding', $topK, $probe) YIELD node AS sc
OPTIONAL MATCH (sc)-[:SUPPORTS|DISAGREES_WITH]->(viaClaim:Decision)
WITH seeds, collect(viaClaim) AS viaClaims
UNWIND (seeds + viaClaims) AS d
WITH DISTINCT d
WHERE d IS NOT NULL

OPTIONAL MATCH (d)-[:SUPERSEDES*1..3]->(older:Decision)
OPTIONAL MATCH (newer:Decision)-[:SUPERSEDES*1..3]->(d)
OPTIONAL MATCH (c:Claim)-[r:SUPPORTS|DISAGREES_WITH]->(d)
OPTIONAL MATCH (c)-[:STATED_BY]->(p:Person)

RETURN d.id AS id,
       d.statement AS statement,
       coalesce(d.status, 'open') AS status,
       collect(DISTINCT older.statement) AS supersedes,
       collect(DISTINCT newer.statement) AS supersededBy,
       collect(DISTINCT CASE WHEN c IS NULL THEN NULL ELSE
         {person: p.name, stance: type(r), claim: c.text} END) AS positions`;

export const TIMELINE_BY_TOPIC = `
MATCH (d:Decision)-[:ABOUT]->(t:Topic {slug: $slug})
OPTIONAL MATCH (d)-[:SUPERSEDES]->(prev:Decision)
OPTIONAL MATCH (c:Claim)-[:DISAGREES_WITH]->(d)
OPTIONAL MATCH (c)-[:STATED_BY]->(p:Person)
// Aggregate and sort in a WITH. A RETURN containing collect() cannot ORDER BY a
// variable declared before it, and sorting the stringified date would be
// lexicographic and fragile across UTC offsets.
WITH d, prev, collect(DISTINCT p.name) AS dissenters
ORDER BY d.decidedAt ASC
RETURN d.statement AS statement,
       coalesce(d.status, 'open') AS status,
       toString(d.decidedAt) AS decidedAt,
       prev.statement AS supersedes,
       dissenters`;
