# Review Sheet

A [LangSmith custom app](https://docs.langchain.com/langsmith/custom-apps) that shows the
`chat-langchain-lite-triage` annotation queue as a spreadsheet. Each thumbs-down run waiting on
you gets a row with the user's question and the agent's answer. Type notes into any cell, color
it, and use the formula bar like you would in a workbook.

It's for demos to analyst audiences who'd rather review in a grid than a queue. Edits stay in
the browser: the sheet doesn't write feedback back to the queue.

## Where it runs

Prepare's `app` step (`evals/src/app.ts`) builds this directory and pushes it to the workspace
as `chat-langchain-lite-triage-sheet`, updating the app if it already exists. It runs in
`mise run demo:install`, `mise run demo:prepare` and the **Prepare demo** workflow. Open it from
**Custom apps** in LangSmith. `mise run demo:uninstall` deletes it.

The app finds the triage queue by name, so the same build works in any workspace the demo is
installed in. An empty queue shows a blank sheet.

## Work on it

```sh
mise run //triage-sheet:dev    # preview in a local LangSmith sandbox; rebuilds on save
mise run //triage-sheet:test   # Vitest at 100% coverage
mise run //triage-sheet:check  # Vite+ format, lint and typecheck, then build
```

`dev` calls the API with your `langsmith` CLI credentials (`langsmith auth login`, or
`LANGSMITH_API_KEY` and `LANGSMITH_WORKSPACE_ID`), so choose the workspace the demo is installed
in.

Change the app here, not in LangSmith's browser editor: the next Prepare run replaces the
pushed app with this directory. `context.md` records the design decisions and API quirks;
`AGENTS.md` is the guide for coding agents.
