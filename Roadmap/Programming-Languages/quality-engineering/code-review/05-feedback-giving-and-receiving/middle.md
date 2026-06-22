# Giving & Receiving Feedback — Middle Level

> **Roadmap:** [Code Review](../README.md) → Giving & Receiving Feedback
> *The junior page taught you to be kind and specific. This page turns "be specific" into a protocol: a label that says whether a comment blocks, a test that separates a defect from a preference, and a self-review habit that catches half your own bugs before a reviewer ever opens the diff.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Severity as a Protocol: Conventional Comments](#core-concept-1--severity-as-a-protocol-conventional-comments)
5. [Core Concept 2 — Fact vs Preference Discipline](#core-concept-2--fact-vs-preference-discipline)
6. [Core Concept 3 — Actionable + Rationale: the Shape of a Useful Comment](#core-concept-3--actionable--rationale-the-shape-of-a-useful-comment)
7. [Core Concept 4 — The Cost of a Comment: Calibrate Volume](#core-concept-4--the-cost-of-a-comment-calibrate-volume)
8. [Core Concept 5 — Receiving: Self-Review First, Then Resolution](#core-concept-5--receiving-self-review-first-then-resolution)
9. [Core Concept 6 — The Author ↔ Reviewer Contract](#core-concept-6--the-author--reviewer-contract)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What system turns scattered review comments into clear, low-friction, teaching feedback — in both directions?**

At the junior level, good feedback is a matter of attitude: be specific, be kind, comment on the code not the person. That advice is correct, but it leaves the hardest questions unanswered. When you've left a comment, the author still has to *guess* whether it's a must-fix or a passing thought. When you disagree about naming, neither of you has a rule for who wins. And when a reviewer pastes thirty comments, nobody has told them that thirty comments has a *price*.

This page formalizes the feedback **system** — the conventions, tests, and habits that mature teams use so review is fast, unambiguous, and educational instead of slow, vague, and adversarial. Four pieces do most of the work: a **severity protocol** (Conventional Comments) so every comment declares its weight; a **fact-vs-preference test** so taste never blocks a merge; an **actionable-plus-rationale** shape so each comment teaches; and **self-review** so the author catches the obvious before anyone else has to.

> **Key insight:** This topic owns the *mechanics* of feedback — labels, tests, resolution rules, the contract. The *human* side — tone, empathy, mentorship, defusing a heated thread, cross-cultural nuance — lives in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/). Mechanics make the human side easier, but they do not replace it. When a thread gets warm, you are out of this page's territory and into that one's.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can write a specific, code-focused comment.
- **Required:** You've authored and reviewed at least a handful of real pull requests.
- **Helpful:** You've felt the frustration of a vague comment ("this is weird") and not known how to act on it.
- **Helpful:** You've sat in a review that stalled over a naming argument and wished there were a rule.

---

## Glossary

| Term | Meaning |
|---|---|
| **Conventional Comments** | A lightweight convention that prefixes each comment with a *label* (`nit:`, `suggestion:`, `issue:`…) and optional *decoration* (`(non-blocking)`) so its weight is explicit. |
| **Blocking** | A comment that must be resolved before merge. A correctness defect, a security hole, a broken contract. |
| **Non-blocking** | A comment the author may address now, later, or never (with reason). Most `nit:` and many `suggestion:` items. |
| **Fact** | An objective, demonstrable property of the code: it's wrong, it leaks, it races, it violates a documented standard. |
| **Preference** | A subjective, defensible-either-way choice: naming flavor, file layout, which equally-valid idiom to use. |
| **Self-review** | Reading your *own* diff as a reviewer would, before requesting review — annotating, catching the obvious, explaining the non-obvious. |
| **Resolution** | The act of closing a comment thread: done, won't-do-because, or let's-discuss. |
| **Code suggestion** | A reviewer-proposed exact replacement the author can apply with one click (GitHub/GitLab "suggestion" blocks). |
| **Drip-feed** | Submitting comments one at a time, each firing a notification, instead of batching them into one review. |

---

## Core Concept 1 — Severity as a Protocol: Conventional Comments

The single most common failure in review feedback is **ambiguous weight**. A reviewer writes "could rename this to `userCount`." Is that an order or an idea? The author can't tell, so they either over-comply (treating musings as mandates, slowing the PR) or under-comply (ignoring a real concern they read as optional). Either way, a second round-trip is wasted clarifying *intent that the comment should have carried in the first place*.

**Conventional Comments** fix this by making weight part of the message. Each comment starts with a **label**, and may carry a **decoration** in parentheses:

```text
<label> [decoration]: <subject>

<optional discussion / rationale>
```

The standard labels:

| Label | Means | Default weight |
|---|---|---|
| `praise:` | Genuine appreciation of something done well. | Non-blocking (no action) |
| `nit:` | A trivial, take-it-or-leave-it preference. | Non-blocking |
| `suggestion:` | A concrete proposed change; explain *why*. | Author's call unless decorated |
| `question:` | You don't understand something; you may be missing context. | Non-blocking until answered |
| `thought:` | An idea that occurred to you; not necessarily for this PR. | Non-blocking |
| `issue:` / `blocking:` | A problem that should be fixed. | **Blocking** |
| `chore:` | A required process step (changelog, ticket link, version bump). | Usually blocking |

And the decorations that override or sharpen the default:

```text
suggestion (non-blocking): rename `d` to `elapsed` — `d` reads as "data" at the call site.
issue (blocking): this query runs inside the loop — N queries for N rows. Hoist it.
suggestion (if-minor): could fold these two guards into one. Skip if you disagree.
```

Why this is worth the discipline:

- **It removes the "must-fix or musing?" guess.** The label *is* the answer. `nit:` says "I'd do it differently; your call." `issue (blocking):` says "this won't merge until it's addressed." No round-trip to disambiguate.
- **It reduces conflict.** A bare "rename this" reads as a command and invites a defensive reply. `nit: I'd lean toward \`elapsed\`` reads as a preference and invites a shrug or a quick fix. The label lowers the emotional temperature *for free*.
- **It makes review skimmable.** An author scanning ten comments can triage instantly: handle the two `issue:`s, glance at the `suggestion:`s, enjoy the `praise:`, and dispatch the `nit:`s in seconds.

> **Key insight:** A label is a *commitment device*. By forcing yourself to type `nit:` you are forced to admit, to yourself, that the comment is trivial — which is exactly the moment you might decide it isn't worth leaving at all. The protocol improves your comments before anyone reads them.

Adoption is a team decision, not a personal one. The convention only pays off when the *whole team* reads `nit:` the same way; one person's private labels are noise. Agree on the label set, write it in the contributing guide, and let the meaning of "blocking" be a shared, enforced contract (often wired into the merge gate — see [06 — Review Tooling & Automation](../06-review-tooling-and-automation/middle.md)).

---

## Core Concept 2 — Fact vs Preference Discipline

The protocol tells you how to *label* weight. This concept tells you how to *decide* it. The fault line under almost every stalled review is the failure to separate two fundamentally different kinds of comment:

- **Facts** — objective properties. The code is wrong; it leaks a connection; it races; it has an off-by-one; it violates a *documented* team standard. Facts are demonstrable. You can point at the bug, write the failing test, cite the rule. Facts **block**.
- **Preferences** — subjective, defensible-either-way choices. `for` vs `map`, `userCount` vs `numUsers`, where a helper lives, which of two equally-idiomatic forms to use. Preferences are taste. You cannot prove them. Preferences **do not block**.

The discipline is to ask, before you make any comment blocking, a single question:

> **The test:** *Would I reject the entire codebase if every file looked like this?* If no — it's a preference. Downgrade it to `nit:`/`suggestion:` and let the author decide.

If you would only reject *this* line because it differs from how *you* would have written it, you are blocking on personal preference — one of the most corrosive review anti-patterns there is (it's catalogued in [08 — Review Anti-patterns](../08-review-anti-patterns/middle.md) as *the reviewer rewrites the PR in their own style*). It slows merges, breeds resentment, and teaches authors that review is about pleasing the reviewer rather than improving the code.

Three rules fall out of the fact/preference split:

1. **Defects block; taste defers.** When you find a genuine defect, label it `issue:` and hold the line. When you find a taste difference, label it `nit:` and let go of the outcome.
2. **Style belongs to the linter, not to you.** If a style point is worth enforcing, encode it in a formatter or linter so the *machine* enforces it uniformly and silently. A human re-arguing brace placement in every PR is waste; configure `prettier`/`gofmt`/`ruff` once and stop commenting on style forever ([Static Analysis & Linting](../../static-analysis/) covers this). A style comment that *isn't* in the linter is, by definition, your personal preference.
3. **When it's genuinely a toss-up, the author wins.** They wrote it, they'll maintain it, and the cost of a forced rewrite exceeds the value of your preferred flavor. "I might have done X, but yours is fine" is a complete and professional review outcome.

> **Key insight:** The goal of review is not a PR you would have written. It's a *correct, maintainable* PR the author wrote. Conflating "different from my taste" with "wrong" is the root of most review friction; the fact/preference test is the cure, and the linter is how you make it stick.

---

## Core Concept 3 — Actionable + Rationale: the Shape of a Useful Comment

A well-formed review comment does three things: it is **specific** (points at one thing), it carries its **rationale** (the *why*, so the author learns), and it offers a **path forward** (so the author isn't left to invent the fix). Vague, why-less, or dead-end comments fail the author and waste a round-trip.

Watch the same concern improve across rewrites:

```text
✗  "this is confusing"
      → specific? no. why? no. path? no. The author can only reply "...how?"

~  "this function is too long"
      → specific-ish, but no why and no path. Invites disagreement, not action.

✓  suggestion: extract the validation block (lines 20–48) into `validateOrder`.
   Right now this function does three jobs — parse, validate, persist — so a
   reader has to hold all three in their head, and the validation can't be
   unit-tested in isolation. Pulling it out names the step and makes it testable.
```

The third version teaches a *transferable rule* (one function, one job; extract to enable testing) rather than issuing a one-off correction. That is the difference between review that grows an engineer and review that merely patches a diff.

**Carry the rationale, every time.** "Why" is what makes a comment a lesson instead of an order. "Rename `d` to `elapsed`" is an order. "Rename `d` to `elapsed` — single-letter names force the reader to scan back to the declaration to recover meaning" is a principle the author will apply to the *next* variable too, without you.

**Don't re-explain what's already written down.** If your standard, your style guide, or a canonical doc already covers the point, *link it* instead of retyping it. This is faster for you, authoritative for the author (it's the team's rule, not your opinion), and it scales — the doc improves once and every future comment inherits it.

```text
suggestion: wrap this external call in our retry helper —
see the resilience guide: docs/standards/retries.md#transient-failures
```

**Use code suggestions for trivial, exact fixes.** Most platforms let you propose an exact replacement the author applies with one click. For a typo, a missed `await`, a renamed variable — don't make the author re-type your fix; *hand* it to them.

```text
nit: typo in the message.

```suggestion
    return errors.New("connection timed out")
```​
```

> **Key insight:** Every comment should leave the author *able to act without asking a follow-up question*. If your comment would force the reply "...okay, but what do you want me to do?", it isn't finished. Specific + why + path forward is the shape of a comment that resolves in one round-trip instead of three.

**Ask, don't tell — when you might be wrong.** When you lack context, a Socratic `question:` is safer and more respectful than an assertion: "Is there a reason the lock is held across the network call? I'd expect that to serialize requests." If you're *right*, the author fixes it and saves face; if you're *missing context*, they teach you, and you've avoided a confidently-wrong demand. **But don't perform uncertainty you don't have.** A clear, unambiguous bug deserves a clear statement: "`issue (blocking): this dereferences \`user\` before the nil check on line 12 — it will panic on a missing user.`" Phrasing a definite defect as a coy "did you mean to…?" wastes a round-trip and can read as passive-aggressive. Match directness to your confidence.

---

## Core Concept 4 — The Cost of a Comment: Calibrate Volume

Junior reviewers tend to believe more comments equal more value. The opposite is often true. **Every comment has a cost**: it's author time to read, evaluate, and respond to; it can derail the PR into a side-quest; and in bulk it buries the two comments that actually matter under twenty that don't. A review with three sharp comments can be more valuable than one with thirty scattered ones.

Calibrating volume is a skill:

- **Don't pile on.** If a previous reviewer already flagged the nil check, you don't need to flag it again with a +1. One reviewer's nits suffice; a chorus of agreement adds noise, not signal. Read existing comments before adding yours.
- **Let the linter carry the trivia.** Anything a formatter or linter can catch should *never* be a human comment. If you find yourself typing a style nit, ask whether it belongs in the lint config instead (Concept 2, rule 2).
- **Distinguish "this PR" from "the codebase."** If a `nit:` applies to fifty existing files, it's not feedback on *this* PR — it's a separate cleanup ticket. Don't ambush an unrelated change with the accumulated debt of the whole module.
- **Cap the nit budget.** When a PR is structurally sound, two or three `nit:`s communicate "I read it carefully and it's basically good." Twenty `nit:`s communicate "I will block on my taste," even when each is individually labeled non-blocking — the *volume* reads as obstruction.

**Batch, don't drip-feed.** Most platforms distinguish single-comment mode (each comment posts and *notifies the author instantly*) from review mode (you stage all comments and *submit once*). Always use review mode. Drip-feeding interrupts the author repeatedly, often *while they're mid-fix on an earlier comment of yours*, and produces the disorienting experience of feedback arriving in real time over an hour. Stage everything, then submit one coherent review with a summary line.

```text
✗  Drip-feed:  [9:02] comment   [9:05] comment   [9:08] comment  → 3 pings, 3 interruptions
✓  Batched:    [9:10] "Reviewed — 1 blocking issue (the N+1 on line 40),
                       rest are nits. Looks good once that's fixed."  → 1 ping, full context
```

**Don't forget `praise:`.** Reinforcing good patterns is real, high-leverage feedback, and almost everyone under-does it. A `praise:` on a clean abstraction or a well-named test tells the author *and the next reader of the thread* what "good" looks like on this team. It also rebalances a review so it isn't a pure list of faults — which makes the blocking comments land better. Praise is not flattery; it's positive reinforcement of patterns you want to see again.

> **Key insight:** A review is a budget, not a checklist. You are spending the author's attention, and attention is finite. Spend it on the few comments that change correctness or design; tax it lightly with nits; and never spend it on something a machine could have caught for free.

---

## Core Concept 5 — Receiving: Self-Review First, Then Resolution

Half of "feedback" is receiving it well — and the highest-ROI habit on this entire page belongs to the *author*, before a reviewer is even involved.

### Self-review first

**Read your own diff as a reviewer would, before you request review.** Open the PR's "Files changed" view and go through it line by line as if someone else wrote it. This single habit catches a startling fraction of what reviewers would otherwise catch — the leftover `console.log`, the commented-out block, the function you meant to delete, the test you forgot to write — and it does so *in seconds* instead of *in a round-trip that costs hours of latency*.

Self-review has two distinct moves:

1. **Catch the obvious.** Debug prints, dead code, typos, an accidental file, a TODO you meant to resolve. These are pure waste if a reviewer has to flag them; *you* can delete them in the time it takes them to type "leftover log?".
2. **Explain the non-obvious.** Where you made a non-obvious choice, *annotate your own diff* with a comment before the reviewer asks. This pre-empts questions, shows your reasoning, and directs the reviewer's attention to where it's actually needed.

```text
[author's own comment on their diff, line 88]
  Self-review: using a goroutine pool here rather than one-per-request because
  the upstream API rate-limits at 10 concurrent — unbounded fan-out got us 429s
  in staging. Pool size matches the documented limit.
```

That annotation turns a likely `question: why a pool here?` (a full round-trip) into zero round-trips. The author who self-reviews ships faster *and* looks more competent — because they've done the reviewer's first pass for them.

> **Key insight:** The cheapest place to catch a problem is in your own diff, before you press "request review." Every issue you find in self-review is a round-trip you didn't pay for. Treat self-review as non-optional; it is the single most effective thing an author can do to make review fast.

### Resolution: respond to every thread

A review is a conversation, and a conversation where one side goes silent is broken. **Respond to every thread.** Each comment gets one of three responses:

| Response | When | Example |
|---|---|---|
| **Done** | You agreed and changed it. | "Done — extracted to `validateOrder`." |
| **Won't-do, because…** | You disagree or it's out of scope, *with a reason*. | "Leaving as-is — that path is dead-code we're removing in #4412, so reworking it now is wasted." |
| **Let's discuss** | It needs back-and-forth or is genuinely unresolved. | "Not sure I follow the race concern — the map's only written in `init`. Can we look together?" |

The cardinal sin is the **silent dismissal**: pushing a new commit that ignores a comment without a word. The reviewer can't tell whether you missed it, disagreed, or forgot — so they have to re-check, and trust erodes. Even "won't-do" is a *complete and respectful* answer; silence is not.

**Resolve vs leave open.** Resolving a thread means "this is settled." A common, healthy convention: the *author* resolves threads where they made the change (the fix speaks for itself), and leaves *reviewer-raised concerns* open for the *reviewer* to resolve once satisfied — so no one's worry is closed out from under them. Whatever your team's rule, make it explicit and consistent.

### Pushing back — and when not to

Disagreeing with a reviewer is legitimate and often correct; reviewers are not infallible. **Push back with rationale, not with volume.** "I considered that, but X" advances the discussion. "No." does not. Bring data, a benchmark, a link to the standard, or a concrete scenario the reviewer may not have considered.

Two boundaries keep pushback healthy:

- **Don't relitigate settled points.** If the team decided last month that this module uses repositories, re-arguing it in your PR is out of scope; raise it in the appropriate forum, not in line comments on unrelated code.
- **Know when to go synchronous.** When a thread exceeds ~3 back-and-forths, or the temperature is rising, *stop typing*. A two-minute call or huddle resolves what twenty asynchronous comments won't, and it strips out the tone-ambiguity that text breeds. Reach the decision live, then **post the outcome back on the thread** so the resolution is on the record. (Choosing async vs synchronous deliberately is covered in [06 — Review Tooling & Automation](../06-review-tooling-and-automation/middle.md).)

---

## Core Concept 6 — The Author ↔ Reviewer Contract

Everything above rests on a two-sided contract that Google's engineering practices state plainly, and that mature teams internalize:

- **The reviewer's attention is on the author's growth and the code's health — not on demonstrating the reviewer's own cleverness.** A reviewer's job is to help this change become correct and maintainable, and to help this engineer get better. It is *not* to win, to gatekeep, or to rewrite the PR in their own image.
- **The author's job is to make the PR reviewable.** Small, focused, well-described, self-reviewed, with the non-obvious explained. An author who dumps a 2,000-line unexplained diff has broken their half of the contract before the reviewer types a word ([02 — PR Scope & Size](../02-pr-scope-and-size/middle.md) is the discipline that upholds this half).

When both sides hold up their end, review is fast and friendly. When either side defects — a reviewer who blocks on taste, an author who ships an unreviewable wall and goes silent on threads — the system degrades into the friction that gives code review its bad reputation.

> **Key insight:** Code review is a collaboration with a shared goal — ship correct, maintainable code and grow the people doing it — not a contest with a winner. Read your reviewer as an ally pointing at problems, and write your reviews as an ally too. The mechanics on this page are the *grammar* of that collaboration; the relationship itself is built in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/).

---

## Real-World Examples

**1. The "is this blocking?" round-trip, eliminated.** A reviewer leaves "maybe split this function?" The author, unsure, splits it, force-pushes, re-requests review — only to hear "oh, that was just a thought, didn't need to do it now." Two days of latency burned on ambiguity. With Conventional Comments the original reads `thought: this function's getting long — might be worth splitting in a follow-up` and the author moves on in five seconds. The label *was* the missing information.

**2. The naming war that the linter should have ended.** A team kept relitigating `camelCase` vs `snake_case` for JSON keys in every PR touching the API layer — sometimes three comment threads on a single change. The fix wasn't a better-worded comment; it was a `ruff`/`eslint` rule plus a serializer config that *enforced* the convention, after which the topic vanished from human review entirely. Style that's worth enforcing belongs to the machine; style that isn't worth a lint rule wasn't worth a comment.

**3. The self-review that saved the reviewer's afternoon.** An author, before requesting review on a 250-line change, did a Files-changed pass and found: a `fmt.Println` debug line, a stale commented-out implementation, and a function whose concurrency choice would obviously raise a question. They deleted the first two and *annotated* the third ("pool sized to the upstream rate limit — see staging 429s"). The reviewer approved in one pass with one `praise:` and zero questions. The author's five minutes of self-review saved a full asynchronous round-trip.

**4. The thread that should have been a call.** A disagreement about cache-invalidation correctness ran to fourteen comments across two days, each side re-explaining in slightly different words, tone fraying. A senior finally wrote `let's huddle — I think we're talking past each other` and the two resolved it in a six-minute call, then posted the agreed approach back on the thread. The lesson: past ~3 exchanges, text is the wrong medium; go synchronous and record the outcome.

---

## Mental Models

- **A label is the comment's price tag.** `nit:` is marked-down — take it or leave it. `issue (blocking):` is full price — you're paying before you leave the store (merge). Shoppers (authors) triage instantly when everything's priced; an unpriced shelf forces them to ask a clerk about every item.

- **The fact/preference line is the line between the linter and the conversation.** Below it (taste) lives everything a machine should enforce or an author should decide; above it (defects, standards) lives everything worth a human's blocking comment. Keep the conversation above the line.

- **Self-review is the reviewer's first pass, run by the author for free.** Whatever you catch in your own diff, the reviewer doesn't have to — and every catch is a round-trip of latency you delete before it exists.

- **Review is a budget, not a checklist.** You're spending a fixed pool of the author's attention. Blow it on twenty nits and you have nothing left for the one comment that prevents an outage. Spend top-down: correctness first, design next, taste last (and lightly).

- **A silent commit is a dropped call.** Pushing a fix without replying to the thread is hanging up mid-sentence. "Done" or "won't-do, because…" keeps the line open; silence makes the reviewer redial.

---

## Common Mistakes

1. **Leaving comments without declaring weight.** "Rename this" with no label forces the author to guess must-fix vs musing — a guaranteed round-trip. Prefix every comment with its weight (`nit:`/`suggestion:`/`issue:`).

2. **Blocking on personal preference.** Refusing to approve because you'd have used `map` instead of a loop. Apply the test — *would I reject the whole codebase if it looked like this?* If no, it's a `nit:`, not a block.

3. **Re-arguing style a linter could enforce.** Every brace-placement or import-order comment is wasted human effort. Put it in the formatter once; never comment on it again.

4. **Comments with no "why."** "Don't do this" teaches nothing and invites a standoff. The rationale is the part that makes the author better and resolves the thread in one round.

5. **Drip-feeding comments.** Posting one at a time pings the author repeatedly, often mid-fix. Stage all comments and submit one review with a summary.

6. **Piling on.** Adding a +1 to a problem another reviewer already flagged. One reviewer's nits suffice; redundant agreement is noise.

7. **Skipping self-review.** Requesting review with debug logs, dead code, and unexplained choices still in the diff. Read your own diff first — it's the cheapest place to catch anything.

8. **Silent dismissal of a thread.** Pushing a commit that ignores a comment without a word. Even "won't-do, because X" is a complete answer; silence erodes trust.

9. **Relitigating settled decisions in line comments.** Re-arguing an architectural call the team already made, on an unrelated PR. Take it to the right forum; keep the PR's threads on the PR.

10. **Treating tone problems as mechanics problems.** No label fixes a comment that's condescending. Tone, empathy, and heated-disagreement repair live in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/), not here.

---

## Test Yourself

1. A reviewer writes "could rename this." What information is missing, and which convention supplies it?
2. State the one-line test for whether a comment should block, and what you do with the comment when the answer is "no."
3. Name the three things a well-formed review comment should contain. Which one most directly grows the author?
4. Why is drip-feeding comments worse than batching them, beyond simple tidiness?
5. What are the three valid responses to a review thread, and which response is *never* acceptable?
6. Why is self-review described as "the highest-ROI habit" on this page? Frame your answer in terms of round-trips.
7. A reviewer's comment thread is at fourteen replies and the tone is fraying. What should happen, and what must happen *afterward*?
8. A style point matters to you. Where should it live if it's worth enforcing — and what does it mean about the point if it *isn't* worth putting there?

<details>
<summary>Answers</summary>

1. The comment's **weight** — is it a must-fix or a musing? **Conventional Comments** supply it via a label: `nit: could rename this` (take it or leave it) vs `issue (blocking): rename this` (must fix before merge).
2. *Would I reject the entire codebase if every file looked like this?* If **no**, it's a preference — downgrade it to a `nit:`/`suggestion:` and let the author decide (or push it into the linter). Only facts/defects/documented-standard violations block.
3. **Specific** (points at one thing), **rationale** (the *why*), and a **path forward** (a concrete fix, ideally a code suggestion). The **rationale** grows the author most — it teaches a transferable rule, not a one-off correction.
4. Each drip-fed comment fires a **notification** that interrupts the author *in real time*, often while they're mid-fix on an earlier comment, and delivers feedback without coherent context. Batching produces **one interruption** and one complete, prioritized picture.
5. **Done**, **won't-do because…**, and **let's discuss**. **Silent dismissal** — pushing a commit that ignores the comment with no reply — is never acceptable; the reviewer can't tell if you missed it, disagreed, or forgot.
6. Because the author's own diff is the **cheapest place** to catch a problem: every issue found in self-review is a **round-trip** (request → review → fix → re-review, each step costing hours of latency) that you delete *before it ever happens*.
7. **Go synchronous** — a short call or huddle strips the tone-ambiguity that text breeds and resolves it in minutes. Afterward, **post the agreed outcome back on the thread** so the decision is on the record.
8. It belongs in the **linter/formatter**, so the machine enforces it uniformly and no human ever comments on it again. If it isn't worth a lint rule, then by definition it's your **personal preference** — a `nit:` at most, never a blocker.

</details>

---

## Cheat Sheet

```text
CONVENTIONAL COMMENTS  — <label> [decoration]: <subject>
  praise:        genuine appreciation                    (non-blocking)
  nit:           trivial, take-it-or-leave-it            (non-blocking)
  suggestion:    concrete proposed change + why          (author's call)
  question:      you may be missing context              (non-blocking)
  thought:       idea, maybe a follow-up                 (non-blocking)
  issue:/blocking: real problem, must fix                (BLOCKING)
  chore:         required process step (changelog, link) (usually blocking)
  decorations:   (blocking) (non-blocking) (if-minor)

FACT vs PREFERENCE
  fact  = wrong / leaks / races / violates documented standard  → BLOCK
  pref  = naming / layout / equally-valid idiom                  → nit, author decides
  TEST  = "would I reject the whole codebase if it looked like this?"
  style worth enforcing → the LINTER, never a human comment

A GOOD COMMENT  = specific + rationale (the WHY) + path forward
  link the standard instead of re-explaining it
  trivial exact fix → a one-click code suggestion
  match directness to confidence: clear bug → state it; unsure → ask

VOLUME
  don't pile on (one reviewer's nits suffice)
  let the linter carry the trivia
  BATCH (review-then-submit), never drip-feed notifications
  remember praise: — reinforce the patterns you want repeated

RECEIVING
  SELF-REVIEW FIRST  → catch the obvious, annotate the non-obvious  (highest ROI)
  respond to EVERY thread: done / won't-do-because / let's-discuss
  silent dismissal = the cardinal sin
  push back with rationale; don't relitigate settled points
  >3 exchanges or rising heat → go synchronous, then post the outcome

CONTRACT
  reviewer → author's growth + code health (not own cleverness)
  author   → make the PR reviewable (small, described, self-reviewed)

WHERE THE LINE IS
  this page = MECHANICS.  tone / empathy / heated disagreement = Soft-Skills/code-review
```

---

## Summary

- **Severity is a protocol.** Conventional Comments (`nit:`, `suggestion:`, `question:`, `issue:`/`blocking:`, `praise:`, `thought:`, `chore:` + `(blocking)`/`(non-blocking)` decorations) make every comment declare its weight, killing the "must-fix or musing?" round-trip and lowering conflict for free. Adopt it team-wide or not at all.
- **Fact beats preference.** Defects, correctness, and documented-standard violations block; taste defers to the author or the linter. The test — *would I reject the whole codebase if it looked like this?* — separates the two, and blocking on personal preference is a named anti-pattern.
- **A useful comment is specific + rationale + path forward.** The *why* is what teaches; link standards instead of re-explaining; hand over trivial fixes as one-click code suggestions; ask when unsure, state plainly when it's a clear bug.
- **A comment has a cost.** Calibrate volume, don't pile on, let the linter carry the trivia, and batch your comments into one review instead of drip-feeding notifications. Don't skip `praise:` — reinforcing good patterns is real feedback.
- **Receiving well starts with self-review** — the highest-ROI habit, run by the author before any reviewer arrives, deleting round-trips before they exist. Then respond to *every* thread (done / won't-do-because / let's-discuss); silent dismissal is the cardinal sin. Push back with rationale, don't relitigate settled points, and go synchronous when text stalls.
- **It rests on a two-sided contract:** the reviewer serves the author's growth and the code's health; the author makes the PR reviewable. This page owns the *mechanics*; tone, empathy, and heated-disagreement repair live in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/).

---

## Further Reading

- **Conventional Comments** (`conventionalcomments.org`) — the label-and-decoration spec this page builds on; one page, worth bookmarking for the team's contributing guide.
- **Google Engineering Practices — "How to write code review comments"** — the canonical treatment of courtesy, the *why*, and balancing directness with kindness.
- **Google Engineering Practices — "Handling pushback in code reviews"** — what to do when the author disagrees; the source of the reviewer/author contract framing.
- **Chromium / LLVM / Go review guidelines** — large-project, battle-tested house rules for comment etiquette, nits, and resolution; read one to see the conventions in production.
- **Conventional Comments in practice (GitHub/GitLab suggestion blocks docs)** — how to wire one-click code suggestions and review-then-submit batching in your tooling.
- [senior.md](senior.md) — review at scale: setting team-wide feedback norms, the cultural side of resolution SLAs, and feedback as a leadership and mentorship instrument.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/middle.md) — *what* to comment on and in which priority; this page is *how* to phrase and weight it.
- [06 — Review Tooling & Automation](../06-review-tooling-and-automation/middle.md) — batching, code suggestions, blocking gates, and choosing async vs synchronous deliberately.
- [08 — Review Anti-patterns](../08-review-anti-patterns/middle.md) — the failure modes (blocking on taste, drip-feeding, silent dismissal, nit-storms) this protocol prevents.
- [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the human half: tone, empathy, mentorship, and navigating heated disagreement across cultures.
- [Static Analysis & Linting](../../static-analysis/) — moving style and trivia off humans and onto the machine, so review stays about facts.
