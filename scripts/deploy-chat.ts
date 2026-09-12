import { loadConfig } from "../src/config.js";

const { nosana } = loadConfig();

const headers = {
  Authorization: `Bearer ${nosana.apiKey}`,
  "Content-Type": "application/json",
};

// NOSANA_MARKET points at the embedding deployment's market, which is an 8 GB 3070 and
// cannot hold a 7B model. Chat needs its own market, chosen under two constraints:
//   1. required_images must allowlist vllm-openai:v0.10.2, and
//   2. GET /nodes/queued-nodes must show an idle node, or the job merely queues.
// The 24 GB markets named in the plan (3090, a5000, 4090, a40) all had zero idle nodes,
// so a6000 is the cheapest market that had one. Its 48 GB is more than a 7B model needs,
// but an idle node beats a cheaper queue.
const CHAT_MARKET = "EjryZ6XEthz3z7nnLfjXBYafyn7VyHgChfbfM47LfAao"; // nvidia-a6000, 48 GB, $0.3636/hr

// Qwen2.5-7B-Instruct ships a Hermes-style tool-use chat template, so `hermes` is the
// parser vLLM documents for Qwen/Qwen2.5-*. Auto tool choice is off by default: without
// --enable-auto-tool-choice the server ignores the `tools` array and answers in prose.
// Weights are ~15 GB in bf16; at 0.90 utilisation of the a6000's 48 GB that leaves ample
// room for a 16k KV cache, which is enough for a tool-calling chat turn plus recalled
// memories.
const jobDefinition = {
  version: "0.1",
  type: "container",
  ops: [
    {
      type: "container/run",
      id: "chat",
      args: {
        image: "docker.io/vllm/vllm-openai:v0.10.2",
        cmd: [
          "--model", "Qwen/Qwen2.5-7B-Instruct",
          "--served-model-name", "chat",
          "--enable-auto-tool-choice",
          "--tool-call-parser", "hermes",
          "--max-model-len", "16384",
          "--gpu-memory-utilization", "0.90",
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

// Minutes. Ten hours at the a6000 rate is roughly $4.00 including the 10% network fee.
// Credits stay reserved until the deployment is stopped.
const TIMEOUT_MINUTES = 600;

const create = await fetch(`${nosana.apiUrl}/deployments/create`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    name: "mnemex-chat",
    market: CHAT_MARKET,
    job_definition: jobDefinition,
    timeout: TIMEOUT_MINUTES,
    replicas: 1,
    strategy: "SIMPLE",
    // Start at create time. POST /deployments/{id}/start answers 500
    // {"error":"Internal Server Error"} on a DRAFT the API itself accepted, with no event
    // recorded against the deployment, and a DRAFT that fails to start can be neither
    // stopped nor archived. autostart takes the same deployment straight to STARTING.
    autostart: true,
    // Must be explicit. The API defaults this to true, and a confidential deployment
    // expects the job definition to reach the host over an encrypted peer-to-peer
    // channel from a local client rather than via IPFS. Created through the REST API
    // there is no such client, and the deployment never starts.
    confidential: false,
  }),
});

if (!create.ok) throw new Error(`create failed: ${create.status} ${await create.text()}`);
const deployment = (await create.json()) as { id: string };
console.log("created:", deployment.id);
console.log("starting, polling for a live model...");

// The vllm-openai image is roughly 10 GB and the node also pulls ~15 GB of Qwen2.5-7B
// weights from Hugging Face, so allow considerably longer than the embedding deployment.
const DEADLINE_MS = 45 * 60 * 1000;
const started = Date.now();

try {
  while (Date.now() - started < DEADLINE_MS) {
    await new Promise((r) => setTimeout(r, 10_000));
    const res = await fetch(`${nosana.apiUrl}/deployments/${deployment.id}`, { headers });
    const state = (await res.json()) as {
      status: string;
      endpoints?: { opId: string; url: string; online: boolean }[];
    };

    // There is no top-level `url` field. The address lives in the endpoints array, keyed
    // by the op id from the job definition. The url is assigned at DRAFT creation and
    // `online` stays false on deployments that are demonstrably serving, so neither field
    // is a readiness signal. Probe the server itself instead.
    const url = state.endpoints?.find((e) => e.opId === "chat")?.url;
    const ready = url ? await fetch(`${url}/v1/models`).then((r) => r.ok).catch(() => false) : false;
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`  [${elapsed}s] status=${state.status} /v1/models=${ready ? "200" : "not up yet"}`);

    if (ready) {
      console.log(`\nSet this in .env:\nNOSANA_CHAT_ENDPOINT=${url}`);
      process.exit(0);
    }
    if (["ERROR", "STOPPED", "INSUFFICIENT_FUNDS", "ARCHIVED"].includes(state.status)) {
      throw new Error(`deployment entered terminal state ${state.status}`);
    }
  }
  throw new Error("model did not answer /v1/models within forty-five minutes");
} catch (err) {
  // Never leave a deployment running after a failure: reserved credits stay held.
  console.error(`\nStopping deployment ${deployment.id} so it does not keep billing.`);
  await fetch(`${nosana.apiUrl}/deployments/${deployment.id}/stop`, { method: "POST", headers }).catch(() => {});
  throw err;
}
