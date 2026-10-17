import { describe, expect, it } from "vitest";

import { GATEWAY_ANTHROPIC_URL, gatewayApiKey, modelOptions } from "../model.js";

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

  it("keeps planted bug B1 visible: 300-token cap with thinking off", () => {
    expect(options.maxTokens).toBe(300);
    expect(options.thinking).toEqual({ type: "disabled" });
  });
});
