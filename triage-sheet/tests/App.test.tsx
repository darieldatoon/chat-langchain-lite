import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import type { Api } from "../src/api";
import { App } from "../src/App";
import type { ReviewRow } from "../src/sheet";

function deferred() {
  let resolve!: (rows: ReviewRow[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReviewRow[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderApp(reviewRows: Api["reviewRows"]) {
  render(<App api={{ reviewRows }} />);
  return { cell: (address: string) => screen.getByLabelText(address) as HTMLInputElement };
}

const formulaBar = () => screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;

describe("App", () => {
  it("syncs, then fills the sheet with the queue's runs", async () => {
    const load = deferred();
    const { cell } = renderApp(() => load.promise);
    expect(screen.getByText("Syncing…")).toBeInTheDocument();
    load.resolve([{ runId: "r-1", question: "What is LangGraph?", answer: "A runtime." }]);
    expect(await screen.findByText("1 queue rows loaded")).toBeInTheDocument();
    expect(cell("B6").value).toBe("What is LangGraph?");
    expect(cell("C6").value).toBe("A runtime.");
    expect(cell("B2").value).toBe("chat-langchain-lite-triage");
  });

  it("keeps what the reviewer typed while the queue loaded", async () => {
    const load = deferred();
    const { cell } = renderApp(() => load.promise);
    await userEvent.type(cell("D6"), "wrong");
    load.resolve([{ runId: "r-1", question: "Q", answer: "A" }]);
    await screen.findByText("1 queue rows loaded");
    expect(cell("D6").value).toBe("wrong");
  });

  it("says so when the queue is empty", async () => {
    renderApp(async () => []);
    expect(await screen.findByText(/Queue is empty/)).toBeInTheDocument();
  });

  it("stays usable when the queue can't load", async () => {
    const load = deferred();
    const { cell } = renderApp(() => load.promise);
    load.reject(new Error("403"));
    expect(await screen.findByText(/could not load/)).toBeInTheDocument();
    await userEvent.type(cell("B6"), "notes");
    expect(cell("B6").value).toBe("notes");
  });

  it("edits the selected cell from the formula bar, and shows the cell's value there", async () => {
    const { cell } = renderApp(async () => []);
    expect(formulaBar().value).toBe("ANNOTATION REVIEW WORKBOOK");
    await userEvent.click(cell("C7"));
    expect(screen.getByText("C7", { selector: ".name-field" })).toBeInTheDocument();
    await userEvent.type(formulaBar(), "From the bar");
    expect(cell("C7").value).toBe("From the bar");
    await userEvent.type(cell("C7"), "!");
    expect(formulaBar().value).toBe("From the bar!");
  });

  it("selects a cell by clicking around its input", async () => {
    const { cell } = renderApp(async () => []);
    await userEvent.click(cell("E9").closest("td")!);
    expect(cell("E9").closest("td")).toHaveClass("selected");
  });

  it("paints the selected cell", async () => {
    const { cell } = renderApp(async () => []);
    await userEvent.click(cell("D8"));
    const red = screen.getByLabelText("Fill selected cell Red");
    await userEvent.click(red);
    expect(cell("D8").closest("td")).toHaveClass("fill-red");
    expect(red).toHaveClass("paint-active");
    await userEvent.click(screen.getByLabelText("Fill selected cell None"));
    expect(cell("D8").closest("td")).not.toHaveClass("fill-red");
  });
});
