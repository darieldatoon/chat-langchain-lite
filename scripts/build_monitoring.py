"""Wire the LangSmith self-improving loop: 👎 feedback → annotation queue → dataset.

    human 👍/👎 (chat UI)  →  run rule (filter + route)  →  annotation queue
        →  human reviews/corrects  →  Add to Reference Dataset (the queue default)

This is the demo's flywheel made concrete (Bug 5 truncation): a user thumbs-down
gets routed to a review queue, a human confirms/corrects it, and the corrected
run lands in a corrections dataset that feeds the next eval cycle. The same queue
provides the human labels that **Align Evaluators** uses to tune the online judges.

Idempotent (queues/rules matched by name / display_name). Tags the queue and the
corrections dataset with the Application resource tag.

Auth: LANGSMITH_API_KEY is read from the env and sent as the x-api-key header
(never logged); X-Tenant-Id is added from LANGSMITH_WORKSPACE_ID when set.

Usage:
    python -m scripts.build_monitoring
"""

import os
import time

import requests
from dotenv import load_dotenv

load_dotenv(override=True)

from langsmith import Client  # noqa: E402 — env must load first
from langsmith.utils import LangSmithRateLimitError  # noqa: E402

from chat_langchain_lite.config import USER_SCORE_KEY, settings  # noqa: E402
from scripts.resource_tags import tag_resource  # noqa: E402

_API = "https://api.smith.langchain.com/api/v1"
_TIMEOUT = 30

# The "Correctness" dataset evaluator (created in the LangSmith UI, imported here
# so it's reproducible). It's a reference-based LLM judge that only reads the first
# input message and the final response, so the full trace in the example is fine.
# hub_ref points at the prebuilt correctness prompt copy in this workspace.
_CORRECTNESS_HUB_REF = "eval_correctness_636x107f:latest"
_CORRECTNESS_VARIABLE_MAPPING = {
    "inputs": "input.messages[0].content",
    "outputs": "output.messages[-1].content",
    "reference_outputs": "referenceOutput.messages[-1].content",
}


def _headers() -> dict[str, str]:
    headers = {"x-api-key": os.getenv("LANGSMITH_API_KEY", ""), "Content-Type": "application/json"}
    if ws := os.getenv("LANGSMITH_WORKSPACE_ID", "").strip():
        headers["X-Tenant-Id"] = ws
    return headers


def _root_feedback_filter(key: str, score: int) -> str:
    """FQL: root runs carrying feedback `key` with the given numeric `score`.

    The chat UI stores 👍/👎 as a 1/0 feedback score, so score=0 matches a 👎.
    """
    return f'and(eq(is_root, true), and(eq(feedback_key, "{key}"), eq(feedback_score, {score})))'


def _project_id(client: Client) -> str:
    for i in range(5):
        try:
            return str(client.read_project(project_name=settings.langsmith_project).id)
        except LangSmithRateLimitError:
            time.sleep(6 * (i + 1))
    raise SystemExit(f"Could not resolve project '{settings.langsmith_project}' (rate-limited).")


def _ensure_corrections_dataset(client: Client) -> str:
    name = settings.corrections_dataset_name
    existing = list(client.list_datasets(dataset_name=name))
    if existing:
        print(f"  • dataset {name}: exists")
        return str(existing[0].id)
    ds = client.create_dataset(
        name,
        description=(
            "Production responses a human reviewed/corrected from the review queue. "
            "Grows the eval set with real-world failures (e.g. truncated answers)."
        ),
    )
    print(f"  • dataset {name}: created")
    return str(ds.id)


def _ensure_queue(sess: requests.Session, name: str, description: str, dataset_id: str) -> str:
    resp = sess.get(f"{_API}/annotation-queues?limit=100", timeout=_TIMEOUT)
    resp.raise_for_status()
    for q in resp.json():
        if q.get("name") == name:
            print(f"  • queue {name}: exists")
            return q["id"]
    resp = sess.post(
        f"{_API}/annotation-queues",
        json={"name": name, "description": description, "default_dataset": dataset_id},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    print(f"  • queue {name}: created")
    return resp.json()["id"]


def _ensure_rule(
    sess: requests.Session,
    *,
    session_id: str,
    display_name: str,
    filter_: str,
    queue_id: str,
    sampling_rate: float = 1.0,
) -> None:
    resp = sess.get(f"{_API}/runs/rules?session_id={session_id}", timeout=_TIMEOUT)
    resp.raise_for_status()
    if any(r.get("display_name") == display_name for r in resp.json()):
        print(f"  • rule {display_name!r}: exists")
        return
    resp = sess.post(
        f"{_API}/runs/rules",
        json={
            "display_name": display_name,
            "session_id": session_id,
            "sampling_rate": sampling_rate,
            "filter": filter_,
            "add_to_annotation_queue_id": queue_id,
            "extend_annotation_queue_trace_retention": True,
        },
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    print(f"  • rule {display_name!r}: created → queue {queue_id}")


def _ensure_correctness_evaluator(sess: requests.Session, dataset_id: str) -> None:
    """Recreate the dataset's 'Correctness' LLM-judge (reference-based) if missing."""
    resp = sess.get(f"{_API}/runs/rules?dataset_id={dataset_id}", timeout=_TIMEOUT)
    resp.raise_for_status()
    if any(r.get("display_name") == "Correctness" for r in resp.json()):
        print("  • dataset evaluator 'Correctness': exists")
        return
    from langchain_anthropic import ChatAnthropic

    # The hub_ref supplies only the prompt, so the structured evaluator needs an
    # explicit model (else the judge chain validates as empty).
    model_json = ChatAnthropic(model_name="claude-haiku-4-5-20251001").to_json()
    resp = sess.post(
        f"{_API}/runs/rules",
        json={
            "display_name": "Correctness",
            "dataset_id": dataset_id,
            "sampling_rate": 1.0,
            "evaluators": [
                {
                    "structured": {
                        "hub_ref": _CORRECTNESS_HUB_REF,
                        "variable_mapping": _CORRECTNESS_VARIABLE_MAPPING,
                        "model": model_json,
                    }
                }
            ],
        },
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    print("  • dataset evaluator 'Correctness': created")


def main() -> None:
    client = Client()
    sess = requests.Session()
    sess.headers.update(_headers())

    print(f"\n[*] Wiring monitoring loop for project '{settings.langsmith_project}'...")
    session_id = _project_id(client)

    dataset_id = _ensure_corrections_dataset(client)
    tag_resource("dataset", dataset_id)

    queue_id = _ensure_queue(
        sess,
        settings.review_queue_name,
        "Human review of 👎 responses. Confirm/correct the response (and the "
        "evaluator's score, for Align), then Add to Reference Dataset.",
        dataset_id,
    )
    tag_resource("queue", queue_id)

    _ensure_rule(
        sess,
        session_id=session_id,
        display_name="Thumbs-down → review",
        filter_=_root_feedback_filter(USER_SCORE_KEY, 0),
        queue_id=queue_id,
    )

    # Reference-based correctness judge on the corrections dataset (closes the loop).
    _ensure_correctness_evaluator(sess, dataset_id)

    print("\nDone. 👎 responses now route to the review queue; corrected runs grow the dataset.")


if __name__ == "__main__":
    main()
