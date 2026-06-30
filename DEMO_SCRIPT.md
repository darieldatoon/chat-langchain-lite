# LangSmith ADLC Demo — Speaker Script (30 min)

**Total: 30 min** → ~24 min demo + ~1 min buffer + **5 min Q&A**.
This is the *spoken* script. Plain text = say it (roughly — talk, don't read).
**[DO]** = what you click/show. **[BEAT]** = pause for effect.

> Companion docs: `DEMO.md` (full run-of-show + the bug→stage→tool map),
> slides: `slides/LangSmith Demo - ADLC Slides.pdf`.

### At-a-glance timing

| # | Section | Budget | Running |
|---|---------|--------|---------|
| 1 | ADLC slides (4 slides) | 3:00 | 3:00 |
| 2 | Meet Chat LangChain Lite | 1:30 | 4:30 |
| 3 | **Build** | 4:00 | 8:30 |
| 4 | **Test** | 4:00 | 12:30 |
| 5 | **Deploy** | 2:00 | 14:30 |
| 6 | **Monitor** | 4:30 | 19:00 |
| 7 | Insights | 2:00 | 21:00 |
| 8 | **Engine** (climax) | 3:30 | 24:30 |
| — | Q&A | 5:00 | ~30:00 |

**Pre-flight (before the room is watching):** tabs open and logged in — chat app,
LangSmith project, a deployment in Studio, GitHub repo. Preview deployment warm.
One off-topic question already asked in the app so a trace exists. Phone on silent.

---

## 1 · ADLC slides — *3 min*

> Slide deck: 4 slides. Keep it tight — the slides are the *promise*, the product is the *proof*.

**[DO] Slide 1 — "LangSmith: the platform for reliable agents"**

Hey everyone — thanks for the time. Over the next half hour I want to show you,
not tell you, how LangSmith helps you build agents you can actually *trust* in
production. So this is mostly a live demo. We'll find some real bugs in a real
app and fix them — using LangSmith the whole way.

**[DO] Slide 2 — "Agents are a new kind of software"**

First, why is this even hard? Traditional software is narrow and deterministic —
same input, same output, and you write tests for the paths you know.

Agents are the opposite. **[BEAT]** The inputs are *wide open* — anyone can type
anything. And the outputs are **non-deterministic and basically infinite** — the
model can respond in a million ways, call tools in a different order, or
confidently make something up. You can't unit-test your way to confidence here.
You need a different toolkit.

**[DO] Slide 3 — the ADLC wheel**

That toolkit is built around a loop we call the **Agent Development Life Cycle** —
**Build, Test, Deploy, Monitor**, with **Govern** wrapping all of it. The key
word is *loop*. You don't build an agent once; you build it, ship it, watch what
real users do to it, and feed that straight back into the next version. The teams
shipping great agents are the ones spinning this flywheel fastest.

**[DO] Slide 4 — "LangSmith Engine: your agent for agent engineering"**

This is the whole platform on one slide. Build, Test, Deploy, Monitor — and notice
what's sitting dead center: **Traces**. Traces are the *fuel*. Every run your
agent does becomes a trace, and that trace is what powers your evals, your
dashboards, your debugging — everything downstream keys off it.

And the newest piece — up top — **Engine**. Engine is an agent *for agent
engineering*. It reads your traces and your failing evals, figures out what's
wrong, and opens a pull request to fix it. It's what makes the flywheel spin on
its own. **[BEAT]** We'll end the demo there.

So — Build, Test, Deploy, Monitor, with Engine accelerating the loop. Let me show
you all of it on a real app.

> *Transition:* switch from slides to the chat app.

---

## 2 · Meet Chat LangChain Lite — *1.5 min*

**[DO]** Open the chat app. Type a normal in-scope question, e.g.
*"What is LangGraph and when should I use it?"* Let it stream.

This is **Chat LangChain Lite** — a little chatbot whose whole job is answering
questions about the LangChain ecosystem: LangChain, LangGraph, LangSmith, Deep
Agents. Ask it a real question — **[DO: send]** — and it streams back an answer,
calling tools to look things up as it goes.

Looks great, right? **[BEAT]** Here's the thing — this app has bugs. Real ones,
the kind every agent ships with: it sometimes wanders off-topic, sometimes gets
a fact wrong, sometimes cuts its own answer off mid-sentence. For the rest of the
demo, *we're going to use LangSmith to hunt those down and fix them* — one per
stage of that loop. Let's start at Build.

---

## 3 · Build — *4 min*

> Tools: Studio · Tracing · Context Hub · Prompt Hub.

### Studio — *~1 min*
**[DO]** Open the deployment in **Studio**; show the agent graph; run a question inline.

This is **Studio** — where you author and inspect the agent *before* a single line
of code leaves your laptop. Here's our agent as a graph: it's a reason-and-act
loop — the model thinks, decides whether to call a tool, calls it, looks at the
result, and loops until it's ready to answer. **[DO: run inline]** I can run a
question right here and watch every step light up. No print statements, no
guessing.

### Tracing — *~1.5 min*
**[DO]** From the chat UI's "↗ Trace" link, open the trace for the question from §2.

Now — remember I said traces are the fuel. **[DO: click Trace link]** Every single
run becomes one of these. This is the trace for the question I just asked in the
app. I get the full waterfall: each step, every tool call with its exact inputs
and outputs, token counts, latency, and cost — right down to the individual LLM
call. **[BEAT]** When something goes weird in production, *this* is where you live.
And everything else I'm about to show you — the evals, the dashboards, Engine —
it all reads from these traces.

### Context Hub — *~1 min*
**[DO]** Open **Context Hub**; show the agent's `AGENTS.md` system prompt.

Here's something neat. The agent's brain — its system prompt — doesn't live in the
codebase. It lives here, in **Context Hub**. **[DO: show AGENTS.md]** This is the
agent's operating instructions, versioned, editable *outside* of a deploy. So a PM
or a domain expert can tune how the agent behaves without waiting on an engineer to
cut a release. Keep this in the back of your mind — a couple of our bugs actually
live in *this* prompt, and this is where Engine will fix them.

### Prompt Hub — *~0.5 min*
**[DO]** Open **Prompt Hub**; show the LLM-as-judge prompt.

Quick distinction, because people mix these up. Context Hub is how the agent
*operates*. **Prompt Hub** — over here — is how we *evaluate* it. This is our
LLM-as-judge prompt, versioned, that we use to grade the agent's answers. You edit
it in the playground, version it, promote it by tag. Which is a perfect segue,
because grading the agent is exactly what Test is about.

---

## 4 · Test — *4 min*

> Tools: Datasets · Offline experiments · Pairwise Annotation Queue.

### Datasets — *~1 min*
**[DO]** Open the scope **Dataset**; show a couple examples with their assertions.

Testing an agent starts with a **Dataset** — this is our ground truth. Each example
is an input — a question — plus what a good answer should and shouldn't do.
**[DO: expand an example]** These aren't exact-match strings, because remember,
outputs are infinite — they're assertions, like "stays on topic" or "links to the
current docs." This is the bar we hold the agent to.

### Offline experiments — *~2 min*
**[DO]** Open the experiments view; show a run over the dataset; open the
Haiku-vs-Sonnet comparison.

Now we run the agent across that whole dataset and score every answer — that's an
**experiment**. **[DO: open comparison]** And here's where it earns its keep: I can
compare two configurations side by side. This is our agent on **Haiku** versus on
**Sonnet**, same dataset, scored row by row. **[BEAT]** I can see exactly where one
model wins, where it costs more, where it's slower. *This* is how you make a model
decision with data instead of a vibe.

And notice — a couple of our bugs get caught *right here, before we ever ship*. The
agent recommending a stale docs link, getting a version number wrong — the
deterministic stuff fails the eval and never reaches a user. That's the point of
Test: catch what you can *before* deploy.

### Pairwise Annotation Queue — *~1 min*
**[DO]** Open the Pairwise Annotation Queue; show the A/B review screen.

But sometimes there's no single right answer — two responses are both fine and you
just want the *better* one. For that we use a **Pairwise Annotation Queue**.
**[DO: show queue]** It puts two responses to the same question side by side, and a
human reviewer picks A, B, or a tie against a rubric. **[BEAT]** This is how you
capture human preference at scale — and those judgments can fold right back into
tuning your automated evaluators so the machine learns to grade like your experts
do.

> *Transition:* "Okay — it passes our tests. Time to ship it."

---

## 5 · Deploy — *2 min*

> Tool: LangSmith Deployments.

**[DO]** Open **Deployments**; show the deployment, its revision history.

Deploying is genuinely one click. **[DO: show deployment]** We point LangSmith at a
GitHub repo, and it builds and hosts the agent for us — straight from source
control. **[BEAT]** Two things I want you to notice.

One — it's **versioned**. Every deploy is a revision. **[DO: show revision list]**
If a release misbehaves, you roll back to the previous one instantly. No
firefighting.

Two — and this is the one to remember for the finale — LangSmith can spin up a
**preview build for every pull request**. A live, running version of the agent off
that PR's branch, with its own URL. **[BEAT]** Hold that thought — it's the payoff
at the very end.

One more thing worth calling out: our chat UI and the agent itself ship as a
*single* deployment. No separate frontend to host. One artifact, one URL.

> *Transition:* "It's live. Now real users are hitting it — let's watch."

---

## 6 · Monitor — *4.5 min*

> Tools: Online evaluators · User feedback → Automation → Annotation Queue → Dataset.

### Online evaluators — *~1.5 min*
**[DO]** Open the project's traces; show online-eval scores attached to live runs
(`scope_adherence`, `professional_tone`, `tool_usage`, etc.).

Tests are great, but they only cover what you *thought to test*. Production is where
the wide-open inputs show up. So we run **online evaluators** — LLM judges that
score *every live trace automatically* as traffic comes in. **[DO: show scores]**

And look — **[BEAT]** here's a bug that sailed past our tests. `scope_adherence` is
failing. Users are asking this thing about Kubernetes, about OAuth, about
*business plans* — totally off-topic — and instead of politely declining, the agent
happily answers. We never tested for that because we never imagined someone would
ask. Production found it for us. **[BEAT]** And remember — that behavior is driven
by the prompt back in Context Hub.

### User feedback — *~1.5 min*
**[DO]** In the chat app, ask a question that triggers a long, *truncated* answer.
Click 👎. Show the vote landing on the trace.

The other signal is the most honest one — **real users**. **[DO: 👎]** Right in the
app, people give a thumbs up or down. Watch this one. **[DO: ask the long question]**
See how the answer just... stops? Cuts off mid-sentence. That's frustrating, so I
thumbs-down it — **[DO: click 👎]** — and that vote attaches straight to the trace.
**[BEAT]** That's a real user telling us something's broken. Now what?

### Automation → Annotation Queue → Dataset — *~1.5 min*
**[DO]** Show the "thumbs-down → review" automation; the review queue with the
downvoted run; correcting it and **Add to Reference Dataset**.

Here's the self-improving loop made concrete. We've got an **automation** running:
any thumbs-down run gets automatically routed to a review **queue**. **[DO: open
queue]** A human — could be me, could be a support lead — opens the queue, reads the
bad answer, and corrects it. **[DO: correct + Add to Reference Dataset]** And with
one click, that corrected example flows *back into our dataset*.

**[BEAT]** Think about what just happened. A user complaint became a permanent test
case. The next time we run our experiments, this exact failure is something we're
graded against. The agent literally can't regress on it again. That's the flywheel
turning.

---

## 7 · Insights — *2 min*

> Tool: Insights (monitoring / clustering).

**[DO]** Open an **Insights** report on the project; show the clusters, zoom in on
the big "Off-topic" cluster.

Online evals catch the problems you defined. But what about the problems you didn't
even know to look for — the *unknown* unknowns? That's **Insights**. **[DO: show
report]** It reads across thousands of production traces and clusters them by what's
actually happening — automatically.

