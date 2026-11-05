import { describe, expect, it } from "vite-plus/test";

import { MAX_REVIEW_ROWS, reviewCells, ROWS, starterCells, starterFills } from "../src/sheet";

describe("starterCells", () => {
  it("names the queue and labels the header row", () => {
    const cells = starterCells("my-queue");
    expect(cells.B2).toBe("my-queue");
    expect(["A5", "B5", "C5", "F5"].map((address) => cells[address])).toEqual([
      "Run",
      "Input",
      "Output",
      "Status",
    ]);
  });
});

describe("starterFills", () => {
  it("colors the title and header rows", () => {
    const fills = starterFills();
    expect(fills.A1).toBe("green");
    expect(fills.F5).toBe("green");
    expect(fills.G5).toBeUndefined();
    expect([fills.A2, fills.A3]).toEqual(["blue", "yellow"]);
  });
});

describe("reviewCells", () => {
  const row = (index: number) => ({
    runId: `01a1a25c-bec8-7232-${index}`,
    question: `Q${index}`,
    answer: `A${index}`,
  });

  it("puts each run on its own row under the header, pending review", () => {
    expect(reviewCells([row(0)])).toEqual({
      A6: "01a1a25c-bec",
      B6: "Q0",
      C6: "A0",
      F6: "Pending",
    });
  });

  it("drops rows past the bottom of the sheet", () => {
    const cells = reviewCells(Array.from({ length: MAX_REVIEW_ROWS + 3 }, (_, i) => row(i)));
    const last = ROWS.at(-1);
    expect(cells[`B${last}`]).toBe(`Q${MAX_REVIEW_ROWS - 1}`);
    expect(cells[`B${last! + 1}`]).toBeUndefined();
  });
});
