import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

describe("render", () => {
  it("mounts once, styles once and loads the queue once across host updates", async () => {
    const call = vi.fn(async () => []);
    window.langsmith = { call };
    const { default: entry } = await import("../src/entry");
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => entry.render({}, container));
    await act(async () => entry.render({}, container));

    expect(document.head.querySelectorAll("style")).toHaveLength(1);
    expect(screen.getByText(/could not load/)).toBeInTheDocument();
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith("GET /api/v1/annotation-queues", {
      params: { name: "chat-langchain-lite-triage" },
    });
  });
});