And look at this. **[BEAT]** The single biggest cluster of failures is "off-topic
questions the agent answered instead of declining." Vector databases, OAuth flows,
transformer math — a whole category of misuse, surfaced for me without my writing a
single rule. **[BEAT]** *This* is our scope bug, quantified. I'm not guessing it's a
problem — I can see it's the #1 problem. That's the diagnosis we hand to Engine.

> *Transition:* "So we've got a pile of evidence: failing online evals, angry
> thumbs-downs, and now a hard number from Insights. Normally this is where an
> engineer spends their afternoon. Watch what happens instead."

---

## 8 · Engine — the climax — *3.5 min*

> Tool: LangSmith Engine. This is the moment — slow down, let it land.

### Set up the problem — *~0.5 min*
**[DO]** Open Engine. Reference the truncation bug (answers cut off) + the
off-topic/scope problem from Insights.

This is **Engine** — the agent for agent engineering from that first slide. I'm
going to point it at the problems we just found. The big one: our answers are
getting **cut off** — that truncation the user thumbs-downed. Plus the off-topic
scope issue Insights flagged.

### Engine diagnoses + proposes a fix — *~1 min*
**[DO]** Show Engine reading traces/evals and producing its diagnosis + proposed fix.

**[DO: run Engine / show its analysis]** Engine reads the failing evals and the
actual traces — the same fuel we've been using all along — and it reasons about the
root cause. **[BEAT]** And it nails it: the answers are truncating because of a token
limit set too low in the code, and the off-topic problem traces back to the system
prompt in Context Hub. Notice it reasons across *both* the code *and* the prompt —
the two places we said our bugs live.

