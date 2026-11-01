import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { getHarnessProfile } from "deepagents";
import { ToolMessage } from "langchain";
import type { ManagedServerInfo, ManagedServerRuntime } from "managed-deepagents";
import { beforeAll, describe, expect, it } from "vitest";

import { agent } from "../agent.js";
import { mcp } from "../tools/mcp.js";

function runtimeWith(context: Record<string, unknown>) {
  return { executionRuntime: { context } } as unknown as ManagedServerRuntime;
}

describe("agent factory", () => {
  beforeAll(() => {
    process.env.LANGSMITH_GATEWAY_API_KEY ??= "test-key";
  });

  it("uses Haiku unless the run picks another allowlisted model", () => {
    expect(agent(runtimeWith({})).config.model).toBeInstanceOf(ChatAnthropic);
    expect(agent(runtimeWith({ eval_model: "gpt-4o" })).config.model).toBeInstanceOf(ChatAnthropic);
    expect(agent(runtimeWith({ eval_model: "gpt-6-luna" })).config.model).toBeInstanceOf(
      ChatOpenAI,
    );
  });

  it("turns off the general-purpose subagent for both providers", () => {
    for (const spec of ["anthropic:claude-haiku-5-5", "openai:gpt-6-luna"]) {
      expect(getHarnessProfile(spec)?.generalPurposeSubagent?.enabled).toBe(false);
    }
  });
});

describe("tool errors", () => {
  type Hook = (request: unknown, handler: (request: unknown) => unknown) => unknown;
  const outsider = {
    principal: { id: "u", kind: "person", claims: {} },
    source: { provider: "http" },
  } as unknown as ManagedServerInfo;

  beforeAll(() => {
    process.env.LANGSMITH_GATEWAY_API_KEY ??= "test-key";
  });

  // Runs a tool call through the agent's middleware in order, as the tools node does.
  async function callTool(serverInfo: ManagedServerInfo | undefined, tool: () => unknown) {
    const middleware = agent(runtimeWith({})).config.middleware as unknown as {
      wrapToolCall?: Hook;
    }[];
    const run = middleware.reduceRight<(request: unknown) => unknown>(
      (next, { wrapToolCall }) => (wrapToolCall ? (request) => wrapToolCall(request, next) : next),
      tool,
    );
    return run({
      toolCall: { id: "call-1", name: "langchainDocs_search_docs_by_lang_chain", args: {} },
      runtime: { serverInfo },
    });
  }

  it("returns a failed docs call to the model as an error result", async () => {
    const message = await callTool(undefined, () => {
      throw new Error("Request timed out");
    });
    expect(message).toBeInstanceOf(ToolMessage);
    expect(message).toMatchObject({
      status: "error",
      tool_call_id: "call-1",
      name: "langchainDocs_search_docs_by_lang_chain",
    });
  });

  it("still ends the run when the access check refuses the caller", async () => {
    await expect(
      callTool(outsider, () => {
        throw new Error("tool should not run");
      }),
    ).rejects.toThrow(/Chat LangChain Lite/);
  });

  it("gives up on a hung docs call well before the MCP SDK's 60s default", () => {
    expect(mcp.servers.langchainDocs?.defaultToolTimeout).toBe(20_000);
  });
});
