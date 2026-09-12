import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Daytona, type Sandbox } from "@daytonaio/sdk";
import { config as loadDotenv } from "dotenv";

/**
 * Deploy agent-ui as one process on one port into a Daytona sandbox, and print the preview URL.
 *
 * Locally the app is two processes: Vite on 5173 proxying the agent loop on 8787. A Daytona
 * preview link exposes a single port, so the deployed copy runs only the backend, which
 * serves the Vite build itself (see agent-ui/server/static.ts).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Relative to the sandbox user's root directory, which is where sessions and uploads land. */
const REMOTE_DIR = "mnemex";
const PORT = 8787;

/** Sandbox lifetime. Long enough to demo, short enough that a forgotten sandbox is not free. */
const AUTO_STOP_MINUTES = 120;

const HEALTH_ATTEMPTS = 40;
const HEALTH_INTERVAL_MS = 3_000;

const BENCHMARK_QUESTION = "what did we decide about the storage engine, and who disagreed?";

/**
 * Only what the server actually loads. node_modules is installed from the registry inside the
 * sandbox, and .env is never uploaded: the secrets go in as environment variables at create.
 */
const PAYLOAD_PATHS = [
  // The compiled tools. agent-ui/server imports these by relative path, so the layout matters.
  "dist/src",
  "agent-ui/server",
  "agent-ui/dist",
  // Source text the merge planner ships into a sandbox. Read at call time by remember().
  "sandbox",
];

/** Forwarded verbatim from the local .env. Everything here is a secret or an endpoint. */
const FORWARDED = [
  "NEO4J_URI",
  "NEO4J_USERNAME",
  "NEO4J_PASSWORD",
  "NEO4J_DATABASE",
  "NOSANA_API_KEY",
  "NOSANA_API_URL",
  "NOSANA_MARKET",
  "NOSANA_ENDPOINT",
  "NOSANA_CHAT_ENDPOINT",
  "NOSANA_CHAT_MODEL",
  "DAYTONA_API_KEY",
  "DAYTONA_API_URL",
] as const;

function run(command: string, args: string[], cwd = REPO_ROOT): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    // A tar of a macOS checkout otherwise carries ._ AppleDouble files into a Linux box.
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
}

function hostOf(value: string, label: string): string {
  const host = new URL(value).hostname;
  if (!host) throw new Error(`cannot derive a host from ${label}: ${value}`);
  return host;
}

/**
 * The sandbox gets its own manifest rather than the repository's, because the repository's
 * devDependencies are a test runner and a compiler that nothing in the sandbox runs.
 */
async function sandboxManifest(): Promise<string> {
  const root = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const pick = (name: string, from: Record<string, string>): [string, string] => {
    const version = from[name];
    if (!version) throw new Error(`${name} is not in the root package.json`);
    return [name, version];
  };
  return `${JSON.stringify(
    {
      name: "mnemex-site",
      private: true,
      type: "module",
      dependencies: Object.fromEntries([
        // Every bare specifier dist/src resolves. @modelcontextprotocol/sdk is absent on
        // purpose: only src/server.ts imports it, and the MCP entry never loads here.
        pick("@daytonaio/sdk", root.dependencies),
        pick("dotenv", root.dependencies),
        pick("fastembed", root.dependencies),
        pick("neo4j-driver", root.dependencies),
        pick("zod", root.dependencies),
        // The backend is TypeScript and stays that way, exactly as `npm run backend` runs it.
        pick("tsx", root.devDependencies),
      ]),
    },
    null,
    2,
  )}\n`;
}

/** One tarball, so the 163-file frontend build is a single upload rather than 163. */
async function packPayload(): Promise<{ archive: string; cleanup: () => void }> {
  const staging = mkdtempSync(path.join(tmpdir(), "mnemex-deploy-"));
  writeFileSync(path.join(staging, "package.json"), await sandboxManifest());
  const archive = path.join(staging, "payload.tgz");
  run("tar", ["-czf", archive, "-C", REPO_ROOT, ...PAYLOAD_PATHS, "-C", staging, "package.json"]);
  return { archive, cleanup: () => rmSync(staging, { recursive: true, force: true }) };
}

