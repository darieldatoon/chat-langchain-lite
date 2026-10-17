import { textOf } from "./turns";

export interface ThreadSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

interface ThreadRow {
  readonly thread_id: string;
  readonly updated_at: string;
  readonly metadata?: Record<string, unknown> | null;
  readonly extracted?: Record<string, unknown> | null;
}

const TITLE_LENGTH = 60;

export function toTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > TITLE_LENGTH ? `${clean.slice(0, TITLE_LENGTH - 1)}…` : clean;
}

// The app stores metadata.title when it creates a thread; extract covers servers that support it.
export function toThreadSummaries(rows: readonly ThreadRow[]): ThreadSummary[] {
  return rows.map((row) => {
    const stored = typeof row.metadata?.title === "string" ? row.metadata.title : "";
    const title = toTitle(stored || textOf(row.extracted?.first));
    return {
      id: row.thread_id,
      title: title || "Untitled conversation",
      updatedAt: row.updated_at,
    };
  });
}

/** Maps each turn to its run: every submit creates exactly one run, in order. */
export function mergeRunIds(
  history: readonly { run_id: string; created_at: string }[],
  live: readonly string[],
) {
  const ordered = [...history]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((run) => run.run_id);
  return [...new Set([...ordered, ...live])];
}
