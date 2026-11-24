import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_NAME, pushApp } from "../src/app.ts";
import { fakeApi } from "./fake-api.ts";

const config = { apiKey: "key", workspaceId: "ws-1", apiUrl: "", hostUrl: "" };

describe("pushApp", () => {
  const push = async (apps: object[]) => {
    const dir = await mkdtemp(join(tmpdir(), "triage-sheet-"));
    const commands: { command: string; args: readonly string[]; options: any }[] = [];
    const result = await pushApp(
      fakeApi(() => apps),
      config,
      {
        dir,
        run: (command, args, options) => commands.push({ command, args, options }),
      },
    );
    const link = await readFile(join(dir, ".langsmith", "app.json"), "utf8").catch(() => null);
    return { result, commands, link: link && JSON.parse(link) };
  };

  it("builds, then pushes without rebuilding, to the configured workspace", async () => {
    const { commands } = await push([]);
    expect(commands.map(({ command, args }) => [command, ...args.slice(0, 3)])).toEqual([
      ["pnpm", "run", "build"],
      ["langsmith", "apps", "push", "--no-build"],
    ]);
    expect(commands[1].options.env).toMatchObject({
      LANGSMITH_API_KEY: "key",
      LANGSMITH_WORKSPACE_ID: "ws-1",
    });
  });

  it("links the workspace's app so the push updates it instead of failing on the name", async () => {
    const { result, link } = await push([{ id: "app-1", name: APP_NAME, scope: "workspace" }]);
    expect(result).toEqual({ status: "updated" });
    expect(link).toEqual({ app_id: "app-1", name: APP_NAME });
  });

  it("leaves an org-shared app with the same name alone", async () => {
    const { result, link } = await push([{ id: "org-app", name: APP_NAME, scope: "organization" }]);
    expect(result).toEqual({ status: "created" });
    expect(link).toBeNull();
  });
});
