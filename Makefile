.DEFAULT_GOAL := help
.PHONY: help install dev preview-sync demo-setup demo-reset demo-reset-full traces evals lint format typecheck check

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Sync deps and install git hooks (run once per clone)
	uv sync
	uv run lefthook install

dev: ## Run the LangGraph server + mounted chat UI (http://localhost:2024)
	uv run langgraph dev

# Engine-climax helper: point the standing Production preview deployment (linked to
# the `preview` branch with auto-update-on-push) at an Engine PR branch. `preview`
# is a disposable branch we overwrite each demo, so the push is a force update.
preview-sync: ## Force-push REF (an Engine PR branch on origin) onto `preview` to redeploy the preview build
ifndef REF
	$(error REF is required, e.g. `make preview-sync REF=engine/fix-bugs`)
endif
	git fetch origin
	git push origin "+origin/$(REF):preview"

demo-setup: ## Provision all LangSmith demo state (idempotent)
	uv run python -m scripts.provision

demo-reset: ## Reset the demo to a clean state (keeps the project)
	uv run python -m scripts.cleanup

demo-reset-full: ## Reset + delete the LangSmith project and Context Hub repos
	uv run python -m scripts.cleanup --full

traces: ## Generate demo traffic (single-turn traces + threads)
	uv run python -m scripts.generate_traces

evals: ## Run the offline eval suite against the dataset
	uv run python -m scripts.run_evals

lint: ## Lint with ruff
	uv run ruff check src evals scripts

format: ## Format with ruff
	uv run ruff format src evals scripts

typecheck: ## Type-check with ty
	uv run ty check

check: lint typecheck ## Lint + typecheck (what the commit hook runs)