/** Fail loudly on a non-zero exit: a half-installed sandbox is not worth handing back a URL for. */
async function exec(sandbox: Sandbox, label: string, command: string, timeoutSec = 300): Promise<string> {
  const result = await sandbox.process.executeCommand(command, undefined, undefined, timeoutSec);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (exit ${result.exitCode}):\n${result.result.slice(-2000)}`);
  }
  return result.result;
}

async function waitForHealth(sandbox: Sandbox): Promise<void> {
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    // --noproxy matters: the allow list injects HTTP_PROXY, and without this curl would
    // send a loopback request to the egress proxy, which correctly refuses it.
    const probe = await sandbox.process.executeCommand(
      `curl -fsS --noproxy '*' -m 5 http://127.0.0.1:${PORT}/health`,
      undefined,
      undefined,
      15,
    );
    if (probe.exitCode === 0) {
      console.log(`  healthy after ${attempt} attempt(s): ${probe.result.trim()}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }
  const log = await sandbox.process.executeCommand(`tail -40 ${REMOTE_DIR}/server.log`);
  throw new Error(`server never answered /health. Last log lines:\n${log.result}`);
}

/**
 * Time one recall against the real graph, in a fresh process, over the HTTP transport.
 * This is the deployment's honesty check: if the graph path is broken, the URL is worthless
 * and we should say so here rather than let a browser discover it.
 */
async function probeRecall(sandbox: Sandbox): Promise<string> {
  const probe = `
    const started = Date.now();
    const { recall } = await import("./dist/src/tools/recall.js");
    const result = await recall({ question: ${JSON.stringify(BENCHMARK_QUESTION)} });
    console.log(JSON.stringify({
      ms: Date.now() - started,
      decisions: result.decisions.map((d) => ({ statement: d.statement, status: d.status })),
      dissenters: result.decisions.flatMap((d) =>
        d.positions.filter((p) => p.stance === "DISAGREES_WITH").map((p) => p.person)),
      degraded: result.degraded,
    }));
  `;
  // Base64 rather than inline quoting: the probe contains quotes, braces and a question mark,
  // and it travels through a shell.
  const encoded = Buffer.from(probe, "utf8").toString("base64");
  const output = await exec(
    sandbox,
    "recall probe",
    `cd ${REMOTE_DIR} && echo ${encoded} | base64 -d > probe.mjs && node probe.mjs`,
    120,
  );
  return output.trim().split("\n").filter(Boolean).at(-1) ?? "";
}

async function main(): Promise<void> {
  loadDotenv({ path: path.join(REPO_ROOT, ".env") });

  const env: Record<string, string> = {};
  for (const key of FORWARDED) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  for (const key of ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD", "NEO4J_DATABASE", "DAYTONA_API_KEY", "DAYTONA_API_URL"]) {
    if (!env[key]) throw new Error(`${key} is missing from ${path.join(REPO_ROOT, ".env")}`);
  }
  if (!env.NOSANA_CHAT_ENDPOINT) {
    throw new Error("NOSANA_CHAT_ENDPOINT is unset, so the deployed UI would have no model to answer with");
  }

  // Sandboxes egress on 80 and 443 only, and only to these hosts. Naming them is what injects
  // the HTTP(S)_PROXY that Node's fetch honours; anything unnamed returns nothing at all.
  const allowList = [
    hostOf(env.NEO4J_URI, "NEO4J_URI"),
    hostOf(env.NOSANA_ENDPOINT ?? "", "NOSANA_ENDPOINT"),
    hostOf(env.NOSANA_CHAT_ENDPOINT, "NOSANA_CHAT_ENDPOINT"),
    "registry.npmjs.org",
  ];

  console.log("building");
  run("npm", ["run", "build"]);
  run("npm", ["--prefix", "agent-ui", "run", "build"]);

  console.log("packing payload");
  const { archive, cleanup } = await packPayload();

  const client = new Daytona({ apiKey: env.DAYTONA_API_KEY, apiUrl: env.DAYTONA_API_URL });
  let sandbox: Sandbox | undefined;
  try {
    console.log(`creating sandbox, allow list: ${allowList.join(", ")}`);
    sandbox = await client.create(
      {
        language: "typescript",
        public: true,
        autoStopInterval: AUTO_STOP_MINUTES,
        domainAllowList: allowList.join(","),
        envVars: {
          ...env,
          // A fresh sandbox prints an npm update notice after your stdout on its first command.
          NPM_CONFIG_UPDATE_NOTIFIER: "false",
          NO_UPDATE_NOTIFIER: "1",
          // Bolt is unreachable from here: 7687 is not 80 or 443. src/graph/driver.ts routes
          // through Aura's HTTPS query API instead.
          NEO4J_TRANSPORT: "http",
          // The preview proxy connects from outside the container, so loopback is not enough.
          MNEMEX_UI_HOST: "0.0.0.0",
          MNEMEX_UI_PORT: String(PORT),
          // Every embedding call now goes through the egress proxy, which the 3 s default was
          // not sized for. The local fallback is not an option here: it downloads 195 MB from
          // a host that is deliberately not on the allow list, so a timeout would be fatal
          // rather than degraded.
          REMOTE_TIMEOUT_MS: "15000",
          // onnxruntime-node's postinstall otherwise fetches CUDA binaries from GitHub, which
          // is not on the allow list, on every Linux x64 install.
          ONNXRUNTIME_NODE_INSTALL_CUDA: "skip",
        },
      },
      { timeout: 180 },
    );
    console.log(`  sandbox ${sandbox.id}`);

    console.log("uploading payload");
    await sandbox.fs.uploadFile(archive, "payload.tgz");
    await exec(sandbox, "extract", `mkdir -p ${REMOTE_DIR} && tar -xzf payload.tgz -C ${REMOTE_DIR}`, 120);

    console.log("installing dependencies");
    await exec(sandbox, "npm install", `cd ${REMOTE_DIR} && npm install --omit=dev --no-audit --no-fund`, 600);

    console.log("starting server");
    const session = "mnemex-site";
    await sandbox.process.createSession(session);
    await sandbox.process.executeSessionCommand(session, {
      command: `cd ${REMOTE_DIR} && node --import tsx agent-ui/server/index.ts > server.log 2>&1`,
      runAsync: true,
    });
    await waitForHealth(sandbox);

    console.log("probing recall against the live graph");
    console.log(`  ${await probeRecall(sandbox)}`);

    const preview = await sandbox.getPreviewLink(PORT);
    console.log("");
    console.log(`sandbox id  ${sandbox.id}`);
    console.log(`url         ${preview.url}`);
    console.log(`token       ${preview.token ? "issued (see x-daytona-preview-token)" : "none"}`);
    console.log(`stops after ${AUTO_STOP_MINUTES} minutes idle`);
  } catch (error) {
    // Leave the sandbox alive on failure: its server.log is the only record of what happened.
    if (sandbox) console.error(`sandbox ${sandbox.id} left running for inspection`);
    throw error;
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
