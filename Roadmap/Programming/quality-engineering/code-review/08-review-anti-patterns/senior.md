# Review Anti-patterns — Senior Level

> **Roadmap:** [Code Review](../README.md) → Review Anti-patterns
> *The middle page named the anti-patterns and told you how to stop doing them. This page is about the systems that manufacture them: why bikeshedding is an automation gap, why rubber-stamping is a math problem about PR size, why ghosting is a load-balancing failure — and how a senior diagnoses a broken review culture and fixes the machine instead of nagging the people stuck inside it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Root-Cause Model: Anti-patterns Are Symptoms](#core-concept-1--the-root-cause-model-anti-patterns-are-symptoms)
5. [Core Concept 2 — Bikeshedding Is an Automation Gap](#core-concept-2--bikeshedding-is-an-automation-gap)
6. [Core Concept 3 — Rubber-Stamping Is the Inspection-Rate Cliff](#core-concept-3--rubber-stamping-is-the-inspection-rate-cliff)
7. [Core Concept 4 — Ghosting and Bottlenecks Are Load Problems](#core-concept-4--ghosting-and-bottlenecks-are-load-problems)
8. [Core Concept 5 — Review Theatre and the False-Assurance Trap](#core-concept-5--review-theatre-and-the-false-assurance-trap)
9. [Core Concept 6 — Normalization of Deviance in Review](#core-concept-6--normalization-of-deviance-in-review)
10. [Core Concept 7 — The Power and Social Dynamics](#core-concept-7--the-power-and-social-dynamics)
11. [Core Concept 8 — Author-Side Pathologies](#core-concept-8--author-side-pathologies)
12. [Core Concept 9 — Metrics That Manufacture Anti-patterns (Goodhart)](#core-concept-9--metrics-that-manufacture-anti-patterns-goodhart)
13. [Core Concept 10 — When Review Is the Wrong Tool](#core-concept-10--when-review-is-the-wrong-tool)
14. [Core Concept 11 — Diagnosing a Broken Review Culture](#core-concept-11--diagnosing-a-broken-review-culture)
15. [Real-World Examples](#real-world-examples)
16. [Mental Models](#mental-models)
17. [Common Mistakes](#common-mistakes)
18. [Test Yourself](#test-yourself)
19. [Cheat Sheet](#cheat-sheet)
20. [Summary](#summary)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The systemic causes that produce review anti-patterns, and the staff-level skill of diagnosing and turning around a broken review culture.**

By the middle level you can name the anti-patterns — the nitpick storm, the rubber stamp, the ghosted PR, the ego comment — and you know the personal habits that avoid them. That makes you a good reviewer. The senior jump is different: you stop treating anti-patterns as *behaviors to correct* and start treating them as *outputs of a system*. A nitpick storm is not a discipline failure of a reviewer who "should know better"; it is what a review process *produces by construction* when style is debatable instead of automated. A rubber stamp is the *rational response* to a 1,800-line PR. Ghosting is what happens when one person is on the critical path for forty open reviews and has no SLA.

This reframing matters because the symptom-level fix doesn't scale and doesn't last. Telling people "stop nitpicking" works for a week; installing a formatter that makes style non-debatable works forever. The senior's job is to find the *generative system* behind a class of anti-patterns and change it, so the anti-pattern stops being the path of least resistance. That requires a model of which systemic levers produce which pathologies, the ability to *read a broken culture from its signals*, and a disciplined intervention order — because pulling the levers in the wrong sequence (lecturing about culture before shrinking PRs) wastes the goodwill you need for the changes that actually work. This page is that model.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — you can name the major anti-patterns and the individual habits that avoid them.
- **Required:** You understand small-PR practice and stacking from [02 — PR Scope & Size](../02-pr-scope-and-size/senior.md), and review tempo metrics (TTFR, time-to-merge) from [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md).
- **Required:** You've felt the difference between feedback that lands and feedback that wounds — the substance of [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/senior.md).
- **Helpful:** You've owned a team's review process, or watched one rot, and have a gut sense for "nobody actually reads these anymore."
- **Helpful:** A working memory of Goodhart's law and the idea that any metric tied to incentives gets gamed.

---

## Glossary

| Term | Meaning |
|---|---|
| **Anti-pattern** | A recurring "solution" that looks reasonable locally but produces worse outcomes than the problem it addresses. In review, a *symptom* of a systemic cause. |
| **Bikeshedding** | Disproportionate attention to trivial, easy-to-grasp issues (formatting, naming) while substantive issues (design, correctness) go unexamined. From Parkinson's "law of triviality." |
| **Rubber-stamping** | Approving without meaningfully reading — LGTM as a reflex, not a judgment. |
| **Review theatre** | Review performed for *process/compliance signaling* that catches nothing; mandatory but meaningless. |
| **Inspection rate** | Lines of code reviewed per hour. Above a threshold (~400–500 LOC/hr), defect-detection collapses — the *inspection-rate cliff*. |
| **TTFR** | Time To First Review — latency from "review requested" to the first substantive reviewer response. |
| **Find rate / defect-detection rate** | Fraction of reviews that surface at least one real defect or design concern. Near-zero find rate is the fingerprint of theatre. |
| **Normalization of deviance** | A deviation from the standard that is repeatedly tolerated until it silently *becomes* the standard (Diane Vaughan, *The Challenger Launch Decision*). |
| **Goodhart's law** | "When a measure becomes a target, it ceases to be a good measure." Individual review metrics get gamed. |
| **Preference-blocking** | Blocking a PR over a reviewer's personal taste presented as a requirement, with no shared norm to arbitrate. |
| **Gatekeeping** | Using review approval as a status lever rather than a quality gate. |
| **Fait accompli** | "It's already done, just approve it" — pressure created by presenting completed work as non-negotiable. |

---

## Core Concept 1 — The Root-Cause Model: Anti-patterns Are Symptoms

The central thesis of this page: every review anti-pattern is a *symptom*, and almost all of them trace to a small set of systemic causes. The senior who memorizes the anti-pattern list treats symptoms forever. The senior who memorizes the *causal map* fixes the disease.

Here is the map. Read it as "this systemic gap *produces* these visible anti-patterns, and the fix is to close the gap, not to scold the symptom."

| Systemic root cause | Anti-patterns it produces | Systemic fix |
|---|---|---|
| **Style not automated** | Bikeshedding, nitpick storms, formatting wars, taste debates | Formatters + linters own style; humans review meaning ([Static Analysis & Linting](../../static-analysis/)) |
| **PRs too big** | Rubber-stamping, review fatigue, shallow approval, escaped defects | Small PRs, stacking ([02 — PR Scope & Size](../02-pr-scope-and-size/senior.md)) |
| **Reviewers overloaded / no SLA** | Ghosting, LGTM-without-reading, single-reviewer bottleneck | Load-balancing, WIP limits, review SLAs ([07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md)) |
| **No norms / style guide / calibration** | Preference-blocking, inconsistent bars, taste wars, churn | Severity labels, style guide as taste-arbiter, calibration ([05 — Feedback](../05-feedback-giving-and-receiving/senior.md)) |
| **Bad or individual metrics** | Gaming: nitpicking for comment count, rubber-stamping for speed | Team-level outcome metrics, not individual gates ([07 — Metrics](../07-review-metrics-and-tempo/senior.md)) |
| **Low psychological safety / status games** | Ego comments, gatekeeping, adversarial review, defensiveness | Norms, leadership modeling, "attention on the artifact, not the author" |
| **Review used to compensate for missing tooling** | Reviewers manually hunting bugs a test/type/sanitizer should catch | Move the check left into CI ([Quality Gates](../../quality-gates/)) |

> **Key insight:** Anti-patterns are not character flaws; they are the *equilibrium behavior* of the system as configured. People do the locally rational thing inside the rules you gave them. If reviewers nitpick, you built a system where nitpicking is the easiest way to look engaged. Change the payoff structure and the behavior changes — without a single conversation about willpower.

The rest of this page walks the major rows of that table in depth, then assembles them into a *diagnostic and turnaround* method. Notice one structural fact already: the fixes are mostly *not* "be a better person." They are formatters, size limits, rotations, SLAs, severity labels, and metric redesigns — engineering interventions on a sociotechnical system.

---

## Core Concept 2 — Bikeshedding Is an Automation Gap

Parkinson's "law of triviality" observed that a committee approving a nuclear reactor will rubber-stamp the reactor and then argue for an hour about the bike shed — because everyone *understands* bike sheds and almost no one understands reactors. Review reproduces this exactly: a reviewer who can't quickly grasp a concurrency invariant *can* instantly see that a brace is on the wrong line, so attention flows downhill to the trivial.

The naive fix is exhortation: "focus on what matters, stop nitpicking." It fails because it fights human nature with willpower. The systemic fix removes the trivial from the human's plate entirely:

```yaml
# The boundary that kills bikeshedding: machines own style, humans own meaning.
#
#   Formatter (gofmt, prettier, black, rustfmt)  → whitespace, line length, brace style
#   Linter (golangci-lint, eslint, clippy, ruff)  → naming, unused vars, simple bugs
#   Import sorter / organizer                      → import order
#   Spell-checker / commit-lint                    → typos, message format
#                                                    ─────────────────────────────
#   HUMAN reviewer                                 → design, correctness, naming
#                                                    *intent*, security, tradeoffs
```

The rule is mechanical and absolute: **if a comment could have been a lint rule, it should have been a lint rule.** A reviewer typing "nit: use 2 spaces" is doing a robot's job badly and slowly, and worse, is *modeling* that style is a legitimate review battleground — which licenses the next reviewer to do the same.

```diff
# Anti-pattern: the nitpick storm — 14 comments, all trivial
- nit: prefer single quotes here
- nit: trailing comma
- nit: this should be camelCase
- nit: extra blank line
  (zero comments on the actual logic)

# Systemic fix: the formatter ran in CI and pre-commit; the diff
# arrives already-formatted, so these comments are impossible to write.
+ "The retry loop here will busy-spin if the context is already
+  cancelled — should we check ctx.Err() before the first attempt?"
```

The deeper point: bikeshedding is a *signal*, not just a nuisance. A review thread dominated by nits is telling you the **automation boundary is in the wrong place** — style decisions that should be settled by a tool are leaking into human attention. The fix lives in [Static Analysis & Linting](../../static-analysis/): adopt an opinionated formatter, make it a *blocking* CI gate and a pre-commit hook, and adopt the team rule that **style is not a review topic.** Once style is genuinely non-negotiable (because a machine enforces it), there is nothing left to bikeshed.

> **Key insight:** You cannot win a taste war by having better taste; you win it by removing taste from the contested zone. A formatter is not a convenience — it is the *taste-arbiter* that ends the argument by making the question undecidable by humans. The number of style nits in your review threads is a direct, inverse measure of how well your automation boundary is drawn.

---

## Core Concept 3 — Rubber-Stamping Is the Inspection-Rate Cliff

Rubber-stamping looks like a discipline problem ("the reviewer didn't bother to read"). It is overwhelmingly a *physics* problem, and the physics is well-measured. The foundational data — SmartBear's study of a Cisco codebase, echoed by the original IBM/Fagan inspection research — shows that **defect-detection effectiveness collapses above an inspection rate of roughly 400–500 LOC per hour**, and craters on review sessions longer than ~60 minutes. Human defect-finding has a hard throughput ceiling.

Now overlay PR size. If a reviewer can effectively inspect ~400 LOC/hr and your median PR is 1,500 LOC, then *meaningful* review of one PR costs nearly four hours of focused attention. No one has four uninterrupted hours per PR across a queue of them. So the reviewer does the only thing the system permits: they *skim and approve*. The rubber stamp is not laziness — it is the rational output of asking a human to do an impossible amount of inspection.

```
inspection-rate cliff (schematic):

defect       │██████████ effective
detection    │█████████▒
rate         │███████▒▒▒
             │████▒▒▒▒▒▒  ← cliff edge (~400-500 LOC/hr)
             │█▒▒▒▒▒▒▒▒▒
             │▒▒▒▒▒▒▒▒▒▒  ← rubber-stamp zone
             └──────────────────────────────────
              small PR        huge PR (LOC reviewed per hour) →
```

This is why the *single most effective* anti-rubber-stamping intervention is not a policy about reading carefully — it is **shrinking PRs** so that careful reading fits in the time a reviewer actually has. The relationship is causal and one-directional: small PRs *enable* real review; they don't guarantee it, but large PRs *prevent* it. There is also a vicious feedback loop to break: big PRs cause rubber-stamping → defects escape → the next big PR is reviewed even more shallowly because trust in review has eroded → "review doesn't catch anything anyway, why bother."

The fix is the entire toolkit of [02 — PR Scope & Size](../02-pr-scope-and-size/senior.md): a soft size budget (e.g., flag PRs over ~400 lines), **stacking** so a large change arrives as a reviewable sequence of small diffs, and separating mechanical changes (renames, moves, generated code) from semantic ones so the reviewer's attention isn't diluted across thousands of trivial lines.

> **Key insight:** A 2,000-line PR cannot be reviewed; it can only be approved. When you see uniform fast approvals on large PRs, do not ask "why aren't reviewers reading?" — ask "what about our process makes reading impossible?" The answer is almost always PR size, and the fix is upstream of the review, in how work is decomposed.

---

## Core Concept 4 — Ghosting and Bottlenecks Are Load Problems

The ghosted PR — open for days, no reviewer response — and its cousin the single-reviewer bottleneck are read by frustrated authors as *neglect*. They are almost always **load and routing failures**: there is no SLA, no WIP limit, no load-balancing, so review is unowned work that competes with everything else and loses.

Three distinct failures hide under "slow review," and they have different fixes:

| Symptom | Underlying load failure | Fix |
|---|---|---|
| PRs sit untouched for days | No review SLA / no tempo norm | Team SLA on TTFR (e.g., first response < 1 business day); make it visible |
| One person reviews everything | No load-balancing; expertise concentrated | Round-robin assignment, `CODEOWNERS` with multiple owners, deliberate expertise-spreading |
| Reviewer drowning, quality drops | No WIP limit on incoming reviews | Cap concurrent reviews; protect maker-time blocks; treat review as scheduled work, not interrupt |

The single-reviewer bottleneck is especially insidious because it *looks like* a strength — "Priya is so thorough, everyone wants her review." But it is a [bus-factor](../../technical-debt-management/) risk, a throughput ceiling for the whole team, and a slow burnout of your best reviewer. The fix is to *spread the expertise that makes Priya valuable*: pair junior reviewers with her, rotate ownership, and use review as a teaching mechanism so the pool of capable reviewers grows. A bottleneck reviewer is a signal that knowledge is hoarded, not just that work is unbalanced.

The crucial reframing for ghosting: **review must be treated as first-class work with explicit capacity, not as a thing people do "when they get a chance."** When review is invisible and unowned, it is always the lowest-priority item on everyone's list, and PRs ghost. When review is scheduled, rotated, and SLA'd — the substance of [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md) — ghosting largely disappears, because someone is *accountable* for the latency.

> **Key insight:** "Be more responsive to reviews" is a request for individual heroics that doesn't survive a busy sprint. "First-response SLA of one business day, round-robin assignment, and a WIP cap of three concurrent reviews per person" is a *system* that produces responsiveness without anyone being a hero. Ghosting is an org chart problem wearing a personal-diligence costume.

---

## Core Concept 5 — Review Theatre and the False-Assurance Trap

Review theatre is the most dangerous anti-pattern, and it deserves the most precise treatment, because it is *invisible by design*: every PR is approved, the process box is checked, the dashboards are green — and review catches nothing. It exists to *signal* that review happens (for compliance, for a SOC 2 control, for "we take quality seriously"), not to *do* what review is for.

It is dangerous precisely because it produces **false assurance**. A team with no review at all knows it has no review. A team with review theatre *believes it is protected* and therefore stops investing in the other defenses (tests, types, sanitizers, monitoring) that real review would have signaled were needed. This is the exact structural parallel to security theatre and to quality-gate theatre — a [quality gate](../../quality-gates/) that always passes is worse than no gate, because it converts "we don't know if this is safe" into a confident, wrong "this is safe." The control's *output* (approved / green) has decoupled from the control's *purpose* (catching defects).

**How to detect review theatre.** Theatre has a measurable fingerprint, because pretending to review produces telltale statistics that genuine review does not:

```
SIGNALS OF REVIEW THEATRE
─────────────────────────────────────────────────────────────
1. Approval latency suspiciously UNIFORM and SHORT
     real review:    bimodal — some quick, some long; high variance
     theatre:        nearly every PR approved in < 60s, low variance
                     (genuine reading takes variable, nonzero time)

2. Near-ZERO find rate
     real review:    a meaningful fraction of PRs get change requests,
                     design questions, or substantive comments
     theatre:        ~100% approved-as-is; comments are absent or cosmetic

3. Comment content is cosmetic or empty
     real review:    questions about design, edge cases, failure modes
     theatre:        "LGTM", "👍", or only nits — no engagement with logic

4. Approval correlates with NOTHING about the diff
     real review:    big/risky diffs take longer, draw more comments
     theatre:        a 5-line fix and a 2,000-line refactor get identical
                     30-second LGTMs

5. The "who actually read this?" test fails
     ask the approver one specific question about the change;
     theatre cannot answer it
```

The single most powerful detector is signal 4: in genuine review, time-to-approve and comment-count *correlate with diff size and risk*. Under theatre, approval is **uncorrelated with the artifact** — a constant function of the diff. That decoupling is the mathematical signature of a control that has stopped measuring what it claims to measure.

**How to kill review theatre.** You cannot fix theatre by demanding "review harder" — that just produces more elaborate theatre. You have to *remove the conditions that make theatre rational*, in this order:

1. **Make real review possible** — shrink PRs (Concept 3) and automate style (Concept 2) so that careful review is feasible in the time available. Theatre is often a forced move under impossible load.
2. **Re-attach the metric to the purpose** — track *find rate* and *escaped-defect classes*, not approval count or speed. Ask of each escaped production bug: "would review have caught this, and if so why didn't it?"
3. **Restore the meaning of approval** — make it explicit and culturally real that *approval = "I read this and I stand behind it,"* not *approval = "I clicked the button so you're unblocked."* Co-ownership of escaped defects (author *and* approver) makes the signature credible.
4. **If review genuinely can't catch a defect class, stop pretending it does** — move that check to a tool (Concept 10). Theatre sometimes persists because review is being asked to do a job it structurally cannot.

> **Key insight:** A review process that approves everything in 30 seconds is not a weak version of review — it is a *different system* that produces a green light and zero protection. The most useful question a senior can ask of a too-smooth review process is "what would this look like if it caught nothing? — and does it look exactly like that?" If approval is uncorrelated with the diff, you have theatre, and green dashboards are actively lying to you.

---

## Core Concept 6 — Normalization of Deviance in Review

Diane Vaughan coined *normalization of deviance* to explain Challenger: NASA repeatedly flew with O-ring erosion that was outside spec, each flight survived, and the deviation gradually *became the new normal* — until it didn't, catastrophically. Review cultures decay by the identical mechanism, and recognizing it is a senior-level pattern-match.

The review version: a shortcut is taken once under pressure ("this hotfix is urgent, let's fast-approve it without the usual scrutiny"), nothing bad happens, so the shortcut is taken again, and again, until **"we always fast-approve X" is the unspoken policy** — right up until a bad X ships and causes an outage. Each individual fast-approval was locally defensible. The *drift* — the silent migration of the bar from "carefully reviewed" to "rubber-stamped by default for this category" — is the pathology, and it is invisible in any single instance.

```
NORMALIZATION OF DEVIANCE — the drift

  T0:  "We carefully review every config change."          (standard)
  T1:  "This config change is trivial, just LGTM it."      (one exception)
  T2:  "Config changes are usually fine, quick-approve."   (pattern forming)
  T3:  "We don't really review config changes."            (new normal)
  T4:  A config change takes down prod.                     (the bill arrives)

  At no single step did anyone decide to stop reviewing.
  The standard eroded one reasonable-seeming exception at a time.
```

Common categories that drift: config/infra changes ("it's just YAML"), dependency bumps ("Dependabot, auto-merge"), "trivial" one-liners (where the truly dangerous off-by-one bugs love to hide), generated code, and changes from senior/trusted authors ("it's so-and-so, it's fine"). The trust-in-author drift is especially seductive because it *feels* like efficient prioritization, and the most senior authors ship the changes with the largest blast radius.

The senior's countermeasures are systemic, not vigilance-based:
- **Name the deviation explicitly when you spot it** — "We've quietly stopped reviewing migrations; that's a deviation from our standard, and migrations are exactly the high-blast-radius change we should review *most*." Making the drift conscious is half the fix.
- **Tool the categories that have drifted** so the *machine* enforces the bar that humans let slip — schema-migration linters, dependency-policy bots, config validators. If review reliably skips a category, move that category's safety net into CI ([Quality Gates](../../quality-gates/)).
- **Periodically re-examine "what do we always fast-approve, and is that still safe?"** as a deliberate retro question — surface the normalized deviations before the outage does.

> **Key insight:** Review cultures rarely collapse; they *erode*, one locally reasonable exception at a time, until the exception is the rule and no one remembers deciding it. The escaped defect that "should obviously have been caught" is usually the bill for a long-normalized deviation. The senior skill is detecting the *drift*, which is invisible at the granularity of any single PR and only visible in the pattern across many.

---

## Core Concept 7 — The Power and Social Dynamics

A set of anti-patterns are not about competence or load at all — they are about *status and power*, and they corrode the trust that makes review work. They look different from process failures, and they need different (harder, more interpersonal) fixes.

**Gatekeeping as status.** The reviewer who blocks to *feel important*: every PR draws a wall of "I would have done it differently" demands, the bar moves to wherever lets them stay in control, and approval becomes a tribute they grant rather than a quality judgment they render. The tell is that their objections are framed as requirements but trace to taste, and the bar is *inconsistent* — strict for some authors, lax for others. This is preference-blocking weaponized into a power position.

**The adversarial reviewer.** Treats review as a contest to win — author vs reviewer, with the reviewer's job being to *find fault* and the author's to *survive*. The comments are correct-but-cruel, the tone is prosecutorial, and the effect is that authors ship defensively, hide work, and avoid the reviewer. Review becomes combat, and combat does not produce good software — it produces small, timid, un-ambitious PRs designed to give the adversary nothing to attack.

**The author who weaponizes "you're blocking me."** The inverse power play: the author reframes legitimate review feedback as *obstruction*, applies social pressure ("you're slowing down the team / the launch / the customer"), and tries to convert the reviewer's diligence into a guilt liability. This is gatekeeping-resentment turned into a coercion tool, and unchecked it trains reviewers to wave things through to avoid being cast as the villain.

**The confused deputy: "approval = endorsement" vs "approval = good-enough."** A subtle but load-bearing source of conflict. If a reviewer believes their approval is a *personal endorsement* that they'd stake their reputation on, they will block until the PR matches *their* vision — which manifests as preference-blocking and gatekeeping. If approval instead means *"this meets the team's agreed bar for merge,"* the reviewer's job is to check against a *shared standard*, not impose a personal one. Most taste wars are actually a disagreement about *which definition of approval is operative*, never made explicit.

The systemic fixes for status pathologies:
- **Severity labels and a style guide as the taste-arbiter** — when a comment must be labeled `blocking` / `should` / `nit` and a *non-blocking preference cannot block the merge* (the substance of [05 — Feedback](../05-feedback-giving-and-receiving/senior.md)), the gatekeeper loses the lever. The style guide, not the senior's opinion, decides taste.
- **Norm: "attention on the artifact, not the author."** Comments critique the code's behavior, not the person ("this function" not "you"). Adversarial framing is a norm violation, named as one.
- **Leadership modeling.** Status games stop when the most senior people *visibly* take feedback gracefully, write kind-but-rigorous comments, and approve at the *team's* bar rather than their personal one. Culture is set by what leaders tolerate and what they model — not by a document.
- **Redefine approval explicitly** — write down that *approval = "meets the team's bar for merge,"* not *"is how I personally would have written it."* This single clarification dissolves a large fraction of taste wars.

> **Key insight:** When review feels like a fight for status, no process tweak will fully fix it, but you can *take away the weapons*: severity labels strip the gatekeeper's ability to block on taste, a shared style guide moves the taste argument out of the PR, and an explicit definition of "what approval means" ends the endorsement-vs-good-enough confusion. The remaining residue — ego — is fixed only by leadership modeling and a culture where the artifact, not the author, is the subject.

---

## Core Concept 8 — Author-Side Pathologies

Anti-patterns are not only a reviewer disease. Authors generate a parallel set, and a senior who only polices reviewers is treating half the system. The author-side pathologies are also *systemically produced* — usually by a missing norm or a perverse incentive.

**The un-self-reviewed PR.** The author opens a PR they have not read themselves — debug prints, commented-out code, an accidentally-committed secret, a leftover TODO, an entire file that shouldn't be there. This dumps the cost of catching *trivially-self-catchable* issues onto the reviewer, and it poisons the well: a reviewer who finds sloppy obvious mistakes assumes the *substance* is equally sloppy and either over-scrutinizes (slow) or gives up and rubber-stamps (dangerous). The fix is a norm — **the author reviews their own diff first**, ideally with a self-review pass annotating non-obvious decisions — plus tooling (pre-commit hooks, secret scanners) that makes the obvious classes impossible to submit.

**The defensive author who relitigates.** Every comment is met with justification rather than curiosity; the thread becomes a debate the author is trying to *win* instead of feedback they're trying to *use*. This is often a *psychological-safety* symptom — the author experiences feedback as an attack on competence — and it is amplified by adversarial reviewers (Concept 7), so the two pathologies feed each other. The fix is partly cultural (separate the work from the worth; feedback is about the code) and partly procedural (a norm that *unresolved disagreements escalate to a tie-breaker / decider* rather than grinding the thread, so neither party "loses").

**The giant-PR-as-fait-accompli.** The most coercive author pattern: drop a 3,000-line PR representing two weeks of solo work and apply the pressure *"it's already done, just approve it — asking for changes now wastes all that effort."* This weaponizes [sunk cost](../../technical-debt-management/) against the reviewer and makes genuine review socially impossible — any substantive feedback is reframed as destroying completed work. It is the author-side twin of the inspection-rate cliff (Concept 3): the PR is unreviewable *and* the author has made re-work feel unconscionable. The fix is upstream and structural: **design review / RFC before the big build**, and **stacked incremental PRs** so feedback arrives while it is still cheap to act on, never as a fait accompli. A fait accompli is a process failure that happened weeks before the PR opened — the author was allowed to disappear and return with finished work instead of being pulled into incremental review.

> **Key insight:** "Just approve it, it's already done" is not a request — it is an attempt to convert the reviewer's *time* and the author's *sunk effort* into a reason to skip review. The defense is never to cave at the PR; it is to make the fait accompli structurally impossible by pulling feedback *earlier* — design docs, small stacked PRs — so finished-and-unreviewable work never gets created in the first place.

---

## Core Concept 9 — Metrics That Manufacture Anti-patterns (Goodhart)

A special, self-inflicted category: the team *measures review*, ties the measure to evaluation or pride, and the measure — per Goodhart — gets gamed into existence as an anti-pattern. The metric doesn't *reveal* the anti-pattern; it *creates* it. This is the metrics failure that [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md) treats in depth, viewed through the anti-pattern lens.

| Metric (as an individual target) | Anti-pattern it manufactures | Why it games |
|---|---|---|
| **Comments left per reviewer** | Nitpicking — reviewers farm trivial comments to hit a number | Substantive comments are hard and slow; nits are infinite and free |
| **Time-to-approve / review speed** | Rubber-stamping — approve fast to look responsive | Reading carefully *lowers* your speed score; LGTM maximizes it |
| **PRs reviewed per week** | Shallow review — maximize count, minimize depth per PR | Throughput rewards skimming over scrutiny |
| **Approval rate / "% PRs unblocked fast"** | Theatre — approve everything to keep the number green | A change-request *hurts* the metric; a rubber stamp protects it |
| **Lines reviewed per day** | Cliff-diving — accept huge PRs to inflate volume | The unreviewable 2,000-line PR is a *good* day by this metric |

Every one of these is a *good intention weaponized*: you wanted faster reviews, so you measured speed, and you got rubber-stamping. You wanted engaged reviewers, so you measured comments, and you got nitpicking. The metric points at the symptom and the incentive *produces* the symptom.

The systemic fix has two parts. First, **never tie individual review metrics to evaluation** — the moment "comments per reviewer" or "review speed" appears in a perf packet, you have commissioned the corresponding anti-pattern. Second, **measure team-level outcomes, not individual review activity**: escaped-defect rate (did bugs reach production?), defect-detection / find rate (is review catching things?), and review *latency distribution* as a health signal (is review a bottleneck?) — outcomes that are hard to game by behaving badly in a single review. The distinction is *diagnostic metrics* (which you watch to find systemic problems) versus *target metrics tied to individuals* (which you must not create, because they manufacture the very pathologies you're trying to prevent).

> **Key insight:** If you find yourself with a review anti-pattern that everyone *knows* is bad but keeps doing, look immediately for the metric that *rewards* it. Nitpicking with a comment-count metric, rubber-stamping with a speed metric — the behavior is rational given the scoreboard. The fix is to change the scoreboard, not to lecture the players. A measure tied to an individual incentive *will* be gamed; the only question is whether you chose a measure whose gamed form is harmless or catastrophic.

---

## Core Concept 10 — When Review Is the Wrong Tool

A subtle, senior-level anti-pattern: using human review to compensate for a *missing automated check*. A reviewer leaves "you should null-check this here" — and is *right* — but the systemic failure is that a type system, a linter, a sanitizer, or a test *should have caught it*, deterministically, on every PR forever, instead of relying on a human to remember every time. Review caught it *this* time; it will miss it the tenth time the reviewer is tired or rushed.

Review is the wrong tool — and tooling is the right one — whenever the check is *mechanically decidable and recurring*:

| Reviewer is manually catching... | The real fix is... |
|---|---|
| "You should null-check / handle this error" (recurring) | A type system / linter rule / errcheck — make it un-shippable |
| "This isn't covered by a test" | A coverage gate; or it signals a [correctness-review](../03-correctness-and-design-review/senior.md) test-design gap |
| "This could overflow / data-race / leak" | A sanitizer (ASan/TSan/UBSan), `-race`, fuzzing in CI (dynamic analysis) |
| "Format / naming / import order" | A formatter / linter (Concept 2) |
| "This SQL is injectable" | A static-analysis security rule; parameterized-query lint |
| "You re-introduced a bug we fixed before" | A regression test that fails on reappearance |

The principle: **review is for judgment that machines cannot make** — is this the right *design*? does this match *intent*? is this *abstraction* sound? are these the right *tradeoffs*? Spending scarce, expensive, non-deterministic human review attention on checks a machine can make *every time* is not diligence; it is a misallocation that *also* crowds out the design review only a human can do. Worse, it is fragile-by-construction: a check that depends on a human remembering it *will* eventually be forgotten, which is exactly how the bug class keeps escaping.

This connects directly to the diagnosis method in the next concept: **a recurring class of escaped defects is a signal to tool the check, not to review harder.** If the same kind of bug keeps slipping through review, the lesson is *not* "reviewers must be more vigilant about this" — it is "this check belongs in CI, where vigilance is automatic." See [03 — Correctness & Design Review](../03-correctness-and-design-review/senior.md) for what *should* stay human, and [Quality Gates](../../quality-gates/) for moving the mechanical checks left.

> **Key insight:** Every review comment that says "you forgot to X" where X is mechanically checkable is a *bug report against your CI*, not a success of your review. The senior reflex on seeing a recurring nit-or-bug class is not "remind reviewers to watch for it" but "why is a human watching for something a machine should refuse to merge?" Review is the scarcest quality resource you have; never spend it on work a sanitizer does for free and forever.

---

## Core Concept 11 — Diagnosing a Broken Review Culture

This is the staff-level synthesis: given a review culture that *feels* broken, read its **signals** to find the *systemic causes*, then apply interventions *in the right order*. Diagnosis precedes treatment, and the order matters because the cheap, high-trust fixes both deliver early wins and create the goodwill needed for the harder cultural work.

**Step 1 — Read the signals.** Each signal pattern points at a specific systemic cause:

| Signal you observe | Most likely root cause | Therefore fix |
|---|---|---|
| **High approval rate + very low TTFR** (everything approved, fast) | Rubber-stamping / theatre | Shrink PRs; re-attach metrics to find-rate |
| **Many nit comments, few design comments** | Bikeshedding / automation gap | Automate style; norm "style isn't a review topic" |
| **Approval latency uniform & uncorrelated with diff size** | Review theatre | Detect & kill theatre (Concept 5) |
| **One reviewer on the majority of PRs** | Bottleneck / knowledge hoarding | Load-balance; spread expertise; `CODEOWNERS` |
| **PRs sit for days untouched** | No SLA / unowned review work | Review SLA; WIP limits; schedule review |
| **Recurring escaped-defect class** | Review isn't built to catch it | Tool the check (Concept 10), don't "review harder" |
| **Long, churny threads; taste wars** | No norms / no severity labels | Severity labels; style guide as arbiter |
| **Authors defensive; reviewers prosecutorial** | Low psychological safety | Norms + leadership modeling (Concept 7) |
| **Anti-pattern everyone knows is bad but keeps doing** | A metric rewards it (Goodhart) | Change the scoreboard (Concept 9) |

The two most diagnostic composite signals: **high TTFR-speed + high approval rate = rubber-stamping/theatre** (fast and always-yes is the fingerprint of not-reading), and **lots of nits + few design comments = bikeshedding/automation gap** (human attention is stuck on the trivial because the trivial wasn't automated away).

**Step 2 — Intervene in this order.** The sequence is deliberate: cheapest, least-controversial, highest-trust-building first; the hard interpersonal work last, once the system has stopped *manufacturing* pathologies and you've banked credibility.

```
INTERVENTION ORDER (a broken-culture turnaround)

  1. AUTOMATE STYLE        formatter + linter, blocking in CI + pre-commit.
                           Kills bikeshedding overnight. Uncontroversial.
                           Frees human attention for what matters.        ← cheapest

  2. SHRINK PRs            size budget + stacking; split mechanical vs
                           semantic. Makes real review *possible*; ends
                           the rubber-stamp-by-necessity.

  3. FIX LOAD / SLA        round-robin assignment, WIP limits, first-
                           response SLA, schedule review as real work.
                           Ends ghosting and the single-reviewer bottleneck.

  4. SET NORMS / CALIBRATE severity labels (blocking/should/nit), style
                           guide as taste-arbiter, define "what approval
                           means," calibrate the bar across reviewers.
                           Ends preference-blocking & inconsistent bars.

  5. FIX METRICS           drop individual review targets; measure team
                           outcomes (escaped defects, find rate, latency
                           distribution). Removes the Goodhart incentives.

  6. ADDRESS CULTURE       psychological safety, leadership modeling,
                           attention-on-the-artifact. The residual ego /
                           status problems that no process removes.        ← hardest
```

Why this order and not the reverse? Two reasons. First, the early steps *remove the systemic causes that manufacture most of the visible anti-patterns* — once style is automated and PRs are small, bikeshedding and rubber-stamping largely evaporate without anyone changing their character, so you're not asking people to fight a system that's pushing them the other way. Second, steps 1–3 are **cheap, fast, and trust-building**: they make everyone's life *better* (faster reviews, less nitpicking, fewer ghosted PRs) and prove you're fixing the *system*, not blaming *them*. That earned credibility is exactly what you need to spend on the hard, slow, interpersonal work of steps 5–6. A senior who opens a turnaround by lecturing about psychological safety, while leaving 2,000-line PRs and a comment-count metric in place, will be (correctly) ignored — they're asking for virtue inside a system engineered for vice.

> **Key insight:** Diagnosing a broken review culture is reading symptoms back to systemic causes, then fixing the *cheapest, most-generative cause first*. Automate style before you talk about culture; shrink PRs before you blame reviewers for rubber-stamping; fix the metric before you scold the gaming. Lead with the system fixes that make people's lives better and require no behavior change — and spend the trust they earn on the cultural work that does. Culture work attempted first, on top of a pathology-manufacturing system, is wasted breath.

---

## Real-World Examples

**1. The nitpick storm that was an automation gap.** A team's PRs averaged 11 comments, ~9 of them style nits, and design discussion was nearly absent — and reviewers privately complained that "nobody catches real bugs." The lead resisted the urge to send a "focus on substance" memo. Instead: adopted an opinionated formatter and a strict linter, made both *blocking* in CI plus a pre-commit hook, and added one team rule — **style is not a review topic.** Within two sprints, style nits per PR went to ~zero (impossible to write — the diff arrives formatted), and design comments rose as freed attention found the real work. The "fix" was an `eslint`/`prettier` config, not a behavior lecture. The bikeshedding was a *symptom* of the automation boundary being in the wrong place.

**2. Detecting review theatre with one query.** A platform team's dashboard was perfect: 100% review coverage, median time-to-approve 4 minutes. A new staff engineer was suspicious — *too* smooth — and ran the diagnostic: plot time-to-approve against diff size. The scatter was a flat line; a 12-line fix and an 1,100-line refactor both took ~4 minutes. **Approval was uncorrelated with the artifact** — the fingerprint of theatre. Confirmed by a spot check: asking three approvers a specific question about what they'd approved, and getting blank looks. The cause was upstream — PRs were too large to actually review under deadline pressure, so reviewers had quietly converted to LGTM-on-sight. Fix followed the intervention order: shrink PRs first (making real review possible), then switch the tracked metric from approval-speed to find-rate and escaped-defects. Find rate climbed from ~2% to ~20% as review became real. The green dashboard had been *false assurance*; killing the theatre required removing the impossible load that made theatre rational.

**3. Normalization of deviance, billed in an outage.** A team "always fast-approved" infra/config PRs — "it's just YAML." This had drifted from an occasional shortcut into the default over a year; nobody decided it, it eroded one reasonable exception at a time. Then a one-line change to a health-check timeout took down a region — a change a careful reviewer would have questioned in seconds. The postmortem's real root cause was not the YAML; it was the *normalized deviation* that had quietly removed config changes from meaningful review. The durable fix was systemic: a config validator and policy-as-code check in CI (tool the category that drifted), plus a recurring retro question — *"what do we always fast-approve, and is that still safe?"* — to surface the next normalized deviation before it bills.

**4. The bottleneck that looked like a strength.** Every team member routed their PRs to one senior engineer — "she's the only one who really gets the codebase." Reviews were excellent and *slow*, she was burning out, and the bus factor was one. The lead reframed the "strength" as a *knowledge-hoarding* risk and a throughput ceiling. Fix: `CODEOWNERS` with multiple owners per area, round-robin assignment, and deliberately pairing junior reviewers *with* the senior on complex PRs to spread the expertise that made her valuable. Over a quarter the reviewer pool grew, TTFR dropped, and the senior got her maker-time back. The bottleneck was a load-and-knowledge-distribution problem wearing a "she's just the best" costume.

---

## Mental Models

- **Anti-patterns are equilibria, not failures of will.** People do the locally rational thing inside the rules you set. If they nitpick, you built a system where nitpicking is the easiest way to look engaged. Don't fix the person; change the payoff structure and the behavior follows.

- **Symptom → root cause → systemic fix.** Train yourself to never stop at the symptom. Bikeshedding → automation gap → adopt a formatter. Rubber-stamping → PRs too big → shrink and stack. Ghosting → no SLA/load-balancing → schedule and rotate review. The symptom is the *question*; the systemic cause is the *answer*.

- **Theatre is a control decoupled from its purpose.** Review theatre, security theatre, and an always-passing quality gate are the same failure: the output (green / approved) has separated from the purpose (catching defects). Detect it by asking "what would this look like if it caught nothing?" — and whether it looks exactly like that.

- **Cultures erode, they don't collapse.** Normalization of deviance is the slow migration of the bar, one reasonable-seeming exception at a time, until the exception is the rule. The escaped defect that "should obviously have been caught" is usually the bill for a long-normalized drift you stopped seeing.

- **Review is the scarcest quality resource — spend it only on judgment.** A machine should catch everything mechanically decidable; humans should catch design, intent, and tradeoffs. Every "you forgot to X" comment where X is checkable is a bug against your CI, not a win for your review.

- **Fix the cheapest generative cause first.** In a turnaround, automate style → shrink PRs → fix load → set norms → fix metrics → address culture. The early steps remove the *system* that manufactures pathologies and bank the trust you'll spend on the hard cultural work. Culture-first, on a broken system, is wasted breath.

---

## Common Mistakes

1. **Treating an anti-pattern as a behavior to scold instead of a system to fix.** "Stop nitpicking / read more carefully / be more responsive" addresses the symptom and lasts about a week. Find the generative cause (automation gap, PR size, load) and change *it*, so the anti-pattern stops being the path of least resistance.

2. **Demanding "review harder" to fix rubber-stamping.** Rubber-stamping is the inspection-rate cliff — a 2,000-line PR *cannot* be reviewed, only approved. Asking for more vigilance on an unreviewable diff just produces more elaborate theatre. Shrink the PR; that's upstream of the review.

3. **Trusting a green review dashboard.** 100% approval and 4-minute median approval are signals of *theatre*, not health. If time-to-approve is uniform and uncorrelated with diff size, approval has decoupled from the artifact and your dashboard is lying. Track find-rate and escaped-defects, not approval count or speed.

4. **Tying individual review metrics to evaluation.** The moment "comments per reviewer" or "review speed" enters a perf packet, you have *commissioned* nitpicking or rubber-stamping. Goodhart guarantees it. Measure team outcomes; never make individual review activity a target.

5. **Using human review to compensate for a missing automated check.** A recurring "you forgot to null-check / add a test / this can data-race" is a bug against your CI. Tool the check (linter, type, sanitizer, coverage gate) so it's caught every time, not just when the reviewer is sharp — and free human attention for design.

6. **Leading a turnaround with culture work.** Opening with "let's talk about psychological safety" while 2,000-line PRs and a comment-count metric remain is asking for virtue inside a system engineered for vice. Do the cheap, life-improving system fixes first (automate style, shrink PRs, fix load); spend the earned trust on culture last.

7. **Mistaking a single-reviewer bottleneck for a strength.** "She's the only one who really gets it" is knowledge hoarding, a throughput ceiling, a bus-factor-of-one, and a burnout machine. Spread the expertise (pairing, rotation, multi-owner `CODEOWNERS`); a bottleneck reviewer is a signal to *distribute* knowledge, not to celebrate concentration.

8. **Missing normalization of deviance because each instance is defensible.** No single fast-approval looks wrong; the *drift* across many is the pathology, and it's invisible at the granularity of one PR. Periodically ask "what do we always fast-approve, and is that still safe?" — and tool the categories that have silently drifted out of review.

---

## Test Yourself

1. State the root-cause model in one sentence, and explain why fixing the symptom (e.g., scolding nitpickers) doesn't last.
2. A team's review threads are full of style nits and almost no design comments. What is the systemic cause, and what is the fix — and why won't "please focus on substance" work?
3. Why is rubber-stamping better understood as a *physics/math* problem than a discipline problem? Name the specific mechanism and the upstream fix.
4. Review theatre is called "the most dangerous anti-pattern." Why is it more dangerous than having *no* review at all? Give the single most diagnostic statistical signal that detects it.
5. Explain normalization of deviance in a review context with the drift sequence, and give two systemic countermeasures (not "be more vigilant").
6. A reviewer leaves "you should null-check this" and is correct. Why might this *still* indicate a systemic anti-pattern, and what's the real fix?
7. You're handed a broken review culture. List the six interventions *in order*, and justify why this order and not the reverse.
8. A team has a review anti-pattern everyone agrees is bad but keeps doing. What's the *first* thing a senior should look for, and why?

<details>
<summary>Answers</summary>

1. **Anti-patterns are symptoms of systemic causes; the senior fixes the system, not the symptom.** Symptom-level fixes (scolding) fight human nature with willpower and don't change the payoff structure, so the behavior reverts the moment attention lapses — people return to the locally rational action the unchanged system still rewards. Fixing the generative cause (e.g., automating style) makes the anti-pattern *impossible* or *no longer the easy path*, which lasts.

2. Systemic cause: **the automation boundary is in the wrong place** — style decisions that a tool should settle are leaking into human attention (Parkinson's law of triviality: people argue the trivial because they *can*). Fix: adopt an opinionated formatter + linter, make them *blocking* in CI and a pre-commit hook, and adopt the norm "style is not a review topic." "Please focus on substance" fails because it asks for willpower against human nature; removing style from the contested zone (a machine now owns it) makes bikeshedding *impossible* rather than merely discouraged.

3. Defect-detection effectiveness collapses above an **inspection rate of ~400–500 LOC/hr** (SmartBear/Fagan data). A large PR makes meaningful review take more focused hours than anyone has, so the reviewer rationally skims and approves — rubber-stamping is the *system's* output for an impossible inspection load, not a character flaw. Upstream fix: **shrink PRs (size budgets, stacking, split mechanical from semantic)** so careful review fits the time available. Large PRs *prevent* review; small PRs *enable* it.

4. A team with no review *knows* it's unprotected; review theatre produces **false assurance** — the team believes it's protected (green dashboard, box checked) and therefore stops investing in the tests/types/sanitizers/monitoring that real review would have flagged as needed. The most diagnostic signal: **approval time/comment-count is uncorrelated with diff size and risk** — a 12-line fix and an 1,100-line refactor get identical ~30-second LGTMs. Genuine review correlates with the artifact; theatre's approval is a constant function of the diff.

5. Normalization of deviance: a deviation from the standard, repeatedly tolerated without consequence, silently *becomes* the standard. Drift: "we carefully review config" → "this one's trivial, LGTM" → "config is usually fine, quick-approve" → "we don't really review config" → outage. No one *decided* to stop; it eroded one reasonable exception at a time. Countermeasures: (a) **name the deviation explicitly** when spotted ("we've quietly stopped reviewing migrations — that's a drift, and migrations are high-blast-radius"); (b) **tool the drifted category** so CI enforces the bar humans let slip (config validator, dependency-policy bot); (c) the recurring retro question "what do we always fast-approve, and is it still safe?"

6. The comment is correct, but if the issue is *mechanically decidable and recurring*, relying on a human to catch it every time is fragile — review caught it this time and will miss it when the reviewer is tired. Real fix: **tool the check** (a type system, linter/errcheck rule, or sanitizer) so it's caught deterministically on every PR forever, freeing scarce human review attention for the design/intent judgment only humans can make. A recurring "you forgot to X" is a bug report against your CI.

7. Order: **(1) automate style → (2) shrink PRs → (3) fix load/SLA → (4) set norms/calibrate → (5) fix metrics → (6) address culture.** This order, not the reverse, because (a) the early steps *remove the systemic causes that manufacture most visible anti-patterns* — automate style and shrink PRs and bikeshedding/rubber-stamping largely vanish without anyone changing character; and (b) steps 1–3 are cheap, fast, and *trust-building* — they make everyone's life better and prove you're fixing the system, not blaming people, which earns the credibility you must spend on the hard, slow cultural work (5–6). Culture-first, atop a pathology-manufacturing system, is ignored.

8. Look first for **the metric that rewards the anti-pattern** (Goodhart). An anti-pattern everyone knows is bad but keeps doing is almost always *rational given the scoreboard*: nitpicking under a comment-count metric, rubber-stamping under a speed metric, theatre under an approval-rate metric. The behavior follows the incentive, so the fix is to change the scoreboard (drop the individual target; measure team outcomes), not to lecture the players.

</details>

---

## Cheat Sheet

```
ROOT-CAUSE MODEL (symptom → cause → fix)
  bikeshedding / nitpick storm   → style not automated   → formatter+linter own style
  rubber-stamping / fatigue      → PRs too big           → small PRs + stacking
  ghosting / bottleneck          → overload / no SLA     → load-balance, WIP cap, SLA
  preference-blocking / taste war→ no norms/calibration  → severity labels + style guide
  gaming (nitpick/rubber-stamp)  → bad individual metric → team outcomes, not targets
  ego / gatekeeping / adversarial→ low psych safety      → norms + leadership modeling
  reviewer doing a robot's job   → missing tool/test     → move check left into CI

REVIEW THEATRE — DETECT
  approval latency uniform + short      (real review = high variance)
  near-zero find rate / ~100% approved  (real review = some change-requests)
  comments cosmetic or "LGTM" only      (no engagement with logic)
  approval UNCORRELATED with diff size  ← the killer signal
  "who actually read this?" test fails
  KILL: make review possible (small PRs) → metric=find-rate → approval means
        "I read it & stand behind it" → if it can't catch X, tool X

NORMALIZATION OF DEVIANCE
  shortcut once → no harm → again → "we always fast-approve X" → bad X ships
  watch: config/infra, dep bumps, "trivial" one-liners, trusted authors
  fix: name the drift; tool the drifted category; retro "what do we always LGTM?"

INSPECTION-RATE CLIFF
  defect detection collapses above ~400-500 LOC/hr; sessions > ~60 min
  => a huge PR cannot be reviewed, only approved => shrink upstream

WHEN REVIEW IS THE WRONG TOOL
  mechanically decidable + recurring  → tool it (linter/type/sanitizer/test/coverage)
  human review is for: design, intent, abstraction soundness, tradeoffs

TURNAROUND ORDER (cheap+trust-building → hard)
  1 automate style  2 shrink PRs  3 fix load/SLA
  4 set norms/calibrate  5 fix metrics  6 address culture

DIAGNOSE FROM SIGNALS
  high approval + low TTFR        = rubber-stamping / theatre
  many nits + few design comments = bikeshedding / automation gap
  one reviewer on everything      = bottleneck / knowledge hoarding
  recurring escaped-defect class  = review can't catch it → tool it
  bad-but-persistent behavior     = a metric rewards it (Goodhart)
```

---

## Summary

- **Anti-patterns are symptoms; the senior fixes the system that produces them.** Almost every review pathology traces to a small set of systemic causes — style not automated, PRs too big, reviewers overloaded with no SLA, no norms/calibration, bad individual metrics, low psychological safety, and review used to paper over missing tooling. The cheat-sheet table maps symptom → cause → fix; internalize it and you stop treating symptoms.
- **Bikeshedding is an automation gap, rubber-stamping is the inspection-rate cliff, ghosting is a load problem.** None are character flaws — they are the equilibrium behavior of the system as configured. Automate style (formatters as the taste-arbiter), shrink PRs so careful review is *possible*, and schedule/rotate/SLA review as first-class work.
- **Review theatre is the most dangerous anti-pattern because it produces false assurance.** A control whose output (green/approved) has decoupled from its purpose (catching defects) is worse than no control. Detect it by its fingerprint — uniform fast approvals, near-zero find rate, and approval *uncorrelated with diff size* — and kill it by making real review possible, re-attaching the metric to find-rate, and restoring that approval *means* "I read this and stand behind it."
- **Cultures erode by normalization of deviance.** The bar drifts one reasonable-seeming exception at a time until the exception is the rule; the escaped defect that "should obviously have been caught" is the bill. Name the drift, tool the drifted categories, and ask in retros what you always fast-approve.
- **Power and author-side pathologies need different fixes.** Severity labels and a shared style guide strip the gatekeeper's weapon; an explicit definition of "what approval means" ends the endorsement-vs-good-enough confusion; the fait accompli is defeated upstream by design review and small stacked PRs, never by caving at the PR. The residual ego problems yield only to leadership modeling.
- **Bad metrics manufacture anti-patterns (Goodhart); review is the wrong tool for mechanically-checkable work.** Never tie individual review metrics to evaluation; measure team outcomes. And when a reviewer is manually catching a recurring, decidable issue, tool the check — don't spend scarce human judgment on a robot's job.
- **Diagnose from signals, then intervene in order:** automate style → shrink PRs → fix load/SLA → set norms/calibrate → fix metrics → address culture. Lead with the cheap, life-improving system fixes that require no behavior change; spend the trust they earn on the hard cultural work last.

You now reason about review pathologies as outputs of a sociotechnical system you can diagnose and re-engineer. The next layer — [professional.md](professional.md) — is about driving these turnarounds across an organization: winning the mandate, sequencing the rollout, and sustaining a healthy review culture against the constant pressure that pulls it back toward theatre.

---

## Further Reading

- *Software Engineering at Google* — Chapter 9, "Code Review." The canonical treatment of review at scale, including how Google's process *structurally* avoids many of these anti-patterns (small CLs, readability, LGTM vs approval distinction).
- Google Engineering Practices — *Code Review Developer Guide* ([the CL author's guide and the reviewer's guide](https://google.github.io/eng-practices/review/)). Concrete norms that operationalize "attention on the artifact" and the severity of comments.
- Diane Vaughan, *The Challenger Launch Decision* — the origin of **normalization of deviance**; the definitive study of how a standard erodes one tolerated exception at a time.
- C. Northcote Parkinson, "High Finance, or the Point of Vanishing Interest" (*Parkinson's Law*, 1957) — the **law of triviality** (the bike-shed), the root explanation of bikeshedding.
- SmartBear, *Best Kept Secrets of Peer Code Review* — the Cisco study behind the **inspection-rate cliff** (~400–500 LOC/hr; ~60-minute session limit).
- Charles Goodhart's law and Marilyn Strathern's formulation ("when a measure becomes a target…") — the basis for why individual review metrics get gamed into anti-patterns.
- Pointer onward: [professional.md](professional.md) — operating these turnarounds at organizational scale.

---

## Related Topics

- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/senior.md) — severity labels, calibration, and the norms that defuse preference-blocking and ego comments.
- [02 — PR Scope & Size](../02-pr-scope-and-size/senior.md) — small PRs and stacking, the upstream fix for rubber-stamping and the fait accompli.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md) — SLAs, load-balancing, and the Goodhart-aware metrics that fix ghosting without manufacturing new anti-patterns.
- [Static Analysis & Linting](../../static-analysis/) — making formatters and linters the taste-arbiter so style stops being a review topic.
- [Quality Gates](../../quality-gates/) — moving mechanical checks left into CI, and the parallel of gate theatre to review theatre.
