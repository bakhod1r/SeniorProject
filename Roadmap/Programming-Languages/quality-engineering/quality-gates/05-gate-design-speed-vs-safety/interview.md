# Gate Design: Speed vs Safety — Interview Level

> **Roadmap:** [Quality Gates](../README.md) → Gate Design: Speed vs Safety
> *A gate-design interview rarely asks "should you have CI." It asks "your pipeline takes 45 minutes and engineers routinely skip it — what do you do," and then watches whether you treat the gate as a classifier with a precision/recall tradeoff and a P&L, or just as a wall you make taller after every incident. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [The Trust Loop](#the-trust-loop)
5. [Gate Economics](#gate-economics)
6. [The DORA Evidence](#the-dora-evidence)
7. [Risk-Based Gating & Scale](#risk-based-gating--scale)
8. [Scenarios](#scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

"Speed vs safety" is the framing most engineers bring to a gate-design interview, and it's the first thing a strong interviewer wants to dismantle. The DORA research is blunt about it: elite performers ship faster *and* fail less, simultaneously. So the interesting questions aren't "which do you sacrifice?" They're "why do bad gates make you slower *and* less safe at once?" and "how do you decide whether a check should block, warn, or not exist?" This bank walks junior-to-staff, but the through-line is constant: **a gate is an automated classifier with a cost, an owner, and a P&L — treat it like one, or it rots.**

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **block vs warn vs observe** (stop the line vs annotate vs just record)
- **false positive vs false negative** (the gate cried wolf vs the gate let a bug through — almost never symmetric in cost)
- **flaky vs slow vs pointless** (three different ways a gate loses trust, with three different fixes)
- **bypass rate as the health metric** (the gate's real-world precision, measured by how often humans overrule it)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well *name the distinction* before reaching for a tool.

## Prerequisites

You'll get more from this page if you're comfortable with: what a CI pipeline and required status check are; the basic vocabulary of [DORA's four keys](../../engineering-metrics-and-dora/) (deploy frequency, lead time, change-fail rate, MTTR); precision/recall as a classifier concept; and the idea of progressive delivery (canary, feature flags, fast rollback). If "change-fail rate" or "false-positive cost" are unfamiliar, skim [junior.md](junior.md) first.

---

## Fundamentals

### Q: What *is* a quality gate, and what does every gate cost?

> **Testing:** Whether you see gates as free safety or as a priced tradeoff.

**A.** A quality gate is an automated check on the path to production that can **block, warn, or merely record** based on a signal — tests, coverage, lint, security scan, manual approval. The framing that matters is that **every gate has a cost, not just a benefit.** Three costs, specifically:

1. **Latency** — wall-clock time it adds to feedback. A 12-minute gate taxes every push by 12 minutes.
2. **Friction** — the human cost of dealing with it: re-running flaky jobs, getting approvals, interpreting output.
3. **False alarms** — every time it blocks something that was actually fine, it spends trust and engineer time.

So a gate isn't justified by "it might catch something." It's justified when its expected benefit (bugs caught × cost-of-those-bugs-escaping) exceeds those three costs. A gate that's never paid for itself is technical debt with a green checkmark.

### Q: Explain "shift-left" and the cost-of-delay argument behind it.

> **Testing:** Whether you can quantify *why* fast, early feedback is the whole point.

**A.** Shift-left means moving a check **as early in the lifecycle as it can run accurately** — the same defect costs roughly an order of magnitude more to fix at each stage it survives. A type error caught in your editor costs seconds. The same error caught in CI costs a context-switch and a pipeline run. In code review it costs a reviewer's time plus a round-trip. In production it costs an incident, a rollback, customer impact, and a postmortem. The classic IBM/NIST figures put the editor-to-production multiplier in the 10x-per-stage, ~100x-total range; treat the exact number as folklore but the *direction* as solid.

This is why gate **placement** matters as much as gate existence. A lint rule belongs in a pre-commit hook and the editor, not as a 30-minute CI-only job — same check, but at the point where the fix is cheapest and the feedback loop is tightest.

### Q: Distinguish "defense in depth" from "redundant gates." Why does the distinction matter?

> **Testing:** The most common way well-meaning teams over-gate.

**A.** **Defense in depth** is *layered* gates that catch *different* failure modes — unit tests catch logic bugs, a security scanner catches injection, a canary catches load-dependent regressions. Each layer earns its place because it catches something the others can't. **Redundant gates** check the *same* thing at multiple points with no added coverage — a lint rule in pre-commit *and* in CI *and* in a separate "code quality" stage, all flagging the identical issue.

The distinction matters because redundancy reads as "more safety" but actually *reduces* safety: it adds latency and false-alarm surface for zero new coverage, which erodes trust and pushes people toward bypassing — and a bypassed gate catches nothing. The test for any gate is: **"what failure does this catch that no other gate catches?"** If the answer is "nothing," it's redundant, not defensive.

### Q: You're asked to add a gate. What three questions do you ask before saying yes?

> **Testing:** Whether you have a discipline for gate accretion, or just say yes.

**A.** Every gate needs an **owner, a purpose, and a measured cost** — so:

1. **What specific failure does this prevent, and how often does that failure actually happen?** (Purpose + base rate. If the failure has never happened, the gate is probably theater.)
2. **Who owns it — who responds when it fires and who decides when it's wrong?** (Ownership. An ownerless gate becomes noise nobody can tune.)
3. **What will it cost — added latency, expected false-positive rate — and how will we measure whether it's worth it?** (Measured cost + a sunset trigger.)

If a proposed gate can't answer all three, it's not ready to be required. This is the antidote to the accretion problem, where every incident bolts on a new permanent gate and the pipeline slowly ossifies.

---

## The Trust Loop

### Q: Walk me through how a flaky gate makes a system *less* safe, not just annoying.

> **Testing:** The central causal loop of gate design — do you understand that trust is the real asset?

**A.** It's a feedback loop, and it's the most important dynamic in the topic:

1. A gate is **flaky or pointless** — it fails on retry, or blocks things that were fine.
2. Engineers learn its signal is unreliable, so they start **ignoring red** ("just re-run it") or **bypassing** it (`--no-verify`, admin merge, disabling the check).
3. The bypass becomes **normalized and cultural** — "everyone skips that one."
4. Now the gate catches *nothing*, because nobody heeds it — and worse, the **habit of bypassing generalizes** to the gates that *do* matter.

The endpoint is a gate that is **worse than no gate**: it cost latency and friction the whole time, it provided false confidence ("we have a security scan!"), and it trained the team to route around safety checks. The asset a gate protects isn't the codebase directly — it's *trust in the signal.* Spend that and the gate is decorative.

### Q: Contrast a gate that never fires with a gate that always fires. What's wrong with each?

> **Testing:** Whether you can read a gate's firing rate as a diagnostic.

**A.** Both are broken, in opposite directions:

- **A gate that never fires** is either redundant (something upstream already catches everything it would) or miscalibrated to be toothless. It's pure cost — latency and maintenance — with no demonstrated benefit. It's a prime **sunset candidate**: if it hasn't caught anything in a quarter, prove it's still needed or delete it.
- **A gate that always fires** (or constantly fails on noise) trains people to ignore it. Its real-world precision is near zero, so every alert is treated as a false alarm — including the rare true one. It actively erodes trust.

The healthy zone is in between: a gate should fire **often enough to demonstrably catch real problems, rarely enough that a red result is taken seriously.** The firing rate and the *true*-firing rate are both data you should be watching.

### Q: What single metric best tells you a gate is unhealthy, and how do you read it?

> **Testing:** Whether you know the one operational signal that summarizes gate health.

**A.** **Bypass rate** — the fraction of times engineers override, skip, or force past the gate (admin merge, `--no-verify`, re-run-until-green, disabled check). It's effectively the gate's *measured false-positive rate as judged by the humans closest to the code.* A near-zero bypass rate means people trust the gate; a climbing bypass rate means the gate is firing on things the team has decided aren't real, and they're voting with their feet.

How to read it: a *spike* in bypasses usually means the gate just got flakier or the codebase changed under it. A *chronically high* bypass rate means the gate is miscalibrated and should be tuned, downgraded to warn, or removed. The key insight: **a high bypass rate is a signal to fix the gate, not to lock down the bypass.** Removing the escape hatch on a gate people don't trust just converts bypass into "stop deploying," which is far worse. (See [07 — Break-glass & Bypass](../07-break-glass-and-bypass/interview.md) for why you keep the escape hatch and instrument it instead.)

---

## Gate Economics

### Q: Model a quality gate as a classifier. What are its errors and why aren't they symmetric?

> **Testing:** The single biggest differentiator — do you reason about gates quantitatively?

**A.** A gate is a **binary classifier**: it predicts "this change is bad" (block) or "this change is fine" (pass). So it has the two classic errors:

- **False positive** — it blocks a change that was actually fine. Cost: engineer time, latency, eroded trust, and a nudge toward bypassing.
- **False negative** — it passes a change that was actually bad. Cost: a defect escapes toward production — possibly an incident.

The errors are **almost never symmetric in cost**, and which dominates depends entirely on the change. For a payments-service migration, a false negative (shipping a bug) is catastrophic and a few false positives are cheap insurance — so you tune for **high recall**, accept friction. For a typo fix in a marketing page's copy, a false positive (blocking it for 20 minutes over a flaky integration test) costs more than the false negative would — so you tune for **precision/throughput**, gate lightly. **The right operating point is set by the asymmetry, and the asymmetry is set by blast radius and reversibility** — not by a one-size policy.

### Q: Why do low-base-rate problems make gates noisy, and what does that imply?

> **Testing:** Base-rate reasoning — the thing that separates people who've actually tuned gates.

**A.** This is the base-rate problem and it's deeply unintuitive. Suppose only **1 in 1,000** changes actually carries the defect a gate targets. Even a *very good* gate — say 95% true-positive rate and a 5% false-positive rate — produces mostly false alarms at that base rate:

- True positives per 1,000 changes: `1 × 0.95 ≈ 1`
- False positives per 1,000 changes: `999 × 0.05 ≈ 50`

So **~50 of every ~51 times this gate fires, it's wrong.** The gate's *precision* is ~2% even though its accuracy sounds excellent. People will — correctly — learn to ignore it.

The implication: for a rare failure mode, a noisy gate is dominated by false positives and will erode its own trust no matter how "accurate" it sounds in isolation. Your options are to make the gate dramatically more *specific* (drive the false-positive rate toward zero), move it to **warn** instead of block, or accept it doesn't belong as a required gate at all. **Accuracy is a trap; precision at the real base rate is what determines whether a gate survives contact with engineers.**

### Q: Sketch the "P&L" of a gate. How do you decide if it's worth keeping?

> **Testing:** Whether you can put real numbers on the keep/kill decision.

**A.** Treat each gate as a line item with an expected value:

```
Benefit  =  P(catches a real defect that would otherwise escape)
            × cost-of-that-defect-escaping        (incident, rollback, customer impact)

Cost     =  (added latency per run × runs per period)
            + (false-positive rate × cost-per-false-alarm × runs)
            + maintenance/flake-triage time

Keep the gate while Benefit > Cost.
```

Concretely: a gate adding 3 minutes to 500 builds/week is 25 engineer-hours/week of latency alone — that has to be earned by *demonstrably* catching defects that would otherwise have been expensive. If you can't point to a real escape it prevented in the last quarter, the benefit term is unsubstantiated and the gate is running at a loss.

The corollary is **sunset criteria**: define, when you *add* a gate, the condition under which you'd remove it — "if this hasn't caught a real defect in two quarters, or if its bypass rate exceeds 20%, we delete or downgrade it." Gates should be reviewed like a portfolio, not accumulated like sediment.

### Q: When should a gate *block* versus *warn* versus just *observe*?

> **Testing:** The everyday design decision, and whether you tie it to the cost asymmetry.

**A.** The decision follows from confidence and cost asymmetry:

| Mode | Use when | Example |
|---|---|---|
| **Block** | High confidence the signal is real (low false-positive rate) **and** the false negative is expensive | Compile failure; failing unit tests; secret detected in diff; known-critical CVE |
| **Warn** | The signal is useful but noisy, or the cost of a false negative is moderate; you want visibility without stopping the line | Coverage dipped 1%; a new lint rule you're rolling in; a flaky-but-occasionally-real integration suite |
| **Observe** | You're still calibrating, or measuring base rate before committing | A new security scanner in "record-only" mode for a month to learn its false-positive rate |

The progression is also a **rollout strategy**: introduce a new gate in *observe*, watch its true/false-positive rates, promote to *warn*, and only promote to *block* once you've earned a low false-positive rate. Shipping a noisy new check straight to *block* is the fastest way to start the trust-erosion loop. And the rule of thumb: **block only what you're confident about and what's expensive to get wrong; warn the rest.**

---

## The DORA Evidence

### Q: Is "speed vs safety" a real tradeoff? What does the research say?

> **Testing:** Whether you know the headline finding that reframes the entire topic.

**A.** It's largely a **false dichotomy**, and that's the most important empirical point in the field. The DORA / *Accelerate* research consistently finds that **elite performers achieve both speed and stability simultaneously** — they deploy more frequently *and* have lower change-failure rates *and* recover faster. Throughput and stability are **positively correlated, not traded off.** The teams that ship daily are also the ones that break things least.

So when someone frames a decision as "we have to choose speed or safety," the honest senior answer is usually: *that tradeoff is an artifact of bad gates.* A slow, flaky, batch-everything pipeline forces the choice. The way out isn't picking a side — it's the practices that make the tradeoff disappear.

### Q: If not "more gates," what *do* elite performers do to get both speed and safety?

> **Testing:** Whether you can name the actual mechanisms instead of hand-waving "culture."

**A.** They substitute **fast feedback and small batches** for heavyweight up-front control. Concretely, the practices DORA links to high performance:

- **Comprehensive, fast automated tests** that engineers trust — so the *test* is the gate, not a human.
- **Continuous integration** with small, frequent merges — small changes are easier to verify and to revert.
- **Trunk-based development** — short-lived branches, fewer big risky merges.
- **Progressive delivery** — canary, feature flags, gradual rollout — so a bad change is contained and reverted in minutes rather than blocked for hours up front.
- **Lightweight change approval** — peer review over a separate change-approval board.

The unifying idea: get the feedback *fast and early* and make change *reversible*, rather than trying to prove correctness with ever-more pre-merge gates. **More speed comes from better gates and reversibility, not fewer safety practices** — and more safety comes from the same place.

### Q: DORA found heavyweight change-approval processes correlate *negatively* with performance. Explain.

> **Testing:** A specific, counterintuitive finding — and whether you can reason about *why*.

**A.** DORA's research found that formal, external **change-approval boards** (CABs) are **negatively correlated with deploy frequency and lead time, and have no measurable benefit for change-failure rate.** They make you slower and they don't make you safer. The mechanism is intuitive once you state it:

- A separate approver, **distant from the change**, can't meaningfully assess its risk — so they either rubber-stamp (no safety benefit) or block conservatively (pure friction).
- The delay encourages **batching** — people wait for the approval window and ship larger changes together, and large batches are *riskier* and harder to diagnose.
- The process **displaces** the high-value control (the author and a peer who actually understand the change) with a low-value one.

The takeaway for gate design: a heavyweight human gate is often **negative-sum** — it has the *form* of safety without the function. Peer review at the point of change, plus automated verification, plus fast rollback, outperforms it on both axes. "Approval theater" is the canonical example of a gate that costs speed *and* fails to buy safety.

---

## Risk-Based Gating & Scale

### Q: What does "risk-based gating" mean, and what two properties drive it?

> **Testing:** Whether you can replace one-size-fits-all gating with a risk model.

**A.** Risk-based gating means **the strength of the gate scales with the risk of the change**, instead of applying the same heavyweight pipeline to every change. The two properties that drive risk:

1. **Blast radius** — how much breaks if this is wrong? A payments core service vs. an internal dashboard's CSS.
2. **Reversibility** — how fast and cleanly can you undo it? A feature-flagged change you can flip off in seconds vs. an irreversible data migration or a schema drop.

Risk is roughly **blast radius × (1 − reversibility)**. A high-blast-radius, irreversible change (a DB migration on the billing database) warrants heavy gating — extra review, staging soak, manual sign-off. A low-blast-radius, instantly-reversible change (a copy tweak behind a flag) warrants almost none — fast lane it. The mistake is gating the copy tweak as if it were the migration, which taxes the 95% of safe changes to defend against the 5% risky ones.

### Q: How does progressive delivery let you gate *less* up front?

> **Testing:** The connection between reversibility and how much pre-merge control you need.

**A.** This is the key lever and it's worth internalizing. The amount of *pre-merge* gating you need is inversely proportional to how fast you can **detect and undo** a bad change in production. If reverting is a multi-hour redeploy, every change is high-stakes and you're tempted to gate everything heavily up front. If reverting is **flipping a feature flag or aborting a canary in seconds**, the cost of a bad change escaping drops by orders of magnitude — so a few escapes are cheap, and you can afford a *lighter, faster* gate.

So progressive delivery (canary, gradual rollout, feature flags, automated rollback on SLO breach) is itself a **gate — but a fast, automated, runtime one** that catches load- and environment-dependent failures static gates *can't* see. It shifts some verification *right* (into production, safely) precisely so you can shift the heavy, slow gates *out* of the critical path. **Cheap, fast rollback is what makes "gate less, move faster" safe** rather than reckless.

### Q: You inherit a pipeline that's accumulated 30 required gates over five years. How do you manage that portfolio?

> **Testing:** Staff-level judgment — managing gates as a system, including deletion.

**A.** Treat the gate set as a **portfolio you actively prune**, not an archive. My approach:

1. **Inventory and attribute.** For each gate: what does it catch, who owns it, what's its added latency, its failure rate, and its bypass rate? Most orgs have never written this down.
2. **Find the deadweight.** Gates that haven't caught a real defect in N months (pure cost), gates with high bypass rates (untrusted), and redundant gates (no unique coverage) are removal/downgrade candidates.
3. **Right-place the survivors.** Move the cheap deterministic ones left (pre-commit/editor), keep the expensive ones (full integration, security scans) but parallelize and cache them.
4. **Downgrade before deleting** where there's nervousness — move a suspect gate to *warn* for a sprint and watch what gets through. If nothing bad escapes, delete it.
5. **Institute a review cadence and sunset criteria** so the portfolio is re-examined, not just grown.

The headline: **deleting a gate is a legitimate, often high-ROI engineering action.** The accretion problem — adding a gate after every incident and never removing one — is how a 5-minute pipeline becomes a 45-minute one that everyone routes around.

### Q: Leadership wants you to make the pipeline "safer" and reads fewer gates as reckless. How do you sell "fewer, smarter gates"?

> **Testing:** Whether you can translate gate economics into leadership language and evidence.

**A.** I'd reframe from "fewer gates" (which sounds like *less safety*) to **"higher-signal gates and faster recovery"** (which is *more* safety), and I'd bring data:

- **Lead with the DORA evidence:** elite performers get speed *and* stability, and heavyweight approval correlates *negatively* with performance. This isn't my opinion; it's the industry's largest dataset. So "more gates = safer" is empirically false past a point.
- **Show the bypass rate.** "Engineers bypass these five gates 40% of the time — so they're not actually protecting us; they're costing latency and giving false confidence. A gate people route around is a *liability* dressed as a control."
- **Show the P&L.** "These three gates haven't caught a real defect in two quarters but add 11 minutes to every build — that's N engineer-hours/week for zero demonstrated benefit."
- **Trade a gate for faster recovery.** "Instead of a slow pre-merge gate that *might* catch this class of bug, we invest in canary + automated rollback, which catches the bugs that matter in production and limits blast radius to 1% of traffic for 90 seconds. That's a better safety posture *and* it's faster."

The strategic point I'm making to leadership: **safety is change-failure rate and MTTR, not gate count.** Optimize the outcome, not the proxy.

---

## Scenarios

### Q: Your CI takes 45 minutes and engineers routinely bypass it. Diagnose and fix.

> **Testing:** The flagship scenario — structured diagnosis, not a single silver bullet.

**A.** First, recognize this is the **trust-erosion loop in progress**: the pipeline is slow enough (and probably flaky enough) that the rational move is to skip it, so people do — which means it's protecting nothing while costing everything. I'd diagnose along two axes, *latency* and *trust*:

**Why is it slow?**
- Profile the pipeline — *which stages dominate the 45 minutes?* Usually it's a long-tail of serial steps or one giant test job.
- **Parallelize** independent stages and shard the test suite across runners.
- **Cache** dependencies, build artifacts, and Docker layers.
- **Shift fast checks left** — lint/format/type-check belong in pre-commit and the editor, not as serial CI stages adding minutes.
- **Split fast vs slow:** run the fast, high-signal checks as required-to-merge (target a few minutes); move slow, broad suites (full E2E, heavy security scans) to post-merge or a periodic pipeline so they don't block every change.

**Why don't they trust it?**
- Measure **flakiness** and **bypass rate** per check. Quarantine or fix flaky tests aggressively — a flaky required gate is the #1 trust-killer.
- Kill redundant and never-fire gates found in the audit.

The endgame: a **fast, trustworthy required path** (minutes, reliable) plus **comprehensive async verification** behind it, plus **progressive delivery** so escapes are caught and reverted in production. Then the rational move flips from "bypass" back to "let it run." The wrong fix is "lock down the bypass so they *can't* skip it" — that just converts skipping into not-shipping, and treats the symptom while the disease (a slow, untrusted pipeline) festers.

### Q: After every incident, leadership wants a new required gate. How do you respond?

> **Testing:** Whether you can push back on accretion without sounding like you oppose safety.

**A.** I don't reflexively say no — sometimes a gate is the right control. But I'd run every proposed gate through the discipline, *especially* in the emotional aftermath of an incident when the instinct is "never again, add a wall":

1. **Would this gate actually have caught *this* incident?** Often the honest answer is no — the failure was an unknown-unknown a generic gate wouldn't have flagged. Adding it is theater that *feels* like action.
2. **What's its cost and false-positive rate, applied to *every* change forever?** One incident is being amortized across thousands of future changes. A gate that adds 5 minutes to all builds to defend against a once-a-year failure is a bad trade.
3. **Is a gate even the best control here?** Frequently the better fix is **faster detection and rollback** (better alerting, a canary, a feature flag) so this class of failure is *contained* rather than *prevented* — that scales better and doesn't tax every change.
4. **If we add it, what's its sunset criterion, and what do we remove to make room?** Tie additions to reviews so the pipeline doesn't ossify.

I'd frame it to leadership as: "The goal is fewer/cheaper incidents, and the data says that comes from fast feedback and fast recovery, not from accumulating pre-merge walls. Let's add the control that actually addresses *this* failure mode — which here is X — and measure it." That's taking the incident seriously *and* protecting the system from death by a thousand gates.

### Q: How do you decide whether a specific check should block or just warn?

> **Testing:** The crisp decision rule, stated as an algorithm.

**A.** Two questions, in order:

1. **How confident am I the signal is a true problem — i.e., what's the false-positive rate at the real base rate?** If it's noisy (high FP rate, low base rate), blocking will erode trust faster than it catches bugs → **warn**.
2. **How expensive is a false negative — letting it through?** If cheap/reversible → lean **warn**; if expensive/irreversible → lean **block**, and invest in driving the false-positive rate down so blocking is tolerable.

So: **block** = confident signal *and* expensive miss (compile errors, failing tests, leaked secrets, critical CVEs). **Warn** = noisy signal *or* cheap miss (a 1% coverage dip, a style nit, a new check still being calibrated). And always **start new checks in observe/warn**, measure their real false-positive rate, and *earn* the promotion to block. The anti-pattern is blocking on something you can't reliably distinguish from noise — that's how you train people to ignore red.

### Q: Design the gate set for a *low-risk* change vs a *high-risk* change.

> **Testing:** Whether you can instantiate risk-based gating concretely, both directions.

**A.** The gate set scales with **blast radius × irreversibility**. Concretely:

**Low-risk** — e.g., a copy/CSS tweak on a marketing page, behind a flag, instantly revertible:
- Fast pre-merge checks only: lint, type-check, the relevant unit tests (target single-digit minutes).
- Peer review, lightweight.
- Ship through normal progressive rollout; rely on the flag for instant revert.
- *No* manual approval, no full E2E gate, no staging soak. Gating it heavily taxes a safe change for nothing.

**High-risk** — e.g., an irreversible schema migration on the billing database:
- Everything above, **plus**: full integration/E2E suite, a migration dry-run against a production-like dataset, an explicit rollback/forward plan reviewed before merge.
- A **manual sign-off** from a service owner — one of the rare cases a human gate earns its cost, because the blast radius is huge and the change is irreversible.
- Staged rollout with extra monitoring and a defined abort criterion; deploy in a low-traffic window.
- Expand/contract migration pattern so each step *is* reversible where possible — turning a high-risk change into a sequence of lower-risk ones.

The meta-point: **same org, same pipeline, deliberately different gate strength** — that's risk-based gating in practice. A single uniform pipeline either over-gates the copy tweak or under-gates the migration; it can't be right for both.

### Q: A team proposes a "90% coverage" required gate across all repos. Critique it.

> **Testing:** Whether you can spot a Goodhart-prone, one-size gate — ties to coverage thresholds.

**A.** Several problems, in priority order:

- **It's a uniform number on non-uniform code.** 90% is wrong for a config-loading utility (trivially testable, low risk) *and* for a payments engine (you might want 100% on critical paths). A blanket threshold over-gates some code and under-gates the code that matters.
- **It's a proxy that invites gaming (Goodhart's law).** Coverage measures *lines executed*, not *behavior verified*. A hard gate pressures engineers to write assertion-free tests that touch lines to hit the number — raising the metric while *lowering* real safety.
- **Retrofitting it to legacy code is a wall of false positives** — every existing under-covered file blocks unrelated changes, which guarantees a high bypass rate and trust erosion.

Better design: gate on **coverage of the diff / new code** (don't let *new* code regress), not absolute repo coverage; use a **ratchet** (coverage may not *decrease*) rather than a fixed cliff; and treat the number as a **warn**/trend signal for most code, blocking only on designated critical paths. The principle: **don't make a noisy proxy a hard blocker** — it's the base-rate/Goodhart trap in coverage clothing. (More in [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/interview.md).)

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: What's the one metric that tells you a gate is untrusted?** A: **Bypass rate** — how often humans override or skip it; it's the gate's real-world false-positive rate.
- **Q: Block, warn, or observe a brand-new security scanner?** A: **Observe** first to learn its false-positive rate, then warn, then block once it's proven low-noise.
- **Q: Is speed vs safety a real tradeoff?** A: Usually no — DORA shows elite teams get both; the "tradeoff" is typically an artifact of bad gates.
- **Q: Why is a gate that never fires bad?** A: Pure cost (latency + maintenance) with no demonstrated benefit — a sunset candidate.
- **Q: A gate is "95% accurate" but everyone ignores it. How?** A: Low base rate — at 1-in-1000, even 5% false positives mean ~50 false alarms per true catch, so precision is near zero.
- **Q: What's the cheapest place to catch a defect?** A: As early as possible — the editor/pre-commit; cost rises ~10x per stage it survives.
- **Q: Defense in depth vs redundant gates — the test?** A: "What does this catch that no other gate catches?" Nothing → redundant.
- **Q: Why is a separate change-approval board often negative-sum?** A: It adds delay and encourages batching while a distant approver can't assess risk — slower with no stability benefit (per DORA).
- **Q: Two properties that set a change's risk?** A: **Blast radius** and **reversibility**.
- **Q: How does fast rollback let you gate less?** A: If you can revert in seconds, an escaped bug is cheap, so a few false negatives are tolerable and the pre-merge gate can be lighter/faster.
- **Q: When does a manual human gate earn its cost?** A: Rarely — mainly for high-blast-radius, irreversible changes (e.g., a billing-DB migration).
- **Q: Right response to a 40% bypass rate?** A: **Fix or downgrade the gate** — not lock down the bypass; people are signaling the gate is wrong.
- **Q: What should you define when you *add* a gate?** A: Its **sunset criterion** — the condition under which you'd remove it.
- **Q: Coverage gate done right?** A: On the diff/new code with a ratchet (no regression), not a uniform absolute cliff.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Framing every decision as "speed vs safety" without questioning the dichotomy.
- "Add a gate" as the reflexive answer to every incident — never mentioning cost, base rate, or deletion.
- Treating gates as free safety — no notion of latency, friction, or false-alarm cost.
- Wanting to *remove the bypass* on a gate people don't trust, rather than fixing the gate.
- "Just require 90% coverage everywhere" — uniform thresholds, no Goodhart awareness.
- Believing a change-approval board makes things safer.
- No concept of a gate as a classifier with precision/recall and asymmetric error costs.

**Green flags:**
- Naming the *distinction* (block/warn/observe, FP/FN cost, flaky/slow/pointless) before reaching for a tool.
- Citing DORA's "speed and safety together" and the negative correlation of heavyweight approval — unprompted.
- Reasoning quantitatively: base rate, precision at that base rate, a gate P&L.
- Treating **bypass rate** as the health signal and reading a spike vs chronic correctly.
- Proposing **fast rollback / progressive delivery** as a way to gate *less* up front, not just more gates.
- Talking about **deleting** gates and **sunset criteria** as normal engineering.
- Scaling gate strength to **blast radius × reversibility** instead of one-size-fits-all.

---

## Cheat Sheet

| Concept | One-liner |
|---|---|
| **A gate's cost** | Latency + friction + false alarms — never free |
| **Cost of delay** | ~10x per stage a defect survives; gate where the fix is cheapest |
| **Defense in depth vs redundant** | Different failure modes vs same check twice (delete the latter) |
| **Trust loop** | Flaky/pointless → ignored/bypassed → normalized → worse than no gate |
| **Bypass rate** | The gate's real-world false-positive rate; the #1 health signal |
| **Gate as classifier** | FP (blocks good change) vs FN (passes bad change); costs asymmetric |
| **Base-rate trap** | Rare failure + any FP rate → mostly false alarms; accuracy ≠ precision |
| **Gate P&L** | Keep while `P(catch)×cost-of-escape > latency + FP-cost + upkeep` |
| **Block / warn / observe** | Confident+expensive / noisy-or-cheap / still-calibrating |
| **DORA finding** | Speed and safety rise together; heavyweight approval correlates *negatively* |
| **Risk-based gating** | Gate strength ∝ blast radius × (1 − reversibility) |
| **Progressive delivery** | Fast rollback → escapes are cheap → gate less up front |
| **Accretion problem** | Gate-per-incident, never delete → 45-min pipeline everyone bypasses |
| **Sunset criterion** | Define removal condition *when you add* the gate |

---

## Summary

- The whole bank reduces to a few distinctions in costumes: **block vs warn vs observe**, **false positive vs false negative cost**, **flaky vs slow vs pointless**, and **bypass rate as the health metric**. Name the distinction first; the tactic follows.
- **Every gate has a cost** — latency, friction, false alarms — so it must be justified by demonstrated benefit, have an **owner/purpose/measured cost**, and ideally a **sunset criterion**. Defense in depth (different failure modes) earns its place; redundant gates don't.
- **The trust loop is the core dynamic:** a flaky or pointless gate gets ignored/bypassed and becomes *worse than no gate*. **Bypass rate** is the gate's real-world precision — a high rate means fix the gate, not lock the door.
- **Gate economics:** a gate is a classifier with asymmetric error costs; at low base rates even an "accurate" gate is mostly false positives, so **precision at the real base rate** — not accuracy — decides survival. Run each gate as a P&L.
- **DORA's evidence dissolves the dichotomy:** elite performers get speed *and* stability via fast tests, CI, progressive delivery, and lightweight review — **not more gates**. Heavyweight change approval correlates *negatively* with performance.
- **Risk-based gating + progressive delivery:** scale gate strength to **blast radius × reversibility**, and use fast rollback to gate *less* up front. Manage the gate set as a **portfolio you prune** — deleting gates is legitimate, high-ROI work, and the antidote to accretion.

---

## Further Reading

- *Accelerate: The Science of Lean Software and DevOps* (Forsgren, Humble, Kim) — the empirical case that speed and stability rise together, and that heavyweight approval doesn't help. The single most important source for this topic.
- The annual **DORA / State of DevOps reports** — current data on the four keys, change approval, and progressive delivery.
- *Continuous Delivery* (Humble & Farley) — the deployment pipeline, fast feedback, and why small reversible changes beat heavyweight gates.
- *The Principles of Product Development Flow* (Donald Reinertsen) — cost of delay, queueing, and small batch sizes — the economics under "shift-left."
- *Thinking in Bets* (Annie Duke) — decision-making under uncertainty and the asymmetry of error costs; useful framing for gate FP/FN tradeoffs.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — the conceptual foundation and the at-scale portfolio practices behind these answers.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/interview.md) — what gets gated and how required status checks are enforced in practice.
- [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/interview.md) — the canonical Goodhart-prone gate; diff-coverage and ratchets done right.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/interview.md) — why you keep and instrument the escape hatch instead of removing it.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the four keys and the evidence that reframes speed-vs-safety as a false tradeoff.
- [Testing](../../testing/) — fast, trustworthy automated tests are the gate that lets you gate less elsewhere.
