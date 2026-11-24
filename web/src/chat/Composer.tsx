import {
  ChatComposer,
  ChatComposerInput,
  ChatComposerToolbar,
} from "@langchain/macaw-components/ChatComposer";
import { useState } from "react";

interface ComposerProps {
  readonly busy: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
}

export function Composer({ busy, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState("");
  const message = text.trim();

  const send = () => {
    onSend(message);
    setText("");
  };

  const input = (
    <>
      <ChatComposerInput
        value={text}
        onChange={setText}
        placeholder="Ask about LangChain, LangGraph, LangSmith or Deep Agents…"
        maxHeight={200}
        aria-label="Message"
      />
      <ChatComposerToolbar />
    </>
  );

  return busy ? (
    <ChatComposer action="stop" onStop={onStop}>
      {input}
    </ChatComposer>
  ) : (
    <ChatComposer submitDisabled={!message} onSubmit={send}>
      {input}
    </ChatComposer>
  );
}
