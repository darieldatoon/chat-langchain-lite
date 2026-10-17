// Must match `name` in agent/agent.ts: it is the assistant id and the tracing-project prefix.
export const ASSISTANT_ID = "chat-langchain-lite";

export type EnvironmentId = "production" | "development";

export interface AgentEnvironment {
  readonly id: EnvironmentId;
  readonly label: string;
  readonly url: string;
  /** Tracing project the agent platform creates per environment. */
  readonly projectName: string;
}

export interface AppConfig {
  readonly environments: readonly AgentEnvironment[];
  readonly workspaceId: string;
  readonly authMode: "pat";
}

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; problems: readonly string[] };

type Env = Record<string, string | undefined>;

const ENVIRONMENT_VARS: ReadonlyArray<readonly [EnvironmentId, string, string]> = [
  ["production", "Production", "VITE_AGENT_URL_PRODUCTION"],
  ["development", "Development", "VITE_AGENT_URL_DEVELOPMENT"],
];

export function parseConfig(env: Env): ConfigResult {
  const environments = ENVIRONMENT_VARS.flatMap(([id, label, key]) => {
    const url = env[key]?.trim().replace(/\/+$/, "");
    return url ? [{ id, label, url, projectName: `${ASSISTANT_ID}-${id}` }] : [];
  });
  const workspaceId = env.VITE_LANGSMITH_WORKSPACE_ID?.trim() ?? "";
  const authMode = env.VITE_AUTH_MODE?.trim() || "pat";

  const problems = [
    ...(environments.length
      ? []
      : ["Set VITE_AGENT_URL_PRODUCTION or VITE_AGENT_URL_DEVELOPMENT."]),
    ...(workspaceId ? [] : ["Set VITE_LANGSMITH_WORKSPACE_ID."]),
    ...(authMode === "pat"
      ? []
      : [`VITE_AUTH_MODE "${authMode}" is not supported yet; use "pat".`]),
  ];
  if (problems.length) return { ok: false, problems };
  return { ok: true, config: { environments, workspaceId, authMode: "pat" } };
}

export function findEnvironment(config: AppConfig, id: string | null): AgentEnvironment {
  return (
    config.environments.find((environment) => environment.id === id) ?? config.environments[0]!
  );
}
