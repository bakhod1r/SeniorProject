# Flaky Tests & Reliability — Professional Level

> **Roadmap:** [Testing](../README.md) → Flaky Tests & Reliability
> *Run a flaky-test management program at scale — detection infra, dashboards, a flake budget/SLO, ownership, fix-or-delete policy, the economics of reruns, and a culture where ignored red is unacceptable.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- A Flaky-Test Management Program](#core-concept-1----a-flaky-test-management-program)
5. [Core Concept 2 -- Detection Infrastructure at Scale](#core-concept-2----detection-infrastructure-at-scale)
6. [Core Concept 3 -- The Flake Budget / Reliability SLO](#core-concept-3----the-flake-budget--reliability-slo)
7. [Core Concept 4 -- Ownership & Fix-or-Delete Policy](#core-concept-4----ownership--fix-or-delete-policy)
8. [Core Concept 5 -- The Economics of Flakiness](#core-concept-5----the-economics-of-flakiness)
9. [Core Concept 6 -- Culture: Zero Tolerance for Ignored Red](#core-concept-6----culture-zero-tolerance-for-ignored-red)
10. [Core Concept 7 -- Measuring Suite Reliability Over Time](#core-concept-7----measuring-suite-reliability-over-time)
11. [Core Concept 8 -- Flakiness at Scale: Monorepo & Big-Org Approaches](#core-concept-8----flakiness-at-scale-monorepo--big-org-approaches)
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

> Focus: **Treating flakiness as an organizational problem — a measured, budgeted, owned program with policy and culture, not a pile of individual annoyances.**

At small scale, flakiness is a handful of tests a senior fixes. At organizational scale — hundreds of engineers, thousands of merges a day, a suite of 100k+ tests — flakiness becomes a *systemic* force. With enough tests, *something* is statistically always flaky; if 0.1% of 100k tests flake on any run, that's ~100 spurious failures per run, and the merge pipeline grinds to a halt while trust evaporates.

At this scale you don't fix flakes one by one. You run a **program**: detection infrastructure, a reliability budget with an explicit target, ownership routing, a fix-or-delete policy, an economic model, and — most importantly — a culture where nobody is allowed to ignore red. The thesis never changes: **a flaky test is a broken test, and trust is the asset.** Professionals operationalize that belief.

## Prerequisites

- Junior→senior pages: trust thesis, root-cause taxonomy, quarantine discipline, retries trade-off, prevention by design.
- Experience owning CI/test infrastructure for many teams.
- Comfort with SLO/error-budget thinking and the `concurrency-patterns` skill.

## Glossary

| Term | Meaning |
|------|---------|
| **Flaky-test program** | The org-wide system of detection, budget, ownership, and policy that keeps a large suite trustworthy. |
| **Flake budget / reliability SLO** | An explicit, agreed target for acceptable flakiness (e.g. ≥99.5% of merges green-without-rerun). |
| **Flake score** | A per-test statistic (failures / runs over a window) used to rank and route flakes. |
| **Ownership routing** | Automatically assigning a detected flake to the team/owner of the code under test. |
| **Fix-or-delete** | The policy that a flake is either fixed within an SLA or removed — never left to rot. |
| **CI cost of reruns** | The compute + wall-clock + engineer-time spent re-running flaky tests. |
| **Test-impact analysis** | Running only the subset of tests affected by a change, shrinking exposure to flakes. |
| **Reliability dashboard** | The shared, trended view of pass rate, flake rate, retry rate, and quarantine size. |

## Core Concept 1 -- A Flaky-Test Management Program

A program has these pillars; the rest of this page details them:

1. **Detection** — automated infrastructure that *identifies* flaky tests (rerun-to-detect, cross-run analysis) and records them — never to hide them.
2. **Measurement & dashboards** — pass rate, per-test flake score, retry rate, quarantine size, all trended.
3. **Budget / SLO** — an explicit reliability target so "good enough" is defined, not argued.
4. **Ownership** — every flake auto-routed to a named owner/team.
5. **Policy** — fix-or-delete within an SLA; quarantine with deadlines; rerun rules.
6. **Culture** — flakiness treated as a P-level bug; ignored red is unacceptable.

The program's purpose is to make reliability a managed property of the org rather than the heroics of whichever senior is annoyed today. Without a program, large suites reliably decay into "everyone re-runs until green," which is the death state.

## Core Concept 2 -- Detection Infrastructure at Scale

You cannot eyeball flakiness across thousands of tests. You build (or buy) infrastructure that detects it automatically:

- **Rerun-to-detect (not to hide).** When a test fails in CI, re-run it once on the *same commit*. If it flips fail→pass, it's flagged flaky and recorded — the merge may proceed, but the flake event is logged, attributed, and dashboards updated. This is the load-bearing distinction: the rerun's job is to *classify and surface*, never to silently green the build.
- **Cross-run statistical detection.** Aggregate every test's outcomes across all runs. A test that produces different results on the *same commit hash* over time is flaky by definition; flag it without needing a special rerun.
- **Tooling.** `pytest-rerunfailures`, Maven Surefire / Gradle `test-retry`, and `go test -count` provide the rerun mechanics; platform layers — **Gradle Develocity (Enterprise)**, **Datadog Test Optimization**, **BuildPulse**, **CircleCI test insights**, and **Google's internal flaky-test infrastructure** — aggregate fail-then-pass and same-commit-different-result events into per-test flake scores and dashboards. **Test-impact / target-determination systems** (Bazel's, Google's TAP) shrink each run to only affected tests, reducing total flake exposure.

```python
# Detection harness: deflake a suspect against a single commit and report.
# (Identification — the result is RECORDED, not used to silently pass CI.)
import subprocess, json

def flake_score(test_id, runs=100):
    fails = 0
    for _ in range(runs):
        r = subprocess.run(["pytest", test_id, "-q"], capture_output=True)
        fails += (r.returncode != 0)
    return {"test": test_id, "runs": runs, "fails": fails, "rate": fails / runs}

print(json.dumps(flake_score("tests/test_orders.py::test_webhook")))
```

The data this produces — per-test flake score, attributed to an owner, trended over time — is the fuel for every other pillar.

## Core Concept 3 -- The Flake Budget / Reliability SLO

Borrowing from SRE error budgets, set an explicit **reliability SLO** for the suite so the org agrees on what "trustworthy enough" means and has a trigger for action.

Example SLOs:

- **≥ 99.5% of merges are green on the first run** (no rerun needed).
- **Per-test flake rate < 0.1%** over a 30-day window; anything above is auto-quarantined.
- **Quarantine queue < N tests and average age < 14 days.**

The budget makes consequences automatic instead of political:

- When the suite is **within budget**, teams ship features.
- When the suite **breaches budget** (pass rate drops below the SLO), a **reliability freeze or rotation** kicks in: a portion of engineering effort redirects to flake-fixing until the suite is back in budget — exactly like burning an error budget halts risky deploys.

> The flake budget converts "we should really fix flakiness someday" into "we breached SLO, so fixing flakes is now the priority." It gives reliability the same teeth as feature deadlines. (See [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) for error-budget mechanics.)

A budget also legitimizes *some* flakiness: chasing 0% is uneconomic. The SLO names the line where flakiness becomes unacceptable, so effort is spent where it matters.

## Core Concept 4 -- Ownership & Fix-or-Delete Policy

**Ownership.** Every flaky test must route to a named owner — almost always the team that owns the code under test, derived from a `CODEOWNERS`/ownership map. Unowned flakes are nobody's job and therefore never fixed. Detection infra should **auto-file a ticket against the owning team** the moment a test crosses the flake threshold.

**Fix-or-delete policy.** The core organizational rule: a flagged flake gets exactly one of two outcomes within an SLA:

```text
Flake detected → auto-quarantine (unblock everyone) + auto-ticket to owner
  ├─ Owner FIXES within SLA (e.g. 10 working days) → back in blocking suite
  └─ Owner does NOT fix within SLA → test is DELETED (with notification)
```

Deletion-on-timeout sounds harsh but is the keystone: it guarantees the quarantine queue can never become an infinite graveyard, and it forces an honest decision — *this test matters enough to fix, or it doesn't matter enough to keep.* A flaky test that nobody will fix is providing negative value (it costs trust and compute while protecting nothing), so removing it is strictly better than letting it rot.

The policy must be *automated and enforced*, not aspirational. If enforcement depends on someone remembering, the graveyard wins.

## Core Concept 5 -- The Economics of Flakiness

To get organizational investment, quantify the cost. Flakiness is expensive in three currencies:

**1. CI compute.** Every rerun re-executes tests (often the whole suite or a large shard). At scale this is real money.

```text
10,000 merges/month × 30% need ≥1 rerun × 20 min CI × $0.10/min
  = 10,000 × 0.30 × 20 × $0.10 = $6,000/month in rerun compute alone
```

**2. Developer time — the dominant cost.** A red build interrupts an engineer: they context-switch, investigate, decide "probably a flake," re-run, wait, re-verify. Even 10 minutes of human attention per flaky failure dwarfs the compute:

```text
10,000 merges/month × 30% flaky × 15 min engineer time × $1.50/min (loaded)
  = 10,000 × 0.30 × 15 × $1.50 = $67,500/month in lost engineering time
```

**3. Trust — the priceless cost.** The unquantifiable but largest cost: once the team stops believing red, the suite stops preventing bugs, and a real defect ships. One shipped incident can dwarf a year of rerun compute. **Trust is the asset; flakiness spends it.**

> The economic case writes itself: a flake-management program that costs a fraction of an engineer pays for itself many times over in recovered compute, recovered developer hours, and — most of all — preserved trust that keeps real bugs out of production.

## Core Concept 6 -- Culture: Zero Tolerance for Ignored Red

Tools and budgets fail without culture. The cultural rules that make a program stick:

- **Red means stop — always.** The moment "just re-run it" becomes acceptable, trust is already gone. The cultural norm must be: a red build is investigated, not waved through.
- **Flakiness is a P-level bug, not a chore.** A flaky test that's eroding the suite gets the same urgency as a production defect, because it *is* attacking production safety (it's removing the net).
- **"A flaky test is a broken test"** is repeated until it's reflex. No one says "it's just flaky" as an excuse.
- **No silent skips.** Disabling a test without a ticket and owner is treated as introducing a bug.
- **Reliability is everyone's job, owned by someone.** A rotation (a "build cop" / flake-duty) owns suite health each week, but every engineer is expected to leave the suite no flakier than they found it.
- **Celebrate de-flaking.** Make fixing flakiness visible and valued, not invisible grunt work — otherwise it never gets done.

The cultural goal is simple and absolute: **green must mean safe, and red must mean stop.** Everything in the program exists to keep that equation true.

## Core Concept 7 -- Measuring Suite Reliability Over Time

The program lives or dies on its dashboard. Track and trend:

| Metric | Definition | Healthy direction |
|--------|-----------|-------------------|
| **First-run pass rate** | merges green without any rerun | ≥ SLO, stable/rising |
| **Per-test flake score** | failures / runs (same commit), 30-day | near 0; outliers triaged |
| **Retry rate** | share of passes that needed a retry | low and falling (leading indicator) |
| **Quarantine size & age** | count + mean days in quarantine | small, young, moving |
| **Mean time to de-flake** | detection → fixed/deleted | within SLA |
| **Flake-induced CI cost** | rerun compute + est. eng-time | trending down |

Review these in a regular reliability forum. A **falling first-run pass rate** or **rising retry rate** is an early warning that trust is leaking — act before the team starts ignoring red, not after. Reliability that isn't on a trended dashboard silently decays.

## Core Concept 8 -- Flakiness at Scale: Monorepo & Big-Org Approaches

At Google/Meta/large-monorepo scale, the math changes: with millions of tests, a non-trivial fraction is flaky at any instant, so the strategy is *statistical containment*, not zero-flakiness.

- **Continuous detection & flake scoring.** Every test carries a maintained flakiness score from historical pass/fail on identical commits; high-flake tests are automatically excluded from gating.
- **Test-impact / target determination.** Only run tests affected by a change (Bazel, Google's TAP). Fewer tests per run = fewer flake exposures and faster signal.
- **Automatic quarantine + auto-routing.** Tests crossing the flake threshold are auto-quarantined and a ticket auto-filed to the owning team — no human triage in the loop for detection.
- **Bisect-on-flake / culprit finding.** Automated systems re-run across commits to attribute a regression or identify a flake's introduction.
- **Hermeticity enforced by the build system.** Bazel's sandboxing makes tests hermetic by construction (no network, declared inputs only), eliminating whole flakiness families structurally rather than per-test.
- **Org-level SLO with enforced freezes.** Suite reliability is a tracked SLO; breaches trigger org-wide flake-fixing focus.

The lesson scales down: even a 500-test repo benefits from automated detection, scoring, auto-quarantine with deadlines, and a reliability SLO. The principles are identical; only the volume differs.

## Real-World Examples

- **Google's flaky infrastructure.** Google publicly documented that ~1.5% of test runs are flaky and that they manage it with continuous flake scoring, automatic quarantine, and excluding flaky tests from gating rather than chasing zero — a statistical-containment program, not a per-test cleanup.
- **Develocity dashboards change behavior.** A large org adopts Gradle Develocity's flaky-test dashboard; making per-test flake scores visible and attributed to teams drives the flake rate down simply because flakiness is now measured and owned, not invisible.
- **The deletion-SLA that drained the swamp.** A company with an ever-growing quarantine queue introduced auto-delete after a 10-day fix SLA. Within a quarter the queue stabilized small: teams fixed what mattered and let the rest be deleted — the policy forced the honest fix-or-delete decision that human goodwill never had.

## Mental Models

- **Reliability is an SLO, not a wish.** Define the line, attach consequences, freeze on breach.
- **Statistical containment, not zero.** At scale you manage flakiness like an error budget, you don't eliminate it.
- **Flakiness spends trust like money.** Three currencies — compute, developer time, trust — and trust is priceless.
- **No owner, no fix.** Detection without ownership routing just produces a list nobody acts on.
- **Fix-or-delete or rot.** Without an enforced SLA and auto-delete, quarantine becomes a graveyard.

## Common Mistakes

- **Detection without a budget/SLO** → you measure flakiness but never trigger action.
- **Budget without ownership** → flakes are detected but routed to no one.
- **Quarantine without deletion SLA** → infinite graveyard, silent coverage loss.
- **Optimizing for 0% flakiness** → uneconomic; chase the SLO, not perfection.
- **Counting only CI compute** → you miss the dominant cost (developer time) and the priceless one (trust).
- **Tools without culture** → the program exists on paper while everyone still re-runs to green.

## Test Yourself

1. Name the six pillars of a flaky-test management program and what each contributes.
2. Define a flake budget/reliability SLO and explain how it borrows from SRE error budgets. What happens on breach?
3. Estimate the monthly cost of flakiness for a 10k-merge org. Why is developer time the dominant cost — and what's the cost beyond dollars?
4. Why is an enforced fix-or-delete SLA (with auto-delete) the keystone that prevents a quarantine graveyard?
5. How do large monorepos contain flakiness without chasing zero? Name three techniques.
6. What is the single distinction that separates legitimate rerun-to-detect from illegitimate rerun-to-hide?

## Cheat Sheet

```text
PROGRAM PILLARS
  detection · measurement/dashboards · budget(SLO) · ownership · policy · culture

DETECTION (identify, RECORD — never hide)
  rerun-to-detect + cross-run same-commit analysis → per-test flake score
  Develocity · Datadog · BuildPulse · Google flaky infra · Bazel/TAP test-impact

FLAKE BUDGET / SLO
  e.g. ≥99.5% first-run green; per-test flake <0.1%; quarantine small & young
  Breach → reliability freeze/rotation (like an error budget)

OWNERSHIP + FIX-OR-DELETE
  auto-quarantine + auto-ticket to code owner
  fix within SLA → back in suite | not fixed → DELETED (keystone)

ECONOMICS (3 currencies)
  CI compute + developer time (DOMINANT) + trust (PRICELESS)

CULTURE
  red = STOP, always | flakiness = P-level bug | no silent skips
  "a flaky test is a broken test" | green = safe, red = stop

SCALE: statistical containment, not zero; auto-quarantine; hermetic-by-build; org SLO
```

## Summary

At organizational scale, flakiness is a systemic force, and you manage it with a **program**, not heroics: **detection infrastructure** that identifies and records flakes (never hides them), **dashboards** that trend pass rate / flake score / retry rate / quarantine health, a **flake budget/SLO** that defines "good enough" and triggers a reliability freeze on breach, **ownership routing** that hands every flake to a named team, and an enforced **fix-or-delete policy** (with auto-delete on SLA timeout) that keeps quarantine from becoming a graveyard. Justify it with **economics** — rerun compute, the dominant cost of developer time, and the priceless cost of lost trust — and anchor it in **culture**: red always means stop, flakiness is a P-level bug, and no test is silently skipped. At true scale you pursue statistical containment, not zero. Through all of it the thesis holds: a flaky test is a broken test, and trust is the only asset your suite has.

## Further Reading

- Google Testing Blog, "Flaky Tests at Google and How We Mitigate Them"; Micco, "Flaky Tests at Google" (~1.5% flaky-run figure)
- Google SRE Book — error budgets (the model the flake budget borrows)
- Gradle Develocity / Datadog Test Optimization / BuildPulse flaky-test docs
- Bazel test sandboxing & hermeticity documentation
- The `concurrency-patterns` and `systematic-debugging` skills.

## Related Topics

- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — reliability SLOs and error budgets.
- [End-to-End Testing](../04-end-to-end-testing/professional.md) — where bounded retries are legitimate.
- [Integration Testing](../03-integration-testing/professional.md) — hermetic infrastructure at scale.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/professional.md) — determinism seams.
- [Test Data Management](../11-test-data-management/professional.md) — isolation across large suites.
