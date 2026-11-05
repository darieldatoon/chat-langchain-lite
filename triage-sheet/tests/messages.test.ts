import { describe, expect, it } from "vite-plus/test";

import { answer, asRecord, messageText, question } from "../src/messages";

describe("asRecord", () => {
  it("passes objects through and turns anything else into an empty record", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect([null, [], "x", 1].map(asRecord)).toEqual([{}, {}, {}, {}]);
  });
});

describe("messageText", () => {
  it("joins the text blocks of a content list, skipping tool calls", () => {
    const content = [
      { type: "text", text: "First." },
      { type: "tool_use", id: "t1" },
      { type: "text", text: "" },
      { type: "text", text: "Second." },
    ];
    expect(messageText({ type: "ai", content })).toBe("First.\nSecond.");
  });

  it("reads a serialized message's kwargs", () => {
    expect(messageText({ lc: 1, kwargs: { content: "Hi" }, content: "ignored" })).toBe("Hi");
  });

  it("is empty for content it can't read", () => {
    expect(messageText({ content: { text: "not a list" } })).toBe("");
  });
});

describe("question", () => {
  it("is the user's latest message, as the chat app sends it", () => {
    const inputs = {
      messages: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "An answer" },
        { role: "user", content: "Follow-up" },
      ],
    };
    expect(question(inputs)).toBe("Follow-up");
  });

  it("is empty without messages", () => {
    expect(question(undefined)).toBe("");
    expect(question({ messages: "nope" })).toBe("");
  });
});

describe("answer", () => {
  it("is the agent's last text, not a tool result or a tool-call-only turn", () => {
    const outputs = {
      messages: [
        { type: "human", content: "Q" },
        { type: "ai", content: [{ type: "text", text: "The answer" }] },
        { type: "ai", content: [{ type: "tool_use", id: "t1" }] },
        { type: "tool", content: "exit: 0" },
      ],
    };
    expect(answer(outputs)).toBe("The answer");
  });

  it("reads LangChain-serialized messages by their class name", () => {
    const outputs = {
      messages: [
        {
          lc: 1,
          type: "constructor",
          id: ["langchain_core", "messages", "AIMessage"],
          kwargs: { content: "Serialized" },
        },
        { lc: 1, type: "constructor", id: "malformed", kwargs: { content: "Skipped" } },
      ],
    };
    expect(answer(outputs)).toBe("Serialized");
  });

  it("is empty when the agent never answered", () => {
    expect(answer({ messages: [{ type: "human", content: "Q" }] })).toBe("");
  });
});
