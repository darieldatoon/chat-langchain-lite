import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { findDeployment, type Environment } from "./agent.ts";
import { createApi } from "./api.ts";
import { readConfig } from "./config.ts";
import { originRepo, run, runSince, type WorkflowRun } from "./github.ts";

const log = (message: string) => console.log(`[install] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Production must deploy from main and development from development: the Deploy agent workflow maps branch to environment.
const DEPLOYS: readonly { readonly branch: string; readonly environment: Environment }[] = [
  { branch: "development", environment: "development" },
  { branch: "main", environment: "production" },
];
const REPO_SECRETS = ["LANGSMITH_API_KEY", "LANGSMITH_GATEWAY_API_KEY"] as const;

function gh(args: readonly string[], input?: string): string {
  return run("gh", args, input);
}

async function dispatchAndWait(repo: string, workflow: string, branch: string) {
  // GitHub stamps runs with its own clock; allow for a little skew.
  const since = new Date(Date.now() - 30_000);
  gh(["workflow", "run", workflow, "-R", repo, "--ref", branch]);
  let started: WorkflowRun | undefined;
  for (let attempt = 0; attempt < 20 && !started; attempt += 1) {
    await sleep(3_000);
    const runs = JSON.parse(
      gh([
        "run",
        "list",
        "-R",
        repo,
        "--workflow",
        workflow,
        "--branch",
        branch,
        "--event",
        "workflow_dispatch",
        "--limit",
        "5",
        "--json",
        "databaseId,createdAt",
      ]),
    ) as WorkflowRun[];
    started = runSince(runs, since);
  }
  if (!started) throw new Error(`${workflow} on ${branch} was dispatched but no run appeared.`);
  log(`${workflow} on ${branch}: https://github.com/${repo}/actions/runs/${started.databaseId}`);
  const watched = spawnSync(
    "gh",
    ["run", "watch", String(started.databaseId), "-R", repo, "--exit-status", "--interval", "15"],
    { stdio: "inherit" },
  );
  if (watched.status !== 0) throw new Error(`${workflow} on ${branch} failed. See the run above.`);
}

function ensurePages(repo: string) {
  let buildType: string | undefined;
  try {
    buildType = (JSON.parse(gh(["api", `repos/${repo}/pages`])) as { build_type?: string })
      .build_type;
  } catch {
    gh(["api", "-X", "POST", `repos/${repo}/pages`, "-f", "build_type=workflow"]);
    log("Pages enabled with GitHub Actions as the source");
    return;
  }
  if (buildType !== "workflow") {
    gh(["api", "-X", "PUT", `repos/${repo}/pages`, "-f", "build_type=workflow"]);
    log("Pages source switched to GitHub Actions");
  }
}

async function main() {
  const { values } = parseArgs({ options: { redeploy: { type: "boolean", default: false } } });
  const config = readConfig(process.env);
  if (!process.env.LANGSMITH_GATEWAY_API_KEY)
    throw new Error(
      "LANGSMITH_GATEWAY_API_KEY is blank in agent/.env. Paste your LC_GATEWAY_KEY there.",
    );
  const client = (baseUrl: string) =>
    createApi({ baseUrl, apiKey: config.apiKey, workspaceId: config.workspaceId });
  const api = client(config.apiUrl);
  const hostApi = client(config.hostUrl);

  const repo = originRepo();
  gh(["auth", "status"]);
  log(`fork ${repo}, workspace ${config.workspaceId}`);

  const workspaceSecrets = await api.get<{ key: string }[]>("/workspaces/current/secrets");
  if (!workspaceSecrets.some((secret) => secret.key === "LC_GATEWAY_KEY"))
    throw new Error(
      "The workspace has no LC_GATEWAY_KEY secret, which the tone evaluators need. Add it under Settings → Secrets in LangSmith.",
    );
  for (const { branch } of DEPLOYS) {
    try {
      gh(["api", `repos/${repo}/branches/${branch}`, "--silent"]);
    } catch {
      throw new Error(`${repo} has no ${branch} branch. See the README's Fork setup, step 1.`);
    }
  }

  const existing = new Set(
    (JSON.parse(gh(["secret", "list", "-R", repo, "--json", "name"])) as { name: string }[]).map(
      (secret) => secret.name,
    ),
  );
  for (const name of REPO_SECRETS) {
    if (existing.has(name)) continue;
    gh(["secret", "set", name, "-R", repo], process.env[name]!);
    log(`repo secret ${name} set from agent/.env`);
  }
  gh(["variable", "set", "LANGSMITH_WORKSPACE_ID", "-R", repo, "--body", config.workspaceId]);
  ensurePages(repo);

  for (const { branch, environment } of DEPLOYS) {
    const deployed = await findDeployment(hostApi, environment).catch(() => null);
    if (deployed && !values.redeploy)
      log(`${environment} is already deployed; --redeploy to deploy it again`);
    else await dispatchAndWait(repo, "deploy-agent.yml", branch);
    const { url } = await findDeployment(hostApi, environment);
    gh([
      "variable",
      "set",
      `VITE_AGENT_URL_${environment.toUpperCase()}`,
      "-R",
      repo,
      "--body",
      url,
    ]);
    log(`VITE_AGENT_URL_${environment.toUpperCase()} = ${url}`);
  }

  // Variable changes don't rebuild Pages, so always publish.
  await dispatchAndWait(repo, "pages.yml", "main");

  const prepared = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("prepare.ts", import.meta.url))],
    {
      stdio: "inherit",
    },
  );
  if (prepared.status !== 0)
    throw new Error("prepare failed. It's safe to re-run: mise run demo:prepare");

  const site = (JSON.parse(gh(["api", `repos/${repo}/pages`])) as { html_url: string }).html_url;
  log(`done. The chat app is at ${site}`);
}

main().catch((error: unknown) => {
  console.error(`[install] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
