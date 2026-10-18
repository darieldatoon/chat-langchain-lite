import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { ask, findDeployment, type Deployment } from "./agent.ts";
import { createApi, type Api } from "./api.ts";
import { readConfig, type Config } from "./config.ts";
import { seedDataset, type SeedExample } from "./dataset.ts";
import {
  assertionsRule,
  citesRule,
  ensureRule,
  resolveJudge,
  toneRule,
  trajectoryRule,
  type EnsureResult,
  type RuleTarget,
} from "./evaluators.ts";
import { EXPERIMENTS, runExperiment, waitForScores, type ExperimentResult } from "./experiments.ts";
import { sendTraffic } from "./traffic.ts";
import { ensureTriage } from "./triage.ts";

// Seeding always runs: every other step needs the dataset id, and it changes nothing when current.
const STEPS = ["readiness", "evaluators", "triage", "traffic", "experiments"] as const;
type Step = (typeof STEPS)[number];

// Mirrors the agent's output limit, so simulated users can spot answers that ran out of room.
const AGENT_OUTPUT_LIMIT = 900;
const root = new URL("../", import.meta.url);

function log(line: string) {
  console.log(`[prepare] ${line}`);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, root), "utf8")) as T;
}

function agentApi(config: Config, deployment: Deployment): Api {
  return createApi({
    baseUrl: deployment.url,
    apiKey: config.apiKey,
    workspaceId: config.workspaceId,
  });
}

/** Wakes both deployments (`dev` deployments scale to zero) and fails fast if one is down. */
async function checkReadiness(config: Config, deployments: readonly Deployment[]) {
  await Promise.all(
    deployments.map((deployment) =>
      ask(agentApi(config, deployment), "Hi! What can you help with?", {
        metadata: { source: "demo-prepare-readiness" },
      }),
    ),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      "skip-wait": { type: "boolean", default: false },
      concurrency: { type: "string", default: "4" },
      split: { type: "string" },
      roles: { type: "string" },
    },
  });
  const steps = new Set<Step>(
    values.only ? (values.only.split(",").map((step) => step.trim()) as Step[]) : STEPS,
  );
  const unknown = [...steps].filter((step) => !STEPS.includes(step));
  if (unknown.length > 0)
    throw new Error(`Unknown step(s): ${unknown.join(", ")}. Steps: ${STEPS.join(", ")}`);
  const concurrency = Number(values.concurrency);

  const config = readConfig(process.env);
  const api = createApi({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
    workspaceId: config.workspaceId,
  });
  const hostApi = createApi({
    baseUrl: config.hostUrl,
    apiKey: config.apiKey,
    workspaceId: config.workspaceId,
  });

  const [production, development] = await Promise.all([
    findDeployment(hostApi, "production"),
    findDeployment(hostApi, "development"),
  ]);
  const deployments = { production, development };
  log(
    `production revision ${production.revisionId}, development revision ${development.revisionId}`,
  );

  const seeds = await readJson<SeedExample[]>("dataset/examples.json");
  const manifest: Record<string, unknown> = {
    preparedAt: new Date().toISOString(),
    workspaceId: config.workspaceId,
    deployments,
  };

  if (steps.has("readiness")) {
    await checkReadiness(config, [production, development]);
    log("readiness ok: both deployments answered");
  }

  const dataset = await seedDataset(api, seeds);
  log(
    `dataset ${dataset.id}: ${dataset.created} created, ${dataset.updated} updated, ${dataset.unchanged} unchanged; baseline ${dataset.baselineAsOf}`,
  );
  manifest.dataset = dataset;

  if (steps.has("evaluators")) {
    const judge = await resolveJudge(api);
    const code = await readFile(new URL("evaluators/cites-retrieved-docs.js", root), "utf8");
    const datasetTarget: RuleTarget = { kind: "dataset", datasetId: dataset.id };
    const results: EnsureResult[] = [
      await ensureRule(api, datasetTarget, assertionsRule(dataset.id, judge)),
      await ensureRule(api, datasetTarget, toneRule(datasetTarget)),
      await ensureRule(api, datasetTarget, citesRule(datasetTarget, code)),
    ];
    for (const deployment of [production, development]) {
      const target: RuleTarget = { kind: "session", sessionId: deployment.tracerSessionId };
      results.push(await ensureRule(api, target, toneRule(target)));
      results.push(await ensureRule(api, target, citesRule(target, code)));
    }
    results.push(
      await ensureRule(
        api,
        { kind: "session", sessionId: production.tracerSessionId },
        trajectoryRule(production.tracerSessionId, judge),
      ),
    );
    for (const result of results) log(`evaluator ${result.name}: ${result.status}`);
    manifest.evaluators = results;
  }

  if (steps.has("triage")) {
    manifest.triage = await ensureTriage(api, dataset.id, [
      production.tracerSessionId,
      development.tracerSessionId,
    ]);
    log("triage queue and rules ready");
  }

  if (steps.has("traffic")) {
    const questions = await readJson<string[]>("dataset/traffic.json");
    const summary = await sendTraffic(agentApi(config, production), api, questions, {
      outputLimit: AGENT_OUTPUT_LIMIT,
      incompleteThumbsDown: 5,
      informalThumbsDown: 3,
      concurrency,
    });
    log(`traffic: ${JSON.stringify(summary)}`);
    manifest.traffic = summary;
  }

  if (steps.has("experiments")) {
    const roles = values.roles?.split(",").map((role) => role.trim());
    const specs = roles ? EXPERIMENTS.filter((spec) => roles.includes(spec.role)) : EXPERIMENTS;
    if (specs.length === 0) throw new Error(`No experiments match --roles ${values.roles}`);
    const experiments: ExperimentResult[] = [];
    for (const spec of specs) {
      const deployment = deployments[spec.environment];
      experiments.push(
        await runExperiment({
          api,
          agentApi: agentApi(config, deployment),
          spec,
          deployment,
          datasetId: dataset.id,
          asOf: dataset.baselineAsOf,
          concurrency,
          split: values.split,
          log,
        }),
      );
    }
    manifest.experiments = experiments;
    if (!values["skip-wait"]) {
      manifest.completion = await waitForScores({
        api,
        experiments,
        timeoutMs: 15 * 60_000,
        pollMs: 15_000,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: Date.now,
        log,
      });
    }
  }

  await mkdir(new URL(".prepare/", root), { recursive: true });
  await writeFile(
    new URL(".prepare/manifest.json", root),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  log("manifest written to evals/.prepare/manifest.json");
}

main().catch((error: unknown) => {
  console.error(`[prepare] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
