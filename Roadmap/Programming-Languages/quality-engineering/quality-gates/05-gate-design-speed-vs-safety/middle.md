# Gate Design: Speed vs Safety — Middle Level

> **Roadmap:** [Quality Gates](../README.md) → Gate Design: Speed vs Safety
> *The junior page argued that speed and safety are not opposites — that a slow, noisy gate makes you neither fast nor safe. This page turns that argument into engineering: place each gate at the cheapest stage that can catch its defect class, give every gate an owner and a measured cost, instrument it like a test you can fire, and delete the ones that stopped paying. The unit of design here is not "the pipeline" — it is one gate, treated as a first-class object you can defend in a review.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Feedback-Cost Gradient and Gate Placement](#core-concept-1--the-feedback-cost-gradient-and-gate-placement)
5. [Core Concept 2 — Shift-Left, Shift-Right, and Defense in Depth](#core-concept-2--shift-left-shift-right-and-defense-in-depth)
6. [Core Concept 3 — A Gate Is a First-Class Object](#core-concept-3--a-gate-is-a-first-class-object)
7. [Core Concept 4 — Gate Telemetry: Instrument Every Gate](#core-concept-4--gate-telemetry-instrument-every-gate)
8. [Core Concept 5 — The Trust Loop](#core-concept-5--the-trust-loop)
9. [Core Concept 6 — The DORA Tension: Fewer, Smarter Gates](#core-concept-6--the-dora-tension-fewer-smarter-gates)
10. [Core Concept 7 — Risk-Based Gating](#core-concept-7--risk-based-gating)
11. [Core Concept 8 — Removing a Gate: The Sunset Policy](#core-concept-8--removing-a-gate-the-sunset-policy)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Where does each gate belong, what does it cost, and how do I prove it still earns its place?**

At the junior level the trade-off is a slogan: a gate that is slow or flaky buys you neither speed nor safety. Correct — but a slogan does not tell you *where* to put the secret-scanner, *whether* the same lint rule belongs in three places, or *how* to win the argument when someone insists every check must be required. To design gates you need three things the slogan skips: a model of **cost**, a way to **measure** each gate, and a policy for **deleting** the ones that fail the measurement.

This page supplies all three. First, the **feedback-cost gradient**: the same defect costs roughly an order of magnitude more to catch at each later stage — editor, pre-commit, PR CI, merge queue, staging, canary, production — so the design question for any check is "what is the earliest stage that can catch this class of defect?" Second, treat each gate as a **first-class object** with an owner, a documented signal, a measured cost in cycle time, and a bypass path; gates without owners decay into theatre. Third, **instrument** every gate — fire rate, true-positive vs false-positive rate, added wall-clock — so you can run the killer review: *"this gate hasn't caught a real defect in six months and costs eight minutes a PR."* Underneath all of it sits the **trust loop**: a noisy gate teaches people to route around red, and a gate people route around is worse than no gate at all. The goal is not maximum gating. The DORA evidence is blunt about this — elite teams do not have *more* gates; they have *fewer, smarter* ones plus fast feedback and progressive delivery.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain why a slow or flaky gate fails to deliver either speed or safety.
- **Required:** You can read a CI pipeline and identify its stages, and you've configured at least one [required CI check](../01-required-ci-checks/middle.md).
- **Helpful:** You've felt the cost of a gate first-hand — waited on a 20-minute required check, or blind-retried a flaky one to get a green build.
- **Helpful:** A rough sense of the [DORA four keys](../../engineering-metrics-and-dora/) (deployment frequency, lead time, change failure rate, time to restore).

---

## Glossary

| Term | Meaning |
|---|---|
| **Gate** | An automated or manual check that can block a change from advancing to the next stage. |
| **Feedback-cost gradient** | The empirical rule that the cost to catch a given defect rises ~10× at each later pipeline stage. |
| **Shift-left** | Moving a check earlier (cheaper, faster feedback) so defects are caught before they propagate. |
| **Shift-right** | Catching in production what you cannot feasibly pre-test, via observability, canaries, and feature flags. |
| **Defense in depth** | Layered gates where each layer catches a *different* defect class. |
| **Redundant gate** | The *same* check run at multiple stages — duplicate cost, no new signal. |
| **Fire rate** | How often a gate blocks a change (fails) per N runs. |
| **True positive (TP)** | A gate failure that corresponds to a real defect the gate was meant to catch. |
| **False positive (FP)** | A gate failure with no underlying defect (flake, env issue, stale rule). |
| **Trust loop** | The feedback cycle in which gate reliability drives whether people believe and respect red. |
| **Blast radius** | How much damage a change can do if it is wrong (and how reversible it is). |
| **Risk-based gating** | Matching the weight of the gate set to the risk tier of the change. |
| **Sunset policy** | A documented rule for deleting a gate that no longer pays for its cost. |

---

## Core Concept 1 — The Feedback-Cost Gradient and Gate Placement

A pipeline is a sequence of stages a change passes through, each able to host gates. The single most useful fact about it is that **the same defect gets more expensive to catch at every later stage**. A typo caught by your editor costs seconds. The same typo caught in production costs an incident, a rollback, and a postmortem. The classic estimate — and it is an estimate, not a law of physics — is that each stage is roughly an order of magnitude more expensive than the one before. This is the *cost of delay of feedback*, and it is the gradient every placement decision should be read against.

| Stage | Who/what acts | Feedback latency | Relative cost to catch | Catches well |
|---|---|---|---|---|
| **Editor / IDE** | LSP, linter, type-checker | milliseconds | 1× | Syntax, types, obvious lint, formatting |
| **Pre-commit hook** | local `pre-commit` | seconds | ~3× | Formatting, secret scan, fast lint, no-`debugger` |
| **PR CI** | build, unit, integration, SAST | minutes | ~10× | Logic bugs, contract breaks, broken build |
| **Merge queue** | re-test against latest `main` | minutes (queued) | ~20× | Semantic merge conflicts, interaction with concurrent merges |
| **Staging / soak** | e2e, soak, load | minutes–hours | ~50× | Integration drift, resource leaks, config errors |
| **Canary** | small % real traffic + SLO check | minutes–hours | ~100× | Real-traffic regressions, performance cliffs |
| **Prod monitoring** | alerts, error budgets | seconds–days | ~1000× | Everything that slipped every earlier net |

The design rule that falls out of this table is simple to state and surprisingly often violated: **place each check at the earliest stage that can reliably catch its defect class.** A formatting rule belongs in the editor and pre-commit, not as a 4-minute required CI job. A schema-compatibility check needs the real database, so it belongs in CI or staging, not pre-commit. A latency regression that only appears under real traffic *cannot* be caught before canary — no amount of shifting left will surface it.

> **Key insight:** The gradient is a placement function, not a "push everything left" mandate. Each defect class has an *earliest stage that can actually catch it*. Putting a check earlier than that stage produces false confidence (it can't really catch the thing); putting it later than that stage burns ~10× the cost per defect. The art is matching each gate to its cheapest *capable* stage.

---

## Core Concept 2 — Shift-Left, Shift-Right, and Defense in Depth

"Shift-left" is the gradient read in one direction: move a check earlier and the same defect gets cheaper and faster to fix. A type error caught by the IDE never reaches CI; a secret caught by a pre-commit hook never reaches the remote at all (and so never needs rotating). This is the highest-leverage move in gate design, because it attacks cost at the root.

But not every defect *can* shift left. A memory leak that only manifests after six hours of production traffic, a performance regression that depends on real cache-hit ratios, a third-party API that changed its behaviour overnight — none of these are visible to any pre-merge gate. **Shift-right** is the complement: accept that some defect classes are only catchable in production, and invest in the machinery to catch them *there* fast and safely — canaries, feature flags, automated rollback, SLO-based error budgets, good observability. Shift-right is not "test in prod and hope"; it is *gating the blast radius* so a defect that escapes earlier nets affects 1% of traffic for four minutes instead of 100% for an hour.

Together these give **defense in depth**: layered gates where each layer catches a *different* class of defect. The IDE catches types, pre-commit catches secrets, CI catches logic, the canary catches real-traffic regressions. The layers are complementary — each is the last line of defense for *its* class.

The failure mode that masquerades as defense in depth is the **redundant gate**: the *same* check run at three stages. Running the identical lint rule in pre-commit, in PR CI, and again in the merge queue does not triple your safety — pre-commit already guarantees the rule passed. The second and third runs add latency and queue time and catch nothing the first did not. Redundancy is sometimes deliberate (a pre-commit hook can be skipped with `--no-verify`, so CI re-checks the *security-critical* subset as an enforcement backstop) — but that is a *conscious* backstop for a bypassable layer, not "more is safer."

| Pattern | What it looks like | Verdict |
|---|---|---|
| **Defense in depth** | IDE: types · pre-commit: secrets · CI: tests · canary: SLO | Each layer catches a different class — keep |
| **Enforcement backstop** | pre-commit lints (skippable); CI re-runs *security* lints only | Deliberate re-check of a bypassable layer — keep, scope it tight |
| **Redundant gate** | identical full lint suite in pre-commit, CI, *and* merge queue | Same check, no new signal — collapse to one authoritative run |

> **Key insight:** Defense in depth is "many nets, each a different mesh." Redundant gating is "the same net hung three times." The test is mechanical: if removing a layer changes *which class of defect can slip through*, it is depth; if it only changes *how many times the same defect is caught*, it is redundancy — and redundancy is pure cost.

---

## Core Concept 3 — A Gate Is a First-Class Object

The reason most pipelines are slow and untrustworthy is that gates accrete anonymously. A bug shipped, so someone added a check; they moved teams; the check stayed. Nobody can say what it catches, what it costs, or who would notice if it were deleted. The cure is to treat **each gate as a first-class object** with the same four properties you would demand of any production service:

- **Owner** — a named team or person accountable for the gate. Not "DevOps" or "the platform" — a specific owner who gets paged when the gate is wrong and who has the authority to tune or delete it. *A gate without an owner cannot be maintained, and an unmaintained gate decays into theatre.*
- **Documented purpose / signal** — one sentence: *what class of defect does this gate catch, and what is the signal that it fired correctly?* If the owner cannot write that sentence, the gate is already suspect.
- **Measured cost** — the added cycle time the gate imposes: wall-clock to run, plus queue time, plus the human cost of investigating its failures. Cost is not optional metadata; it is half of the speed/safety equation. A gate whose cost is unmeasured is a gate whose value cannot be judged.
- **Bypass path** — a documented, audited way to advance *despite* the gate, for the cases the gate's designer did not foresee (a one-character hotfix during an incident). A gate with no defined bypass will be bypassed anyway — via admin-merge or by disabling it — just without a record. ([Break-glass & Bypass](../07-break-glass-and-bypass/middle.md) covers doing this safely.)

In practice this lives as a **gate inventory** — a checked-in registry, one row per gate, that any engineer can read and any reviewer can challenge:

```yaml
# gates.yaml — every gate is a row you can defend in review
- id: secret-scan
  owner: security-team
  stage: pre-commit + ci
  catches: "credentials/keys committed to the repo"
  cost_p50: "4s local, 35s CI"
  bypass: "none — security-critical, no break-glass"
  required: true

- id: unit-tests
  owner: each-service-team
  stage: pr-ci
  catches: "logic regressions in changed code"
  cost_p50: "3m20s"
  bypass: "break-glass label + retroactive review (incident only)"
  required: true

- id: license-header-check
  owner: "??? (left when alice transferred)"
  stage: pr-ci
  catches: "missing SPDX header"
  cost_p50: "1m10s"
  bypass: "people just edit the file and re-push"
  required: true   # <-- ownerless + cheap-to-fake = sunset candidate
```

> **Key insight:** A gate you cannot describe in four fields — owner, signal, cost, bypass — is not a quality control; it is a fossil. The discipline of writing the row *is* the design review: the license-header check above outs itself the moment you try to fill in its owner. You cannot defend at 3 a.m. a gate nobody owns.

---

## Core Concept 4 — Gate Telemetry: Instrument Every Gate

A gate is a hypothesis: *"changes that fail this check are likely to be defective."* Like any hypothesis, it should be tested against data, not asserted forever. So **instrument every gate** the way you would instrument a test suite or an A/B experiment, and capture four numbers:

1. **Fire rate** — how often the gate blocks (fails) per N runs. The shape of the distribution matters: a gate that *never* fires and one that fires *constantly* are both pathological, for opposite reasons (below).
2. **True-positive rate** — of the failures, how many corresponded to a *real* defect the gate was meant to catch. This is the gate's actual yield.
3. **False-positive rate** — of the failures, how many were noise: flakes, environment issues, stale rules, retried-to-green. This is what erodes trust.
4. **Time cost** — added wall-clock per run *plus* queue time *plus* the human minutes spent investigating failures. The full cost, not just the CPU time.

Two failure shapes fall straight out of these numbers:

- **A gate that never fires is suspect.** If a required check has not blocked a single change in six months, either the defect it guards against never occurs (delete the gate, or demote it to advisory) or — worse — the gate is *misconfigured and silently passing everything*. A green light that is physically incapable of turning red is not safety; it is decoration with a latency cost. Verify it can actually fail.
- **A gate that fires constantly without catching real bugs is a false-positive machine.** High fire rate, low true-positive rate is the signature of a flaky test, an over-strict threshold, or a rule that no longer matches reality. Every one of those failures spends human attention and, far more dangerously, teaches people that red means nothing (Core Concept 5).

The payoff is the review you can now run with numbers instead of opinions:

| Gate | Owner | Catches | Cost / PR | Fire rate | TP rate | Verdict |
|---|---|---|---|---|---|---|
| `secret-scan` | security | leaked creds | 35s | 0.3% | ~100% | **Keep** — rare, but every fire is a real incident averted |
| `unit-tests` | service team | logic regressions | 3m20s | 9% | 82% | **Keep** — high yield, cost proportionate |
| `e2e-full-suite` | qa | integration breaks | 18m | 14% | 11% | **Investigate** — mostly flaky; the 18m is the trust killer |
| `bundle-size-check` | web-platform | perf regressions | 40s | 2% | 70% | **Keep, demote to advisory** below hard cap |
| `license-header` | (none) | missing header | 70s | 0.1% | ~100% | **Sunset** — trivially auto-fixable; pre-commit owns it |
| `flaky-ui-snapshot` | (none) | pixel diffs | 6m | 22% | 4% | **Delete** — 96% noise, no owner, trains blind-retry |

> **Key insight:** Once a gate emits telemetry, the speed/safety argument stops being a fight about feelings and becomes a calculation. *"This gate costs 18 minutes per PR, fires on 14% of changes, and 89% of those fires are flakes"* is a sentence that ends a debate. The gates that survive a numbers-based review are, almost without exception, the ones the junior page promised: few, fast, and high-signal.

---

## Core Concept 5 — The Trust Loop

Everything above protects one fragile asset: **the team's belief that red means stop.** That belief is the entire mechanism by which a gate works — a gate has no power to physically prevent a deploy, only the power to make a red signal that people *respect*. The moment they stop respecting it, the gate is inert, and the way they stop is a self-reinforcing loop:

```
flaky / noisy / pointless gate
        │
        ▼
red stops correlating with "real problem"
        │
        ▼
people learn red is noise  →  blind-retry, admin-merge, disable the check
        │
        ▼
the gate now blocks nothing it was meant to block
        │
        ▼   (and the next real defect sails straight through)
the gate is WORSE than nothing
```

It is worse than nothing for a specific, non-obvious reason: an *absent* gate leaves people alert — they know the check isn't there, so they look manually. A *distrusted* gate creates false security: the green light is still on the dashboard, the audit still records "checks passed," but the behaviour it was supposed to enforce has been quietly routed around. You are paying the gate's full cost *and* getting none of its protection *and* you have lied to your future self about coverage.

The routing-around takes recognisable forms, and each is a symptom worth alarming on:

- **Blind retry** — re-running a failed check until it goes green, with no investigation. The tell that a gate has become a coin-flip.
- **Admin-merge** — using elevated privilege to merge past a red required check. ([Break-glass & Bypass](../07-break-glass-and-bypass/middle.md) is about making this *legitimate and logged* instead of a back door.)
- **Quietly disabling** — commenting out the check, marking it `continue-on-error`, or moving it from required to advisory without a decision record.

Because trust is the load-bearing asset, **protecting gate trust is a first-order design goal**, often *above* adding coverage. Concretely: quarantine flaky gates the instant they're detected rather than letting them erode belief; never make a gate required until its false-positive rate is low enough that a red genuinely means stop; and treat every blind-retry and admin-merge as a signal that some gate has lost the team's trust and needs fixing or deleting.

> **Key insight:** A gate's real strength is not its enforcement power — it is the team's belief that red means stop. That belief is a shared, depletable resource: every false positive spends a little, and once it's gone people route around *every* gate, not just the flaky one. Protecting trust beats adding a gate; a distrusted gate is the only kind that is strictly worse than no gate at all.

---

## Core Concept 6 — The DORA Tension: Fewer, Smarter Gates

The intuition that more gates make you safer is one of the most expensive mistakes in this field, and the DORA research (*Accelerate*, Forsgren/Humble/Kim) is direct about it: **gating is not linearly safer.** The high-performing organisations in that dataset deploy more frequently *and* have a lower change-failure rate — they are faster *and* safer at the same time. They do not achieve this with more approval gates and heavier process. The single sharpest finding in the book is that **heavyweight change-approval processes (external approval boards, manual sign-off on every change) correlate with *worse* stability, not better** — they slow you down without reducing failures.

What elite performers have instead is a different *kind* of gate stack:

- **Fewer, smarter gates** — a small number of high-signal automated checks, not a long required-checks list assembled by accretion.
- **Fast feedback** — gates that return in minutes, so the cost-of-delay gradient stays cheap and people stay in flow.
- **Strong automated testing** — trustworthy tests as the primary safety mechanism, which is what *lets* them keep the gate list short.
- **Progressive delivery** — canaries, feature flags, and fast rollback (the shift-right layer) so the cost of a defect that escapes is small and recoverable, which removes the *need* for a heavyweight pre-merge gauntlet.

The mechanism is a virtuous loop that mirrors the trust loop in reverse: trustworthy tests + fast feedback → confidence to deploy small changes often → smaller blast radius per change → less need for heavy gates → faster feedback still. Adding gates without that foundation is *surrogation* — optimising the proxy ("number of checks") instead of the goal (shipping working software safely). The [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) roadmap covers this evidence and the Goodhart trap underneath it.

> **Key insight:** "How many gates should we have?" is the wrong question, and the DORA data proves it: elite teams have *fewer*, and a heavyweight approval process measurably *worsens* stability. Safety comes from fast feedback, trustworthy tests, and progressive delivery — not from a longer list of required checks. Every gate you add to compensate for weak tests is a tax you will pay on every change, forever, in exchange for confidence you should have built into the test suite.

---

## Core Concept 7 — Risk-Based Gating

A README typo, a feature-flag flip, and a database schema migration are not the same kind of change, yet most pipelines subject all three to the identical gate set. That is wrong in both directions: it over-gates the typo (wasting time and trust on a change that cannot break anything) and frequently *under*-gates the migration (a forward-only schema change with no rollback deserves checks the typo never needed). The fix is **risk-based gating**: match the *weight* of the gate set to the *risk* of the change, where risk is read off two axes — **blast radius** (how much breaks if this is wrong) and **reversibility** (how fast and cheaply you can undo it).

A practical scheme tiers changes and maps each tier to a gate set:

| Risk tier | Example changes | Blast radius / reversibility | Gate set |
|---|---|---|---|
| **Standard** | docs, comments, test-only, copy edits, behind-flag UI tweak | tiny / trivially reversible | Build + lint; auto-merge on green; no human approval |
| **Normal** | typical feature/bug fix in one service | bounded / revert-by-PR | Full CI (unit + integration + SAST) + 1 review + merge queue |
| **High-risk** | schema migration, auth/payment path, infra/IaC, public API contract, dependency major-bump | large or hard to reverse | All of Normal + extra review (CODEOWNERS) + staging soak + canary + manual deploy approval |

The deliberate asymmetry is the point. The standard tier is *fast on purpose* — gating a docs change behind a 20-minute e2e suite is the textbook way to teach people that gates are obstacles, and it spends trust and time on a change with zero blast radius. The high-risk tier is *heavy on purpose* — an irreversible migration is exactly where the cost-of-delay gradient is steepest, so extra gates there are cheap insurance. Tiering can be driven by labels, changed-paths (a touch to `db/migrations/**` or `terraform/**` auto-escalates the tier), or an explicit field on the PR — and the policy itself should be codified and reviewable ([Policy as Code](../06-policy-as-code/middle.md)) rather than living in tribal knowledge.

> **Key insight:** A uniform gate set is a design *failure*, not a default — it treats a docs typo and an irreversible migration as the same risk. Gate by blast radius and reversibility: make the cheap, reversible change *fast* and the expensive, irreversible one *careful*. Spending your safety budget where there is no blast radius leaves none for where there is.

---

## Core Concept 8 — Removing a Gate: The Sunset Policy

Gates are easy to add (someone got burned) and culturally hard to remove (deleting one feels like inviting the bug back). The result, with no countervailing force, is monotonic accretion: the pipeline only ever gets slower. A mature gate practice therefore needs an explicit, *unembarrassing* path to delete a gate that no longer pays — a **sunset policy**.

The trigger is the telemetry from Core Concept 4. A gate becomes a sunset candidate when it has, over a defined window (say six months):

- caught **zero** real defects (TP rate ≈ 0), *and*
- imposed a **non-trivial** cost (meaningful wall-clock or queue time, or a steady stream of false-positive investigations), *and*
- no owner who can articulate a forward-looking reason it must stay (a compliance mandate is a valid reason; "we've always had it" is not).

When you suspect a gate is dead weight but cannot prove it, **A/B the gate's value** rather than arguing: demote it from required to advisory for a few weeks and watch whether the defect it supposedly catches starts slipping through. If escaped-defect rate is unchanged, the gate was catching nothing — delete it. If escapes rise, you have *proof* the gate earns its place, and you can defend it with data. This is the same evidence-based discipline you apply to a [coverage threshold](../03-coverage-and-quality-thresholds/middle.md): base the decision on what the numbers actually show, not on the fear of removing it.

> **Key insight:** A gate practice without a deletion path can only grow, and a pipeline that only grows only gets slower. The courage to delete a gate that doesn't pay is as much a part of gate design as the discipline to add one — and "demote to advisory and measure the escape rate" turns that courage into an experiment with an answer instead of a gamble.

---

## Real-World Examples

**1. The 22-minute required suite nobody trusts.** A team's required PR check is an 18-minute e2e suite that fails on ~14% of runs; investigation shows 89% of failures are flakes. Engineers blind-retry until green — average 2.3 runs per merge. The "gate" is functionally a 40-minute coin-flip that catches almost nothing (11% TP rate). The fix is not to make the suite faster; it is to *quarantine the flaky tests*, demote the e2e suite to advisory, and gate on a fast, deterministic subset. Trust recovers because red starts meaning stop again — and lead time drops by the time previously spent on retries.

**2. The schema migration that needed more, not fewer, gates.** A "Normal"-tier process let a forward-only `ALTER TABLE` ship through standard CI and one review. It locked a hot table for 40 seconds in production. Standard gates were *blind to this entire class*: there is no unit test for "this DDL holds a lock under production load." Risk-based gating is the answer — a changed-path rule auto-escalates anything touching `db/migrations/**` to the high-risk tier (expand-contract review, staging soak, off-peak deploy window). The gate set matched the blast radius only after the incident forced the question.

**3. The license-header check that outed itself.** During a gate-inventory exercise, the team tried to fill in the owner for a required `license-header` check. Nobody owned it — its author had transferred a year earlier. Telemetry: 0.1% fire rate, every fire trivially fixed by editing one line and re-pushing (so it caught nothing a developer couldn't fake in ten seconds), 70s cost per PR. It was a sunset candidate on every axis: ownerless, near-zero yield, easily satisfied without addressing any real concern. They moved the check to a pre-commit auto-fix and deleted the required CI job. No defect followed.

**4. Elite team, short required list.** A high-DORA organisation's required-checks list is four items: build, unit tests, secret scan, and a fast SAST pass — all returning in under five minutes combined. The heavy work happens *after* merge: every change goes out behind a feature flag to a 1% canary watched against SLOs, with automated rollback. They are faster (deploy dozens of times a day) *and* safer (low change-failure rate) than a comparable org with a fifteen-item required gauntlet and a weekly release train — a direct illustration that gating is not linearly safer.

---

## Mental Models

- **The cost-of-delay gradient is a staircase, not a slope.** Each stage down the pipeline is roughly a 10× step up in the cost to catch the same defect. Gate placement is choosing the cheapest *step* that can actually see the defect — not the earliest possible step, the cheapest *capable* one.

- **A gate is a hypothesis under test, not a permanent fixture.** It claims "failures here predict defects." Telemetry is how you check the claim. A gate that never fails and a gate that always fails are both falsified hypotheses — one predicts nothing, the other predicts noise.

- **Trust is a depletable shared resource.** Every false positive withdraws from a common account. When the balance hits zero, people route around *all* gates, not just the noisy one. You can run out of trust far faster than you can rebuild it.

- **Defense in depth is many meshes; redundancy is one net hung twice.** If removing a layer changes *which class* of defect can pass, it's depth. If it only changes *how many times* the same defect is caught, it's cost.

- **More gates is a tax, not insurance.** Each gate you add to compensate for weak tests is paid on *every* change forever, in exchange for confidence you should have built into the test suite or the canary. Elite teams gate *less* and lean on fast feedback and progressive delivery.

---

## Common Mistakes

1. **"Every check required."** Making every check a hard blocker treats all signals as equally trustworthy and all changes as equally risky. The fast, high-signal checks get drowned in slow, flaky ones, and the whole list becomes something to route around. Required status is a privilege a gate *earns* by proving a low false-positive rate.

2. **Approval theatre.** A required human sign-off that adds latency without adding judgement — an approver who rubber-stamps because they have no context to do otherwise. DORA shows heavyweight approval *worsens* stability. If an approval isn't applying real judgement, automate the underlying check or delete the step.

3. **Pushing a check earlier than the stage that can catch its class.** A performance regression that only shows under real traffic cannot be caught in pre-commit; a pre-merge "perf gate" there gives false confidence at real cost. Match the gate to its *earliest capable* stage, not the earliest stage.

4. **Redundant gating dressed up as defense in depth.** Running the identical lint suite in pre-commit, CI, and the merge queue triples the cost and catches nothing the first run didn't. Defense in depth means each layer catches a *different* class.

5. **Leaving gates ownerless.** A gate nobody owns cannot be tuned, defended, or deleted — it just rots into theatre and slows everyone down. Every gate needs a named owner who can articulate its signal and is accountable when it's wrong.

6. **No telemetry, so the speed/safety debate is all opinion.** Without fire rate and true-positive rate you cannot tell a high-yield gate from a flaky tax. Instrument every gate; let the numbers end the argument.

7. **No sunset path.** With no way to delete a gate, the pipeline only ever grows slower. A gate that catches zero defects over six months at real cost should be A/B'd to advisory and removed if escapes don't rise.

---

## Test Yourself

1. Roughly how does the cost to catch a defect change from one pipeline stage to the next, and what placement rule follows from it?
2. Give the mechanical test that distinguishes *defense in depth* from a *redundant gate*.
3. What are the four properties that make a gate a "first-class object," and which one outs an ownerless check first?
4. A required gate has not fired once in six months. Name the two possible explanations and what each implies you should do.
5. Describe the trust loop. Why is a *distrusted* gate strictly worse than *no* gate?
6. Does the DORA research say more gates make you safer? What does it say correlates with *worse* stability?
7. A change touches `db/migrations/**`. Under risk-based gating, what should happen, and on what two axes is "risk" judged?
8. You suspect a gate is dead weight but can't prove it. What experiment settles it?

<details>
<summary>Answers</summary>

1. Each later stage costs roughly **~10× more** to catch the same defect (the cost-of-delay-of-feedback gradient). The rule: place each check at the **earliest stage that can *reliably* catch its defect class** — the cheapest *capable* stage, not necessarily the earliest one.
2. Remove the layer and ask what changes. If it changes **which class of defect can slip through**, it's defense in depth (keep it). If it only changes **how many times the same defect is caught**, it's redundancy (collapse it to one authoritative run).
3. **Owner, documented purpose/signal, measured cost, and a bypass path.** Trying to fill in the **owner** outs an ownerless check first — the discipline of naming an accountable owner is what exposes the fossil.
4. Either the defect it guards never occurs (**demote to advisory or delete**), or the gate is **misconfigured and silently passing everything** (verify it can actually turn red). A gate that *cannot* fail is decoration with a latency cost.
5. Flaky/noisy gate → red stops correlating with real problems → people learn red is noise and route around it (blind-retry, admin-merge, disable) → the gate blocks nothing. It's worse than no gate because an *absent* gate keeps people alert (they check manually), while a *distrusted* one shows a green light and records "passed" while enforcing nothing — full cost, zero protection, plus a false record of coverage.
6. **No.** Gating is not linearly safer; elite performers have *fewer, smarter* gates. DORA finds **heavyweight change-approval processes (external boards, sign-off on every change) correlate with *worse* stability** — slower without fewer failures.
7. A changed-path rule should **auto-escalate the change to the high-risk tier** (extra/CODEOWNERS review, staging soak, canary, manual deploy approval). Risk is judged on **blast radius** (how much breaks if it's wrong) and **reversibility** (how fast/cheaply you can undo it).
8. **A/B the gate**: demote it from required to advisory for a few weeks and watch the escaped-defect rate. Unchanged → it caught nothing, delete it. Escapes rise → you now have *proof* it earns its place.

</details>

---

## Cheat Sheet

```
FEEDBACK-COST GRADIENT (catch it as early as it's CATCHABLE)
  editor/IDE  ~1×     types, lint, format
  pre-commit  ~3×     secrets, fast lint
  PR CI       ~10×    unit/integration, SAST, build
  merge queue ~20×    semantic merge conflicts
  staging     ~50×    e2e, soak, config
  canary      ~100×   real-traffic regressions, perf cliffs
  prod        ~1000×  whatever slipped every net
  RULE: place each check at its EARLIEST CAPABLE stage

DEPTH vs REDUNDANCY (remove the layer, ask:)
  changes WHICH class slips through → depth     (keep)
  changes only HOW MANY times caught → redundant (collapse)

EVERY GATE = FIRST-CLASS OBJECT
  owner · signal · measured cost · bypass path
  can't fill the 4 fields → it's a fossil, not a control

TELEMETRY (per gate)
  fire rate · TP rate · FP rate · time cost (wall+queue+human)
  never fires        → suspect (demote/delete, or it's broken-open)
  fires constantly,
    low TP rate      → false-positive machine (trust killer)
  killer review: "0 defects in 6mo, costs 8min/PR" → sunset

TRUST LOOP
  flaky → red means nothing → route around → gate is WORSE than none
  protecting trust > adding a gate

DORA
  fewer + smarter gates, fast feedback, strong tests, progressive delivery
  heavyweight approval ⇒ WORSE stability. gating ≠ linearly safer.

RISK-BASED (gate by blast radius + reversibility)
  standard  docs/test/flag   → build+lint, auto-merge
  normal    feature/bugfix   → full CI + 1 review + queue
  high-risk migration/auth/IaC→ +CODEOWNERS +soak +canary +approval

SUNSET = demote to advisory, measure escape rate, delete if flat
```

---

## Summary

- The **feedback-cost gradient** is the spine of gate design: the same defect costs ~10× more at each later stage (editor → pre-commit → PR CI → merge queue → staging → canary → prod). Place every check at the **earliest stage that can actually catch its class** — the cheapest *capable* stage.
- **Shift-left** moves catchable defects earlier (cheaper); **shift-right** (canary, flags, fast rollback) catches what can't be pre-tested by *gating the blast radius*. **Defense in depth** layers gates that each catch a *different* class; the **redundant gate** (same check thrice) is pure cost.
- Treat **each gate as a first-class object** with an **owner, documented signal, measured cost, and bypass path**. A gate that can't fill those four fields is a fossil; a gate inventory makes that visible in review.
- **Instrument every gate** — fire rate, TP/FP rate, time cost. A gate that *never* fires is suspect; one that fires constantly with low TP rate is a false-positive machine. Telemetry turns the speed/safety debate into a calculation.
- The **trust loop** is the load-bearing asset: noisy gates teach people that red means nothing, so they route around it, making the gate **worse than nothing**. Protecting trust outranks adding coverage.
- The **DORA tension**: gating is *not* linearly safer. Elite teams have **fewer, smarter** gates plus fast feedback and progressive delivery; heavyweight approval correlates with *worse* stability.
- **Risk-based gating** matches gate weight to blast radius and reversibility — fast lane for reversible docs changes, heavy lane for irreversible migrations. And a **sunset policy** (A/B to advisory, measure escapes, delete if flat) keeps the pipeline from only ever growing slower.

---

## Further Reading

- *Continuous Delivery* — Jez Humble & David Farley. The canonical treatment of the deployment pipeline and where gates belong along it; the source of the cost-of-delay-of-feedback framing.
- *Accelerate* — Nicole Forsgren, Jez Humble & Gene Kim (the DORA research). The evidence that elite performers are faster *and* safer with fewer gates, and that heavyweight approval worsens stability.
- *The DevOps Handbook* — Gene Kim, Jez Humble, Patrick Debois & John Willis. Shift-left, fast feedback, and the cultural mechanics of trust around automated controls.
- Nicole Forsgren's talks and writing on **fast feedback** and measuring delivery performance — why feedback latency, not gate count, is the lever.
- [senior.md](senior.md) — gate composition at scale, modelling gate cost as a queue, A/B-testing gate value rigorously, and designing the gate platform itself.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/middle.md) — how individual checks become required vs advisory gates, and the flaky-required-check problem up close.
- [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/middle.md) — a worked example of an evidence-based gate: scope to the diff, ratchet, and demote-and-measure.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/middle.md) — making the bypass path legitimate, logged, and time-boxed instead of an undocumented admin-merge.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the four keys, the fewer-smarter-gates evidence, and the Goodhart/surrogation trap underneath gate counts.
- [Testing](../../testing/) — the trustworthy automated tests that *let* you keep the gate list short.
