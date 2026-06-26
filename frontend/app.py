"""Chat LangChain Lite — FastHTML frontend.

Mounted into the LangGraph server as a custom app via ``langgraph.json``'s
``http.app`` key (``"./frontend/app.py:app"``), so it is served from the same
origin as the graph API. It renders a dark chat UI styled after
chat.langchain.com and streams the agent's response token-by-token over
Server-Sent Events.

The frontend never imports the graph directly — it reaches it over the
LangGraph SDK (`langgraph_sdk`) on localhost: port 2024 under `langgraph dev`,
port 8000 in the deployed container. The base URL comes from
``LANGGRAPH_API_URL`` and is constrained to loopback (see ``_api_url``).
"""

import base64
import json
import os
from pathlib import Path
from urllib.parse import quote, urlparse

from dotenv import load_dotenv
from fasthtml.common import (
    FT,
    A,
    Button,
    Div,
    EventStream,
    Form,
    Img,
    Input,
    Link,
    Main,
    Script,
    Span,
    Style,
    Titled,
    fast_app,
    sse_message,
)
from langgraph_sdk import get_client

load_dotenv(override=True)

ASSISTANT_ID = "agent"

# Loopback hosts the frontend is allowed to reach. The frontend and the graph
# run in the same process/container, so the SDK target is always localhost —
# constraining to loopback closes the SSRF surface flagged in review.
_ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}


def _api_url() -> str:
    """Resolve the LangGraph API base URL (loopback-only).

    Explicit ``LANGGRAPH_API_URL`` wins; otherwise default to the
    ``langgraph dev`` port (2024). In a deployment, set
    ``LANGGRAPH_API_URL=http://localhost:8000`` (the container's API port).
    """
    url = os.getenv("LANGGRAPH_API_URL", "http://localhost:2024")
    host = urlparse(url).hostname or ""
    if host not in _ALLOWED_HOSTS:
        raise ValueError(
            f"LANGGRAPH_API_URL host {host!r} is not loopback; "
            "the frontend may only reach the co-located graph server."
        )
    return url


def _logo_data_uri() -> str:
    path = Path(__file__).resolve().parent.parent / "langchain-color.png"
    b64 = base64.b64encode(path.read_bytes()).decode()
    return f"data:image/png;base64,{b64}"


LOGO = _logo_data_uri()

SUGGESTIONS = [
    "Walk me through building a LangGraph agent with middleware, persistence, and streaming — include code.",
    "Show me how to set up LangSmith tracing and offline evals end-to-end.",
    "What is LangSmith and what is it used for?",
    "Help me debug my Django view function — it's throwing a 500.",
    "Where can I find the official LangChain documentation?",
    "What's the minimum Python version for LangGraph?",
]

