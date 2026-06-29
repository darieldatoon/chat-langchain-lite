"""Shared demo configuration — the single source of truth for the names that
scope this demo's LangSmith resources.

Lives in the runtime package (not in ``evals``) so the deployed agent can import
it without pulling in the eval/CI tooling. ``evals`` and ``scripts`` import the
``settings`` object from here.

Only non-secret, name-scoping values live here. API keys stay in the environment
and are read by the LangSmith / LangGraph clients directly — never loaded here.

Every name is built from one slug (``APP_SLUG``) plus ``demo_presenter`` so the
whole demo is consistently named and multiple demoers in one workspace don't
collide. Set ``DEMO_PRESENTER`` (local ``.env``) or a GitHub repo variable (CI).
"""

import os

from pydantic import ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The application slug — the single base for every demo resource name. Change it
# here and every dataset / project / prompt / experiment / tag name follows.
APP_SLUG = "chat-langchain-lite"

# Human-feedback keys emitted by the chat UI (web/app.py) and consumed by the
# monitoring automation. Single source of truth so the two can't drift.
USER_SCORE_KEY = "user_score"
USER_COMMENT_KEY = "user_comment"


class Settings(BaseSettings):
    """Demo-scoping config, loaded from the environment (or ``.env``)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    demo_presenter: str = "robert"
    # Tracing project. Defaults to f"{APP_SLUG}-{demo_presenter}" when unset, so it
    # stays consistent with every other name; override with LANGSMITH_PROJECT.
    langsmith_project: str = ""
    # Value of the LangSmith "Application" resource tag applied to every
    # provisioned resource. Defaults to the project name; override with APPLICATION.
    application: str = ""

    @field_validator("demo_presenter", mode="after")
    @classmethod
    def _presenter_fallback(cls, value: str) -> str:
        return (value or "").strip() or "robert"

    @field_validator("langsmith_project", mode="after")
    @classmethod
    def _project_default(cls, value: str, info: ValidationInfo) -> str:
        return (value or "").strip() or f"{APP_SLUG}-{info.data.get('demo_presenter', 'robert')}"

    @field_validator("application", mode="after")
    @classmethod
    def _application_default(cls, value: str, info: ValidationInfo) -> str:
        return (value or "").strip() or info.data.get("langsmith_project", "")

    # ── Derived resource names (all from APP_SLUG + demo_presenter) ───────────
    @property
    def app_slug(self) -> str:
        return APP_SLUG

    @property
    def dataset_name(self) -> str:
        return f"{APP_SLUG}-scope-{self.demo_presenter}"

    @property
    def tool_adherence_dataset_name(self) -> str:
        return f"{APP_SLUG}-tools-{self.demo_presenter}"

    @property
    def context_hub_repo(self) -> str:
        return f"{APP_SLUG}-agent-{self.demo_presenter}"

    @property
    def judge_prompt_ref(self) -> str:
        """Prompt Hub identifier for the LLM-as-judge evaluator prompt."""
        return f"{APP_SLUG}-judge-{self.demo_presenter}"

    @property
    def corrections_dataset_name(self) -> str:
        """Dataset that the annotation queue's reviewed/corrected runs flow into."""
        return f"{APP_SLUG}-corrections-{self.demo_presenter}"

    @property
    def review_queue_name(self) -> str:
        """Annotation queue for human review of thumbs-down responses."""
        return f"{APP_SLUG}-review-{self.demo_presenter}"

    @property
    def resource_prefix(self) -> str:
        """Common prefix for sweeping this demo's named resources in cleanup."""
        return f"{APP_SLUG}-"

    @property
    def online_eval_prefix(self) -> str:
        return f"{APP_SLUG}-demo-"

    def online_eval_display_name(self, feedback_key: str) -> str:
        return f"{APP_SLUG}-demo-{feedback_key}-online"

    # ── Experiment prefixes (evaluate() appends a random suffix) ──────────────
    def baseline_experiment_prefix(self, label: str) -> str:
        return f"baseline-{label}-{APP_SLUG}-{self.demo_presenter}"

    @property
    def engine_experiment_prefix(self) -> str:
        return f"engine-{APP_SLUG}-{self.demo_presenter}"

    def pairwise_experiment_prefix(self, label: str) -> str:
        return f"pairwise-{label}-{APP_SLUG}-{self.demo_presenter}"

    @property
    def pairwise_compare_prefix(self) -> str:
        return f"pairwise-compare-{APP_SLUG}-{self.demo_presenter}"


settings = Settings()
"""Import this and read attributes directly, e.g. ``settings.dataset_name``."""


def use_project_default() -> None:
    """Default ``LANGSMITH_PROJECT`` to ``settings.langsmith_project`` if unset.

    Makes ``DEMO_PRESENTER`` the single knob for where traces land in **local /
    CLI** runs (scripts, CI): with no ``LANGSMITH_PROJECT`` set, agent traces go
    to ``chat-langchain-lite-<presenter>`` — the same project the setup scripts
    provision evaluators on.

    Call this only from CLI entrypoints, never at import time. In a deployment
    ``LANGSMITH_PROJECT`` is intentionally unset so each deployment (and each
    per-PR preview build) traces to its own deployment-named project; importing
    config must not override that. ``setdefault`` also means an explicit
    ``LANGSMITH_PROJECT`` always wins.
    """
    os.environ.setdefault("LANGSMITH_PROJECT", settings.langsmith_project)
