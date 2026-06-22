# What to Look For & In What Order — Professional Level

> **Roadmap:** [Code Review](../README.md) → What to Look For & In What Order
> *The senior page taught you the order to read a diff. This page is about installing that order in fifteen other people's heads — where "what do you look for first?" stops being a personal habit and becomes a team artifact, a calibration session, and the thing that quietly collapses into LGTM the week everyone is overloaded.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Codifying the Order Into Artifacts](#core-concept-1--codifying-the-order-into-artifacts)
5. [Core Concept 2 — Calibration: The Consistency Problem](#core-concept-2--calibration-the-consistency-problem)
6. [Core Concept 3 — Moving Design Review Left](#core-concept-3--moving-design-review-left)
7. [Core Concept 4 — Teaching the Order to Juniors](#core-concept-4--teaching-the-order-to-juniors)
8. [Core Concept 5 — Protecting the Order From Volume](#core-concept-5--protecting-the-order-from-volume)
9. [Core Concept 6 — The Author-Growth Lens](#core-concept-6--the-author-growth-lens)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Raising the review bar across a team or org — turning a personal review order into shared artifacts, calibrating reviewers so the bar is the same regardless of who picks up the PR, and defending that bar under volume.**

The senior page framed the review order as something *you* do well: correctness before design, design before tests, tests before style, security and data-handling threaded throughout, naming and nits last. At the professional level the problem inverts. You are no longer the bottleneck of quality — the *team's distribution of bars* is. An author opens a PR and the review they get is a lottery: reviewer A blocks on a missing test, reviewer B waves it through, reviewer C rewrites the architecture in comments, reviewer D leaves four nits and an LGTM. Same diff, four different bars. The author learns nothing consistent, trusts the process less, and starts shopping for the lenient reviewer.

The staff/principal job is to make that lottery deterministic. That means three moves, and they map to the next three concepts: **codify** the order into artifacts a new hire can read on day one; **calibrate** the humans so they apply that order the same way; and **time the expensive feedback** — move "wrong approach" upstream of the PR entirely, because no review order can rescue a three-week branch built on the wrong design.

None of this is a new *skill*. It's the senior-level review order, multiplied by a team, a tenure spread from intern to principal, and a queue that grows faster than attention. The hard part is that the order is fragile: it is the *first* casualty of overload, the *first* thing a junior gets wrong, and the *easiest* thing to let drift into style-policing or rubber-stamping. This page is about making it durable.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the review order itself (correctness → design → tests → security/data → readability → nits), severity triage, blocking vs non-blocking.
- **Required:** You have reviewed enough code to have a personal order you trust, and have felt the pain of an inconsistent one applied to your own PRs.
- **Helpful:** You influence how a team works — you can propose a checklist, run a meeting, or change a PR template.
- **Helpful:** You have onboarded someone and watched them review code for the first time.

---

## Glossary

- **Review charter** — a short, team-owned document stating what reviews block on, what they merely comment on, and the severity vocabulary everyone uses. The contract behind the order.
- **Calibration session** — a recurring meeting where reviewers review the *same* real diff independently, then compare, to converge their bars.
- **Bar** — the implicit threshold a reviewer applies before approving. "Drift" is when ten reviewers hold ten different bars.
- **Severity label** — an explicit tag on a comment (`blocking`, `should-fix`, `nit`, `question`) that separates "merge-blocker" from "preference."
- **Shift left** — moving feedback earlier in the lifecycle (design doc, draft PR) where changing direction is cheap, instead of in a finished PR where it is expensive.
- **Design doc / RFC** — a written proposal reviewed *before* implementation; the upstream place to catch "wrong approach."
- **Rubber-stamping** — approving without genuinely applying the order; LGTM as reflex. The failure mode of overload.
- **Style-policing** — reviews dominated by formatting/preference nits that a linter should own; the failure mode of an absent tooling baseline.
- **Architecture-by-PR-comment** — relitigating system design in review threads on a finished branch; the symptom of skipped upstream design review.
- **Pull-and-run** — checking out the branch locally to inspect behavior the diff can't show (migrations, generated files, cross-file effects).

---

## Core Concept 1 — Codifying the Order Into Artifacts

A review order that lives only in your head dies with your attention. The first staff-level move is to externalize it into artifacts that a new hire can absorb without you in the room. Google's [Code Review Developer Guide](https://google.github.io/eng-practices/review/) is the canonical example: a public, opinionated document that says *what reviewers look for* and *in what spirit*, so 30,000 engineers review with a recognizably shared philosophy. You do not need Google's scale to need Google's idea.

Three artifacts carry the order:

**1. A review guide / checklist.** Not a 60-item bureaucratic gate — a short, ordered prompt that encodes the *sequence* and the *blocking line*. The order is the point: it tells a reviewer where to spend the first five minutes.

```markdown
## Review Order (read in this sequence; stop and ask if blocked at any step)
1. Correctness   — does it do what the PR says? edge cases, error paths, concurrency?      [BLOCK]
2. Design        — right approach, right layer, fits existing patterns? (caught here = cheap) [BLOCK]
3. Security/data — authz, input validation, PII handling, migrations, secrets?              [BLOCK]
4. Tests         — do they exist, do they test behavior, would they catch a regression?     [BLOCK]
5. Readability   — will the next person understand this in 6 months?                         [should-fix]
6. Naming/nits   — names, formatting, comments. Prefix `nit:`. Never blocks alone.           [nit]
```

**2. A PR template that front-loads context.** Half of inconsistent review is reviewers *guessing* at intent. A template that forces the author to state the *what*, the *why*, and the *how-to-verify* moves the reviewer straight to judgment instead of archaeology.

```markdown
## What & Why
<!-- One paragraph. What does this change and why now? Link the issue/design doc. -->

## How to verify
<!-- Steps to exercise this. **Migrations / generated files / data changes here.** -->

## Reviewer notes
<!-- Where you want eyes. Known tradeoffs. "Skip the generated proto file." -->
```

**3. A team review charter.** The contract: *what we block on, what we don't, and the words we use.* This is the artifact that kills the most arguments, because it pre-decides them. A real charter is blunt:

> **We block on:** correctness bugs, security/data issues, missing tests for new behavior, designs that paint us into a corner.
> **We do not block on:** style a linter could catch, personal-preference refactors, "I would have done it differently," scope you wish were bigger.
> **Severity vocabulary:** `blocking` (must fix to merge) · `should-fix` (fix or file a follow-up) · `nit:` (optional) · `question:` (not a request for change).

> **The principle:** the order is only shared if it is *written down and labeled*. Severity labels are the highest-leverage single artifact — once every comment is tagged `blocking` / `should-fix` / `nit:` / `question:`, the author instantly knows the difference between "this ships when fixed" and "ignore if you disagree," and reviewers stop accidentally blocking on preference. The label does the calibration the prose can't.

---

## Core Concept 2 — Calibration: The Consistency Problem

Artifacts get you a *shared vocabulary*. They do not get you a *shared bar*. Two reviewers can both believe in "block on correctness, nit on style" and still diverge wildly on what counts as a correctness risk worth blocking. The checklist is necessary and insufficient; the gap is closed by **calibration** — the same mechanism mature orgs use for performance ratings and incident severities, applied to review.

The mechanism is a recurring **calibration session**: pick one real, non-trivial diff; have 3–5 reviewers review it *independently and silently*; then compare. The reveal is always the same and always uncomfortable — reviewer A blocked on three things reviewer B never noticed, and reviewer B blocked on one thing reviewer A considered a nit. The discussion that follows ("would we *block* this, or just comment?") is the actual product. You are not training people to find more issues; you are converging their *blocking line*.

Concrete formats that work:

- **"What would we block this for?" drill.** Show a diff. Everyone writes their top blocking issue privately, then reveals. Disagreement is the signal — that's a charter ambiguity to resolve.
- **Shared example library.** Maintain a small canon of past PRs annotated with "we blocked here, and here's why / we let this go, and here's why." New reviewers read it; it makes the bar concrete in a way prose never does.
- **Reverse calibration on nits.** Equally important: surface reviewers who *over*-block. A senior who blocks every PR on personal-preference refactors is as much a calibration failure as one who rubber-stamps. The session names both.

> **The professional reality:** calibration is never "done." Tenure churns, new patterns emerge, the codebase shifts. A single session moves the team from "ten bars" to "roughly two bars"; a quarterly cadence keeps it there. The output you actually want is that **an author gets substantially the same review regardless of who picks up the PR** — that is the definition of a calibrated team, and it is the thing authors notice and trust. Without it, your beautiful checklist is just ten people interpreting the same words ten ways.

---

## Core Concept 3 — Moving Design Review Left

Here is the failure no review order can fix: the diff is clean, correct, well-tested, beautifully named — and built on the *wrong approach*. The reviewer's only options are to rubber-stamp a flawed design or to demand a rewrite of a branch that took three weeks. Both are bad, and the cost was locked in *before the first line was written*. The order ("design comes early") is right, but in a finished PR "early" is already too late. The org-level fix is to move the expensive feedback **upstream of the code entirely**.

The lifecycle cost curve is the whole argument:

| Where "wrong approach" is caught | Cost to change | Author's sunk cost | Emotional load |
|---|---|---|---|
| Verbal design ping / hallway | minutes | none | none |
| Design doc / RFC review | hours | a doc | low — no code to defend |
| **Draft PR (early, small)** | hours–day | a spike | low |
| Finished PR review | **days–weeks** | a full branch | **high — defending sunk work** |
| Post-merge / in production | weeks + incident | shipped | highest |

Every row down multiplies cost and emotional friction. The staff move is to install upstream gates so direction-setting feedback lands in the cheap rows:

- **Design docs / RFCs for anything non-trivial.** A one-page proposal reviewed *before* implementation. The review order's "is this the right approach?" question gets asked when the answer costs a paragraph, not a branch.
- **Draft-PR culture.** Normalize opening a PR at 10% — a skeleton, an interface, a spike — explicitly tagged "draft, want directional feedback." This makes "is this the right shape?" a two-hour conversation instead of a two-week confrontation.
- **Early design pings.** A lightweight norm: before starting anything that'll take more than a couple of days, drop the approach in a channel or a 15-minute sync. Catches the worst mismatches for the price of a message.

> **The reframe:** "wrong approach caught too late" is not a reviewer failing — it is a *timing* failing, and timing is an org design choice. You make expensive feedback cheap by *moving it earlier*, not by reviewing harder at the end. A team that relitigates architecture in PR comments has a missing upstream gate, not a careless reviewer. Install the design-review step and the in-PR architecture fights largely evaporate. See [02 — PR Scope & Size](../02-pr-scope-and-size/professional.md) — small, early PRs are the same shift-left lever applied to size.

---

## Core Concept 4 — Teaching the Order to Juniors

A junior's first reviews almost always invert the order: they leave six naming nits and miss the off-by-one, because nits are *visible* and correctness is *invisible* until you train the eye. You cannot fix this with the checklist alone — reading "correctness first" and *seeing* a correctness bug are different skills. The order is taught by coaching the *attention*, not the rules.

The highest-leverage techniques:

- **Review their reviews.** When a junior reviews a PR, you review *their review* — not the code, their *comments*. "You caught the naming. Did you check the error path? What happens if this returns nil?" You are debugging their attention allocation, not the diff.
- **The "what did you look at first?" question.** Ask it after every early review. The answer reveals their order. If "I read top to bottom and fixed names as I went," you have found the lesson: they're reading like a compiler, not triaging like a reviewer.
- **Pair-review.** Sit together on a real PR and narrate your own order out loud: "First I'm checking the PR description matches the diff. Now I'm looking for the error handling. I'm ignoring formatting — the linter owns that." Making the invisible order audible is the single fastest teacher.
- **Assign by lens.** Early on, give a junior a *specific* lens for a PR — "you're on tests for this one, I'll take correctness." It builds depth in one dimension before asking them to hold all of them at once.

> **The mentoring frame:** a junior who leaves only nits is not careless — they have not yet internalized the order, which is *your* job to install, not theirs to magically possess. The fastest correction is to make the order audible (pair-review narration) and to coach the question "what did you look at first?" until their honest answer is "correctness, then design." Teaching the order is teaching the most transferable skill in code review, and it is review's role as the team's primary mentoring channel made concrete (Concept 6).

---

## Core Concept 5 — Protecting the Order From Volume

The order has an enemy stronger than ignorance: **volume**. When a reviewer has eight PRs queued and a sprint deadline, the order silently degrades from the top down. First the readability pass gets skipped. Then the "pull the branch and check the migration" step. Then the genuine correctness scrutiny. What's left is a glance and an LGTM. The order is *the first casualty of overload* — and crucially, it fails *silently*. No one announces "I stopped reviewing properly"; the approvals keep flowing, now hollow.

This is a system-level problem with a system-level fix — it does not yield to telling people to "review more carefully," because the cause is load, not diligence. The levers (this is the territory of [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md)):

- **Make load visible.** If you don't measure review load, you can't protect against it. Track review queue depth and the time-under-review per reviewer. A reviewer whose queue is permanently deep is a rubber-stamp factory in the making.
- **Cap and distribute.** Round-robin or load-balanced assignment so no single senior becomes the de-facto reviewer for everything. A bus factor of one on review is also a quality factor of one.
- **Attack the input side: PR size.** The order survives on a 200-line PR and collapses on a 2,000-line one — attention doesn't scale linearly with diff size, it falls off a cliff. Small PRs are the *primary* defense of review quality, which is why [02 — PR Scope & Size](../02-pr-scope-and-size/professional.md) is upstream of everything here.
- **Accountability closes the loop.** When a bug ships, the blameless question is "what in our *order* would have caught this, and why didn't it run?" Often the honest answer is "the reviewer was at capacity and skipped the correctness pass." That's a load finding, not a person finding — and it's actionable at the system level.

The two degenerate end-states deserve naming, because each has a *specific* cause and a *specific* fix:

| Failure mode | What it looks like | Root cause | Fix |
|---|---|---|---|
| **Rubber-stamping** | reflexive LGTM, no real engagement | reviewer overload | load management + accountability (this concept) |
| **Style-policing** | reviews are 90% formatting nits | no automated style baseline | own style with tooling — see [Static Analysis & Linting](../../static-analysis/) |
| **Architecture-by-PR-comment** | design relitigated on finished branches | no upstream design gate | move design review left (Concept 3) |

> **The discipline:** the order does not collapse because people are lazy — it collapses because attention is finite and load is unbounded. Protect it on the *input* side (smaller PRs, capped queues, distributed assignment) and the *output* side (accountability that asks "what step didn't run?"). And kill style-policing at the source: every formatting argument in a review thread is a linter you haven't adopted yet — push style into tooling so human attention is freed for the top of the order, where it's irreplaceable.

---

## Core Concept 6 — The Author-Growth Lens

There is a frame shift between senior and staff review that reorganizes everything above. The senior reviewer optimizes the *change*: is this PR correct, safe, maintainable? The staff reviewer also optimizes the *author*: did this review make this engineer better? *Software Engineering at Google* (ch. 9) is explicit that code review's primary long-term value is not catching bugs — automated checks catch more — it is **knowledge transfer and maintaining a consistent codebase**. Review is the org's main mentoring channel, running continuously, on real work.

This reframes the *order* itself. When the lens is author-growth:

- **The comment that teaches the order beats the comment that fixes the diff.** "Changed this to handle nil" fixes one bug. "I'd look at the error path before naming here — what happens when this returns an error?" installs the *order* in the author so they self-catch next time. The second comment compounds.
- **Attention shifts to the author's trajectory.** A reviewer who only ever fixes the diff produces clean PRs and stagnant engineers. A reviewer who explains the *why* behind each blocking issue produces engineers who internalize the bar — and eventually review *others* to it. That's how a calibrated bar propagates without you in the room.
- **Tone becomes load-bearing.** Michael Lynch's [*How to Do Code Reviews Like a Human*](https://mtlynch.io/human-code-reviews-1/) is the canonical treatment: feedback framed as collaboration ("what do you think about handling X here?") grows the author; feedback framed as a verdict ("this is wrong") grows defensiveness. The *content* of the order is identical; the *delivery* determines whether the author learns the order or just learns to dread your name. This is the bridge to [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/professional.md).

> **The lens:** at scale, every review is two artifacts — a *gate* on the change and a *lesson* for the author. The staff reviewer's order serves both: it catches the bug *and* teaches the author the order that catches the bug. Optimize only the change and you build a team that depends on you forever; optimize the author too and you build a team that holds the bar without you — which is the entire point of raising it across an org.

---

## War Stories

**The four-bar lottery.** A 12-person team had no shared review bar. Authors learned which reviewers were lenient and routed PRs accordingly; the strict reviewers became bottlenecks everyone avoided. Quality was a function of *who* reviewed, not *what* shipped. The fix was two artifacts plus one ritual: a one-page charter (what we block on / what we don't / severity labels) and a monthly calibration session on a real diff. The first session was the revelation — on the same 300-line PR, blocking-issue counts ranged from zero to five. Three sessions later the spread was tight, authors stopped reviewer-shopping, and the "strict" reviewers stopped being avoided because everyone now held roughly the same line. The bar became a property of the team, not the individual.

**The three-week branch on the wrong foundation.** An engineer spent three weeks building a feature against a data model that, it turned out, couldn't support a requirement everyone had assumed was obvious. The PR was excellent — correct, tested, clean. It was also unmergeable, because the *approach* was wrong, and that was invisible until a domain expert finally looked at the finished branch. The rewrite cost another two weeks and a demoralized author defending sunk work in comment threads. The org-level fix was a hard rule: anything estimated over three days needs a one-page design doc reviewed *before* implementation. The next quarter's "wrong approach" issues were caught in doc review — for the price of a paragraph, not a branch. The lesson wasn't "review harder"; it was "the design question was asked three weeks too late."

**The migration the diff didn't show.** A reviewer read a PR top-to-bottom, found it clean, and approved. The diff added a database migration that, combined with a default value set in a *different* unchanged file, silently backfilled a column with the wrong value in production. Nothing in the visible diff was wrong — the bug lived in the *interaction* between the change and code that didn't appear in the diff. The team adopted a rule born directly from the incident: **any PR touching a migration, a config default, or a generated file gets pulled and run locally, not just read.** They added a checkbox to the PR template ("touches data/migration? reviewer pulled the branch") to make the order's "some changes can't be reviewed by reading" lesson un-skippable.

**The senior whose reviews went hollow.** A respected senior was the default reviewer for half the team. Over a quarter, as their own project load climbed, their review queue stayed deep — and their reviews quietly compressed into fast LGTMs. No one noticed, because the approvals kept coming and the senior's name carried trust. Then two correctness bugs shipped through their approvals in a month. The retro was blameless and the finding was structural: review load was invisible and uncapped, so one person had silently become a rubber stamp under pressure. The fix was on the *system*, not the person — load-balanced reviewer assignment, a visible queue-depth metric, and an explicit norm that "I'm at capacity, reassign this" is a *good* sentence, not a failure. The order had collapsed under volume exactly as predicted; the fix was to bound the volume.

---

## Decision Frameworks

**Review order checklist — what to block on, by severity:**

| Dimension | Severity | Block merge? | Owner |
|---|---|---|---|
| Correctness (edge cases, error paths, concurrency) | `blocking` | Yes | Reviewer (human) |
| Security / data handling (authz, validation, PII, secrets) | `blocking` | Yes | Reviewer + security tooling |
| Design / approach fits and won't corner us | `blocking` | Yes — but ideally caught *upstream* | Design review, then reviewer |
| Missing tests for new behavior | `blocking` | Yes | Reviewer (human) |
| Readability / future-maintainer clarity | `should-fix` | No (fix or follow-up) | Reviewer (human) |
| Naming, formatting, style | `nit:` | **Never alone** | Linter / formatter, not humans |

**When to pull-and-run vs read-the-diff:**

| Signal | Action |
|---|---|
| Pure logic change, fully visible in the diff | Read the diff |
| Touches a **migration / schema / backfill** | **Pull and run** — effects span files |
| Touches a **config default or feature flag** | **Pull and run** — interacts with unchanged code |
| Adds **generated files** (proto, mocks, lockfiles) | Read the source-of-truth; skim the generated |
| Cross-file behavioral change (a default set elsewhere) | **Pull and run** — the diff hides the interaction |
| UI / rendering / output formatting change | **Pull and run** — looks-right ≠ reads-right |

**Design review — upstream vs in-PR:**

| Question | Where it belongs |
|---|---|
| "Is this the right approach / data model / boundary?" | **Upstream** — design doc / RFC, before code |
| "Should this be one service or two?" | **Upstream** — design review |
| "This big-picture decision was never written down" | **Upstream gate is missing** — fix the process, not the PR |
| "This function's error handling is wrong" | In-PR — that's the review order working |
| "This name is unclear / this needs a test" | In-PR — readability/test passes |
| Relitigating architecture on a finished branch | **Smell** — design review was skipped (Concept 3) |

**Calibrating reviewers across a team:**

| Symptom | Diagnosis | Fix |
|---|---|---|
| Same PR, wildly different reviews | No shared bar | Charter + calibration session |
| Authors route PRs to lenient reviewers | Bar varies by person | Calibrate; make the bar a team property |
| One reviewer blocks on preference | Over-calibrated / style-policing | Reverse calibration; push style to tooling |
| Juniors leave only nits | Order not yet taught | Pair-review; "what did you look at first?" |
| Bugs ship through approvals | Possible rubber-stamping | Check load *before* blaming diligence (Concept 5) |

---

## Mental Models

- **The order is a team artifact, not a personal habit.** If it lives only in your head, the team gets a review lottery. Write it down (checklist), label it (severity), and contract it (charter). An author should get the same review regardless of who picks up the PR — that's the goal, and it's measurable.

- **Calibration is to review what code review is to code.** You don't trust one engineer's judgment to be the standard; you converge it against others on real examples. The same diff reviewed by five people, then compared, is the single most effective bar-aligning tool.

- **You make expensive feedback cheap by moving it earlier.** "Wrong approach" caught in a design doc costs a paragraph; caught in a finished PR it costs a branch and morale. Shift-left isn't a slogan — it's the cost curve, and the curve is steep.

- **The order is the first casualty of overload, and it dies silently.** No one announces they stopped reviewing properly. Approvals keep flowing, now hollow. Protect the order on the input side (smaller PRs, capped queues) before asking humans to "try harder."

- **Every review is two artifacts: a gate and a lesson.** The senior optimizes the change; the staff reviewer also optimizes the author. The comment that teaches the order compounds; the comment that only fixes the diff does not.

- **Style arguments in review threads are linters you haven't adopted.** Every formatting nit a human writes is attention stolen from correctness. Push style into tooling so human judgment stays at the top of the order, where it's irreplaceable.

---

## Common Mistakes

1. **Keeping the order in your head.** It dies with your attention and produces a review lottery for authors. Externalize it: an ordered checklist, severity labels on every comment, a team charter that pre-decides what blocks and what doesn't.

2. **Writing a checklist but never calibrating.** A shared vocabulary is not a shared bar. Ten people will interpret "block on correctness" ten ways until you put them on the *same diff* and compare. The artifact is necessary and insufficient.

3. **Trying to fix "wrong approach" with harder PR review.** No review order rescues a three-week branch on the wrong foundation. The fix is upstream — design docs, draft PRs, early pings — not a more diligent reviewer at the end.

4. **Letting reviews degenerate into style-policing.** If your review threads are full of formatting debates, you have a missing tool, not a careful team. Own style with a formatter/linter and free human attention for the top of the order.

5. **Mistaking rubber-stamping for diligence problems.** When approvals go hollow, the cause is almost always *load*, not laziness. Telling an overloaded reviewer to "review more carefully" fails; capping queues and distributing assignment works.

6. **Teaching juniors the rules instead of the attention.** Handing a new reviewer the checklist doesn't make them *see* the off-by-one. Pair-review with narrated order and the "what did you look at first?" question install the attention the checklist only names.

7. **Reviewing the change but never the author.** Optimizing only the diff builds a team that depends on you forever. Explain the *why* behind blocking issues so the author internalizes the order and eventually holds the bar — and reviews others to it — without you.

8. **Reading every PR top-to-bottom.** Some changes (migrations, config defaults, generated files, cross-file effects) are invisible in the diff. Pull and run them. A team rule beats hoping each reviewer remembers.

---

## Test Yourself

1. An author complains that the review they get depends entirely on *who* picks up their PR. Name the two staff-level moves that fix this and explain what each one contributes.
2. Your team has a thorough review checklist, yet reviewers still apply visibly different bars. What's missing, and what's the concrete mechanism to close the gap?
3. An engineer's three-week branch is correct and well-tested but built on the wrong approach. Why is this *not* a reviewer failing, and what org-level change prevents the next one?
4. A junior's first reviews are all naming nits and they miss the correctness bugs. Why does the checklist alone not fix this, and what two techniques do?
5. Approvals from a trusted senior have started shipping bugs. Before concluding they've gotten careless, what should you check, and why?
6. Your review threads are dominated by formatting debates. What is the root cause, and where does the fix belong?
7. Give two concrete signals that tell a reviewer to *pull and run* a branch instead of reading the diff, and explain why reading would miss the issue.
8. What are the *two* artifacts every review produces at the staff level, and how should the review order serve both?

<details>
<summary>Answers</summary>

1. **Codify** (a written checklist encoding the order, severity labels on comments, a charter stating what blocks and what doesn't) gives a shared *vocabulary*; **calibrate** (recurring sessions where reviewers review the same real diff and compare) gives a shared *bar*. Codify alone leaves ten interpretations of the same words; calibration converges them. Together they make the review an author gets independent of *who* reviews it.
2. A shared bar — calibration. A checklist is a shared vocabulary, not a shared threshold. The mechanism is a recurring calibration session: 3–5 reviewers review the *same* non-trivial diff independently, then compare blocking-issue lists. The disagreements are charter ambiguities to resolve. A "what would we block this for?" drill makes the blocking line explicit.
3. The design question ("is this the right approach?") was asked three weeks too late — that's a *timing* failure, not a diligence failure. In a finished PR the reviewer can only rubber-stamp a flawed design or demand a costly rewrite; the cost was locked in before line one. The fix is upstream: a design doc / RFC reviewed *before* implementation for anything non-trivial, plus draft-PR culture and early design pings, so "wrong approach" costs a paragraph, not a branch.
4. Reading "correctness first" and *seeing* a correctness bug are different skills — nits are visible, correctness is invisible until the eye is trained. Two techniques: **pair-review** with the order narrated aloud ("I'm checking the error path now, ignoring formatting — the linter owns that"), and the **"what did you look at first?"** question after each review, which surfaces and corrects their attention order. Coach the attention, not the rules.
5. Check their **review load** before their diligence. Hollow approvals are almost always caused by overload, not laziness: a deep, uncapped review queue under project pressure compresses real review into fast LGTMs, *silently*. The fix is structural — load-balanced assignment, a visible queue-depth metric, and a norm that "I'm at capacity, reassign" is a good sentence — not "review more carefully."
6. The root cause is a **missing automated style baseline** — every formatting debate is a linter/formatter you haven't adopted. The fix belongs in *tooling*, not in human review threads: own style with a formatter and linter so human attention is freed for correctness/design/security at the top of the order. (See Static Analysis & Linting.)
7. Any two of: **migrations/schema/backfills** (effects span unchanged files), **config defaults or feature flags** (interact with code not in the diff), **generated files** (review the source of truth), **cross-file behavioral changes** (a default set elsewhere), **UI/output changes** (looks-right ≠ reads-right). Reading misses these because the bug lives in the *interaction* between the change and code that never appears in the diff — pulling and running surfaces the actual behavior.
8. A **gate** on the change (is it correct, safe, maintainable?) and a **lesson** for the author (did this review make them better?). The order should serve both: catch the bug *and* teach the author the order that catches the bug — e.g., "I'd check the error path before naming; what happens when this returns an error?" fixes the diff *and* installs the order so the author self-catches next time.

</details>

---

## Cheat Sheet

```
CODIFY THE ORDER (artifacts a new hire reads day one)
  checklist  → the ordered sequence + the [BLOCK] line
  PR template→ front-load What/Why + How-to-verify (migrations here!)
  charter    → what we block on / what we don't / severity words
  labels     → blocking · should-fix · nit: · question:   (highest-leverage single artifact)

CALIBRATE (shared vocabulary != shared bar)
  same real diff → 3-5 reviewers, independent → compare
  drill: "what would we block this for?" (private then reveal)
  shared example library: "blocked here / let this go, and why"
  quarterly cadence; also catch OVER-blockers (style-policing)
  goal: same review regardless of WHO picks up the PR

SHIFT DESIGN REVIEW LEFT (timing, not diligence)
  hallway/ping  → minutes      design doc/RFC → hours
  draft PR      → hours-day     finished PR    → DAYS-WEEKS
  rule of thumb: >3 days of work → one-page design doc first
  architecture-by-PR-comment = a MISSING upstream gate

TEACH JUNIORS THE ORDER (coach attention, not rules)
  review their REVIEWS, not just the code
  ask "what did you look at first?"  (reveals their order)
  pair-review with the order narrated aloud
  assign by lens early ("you're on tests, I've got correctness")

PROTECT THE ORDER FROM VOLUME (first casualty, fails silently)
  rubber-stamp ← overload      → cap + distribute + accountability
  style-police ← no tooling    → own style with linter/formatter
  arch-by-comment ← no design  → move design review left
  smaller PRs = the PRIMARY defense of review quality

AUTHOR-GROWTH LENS (every review = gate + lesson)
  comment that teaches the order > comment that only fixes the diff
  explain the WHY behind blockers → author internalizes the bar
  tone is load-bearing: "what do you think about X?" not "this is wrong"
```

---

## Summary

- **Codify the order into artifacts.** A review order in your head produces a review lottery. Externalize it: an ordered checklist with an explicit blocking line, a PR template that front-loads context, and a team charter stating what you block on and what you don't. **Severity labels** (`blocking` / `should-fix` / `nit:` / `question:`) are the single highest-leverage artifact — they do the calibration prose can't. Google's Code Review Developer Guide is the canonical model.
- **Calibrate the humans.** A shared vocabulary is not a shared bar. Recurring calibration sessions — the *same* real diff, reviewed independently, then compared — converge ten bars into one. The goal is an author getting the same review regardless of who picks up the PR.
- **Move design review left.** No review order rescues a three-week branch on the wrong approach — that's a *timing* failure. Make expensive feedback cheap with design docs/RFCs, draft-PR culture, and early pings, so "wrong approach" costs a paragraph, not a branch. Architecture-by-PR-comment is a missing upstream gate, not a careless reviewer.
- **Teach juniors the attention, not the rules.** Reading "correctness first" and *seeing* the bug are different skills. Review their reviews, ask "what did you look at first?", and pair-review with the order narrated aloud.
- **Protect the order from volume.** The order is the first casualty of overload and it dies silently. Defend it on the input side (smaller PRs, capped and distributed queues) and the output side (accountability that asks "what step didn't run?"). Rubber-stamping is a load problem; style-policing is a tooling gap — see [Static Analysis & Linting](../../static-analysis/).
- **Adopt the author-growth lens.** Every review is a gate on the change *and* a lesson for the author. Optimizing only the diff builds a team that depends on you forever; teaching the order builds a team that holds the bar without you — the entire point of raising it across an org.

You can now raise the review bar across a team, not just apply it yourself. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone can install and defend an order at scale.

---

## Further Reading

- [Google — *Code Review Developer Guide*](https://google.github.io/eng-practices/review/) — the canonical public artifact: what reviewers look for, in what spirit, codified for an entire org. The model for your checklist and charter.
- [*Software Engineering at Google*, Chapter 9 — Code Review](https://abseil.io/resources/swe-book/html/ch09.html) — review's primary value as knowledge transfer and codebase consistency, the author-growth lens, and why "LGTM with comments" works at scale.
- [Michael Lynch — *How to Do Code Reviews Like a Human*](https://mtlynch.io/human-code-reviews-1/) — the definitive treatment of tone and the author-growth framing; how delivery determines whether the author learns the order.
- [`interview.md`](interview.md) — the same material distilled into interview questions on installing, calibrating, and defending a review order at team scale.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/professional.md) — small, early PRs are the primary defense of the review order against volume, and the same shift-left lever applied to size.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/professional.md) — the delivery side of the author-growth lens; how the order is communicated so the author grows.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md) — measuring review load and tempo so the order doesn't silently collapse under volume.
- [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the interpersonal and mentoring dimension of raising the bar across people.
- [Static Analysis & Linting](../../static-analysis/) — pushing style and mechanical checks into tooling so human review stays at the top of the order.
