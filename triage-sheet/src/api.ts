// The LangSmith API as the app uses it. `call` is `window.langsmith.call`, injected for tests.
import { answer, asRecord, question } from "./messages";
import { MAX_REVIEW_ROWS, type ReviewRow } from "./sheet";

export type Call = (
  operation: string,
  args?: { params?: Record<string, string | string[]>; body?: unknown },
) => Promise<unknown>;

// evals/src/triage.ts creates this queue; its id differs per workspace.
export const QUEUE_NAME = "chat-langchain-lite-triage";

export interface Api {
  /** The runs waiting on this reviewer, with each run's question and answer. */
  readonly reviewRows: () => Promise<ReviewRow[]>;
}

export function createApi(call: Call): Api {
  async function queueId(): Promise<string> {
    const queues = await call("GET /api/v1/annotation-queues", { params: { name: QUEUE_NAME } });
    const match = (Array.isArray(queues) ? queues : [])
      .map(asRecord)
      .find((queue) => queue.name === QUEUE_NAME);
    if (typeof match?.id !== "string") throw new Error(`No annotation queue named ${QUEUE_NAME}`);
    return match.id;
  }

  // A run that fails to load still gets its row, so the reviewer can find it in LangSmith.
  async function row(runId: string): Promise<ReviewRow> {
    try {
      const run = asRecord(await call(`GET /api/v1/runs/${runId}`));
      return { runId, question: question(run.inputs), answer: answer(run.outputs) };
    } catch {
      return { runId, question: "", answer: "" };
    }
  }

  return {
    async reviewRows() {
      // Items list membership only (no inputs or outputs). `/platform/` is required: the plain path 404s.
      const page = asRecord(
        await call(`GET /api/v1/platform/annotation-queues/${await queueId()}/items`, {
          params: { status: "needs_my_review", page_size: String(MAX_REVIEW_ROWS) },
        }),
      );
      const items = Array.isArray(page.items) ? page.items.map(asRecord) : [];
      const runIds = items.flatMap((item) =>
        typeof item.run_id === "string" ? [item.run_id] : [],
      );
      return Promise.all(runIds.map(row));
    },
  };
}