# ── Styling (dark, centered column — matches chat.langchain.com) ──────────────
CSS = """
:root { --bg:#000; --card:#0f0f0f; --border:#1c1c1c; --text:#e4e4e7;
        --muted:#52525b; --accent:#3b82f6; --code:#93c5fd; }
* { box-sizing:border-box; font-family:'Inter',sans-serif; }
html,body { margin:0; background:var(--bg); color:var(--text); }
body { display:flex; flex-direction:column; min-height:100vh; }
a { color:inherit; text-decoration:none; }

.wrap { width:100%; max-width:720px; margin:0 auto; padding:0 16px; flex:1;
        display:flex; flex-direction:column; }

.pg-header { display:flex; align-items:center; justify-content:space-between;
             padding:18px 0; border-bottom:1px solid var(--border); }
.pg-brand { display:flex; align-items:center; gap:9px; }
.pg-brand img { width:26px; height:26px; display:block; }
.pg-brand-name { font-size:15px; font-weight:600; color:#fff; letter-spacing:-0.1px; }
.pg-new { font-size:13px; color:var(--muted); border:1px solid var(--border);
          padding:6px 12px; border-radius:8px; transition:border-color .15s,color .15s; }
.pg-new:hover { border-color:var(--accent); color:#fff; }

#messages { flex:1; padding:24px 0 160px; }

.empty { text-align:center; padding:48px 0 28px; }
.empty img { width:64px; height:64px; opacity:.95; }
.empty-title { font-size:22px; font-weight:700; color:#fff; margin-top:18px; letter-spacing:-0.3px; }
.empty-sub { font-size:13px; color:var(--muted); margin-top:6px; }
.sug-label { font-size:11px; font-weight:600; color:var(--muted); letter-spacing:.6px;
             text-transform:uppercase; text-align:center; margin:28px 0 14px; }
.sug-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.sug { background:linear-gradient(180deg,#0d0d10,#0a0a0c); border:1px solid #1f1f24;
       color:#d4d4d8; border-radius:12px; font-size:13px; line-height:1.45; padding:14px 16px;
       min-height:76px; text-align:left; font-weight:500; cursor:pointer;
       transition:border-color .15s,transform .15s,background .15s; }
.sug:hover { border-color:var(--accent); color:#fff; transform:translateY(-1px);
             background:linear-gradient(180deg,#111319,#0d0e12); }
@media (max-width:560px){ .sug-grid{ grid-template-columns:1fr; } }

.msg { display:flex; gap:10px; margin-bottom:14px; }
.msg .avatar { flex:0 0 28px; height:28px; border-radius:6px; background:#172554;
               color:var(--code); display:flex; align-items:center; justify-content:center;
               font-size:14px; }
.msg .bubble { background:var(--card); border:1px solid var(--border); border-radius:10px;
               padding:10px 14px; font-size:14px; line-height:1.7; flex:1; min-width:0;
               overflow-wrap:anywhere; }
.msg.user .bubble { background:#0a0a0c; }
.bubble p { margin:.4em 0; } .bubble p:first-child { margin-top:0; } .bubble p:last-child { margin-bottom:0; }
.bubble strong { color:#fff; } .bubble h2,.bubble h3,.bubble h4 { color:#fff; }
.bubble a { color:var(--code); text-decoration:underline; }
.bubble ul,.bubble ol { padding-left:1.2em; }
.bubble code:not(pre code){ background:#050505; color:var(--code); border-radius:4px;
       padding:1px 6px; font-size:13px; font-family:'JetBrains Mono',ui-monospace,monospace; }
.bubble pre { background:#050505; border:1px solid var(--border); border-radius:8px;
       padding:12px; overflow-x:auto; }
.bubble pre code { background:transparent; color:var(--text); padding:0; font-size:13px; }
.cursor { display:inline-block; width:7px; background:var(--accent); animation:blink 1s steps(2) infinite; }
@keyframes blink { 0%,50%{opacity:1;} 50.01%,100%{opacity:0;} }

.input-bar { position:fixed; left:0; right:0; bottom:0; background:linear-gradient(180deg,transparent,#000 28%); }
.input-inner { max-width:720px; margin:0 auto; padding:16px; }
.chat-form { display:flex; }
.chat-input { width:100%; background:#fff; border:1px solid #e4e4e7; border-radius:10px;
       color:#09090b; font-size:14px; padding:12px 16px; min-height:46px; outline:none; }
.chat-input::placeholder { color:#a1a1aa; }
"""

