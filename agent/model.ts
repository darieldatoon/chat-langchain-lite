import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { createMiddleware } from "langchain";

type Env = Record<string, string | undefined>;

export const GATEWAY_ANTHROPIC_URL = "https://gateway.smith.langchain.com/anthropic";
export const GATEWAY_OPENAI_URL = "https://gateway.smith.langchain.com/openai/v1";

export const MODEL_CHOICES = ["claude-haiku-5-5", "gpt-6-luna"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];
export const DEFAULT_MODEL: ModelChoice = "claude-haiku-5-5";

export const MAX_OUTPUT_TOKENS = 4096;

// Anthropic reports `max_tokens` and OpenAI reports `length` when the output budget runs out.
const OUTPUT_LIMIT_STOP_REASONS = ["max_tokens", "length"];

export const TRUNCATION_NOTE =
  "_This answer hit the length limit and was cut off. Ask me to continue, or to focus on one part._";

export function chooseModel(value: unknown): ModelChoice {
  return MODEL_CHOICES.find((choice) => choice === value) ?? DEFAULT_MODEL;
}

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
    maxTokens: MAX_OUTPUT_TOKENS,
    thinking: { type: "disabled" as const },
  };
}

export function gptLunaOptions(env: Env) {
  return {
    model: "gpt-6-luna",
    apiKey: gatewayApiKey(env),
    configuration: { baseURL: GATEWAY_OPENAI_URL },
    // The Gateway route speaks Chat Completions, not the Responses API.
    useResponsesApi: false,
    maxTokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: "none" as const },
  };
}

// Streamed Anthropic responses carry the stop reason in additional_kwargs, not response_metadata.
function stopReason(message: AIMessage): unknown {
  return (
    message.response_metadata?.stop_reason ??
    message.response_metadata?.finish_reason ??
    message.additional_kwargs?.stop_reason
  );
}

/** Appends a visible note to a final answer that stopped at the output limit. */
export function noteTruncation(message: AIMessage): AIMessage {
  if (
    message.tool_calls?.length ||
    !OUTPUT_LIMIT_STOP_REASONS.includes(String(stopReason(message)))
  ) {
    return message;
  }
  const openFence = (message.text.match(/```/g)?.length ?? 0) % 2 === 1;
  const note = `${openFence ? "\n```" : ""}\n\n${TRUNCATION_NOTE}`;
  return new AIMessage({
    id: message.id,
    name: message.name,
    content:
      typeof message.content === "string"
        ? message.content + note
        : [...message.content, { type: "text", text: note }],
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
    usage_metadata: message.usage_metadata,
    invalid_tool_calls: message.invalid_tool_calls,
  });
}

export const truncationNoteMiddleware = createMiddleware({
  name: "TruncationNoteMiddleware",
  wrapModelCall: async (request, handler) => noteTruncation(await handler(request)),
});

export function createModel(
  env: Env,
  choice: ModelChoice = DEFAULT_MODEL,
): ChatAnthropic | ChatOpenAI {
  return choice === "gpt-6-luna"
    ? new ChatOpenAI(gptLunaOptions(env))
    : new ChatAnthropic(modelOptions(env));
}
