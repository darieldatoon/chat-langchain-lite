# Review Sheet

## Purpose and audience

A spreadsheet-style annotation workbook for the `chat-langchain-lite-triage` annotation queue. It is for reviewers who want a spreadsheet canvas, not a queue dashboard, such as analysts used to working in a workbook.

## Key files and data flow

- `src/entry.tsx` exports `render`, creates the React root, the stylesheet and the `Api` once, and wraps the app in `ErrorBoundary`.
- `src/api.ts` is every LangSmith call. `reviewRows()` finds the queue by name, lists up to 35 items waiting on this reviewer, and fetches each run in parallel.
- `src/messages.ts` reads a run's question (the user's last message) and answer (the agent's last text message). `src/sheet.ts` holds the grid's shape, starter cells and fills, and turns review rows into cells. Both are pure.
- `src/App.tsx` renders the grid, ribbon and formula bar. The formula bar shows the selected cell; it isn't separate state.
- `src/index.css` recreates a desktop spreadsheet's visual language: green title bar and ribbon, formula bar, frozen headers, cell selection, fill colors, and status bar.

## Decisions

- The app finds `chat-langchain-lite-triage` by name at load, so one build works in every workspace the demo installs into. Don't hard-code a queue id.
- The user requested a spreadsheet clone, so this intentionally departs from the Macaw visual default. It doesn't use Microsoft's Excel name or logo: the source is public. It has the familiar green title bar/ribbon, formatting controls, a dense grid, and semantic review colors.
- Macaw and Tailwind were removed: the app rendered no Macaw component and used no Tailwind class, and they made the bundle about 2 MB instead of about 230 KB.
- Light-only, like the spreadsheet it imitates.
- Fill color applies to the current selected cell. Workbook edits are local draft interactions; this version does not submit annotation feedback back to the queue. Rows that load after the reviewer starts typing merge under their edits.
- Column A shows the run id (the header says Run), not the queue item id.

## Non-obvious API behavior

- Queue items are metadata-only (`id`, `item_type`, `run_id`, …), so each run is fetched with `GET /api/v1/runs/{run_id}`. A run that fails to load keeps its row with empty input and output.
- The items endpoint needs the `/platform/` prefix; the plain `/api/v1/annotation-queues/{id}/items` 404s on SaaS. It accepts `needs_my_review`, `needs_others_review`, or `archived`; the sheet uses `needs_my_review` and asks for one page of 35, the rows that fit under the header.
- Run inputs hold the chat app's `{ role: "user", content }` messages. Outputs hold the agent's state: `{ type: "ai" | "tool", content }` messages whose content is a string or a list of blocks, or LangChain-serialized messages with the text in `kwargs.content`. The answer is the last AI message with text, so a trailing tool result or tool-call-only turn is skipped.
