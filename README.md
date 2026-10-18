# Chat LangChain Lite

A small LangChain docs assistant that Deployed Engineers use to demo LangSmith. It runs as a TypeScript [Managed Deep Agent](https://docs.langchain.com/langsmith/javascript/managed-deep-agents-quickstart) with a React chat app on GitHub Pages.

## Repo layout

```
agent/   Managed Deep Agent (deployed with mda)
web/     Vite+ / React / Macaw chat app (GitHub Pages)
scripts/ setup and deploy helpers
```

`agent/` and `web/` share one pnpm workspace. `agent/` must never contain a lockfile: `mda` copies the folder into its build, and a lockfile there breaks LangSmith's builder.

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
| `mise run deploy -- development` | Deploy the `development` environment to `LANGSMITH_WORKSPACE_ID` |
| `mise run deploy -- production` | Deploy the `production` environment |

## How deploys work

One agent, `chat-langchain-lite`, per workspace, with two environments:

| Environment | Deploys from | Deployment type |
|---|---|---|
| `production` | `main` | `PRODUCTION_DEPLOYMENT_TYPE` (default `dev`) |
| `development` | `development` | `dev` |

GitHub Actions runs CI, then `mda deploy`, on every push to those branches. A pushed `development` branch keeps a "Promote development → main" PR open.

The deployment type is fixed when a deployment is first created. Changing it later means deleting and recreating the deployment.

## Fork setup

1. Fork this repo and create a `development` branch from `main`.
2. In **Settings → Secrets and variables → Actions**, add:

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `LANGSMITH_API_KEY` | Your LangSmith personal access token |
   | Secret | `LANGSMITH_GATEWAY_API_KEY` | Your `LC_GATEWAY_KEY` |
   | Variable | `LANGSMITH_WORKSPACE_ID` | Your workspace id |

3. In **Settings → Pages**, set the source to **GitHub Actions**. In **Settings → Actions → General**, allow GitHub Actions to create pull requests.
4. In **Actions → Deploy agent**, run the workflow with the `development` branch selected, then with `main`. Copy each Agent Server URL from the run summary into the `VITE_AGENT_URL_DEVELOPMENT` and `VITE_AGENT_URL_PRODUCTION` variables.
5. Run **Actions → Pages**. Your app is at `https://<you>.github.io/<repo>/`.

Sign in with your LangSmith personal access token. It stays in the browser tab and is sent only to your agent and to the LangSmith API.
