"""One-command demo provisioning — the single front door for `make demo-setup`.

Runs every step needed to stand up the LangSmith ADLC demo (Build → Test →
Deploy → Monitor) idempotently, so re-running is safe. Each step shells out to a
focused script via `python -m` so the steps stay independently runnable.

Steps marked PLANNED are the net-new feature scripts being built out across the
demo phases; they print a one-line notice until their script lands, so this
orchestrator is the complete picture of the demo's provisioning from day one.

Usage:
    python -m scripts.provision            # provision everything that's ready
    python -m scripts.provision --list     # show the full plan without running
"""

import argparse
import subprocess
import sys
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv(override=True)

from chat_langchain_lite.config import settings  # noqa: E402 — env must load first


@dataclass
class Step:
    stage: str  # Build | Test | Deploy | Monitor
    label: str
    module: str | None  # `python -m <module>`; None ⇒ PLANNED (not yet built)
    args: tuple[str, ...] = ()


# Ordered provisioning plan. PLANNED rows (module=None) are filled in as each
# phase's script lands — keep them here so the plan reads end-to-end.
PLAN: list[Step] = [
    # ── Build ──────────────────────────────────────────────────────────────
    # Prompt Hub first: the judge prompt must exist before the baseline
    # experiments (run inside scripts.setup) pull it.
    Step("Build", "Seed Prompt Hub with the LLM-as-judge evaluator prompt", "scripts.push_prompts"),
    Step(
        "Build",
        "Seed Context Hub (AGENTS.md + demo skills), project, dataset, "
        "online evaluators, baseline experiments",
        "scripts.setup",
    ),
    # ── Test ───────────────────────────────────────────────────────────────
    Step(
        "Test",
        "Pairwise experiment (Haiku vs Sonnet, judged head-to-head)",
        "scripts.run_pairwise",
    ),
    # ── Monitor (needs traffic + monitoring infra) ───────────────────────────
    Step(
        "Monitor", "Generate demo traffic (single-turn traces + threads)", "scripts.generate_traces"
    ),
    Step(
        "Monitor",
        "Create the review annotation queue + feedback→queue automation + Correctness eval",
        "scripts.build_monitoring",
    ),
    # Monitoring dashboards and Insights are UI walkthroughs (no create API); the
    # built-in project Monitor tab renders the charts from the data above. See DEMO.md.
]


def _run(step: Step) -> None:
    assert step.module is not None  # PLANNED steps are filtered out before _run
    cmd = [sys.executable, "-m", step.module, *step.args]
    print(f"\n\033[1m▶ [{step.stage}] {step.label}\033[0m\n  $ {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="Show the plan, run nothing")
    args = parser.parse_args()

    print(
        f"Provisioning demo for presenter '{settings.demo_presenter}' "
        f"(project '{settings.langsmith_project}')."
    )

    if args.list:
        for s in PLAN:
            marker = "READY  " if s.module else "PLANNED"
            print(f"  [{marker}] {s.stage:<8} {s.label}")
        return

    ran = skipped = 0
    for step in PLAN:
        if step.module is None:
            print(f"\n  ⏭  [{step.stage}] {step.label}  (PLANNED — script not built yet)")
            skipped += 1
            continue
        _run(step)
        ran += 1

    print(f"\n\033[1mDone.\033[0m Ran {ran} step(s), {skipped} planned step(s) pending.")
    print("Next: deploy with `langgraph` (or `make dev` locally), then walk DEMO.md.")


if __name__ == "__main__":
    main()
