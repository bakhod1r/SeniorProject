# Giving & Receiving Feedback — Senior Level

> **Roadmap:** [Code Review](../README.md) → Giving & Receiving Feedback
> *The middle page taught you to write a kind, actionable comment. This page is about feedback as a decision system: how a comment is a typed request to change state, why honest severity is the thing that keeps your signal alive, how to resolve a disagreement on objective criteria instead of authority, and why review — not the design doc, not the 1:1 — is where most senior-to-junior knowledge actually transfers.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Comment Is a Typed Request to Change State](#core-concept-1--a-comment-is-a-typed-request-to-change-state)
5. [Core Concept 2 — Severity as a Decision Protocol](#core-concept-2--severity-as-a-decision-protocol)
6. [Core Concept 3 — Resolving Disagreement on Objective Criteria](#core-concept-3--resolving-disagreement-on-objective-criteria)
7. [Core Concept 4 — The Escalation Path and the War of Attrition](#core-concept-4--the-escalation-path-and-the-war-of-attrition)
8. [Core Concept 5 — Review as the Primary Mentoring Channel](#core-concept-5--review-as-the-primary-mentoring-channel)
9. [Core Concept 6 — Self-Review as a Quality Gate You Own](#core-concept-6--self-review-as-a-quality-gate-you-own)
10. [Core Concept 7 — Receiving Well, at Depth](#core-concept-7--receiving-well-at-depth)
11. [Core Concept 8 — The Reviewer's Restraint](#core-concept-8--the-reviewers-restraint)
12. [Core Concept 9 — Calibration Across a Team](#core-concept-9--calibration-across-a-team)
13. [Real-World Examples](#real-world-examples)
14. [Mental Models](#mental-models)
15. [Common Mistakes](#common-mistakes)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Feedback as a system for reaching good decisions efficiently — the engineering side of the conversation, not the interpersonal one.**

By the middle level you write a comment that is specific, actionable, and kind. You ask questions instead of issuing decrees, you praise good work, you don't nitpick formatting a linter should catch. That makes you a reviewer people don't dread.

The senior jump is different: you stop treating review as *a series of polite comments* and start treating it as *a decision system with a measurable failure mode*. A code review is a negotiation between two engineers over whether a diff should merge as-is, and every comment is a move in that negotiation — a request to change the state of the change, carrying an implicit claim about the cost of *not* changing it. The senior skill set is everything that makes that system converge on the right answer fast: assigning severity honestly so the signal isn't drowned, resolving disagreement on objective criteria instead of seniority, knowing the escalation path so a thread never silently stalls a PR for three days, and using the whole channel as the highest-bandwidth mentoring surface you have.

This page is rigorous about the *mechanics* of those decisions. The deep interpersonal layer — psychological safety, the emotional texture of receiving criticism, navigating a defensive author — is real and important and lives in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/). Here we treat feedback as engineering.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the anatomy of a good comment, asking vs telling, the praise-and-prioritize habits, separating must-fix from nice-to-have.
- **Required:** You can hold a review thread without taking it personally, and you've been on both sides of a disagreement that didn't resolve cleanly.
- **Helpful:** You've reviewed enough PRs across a team to have *noticed* that different reviewers block on wildly different things — the calibration problem is visible to you.
- **Helpful:** You've mentored at least one junior through review and watched a comment either teach a durable principle or get the same mistake re-made next week.

---

## Glossary

| Term | Meaning |
|---|---|
| **Severity / priority** | The reviewer-assigned weight of a comment, encoding the cost of not acting — from `nit` (cosmetic) to blocking. |
| **Blocking comment** | A comment whose resolution is a precondition for approval; the PR should not merge until it's addressed or explicitly waived. |
| **Nit** | A trivially-actionable, non-blocking comment, conventionally prefixed `nit:` so the author knows it carries no merge weight. |
| **Conventional Comments** | A labeling convention (`praise:`, `nit:`, `suggestion:`, `issue:`, `question:`, `blocking:`) that puts the comment's *type and weight* in the first token. |
| **Disagree on facts vs values** | The split between a dispute resolvable by evidence (a benchmark, a spec) and one resolvable only by preference (taste, architecture philosophy). |
| **Author-is-right-by-default** | The principle that on reversible/taste decisions, the author's call stands, to preserve velocity. |
| **Escalation** | The structured move from a stalled async thread to a tech lead, the style guide, or a synchronous discussion — never a silent stalemate. |
| **War of attrition** | A comment thread that keeps round-tripping (4, 5, 6 replies) without converging; a signal to switch mediums. |
| **Self-review** | The author's own pre-PR pass over the diff, read as a hostile reviewer, before any human sees it. |
| **Steel-manning** | Responding to the *strongest* version of the reviewer's point, not the weakest reading you could refute. |
| **Calibration** | Cross-team consistency in what severity gets assigned to a given class of issue. |

---

## Core Concept 1 — A Comment Is a Typed Request to Change State

The most clarifying reframe at the senior level: a review comment is not "an opinion I am sharing." It is a **request to change the state of the pull request**, and like any request it carries a type and a cost. The PR is a proposed state transition (the codebase, plus this diff). Each comment is a claim that the transition is wrong in some specific way, and an implicit assertion about *how wrong* — the cost of merging without addressing it.

Once you see comments as typed requests, the single most important property of a comment becomes its **type token**: the first word that tells the author what kind of move you're making and how much weight it carries. This is exactly what [Conventional Comments](https://conventionalcomments.org/) formalizes:

```
praise:     this is genuinely good — reinforce it, no action
nit:        cosmetic, take it or leave it, never blocks
suggestion: a concrete alternative; author decides
question:   I don't understand yet; not (necessarily) a change request
issue:      something is wrong; needs a response, may or may not block
blocking:   must be resolved before this merges
```

The token does real work. Without it, the author has to *infer* weight from your tone — and tone is exactly what the async-text medium destroys. "Why is this a `map` and not a `slice`?" reads as a hostile blocking demand or an idle curiosity depending on punctuation and the reader's mood that day. `question: why a map here and not a slice — is ordering load-bearing?` reads as exactly what it is: a request for information, zero merge weight.

> **Key insight:** The async-comment medium strips tone, so you must put the metadata back *in the text*. A label plus a rationale plus an assumption of good faith is not politeness theater — it's error-correction for a lossy channel. The same sentence, unlabeled, is a coin flip between "I'm curious" and "I'm blocking you." (The deeper emotional dynamics of that channel — why a terse comment can land as an attack — belong to [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/); here the point is purely that the label carries decision-weight the medium would otherwise lose.)

The corollary: every comment has a cost. It costs the author attention to read, parse, decide on, and respond to. A comment that says nothing the author can act on — a vague "this feels off," a restatement of what the code obviously does — is negative-value: it spends the author's budget and the thread's length without moving the decision. Before you post, ask the senior's question: *what state change am I requesting, and is it worth the author's round-trip?*

---

## Core Concept 2 — Severity as a Decision Protocol

If a comment encodes the cost of not acting, then **severity is the protocol that makes the review converge.** And the entire protocol depends on one discipline: **assigning severity honestly.**

Here is the distribution a calibrated reviewer produces on a typical PR. Most comments are praise, nits, and suggestions. A few are real issues. *Very* few are blocking. That shape is not an accident — it reflects reality, because in a healthy codebase most diffs are mostly fine, with a handful of genuine problems and a rare must-fix.

```
Calibrated reviewer, typical PR:
  praise        ██               (reinforce what's good)
  nit           ████             (cosmetic, optional)
  suggestion    ████             (alternatives, author decides)
  issue         ██               (real, needs response)
  blocking      █                (rare — actually must-fix)
```

Now the failure mode. The "everything is blocking" reviewer:

```
"Everything is blocking" reviewer:
  blocking      ██████████████   (every comment carries max weight)
```

This reviewer has destroyed their own signal. When *every* comment blocks, the word "blocking" stops meaning anything — the author can no longer tell the one comment that catches a data-loss bug from the nine that are the reviewer's stylistic preferences. The severity channel has a noise floor, and an inflationary reviewer has raised it to the ceiling. The author's rational response is to start ignoring severity entirely and re-litigate everything, which is slower and worse for *exactly the cases that actually mattered*.

> **Key insight:** Severity is a signal with a finite dynamic range, and inflating it spends a shared resource. The reviewer who blocks on everything isn't being thorough — they're jamming their own channel, so the one comment that should have stopped a bad merge gets the same weight as a variable-name preference. Honest severity is what keeps "blocking" a word the author still trusts.

Calibrating severity is a skill with concrete tests. Before you mark something blocking, ask:

- **Is it correctness, a real risk, or a one-way door?** A data-loss path, a security hole, a public-API mistake you can't take back, a missing-test on the exact logic being changed — these block. The cost of merging is genuinely high or irreversible.
- **Or is it taste, style, or a reversible call?** A different-but-fine structure, a naming choice, "I'd have used a different pattern" — these are suggestions at most. The cost of merging is low and the decision can be revisited cheaply later.

The honest reviewer downgrades aggressively. If you find yourself about to block on the *fourth* item in a single PR, stop and reread them — the prior is overwhelmingly that at least three are suggestions wearing a blocking label. The discipline of "most things are nits, few are blocking" is what makes your rare blocking comment land with full force.

---

## Core Concept 3 — Resolving Disagreement on Objective Criteria

The defining senior skill in feedback is **resolving disagreement** — and the technical framing is this: drive the resolution toward **objective criteria**, away from authority and taste.

Start by classifying the disagreement, because the resolution path depends entirely on the kind:

| You disagree on... | Resolved by... | Example |
|---|---|---|
| **Facts** | Evidence — a benchmark, a spec, a profile, a documented failure mode | "This is O(n²)" / "No, the map makes it O(n)" → measure it |
| **Values** | Negotiation, the style guide, or deferring to the author | "I prefer composition here" / "I prefer inheritance" |

**When you disagree on facts, you appeal to data, not to seniority.** The move that resolves a factual dispute is to make the fact checkable:

```
# WEAK — authority-based, escalates the conflict
"I've been doing this for ten years, trust me, the channel approach will deadlock."

# STRONG — criteria-based, ends the dispute
"I think this deadlocks when the buffer fills and both goroutines are sending.
 Here's a test that reproduces it:  [link to failing test]
 If I'm wrong about the ordering, the test will pass and I'll withdraw the comment."
```

The second form is irrefutable in the good sense: it converts "I think" into "here is the thing that's true or false." Either the test fails (you were right, the dispute is over) or it passes (you were wrong, you withdraw — fast, see Concept 7). Notice that you have removed yourself, your title, and your taste from the discussion entirely. The benchmark, the spec, the failing test, the linked style-guide rule — these are *third parties* both engineers can defer to without either losing face.

> **Key insight:** Appeal to a third party, not to yourself. A benchmark, a spec section, a reproducing test, or a written style-guide rule lets both engineers change their mind by deferring to an external authority neither of them *is* — which is psychologically free, while "you're wrong, defer to me" is psychologically expensive and often counterproductive. The senior move in any factual disagreement is to find the artifact that decides it.

**When you disagree on values, the default is to defer to the author.** If the dispute is genuinely taste — two reasonable structures, a reversible naming call, a pattern preference with no measurable difference — the author's choice wins. This is not weakness; it's velocity. Google's guidance is explicit about this: *the author is right by default on reversible decisions.* They have the most context on the change, they own it, and the cost of being wrong is low because it's reversible. Holding up a PR over a values-disagreement you can't ground in any objective criterion is the war of attrition (Concept 4) and a documented anti-pattern (see [08 — Review Anti-patterns](../08-review-anti-patterns/senior.md)).

So the senior's internal decision tree on any disagreement:

```
Is there an objective criterion that decides this?
├── YES → produce it (benchmark / spec / repro / style-guide link).
│         The artifact resolves it. Withdraw or hold based on what it says.
└── NO  → Is it reversible / taste / their-context?
          ├── YES → defer to the author. Maybe leave a non-blocking note.
          └── NO  → it's a values-disagreement on something irreversible
                    (architecture, a public contract). This is the hard case:
                    hold firm, state the risk concretely, and ESCALATE (Concept 4)
                    rather than win by attrition.
```

Knowing **when to hold firm** is the flip side. You hold on correctness, on a real and named risk, on a one-way door — and when you hold, you state the *specific failure mode*, not a generality. "I don't like this" is not holding firm; "this will lose writes on a partition because the ack happens before the fsync" is. The strength of a held position is the concreteness of the cost you can articulate.

---

## Core Concept 4 — The Escalation Path and the War of Attrition

A disagreement that doesn't resolve on the first or second exchange has a structured next step, and a senior knows it cold: **escalate, never stalemate.** The cardinal failure is the silent stall — a PR that sits for three days because a reviewer and author are dug in and neither has a move. That's pure cost: the change ages, rebases rot, the author context-switches away, and the disagreement still isn't resolved.

Two thresholds trigger a medium change:

**The round-trip limit.** After 2–3 back-and-forths on the *same thread* with no convergence, async text has failed for this dispute — you're now paying full latency (hours per round-trip) for a conversation that needs minutes. Switch to synchronous: a five-minute call or a desk conversation. This is the **war of attrition** signal, and the fix is mechanical:

```
[Thread is now on its 3rd round-trip, still not converging]

Reviewer:  "We've gone back and forth a few times and I don't think we're
            converging in comments. Grabbing 10 min — call or desk?
            I'll summarize whatever we land on back here so the decision
            is on the record."
```

Two things make this work. First, you *name* the switch instead of just adding a fourth reply — the author isn't blindsided. Second, **you write the outcome back into the thread.** A synchronous resolution that lives only in two people's heads is a decision with no audit trail; the PR record should show what was decided and why. (The tooling that makes this cheap — threading, suggested-changes, "resolve conversation," linking a call summary — is [06 — Review Tooling & Automation](../06-review-tooling-and-automation/senior.md).)

**The unresolvable disagreement.** When you've tried to resolve it (Concept 3), produced or sought the objective criterion, gone synchronous, and *still* disagree — typically a genuine values-disagreement on something irreversible — you escalate to a decider. Google's model is the reference here: try to resolve between yourselves first; if you can't, bring in a third party — a tech lead, the team, the **style guide as written authority**, or a senior who owns that area — and abide by the call. The style guide is doing important work in this model: a documented rule converts a recurring taste-fight into a one-time decision, so the same argument doesn't get re-litigated on every PR.

> **Key insight:** The escalation path exists so that no disagreement can hold a PR hostage. "Try to resolve → go synchronous → escalate to a decider" is a finite procedure that *always terminates*. The anti-pattern isn't disagreeing — it's the open-ended thread with no off-ramp, where the change just rots while two engineers restate themselves. A senior's job is to recognize the stall early and invoke the next step, not to win the thread.

The temporal discipline matters too: escalate *early*, not after a week of resentment has accumulated. The cost of escalation is small (a tech lead spends ten minutes); the cost of a week-stalled PR plus two annoyed engineers is large. The instinct to "not bother anyone" with an escalation is exactly backwards — a clean escalation on day one is cheaper for everyone than a war of attrition that ends in escalation on day five anyway.

---

## Core Concept 5 — Review as the Primary Mentoring Channel

Here is a fact most teams underweight: **code review is where the majority of senior-to-junior knowledge transfer actually happens.** Not the onboarding doc, not the architecture talk, not the 1:1. Review is concrete (it's *their* code, the exact thing they just wrote), it's frequent (every PR), and it's high-stakes-but-safe (it's caught before production). That makes it the highest-bandwidth teaching surface an organization has — and a senior who treats it as merely a defect filter is wasting most of its value.

Mentoring through review has two senior techniques.

**Calibrate depth to the author.** The same issue gets a different comment depending on who wrote it. A junior's PR earns a *teaching* comment — the why, the general rule, a link to go deeper. A staff peer's PR earns a *terse* one — they already know the principle; restating it is noise that costs them attention (and faintly insults them). Same defect, two comments:

```
# To a junior — teach the principle, with the why and a link
suggestion: This reads the file fully into memory, which works now but will
OOM once these files grow past a few hundred MB. The general rule: when input
size is unbounded or attacker-controlled, stream it rather than buffer it —
here, io.Copy or a bufio.Scanner. Worth internalizing because it shows up
everywhere (HTTP bodies, uploads, log processing).
See: https://...streaming-io

# To a staff peer — terse, principle assumed
nit: unbounded read — stream this? (files can get big)
```

Both are correct feedback. The first *builds a reviewer and an engineer*; the second respects an expert's time. Getting this wrong in either direction is a real cost: a teaching comment to a principal reads as condescension; a terse comment to a junior teaches them the fix but not the rule, so they re-make the mistake in a different file next week.

> **Key insight:** Teach the principle, not just the fix. A comment that says "change this to `io.Copy`" closes one bug; a comment that says "stream unbounded input, here's why, here's the general rule" closes a *category* of bugs and grows the engineer. The marginal cost is two sentences and a link; the return is that you never review the same mistake again. This is the single highest-leverage thing a senior does in review.

**Grow reviewers by reviewing their reviews.** Senior mentoring doesn't stop at authoring — you level up *reviewers* the same way. When a junior reviews a PR, read their review. Did they catch the real issue or only nits? Did they calibrate severity? Did they teach? A short note — "good catch on the nil-deref; the formatting comments are nits the linter handles, so you can skip those and save your and the author's attention for the logic" — teaches the meta-skill of *how to review*, which compounds across every review they ever do. The team's review quality is itself something you mentor.

---

## Core Concept 6 — Self-Review as a Quality Gate You Own

The highest-leverage habit on the *author* side is the **pre-PR self-review**: before any human sees the diff, you read it yourself as a hostile reviewer. This is the cheapest quality gate that exists, because it catches problems at the moment they cost the least — before they've consumed a reviewer's attention, before a round-trip, before they're a comment thread.

A real self-review is not a glance. It's a deliberate pass with a specific stance:

```
SELF-REVIEW CHECKLIST (run on your own diff, before you hit "request review")

  □ Read the FULL diff top to bottom as if a stranger wrote it.
  □ Did I leave debug prints, commented-out code, a TODO I meant to do, a
    hardcoded test value, a stray file?
  □ Does each change in the diff belong to THIS PR's story? (scope creep →
    pull it out, see Concept 8)
  □ Did I annotate the non-obvious parts — a comment on the surprising line,
    a PR-comment explaining a tradeoff I made?
  □ Does the PR DESCRIPTION tell the story: what, why, what I considered and
    rejected, how to verify? (so the reviewer reviews intent, not just text)
  □ Are the tests testing the actual logic, not just the happy path?
  □ Would I be slightly embarrassed if a specific senior saw any line here?
    → fix that line now.
```

Two parts of this carry outsized weight. **Annotating intent** — leaving your own comments on the diff before the reviewer arrives — turns a review of *code* into a review of *decisions*. "I'm using a mutex here rather than a channel because the critical section is tiny and the channel version benchmarked slower — numbers in the PR description" preempts the entire predictable disagreement (Concept 3) and tells the reviewer you already thought about it. And **the PR description telling the story** is what lets the reviewer review the right thing: a diff with no narrative forces the reviewer to reverse-engineer your intent from the code, which is slow and error-prone; a description that says *what and why* lets them check whether the code matches the intent.

> **Key insight:** Self-review is the single highest-leverage habit for both speed *and* quality, because it moves defect-catching to the cheapest possible point. Every embarrassing thing you catch in your own diff is a comment thread that never happens, a round-trip you don't pay, and a reviewer's attention you don't spend. The author who self-reviews ruthlessly ships faster *and* cleaner — these aren't in tension, they're the same habit. Reviewers can feel the difference instantly between a PR that was self-reviewed and one that wasn't.

The mindset shift that makes this work: read the diff *adversarially*, as the reviewer you'd least want to face — the one who finds the unhandled error, the off-by-one, the missing test. Catching it yourself is free; catching it after they comment costs a round-trip and a little of your credibility. The senior author internalizes that **the first reviewer of every PR is the author**, and that this review is the one they fully own.

---

## Core Concept 7 — Receiving Well, at Depth

Receiving feedback well is a senior skill, and the engineering core of it (the interpersonal core is [Soft-Skills](../../../../Soft-Skills/code-review/)) is a set of concrete moves.

**Separate your ego from the code.** The comment is about the diff, not about you. This sounds trivial and is the hardest thing on the list, because a critique of code you wrote *feels* like a critique of your competence. The senior reframe: a reviewer finding a bug in your PR is the system working — that's the *entire point* of review, and the bug found now is a bug not found in production. The reviewer who catches your mistake did you a favor.

**Steel-man the reviewer's point.** When a comment seems wrong, the junior move is to refute the weakest reading of it. The senior move is to respond to the *strongest* version — to ask "what would have to be true for this comment to be correct?" Often the reviewer is right and phrased it badly; occasionally they're pointing at a real problem via a wrong diagnosis. Steel-manning finds the real issue either way:

```
Reviewer:  "This should use a sync.Map."
# Weak reading (easy to refute): "sync.Map is slower for my access pattern, so no."
# Steel-man:  "The strongest version of this is 'you have concurrent access
#  here and a plain map will race.' That's actually right — there IS a race.
#  sync.Map isn't the best fix for write-heavy access, but a plain RWMutex is.
#  Good catch, fixing it that way — does that address your concern?"
```

The reviewer's *suggested fix* was suboptimal; the *underlying concern* was a real data race. Steel-manning caught the bug the literal reading would have argued past.

**Push back with evidence, concede fast when wrong.** Receiving well does not mean accepting everything — it means disagreeing the same way you'd want a reviewer to (Concept 3): with an objective criterion, not "I prefer it this way." And the mirror skill is **knowing when you're wrong fast.** The moment the evidence says you're wrong — the test fails, the benchmark disagrees, the spec is clear — concede immediately and visibly. "You're right, I missed that the buffer can fill — fixed in `a1b2c3d`, thanks" is a *strong* move, not a weak one. It ends the thread, it shows you reason from evidence rather than ego, and it builds exactly the credibility that makes your *own* held positions believed later.

> **Key insight:** Conceding fast when the evidence is against you is a senior strength, not a junior weakness. The engineer who says "you're right, fixed" the instant a test proves them wrong converges faster and is trusted *more* — because everyone can see they update on evidence, which means when they *do* hold firm, it's worth taking seriously. The slow-to-concede engineer trains their team to discount everything they say.

---

## Core Concept 8 — The Reviewer's Restraint

A senior reviewer is defined as much by what they *don't* comment as by what they catch. Restraint has three concrete disciplines.

**Don't rewrite the PR in comments.** It's the author's change. A reviewer who supplies a paragraph of preferred code for every function has stopped reviewing and started ghost-authoring — which is slow (you're writing the change twice), demoralizing (the author's agency is gone), and often wrong (you lack their full context). The reviewer's job is to identify *what* should change and let the author decide *how*. A suggested edit for a one-liner is fine; rewriting the architecture in a comment is a takeover. (This is a named anti-pattern — see [08 — Review Anti-patterns](../08-review-anti-patterns/senior.md).)

**Don't scope-creep.** The reviewer's reflexive "could you also…" is one of the most insidious velocity killers in review. The PR has a defined scope; "while you're in here, could you also refactor the adjacent module / fix this unrelated bug / add this feature" expands it without bound and punishes the author for touching the file at all. The discipline: anything outside the PR's stated scope becomes a **follow-up** — a ticket, a TODO, a separate PR — not a blocker on *this* one. (Scoping a change is [02 — Scope, Size & Decomposition](../02-pr-scope-and-size/senior.md), and unbounded-scope review is in [08](../08-review-anti-patterns/senior.md).)

```
# SCOPE CREEP (blocks an unrelated improvement on this PR)
"Could you also migrate the other three callers to the new API while you're here?"

# RESTRAINT (acknowledges it, doesn't block)
"Out of scope for this PR, but the other three callers should migrate to the
 new API too — filed AUTH-412 to track it. This PR is good as-is."
```

**Weigh the cost-benefit of every comment.** Each comment has a cost (Concept 1): the author's attention and a possible round-trip. A senior reviewer applies a threshold — *is this comment worth the author's time?* The pure-nit on line 400 of a 600-line diff that's otherwise solid might be worth swallowing, or batching as a single "a few cosmetic nits, all optional" note rather than fifteen separate threads. Reviewing isn't about demonstrating that you read every line by commenting on every line; it's about moving the change to a good state efficiently.

---

## Core Concept 9 — Calibration Across a Team

A subtle senior responsibility: **consistency of what gets blocked across reviewers.** If reviewer A blocks PRs for missing tests and reviewer B waves them through, the team has no actual standard — it has a lottery, and authors learn to *request the lenient reviewer*. Calibration is the work of making "what blocks here" a team property rather than a per-reviewer accident.

The symptoms of miscalibration are visible: the same class of issue gets a blocking comment from one reviewer and silence from another; authors game reviewer assignment; a PR's fate depends on *who* reviewed it more than on *what's in it*. The fixes are concrete and mostly come from making the implicit explicit:

- **Write it down.** The recurring "should this block?" questions become a written standard — a team review guide or a `CONTRIBUTING.md` that says *missing tests on changed logic blocks; style the linter catches never blocks; a different-but-fine structure is a suggestion.* A written rule is the calibration; it's also the third party you escalate to (Concept 4).
- **Automate the floor.** Everything a tool can decide — formatting, lint, coverage thresholds, import order — should be a tool, not a comment, so it's *uniformly* enforced and never a per-reviewer judgment call. This is the deep tie to [06 — Review Tooling & Automation](../06-review-tooling-and-automation/senior.md): automation isn't just faster, it's the *only* way to make the floor consistent across every reviewer.
- **Review the reviews (Concept 5).** Reading other reviewers' reviews surfaces calibration drift directly — you can see that one reviewer blocks on things the team agreed are nits, and coach toward the standard.

> **Key insight:** An uncalibrated team doesn't have a quality bar — it has a quality *lottery*, where a PR's fate depends on which reviewer it drew. The senior move is to push as much of the bar as possible into *written rules and automated checks*, so that "what blocks" is a property of the team and the tooling, not of whoever happened to pick up the review. The comments that remain should be the judgment calls no rule can make.

This also connects to how the team is measured: review latency, the rate of PRs blocked-then-merged-unchanged (a calibration smell — blocking on things that didn't actually need to change), and reviewer-to-reviewer variance are all things a senior watches. The systemic view of those signals is [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — but the per-review discipline that produces good numbers is calibration.

---

## Real-World Examples

**1. A factual disagreement, resolved by data.** Author writes a cache with a `sync.Mutex`. Reviewer comments `suggestion: this should be sync.Map for concurrent access.` Author replies not with "I prefer mutex" but with a benchmark: `sync.Map is optimized for read-heavy/append-only; our access is write-heavy (every request mutates). Benchmark: RWMutex 142ns/op, sync.Map 380ns/op for our pattern — numbers in the PR. Keeping the mutex; here's the benchmark code so you can check.` The reviewer responds `you're right, mutex it is — thanks for measuring.` The dispute is over in one round-trip because it was grounded in a number, not a preference. Neither engineer had to *concede to the other* — they both deferred to the benchmark.

**2. A war of attrition, cut short.** Reviewer and author go back and forth three times on whether an error should be wrapped or returned bare — a values-disagreement with no clear winner. On the fourth would-be reply, the reviewer instead writes: `We're not converging in comments — I think this is genuinely a judgment call. Grabbing 10 min? And honestly, if we still disagree, this is a team-convention question, not a this-PR question — let's get it into the style guide either way so we never have this thread again.` They talk, agree to wrap-with-context as a team default, and add it to `CONTRIBUTING.md`. The PR merges that afternoon; the *class* of disagreement is retired permanently.

**3. A teaching comment that compounds.** A junior's PR builds a SQL query by string concatenation with a user-supplied filter. The senior doesn't just write "use a parameterized query." They write: `blocking: this concatenates user input into SQL, which is a SQL-injection hole — an attacker can pass ' OR '1'='1 and read the whole table. The rule, no exceptions: never build SQL by string-joining user input; always use placeholders ($1, $2) so the driver separates code from data. This is one of the highest-impact rules in the whole field — worth burning in. [link to OWASP].` Three weeks later the same junior catches an injection bug in *someone else's* PR. The teaching comment didn't fix one query; it created a reviewer.

**4. Conceding fast.** A staff engineer argues in a thread that a proposed retry will cause a thundering herd. The author posts a test showing the retry has jitter and backoff and the herd doesn't materialize. The staff engineer replies, within minutes: `Ah — you're right, I missed the jitter on line 88. No herd. Withdrawing the comment, sorry for the noise.` That two-line concession does more for their credibility than winning would have: the team sees an expert update on evidence instantly, so the *next* time they hold firm, everyone takes it seriously.

**5. Severity honesty under pressure.** A reviewer is tempted to block a PR over six things. They reread their own comments and downgrade ruthlessly: one is a genuine nil-deref on a hot path (blocking), one is a missing test on the changed logic (blocking), and the other four are "I'd have structured it differently" (suggestions, all reversible). They post two blocking comments and four clearly-labeled nits. The author fixes the two real issues in twenty minutes, takes two of the four suggestions, declines two with a one-line reason, and the PR merges same-day. Had all six been blocking, the author would have argued all six and the two that mattered would have been lost in the noise.

---

## Mental Models

- **A comment is a typed request to change state, not an opinion.** It carries a type (`nit`/`suggestion`/`blocking`) and an implicit cost-of-not-acting. Putting the type in the first token restores the weight that the async-text medium strips out.

- **Severity is a signal with finite dynamic range.** Inflating it (blocking on everything) raises the noise floor until "blocking" means nothing and your real must-fix gets ignored. Honest severity — most things are nits, few block — is what keeps the channel trustworthy.

- **Disagreements split into facts and values, and the resolution path differs.** Facts are settled by a third-party artifact (benchmark, spec, repro test) you both defer to; values default to the author on anything reversible. Appeal to the artifact, never to your title.

- **Every disagreement has a finite escalation path.** Try to resolve → go synchronous after 2–3 round-trips → escalate to a decider/style-guide. The anti-pattern is the open-ended thread with no off-ramp; a senior recognizes the stall and invokes the next step rather than playing for the win.

- **Review is the highest-bandwidth mentoring channel you have.** It's concrete, frequent, and safe. Teaching the principle (not just the fix), calibrated to the author's level, closes whole categories of bugs and grows reviewers — the single highest-leverage senior act in review.

- **The first reviewer of every PR is the author.** Self-review read adversarially is the cheapest quality gate, because it catches defects before they cost a reviewer's attention or a round-trip. Speed and quality are the same habit here, not a tradeoff.

- **Restraint is a reviewer skill.** Not rewriting the PR, not scope-creeping, weighing each comment's cost. The PR is the author's change; the reviewer identifies *what* must change, not *how*, and pushes everything out-of-scope to follow-ups.

---

## Common Mistakes

1. **Marking everything blocking.** The dominant failure mode. It jams your own severity channel — when every comment carries max weight, the author can't find the one that catches a real bug. Downgrade ruthlessly; most things are nits or suggestions, and a rare blocking comment lands with full force.

2. **Winning disagreements by authority instead of evidence.** "Trust me, I've done this for years" escalates conflict and convinces no one. Produce the benchmark, the spec link, or the reproducing test — convert "I think" into "here's the thing that's true or false," and let the artifact decide.

3. **Letting a thread become a war of attrition.** After 2–3 round-trips with no convergence, async text has failed. Switch to synchronous and write the outcome back into the thread. The silent multi-day stall is the worst outcome — the change rots while two engineers restate themselves.

4. **Holding firm on a values-disagreement you can't ground.** If there's no objective criterion and the decision is reversible, the author is right by default. Holding a PR hostage over taste is a documented anti-pattern and a velocity killer.

5. **Giving a junior the fix without the principle.** "Change this to `io.Copy`" closes one bug; the junior re-makes the same mistake in a different file next week. Teach the general rule and the why — the marginal cost is two sentences, and the return is never reviewing that mistake again.

6. **Skipping self-review.** Shipping a diff you haven't read adversarially yourself spends reviewers' attention on debug prints, scope creep, and missing tests you could have caught for free. The author is the first reviewer; own that pass.

7. **Conceding slowly when the evidence is against you.** Dragging out a thread after a test has proven you wrong trains the team to discount everything you say. "You're right, fixed" the instant the evidence turns is a strength — it's what makes your *held* positions credible.

8. **Rewriting the PR in comments / scope creep.** Ghost-authoring the change in comments removes the author's agency and is often wrong (you lack their context). "Could you also…" expands scope without bound. Identify *what* should change; push *how* and *also* to the author and to follow-ups.

9. **Tolerating an uncalibrated team.** When reviewer A blocks on what reviewer B waves through, the team has a quality lottery, and authors game assignment. Push the bar into written rules and automated checks so "what blocks" is a team property, not a per-reviewer accident.

---

## Test Yourself

1. Reframe a review comment in terms of *state* and *cost*. Why does putting a type token (`nit:`, `blocking:`) in the first word matter so much in an async-text medium?
2. A reviewer marks all eight of their comments on a PR as blocking. Explain, in terms of signal, exactly what this destroys and why it makes the *important* comments worse off.
3. You and the author disagree on whether a change is O(n) or O(n²). What's the resolution path, and why is it categorically different from disagreeing on `composition vs inheritance`?
4. Give the full escalation path for a disagreement, with the two thresholds that trigger a medium change. What is the one outcome the path is designed to prevent?
5. Why is review the primary senior→junior mentoring channel, and what's the difference between a comment that closes *one* bug and one that closes a *category*?
6. Your teammate skips self-review and you can tell. Name three specific classes of problem self-review catches for free, and explain why self-review is the same habit as shipping faster.
7. A reviewer suggests a fix you think is suboptimal, but you suspect they're pointing at something real. What's the senior move, and what does it protect you from?
8. Your team has a "quality lottery" — PR outcomes depend on which reviewer they drew. Name two concrete mechanisms that convert this into a consistent bar.

<details>
<summary>Answers</summary>

1. A comment is a **request to change the state of the PR**, and its severity encodes the **cost of not acting**. The async-text medium strips tone, so the author would otherwise have to *infer* weight from punctuation and mood — making "why a map here?" a coin flip between idle curiosity and a blocking demand. The type token puts the decision-weight back in the text, so the author knows immediately whether a response is required and whether it gates merge. It's error-correction for a lossy channel.

2. It destroys the **dynamic range of the severity signal**. When every comment is blocking, "blocking" stops meaning anything — the author can't distinguish the one comment that catches a data-loss bug from the seven that are stylistic preferences. The noise floor is raised to the ceiling, so the author's rational response is to ignore severity and re-litigate everything, which is slower and worse *precisely for the cases that mattered*. Inflation spends a shared, finite resource.

3. The O(n) vs O(n²) dispute is a **disagreement on facts** — resolve it by producing an objective artifact: a benchmark or a profile that measures it. Either the data confirms one side (dispute over) or it doesn't. `composition vs inheritance` with no measurable difference is a **disagreement on values** — there's no artifact that decides it, so the resolution path is negotiation, the style guide, or deferring to the author (who is right by default on a reversible call). The categories differ because facts have a third-party decider and values don't.

4. **Try to resolve between yourselves → after 2–3 non-converging round-trips, go synchronous (and write the outcome back into the thread) → if still unresolved, escalate to a decider (tech lead / team / style guide) and abide by the call.** The two thresholds: the **round-trip limit** (2–3 replies with no convergence) and the **unresolvable values-disagreement on something irreversible**. The path is designed to prevent the **silent stalemate** — a PR rotting for days because neither party has a move.

5. Review is concrete (it's *their* exact code), frequent (every PR), and safe (caught before production) — the highest-bandwidth, highest-frequency teaching surface a team has. A comment that closes **one** bug says "change this to `io.Copy`." A comment that closes a **category** says "stream unbounded input, here's why, here's the general rule" — so the engineer doesn't re-make the mistake in the next file, and you never review that class again. The second grows a reviewer; the first just patches a line.

6. Self-review catches (any three): debug prints / commented-out code / stray files; scope creep (changes that don't belong to this PR's story); missing tests or happy-path-only tests; unannotated non-obvious decisions; a PR description that doesn't tell the story. It's the same habit as shipping faster because it moves defect-catching to the **cheapest point** — every problem caught in your own diff is a comment thread that never happens and a round-trip you don't pay. Quality and speed aren't traded off; they're the same self-review pass.

7. **Steel-man it** — respond to the strongest version of the comment, not the weakest reading. Ask "what would have to be true for this to be right?" Often the *suggested fix* is suboptimal but the *underlying concern* is real (e.g., they said `sync.Map` but the real issue is a data race a plain map would cause). Steel-manning protects you from arguing past a genuine bug because the reviewer phrased it imperfectly — the literal reading would have let you "win" the thread while shipping the race.

8. (any two) **Write the standard down** — a review guide / `CONTRIBUTING.md` that states what blocks (missing tests on changed logic blocks; lint-catchable style never blocks; different-but-fine structure is a suggestion). **Automate the floor** — push everything a tool can decide (formatting, lint, coverage) into CI so it's uniformly enforced, never a per-reviewer call. **Review the reviews** — read other reviewers' reviews to surface and coach calibration drift. Each converts an implicit per-reviewer judgment into a team/tooling property.

</details>

---

## Cheat Sheet

```
COMMENT = TYPED REQUEST TO CHANGE STATE  (label carries the weight tone can't)
  praise:     good — reinforce, no action          question:  need info, ~no weight
  nit:        cosmetic, never blocks               issue:     real, needs a response
  suggestion: alternative, author decides          blocking:  must-fix before merge

SEVERITY = A SIGNAL WITH FINITE RANGE  (honest assignment keeps it trustworthy)
  calibrated PR:  many nits/suggestions, few issues, RARE blocking
  failure mode:   "everything is blocking" → jams your own channel
  block only on:  correctness / real named risk / one-way door / missing test on changed logic
  downgrade:      taste / style / reversible structure → suggestion at most

RESOLVING DISAGREEMENT  (appeal to an artifact, not to your title)
  disagree on FACTS  → produce benchmark / spec / reproducing test → it decides
  disagree on VALUES → reversible? author is right by default. else hold + escalate
  holding firm = state the SPECIFIC failure mode, not "I don't like it"

ESCALATION PATH  (always terminates; prevents the silent stall)
  try to resolve → 2-3 round-trips, no converge → SYNC (write outcome back)
  → still stuck → tech lead / team / STYLE GUIDE → abide by it.  Escalate EARLY.

MENTORING VIA REVIEW  (the highest-bandwidth channel you have)
  teach the PRINCIPLE + why + link, not just the fix → closes a CATEGORY
  calibrate depth: junior → teaching comment;  staff peer → terse nit
  grow reviewers by reviewing their reviews

SELF-REVIEW  (first reviewer of every PR is the author — cheapest gate)
  read full diff as a HOSTILE reviewer  ·  kill debug/scope-creep/missing tests
  annotate intent  ·  description tells the story (what/why/considered/verify)

RECEIVING WELL
  separate ego from code  ·  steel-man the reviewer  ·  push back with evidence
  CONCEDE FAST when wrong → "you're right, fixed" is a strength, not weakness

REVIEWER RESTRAINT
  don't rewrite the PR in comments (it's the author's change)
  "could you also..." → FOLLOW-UP, not a blocker  ·  weigh each comment's cost
```

---

## Summary

- A review comment is a **typed request to change the state of the PR**, carrying an implicit cost-of-not-acting. The async-text medium strips tone, so the **type token** (`nit:` / `suggestion:` / `blocking:`) puts the decision-weight back in the text — Conventional Comments is error-correction for a lossy channel.
- **Severity is a finite-range signal.** Assigning it honestly — most things nits, very few blocking — is what keeps "blocking" a word the author trusts. The "everything is blocking" reviewer jams their own channel and loses the one comment that mattered.
- **Resolve disagreement on objective criteria.** Split facts (settle with a benchmark / spec / reproducing test — appeal to a third-party artifact, never your title) from values (defer to the author on anything reversible). State held positions as a *specific failure mode*.
- **The escalation path always terminates:** try to resolve → go synchronous after 2–3 round-trips → escalate to a decider or the style guide. It exists so no disagreement can hold a PR hostage; the silent multi-day stall is the real anti-pattern.
- **Review is the primary mentoring channel** — concrete, frequent, safe. Teach the *principle* (closing a category of bugs), calibrate depth to the author, and grow reviewers by reviewing their reviews.
- **Self-review** read adversarially is the cheapest quality gate and the single highest-leverage author habit — speed and quality are the same pass. **Receive well** by separating ego from code, steel-manning, and conceding fast when the evidence turns. **Restrain** the reviewer's impulse to rewrite the PR or scope-creep — identify *what* must change, not *how*, and push the rest to follow-ups. **Calibrate** the team so "what blocks" is a property of written rules and automation, not a per-reviewer lottery.

You now reason about feedback as a decision system with a measurable failure mode, not a stream of polite comments. The next layer — [professional.md](professional.md) — is about operating these disciplines across an organization: review SLAs, calibration at scale, and feedback culture as something you build and defend.

---

## Further Reading

- [Google's *Code Review Developer Guide*](https://google.github.io/eng-practices/review/) — especially [The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html) (author-is-right-by-default on reversible calls) and [Handling Pushback](https://google.github.io/eng-practices/review/reviewer/pushback.html) (resolving conflicts, the escalation path, when to defer vs hold firm).
- *Software Engineering at Google* — Chapter 9, "Code Review." The institutional view: why reviews exist, what they optimize for, and how a large org keeps them consistent.
- [Conventional Comments](https://conventionalcomments.org/) — the labeling convention (`praise`/`nit`/`suggestion`/`issue`/`question`/`blocking`) that puts type and weight in the first token.
- *Thanks for the Feedback* — Stone & Heen. The receiving side at depth: separating the feedback from the relationship, steel-manning, and updating without ego.
- [professional.md](professional.md) — operating these disciplines across a team and an organization: review SLAs, calibration at scale, and feedback culture.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/senior.md) — the substance your feedback is *about*; severity calibration starts from knowing what actually matters in a review.
- [06 — Review Tooling & Automation](../06-review-tooling-and-automation/senior.md) — threading, suggested-changes, and CI checks that carry the calibrated floor so comments are reserved for human judgment.
- [08 — Review Anti-patterns](../08-review-anti-patterns/senior.md) — the named failure modes: rewriting the PR in comments, scope creep, the war of attrition, blocking on taste.
- [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the deep interpersonal layer: psychological safety, tone, defensiveness, and the human texture of giving and taking criticism.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the systemic view of review latency, reviewer variance, and what calibration looks like as a measured team property.
