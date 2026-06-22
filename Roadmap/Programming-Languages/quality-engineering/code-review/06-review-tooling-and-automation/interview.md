# Review Tooling & Automation — Interview Level

> **Roadmap:** [Code Review](../README.md) → Review Tooling & Automation
> *A tooling interview rarely asks "what is a linter." It asks "your PRs are full of tabs-vs-spaces arguments — fix it," or "an AI reviewer is flooding your PRs with noise — what do you do," and then watches whether you reach for a formatter before a guideline, whether you treat bot noise as a real defect, and whether you know that the answer to most review pain is to move work off humans, not pile more onto them.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Introduction](#introduction)
3. [Prerequisites](#prerequisites)
4. [Fundamentals](#fundamentals)
5. [The Automation Hierarchy](#the-automation-hierarchy)
6. [Signal vs Noise](#signal-vs-noise)
7. [AI-Assisted Review](#ai-assisted-review)
8. [Async vs Sync & Scenarios](#async-vs-sync--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *principle* almost every one returns to:

- **Automate the mechanical so humans review the meaningful.** If a tool *can* reliably catch it, a human shouldn't be spending review attention on it.
- **Every human comment a tool could have made is a process defect** — not a win for the reviewer, a gap in the pipeline.
- **Attention is the scarce resource.** Both linters and bots and AI reviewers compete for the same finite reviewer attention, and noise spends it.
- **Catch each issue at the cheapest reliable layer** — formatting at the formatter, patterns at the linter, correctness at tests, design at the human.

Nearly every scenario in this bank is one of those four ideas wearing a costume. The candidates who do well *name the principle* before reaching for a specific tool — and they treat tooling as a way to *protect* human review, not replace it.

---

## Introduction

This page is the question bank for **review tooling and automation** — the layer of the review system that decides what a human ever has to look at. It spans the junior question ("what should be automated before a human reviews?") through the staff question ("design the automation policy for a 500-engineer monorepo so review stays fast and humans stay focused on design").

The throughline is a single, slightly counterintuitive idea: **the goal of review tooling is to shrink the human's job, not to add a wall of checks.** A formatter exists so nobody argues about braces. CI gates exist so reviewers never read code that doesn't compile. CODEOWNERS exists so the right human is asked and the wrong humans aren't. AI reviewers, used well, exist to triage and summarize so the human starts from a higher floor. Every one of these earns its place only if it *removes* work or noise from a human. A check that adds noise without removing work is a regression, even though it looks like rigor.

---

## Prerequisites

You'll answer these better if you're comfortable with:

- **CI/CD basics** — what runs on a PR, the difference between a *blocking* (required) check and an *advisory* one, and how status checks gate merge.
- **Linters, formatters, type checkers, and SAST** — roughly what each catches and where they sit. ([Static Analysis & Linting](../../static-analysis/) is the deep dive.)
- **The review fundamentals** — order of operations, what's a human's job vs a tool's job ([01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md)).
- **Feedback mechanics** — severity labels, code suggestions, ask-don't-tell ([05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/interview.md)), because automation changes *who* gives which feedback.
- **Git platform mechanics** — branch protection, required reviews, merge queues ([Quality Gates](../../quality-gates/)).

---

## Fundamentals

### Q: What's the core principle of review automation? Give it as a one-liner.

> **Testing:** Whether you have a mental model at all, or just a list of tools.

**A.** *Automate the mechanical so humans review the meaningful* — or, operationally, **"if a tool can reliably catch it, a human shouldn't be commenting on it."** Human review attention is the scarcest, most expensive resource in the pipeline, and it's the *only* thing that can judge design, naming intent, whether the change solves the right problem, and whether a future maintainer can live with it. Anything a machine can decide deterministically — formatting, import order, obvious bug patterns, a missing license header — should be decided by a machine, *before* a human looks, so the human's finite attention is spent where only a human can spend it. The corollary I'd give in the same breath: **every human review comment that a tool could have made is a process defect**, a signal to go fix the tooling, not a job well done.

### Q: Describe the standard automated stack a change passes through before a human reviews it.

> **Testing:** Do you know the layers and their order, or just "we run CI"?

**A.** Roughly cheapest-and-most-mechanical first, so failures surface early and locally:

1. **Formatter** — `gofmt`/`prettier`/`black`/`rustfmt`. Runs on save and in a pre-commit hook; ideally re-checked in CI. Eliminates all style-of-layout debate by making style non-negotiable and automatic.
2. **Linter / static analysis** — `golangci-lint`/`eslint`/`ruff`/`clippy`. Catches bug patterns and anti-patterns: unused vars, shadowing, error-handling smells, dangerous constructs.
3. **Type check** — for typed or gradually-typed languages (`tsc`, `mypy`); often folded into the linter step.
4. **SAST / security scan** — `semgrep`/CodeQL for injection, hardcoded secrets, unsafe deserialization.
5. **Tests** — unit, then integration; the correctness gate.
6. **Human review** — design, intent, "is this the right change," and the bug classes tools *can't* see.

The discipline is **CI green before a human reviews.** A reviewer's first action is essentially "is the build green?" — if not, the change isn't ready, and reading red code wastes the most expensive resource on problems the author already needs to fix.

### Q: Why "CI green before review"? Isn't that just gatekeeping?

> **Testing:** Whether you understand the *attention-economics* reason, not just policy.

**A.** It's the opposite of gatekeeping — it's *respecting the reviewer's attention*. If a human reviews a PR with failing tests or lint errors, one of two bad things happens: they waste effort commenting on things the failing checks already flagged (duplicating the machine), or they mentally bookmark "I'll re-review after it's green," which means they review the change *twice*. Either way the change consumed double the human attention for the same outcome. Green-before-review means the human reads exactly one coherent, machine-clean version and spends their pass on judgment. It also creates a healthy author habit: *you* fix the mechanical stuff, the reviewer doesn't babysit it. The exception is the explicit **draft PR** — opened deliberately for early *design* feedback before the work (and CI) is finished, where everyone knows it's not green yet.

### Q: Walk me through the platform features that route and shape a review — CODEOWNERS, PR templates, draft PRs, code suggestions, preview apps.

> **Testing:** Breadth across the everyday tooling, and what each is *for*.

**A.** Each removes a different kind of friction:

- **CODEOWNERS** — maps paths to the people/teams who must approve them. It answers *"who reviews this?"* automatically, so changes to `payments/` always pull in a payments owner and aren't merged by someone with no context. Routing, not bureaucracy.
- **PR templates** — a checklist/prompt in the PR body: what changed, why, how it was tested, screenshots, rollback plan. They make the author do the framing work *once* instead of the reviewer asking for it across three round-trips.
- **Draft PRs** — signal "this is for early feedback, not merge." They let you get *design* eyes on a direction before sinking days into polish — the cheapest place to catch "wrong shape."
- **Code suggestions** — inline, one-click-appliable diffs in a review comment (`suggestion` blocks on GitHub/GitLab). They turn "you should rename this" from a debate into an apply button — faster, less ego, and unambiguous.
- **Preview apps / deploy previews** — an ephemeral running deployment per PR (Vercel/Netlify, or a per-PR k8s namespace). They let a reviewer *use* the change, not just read the diff — invaluable for UI and behavioral review where the diff lies about the experience.

The pattern across all of them: **shift work earlier and onto the right actor** — the author frames, the tool routes, the reviewer judges.

### Q: A reviewer keeps leaving comments like "use spaces not tabs" and "this brace should be on the next line." What's the actual problem, and how do you fix it?

> **Testing:** The reflex to reach for a formatter, and to see manual style comments as a defect.

**A.** The problem isn't the reviewer being picky — it's that **a machine job is being done by a human.** Layout style is fully decidable by a tool, so any human comment about it is wasted attention and, worse, it's *inconsistent* (different reviewers enforce different things). The fix is a **formatter**, enforced automatically:

1. Adopt an opinionated formatter with effectively zero config (`gofmt`, `prettier`, `black`) — opinionated matters, because a configurable one just relocates the bikeshed to the config file.
2. Wire it into **format-on-save** in the editor and a **pre-commit hook**, so violations rarely reach a PR.
3. Add a **CI check** that fails if the code isn't formatted, so it's enforced regardless of local setup.
4. Make a one-time "reformat the world" commit, and add it to `.git-blame-ignore-revs` so it doesn't pollute blame.

After that, the team agreement is simple: **style is not a review comment.** If you find yourself typing one, it's a bug in the tooling setup, not the PR. This is the single highest-ROI move in review tooling because style debates are both the most common and the least valuable comments teams make.

---

## The Automation Hierarchy

### Q: This is the differentiator question. For each issue class — formatting, anti-patterns, memory safety, correctness, design — where is it *best* caught, and why there?

> **Testing:** Whether you can map issue classes to the cheapest reliable detection layer. This is the heart of the topic.

**A.** Each class has a *natural home* — the cheapest layer that can catch it reliably and deterministically — and the goal is to catch it as early and as far left as possible:

| Issue class | Best caught by | Why there |
|---|---|---|
| Formatting / layout | **Formatter** | Fully deterministic; zero judgment; should never reach a human |
| Anti-patterns, smells, simple bugs | **Linter / static analysis** | Pattern-matchable rules; runs in ms; catches the known-bad shapes |
| Type errors | **Type checker** | The compiler/checker proves it; no test needed |
| Memory safety, data races, UB | **Sanitizers / fuzzers** | ASan/TSan/UBSan + fuzzing find what static analysis and human eyes can't see |
| Injection, secrets, known-vuln deps | **SAST / secret scan / SCA** | Pattern + dataflow + known-CVE databases; humans miss these by reading |
| Correctness / behavior | **Tests** | Execution is the only real proof a behavior holds |
| Design, naming, "right problem," maintainability | **Human** | Requires context, taste, and judgment no tool has |

The principle that makes this a *hierarchy*: **push each issue down to the cheapest reliable layer, and never have a higher layer do a lower layer's job.** A human catching a formatting issue, or a test you wrote to catch what the type system already guarantees, is wasted effort at the wrong altitude. Conversely — and this is the part people miss — **a tool is the wrong place for design.** No linter knows whether you built the right abstraction. So the hierarchy frees the human *up the stack*: the more the bottom layers absorb, the more human attention is available for the only things humans uniquely do.

### Q: You said "every human comment a tool could've made is a process defect." Defend that — isn't a reviewer catching a bug always good?

> **Testing:** Whether you actually believe the principle or just recited it.

**A.** Catching the bug is good; the *mechanism* is the defect. If a human caught something a tool *could have* caught — a null-deref pattern, a swallowed error, a known-bad API call — then that bug got caught **late, expensively, and unreliably.** Late, because it traveled all the way to human review instead of failing in CI seconds after the author pushed. Expensively, because it spent scarce human attention on something a `golangci-lint` rule does for free. Unreliably, because the *next* instance of that bug depends on a tired human noticing it again, which they won't. So the right response to "a reviewer caught a null-deref" is not just "good catch" — it's **"can we add a lint rule so the tool catches the next one?"** That converts a one-time human catch into a permanent, automatic guard. A mature team treats recurring review comments as a *backlog of lint rules to write.* That's what "process defect" means: the comment is a symptom that the pipeline has a gap.

### Q: Where does the hierarchy *break down* — what does it tempt teams to get wrong?

> **Testing:** Senior-level nuance; whether you see the failure modes of your own model.

**A.** Two ways. First, **over-automation / cargo-culting**: teams turn on every lint rule and every scanner because "more checks = more rigor," and drown the signal (see the next section). The hierarchy says catch each issue at the *cheapest reliable* layer — "reliable" is load-bearing. A rule with a 40% false-positive rate isn't a cheaper layer, it's a noise generator that *costs* attention. Second, **expecting tools to climb the stack**: management hears "automate review" and asks "can the linter / AI just approve PRs so we don't need reviewers?" But the top of the hierarchy — design, intent, the right-problem question — is exactly where tools *can't* go, and trying to push them there either produces rubber-stamp approvals or floods PRs with low-context noise. The hierarchy is a guide to *what to automate*, and an equally important guide to *what not to.*

---

## Signal vs Noise

### Q: Walk me through the "bot noise" problem. Why is a noisy review bot actively harmful, not just neutral?

> **Testing:** Whether you understand that attention is finite and noise is *negative*, not zero.

**A.** A review bot that posts low-value comments isn't neutral clutter — it **degrades every other signal in the PR, including the real ones.** The mechanism is attention: a reviewer (and author) has a finite budget of "things worth reading" in a PR. When a bot drops fifteen comments and twelve are nitpicks, false positives, or things nobody will act on, humans do the rational thing — they **start ignoring the bot entirely.** And once you've trained yourself to scroll past the bot, you scroll past the *real* finding it occasionally makes too. It's the **cry-wolf / boy-who-cried-wolf** dynamic: a gate or bot that fires falsely often enough gets muted, and then it's useless precisely when it's right. The same thing happens with **flaky CI gates** — a test suite that fails 20% of the time for no reason trains everyone to hit "re-run" reflexively, so a real failure gets re-run away too. Noise doesn't just waste attention; it *destroys trust in the channel*, which is far more expensive to rebuild than to protect.

### Q: An AI reviewer (or a static-analysis bot) is flooding your PRs with low-value comments. The team has started ignoring it. What do you do — concretely?

> **Testing:** A flagship scenario. Whether you treat noise as a measurable, fixable problem.

**A.** Treat the bot like any other product with a quality bar, and **measure its signal**:

1. **Measure the action rate.** Sample recent bot comments and compute: of N comments, how many led to a change (the *action / fix rate*)? How many were dismissed (the false-positive rate)? If the action rate is low — say under ~50–60% — the bot is a net negative and the team's instinct to ignore it is *correct*.
2. **Curate the rules, hard.** For a linter/SAST bot: disable the noisy, low-value, high-false-positive rules entirely. Keep only rules with a high fix-rate. A small set of trusted rules beats a comprehensive set of ignored ones.
3. **Demote, don't delete (where useful).** Move borderline checks from *blocking PR comments* to a *non-blocking summary* or a separate report, so they're available without spending inline attention.
4. **Make "fix or suppress" the rule.** Every finding must be either fixed or explicitly suppressed with a reason (`// nolint: reason`). No standing backlog of ignored findings — that's how you slide back into noise.
5. **Add a feedback loop.** Let reviewers flag a bot comment as unhelpful, and *act on the data* by tuning or removing the offending rule. The bot earns its place by being right.

The framing I'd state explicitly: **the bug isn't that people ignore the bot — the bug is that the bot earned being ignored.** Fix the bot's precision and trust returns. This is straight from the **Tricorder** lesson at Google.

### Q: What's the "Tricorder lesson"? What did Google learn about running analysis at scale that applies to any review bot?

> **Testing:** Whether you know the canonical case study and can extract its principles.

**A.** Tricorder is Google's program-analysis platform that surfaces analyzer findings *in code review*. The hard-won lessons — which generalize to *any* automated reviewer, AI or static — are:

- **Optimize for a high fix-rate, not coverage.** Google found that if **more than ~10% of an analyzer's findings were dismissed** as not-useful, developers lost trust in the whole analyzer. So they hold analyzers to a precision bar and *remove* ones that don't clear it. Precision over recall.
- **Surface findings at the right moment** — in the review, on the relevant lines, when the developer is already in context — not in a report nobody opens.
- **Make every finding actionable**, ideally with a suggested fix the developer can apply in one click. A finding without an action is just nagging.
- **Build an explicit feedback loop** — a "not useful" button whose data drives whether a check stays on. The analyzers are governed by their measured usefulness, not by whether someone *could* imagine a case where the rule matters.
- **Fix-or-suppress, no silent backlog.** Findings are addressed at review time, not accumulated.

The meta-lesson: **automated review is a curated product, not a "turn on all the checks" config.** Whoever owns the bot owns its precision, and an unowned, uncurated bot inevitably decays into noise.

### Q: A teammate argues "more checks can't hurt — worst case people ignore the bad ones." Why is that wrong?

> **Testing:** Whether you can articulate that noise is negative-value, fast.

**A.** Because "people ignore the bad ones" is exactly the harm — you can't selectively ignore. The act of training a human to skip bot comments is global: they skip the bad *and* the good. So an added low-value check doesn't cost you *that check's* attention, it taxes the credibility of *every* check in the channel. Each marginal noisy rule lowers the average signal, and below some threshold the whole channel gets muted. "More checks can't hurt" treats attention as infinite; it's the scarcest thing in the room. The right policy is the opposite: **a small set of high-precision checks the team actually trusts**, and a high bar for adding a new one.

---

## AI-Assisted Review

### Q: Where do LLM-based code reviewers genuinely help today, and where do they fail? Be specific.

> **Testing:** A calibrated, current view — not hype, not dismissal. This separates strong staff candidates.

**A.** They help on the **mechanical, summarization, and first-pass-triage** end, and fail on the **judgment** end — which maps cleanly onto the automation hierarchy.

**Where they help:**
- **PR summarization** — turning a 40-file diff into a readable "what changed and why," and per-file summaries that orient the reviewer faster.
- **First-pass nits and triage** — catching obvious issues (a typo in a string, a missing null check, an inconsistent name) so the human starts from a higher floor.
- **Test-gap and edge-case suggestions** — "you don't test the empty-input case / the error branch," which is a genuinely useful prompt even when imperfect.
- **Boilerplate and convention checks** — "this new endpoint doesn't follow the error-envelope pattern the others use."
- **Lowering the barrier to *any* review** on a tiny/under-reviewed team — a flawed first pass beats no review.

**Where they fail:**
- **Design and architecture** — whether this is the right abstraction, fits the system, solves the actual problem. The model lacks the system context and the taste.
- **Novel correctness** — subtle, domain-specific, or concurrency bugs that aren't a known pattern. It pattern-matches; it doesn't *reason about your invariants*.
- **Context** — it doesn't know the incident last quarter, the deprecation in flight, the reason this ugly code is deliberately ugly.
- **Hallucination and noise** — confidently flagging non-issues, or inventing an API that doesn't exist, which is exactly the bot-noise problem with a fluent voice.
- **Over-trust / deskilling** — the *human* risk: reviewers rubber-stamp the AI's pass, or stop building review skill because "the AI checks it."

The synthesis: **AI review is excellent triage and summarization and a weak judge.** It raises the floor of a review; it can't be the ceiling.

### Q: Should an AI reviewer be allowed to *approve* a PR?

> **Testing:** Whether you hold the line on accountability.

**A.** No. **AI is triage, not an approver.** Approval is an accountability act — it means a named human is willing to stake their judgment that this change should ship, and that they understood it. An LLM can't be accountable, can't be on call when its approval was wrong, and is exactly weakest at the design/intent/novel-correctness questions that approval is *about*. Let it comment, summarize, suggest, label, even gate on mechanical things — but the green check that merges code stays attached to a human who read it. The failure mode if you let AI approve isn't dramatic; it's quiet: review becomes a rubber stamp, the AI's blind spots become the team's blind spots, and nobody's actually accountable for what shipped.

### Q: You're evaluating whether to adopt an AI code-review tool. What metrics decide it, and what non-functional concerns matter?

> **Testing:** Whether you'd treat it as a measurable product decision, like any bot.

**A.** The same precision lens as Tricorder, plus the things unique to sending code to a model:

**Effectiveness metrics:**
- **Comment action rate** — of the comments it posts, what fraction lead to a code change? This is the single best signal; a low action rate means it's noise regardless of how clever it sounds.
- **False-positive / dismissal rate** — the inverse, watched against the trust threshold (the Tricorder ~10%-dismissal line is a good north star). High FP rate poisons the channel.
- **Useful-summary rate** — do reviewers report the summaries actually saved them time? (Survey + behavior.)
- **Does it find anything humans miss?** — net-new true positives, not just restating what the linter already said.

**Non-functional concerns:**
- **Privacy / data governance** — your source is leaving your perimeter. Where does it go, is it retained, is it trained on, does it meet your compliance and IP requirements? Often the deciding factor, ahead of quality.
- **Cost** — per-PR token cost at your PR volume; on a busy monorepo this is real money and can dwarf the value if precision is low.
- **Latency** — does it post before the human reviews (useful) or after (redundant)?
- **Noise controls** — can you scope it, tune it, cap comments per PR, and give reviewers a feedback button? A tool you can't curate will decay like any uncurated bot.

The framing: adopt it like a *junior reviewer on probation* — measure its action rate, keep it on triage duty, never give it the merge button, and re-evaluate on data.

### Q: How do you stop AI review from causing reviewer "deskilling" or over-trust?

> **Testing:** Senior awareness of the human-system risk, not just the tool.

**A.** This is a *culture and process* problem, not a tool setting:

- **Position it explicitly as triage, not verdict.** Team norm: the AI's pass is a starting point, the human still owns the review. Make that the stated expectation, not an implied one.
- **Keep the human accountable** — the AI never approves, so a human always has to actually engage to merge.
- **Watch for rubber-stamping** — if review depth visibly drops or humans stop catching design issues after adoption, that's the over-trust signal; treat it as a regression and recalibrate.
- **Keep teaching the skill** — pair juniors on real reviews, don't let "the AI does first pass" become "juniors never learn to read code." The AI raising the floor must not lower the ceiling of the team's actual capability.

The risk is subtle precisely because the AI is *usually right on the easy stuff* — which lulls people into trusting it on the hard stuff where it's weakest.

---

## Async vs Sync & Scenarios

### Q: Async review is the industry default. Why? And when should you switch to synchronous?

> **Testing:** Whether you know the modes and the *switching signal*, not a dogmatic preference.

**A.** **Async is default for good reasons:** it respects deep work (no interrupting the reviewer), it crosses time zones, it produces a written record of the reasoning attached to the change, and it lets the reviewer think rather than respond live. For the overwhelming majority of PRs, async is correct.

But async has a failure mode: **high-bandwidth, low-latency problems handled in a low-bandwidth, high-latency channel.** Switch to **synchronous** (a call, a screen-share walkthrough, pairing/mobbing) when:
- The change is **large or architecturally complex**, and explaining it in prose would take longer than talking through it.
- A comment **thread is going in circles** — three-plus round-trips, or clear talking-past-each-other. That's the canonical signal: a 30-minute call resolves what ten async comments couldn't.
- It's a **teaching moment** — onboarding, or a junior who'll learn far more from a live walkthrough than from comment ping-pong.
- It's **contentious or sensitive** — disagreement that text is escalating; tone is safer live.

The rule I'd give: **default async, escalate to sync when bandwidth or latency is the bottleneck.** And after a sync session, *write the decision back into the PR* so the record survives. (Pairing/mobbing is a related mode — review happening *continuously during* authoring, so there's little left to review after.)

### Q: Scenario — your team's PRs are dominated by style debates and slow because of them. Design the fix.

> **Testing:** The flagship "fix it with tooling" scenario, end to end.

**A.** Style debates are a *tooling gap*, so the fix is tooling plus a one-line norm:

1. **Adopt an opinionated formatter** and run it on save + pre-commit + a CI check (per the Fundamentals answer). This kills layout debates outright — they become non-negotiable and automatic.
2. **Turn the team's recurring style opinions into lint rules.** If people keep arguing about a non-layout convention (import grouping, error wrapping, naming patterns), encode it in the linter so the *tool* enforces it once, consistently, instead of N reviewers enforcing it inconsistently.
3. **Establish the norm: style is not a review comment.** If a check can own it, humans don't comment on it; if you *want* to comment on it, that's a request to add a rule.
4. **One-time reformat** + `.git-blame-ignore-revs` so history stays clean.

Outcome: style stops consuming review time, reviewers redirect that attention to design and correctness, and review gets *faster* and *better* at once. The meta-point I'd make: **the answer to a recurring review argument is almost never "agree harder" — it's "make a machine own it."**

### Q: Scenario — CODEOWNERS is turning into a bottleneck; one team owns a hot path and every PR waits on them. How do you fix it without removing the gate?

> **Testing:** Whether you can keep the *intent* (right reviewer) while removing the *pain* (single point of contention).

**A.** The intent of CODEOWNERS is "the right person with context reviews this" — the bottleneck is a *capacity and granularity* failure, not a reason to delete the gate. Fixes, roughly in order:

1. **Widen the owner set.** A single overloaded owner is a bus-factor *and* a latency problem. Grow the owning group (and *invest in growing context* so more people can legitimately own that code — the bottleneck is often knowledge, not policy).
2. **Make ownership granular.** A whole top-level dir routing to one team is too coarse. Scope CODEOWNERS to the genuinely sensitive paths so trivial changes nearby don't queue behind them.
3. **Tune the approval requirement.** Require *one* owner approval, not all; use review **load-balancing / round-robin** assignment so requests spread across the group instead of landing on one person.
4. **Set a review SLA and make latency visible.** Track time-to-first-review for owned paths; a persistent breach is a staffing signal, not a nudge-harder signal. (See [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/interview.md).)
5. **Right-size the gate to the risk.** Reserve mandatory owner review for the truly high-stakes paths; let well-tested low-risk areas merge on a lighter rule. Not every line needs the same gate.

The principle: **keep the gate's intent, fix its capacity and granularity.** Removing CODEOWNERS to go faster trades a latency problem for a context problem — changes merging without anyone who understands them — which is worse.

### Q: Scenario — leadership wants to "speed up review" and proposes letting the linter and AI auto-merge anything that passes checks. How do you respond?

> **Testing:** Whether you can push back with the hierarchy, constructively.

**A.** I'd agree with the *goal* (faster review) and redirect the *mechanism*, using the hierarchy. Auto-merging on tool-pass conflates two different things: tools can verify the bottom of the stack (format, lint, types, tests, security patterns) — and we *should* let them gate hard so humans never see that layer — but they **cannot** verify the top: is this the right change, the right design, does it fit the system. Auto-merge on checks means *nothing* judges that, and the failure is quiet: subtly-wrong-but-passing changes accumulate as architectural debt and the occasional real bug that no pattern caught. So my counter-proposal speeds up review *the right way*: make the mechanical layers airtight and *blocking* so humans stop spending time there; adopt AI for **triage and summarization** so the human starts higher; shrink PRs and set a review SLA so the *human* step is fast. That gets the speed leadership wants without deleting the only layer that catches design and novel correctness. **Keep the human on judgment; automate everything below it.**

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: One-line principle of review automation?** A: Automate the mechanical so humans review the meaningful — if a tool can reliably catch it, a human shouldn't comment on it.
- **Q: Formatter vs linter?** A: Formatter rewrites layout deterministically (no judgment); linter flags patterns/smells/bugs and may or may not autofix.
- **Q: Where does design belong in the hierarchy?** A: At the human — no tool has the context or taste to judge it.
- **Q: What does CODEOWNERS do?** A: Maps file paths to required reviewers so the right person with context is auto-requested.
- **Q: Why "CI green before review"?** A: So the human reads one clean version once and spends attention on judgment, not on duplicating failing checks.
- **Q: What's a draft PR for?** A: Early *design* feedback before the work and CI are finished — the cheapest place to catch "wrong shape."
- **Q: The bot-noise problem in one sentence?** A: Low-value automated comments train humans to ignore the bot, so its real findings get ignored too — cry-wolf.
- **Q: The Tricorder precision bar?** A: If more than ~10% of an analyzer's findings are dismissed, developers stop trusting it — so curate for high fix-rate.
- **Q: "Fix or suppress" means?** A: Every finding is either addressed or explicitly silenced with a reason — no silent backlog of ignored findings.
- **Q: Best single metric for an AI/static reviewer?** A: Comment action rate — the fraction of comments that lead to a code change.
- **Q: Can AI approve a PR?** A: No — triage and suggest, yes; the merge-approval stays with an accountable human.
- **Q: Where do LLM reviewers shine?** A: Summarization, first-pass nits/triage, and test-gap suggestions.
- **Q: Where do LLM reviewers fail?** A: Design, novel/contextual correctness, hallucinated non-issues, and inducing reviewer over-trust.
- **Q: Async or sync by default?** A: Async — escalate to sync when the change is big/complex or a thread is going in circles.
- **Q: A reviewer caught a null-deref — ideal follow-up?** A: Add a lint rule so the tool catches the next one — convert the human catch into a permanent guard.
- **Q: What's a code suggestion?** A: An inline, one-click-appliable diff in a review comment — turns "you should change X" into an apply button.
- **Q: A preview app gives you what?** A: An ephemeral running deploy per PR so a reviewer can *use* the change, not just read the diff.
- **Q: "More checks can't hurt" — true?** A: No — each noisy check lowers trust in *every* check, because muting is global, not selective.
- **Q: Two big non-quality risks of an AI reviewer?** A: Source-code privacy/data-governance and per-PR token cost at scale.
- **Q: Flaky-gate analogy to bot noise?** A: A test that fails 20% for no reason trains reflexive re-runs, so a real failure gets re-run away — same muting dynamic.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Listing tools without the principle behind them ("we run eslint, prettier, snyk…") — config knowledge, no model.
- Answering "your PRs are full of style debates" with "tell people to stop" instead of reaching for a formatter.
- "More checks = better quality" — treating attention as infinite and noise as free.
- Letting (or being fine with) an AI reviewer *approving* PRs.
- Treating a human catching a tool-catchable bug as a pure win, with no instinct to add a rule.
- Either AI extreme — "it'll replace reviewers" or "it's useless" — instead of a calibrated triage-not-judge view.
- Solving a CODEOWNERS bottleneck by *deleting* the gate.
- No mention of privacy/data-governance when discussing sending code to an AI reviewer.
- Defaulting everything to synchronous review, or never knowing when to escalate to it.

**Green flags:**
- Stating the principle ("automate the mechanical / a tool-catchable comment is a process defect") *before* naming tools.
- Mapping issue classes to the cheapest reliable layer — the automation hierarchy — unprompted.
- Treating bot noise as a measurable, fixable defect (action rate, fix-or-suppress, feedback loop) and citing the Tricorder ~10% precision bar.
- A calibrated AI view: great at summarization/triage/test-gaps, weak at design/novel-correctness, never the approver, evaluated on action rate.
- Naming privacy and per-PR cost as real adoption constraints for AI review.
- Async-by-default with a concrete switch-to-sync signal ("thread going in circles," "big architectural change").
- Fixing CODEOWNERS bottlenecks by widening owners / granular paths / load-balancing while keeping the gate's intent.
- Seeing the human-system risks — over-trust, deskilling, rubber-stamping — not just the tool's accuracy.

---

## Cheat Sheet

```text
CORE PRINCIPLE
  Automate the mechanical so humans review the meaningful.
  "If a tool can reliably catch it, a human shouldn't comment on it."
  Every human comment a tool could've made = a PROCESS DEFECT.
  Attention is the scarce resource; noise spends it (and is NEGATIVE-value).

THE STACK (cheapest/most-mechanical first; CI GREEN before a human reviews)
  formatter → linter/type → SAST/secret/SCA → tests → HUMAN (design/intent)

THE AUTOMATION HIERARCHY (catch each at the cheapest reliable layer)
  formatting   → formatter        memory-safety → sanitizers/fuzzers
  patterns     → linter           correctness   → tests
  types        → type checker     design/intent → HUMAN (only a human)
  inj/secrets  → SAST/scan
  Push down; never have a higher layer do a lower layer's job; tools can't climb to design.

SIGNAL vs NOISE
  Noisy bot → humans ignore it → real findings ignored too (cry-wolf / flaky-gate).
  Fix: measure action rate · curate to high-fix-rate rules · fix-or-suppress · feedback loop.
  TRICORDER BAR: >~10% dismissed → trust lost → remove/tune the rule. Precision > recall.

AI-ASSISTED REVIEW
  Helps:  summarization · first-pass nits/triage · test-gap suggestions.
  Fails:  design · novel/contextual correctness · hallucination · over-trust/deskilling.
  AI = TRIAGE, never APPROVER. Evaluate on comment ACTION RATE + false-positive rate.
  Also weigh: privacy/data-governance · per-PR cost · latency · noise controls.

ASYNC vs SYNC
  Async = default (deep work, time zones, written record).
  Go SYNC when: big/complex change · thread going in circles · teaching · contentious.
  After sync: write the decision back into the PR.

PLATFORM LEVERS
  CODEOWNERS (route) · PR template (frame once) · draft PR (early design)
  · code suggestions (apply button) · preview app (use, don't just read).
  CODEOWNERS bottleneck → widen owners · granular paths · load-balance · SLA. Keep the gate.
```

---

## Summary

- **The principle is one sentence:** automate the mechanical so humans review the meaningful — *if a tool can reliably catch it, a human shouldn't be commenting on it* — and **every human comment a tool could have made is a process defect**, a prompt to fix the pipeline.
- **The automation hierarchy** is the differentiator: catch each issue class at the cheapest reliable layer (formatting→formatter, patterns→linter, memory→sanitizers, correctness→tests, design→human), push issues *down*, and never expect tools to *climb up* to design. The standard stack runs cheapest-first with **CI green before a human reviews.**
- **Signal vs noise:** attention is finite and noise is *negative*-value — a noisy bot trains humans to ignore it, taking its real findings down with it (cry-wolf, flaky gates). Curate ruthlessly: measure action rate, keep high-fix-rate rules, fix-or-suppress, feedback loop. The **Tricorder** bar — >~10% dismissed means trust is lost — is the canonical number.
- **AI-assisted review** is excellent triage/summarization/test-gap detection and a weak judge of design and novel correctness; it's a **triage tool, never an approver**, evaluated on **comment action rate** and false-positive rate, and constrained by **privacy and cost**. Guard against over-trust and deskilling.
- **Async is the default**; escalate to **sync** when the change is big/complex or a thread is going in circles — then write the decision back. Platform levers (CODEOWNERS, PR templates, draft PRs, code suggestions, preview apps) all shift work earlier and onto the right actor; fix a CODEOWNERS bottleneck by widening/granularizing/load-balancing, never by deleting the gate.

---

## Further Reading

- **"Tricorder: Building a Program Analysis Ecosystem"** (Sadowski et al., Google, ICSE 2015) — the canonical paper on running analysis *in code review* at scale; source of the high-fix-rate / ~10%-dismissal precision bar and the fix-or-suppress + feedback-loop discipline.
- **"Lessons from Building Static Analysis Tools at Google"** (CACM, 2018) — the broader retrospective: why precision and developer trust beat coverage.
- **[reviewdog](https://github.com/reviewdog/reviewdog) docs** — posting linter/analyzer findings as PR review comments scoped to the diff; the practical glue for "tool findings as review comments."
- **[Danger](https://danger.systems/) docs** — codifying your team's PR conventions (changelog present, tests added, PR not too big) as automated review checks.
- A balanced, skeptical piece on **AI code review** (e.g., from a tooling vendor's engineering blog or a practitioner write-up) — read for the action-rate / false-positive framing and the "triage not approver" stance, *against* the marketing.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — junior for the hands-on "set up the stack" mechanics, senior for designing the automation policy of a large org.

---

## Related Topics

- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/interview.md) — automation changes *who* gives which feedback; the human's comments should be the ones a tool can't make.
- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md) — the order of operations that tooling is meant to *protect*, by clearing the mechanical layers first.
- [Static Analysis & Linting](../../static-analysis/) — the deep dive on the linters, formatters, and SAST that sit underneath this topic.
- [Quality Gates](../../quality-gates/) — branch protection, required reviews, and merge queues: the *policy* layer that decides what's blocking.
- [Testing](../../testing/) — the correctness layer of the hierarchy: the proof a change behaves, which no human read can replace.
