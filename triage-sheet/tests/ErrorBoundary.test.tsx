import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ErrorBoundary } from "../src/ErrorBoundary";

function Throws({ value }: { value: unknown }): never {
  throw value;
}

const errorWith = (message: string, stack: string | undefined) =>
  Object.assign(new Error(message), { stack });

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const shown = (value: unknown) => {
    const { unmount } = render(
      <ErrorBoundary>
        <Throws value={value} />
      </ErrorBoundary>,
    );
    const detail = screen.getByRole("alert").querySelector("pre")!.textContent;
    unmount();
    return detail;
  };

  it("shows the stack, prepending the message where the engine leaves it out", () => {
    expect(shown(errorWith("boom", "Error: boom\n  at x"))).toBe("Error: boom\n  at x");
    expect(shown(errorWith("boom", "  at y"))).toBe("boom\n  at y");
  });

  it("shows the message without a stack, and anything else thrown as a string", () => {
    expect(shown(errorWith("no stack", undefined))).toBe("no stack");
    expect(shown("plain")).toBe("plain");
  });

  it("tries again when the host renders new children", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Throws value="first" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(
      <ErrorBoundary>
        <p>Recovered</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });
});
