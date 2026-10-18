import { ChatAnthropic } from "@langchain/anthropic";

type Env = Record<string, string | undefined>;

export const GATEWAY_ANTHROPIC_URL = "https://gateway.smith.langchain.com/anthropic";

// Deploy fills a blank LANGSMITH_GATEWAY_API_KEY from the deploy key, which can't call the Gateway,
// so require a real key instead of falling back.
export function gatewayApiKey(env: Env): string {
  const key = env.LANGSMITH_GATEWAY_API_KEY;
  if (!key) {
    throw new Error(
      "LANGSMITH_GATEWAY_API_KEY is not set. Run `mise run setup` or add it to agent/.env.",
    );
  }
  return key;
}

export function modelOptions(env: Env) {
  return {
    model: "claude-haiku-5-5",
    anthropicApiUrl: GATEWAY_ANTHROPIC_URL,
    apiKey: gatewayApiKey(env),
    maxTokens: 900,
    thinking: { type: "disabled" as const },
  };
}

export function createModel(env: Env): ChatAnthropic {
  return new ChatAnthropic(modelOptions(env));
}