### View the PR in GitHub — *~1 min*
**[DO]** Open the PR Engine created on GitHub; walk the diff briefly.

And it doesn't just *tell* me — it opens a **pull request**. **[DO: open PR in
GitHub]** Here it is, on GitHub. A real diff, a real description of what it changed
and why. **[BEAT]** This drops straight into the workflow your team already uses —
code review, CI, the works. Speaking of which — our offline evals run automatically
on this PR, gating the merge. The loop closes itself.

### View the preview link — prove it's fixed — *~1 min*
**[DO]** Open the **preview build URL** for the PR's branch. Re-ask the question
that was cut off. Show the full, complete answer.

But here's my favorite part — remember the preview build I told you to hold onto?
**[DO: open preview URL]** This is a *live, running* version of the agent off
Engine's fix branch. Not a diff, not a description — the actual fixed app. Let me
ask it the exact question that got cut off before. **[DO: re-ask]** **[BEAT]** And
there it is — full answer, all the way through, no truncation. I can *prove the fix
works before I even merge it*.

**[BEAT]** So let's recap what just happened. A real user complaint → caught by
monitoring → diagnosed by Insights → fixed by Engine → opened as a PR → proven on a
live preview. That whole loop, the one from the slide — Build, Test, Deploy,
Monitor — and Engine spinning it for us. **[BEAT]** *That's* how you build agents
you can trust. Thank you — I'd love to take questions.

