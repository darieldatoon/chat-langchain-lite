export type Cells = Readonly<Record<string, string>>;
export type Fill = "" | "green" | "yellow" | "red" | "blue" | "purple";
export type Fills = Readonly<Record<string, Fill>>;

export interface ReviewRow {
  readonly runId: string;
  readonly question: string;
  readonly answer: string;
}

export const COLUMNS = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
export const ROW_COUNT = 40;
export const ROWS = Array.from({ length: ROW_COUNT }, (_, index) => index + 1);
const HEADER_ROW = 5;
/** Queue rows that fit under the header. */
export const MAX_REVIEW_ROWS = ROW_COUNT - HEADER_ROW;

export const FILLS: readonly { readonly label: string; readonly value: Fill }[] = [
  { label: "None", value: "" },
  { label: "Green", value: "green" },
  { label: "Yellow", value: "yellow" },
  { label: "Red", value: "red" },
  { label: "Blue", value: "blue" },
  { label: "Purple", value: "purple" },
];

const HEADERS = ["Run", "Input", "Output", "Correctness", "Evidence", "Status"];

export function starterCells(queueName: string): Cells {
  return {
    A1: "ANNOTATION REVIEW WORKBOOK",
    A2: "Queue",
    B2: queueName,
    A3: "Tip",
    B3: "Select a cell, type to edit, then use the paint colors above.",
    ...Object.fromEntries(
      HEADERS.map((header, index) => [`${COLUMNS[index]}${HEADER_ROW}`, header]),
    ),
  };
}

export function starterFills(): Fills {
  const banner = (row: number) =>
    HEADERS.map((_, index) => [`${COLUMNS[index]}${row}`, "green"] as const);
  return Object.fromEntries([
    ...banner(1),
    ["A2", "blue"],
    ["A3", "yellow"],
    ...banner(HEADER_ROW),
  ]);
}

/** The queue's runs under the header, one per row. */
export function reviewCells(rows: readonly ReviewRow[]): Cells {
  return Object.fromEntries(
    rows.slice(0, MAX_REVIEW_ROWS).flatMap((row, index) => {
      const line = HEADER_ROW + 1 + index;
      return [
        [`A${line}`, row.runId.slice(0, 12)],
        [`B${line}`, row.question],
        [`C${line}`, row.answer],
        [`F${line}`, "Pending"],
      ];
    }),
  );
}
