// Reads the question and answer out of a chat-langchain-lite run. Inputs hold the chat app's
// `{ role, content }` messages; outputs hold the agent's state, whose messages are either
// `{ type, content }` or LangChain-serialized (`{ lc, id: [..., "AIMessage"], kwargs }`).

type Message = Record<string, unknown>;

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const HUMAN = new Set(["user", "human", "HumanMessage"]);
const AI = new Set(["assistant", "ai", "AIMessage", "AIMessageChunk"]);

function role(message: Message): unknown {
  if (message.lc !== undefined) return Array.isArray(message.id) ? message.id.at(-1) : undefined;
  return message.role ?? message.type;
}

/** A message's visible text: a string, or the text blocks of a content list (tool calls have none). */
export function messageText(message: Message): string {
  const content = message.lc !== undefined ? asRecord(message.kwargs).content : message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => asRecord(block).text)
    .filter((text): text is string => typeof text === "string" && text !== "")
    .join("\n");
}

function lastText(state: unknown, roles: ReadonlySet<unknown>): string {
  const messages = asRecord(state).messages;
  if (!Array.isArray(messages)) return "";
  for (const message of [...messages].reverse().map(asRecord)) {
    const text = roles.has(role(message)) ? messageText(message) : "";
    if (text) return text;
  }
  return "";
}

/** The user's latest question. */
export const question = (inputs: unknown) => lastText(inputs, HUMAN);

/** The agent's final answer, skipping tool results and tool-call-only turns. */
export const answer = (outputs: unknown) => lastText(outputs, AI);
