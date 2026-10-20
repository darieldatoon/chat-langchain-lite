import { spawnSync } from "node:child_process";

/** owner/name from an https or ssh GitHub remote URL. */
export function parseGithubRepo(remoteUrl: string): string {
  const match = remoteUrl.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error(`origin is not a GitHub repo: ${remoteUrl}`);
  return match[1]!;
}

/** The fork's repo. gh's own default here can be the upstream repo, so always pass this with -R. */
export function originRepo(): string {
  return parseGithubRepo(run("git", ["remote", "get-url", "origin"]));
}

/** Runs a command and returns its stdout. `input` goes to stdin, so secrets never appear in argv or logs. */
export function run(command: string, args: readonly string[], input?: string): string {
  const result = spawnSync(command, args, { encoding: "utf8", input });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

export interface WorkflowRun {
  readonly databaseId: number;
  readonly createdAt: string;
}

/** The run a dispatch just started: the newest one created at or after `since`. */
export function runSince(runs: readonly WorkflowRun[], since: Date): WorkflowRun | undefined {
  return runs
    .filter((candidate) => new Date(candidate.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function checklist(repo: string): string[] {
  return [
    `GitHub ${repo}, Settings → Secrets and variables → Actions:`,
    "  variables LANGSMITH_WORKSPACE_ID, VITE_AGENT_URL_DEVELOPMENT, VITE_AGENT_URL_PRODUCTION",
    "  secrets LANGSMITH_API_KEY, LANGSMITH_GATEWAY_API_KEY",
    `GitHub ${repo}, Settings → Pages: unpublish the site, then delete the github-pages environment`,
    "Local: agent/.env and mise.local.toml (your keys), agent/.mda/, evals/.prepare/",
  ];
}
