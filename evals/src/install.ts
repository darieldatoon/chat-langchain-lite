import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { findDeployment, type Environment } from "./agent.ts";
import { ApiError, createApi, type Api } from "./api.ts";
import { readConfig } from "./config.ts";
import {
  corsOrigins,
  createBody,
  createWhenEnvironmentFree,
  deploymentSecrets,
  ENVIRONMENT_BRANCHES,
  findAgentDeployment,
  findGithubSource,
  mergeSecrets,
  PREVIEW_CONFIG,
  waitUntilDeployed,
  type DeploymentRecord,
  type GithubSource,
  type Secret,
} from "./deployments.ts";
import { branchProtection, originRepo, run, runSince, type WorkflowRun } from "./github.ts";

const log = (message: string) => console.log(`[install] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ENVIRONMENTS: readonly Environment[] = ["development", "production"];
// The Prepare demo workflow's only secret; the deployments get the Gateway key as their own secret.
const REPO_SECRETS = ["LANGSMITH_API_KEY"] as const;

interface DeployOptions {
  readonly source: GithubSource;
  readonly secrets: readonly Secret[];
  readonly redeploy: boolean;
  readonly replace: boolean;
}

interface EngineBoard {
  readonly github_repos?: readonly {
    readonly repo_url: string;
    readonly base_branch: string | null;
  }[];
}

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

async function ensureDeployment(
  hostApi: Api,
  environment: Environment,
  options: DeployOptions,
): Promise<DeploymentRecord> {
  const branch = ENVIRONMENT_BRANCHES[environment];
  const existing = await findAgentDeployment(hostApi, environment);
  if (existing?.source === "github") {
    // The list endpoint omits secrets.
    const current = await hostApi.get<DeploymentRecord>(`/v2/deployments/${existing.id}`);
    const secrets = mergeSecrets(current.secrets ?? [], options.secrets);
    if (secrets) {
      await hostApi.patch(`/v2/deployments/${existing.id}`, { secrets });
      log(`${environment}: updated ${existing.name}'s secrets, which rebuilds it`);
    } else if (options.redeploy) {
      await hostApi.post(`/v2/deployments/${existing.id}/revisions`, {});
      log(`${environment}: rebuilding ${existing.name} from ${branch}`);
    } else {
      log(
        `${environment} already builds from ${branch} on every push; --redeploy to rebuild it now`,
      );
    }
    // An interrupted install can leave its first build pending or failed.
    return waitUntilDeployed(hostApi, existing.id, log);
  }
  if (existing) {
    if (!options.replace)
      throw new Error(
        `${environment} (${existing.name}) was deployed with the mda CLI, which LangSmith can't connect to GitHub. Re-run with --replace to delete it and create it again from GitHub; its tracing project and rules stay.`,
      );
    await hostApi.delete(`/v2/deployments/${existing.id}`, { delete_tracing_project: false });
    log(`${environment}: deleted the CLI deployment ${existing.name}`);
  }
  const body = createBody(environment, options.source, {
    // Fixed when a deployment is created.
    deploymentType:
      environment === "production" ? (process.env.PRODUCTION_DEPLOYMENT_TYPE ?? "dev") : "dev",
    secrets: options.secrets,
  });
  const created = await createWhenEnvironmentFree(hostApi, body, log);
  log(`${environment}: building ${created.name} from ${branch}`);
  return waitUntilDeployed(hostApi, created.id, log);
}