---

## Q&A — *5 min*

**Likely questions + crisp answers:**

- **"Does Engine just YOLO changes to prod?"** → No. It opens a *PR*. Your normal
  review + CI gating applies; offline evals run on the PR. A human merges. The
  preview build lets you verify first.
- **"What models / can we use our own?"** → Model-agnostic. You saw the
  Haiku-vs-Sonnet comparison — that's exactly the decision LangSmith helps you make
  with data. Bring your own keys via the LLM Gateway (the "Govern" layer).
- **"Do traces add latency / cost?"** → Tracing is async and lightweight; it
  doesn't sit in the critical path of the response.
- **"Data privacy — where do traces live?"** → Cloud or self-hosted/hybrid
  deployments available; data stays in your control on the enterprise tiers.
- **"How is this different from generic LLM observability?"** → It's the *whole
  loop*, not just dashboards: evals gate deploys, feedback becomes datasets, and
  Engine actually *acts* on what it finds. Observability tells you it's broken;
  LangSmith helps you fix it.
- **"Framework lock-in?"** → Tracing works with any stack via the SDK; you don't
  have to rewrite on LangGraph to get value, though the deepest integration is
  there.

**If a demo step fails live:** stay calm, narrate it — "this is a live system, and
honestly, *this* is exactly why we trace everything." Pivot to the trace and move
on. Never debug silently on stage.

**If you're running long:** the safe cuts are Pairwise (§4) and the Studio
walkthrough (§3) — mention them in one sentence and move on. **Never** cut Engine.
```
