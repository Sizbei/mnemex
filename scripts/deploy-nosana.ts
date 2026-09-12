import { loadConfig } from "../src/config.js";

const { nosana } = loadConfig();

const headers = {
  Authorization: `Bearer ${nosana.apiKey}`,
  "Content-Type": "application/json",
};

// vllm/vllm-openai is on the 3070 market's image allowlist; text-embeddings-inference is not.
// --task embed exposes the OpenAI-compatible /v1/embeddings route. The flag is deprecated in
// v0.10.2 in favour of --runner pooling, but still functional, and for a native pooling model
// such as bge it preserves the model's own CLS-and-normalize pooler.
const jobDefinition = {
  version: "0.1",
  type: "container",
  ops: [
    {
      type: "container/run",
      id: "embed",
      args: {
        image: "docker.io/vllm/vllm-openai:v0.10.2",
        cmd: [
          "--model", "BAAI/bge-base-en-v1.5",
          "--task", "embed",
          "--served-model-name", "embed",
          "--port", "8000",
        ],
        gpu: true,
        // A health check makes endpoints[].online reflect reality rather than optimism.
        expose: [
          {
            port: 8000,
            health_checks: [
              { type: "http", path: "/v1/models", method: "GET", expected_status: 200, continuous: true },
            ],
          },
        ],
      },
    },
  ],
};

// Minutes. Ten hours at the 3070 rate is roughly $0.73 including the 10% network fee,
// which leaves budget for a retry. Credits stay reserved until the deployment is stopped.
const TIMEOUT_MINUTES = 600;

const create = await fetch(`${nosana.apiUrl}/deployments/create`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    name: "mnemex-embeddings",
    market: nosana.market,
    job_definition: jobDefinition,
    timeout: TIMEOUT_MINUTES,
    replicas: 1,
    strategy: "SIMPLE",
    // Must be explicit. The API defaults this to true, and a confidential deployment
    // expects the job definition to reach the host over an encrypted peer-to-peer
    // channel from a local client rather than via IPFS. Created through the REST API
    // there is no such client, and POST /start dies with an unhandled 500 whose body
    // is only {"error":"Internal Server Error"}.
    confidential: false,
  }),
});

if (!create.ok) throw new Error(`create failed: ${create.status} ${await create.text()}`);
const deployment = (await create.json()) as { id: string };
console.log("created:", deployment.id);

const start = await fetch(`${nosana.apiUrl}/deployments/${deployment.id}/start`, { method: "POST", headers });
if (!start.ok) throw new Error(`start failed: ${start.status} ${await start.text()}`);
console.log("started, polling for an endpoint...");

// The vllm-openai image is roughly 10 GB and the node also pulls the bge weights
// from Hugging Face. Cold start regularly exceeds ten minutes, so poll for forty.
const DEADLINE_MS = 40 * 60 * 1000;
const started = Date.now();

try {
  while (Date.now() - started < DEADLINE_MS) {
    await new Promise((r) => setTimeout(r, 10_000));
    const res = await fetch(`${nosana.apiUrl}/deployments/${deployment.id}`, { headers });
    const state = (await res.json()) as {
      status: string;
      endpoints?: { opId: string; url: string; online: boolean }[];
    };

    // There is no top-level `url` field. The address lives in the endpoints array,
    // keyed by the op id from the job definition.
    const endpoint = state.endpoints?.find((e) => e.opId === "embed" && e.online);
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`  [${elapsed}s] status=${state.status} endpoint=${endpoint?.url ?? "not online yet"}`);

    if (endpoint?.url) {
      console.log(`\nSet this in .env:\nNOSANA_ENDPOINT=${endpoint.url}`);
      process.exit(0);
    }
    if (["ERROR", "STOPPED", "INSUFFICIENT_FUNDS", "ARCHIVED"].includes(state.status)) {
      throw new Error(`deployment entered terminal state ${state.status}`);
    }
  }
  throw new Error("no online endpoint within forty minutes");
} catch (err) {
  // Never leave a deployment running after a failure: reserved credits stay held.
  console.error(`\nStopping deployment ${deployment.id} so it does not keep billing.`);
  await fetch(`${nosana.apiUrl}/deployments/${deployment.id}/stop`, { method: "POST", headers }).catch(() => {});
  throw err;
}
