// Deploys one agent environment with the project-local mda CLI. Run from agent/ (see agent/mise.toml).
import { spawnSync } from "node:child_process";

const AGENT_ID = "chat-langchain-lite";
const environment = process.argv[2];

// Development is always scale-to-zero `dev`; production's type only matters when it is first created.
const deploymentTypes = {
  development: "dev",
  production: process.env.PRODUCTION_DEPLOYMENT_TYPE || "dev",
};

if (!(environment in deploymentTypes)) {
  console.error("Usage: mise run deploy -- <development|production>");
  process.exit(2);
}
if (!process.env.LANGSMITH_WORKSPACE_ID) {
  console.error("LANGSMITH_WORKSPACE_ID is not set (mise.local.toml locally, a repo variable in CI).");
  process.exit(2);
}

// pnpm 12 `exec` hides mda's output, so call the binary directly.
const result = spawnSync(
  "node_modules/.bin/mda",
  [
    "deploy",
    ".",
    "-n",
    AGENT_ID,
    "--agent-environment",
    environment,
    "--deployment-type",
    deploymentTypes[environment],
    "--workspace-id",
    process.env.LANGSMITH_WORKSPACE_ID,
    "--context-strategy",
    "overwrite",
    "-y",
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
