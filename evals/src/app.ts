import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Api } from "./api.ts";
import type { Config } from "./config.ts";

export const APP_NAME = "chat-langchain-lite-triage-sheet";
const APP_DESCRIPTION = "A spreadsheet view of the chat-langchain-lite-triage annotation queue.";
const APP_DIR = fileURLToPath(new URL("../../triage-sheet", import.meta.url));

export interface CustomApp {
  readonly id: string;
  readonly name: string;
  readonly scope?: string;
}

/** This workspace's app only: an org-shared app with the same name isn't ours to overwrite. */
export async function findApp(api: Api): Promise<CustomApp | undefined> {
  const apps = await api.get<CustomApp[]>("/platform/custom-apps");
  return apps.find((app) => app.name === APP_NAME && !app.scope?.toLowerCase().startsWith("org"));
}

type Run = (command: string, args: readonly string[], options: object) => unknown;

/** Builds triage-sheet/ and pushes it, updating the workspace's app in place. */
export async function pushApp(
  api: Api,
  config: Config,
  { run = execFileSync as Run, dir = APP_DIR }: { readonly run?: Run; readonly dir?: string } = {},
): Promise<{ readonly status: "created" | "updated" }> {
  const existing = await findApp(api);
  const linkFile = join(dir, ".langsmith", "app.json");
  // Unlinked, push creates a new app, and fails with a 409 when the name is taken.
  if (existing) {
    await mkdir(dirname(linkFile), { recursive: true });
    await writeFile(linkFile, JSON.stringify({ app_id: existing.id, name: existing.name }));
  } else {
    await rm(linkFile, { force: true });
  }
  run("pnpm", ["run", "build"], { cwd: dir, stdio: "inherit" });
  run(
    "langsmith",
    ["apps", "push", "--no-build", "--name", APP_NAME, "--description", APP_DESCRIPTION],
    {
      cwd: dir,
      stdio: "inherit",
      // The environment beats a saved CLI profile, so this pushes to the workspace prepare targets.
      env: {
        ...process.env,
        LANGSMITH_API_KEY: config.apiKey,
        LANGSMITH_WORKSPACE_ID: config.workspaceId,
      },
    },
  );
  return { status: existing ? "updated" : "created" };
}