function protectBranches(repo: string) {
  for (const branch of Object.values(ENVIRONMENT_BRANCHES)) {
    try {
      gh(
        [
          "api",
          "-X",
          "PUT",
          `repos/${repo}/branches/${branch}/protection`,
          "--input",
          "-",
          "--silent",
        ],
        JSON.stringify(branchProtection()),
      );
      log(`${branch}: merges need a passing check`);
    } catch (error) {
      log(
        `WARNING: couldn't protect ${branch}, so LangSmith builds it even when CI fails. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Forks from before GitHub builds still have the mda CLI workflow, which would deploy over them. */
function disableCliDeployWorkflow(repo: string) {
  try {
    gh(["workflow", "disable", "deploy-agent.yml", "-R", repo]);
    log("disabled the old Deploy agent workflow");
  } catch {}
}

const repoSlug = (url: string) =>
  url
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .toLowerCase();

/** Points the production board's fix verification at development's previews. Never creates a board: that starts a paid scan. */
async function connectEngine(
  api: Api,
  repo: string,
  production: DeploymentRecord,
  development: DeploymentRecord,
) {
  const path = `/platform/sessions/${production.tracer_session_id}/issues-agent`;
  let board: EngineBoard;
  try {
    board = await api.get<EngineBoard>(path);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
    log(
      "no Engine board on production. To verify Engine's fixes, create one (see the README), then re-run install.",
    );
    return;
  }
  // Engine verifies only fixes in the board's first repo.
  const [first] = board.github_repos ?? [];
  if (
    !first ||
    repoSlug(first.repo_url) !== repo.toLowerCase() ||
    first.base_branch !== "development"
  )
    log(
      `WARNING: the Engine board's first repo should be ${repo} with base branch development, or its fixes won't get previews.`,
    );
  await api.patch(path, {
    validation_deployment_id: development.id,
    preview_verify_enabled: true,
    // GitHub builds sync Context Hub into a repo named after the deployment.
    context_hub_repo_handle: production.name,
  });
  log("Engine verifies its fixes on previews of development");
}

async function main() {
  const { values } = parseArgs({
    options: {
      redeploy: { type: "boolean", default: false },
      replace: { type: "boolean", default: false },
    },
  });
  const config = readConfig(process.env);
  const gatewayKey = process.env.LANGSMITH_GATEWAY_API_KEY;
  if (!gatewayKey)
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
  for (const branch of Object.values(ENVIRONMENT_BRANCHES)) {
    try {
      gh(["api", `repos/${repo}/branches/${branch}`, "--silent"]);
    } catch {
      throw new Error(`${repo} has no ${branch} branch. See the README's Fork setup, step 1.`);
    }
  }
  const source = await findGithubSource(hostApi, repo);
  if (!source)
    throw new Error(
      `LangSmith's GitHub App can't see ${repo}. In LangSmith, open Deployments → New deployment → GitHub, give the app access to ${repo}, then re-run.`,
    );

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
  protectBranches(repo);
  disableCliDeployWorkflow(repo);
  ensurePages(repo);

  const organization = await api.get<{ id: string }>("/orgs/current");
  const clientId = process.env.OAUTH_CLIENT_ID?.trim() || null;
  gh(["variable", "set", "VITE_LANGSMITH_ORGANIZATION_ID", "-R", repo, "--body", organization.id]);
  if (clientId) gh(["variable", "set", "VITE_OAUTH_CLIENT_ID", "-R", repo, "--body", clientId]);
  else {
    try {
      gh(["variable", "delete", "VITE_OAUTH_CLIENT_ID", "-R", repo]);
    } catch {}
    log(
      "OAUTH_CLIENT_ID is blank in agent/.env, so the app offers only personal access tokens. See the README's Sign in with LangSmith.",
    );
  }
  const options: DeployOptions = {
    source,
    secrets: deploymentSecrets({
      gatewayKey,
      cors: corsOrigins(repo.split("/")[0]!),
      signIn: { organizationId: organization.id, clientId },
    }),
    redeploy: values.redeploy,
    replace: values.replace,
  };
  const deployed: Partial<Record<Environment, DeploymentRecord>> = {};
  for (const environment of ENVIRONMENTS) {
    deployed[environment] = await ensureDeployment(hostApi, environment, options);
    const { url } = await findDeployment(hostApi, environment);
    const variable = `VITE_AGENT_URL_${environment.toUpperCase()}`;
    gh(["variable", "set", variable, "-R", repo, "--body", url]);
    log(`${variable} = ${url}`);
  }
  const { development, production } = deployed as Record<Environment, DeploymentRecord>;
  await hostApi.put(`/v2/deployments/${development.id}/preview-builds/config`, PREVIEW_CONFIG);
  log(`PRs into development labeled "${PREVIEW_CONFIG.trigger_label}" get a preview deployment`);
  await connectEngine(api, repo, production, development);

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
