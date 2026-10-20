# Chat LangChain Lite

A small LangChain docs assistant that Deployed Engineers use to demo LangSmith. It runs as a TypeScript [Managed Deep Agent](https://docs.langchain.com/langsmith/javascript/managed-deep-agents-quickstart) with a React chat app on GitHub Pages.

## Repo layout

```
agent/   Managed Deep Agent (deployed with mda)
web/     Vite+ / React / Macaw chat app (GitHub Pages)
evals/   eval dataset, hosted evaluators and the demo prepare step
scripts/ setup and deploy helpers
```

`agent/`, `web/` and `evals/` share one pnpm workspace. `agent/` must never contain a lockfile: `mda` copies the folder into its build, and a lockfile there breaks LangSmith's builder.

## Quick start

Prerequisite: [mise](https://mise.jdx.dev). It installs Node, pnpm, `gh`, `lefthook`, and the `langsmith` CLI.

```bash
mise install
mise run setup        # installs deps and git hooks, creates agent/.env
```

Then:

1. Put your LangSmith personal access token in `agent/.env` as `LANGSMITH_API_KEY`. On an MDM-managed Mac, `setup` fills `LANGSMITH_GATEWAY_API_KEY` from `LC_GATEWAY_KEY`; otherwise paste your LangChain Inc Gateway key.
2. Add your workspace to `mise.local.toml` (git-ignored):

   ```toml
   [env]
   LANGSMITH_WORKSPACE_ID = "<your workspace id>"
   ```

3. Run it:

   ```bash
   mise run dev          # agent on http://localhost:2024, app on http://localhost:5173
   ```

Locally, `mda dev` doesn't enforce sign-in, so any value works on the sign-in page. Deployed agents check that your token belongs to a member of their workspace.

## Tasks

| Task | What it does |
|---|---|
| `mise run setup` | Install dependencies and git hooks, create `agent/.env` |
| `mise run dev` | Run the agent and the web app locally |
| `mise run check` | Format check, lint and typecheck |
| `mise run test` | Unit tests |
| `mise run demo:prepare` | Seed the eval dataset, create the hosted evaluators and triage queue, send sample traffic, and pre-run the experiments |
| `mise run demo:install` | Set up, create both environments as GitHub-connected deployments, turn on previews and Engine fix verification, publish Pages, then run `demo:prepare` |
| `mise run demo:uninstall` | List everything the demo created in the workspace. `--yes` deletes it |

## Evals

`mise run demo:prepare` (or **Actions → Prepare demo**) gets a workspace ready for the demo. It's safe to re-run; finished work is skipped.

1. Seeds the `chat-langchain-lite` dataset from `evals/dataset/examples.json`. Each example is a question plus assertions a correct answer must satisfy.
2. Creates the hosted evaluators: the built-in Assertions judge, a Jev decision model for tone, a gpt-6-luna tone judge (`professional_tone_llm`) with an alignment queue for tuning it against human labels (on for experiments, attached but off for traces), a JavaScript check that answers cite the docs they searched, and LangSmith's Trajectory Accuracy judge on both tracing projects. It also creates a triage annotation queue that collects thumbs-down answers. The dataset, queue, evaluators and their prompts are tagged to the `chat-langchain-lite` agent, so they show up under it in LangSmith.
3. Sends sample questions to `production`.
4. Pre-runs three experiments: production, development, and development with gpt-6-luna.

Use `--only <steps>`, `--split demo` and `--roles <roles>` to run part of it. It needs `LANGSMITH_API_KEY` (from `agent/.env` or a repo secret), `LANGSMITH_WORKSPACE_ID`, both environments deployed, `development` ahead of `main` (it warns otherwise), and the workspace secret `LC_GATEWAY_KEY` for the tone evaluator.

## How deploys work

One agent, `chat-langchain-lite`, per workspace, with two environments. Both are GitHub-connected deployments: LangSmith rebuilds `agent/` from the environment's branch on every push.

| Environment | Builds from | Deployment type |
|---|---|---|
| `production` | `main` | `PRODUCTION_DEPLOYMENT_TYPE` when install creates it (default `dev`) |
| `development` | `development` | `dev` |

LangSmith builds whether or not CI passed, so `main` and `development` are protected: merging a pull request needs a passing `check`. Admins can still push directly.

Each build syncs `agent/instructions.md` and `agent/skills/` to a Context Hub repo named after the deployment, with git winning. The Gateway key and the CORS allow-list are deployment secrets, which `mise run demo:install` sets.

`development` runs one commit ahead of `main` on purpose, so the demo has a candidate to compare against production. To release it, open a pull request from `development` into `main` and merge it with a merge commit. A squash merge leaves `development` looking ahead with nothing new. After anything lands on `main` directly, merge `main` back into `development`.

A pull request into `development` labeled `preview` gets its own preview deployment. It's torn down when the pull request closes, or after 72 idle hours. Engine labels its fix pull requests this way, replays the issue's production traces against `development` and the preview, and shows on its board whether the fix worked.

The deployment type is fixed when a deployment is first created. Changing it later means deleting and recreating the deployment.

## Fork setup

1. Fork this repo with **Copy the `main` branch only** unchecked, so you get `development` too. For a fork that only has `main`, add the original repo as the `upstream` remote and run `git fetch upstream development && git push origin upstream/development:development`.
2. In LangSmith, start a new deployment from GitHub and give LangSmith's GitHub App access to your fork. You can cancel before creating the deployment.
3. Run `mise run demo:install`. It needs `gh` signed in and `agent/.env` filled in. It:
   - sets the `LANGSMITH_API_KEY` repo secret if it's missing, and the `LANGSMITH_WORKSPACE_ID` variable
   - protects `main` and `development`, and turns on GitHub Pages
   - creates both environments as GitHub-connected deployments and waits for their first build
   - sets the `VITE_AGENT_URL_DEVELOPMENT` and `VITE_AGENT_URL_PRODUCTION` variables, turns on previews for `development`, and points an existing Engine board at it
   - publishes Pages and runs `demo:prepare`

   Re-running skips what's done; `--redeploy` rebuilds both environments. A workspace whose environments were deployed with the mda CLI needs `--replace` once: it deletes them and creates them again from GitHub, keeping their tracing projects and rules.
4. Your app is at `https://<you>.github.io/<repo>/`.

Sign in with your LangSmith personal access token. It stays in the browser tab and is sent only to your agent and to the LangSmith API.

### Engine fix verification

Install doesn't create the Engine board, because creating one starts a paid scan. To set it up:

1. Enable Engine on the `chat-langchain-lite-production` tracing project.
2. Install Engine's GitHub App on your fork. It's a separate app from the deployments' one, and needs write access to checks, issues and pull requests.
3. Add the fork as the board's first repo, with subdirectory `agent` and base branch `development`.
4. Re-run `mise run demo:install`. It points the board at `development` and turns on fix verification.

Fix verification needs the `enable_engine_issue_validation` flag on the workspace.

## Uninstall

`mise run demo:uninstall` lists everything the demo created in the workspace, with what each evaluator is attached to. `mise run demo:uninstall -- --yes` deletes it in dependency order, re-checks, and lists what to remove by hand on GitHub and locally. It keeps the `LC_GATEWAY_KEY` workspace secret and the `user_score` feedback config, which other apps share.
