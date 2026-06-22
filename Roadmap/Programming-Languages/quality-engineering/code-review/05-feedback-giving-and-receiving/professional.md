# Giving & Receiving Feedback — Professional Level

> **Roadmap:** [Code Review](../README.md) → Giving & Receiving Feedback
> *The senior page taught you how to write a good comment. This page is about making good comments the default across a hundred engineers who will never read your page — where "is this blocking?" stops being a personal judgment call and becomes a question about your team's severity labels, your style guide, and who breaks a two-week tie.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Norms as Artifacts, Not Vibes](#core-concept-1--norms-as-artifacts-not-vibes)
5. [Core Concept 2 — The Style Guide Decides, Not the Reviewer](#core-concept-2--the-style-guide-decides-not-the-reviewer)
6. [Core Concept 3 — Severity Labels and Conventional Comments](#core-concept-3--severity-labels-and-conventional-comments)
7. [Core Concept 4 — Psychological Safety Is a Staff Responsibility](#core-concept-4--psychological-safety-is-a-staff-responsibility)
8. [Core Concept 5 — Disagreement at Scale and Decision Rights](#core-concept-5--disagreement-at-scale-and-decision-rights)
9. [Core Concept 6 — Making Review Visible and Valued](#core-concept-6--making-review-visible-and-valued)
10. [Core Concept 7 — Calibration, Metrics, and the AI-Review Wave](#core-concept-7--calibration-metrics-and-the-ai-review-wave)
11. [War Stories](#war-stories)
12. [Decision Frameworks](#decision-frameworks)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Establishing feedback norms and a healthy review culture across an org — the engineering and process side of feedback, where consistency, decision rights, and incentives matter more than any single well-phrased comment.**

The senior page framed feedback as a craft: lead with a question, separate fact from preference, praise specifically, soften the blocking "no." At the professional level those same mechanics show up in different meetings: a junior who quit after six weeks of an author's ego comments; a PR that sat for two weeks because two staff engineers disagreed and no one could break the tie; a quarter where review quality cratered because the best reviewer got a "needs to ship more" rating and concluded that reviewing was career-negative work.

None of these are problems with how to phrase a comment — they're problems with the *system* the comments live in. The skill here is judgment at scale: knowing that a style guide ends taste debates more effectively than any amount of reviewer diplomacy, that severity labels are the only thing separating a "must-fix" from a "I'd prefer," that psychological safety in review degrades silently until someone leaves, and that review is invisible mentoring work that decays into rubber-stamping the moment the org stops valuing it. The deep interpersonal craft — phrasing, tone, conflict de-escalation — lives in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/). This page is the org-level, battle-tested layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the feedback mechanics: question-first comments, fact-vs-preference, severity in prose, the author-decides rule for reversible/taste calls.
- **Required:** You've reviewed enough PRs to recognize a stalemate, a pile-on, and an ego comment when you see one.
- **Helpful:** You've influenced how a team works, not just how your own PRs read — written a guideline, run a calibration, owned a process.
- **Helpful:** You've been on the receiving end of a review that made you defensive, and you've noticed *why*.

---

## Glossary

- **Conventional Comments** — a lightweight convention that prefixes each review comment with a labeled intent (`nit:`, `suggestion:`, `issue:`, `question:`, `praise:`) and an optional decoration (`(blocking)`, `(non-blocking)`). Turns tone and severity into machine- and human-parseable metadata.
- **Severity label** — an explicit marker on a comment stating how much it matters: blocking (must change to merge), suggestion (consider, author's call), nit (trivial, ignore freely).
- **Fact vs preference** — the distinction between a comment grounded in a rule/correctness/guideline (a *fact*) and one grounded in the reviewer's taste (a *preference*). Preferences are not blocking.
- **The author-decides rule** — on reversible or pure-taste calls, the author's choice stands; the reviewer raises it once and moves on. The single most friction-reducing review norm after a style guide.
- **Decision rights / tie-breaker** — the documented answer to "who decides when reviewer and author disagree." A named role, the style guide, or an escalation path — anything but "loudest wins" or "PR sits forever."
- **Goodhart's Law** — "when a measure becomes a target, it ceases to be a good measure." The reason ranking engineers by comment count produces nitpicking, not quality.
- **Rubber-stamping** — approving without meaningfully reviewing. The failure mode review culture decays *into* when reviewing is unrewarded or time-starved.
- **Pile-on** — multiple reviewers independently dogpiling the same author or PR, often on the same trivial point, with disproportionate volume relative to the change's risk.

---

## Core Concept 1 — Norms as Artifacts, Not Vibes

At small scale, review norms live in people's heads and propagate by osmosis: a new hire watches how the senior reviews and copies it. This breaks the moment the team is large enough that not everyone has seen the same examples, or distributed enough that osmosis doesn't happen, or growing fast enough that new hires outnumber the carriers of the culture. What was "how we review" becomes "how each person reviews," and the variance is where friction lives.

The fix is to make the norms **artifacts**: written, discoverable, and referenced. The minimal set that mature orgs converge on:

- **A review guide** — what the team *blocks* on vs what it merely flags. Correctness, security, data loss, public-API contracts, missing tests on risky paths → block. Naming taste, structure preferences, "I'd have done it differently" → suggest, don't block. The guide states the fact-vs-preference rule explicitly and names "the author is right on reversible and taste calls" as a team value, not a personality trait.
- **A style guide** — the single artifact that ends taste debates (next concept).
- **A comment convention** — Conventional Comments or an equivalent so severity is never ambiguous (Concept 3).
- **An escalation path** — the documented answer to a stalemate so no PR is hostage (Concept 5).

```markdown
# Excerpt from a real team REVIEW_GUIDE.md

## What we block on
- Correctness bugs, race conditions, data loss
- Security issues (authz, injection, secrets)
- Breaking changes to public/cross-team contracts
- Missing tests on risky or hard-to-revert paths

## What we flag but do NOT block on
- Naming, file layout, and structure preferences  → suggestion:
- "I would have done it differently" on reversible code
- Style covered by the formatter/linter → it's already decided; don't comment

## Defaults
- The author decides reversible and taste calls. Raise once, then approve.
- Anything not labeled `(blocking)` is non-blocking by default.
- Disagreement that stalls > 1 business day → escalate (see ESCALATION.md).
```

> **The professional reality:** a norm that isn't written down isn't a norm — it's a preference held by whoever's loudest. The value of the artifact isn't that people re-read it weekly; it's that it exists to be *pointed at* when a review goes sideways. "Per the guide, that's a suggestion, not a blocker" ends a debate in one sentence. Without the artifact, the same sentence is just one engineer's opinion against another's.

---

## Core Concept 2 — The Style Guide Decides, Not the Reviewer

The single biggest reducer of review friction is not better-phrased comments or more empathetic reviewers. It is **removing taste from the conversation entirely** by delegating it to an artifact and, wherever possible, a machine.

Style debates — tabs vs spaces, brace placement, import ordering, single vs double quotes, max line length, where to put the error check — are *infinitely* arguable because they're genuinely matters of taste with no correctness component. Every minute spent on them in a PR is a minute of friction that produces no quality. The two-layer solution:

1. **Auto-format the mechanical layer.** `gofmt`, `prettier`, `black`, `rustfmt`, `clang-format` — run on save and enforced in CI. Once a formatter owns whitespace, quotes, and wrapping, *there is nothing to argue about*: the formatter's output is the answer, full stop. A comment about formatting on an auto-formatted codebase is a bug in the comment.
2. **Write down the judgment layer.** Things a formatter can't decide — naming conventions, error-handling patterns, when to use a builder vs a constructor, package structure — go in a **style guide**. When a reviewer and author disagree, the guide is the authority. If the guide is silent, the author decides *and* the disagreement becomes a proposal to update the guide — so the debate happens once, for everyone, not per-PR.

```bash
# The line that ends 10,000 future style debates: enforce the formatter in CI
- name: Check formatting
  run: |
    gofmt -l . | tee /tmp/unformatted
    test ! -s /tmp/unformatted   # fail the build if anything is unformatted
```

The cultural shift this enables is profound: **the reviewer is no longer the arbiter of taste**. They don't *have* to point out the unformatted code (the build does) or win the quotes argument (the formatter did). This removes the most common source of reviewer-as-tyrant dynamics, because the reviewer's authority is now scoped to correctness and design — where it belongs — instead of taste, where it breeds resentment.

> **The hard-won lesson:** the team that argues about style in every PR doesn't have a tone problem or an empathy problem — it has a *missing artifact* problem. Adopting an auto-formatter plus a style guide doesn't make people nicer; it makes the argument *impossible to have*, which is far more reliable than asking people to be nicer. "The style guide decides, not the reviewer" is the most important sentence in a mature review culture.

---

## Core Concept 3 — Severity Labels and Conventional Comments

The second-biggest source of review friction after taste is **ambiguous severity**: the author can't tell whether a comment is a hard blocker or an idle musing, so they treat every comment as a potential merge-blocker, and reviewers who feel everything is important produce a wall of equally-weighted notes whose signal is zero.

The fix is to make severity explicit and *mandatory*. **Conventional Comments** is the most widely adopted convention:

```text
nit: this could be a const          ← trivial, ignore freely, never blocks
suggestion: extract this to a helper ← consider it, author's call
suggestion (blocking): this leaks the connection on the error path  ← must address
issue (blocking): this is an off-by-one; the last element is dropped ← must fix
question: is this retry safe if the upstream is non-idempotent?      ← clarify, may or may not block
praise: this error-handling is exactly right, thanks                 ← reinforce good work
```

The labels do three jobs at once:

- **For the author:** "is this blocking?" is answered by the prefix, not by re-reading the reviewer's mood. A wall of `nit:`s is clearly skippable; a single `issue (blocking):` is clearly not.
- **For the reviewer:** the act of *choosing* a label forces self-calibration. Labeling something `issue (blocking)` makes you ask "is this *really* blocking, or do I just prefer it?" The label is a forcing function against the "everything is important" reflex.
- **For the org:** labels are parseable. You can measure the ratio of blocking to non-blocking comments, spot the reviewer whose every comment is `(blocking)`, and feed bots that auto-resolve `nit:` threads.

The most important rule layered on top: **a reviewer who marks everything blocking has no signal.** If 90% of your comments are blocking, none of them are — the author can't prioritize, so they either fight all of them or capitulate to all of them. The discipline is a *budget*: most comments should be `nit:` or `suggestion:`, with `(blocking)` reserved for correctness, security, contracts, and genuine risk. A staff engineer's review on a junior's PR might be three teaching `suggestion:`s and one `issue (blocking):` — not eleven blockers.

> **The principle:** severity labels convert an emotional, ambiguous signal ("the reviewer left a lot of comments, is my PR bad?") into a structured one ("one blocker, four suggestions, two nits — I'll fix the blocker, take two suggestions, ignore the nits"). They also expose the "everything is blocking" reviewer whose feedback was worthless precisely *because* it was undifferentiated. Mandating the labels is the cheapest, highest-leverage norm change available after adopting a formatter.

---

## Core Concept 4 — Psychological Safety Is a Staff Responsibility

Review is where engineers are most exposed: their work is public, scrutinized, and judged by peers. It is therefore the single highest-leverage place to either build or destroy psychological safety — the shared belief that you can submit imperfect work, ask a "dumb" question, or push back on a senior without being punished. When that safety is absent, the symptoms are predictable and expensive: people batch up huge PRs to minimize the number of times they're reviewed, juniors stop asking questions, authors capitulate to bad feedback to end the ordeal, and the best engineers quietly route around the worst reviewers.

The toxic behaviors that erode it are specific and nameable (see [08 — Review Anti-patterns](../08-review-anti-patterns/professional.md) for the full catalog):

- **Ego comments** — feedback that's about the reviewer's superiority, not the code. "Did you even test this?" "This is not how a senior would write it." "Obviously you should..." The information content is near zero; the status signal is the whole point.
- **Gatekeeping** — using approval power to enforce personal preference, rewrite the author's design in the reviewer's image, or make merging contingent on changes the guide doesn't require.
- **Pile-ons** — multiple reviewers dogpiling, often on the same trivial point, in volume disproportionate to the change's risk.
- **Death by a thousand nits** — burying a fundamentally fine PR under so many trivial comments that the author concludes their work is bad, when it's fine.

The staff/principal and EM role here is not to write better comments themselves — it's to **model and enforce the norms**:

1. **Model the behavior visibly.** Senior people's reviews are watched and copied. A staff engineer who leads with questions, labels severity, praises specifically, and concedes taste calls teaches the whole team by example more effectively than any guide. A staff engineer who leaves curt ego comments licenses everyone below them to do the same.
2. **Call out toxic behavior — promptly and privately first.** An ego comment left unaddressed is an ego comment endorsed. The intervention is usually a quiet "hey, that comment came across as harsh — can you reframe it as a suggestion?" not a public callout. But it has to happen, because the behavior compounds.
3. **Make it safe to receive.** Normalize self-review (the author leaves the first comments on their own PR, pointing out trade-offs and asking for specific feedback), normalize "good question, here's why," and explicitly separate ego from code as a stated team value: *we critique the code, never the person, and the author is not their PR.*

> **The audit reality:** the cost of a toxic review culture is invisible right up until someone leaves, and then it's a regrettable-attrition line item that the exit interview traces directly to "code reviews here are brutal." By then you've lost the engineer, the institutional knowledge, and the morale of everyone who watched it happen. Psychological safety in review isn't a soft nicety — it's a retention and velocity lever, and it's the staff/EM job to protect it actively, not assume it.

---

## Core Concept 5 — Disagreement at Scale and Decision Rights

Two competent engineers will disagree on real design questions, and that's healthy — disagreement is how the best option gets pressure-tested. The failure isn't disagreement; it's **unresolved** disagreement. At scale, two specific failure modes recur, and they're mirror images:

- **The dictator-reviewer:** a reviewer who blocks until the author capitulates, using approval as a veto on matters of taste. The author gives in to ship, the better idea may lose, and resentment accrues. The reviewer's authority has exceeded its legitimate scope (correctness/design) into illegitimate scope (taste/preference).
- **The endless debate:** a PR that ping-pongs for days or weeks because neither party will yield and there's no mechanism to decide. The change rots, rebases pile up, and the cost of the stalemate dwarfs the cost of either decision.

The antidote to both is **documented decision rights**: a written, agreed answer to "who decides, and how fast." The escalation ladder most mature teams use:

1. **Data first.** If the disagreement is empirical ("this is slower," "this leaks"), resolve it with a benchmark, a test, or a profile. Many "design disagreements" are actually factual questions wearing a disguise, and data ends them cleanly.
2. **The style guide / written standard.** If a written norm covers it, the norm decides — neither person's opinion overrides the artifact. If the guide is silent, this disagreement becomes a *proposal to update the guide* (decided async, once, for everyone).
3. **The author decides** on reversible and pure-taste calls. The reviewer raises the concern once, the author considers it and chooses, and the reviewer approves. "Disagree and commit" is the norm: you can record your dissent in a comment and still approve.
4. **Escalate to a named tie-breaker** when none of the above resolves it within a bounded time (e.g., one business day): the tech lead, the area owner, or a designated decider. The tie-breaker makes a *call*, documents the reasoning, and the PR moves. The point is not that the tie-breaker is always right — it's that the PR is never *hostage*.

```markdown
# Excerpt from a real ESCALATION.md

If a reviewer and author can't agree and the PR is stalled > 1 business day:
1. State the disagreement in one comment each (no re-litigating).
2. If it's empirical → add a test/benchmark; the data decides.
3. If a written standard covers it → the standard decides.
4. If it's reversible/taste → the AUTHOR decides; reviewer may "disagree and commit."
5. Otherwise → @-mention the tech lead. They decide within 1 day and note why.
No PR sits longer than 2 business days on a disagreement. Ever.
```

> **The principle:** the goal of a decision-rights model is not to make the *right* decision every time — it's to make *a* decision in bounded time, so the org never pays the compounding cost of a hostage PR. A documented escalation path also defangs the dictator-reviewer, because their veto is no longer the final word — the author can invoke the ladder. The presence of the ladder usually means it's rarely needed: people resolve things faster when they know an unfavorable tie-break is the alternative to agreeing.

---

## Core Concept 6 — Making Review Visible and Valued

Code review is **invisible work**. The author's contribution is a visible PR with their name on it; the reviewer's contribution is a thread that gets resolved and forgotten. Authoring shows up in commit history, sprint velocity, and demos. Reviewing shows up nowhere — unless someone deliberately makes it show up. This asymmetry is the single most powerful force degrading review quality over time, and it operates through a simple incentive gradient:

> If reviewing well is unrewarded and authoring is rewarded, every rational engineer will under-invest in reviewing. Reviews degrade to rubber-stamps — fast LGTMs that protect the reviewer's time at the expense of quality — and the degradation is *invisible* until a defect that a real review would have caught reaches production.

The professional move is to **make reviewing visible and valued**, deliberately:

- **Name it in performance and promotion.** If your competency rubric rewards "ships features" but is silent on "improves others' work through review," you are explicitly incentivizing rubber-stamps. Staff and principal expectations especially should weight review and mentoring heavily — for senior engineers, *review is a primary mechanism of leverage*, and it should be evaluated as such. The fix is concrete: add "elevates the team through review and mentoring" to the rubric, and gather evidence (thoughtful review threads, mentoring through review) the way you gather evidence for shipped work.
- **Surface the contribution.** Shout out a great review in the team channel the way you'd celebrate a shipped feature. Reference specific reviews in performance feedback ("your review on the auth refactor caught a real auth bypass and taught the author the threat model"). Make the invisible visible.
- **Treat review as the primary mentoring channel — and scale it.** For most engineers, the highest-bandwidth mentoring they receive is in code review, not in 1:1s. A teaching comment with a link and a "here's why" on a junior's PR is worth more than a generic mentoring session. Scaling this means pairing juniors with reviewers who teach, rotating reviewers so knowledge spreads, and explicitly treating "did this review *teach* something?" as a quality dimension, not just "did it catch bugs?"

The inverse — what *not* to do — is to gamify review with raw metrics (next concept). The goal is to value review *qualitatively and visibly*, not to turn it into a leaderboard.

> **The hard-won lesson:** review quality follows incentives with brutal reliability. A team where review is invisible work will, within a quarter or two, converge on rubber-stamping — not because anyone is lazy, but because the system rewards it. The fix isn't exhortation ("please review more carefully"); it's changing what's rewarded. The teams with the best review cultures are, without exception, the teams where reviewing well is a recognized, evaluated contribution — not a tax on your "real" work.

---

## Core Concept 7 — Calibration, Metrics, and the AI-Review Wave

**Calibration** is the property that the *bar* is consistent — across reviewers and across the seniority of the author. Two failure modes:

- **Across reviewers:** one reviewer blocks on missing tests; another never mentions them. One leaves twenty nits; another approves in thirty seconds. The author's experience of "passing review" now depends on the lottery of who's assigned, which is both unfair and corrosive to trust in the process. The fix is *calibration sessions*: periodically, a few reviewers review the same PR independently and compare — surfacing where the bar drifts and re-aligning it. (This is the same discipline as interview calibration; the mechanism is identical.)
- **Across seniority:** the right *depth* of feedback depends on who wrote the code. A staff engineer's PR to another staff engineer can be a terse "no, this races on the cache eviction — see line 40," because the context is shared. The *same* terse "no" on a junior's PR is a missed teaching opportunity at best and demoralizing at worst — the junior needs the *why*, a link, and the reasoning. Calibrating depth by author seniority isn't inconsistency; it's matching the feedback to what the recipient can use.

**Metrics — handle with extreme care.** Review activity is gameable, and Goodhart's Law is merciless here (see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/)):

- **Never rank or reward by comment count.** The instant comment count is a target, you get nitpicking — reviewers manufacturing trivial comments to hit a number, which is the *opposite* of the goal. Quality of review is inversely related to performative volume.
- **Never rank by review count.** This rewards rubber-stamping — speed-LGTMs to inflate the number. You've now incentivized exactly the degradation you were trying to prevent.
- **Do measure flow and health, Goodhart-aware.** Time-to-first-review and review cycle time (are PRs waiting on reviewers?), defect-escape rate (are reviews catching real issues?), and PR size distribution (are PRs reviewable?) are *system* signals, used to improve the *process*, not to rank *people*. The moment a healthy flow metric is attached to an individual's rating, it becomes a target and rots. Keep them at the team/system level. (Full treatment in [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md).)

**The AI-review wave and its effect on feedback culture.** Automated reviewers (AI bots, LLM-based review tools — see [tooling, 06](../06-review-tooling-and-automation/professional.md)) change the noise economics of review. The opportunity: they catch the mechanical and the obvious, freeing humans for design and correctness. The risk: they generate *volume* — plausible-looking, often-trivial, sometimes-wrong comments — that can drown the signal and retrain authors to ignore *all* review comments, including the human ones. The norm to establish *before* you turn the bot on:

- **AI comments are suggestions by default, never blocking.** A bot does not get a veto.
- **Tune aggressively for signal; an AI reviewer that's mostly noise is worse than none** because it teaches dismissal.
- **A human still owns the review.** The bot augments; it does not approve. The accountable reviewer is a person.

> **The professional discipline:** the through-line of this concept is *resist the seductive metric*. Comment count, review count, and AI comment volume are all easy to measure and all actively harmful as targets, because each one, when gamified, produces the opposite of quality — nitpicking, rubber-stamping, and dismissal respectively. Calibrate the *bar* through human comparison, measure *flow* at the system level, and keep every gameable number off individual performance ratings. The metric that's easy to game is the metric that will be gamed.

---

## War Stories

**The auto-formatter that ended the war overnight.** A backend team's PRs averaged a dozen comments, half of them about formatting — quote style, import order, where the brace goes. Reviews dragged for days; two engineers had a running cold war over tabs. A staff engineer adopted the language's standard formatter, ran it once across the whole repo in a single "format everything" PR, and added a CI check that failed on unformatted code. The style debates didn't *decrease* — they became *impossible*. Overnight, there was nothing to argue about: the formatter's output was the answer. Review comments dropped by a third, and the cold war evaporated because neither party could win an argument the machine had already settled. The lesson: friction that looks interpersonal is often a missing artifact.

**The harsh senior and the junior who quit.** A talented senior engineer left curt, status-laden review comments — "did you even run this?", "this isn't how we do things", walls of equally-weighted blockers. A new-grad on the team, six weeks in, started batching work to minimize reviews, then stopped asking questions, then resigned. The exit interview named code review directly. The post-mortem fix was two-pronged: the EM had a direct conversation with the senior (who genuinely hadn't realized the impact — *terse to a peer reads as contempt to a junior*), and the team adopted Conventional Comments plus an explicit "critique the code, never the person; calibrate depth to the author" norm. The senior's reviews became some of the best on the team. The cost of *not* intervening earlier was one regrettable departure.

**The reviewer for whom everything was blocking.** One reviewer's comments were technically often correct but uniformly marked as must-fix — naming, structure, tests, and genuine bugs all carried equal, blocking weight. Authors couldn't tell the off-by-one from the brace placement, so they either fought all of it or capitulated to all of it; either way the *signal was zero*. The fix wasn't asking them to be nicer — it was *mandating severity labels*. Forced to choose `nit:` / `suggestion:` / `issue (blocking):` on each comment, the reviewer self-calibrated almost immediately: it turned out maybe 10% were genuinely blocking. Same reviewer, same eye for detail, suddenly *useful* — because the labels exposed and corrected the undifferentiated bar.

**The two-week hostage PR.** Two staff engineers disagreed on an abstraction boundary. The PR ping-ponged for two weeks — comment, rebuttal, rebase, repeat — while the feature it blocked slipped. Neither would yield; there was no mechanism to decide. The eventual unblock was an EM saying "tech lead decides, today." It got decided in twenty minutes. The retrospective output was a documented escalation path: data first, then the written standard, then author-decides on reversible calls, then a named tie-breaker within one business day. After that, hostage PRs essentially stopped — *because the ladder existed*, people resolved disagreements faster rather than risk an unfavorable tie-break.

**Review as invisible work, until it wasn't.** A team's review quality was sliding toward rubber-stamps. Investigation found the cause in the incentives: the perf rubric rewarded shipping and was silent on review, so the best reviewer — who spent real time mentoring through reviews — got a "needs to ship more" rating and rationally concluded reviewing was career-negative. The fix was to add "elevates the team through review and mentoring" to the competency rubric and to start citing specific great reviews in perf feedback and team shout-outs. Within two quarters review depth rose measurably and the defect-escape rate fell — *because the work was finally valued*. Incentives, not exhortation, moved the needle.

---

## Decision Frameworks

**Block, suggest, or defer to the author? Ask:**

| The comment is about... | Action | Label |
|---|---|---|
| Correctness, security, data loss, race | **Block** | `issue (blocking)` |
| A breaking change to a public/cross-team contract | **Block** | `issue (blocking)` |
| Missing tests on a risky or hard-to-revert path | **Block** | `suggestion (blocking)` |
| A genuine design concern on irreversible code | **Block**, but escalate if disputed | `issue (blocking)` |
| A better-but-reversible alternative | **Suggest**, author decides | `suggestion` |
| Naming, structure, "I'd do it differently" | **Suggest** once, then defer | `suggestion` / `nit` |
| Anything the formatter/linter owns | **Don't comment** — it's already decided | — |

**Resolving disagreement — the ladder:**

| Rung | Use when | Who decides |
|---|---|---|
| 1. Data | The dispute is empirical (speed, correctness, leak) | The benchmark/test/profile |
| 2. Written standard | A style guide / norm covers it | The artifact (not either person) |
| 3. Author-decides | It's reversible or pure taste | The author ("disagree and commit") |
| 4. Escalate | None of the above resolved it in 1 business day | Named tie-breaker (tech lead/owner) |

**Feedback-norms checklist for a team:**

| Norm | In place? |
|---|---|
| Written review guide (what we block on vs flag) | ☐ |
| Auto-formatter enforced in CI (taste off the table) | ☐ |
| Style guide for the judgment layer | ☐ |
| Conventional Comments / mandatory severity labels | ☐ |
| Documented escalation path with a bounded SLA | ☐ |
| "Author decides reversible/taste calls" stated as a value | ☐ |
| Self-review (author comments first) normalized | ☐ |
| Review valued in perf/promotion rubric | ☐ |
| Periodic reviewer calibration | ☐ |
| AI comments non-blocking; a human owns the review | ☐ |

**Calibrating feedback depth by author seniority:**

| Author | Reviewer's right move | Why |
|---|---|---|
| Junior / new-grad | Teach: the *why*, a link, the reasoning; one blocker at a time | They need context to grow; a terse "no" demoralizes |
| Mid-level | Concise + rationale; trust them with trade-offs | They can act on a pointer; over-explaining condescends |
| Senior peer | Terse is fine: "this races on eviction, line 40" | Shared context; brevity is respect, not contempt |
| New to *this* codebase (any level) | Teach the codebase's conventions, not the language | Seniority ≠ context; the gap is local, not general |

**Healthy vs toxic review-culture signals:**

| Healthy | Toxic |
|---|---|
| Comments labeled by severity; few blockers | Everything blocking; undifferentiated wall |
| Reviewer concedes taste calls | Reviewer blocks until author capitulates |
| Disagreements resolve in <2 days via the ladder | PRs held hostage for a week+ |
| Praise appears alongside critique | Only criticism; never a "this is good" |
| Critique aimed at the code | "Did you even test this?" — aimed at the person |
| Review valued in perf reviews | Review invisible; rubber-stamps creeping in |
| Authors self-review and push back safely | Authors batch huge PRs to dodge review |

---

## Mental Models

- **The style guide decides, not the reviewer.** Delegating taste to an artifact (and a formatter) removes the most common source of friction *and* the most common source of reviewer-as-tyrant dynamics. You can't make people stop arguing about taste; you can make the argument impossible.

- **A norm that isn't written down is just whoever's loudest.** The value of the artifact is that it can be *pointed at*. "Per the guide, that's a suggestion" ends a debate; the same words without the guide are just one opinion.

- **A reviewer who marks everything blocking has no signal.** Severity is only useful if it's *differentiated*. The discipline is a budget: mostly nits and suggestions, blocking reserved for real risk.

- **Review quality follows incentives, not exhortation.** If reviewing is invisible and shipping is rewarded, you'll get rubber-stamps no matter how often you say "review carefully." Value the work or watch it decay.

- **No PR is ever a hostage.** A documented tie-breaker with a bounded SLA defangs both the dictator-reviewer and the endless debate. The ladder existing is what makes it rarely needed.

- **The metric that's easy to game is the metric that will be gamed.** Comment count → nitpicking. Review count → rubber-stamping. Measure flow at the system level; keep gameable numbers off individual ratings.

---

## Common Mistakes

1. **Leaving norms in people's heads.** Osmosis stops working at scale and across distributed/fast-growing teams. Write the review guide, the style guide, and the escalation path down — the artifact's job is to be pointed at, not memorized.

2. **Letting taste debates happen in PRs.** A formatter plus a style guide makes them impossible. If you're still arguing about quotes and braces, you have a missing-artifact problem, not an empathy problem. Adopt the formatter and enforce it in CI.

3. **Ambiguous severity.** Without labels, the author can't tell a blocker from a musing and treats everything as a potential block. Mandate Conventional Comments / severity labels, and reserve `(blocking)` for real risk.

4. **Ignoring toxic review behavior.** Ego comments, gatekeeping, and pile-ons compound silently and cost you people. The staff/EM job is to model good feedback and *intervene* — privately, promptly — when it goes bad. An unaddressed ego comment is an endorsed one.

5. **No tie-breaker.** Without documented decision rights you get either dictator-reviewers or two-week hostage PRs. Write the ladder: data → standard → author-decides → named tie-breaker with a bounded SLA.

6. **Leaving review invisible.** If review isn't valued in perf and promotion, it decays to rubber-stamps within a quarter or two. Name it in the rubric, cite specific reviews, surface the contribution. Incentives move quality; exhortation doesn't.

7. **Gamifying review with raw metrics.** Ranking by comment count breeds nitpicking; ranking by review count breeds rubber-stamping. Measure flow and health at the *system* level, Goodhart-aware, and keep gameable numbers off individual ratings.

8. **Turning on an AI reviewer without noise discipline.** A bot that's mostly noise retrains authors to ignore *all* comments, human ones included. Make AI comments non-blocking, tune hard for signal, and keep a human accountable for the review.

---

## Test Yourself

1. A team argues about formatting in nearly every PR and review takes days. What's the single highest-leverage fix, and *why* does it work better than asking reviewers to be more diplomatic?
2. A reviewer's comments are often correct but every one is marked must-fix, so the author can't prioritize. What norm fixes this, and what's the mechanism by which it self-corrects the reviewer?
3. Two staff engineers have disagreed on a design point and the PR has sat for a week. Walk through the escalation ladder a mature team would apply. What's the actual goal of the ladder?
4. Your perf rubric rewards shipping features and is silent on review. Predict what happens to review quality over two quarters, and name the concrete fix.
5. Leadership proposes ranking engineers by number of review comments to "encourage thorough reviews." What goes wrong, what law explains it, and what should you measure instead?
6. A staff engineer leaves a terse "no, this races on the cache" on both a senior peer's PR and a new-grad's PR. Why is this calibrated for one and miscalibrated for the other?
7. Your team is about to enable an AI code reviewer. What two norms must you establish *before* turning it on, and what's the failure mode if you don't?

<details>
<summary>Answers</summary>

1. **Adopt an auto-formatter and enforce it in CI**, plus a style guide for the judgment layer. It beats diplomacy because it makes the argument *impossible to have* rather than relying on people choosing to be nicer: once the formatter owns whitespace/quotes/wrapping, its output is the answer and there's nothing to debate. "The style guide decides, not the reviewer" removes taste from the reviewer's scope, which is more reliable than asking for restraint.
2. **Mandatory severity labels (Conventional Comments).** The mechanism: forcing the reviewer to choose `nit:` / `suggestion:` / `issue (blocking)` on each comment is a forcing function — the act of labeling something blocking makes them ask "is this *really* blocking?", and they self-calibrate (typically realizing only ~10% are). The author also regains the ability to prioritize. Same reviewer, same eye, suddenly useful.
3. **Data → written standard → author-decides → named tie-breaker.** Resolve empirical disputes with a benchmark/test; if a standard covers it the standard decides; if it's reversible/taste the author decides ("disagree and commit"); otherwise escalate to the tech lead/owner within a bounded time (e.g., 1 business day). The goal is **not** the *right* decision every time — it's *a* decision in bounded time, so no PR is ever a hostage. The ladder's existence usually makes it rarely needed.
4. Review quality slides toward **rubber-stamping** — rational engineers under-invest in unrewarded work, and the best reviewer may even be penalized ("needs to ship more"). The fix is to **value review in the rubric**: add "elevates the team through review and mentoring," cite specific great reviews in perf feedback, and surface the contribution publicly. Incentives move quality; "please review more carefully" doesn't.
5. You get **nitpicking** — reviewers manufacture trivial comments to hit the number, the opposite of quality. **Goodhart's Law** ("when a measure becomes a target it ceases to be a good measure") explains it. Instead, measure **flow and health at the system level** — time-to-first-review, cycle time, defect-escape rate, PR-size distribution — to improve the *process*, and keep all gameable numbers off individual ratings.
6. **Calibrated for the senior peer:** shared context means brevity is efficient and respectful — they can act on the pointer immediately. **Miscalibrated for the new-grad:** they need the *why*, the reasoning, and ideally a link to grow; the same terse "no" is a missed teaching opportunity and reads as dismissive/demoralizing. Depth should match what the recipient can use, not be uniform.
7. (a) **AI comments are non-blocking by default — a bot gets no veto**; (b) **a human still owns/approves the review, and you tune the bot aggressively for signal.** The failure mode if you don't: the bot generates volume (plausible, trivial, sometimes wrong) that drowns the signal and retrains authors to ignore *all* comments — including the human ones — making the bot worse than none.

</details>

---

## Cheat Sheet

```
NORMS AS ARTIFACTS (write them down — they exist to be pointed at)
  REVIEW_GUIDE.md    what we block on vs flag; fact-vs-preference; author-decides
  STYLE_GUIDE.md     the judgment layer; ends taste debates
  ESCALATION.md      the tie-breaker ladder + bounded SLA
  CONVENTION         Conventional Comments / severity labels (mandatory)

THE STYLE GUIDE DECIDES, NOT THE REVIEWER
  auto-format mechanical layer (gofmt/prettier/black) + enforce in CI
  → formatting comments become impossible, not just discouraged
  write down judgment layer; if guide is silent → author decides + propose update

SEVERITY LABELS (differentiation = signal)
  nit:                trivial, ignore freely, never blocks
  suggestion:         consider it, author's call
  issue (blocking):   correctness/security/contract — must fix
  question:           clarify
  praise:             reinforce good work
  RULE: marking everything blocking = no signal. Budget the blockers.

DISAGREEMENT LADDER (no PR is ever a hostage)
  1 data   →  2 written standard  →  3 author-decides  →  4 named tie-breaker
  bounded SLA (e.g. decide within 1 business day)
  defangs BOTH the dictator-reviewer AND the endless debate

CULTURE (staff/EM responsibility)
  model good feedback (you're being copied)
  call out ego comments / gatekeeping / pile-ons — privately, promptly
  critique the code, never the person; the author is not their PR
  normalize self-review + safe push-back

MAKE REVIEW VISIBLE (or it decays to rubber-stamps)
  value it in perf/promotion rubric; cite specific reviews; shout it out
  review = primary mentoring channel → reward teaching, not just bug-catching

METRICS (Goodhart-aware)
  NEVER rank by comment count (→ nitpicking) or review count (→ rubber-stamping)
  DO measure flow/health at SYSTEM level: time-to-first-review, cycle time,
     defect-escape, PR-size distribution — never on individual ratings

CALIBRATION
  bar consistent across reviewers (calibration sessions)
  depth scaled to author seniority (terse for peers, teaching for juniors)

AI REVIEW
  non-blocking by default; tune hard for signal; a human owns the review
```

---

## Summary

- **Make norms artifacts, not vibes.** A review guide (block vs flag, fact-vs-preference, author-decides), a style guide, a comment convention, and an escalation path — written down so they can be *pointed at*. Osmosis stops scaling; artifacts don't.
- **The style guide decides, not the reviewer.** Auto-format the mechanical layer and enforce it in CI so taste debates become *impossible*; write down the judgment layer so they happen once, not per-PR. This is the single biggest reducer of review friction.
- **Mandate severity labels** (Conventional Comments). They turn an ambiguous emotional signal into a structured one, force reviewers to self-calibrate, and expose the "everything is blocking" reviewer whose feedback was worthless precisely because it was undifferentiated.
- **Psychological safety in review is a staff/EM responsibility.** Model good feedback, call out ego comments / gatekeeping / pile-ons promptly, and make it safe to submit imperfect work and push back. The cost of a toxic culture is invisible until someone leaves. Deep interpersonal craft → [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/); anti-patterns catalog → [08](../08-review-anti-patterns/professional.md).
- **No PR is ever a hostage.** Documented decision rights — data → standard → author-decides → named tie-breaker with a bounded SLA — defang both the dictator-reviewer and the endless debate.
- **Make review visible and valued**, or it decays to rubber-stamps within a quarter. Reward it in the perf rubric, cite specific reviews, and treat it as the primary mentoring channel. Review quality follows incentives, not exhortation.
- **Calibrate the bar and resist the seductive metric.** Keep the bar consistent across reviewers and scale depth to author seniority; measure flow/health at the *system* level, never rank by comment or review count (Goodhart), and keep gameable numbers off individual ratings — see [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md) and [Engineering Metrics & DORA](../../engineering-metrics-and-dora/). Keep AI-review comments non-blocking with a human accountable — see [tooling, 06](../06-review-tooling-and-automation/professional.md).

The remaining tier — [interview.md](interview.md) — consolidates the entire topic into the questions that probe whether someone can actually run a feedback culture, not just write a polite comment.

---

## Further Reading

- *Software Engineering at Google*, Chapter 9 ("Code Review") — the canonical account of review at scale: readability, the single-LGTM model, and review as a cultural institution rather than a gate.
- [Google's Code Review Developer Guide](https://google.github.io/eng-practices/review/) — both halves: "The Standard of Code Review" (when to block, "the author is right on taste") and "How to Write Code Review Comments" (the norm-setting source most teams adapt).
- [Conventional Comments](https://conventionalcomments.org/) — the labeling convention that makes severity and intent explicit; adopt it team-wide to end ambiguous-severity friction.
- Michaela Greiler, *Code Reviews Like a Human* (and her review-culture writing) — practical, research-backed guidance on the human side of review at team scale.
- *Debugging Teams* (Fitzpatrick & Collins-Sussman) — the "HRT" (Humility, Respect, Trust) framing for the psychological-safety dimension of collaboration and review.
- [interview.md](interview.md) — the interview-lens consolidation of this topic.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/professional.md) — small PRs are a feedback-culture lever: they're reviewable, lower-stakes, and reduce the batching that toxic review drives.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md) — the Goodhart-aware, system-level flow metrics that replace the gameable comment/review counts.
- [08 — Review Anti-patterns](../08-review-anti-patterns/professional.md) — the full catalog of ego comments, gatekeeping, pile-ons, and death-by-nits that norms exist to prevent.
- [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the deep interpersonal craft: phrasing, tone, conflict de-escalation, and receiving feedback gracefully.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — Goodhart's Law, SPACE, and why you measure flow/health rather than ranking people by review activity.
