import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";

import {
  chooseModel,
  createModel,
  DEFAULT_MODEL,
  GATEWAY_ANTHROPIC_URL,
  GATEWAY_OPENAI_URL,
  gatewayApiKey,
  gptLunaOptions,
  MAX_OUTPUT_TOKENS,
  modelOptions,
  noteTruncation,
  TRUNCATION_NOTE,
} from "../model.js";

describe("gatewayApiKey", () => {
  it("returns the gateway key", () => {
    expect(gatewayApiKey({ LANGSMITH_GATEWAY_API_KEY: "g" })).toBe("g");
  });

  it("rejects a missing or blank key instead of falling back to the LangSmith key", () => {
    expect(() => gatewayApiKey({ LANGSMITH_API_KEY: "l" })).toThrow(/LANGSMITH_GATEWAY_API_KEY/);
    expect(() =>
      gatewayApiKey({ LANGSMITH_GATEWAY_API_KEY: "", LANGSMITH_API_KEY: "l" }),
    ).toThrow();
  });
});

describe("modelOptions", () => {
  const options = modelOptions({ LANGSMITH_GATEWAY_API_KEY: "g" });

  it("routes Haiku 5.5 through the LangChain Inc Gateway", () => {
    expect(options.model).toBe("claude-haiku-5-5");
    expect(options.anthropicApiUrl).toBe(GATEWAY_ANTHROPIC_URL);
  });

  it("disables extended thinking", () => {
    expect(options.thinking).toEqual({ type: "disabled" });
  });

  it("leaves room for long, code-heavy answers", () => {
    expect(options.maxTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(4096);
  });
});

describe("chooseModel", () => {
  it("accepts allowlisted models and falls back to Haiku for anything else", () => {
    expect(chooseModel("gpt-6-luna")).toBe("gpt-6-luna");
    expect(chooseModel("claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(chooseModel("gpt-4o")).toBe(DEFAULT_MODEL);
    expect(chooseModel(undefined)).toBe(DEFAULT_MODEL);
  });
});

describe("gptLunaOptions", () => {
  const options = gptLunaOptions({ LANGSMITH_GATEWAY_API_KEY: "g" });

  it("routes gpt-6-luna through the Gateway's Chat Completions route", () => {
    expect(options.configuration.baseURL).toBe(GATEWAY_OPENAI_URL);
    expect(options.useResponsesApi).toBe(false);
  });

  it("matches the Anthropic model's output budget with reasoning off", () => {
    expect(options.maxTokens).toBe(modelOptions({ LANGSMITH_GATEWAY_API_KEY: "g" }).maxTokens);
    expect(options.reasoning).toEqual({ effort: "none" });
  });
});

describe("noteTruncation", () => {
  it("notes a streamed Anthropic answer that stopped at max_tokens", () => {
    const message = new AIMessage({
      id: "msg_1",
      content: "Step 1: install the package",
      additional_kwargs: { stop_reason: "max_tokens" },
    });
    const noted = noteTruncation(message);
    expect(noted.id).toBe("msg_1");
    expect(noted.text).toBe(`Step 1: install the package\n\n${TRUNCATION_NOTE}`);
  });

  it("notes an Anthropic answer with block content and max_tokens in response metadata", () => {
    const message = new AIMessage({
      content: [{ type: "text", text: "Here's the guide" }],
      response_metadata: { stop_reason: "max_tokens" },
    });
    expect(noteTruncation(message).text).toContain(TRUNCATION_NOTE);
  });

  it("notes an OpenAI answer that stopped at length", () => {
    const message = new AIMessage({
      content: "Here's the guide",
      response_metadata: { finish_reason: "length" },
    });
    expect(noteTruncation(message).text).toContain(TRUNCATION_NOTE);
  });

  it("closes an unterminated code block so the note renders outside it", () => {
    const message = new AIMessage({
      content: "Example:\n\n```python\nfor part in graph.stream(",
      additional_kwargs: { stop_reason: "max_tokens" },
    });
    expect(noteTruncation(message).text).toBe(
      `Example:\n\n\`\`\`python\nfor part in graph.stream(\n\`\`\`\n\n${TRUNCATION_NOTE}`,
    );
  });

  it("leaves completed answers and tool calls untouched", () => {
    for (const message of [
      new AIMessage({ content: "Done", additional_kwargs: { stop_reason: "end_turn" } }),
      new AIMessage({ content: "Done", response_metadata: { finish_reason: "stop" } }),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "t1", name: "search", args: {} }],
        additional_kwargs: { stop_reason: "max_tokens" },
      }),
    ]) {
      expect(noteTruncation(message)).toBe(message);
    }
  });
});

describe("createModel", () => {
  const env = { LANGSMITH_GATEWAY_API_KEY: "g" };

  it("builds the chosen provider's chat model", () => {
    expect(createModel(env)).toBeInstanceOf(ChatAnthropic);
    expect(createModel(env, "gpt-6-luna")).toBeInstanceOf(ChatOpenAI);
  });
});
