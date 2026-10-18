# Agent instructions

Chat LangChain Lite is a LangSmith demo app: a TypeScript Managed Deep Agent (`agent/`) and a Vite+ React chat app (`web/`) in one pnpm workspace, run through `mise`.

## Commands

- `mise run check` and `mise run test` must pass before you commit. Git hooks (lefthook) run them on push.
- Format with `pnpm exec oxfmt` in `agent/` and `evals/`, and `pnpm exec vp fmt` in `web/`.
- Install packages through Socket Firewall: `sfw pnpm add …`. Pin exact versions.

## Rules that look removable but aren't

- **No lockfile in `agent/`** and no `workspace:` or `catalog:` versions in `agent/package.json`. `mda` copies `agent/` into its build; a lockfile makes LangSmith's builder use pnpm and fail. `scripts/check-agent-manifest.mjs` enforces this.
- **Pin every runtime package `mda` injects** in `agent/package.json` (see `crates/mda/src/dependencies.rs` in the MDA SDK). Unpinned, they float on each deploy.
- **`thinking` stays disabled** on the model. `agent/tests/model.test.ts` enforces it.
- **The assistant id `chat-langchain-lite`** appears in `agent/agent.ts`, `web/src/config.ts` and `evals/src/agent.ts`. Change all three or none.
- **The `Assertions (auto-attached)` rule name** in `evals/src/evaluators.ts` must stay exact. Adding assertion examples from an annotation queue creates a duplicate judge under any other name.
- **`MDA_CORS_ORIGINS` must include `https://smith.langchain.com`.** It replaces the deployment's default CORS allow-list; without it the LangSmith UI (Deployments, Studio) can't reach the agent.
- **No `[env]` defaults in the root `mise.toml`.** mise env overrides CI's variables.
- **Secrets live only in `agent/.env`.** Never add keys to Vite env (`VITE_*` values are public) or commit them.

## Layout

- `agent/model.ts`: the Gateway model (Haiku 5.5 via `LANGSMITH_GATEWAY_API_KEY`).
- `agent/identity.ts`: PAT auth; deployments admit members of their workspace only.
- `web/src/chat/turns.ts`: messages → render-ready turns (pure, tested).
- `web/src/components/`: chat components copied from LangSmith's design system; keep upstream edits minimal.
- `evals/`: the prepare step (`src/prepare.ts`), the seed dataset and the hosted JavaScript evaluator. `evals/evaluators/cites-retrieved-docs.js` runs in LangSmith's sandbox: no imports, every helper inside `performEval`.
