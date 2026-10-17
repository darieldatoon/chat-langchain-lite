import { describe, expect, it } from "vite-plus/test";

import { findEnvironment, parseConfig } from "./config";

const base = { VITE_LANGSMITH_WORKSPACE_ID: "ws-1" };

describe("parseConfig", () => {
  it("lists configured environments with production first and derives project names", () => {
    const result = parseConfig({
      ...base,
      VITE_AGENT_URL_DEVELOPMENT: "https://dev.example/",
      VITE_AGENT_URL_PRODUCTION: "https://prod.example",
    });
    expect(result.ok && result.config.environments).toEqual([
      {
        id: "production",
        label: "Production",
        url: "https://prod.example",
        projectName: "chat-langchain-lite-production",
      },
      {
        id: "development",
        label: "Development",
        url: "https://dev.example",
        projectName: "chat-langchain-lite-development",
      },
    ]);
  });

  it("works with only development deployed", () => {
    const result = parseConfig({ ...base, VITE_AGENT_URL_DEVELOPMENT: "http://localhost:2024" });
    expect(result.ok && result.config.environments.map((e) => e.id)).toEqual(["development"]);
  });

  it("reports every missing setting", () => {
    const result = parseConfig({ VITE_AUTH_MODE: "oauth" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toHaveLength(3);
  });
});

describe("findEnvironment", () => {
  const result = parseConfig({
    ...base,
    VITE_AGENT_URL_PRODUCTION: "p",
    VITE_AGENT_URL_DEVELOPMENT: "d",
  });
  if (!result.ok) throw new Error("fixture");

  it("falls back to the first environment for unknown ids", () => {
    expect(findEnvironment(result.config, "development").id).toBe("development");
    expect(findEnvironment(result.config, "staging").id).toBe("production");
    expect(findEnvironment(result.config, null).id).toBe("production");
  });
});
