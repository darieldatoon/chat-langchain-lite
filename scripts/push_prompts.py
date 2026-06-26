"""Seed LangSmith Prompt Hub with the LLM-as-judge evaluator prompt.

Pushes the local source-of-truth template (chat_langchain_lite.prompts) under the
presenter-scoped ref, tagged ``production`` — the tag the offline evaluator pulls.
Re-running pushes a new commit and re-points the ``production`` tag. The prompt
resource is tagged with the Application resource tag. Idempotent.

Usage:
    python -m scripts.push_prompts
"""

from dotenv import load_dotenv

load_dotenv(override=True)

from langsmith import Client  # noqa: E402 — env must load first
from langsmith.utils import LangSmithConflictError  # noqa: E402

from chat_langchain_lite.config import settings  # noqa: E402
from chat_langchain_lite.prompts import build_judge_template  # noqa: E402
from scripts.resource_tags import tag_resource  # noqa: E402


def push_judge_prompt() -> None:
    ref = settings.judge_prompt_ref
    print(f"\n[*] Pushing judge prompt '{ref}' to Prompt Hub (tag: production)...")
    client = Client()
    try:
        url = client.push_prompt(
            ref,
            object=build_judge_template(),
            commit_tags=["production"],
            description="Chat LangChain Lite — LLM-as-judge for offline assertion evals",
        )
        print(f"  Pushed: {url}")
    except LangSmithConflictError:
        # Content unchanged since the last commit — already up to date, no-op.
        print("  Prompt already up to date (no changes to commit).")
    # Tag the prompt resource with Application (best-effort).
    try:
        prompt = client.get_prompt(ref)
        tag_resource("prompt", getattr(prompt, "id", None))
    except Exception as exc:
        print(f"  ⚠️  could not tag prompt: {exc}")


def main() -> None:
    push_judge_prompt()


if __name__ == "__main__":
    main()