HEAD = (
    Link(rel="preconnect", href="https://fonts.googleapis.com"),
    Link(
        rel="stylesheet",
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    ),
    # highlight.js theme + library (exposes window.hljs)
    Link(
        rel="stylesheet",
        href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css",
    ),
    Script(src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"),
    # marked.js — client-side markdown renderer (exposes window.marked)
    Script(src="https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js"),
    # htmx SSE extension (htmx core ships with FastHTML)
    Script(src="https://cdn.jsdelivr.net/npm/htmx-ext-sse@2.2.3/dist/sse.js"),
    Style(CSS),
)

# Client glue: render streamed markdown after each SSE swap + keep view pinned
# to the latest message. The streamed text is escaped by the server (FT text
# nodes auto-escape), so reading textContent and re-rendering is safe.
CLIENT_JS = """
function scrollDown(){ window.scrollTo(0, document.body.scrollHeight); }
function renderLive(el){
  if(!el || !el.classList || !el.classList.contains('md-live')) return;
  if(window.marked){ el.innerHTML = window.marked.parse(el.textContent || ''); }
  if(window.hljs){ el.querySelectorAll('pre code').forEach(function(b){ window.hljs.highlightElement(b); }); }
}
document.body.addEventListener('htmx:afterSwap', function(e){ renderLive(e.target); scrollDown(); });
document.body.addEventListener('htmx:sseMessage', function(e){
  document.querySelectorAll('.md-live').forEach(renderLive); scrollDown();
});
document.body.addEventListener('htmx:afterRequest', function(e){
  document.getElementById('empty-state')?.remove();
  var form = document.getElementById('chat-form');
  if(form){ form.reset(); }
  scrollDown();
});
"""

app, rt = fast_app(
    hdrs=HEAD,
    htmx=True,
    pico=False,
    surreal=False,
    secret_key=os.getenv("SESSION_SECRET", "chat-lc-lite-dev-secret-change-me"),
    title="Chat LangChain Lite",
)


# ── View helpers ──────────────────────────────────────────────────────────────
def _avatar(role: str) -> FT:
    return Div("🧑" if role == "user" else "💬", cls="avatar")


def user_bubble(text: str) -> FT:
    # `text` is rendered as an FT text node → auto-escaped (no XSS).
    return Div(_avatar("user"), Div(text, cls="bubble"), cls="msg user")


def assistant_bubble(question: str) -> FT:
    """An assistant message wired to stream from /stream over SSE."""
    src = f"/stream?q={quote(question)}"
    body = Div(
        Span(cls="cursor"),  # blinking placeholder until first token arrives
        cls="bubble md-live",
        hx_ext="sse",
        sse_connect=src,
        sse_swap="token",
        sse_close="done",
        hx_swap="innerHTML",
    )
    return Div(_avatar("assistant"), body, cls="msg assistant")


def empty_state() -> FT:
    cards = [
        Button(
            text,
            cls="sug",
            hx_post="/send",
            hx_vals=json.dumps({"q": text}),
            hx_target="#messages",
            hx_swap="beforeend",
        )
        for text in SUGGESTIONS
    ]
    return Div(
        Div(
            Img(src=LOGO),
            Div("Chat LangChain Lite", cls="empty-title"),
            Div(
                "Ask anything about LangChain, LangGraph, LangSmith, and Deep Agents",
                cls="empty-sub",
            ),
            cls="empty",
        ),
        Div("Try one of these", cls="sug-label"),
        Div(*cards, cls="sug-grid"),
        id="empty-state",
    )


def header() -> FT:
    return Div(
        A(
            Img(src=LOGO),
            Span("Chat LangChain Lite", cls="pg-brand-name"),
            href="/",
            cls="pg-brand",
        ),
        A("New chat", href="/?new=1", cls="pg-new"),
        cls="pg-header",
    )


def input_bar() -> FT:
    return Div(
        Div(
            Form(
                Input(
                    name="q",
                    placeholder="Message Chat LangChain Lite…",
                    autocomplete="off",
                    required=True,
                    cls="chat-input",
                ),
                hx_post="/send",
                hx_target="#messages",
                hx_swap="beforeend",
                cls="chat-form",
                id="chat-form",
            ),
            cls="input-inner",
        ),
        cls="input-bar",
    )


# ── Routes ──────────────────────────────────────────────────────────────────
@rt("/")
def index(session, new: str = ""):
    if new or "thread" not in session:
        session["thread"] = os.urandom(16).hex()
    page = Div(
        header(),
        Main(empty_state(), id="messages"),
        Script(CLIENT_JS),
        cls="wrap",
    )
    return Titled("Chat LangChain Lite", page, input_bar())


@rt("/send")
def send(session, q: str = ""):
    q = (q or "").strip()
    if "thread" not in session:
        session["thread"] = os.urandom(16).hex()
    if not q:
        return ""
    return (user_bubble(q), assistant_bubble(q))


@rt("/stream")
async def stream(session, q: str = ""):
    thread_id = session.get("thread") or os.urandom(16).hex()
    question = (q or "").strip()

    async def gen():
        acc = ""
        try:
            client = get_client(url=_api_url())
            async for part in client.runs.stream(
                thread_id,
                ASSISTANT_ID,
                input={"messages": [{"role": "user", "content": question}]},
                stream_mode="messages-tuple",
                if_not_exists="create",
            ):
                if part.event != "messages":
                    continue
                data = part.data
                if not isinstance(data, list) or not data:
                    continue
                msg = data[0]
                if not isinstance(msg, dict) or msg.get("type") != "AIMessageChunk":
                    continue
                acc += _chunk_text(msg)
                if acc:
                    # Send the full accumulated text each token; the client
                    # re-renders markdown on swap. FT text nodes auto-escape.
                    yield sse_message(acc, event="token")
        except Exception as exc:  # noqa: BLE001 - surface a friendly error, never secrets
            yield sse_message(f"⚠️ {type(exc).__name__}: request failed.", event="token")
        finally:
            # Close the SSE connection client-side (sse_close="done").
            yield sse_message("", event="done")

    return EventStream(gen())


def _chunk_text(message: dict) -> str:
    """Flatten an AIMessageChunk's content (str or Anthropic text blocks)."""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text") or ""
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""
