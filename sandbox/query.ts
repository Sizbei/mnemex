// Executed inside a Daytona sandbox. Issues exactly one read-only HTTPS call to the
// Neo4j Query API and prints the resulting rows as JSON.
//
// It speaks HTTPS rather than Bolt on purpose: only ports 80 and 443 egress a Daytona
// sandbox, so port 7687 is unreachable and `neo4j-driver` cannot connect from here.
// It is not installed in the sandbox either. The built-in fetch is all we need.
//
// Deliberately dependency-free so it can be shipped as a single self-contained script.
declare const __MNEMEX_QUERY__: string;

const ERROR_MARKER = "MNEMEX_QUERY_ERROR:";

async function main() {
  const input = JSON.parse(__MNEMEX_QUERY__);

  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${input.auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    // accessMode READ is the actual guarantee. Neo4j enforces it server-side and
    // answers a write with Neo.ClientError.Statement.AccessMode. The regex on the
    // host only approximates the same rule cheaply, before a sandbox is spent.
    body: JSON.stringify({
      statement: input.statement,
      parameters: input.parameters,
      accessMode: "READ",
    }),
  });

  const payload: any = await response.json();
  if (payload.errors?.length) {
    const detail = payload.errors
      .map((e: any) => [e.code, e.message ?? e.error].filter(Boolean).join(" "))
      .join("; ");
    throw new Error(detail || `Neo4j returned HTTP ${response.status}`);
  }

  const fields: string[] = payload.data?.fields ?? [];
  const values: unknown[][] = payload.data?.values ?? [];
  const rows = values.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
  console.log(JSON.stringify(rows));
}

// Errors from Neo4j itself are the caller's fault, not the sandbox's. Mark them so the
// host can surface them instead of reporting the tool as disabled.
main().catch((err: unknown) => {
  console.error(`${ERROR_MARKER} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
