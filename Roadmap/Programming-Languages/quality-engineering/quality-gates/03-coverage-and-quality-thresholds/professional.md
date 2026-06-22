# Coverage & Quality Thresholds — Professional Level

> **Roadmap:** [Quality Gates](../README.md) → Coverage & Quality Thresholds
> *The senior page taught you how to wire a coverage gate. This page is about what happens when a VP says "mandate 80% coverage across all 300 services by Q3" — where a single number becomes an org-wide policy, every team optimizes for it, and your job is to give leadership the number they want without teaching 300 teams to write tests that assert nothing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Goodhart Trap and Why Absolute Mandates Backfire](#core-concept-1--the-goodhart-trap-and-why-absolute-mandates-backfire)
5. [Core Concept 2 — Diff Coverage and Clean as You Code](#core-concept-2--diff-coverage-and-clean-as-you-code)
6. [Core Concept 3 — Mutation Testing for Critical Modules](#core-concept-3--mutation-testing-for-critical-modules)
7. [Core Concept 4 — Rolling Out Thresholds Org-Wide](#core-concept-4--rolling-out-thresholds-org-wide)
8. [Core Concept 5 — Performance Gates at Scale](#core-concept-5--performance-gates-at-scale)
9. [Core Concept 6 — Governance, Waivers, and Recalibration](#core-concept-6--governance-waivers-and-recalibration)
10. [Core Concept 7 — Measuring Whether the Gate Helps](#core-concept-7--measuring-whether-the-gate-helps)
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

> Focus: **Designing threshold policy across a real org, where the gate's number is a leadership conversation, a Goodhart hazard, and a thing 300 teams will optimize against — so the staff engineer's job is to channel the desire for a number into a gate that improves quality instead of one that gets gamed.**

The senior page framed coverage gates as a CI config decision: pick a percentage, fail the build below it. At the professional level the percentage stops being a config value and becomes *policy* — and policy at org scale has a physics of its own. The moment a number becomes a target that affects performance reviews, promotions, or "is my team green on the quality dashboard," every team in the org starts optimizing for the number rather than the thing the number was supposed to proxy. That is Goodhart's law, and it is not a risk you might hit — it is the default outcome of a blanket numeric mandate.

So the central tension of this page is this: **leadership wants a number, and the desire is legitimate** — they need a lever, a dashboard, a way to know quality isn't silently rotting. Saying "you can't measure quality, trust the engineers" is a non-answer that gets you overruled. The staff engineer's actual job is to redirect the desire for a number into a gate that *can't* be cheaply gamed and that *does* correlate with fewer escaped defects. That almost always means: hold *new* code to a bar (diff coverage), leave *legacy* alone, back it with human review, and reserve mutation testing for the modules where a bug is expensive. This page is the judgment layer — the politics, the rollout mechanics, and the evidence — on top of mechanics you already know.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — line vs branch coverage, how to wire a coverage gate in CI, diff coverage mechanics, what mutation testing measures.
- **Required:** You've operated a quality gate that teams complained about, or watched a metric get gamed once it became a target.
- **Helpful:** You've been in a leadership conversation where a number was mandated top-down, and had to either implement it or push back.
- **Helpful:** You've owned a CI pipeline across more than one team and seen how a policy that works for one team breaks for another.

---

## Glossary

- **Goodhart's law** — "When a measure becomes a target, it ceases to be a good measure." The governing failure mode of any numeric quality gate that affects how people are evaluated.
- **Absolute (total) coverage** — coverage of the *entire* codebase. The number leadership instinctively reaches for; the one most prone to gaming and demoralization.
- **Diff (patch) coverage** — coverage of *only the lines changed in this PR*. The number that actually drives behavior without punishing legacy.
- **Clean as You Code** — SonarQube's framing: hold *new code* to a quality bar, leave existing code untouched until it's modified. Splits the gate into "new code" vs "overall."
- **Mutation testing** — deliberately injecting faults (mutants) into code and checking whether the test suite catches them. The **mutation score** is the % of mutants killed — a measure of test *effectiveness*, not just execution.
- **Assertion-free test** — a test that executes code (raising coverage) but verifies nothing. The signature artifact of a gamed coverage mandate.
- **The ratchet** — a gate that only allows the threshold to *increase*: today's coverage becomes tomorrow's floor, so the number can never regress but is never imposed top-down.
- **Advisory / informational gate** — a gate that reports and warns but does not block the merge. The trust-building stage before enforcement.
- **Waiver / exception (as code)** — a tracked, expiring, reviewable exemption from a gate, stored in version control rather than granted by a Slack message.
- **Escaped-defect rate** — defects found in production (or by customers) rather than by the gate. The actual outcome a quality gate should move; the honest scorecard.
- **Changepoint detection** — statistical detection of a step change in a time series (e.g., a latency benchmark), used for perf gating instead of comparing two noisy PR runs.

---

## Core Concept 1 — The Goodhart Trap and Why Absolute Mandates Backfire

The instinct is irresistible: leadership sees that quality is hard to measure, hears "we have 40% coverage," and concludes "mandate 80% and quality goes up." It is clean, it is a dashboard number, it is auditable. And it is almost always a mistake, for a mechanical reason.

**Coverage measures whether a line *executed* during tests, not whether the test would *catch a bug* in that line.** These are wildly different. A test can call a function, raise its coverage to 100%, and assert nothing:

```python
# This test takes process_payment from 0% to 100% line coverage.
# It catches exactly zero bugs.
def test_process_payment():
    process_payment(order)          # executed → "covered"
    # no assertion. If process_payment double-charges, this test passes.
```

The instant coverage becomes a *target* that gates merges and shows up on a leaderboard, you have handed every engineer in the org a choice under deadline pressure: write thoughtful assertions (slow, hard) or write executing-but-empty tests (fast, makes the build green). Goodhart's law predicts which one wins at scale, and the empirical record agrees: blanket absolute-coverage mandates reliably produce three things.

1. **Assertion-free and trivial tests.** Teams test getters, generated code, and `__repr__` methods — easy lines that lift the percentage — while the gnarly conditional logic stays untested because it's *hard* to cover and the number doesn't care *which* lines you cover.
2. **Demoralization and cynicism.** Good engineers know the tests they're writing to hit the number are worthless, and resent being forced to write them. The mandate signals that leadership trusts a percentage over their judgment.
3. **A gamed number that's now *worse* than no number** — because leadership believes 80% means "well tested" and stops looking, while the actual escaped-defect rate is unchanged or worse (engineers spent their testing budget on the wrong tests).

> **The core reframe:** the problem isn't measuring coverage — it's making *absolute coverage* a *target*. Coverage is a fine diagnostic ("this whole module is at 4%, that's a red flag worth a look") and a terrible target ("every module must hit 80%"). The staff engineer's move is to keep coverage as a signal and put the *gate* on something far harder to game.

---

## Core Concept 2 — Diff Coverage and Clean as You Code

The single highest-leverage policy decision in this entire topic: **gate the diff, not the codebase.** Instead of "every file must be 80% covered," the rule is "the lines you *changed in this PR* must be 80% covered." Tools: `diff-cover` (language-agnostic, reads the coverage XML and the git diff), Codecov's patch status, and SonarQube's "Coverage on New Code."

Why this dissolves most of the Goodhart problem at once:

- **It's hard to game with empty tests at the margin.** To cover a line you changed, you have to write a test that exercises *that* line — and reviewers see both the diff and its tests in the same PR. Empty-assertion tests are far more visible in a 40-line diff than buried in a 200k-line coverage report.
- **It doesn't punish legacy.** A team inheriting a 12%-covered service is not asked to write 70% of a year's worth of missing tests before they can ship a one-line fix. They're asked to cover what they touch. The legacy debt is left alone until someone modifies it — which is exactly when writing the test is cheapest, because you're already in that code.
- **It makes quality a property of *change*, not a property of a *snapshot*.** This is SonarQube's **Clean as You Code** thesis: stop trying to boil the ocean of existing debt; guarantee that everything *new* meets the bar, and the codebase converges to clean as it's naturally rewritten. The gate splits into two numbers — strict on *new code*, hands-off on *overall*.

```yaml
# diff-cover in CI: fail only if the PR's CHANGED lines fall below the bar.
# Legacy stays at whatever it is; new work is held to 80%.
- run: |
    coverage xml
    diff-cover coverage.xml --compare-branch=origin/main \
      --fail-under=80
```

The Clean-as-You-Code split also reframes the leadership conversation in a way leadership *likes*: "We will not regress. Every line of new code is held to a high bar, verified in CI, and you'll see the new-code coverage trend climb. We are not going to spend a quarter writing assertion-free tests for code nobody is touching." That is a number leadership can put on a slide — and it actually correlates with the thing they care about, because new code is where new bugs live.

> **The professional default:** for almost every org, the right *first* gate is **diff coverage on new code + a code-review requirement**, not absolute coverage. It captures 90% of the value, sidesteps the worst of Goodhart, and is humane to teams carrying legacy. Absolute coverage, if used at all, is an *advisory* dashboard signal, never a blocking org-wide mandate.

---

## Core Concept 3 — Mutation Testing for Critical Modules

Diff coverage closes the "did you cover it" hole but not the "is the test any good" hole — an assertion-free test still *covers* the line it executes. The tool that closes *that* hole is **mutation testing**, and the staff-level judgment is knowing it's too expensive to run everywhere and exactly *where* it earns its cost.

Mutation testing deliberately mutates your code — flips `>` to `>=`, replaces `return x` with `return null`, deletes a line — and reruns the tests. If the tests still pass, the mutant *survived*: your suite executed that code but didn't actually verify its behavior. The **mutation score** (% of mutants killed) is the closest thing to a direct measure of test *effectiveness*, and it is precisely the metric that an assertion-free test fails:

```text
Original:   if balance >= amount:  transfer(amount)
Mutant:     if balance >  amount:  transfer(amount)   # off-by-one boundary

A real test that transfers exactly `balance` → KILLS this mutant (test fails on mutant).
An assertion-free test → mutant SURVIVES (test passes regardless). Coverage was a lie.
```

Tools: `mutmut`/`cosmic-ray` (Python), Stryker (JS/TS, .NET, Scala), PIT/Pitest (JVM), `cargo-mutants` (Rust). The catch is cost: mutation testing reruns the suite once *per mutant*, so a module with thousands of mutants can take hours. This is why **you do not mutation-test the whole repo on every PR.** The professional pattern:

- **Scope it to critical modules** — the payments core, the auth/permission logic, the pricing engine, the money-movement paths. Places where a surviving mutant means a real, expensive bug.
- **Run it on the diff or nightly**, not per-PR on the full tree — `--since` flags and incremental modes restrict mutation to changed code.
- **Gate on it only where you've earned trust**, and even then often as a strong advisory ("3 mutants survived in `billing/` — here they are") rather than a hard block, until the team trusts the tool.

> **The judgment:** mutation testing is the answer to "how do I know the tests are real?" but it's a *scalpel, not a fleet policy*. Apply it where a bug is catastrophic and the code is stable enough to be worth deeply verifying. Mandating mutation testing org-wide reproduces the absolute-coverage mistake at higher cost — you'll get teams gaming the mutation score next. Targeted mutation testing on the critical 5% of the codebase is one of the highest-signal quality investments available; blanket mutation testing is a way to set CI on fire.

---

## Core Concept 4 — Rolling Out Thresholds Org-Wide

You cannot flip a blocking gate on for 300 services on a Tuesday. Every team has a different baseline, and a gate that fails half the org's builds on day one gets disabled by lunchtime and never trusted again. Rollout is staged, and the stages are about *building trust in the gate* as much as raising quality.

**The rollout ladder (never skip a rung):**

1. **Dry-run / informational.** The gate runs and *records* what it *would* have done, but never affects the build. You collect the distribution: how many PRs would fail, in which teams, for what reasons. This is where you discover the gate is mis-tuned *before* it blocks anyone.
2. **Advisory.** The gate posts a visible comment/status ("diff coverage 62%, below the 80% target") but the merge is still allowed. Teams start responding to it voluntarily; you watch adoption and tune the threshold.
3. **Enforce.** The gate blocks the merge. By now the distribution is known, the threshold is calibrated, the false-positive rate is low, and teams have had time to adjust. Enforcement is the *last* step, not the first.

Two more things make org-wide rollout humane and durable:

**Per-team / per-tier targets.** A blanket org-wide number is wrong on its face: a payments service and an internal admin tool do not deserve the same bar. Tier your services and set the gate by tier:

| Tier | Example | Diff-coverage bar | Mutation testing | Notes |
|---|---|---|---|---|
| Tier 0 — critical | Payments, auth, pricing | 85–90% + branch | Yes, on critical paths | Highest bar; escaped defect = $$$ or breach |
| Tier 1 — core product | Main user-facing services | 75–80% | Selective | Standard high bar |
| Tier 2 — supporting | Internal APIs, back-office | 60–70% | No | Pragmatic bar |
| Tier 3 — low-stakes | Internal tools, prototypes | Advisory only | No | Don't gate; don't demoralize |

**Exempt legacy, and use the ratchet as the humane mechanism.** Legacy services are not asked to retroactively hit the bar (that's the absolute-mandate mistake). Instead, the gate is set to the service's *current* coverage as a floor and configured so it can only go *up*. Touch the code, you nudge it up a little; the number monotonically improves and is *never* imposed from above:

```yaml
# The ratchet: the floor is whatever we have now, and it can only rise.
# Nobody mandated 70%. The number climbed there one PR at a time.
coverage:
  status:
    project:
      default:
        target: auto          # = the parent commit's coverage
        threshold: 0%          # never allow a regression; improvements stick
```

> **The professional reality:** the ratchet is the single most humane and effective threshold mechanism in existence. It never demands a heroic test-writing sprint, never punishes inherited debt, and never lets quality regress. A legacy service quietly climbs from 12% to 70% over a year *as it's worked on* — no mandate, no gaming pressure, no demoralization. "Only ever improve" beats "hit this number by Friday" on every axis.

---

## Core Concept 5 — Performance Gates at Scale

Performance gates are where good intentions go to die, because **the naive design — compare this PR's benchmark to main's, fail if slower — is statistically broken.** CI runners are noisy neighbors: a benchmark can swing 10–30% between two runs of *identical* code depending on what else lands on the host, CPU throttling, and cache state. A per-PR perf gate built on a single before/after comparison will fire constantly on noise, and a gate that cries wolf gets ignored — which means it also misses the *real* regression buried in the noise.

The investments that make a perf gate trustworthy at scale:

- **A dedicated, isolated runner.** Shared CI runners make perf benchmarking nearly meaningless. A pinned, isolated machine (or a bare-metal/dedicated instance) with frequency scaling and turbo disabled, pinned CPUs, and no co-tenants is the price of admission. Without it, stop here — your perf gate will be noise.
- **Statistical significance, not a single run.** Run the benchmark N times, compute confidence intervals, and only flag a change that's statistically distinguishable from noise. Tools like `pytest-benchmark`, Criterion (Rust), JMH (JVM), and `hyperfine` report variance precisely so you can do this. "It's 8% slower" is meaningless without "± 12% run-to-run."
- **Trend / changepoint detection over per-PR gating.** Instead of fighting per-PR noise, track the benchmark as a *time series* and use changepoint detection (e.g., the approach behind tools like Mongo's `signal-processing-algorithms`, or services like Bencher / `nyrkiö`) to spot a sustained *step change*. This catches the slow 2%-per-month creep that per-PR gating never sees, and ignores single-run noise that per-PR gating chokes on.
- **Keep it advisory until it's trustworthy.** A perf gate should *earn* the right to block by demonstrating a low false-positive rate over weeks. Until then it informs ("p95 latency stepped up 18% after commit abc123, here's the changepoint") and a human decides.

> **The cost of a flaky perf gate is total.** The first few times a perf gate fails a PR on pure noise, engineers investigate. After that, they learn it's noise and *reflexively retry or override every perf failure* — at which point the gate detects nothing, because the one time it's right it's treated like all the times it was wrong. A perf gate that isn't statistically sound is worse than no perf gate: it consumes attention and trains the org to ignore it, so the real 30% regression sails straight through (see the War Stories). Trend detection on a dedicated runner, kept advisory until proven, is the only design that survives contact with a real org.

---

## Core Concept 6 — Governance, Waivers, and Recalibration

A threshold without governance rots into either noise (everyone overrides it) or tyranny (nobody can ship). Governance answers four questions, and the staff engineer is usually the one who has to answer them.

**Who sets thresholds?** Not a VP picking a round number, and not each team picking their own (which races to zero). The durable model is a small, cross-team group (a quality guild, an enabling team, or a staff-eng working group) that owns the *tiering rubric and the defaults*, while individual teams own their *placement* within it and can request a tier change with justification. The policy is owned centrally; the application is federated.

**How do exceptions and waivers work?** Exceptions are inevitable — a hotfix during an incident, a vendored file that can't be tested, a generated module. The failure mode is granting them by Slack DM, where they're invisible, permanent, and unaccountable. The professional pattern is **waivers as code**: the exemption lives in version control, names an owner and a reason, and *expires*:

```yaml
# waivers.yaml — reviewed in PR, expiring, auditable. Not a Slack message.
- path: "services/billing/legacy_ledger.py"
  rule: "diff-coverage"
  reason: "Vendored from acquisition; replacement tracked in JIRA-4821"
  owner: "payments-team"
  expires: "2026-09-01"     # after this, the waiver is gone and the gate applies
```

This is the same machinery as policy-as-code generally — the gate's *rules and exceptions* are versioned, reviewed, and diffable, which is the subject of [06 — Policy as Code](../06-policy-as-code/professional.md). The expiry is the load-bearing part: a waiver that never expires is just a permanent hole nobody remembers.

**How often do you recalibrate?** Thresholds are not set-and-forget. A quarterly (or per-release-train) review asks: which gates are firing usefully, which are firing on noise, which tiers have drifted, which waivers have piled up. The ratchet handles coverage drift automatically; everything else needs a human pass.

**When do you kill a threshold?** This is the most under-used governance action. A gate that *only generates noise* — that teams universally override, that has never caught a real defect, whose failures are always false positives — is not neutral. It's actively harmful: it trains the org to ignore *all* gates (alert fatigue generalizes), and it taxes every PR. The discipline is to *delete* such a gate, not "tune it one more time." If a gate hasn't justified its existence in a quarter, it has failed its trial and should go (see the Decision Frameworks table).

> **The governance principle:** a quality gate is a *standing claim* on every engineer's attention in the org. That claim has to be continuously *earned*. Gates that earn it get enforced and kept; gates that don't get deleted without ceremony. The job is not to accumulate gates — it's to run a tight portfolio of gates that each demonstrably pull their weight, with exceptions visible and expiring.

---

## Core Concept 7 — Measuring Whether the Gate Helps

Here is the question almost nobody asks, and the one that separates staff judgment from cargo-culting: **how do you know the coverage gate is actually improving quality?** The tempting answer is "coverage went up." That answer is a trap — and recognizing why is the whole point.

**Do not measure the gate by its own metric.** If you justify the coverage gate by pointing at rising coverage, you've committed *meta-Goodhart*: you've made the proxy validate itself. Of course coverage went up — you gated on it. That tells you nothing about whether quality improved; it tells you the gate is doing the tautological thing it was configured to do. A gate can drive coverage from 40% to 85% entirely via assertion-free tests and leave defect rates *identical*.

**Measure the gate by the outcome it was supposed to move.** That outcome is the **escaped-defect rate** — bugs that reach staging, production, or customers — not the coverage number. The honest evaluation correlates the gate against outcomes the gate does *not* directly control:

- **Escaped-defect rate / defect-escape ratio** — defects found post-merge vs pre-merge. If the gate works, more bugs are caught *before* merge over time.
- **Change-failure rate** (a DORA metric) — the fraction of deploys causing a failure. A real quality gate should bend this down.
- **Production incident rate** attributable to the gated services.
- **MTTR / defect age** — are defects caught earlier and cheaper?

This is exactly where [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) earns its place: the gate is an *intervention*, and you evaluate an intervention by its effect on outcome metrics, ideally comparing gated vs not-yet-gated services as a natural experiment. If you roll the gate out tier by tier, the not-yet-gated tiers are your control group.

> **The meta-Goodhart warning, stated plainly:** the day you put "coverage is now 85%" on the quality-program success slide instead of "change-failure rate dropped from 14% to 6% on gated services," you have started measuring the gate by its own metric — and you will keep a useless gate alive because its self-referential number looks good. Tie the gate to escaped defects, or you cannot tell a gate that works from one that's just inflating its own proxy.

---

## War Stories

**The 80% mandate that produced thousands of assert-free tests.** A VP, post-incident, mandated 80% line coverage across every service, wired as a hard blocking gate, surfaced on a quality dashboard tied to team status. Within two months coverage org-wide hit the bar — and the escaped-defect rate hadn't moved a point. Engineers, under deadline and now blocked by the gate, had written the cheapest tests that lifted the number: tests that called functions and asserted nothing, tests for getters and generated DTOs, tests that snapshotted output without checking it. A sample audit found a large fraction of new tests had *zero meaningful assertions*. The mandate had cost a quarter of engineering time, demoralized the strongest engineers (who knew the tests were theater), and bought zero quality — while signaling "green" to leadership, who stopped worrying. The fix was a full reset: drop the absolute mandate, switch to diff coverage on new code, and re-measure against escaped defects instead of the coverage number.

**Diff coverage + mutation testing on the payments core that actually cut defects.** A payments team, burned by the mandate above, took the opposite tack on their Tier-0 service: diff coverage at 85% on new code (legacy left alone, ratcheting), plus PIT mutation testing gated on the money-movement modules only. The mutation gate immediately surfaced real holes — surviving boundary-condition mutants in fee calculation and a survived "off-by-one" in a retry limit that no line-coverage number would ever have flagged. Over two release trains, escaped defects in the payments path dropped measurably, and the team could point to *change-failure rate*, not coverage, as proof. The cost was real (mutation runs were slow, scoped to nightly + diff) but justified by the blast radius of a payments bug. The lesson: targeted, effectiveness-based gating on the critical 5% beats blanket coverage on the whole repo, on both quality *and* cost.

**The perf gate so flaky it was disabled, missing a real 30% regression.** A team added a per-PR latency gate comparing each PR's benchmark to main's, on a shared CI runner. It fired constantly on noise — a 25% "regression" that vanished on retry. Within weeks the team's reflex was to retry or override every perf failure without looking. So when a PR introduced a genuine 30% latency regression, the gate fired, someone overrode it on autopilot ("perf gate, always noise"), and it shipped. The regression surfaced a week later in production p99 alerts. The flaky gate hadn't just failed to help — it had *trained the team to ignore the one true signal it ever produced.* The rebuild: a dedicated isolated runner, N-run statistical significance, changepoint detection on the trend, and advisory-only until it proved a low false-positive rate over a month.

**The "no new SonarQube issues" gate that drove real cleanup via Clean as You Code.** Rather than mandate an absolute issue count (which would've meant a Sisyphean backlog), a platform team set SonarQube's quality gate to "no new issues / no new code smells / coverage on new code ≥ 80%" — the Clean-as-You-Code model. The existing debt was untouched. But every PR now had to leave its *changed* code clean, and because developers were already in that code, the marginal cost of fixing a smell they'd just touched was tiny. Over a year the codebase's *new* code was consistently clean, and the touched-legacy slowly improved via the same diff discipline. No demoralizing mandate, no gaming pressure, steady improvement — the gate worked precisely because it gated *change*, not the *snapshot*.

**The coverage ratchet that quietly raised a legacy service from 12% to 70%.** An inherited service sat at 12% coverage. Instead of a mandate, the team set the gate to `target: auto, threshold: 0%` — the floor is the current number, and it can only rise. No PR was allowed to regress coverage; any PR that touched code naturally added a test or two. Nobody ever wrote a heroic test-sprint. Twelve months later the service was at ~70%, climbed entirely by the ratchet, one PR at a time, with no demoralization and no gaming incentive (because the bar was never a distant number to sprint toward — it was just "don't go backward"). The ratchet did what a mandate never could.

---

## Decision Frameworks

**Absolute vs diff vs mutation gating, by risk tier:**

| Risk tier | Absolute coverage | Diff coverage | Mutation testing |
|---|---|---|---|
| Tier 0 (payments/auth) | Advisory dashboard only | **Enforce, 85–90%, branch** | **Yes — gated on critical paths** |
| Tier 1 (core product) | Advisory only | **Enforce, 75–80%** | Selective / nightly advisory |
| Tier 2 (supporting) | Off or advisory | Enforce, 60–70% | No |
| Tier 3 (internal tools) | Off | Advisory only | No |

**"Mandate X% across the org" — why not / what instead:**

| Leadership asks | Why a blanket mandate backfires | What to give them instead |
|---|---|---|
| "Mandate 80% coverage everywhere" | Goodhart → assert-free tests, gamed number, demoralization, zero defect reduction | Diff coverage on new code + review; absolute coverage as advisory dashboard |
| "Get every service to 90%" | Punishes legacy; forces a quarter of worthless tests on untouched code | The ratchet: "only ever improve"; new code held high, legacy climbs as touched |
| "One number for the whole org" | A payments service and an internal tool don't deserve the same bar | Per-tier targets with a published rubric |
| "Prove the program worked via coverage" | Meta-Goodhart: the proxy validates itself | Report escaped-defect / change-failure rate, not the coverage number |

**Perf gate: advisory vs blocking readiness checklist** (must check *all* before blocking):

| Checklist item | Why it gates blocking-readiness |
|---|---|
| Dedicated, isolated runner (no co-tenants, scaling pinned) | Shared runners make benchmarks meaningless noise |
| N-run statistical significance with confidence intervals | A single before/after run can't distinguish signal from noise |
| Trend / changepoint detection, not raw per-PR compare | Catches slow creep; ignores single-run spikes |
| Demonstrated low false-positive rate over weeks (advisory phase) | A gate that cries wolf trains the org to ignore it |
| A clear human override path with a logged reason | So a true positive isn't autopilot-overridden as "the usual noise" |

**Threshold rollout stages (dry-run → enforce):**

| Stage | Gate behavior | Exit criterion to advance |
|---|---|---|
| Dry-run / informational | Records would-fail; never blocks | Distribution understood; threshold calibrated to a sane fail rate |
| Advisory | Posts visible status; merge allowed | Voluntary adoption rising; false-positive rate low; teams adjusted |
| Enforce | Blocks the merge | (Steady state — recalibrate quarterly) |

**When to delete a threshold gate:**

| Signal | Verdict |
|---|---|
| Teams universally override it; never blocks anything real | **Delete** — it's pure tax + alert-fatigue |
| Has never caught a defect that mattered in a quarter | **Delete** — failed its trial |
| Failures are ~always false positives (esp. perf) | Demote to advisory; **delete** if still useless next quarter |
| Justified only by its own metric rising | **Re-justify against escaped defects or delete** |
| Catches real issues, low false-positive rate | **Keep and enforce** |

---

## Mental Models

- **A number that becomes a target becomes a lie.** The moment absolute coverage gates merges and shows on a leaderboard, you've asked the org to optimize the number, and it will — with assertion-free tests. Goodhart isn't a risk; it's the default. Gate something hard to game (the diff, with review), not the snapshot.

- **Gate the change, not the codebase.** Quality is a property of what you're *adding*, not a snapshot of everything that exists. Diff coverage + Clean as You Code holds new work to a bar, leaves legacy alone, and lets the codebase converge to clean as it's naturally rewritten.

- **The ratchet beats the mandate, always.** "Only ever improve" needs no heroic sprint, punishes no inherited debt, creates no gaming pressure, and never regresses. A legacy service climbs 12% → 70% on its own. "Hit this number by Friday" does none of that.

- **Mutation testing is a scalpel, not a fleet policy.** It's the only gate that proves tests are *real*, but it's expensive — apply it to the critical 5% where a bug is catastrophic. Mandating it org-wide reproduces the absolute-coverage mistake at higher cost.

- **A flaky gate is worse than no gate.** It consumes attention and *trains the org to ignore it* — so the one time it's right, it's overridden on autopilot. This is why perf gates stay advisory until statistically proven, and why noisy gates get deleted.

- **Never measure the gate by its own metric.** Coverage rising proves the gate gates coverage — nothing more. Evaluate the gate by escaped defects and change-failure rate, the outcomes it was supposed to move. Anything else is meta-Goodhart.

- **Every gate is a standing claim on attention that must be re-earned.** A gate portfolio is curated, not accumulated. Gates that pull their weight get enforced; gates that only generate noise get deleted without ceremony.

---

## Common Mistakes

1. **Mandating absolute coverage org-wide.** The signature blunder. It triggers Goodhart at scale, producing assert-free tests, demoralization, and a gamed number that's *worse* than none (because leadership now trusts it). Gate diff coverage on new code instead; keep absolute coverage as an advisory signal.

2. **One number for every service.** A payments core and an internal admin tool don't deserve the same bar. Tier services and set thresholds by tier with a published rubric, or you'll over-burden low-stakes teams and under-protect critical ones.

3. **Forcing legacy to retroactively hit the bar.** Asking a 12%-covered inherited service to reach 70% before shipping a one-line fix is the absolute-mandate mistake in miniature. Exempt legacy and use the ratchet — improve only what you touch.

4. **Flipping a blocking gate on day one.** A gate that fails half the org's builds on Tuesday is disabled by lunch and never trusted again. Go dry-run → advisory → enforce; enforcement is the *last* rung, after the threshold is calibrated and the false-positive rate is known.

5. **Per-PR perf gating on shared runners.** Comparing two noisy benchmark runs guarantees false positives, which trains everyone to ignore perf failures, which lets the real regression through. Dedicated runner + statistical significance + changepoint trend detection, advisory until proven.

6. **Mandating mutation testing everywhere.** It's the highest-signal gate *and* the most expensive; org-wide it sets CI on fire and invites gaming of the mutation score. Scope it to the critical modules where a bug is catastrophic; run on diff/nightly.

7. **Granting waivers by Slack.** Invisible, permanent, unaccountable exceptions rot the gate. Waivers as code: versioned, owned, justified, and *expiring*. The expiry is the point.

8. **Measuring the program by the coverage number.** Meta-Goodhart: the proxy validates itself, and you keep a useless gate alive because its self-referential metric looks good. Report escaped-defect and change-failure rate against gated vs not-yet-gated tiers.

9. **Never deleting a noisy gate.** A gate everyone overrides isn't neutral — it taxes every PR and trains the org to ignore all gates. If it hasn't earned its keep in a quarter, delete it.

---

## Test Yourself

1. A VP mandates 80% absolute coverage org-wide as a blocking gate on every service. Predict the outcome mechanically (in terms of Goodhart), and state what you'd propose instead and why.
2. Explain why diff coverage + Clean as You Code sidesteps most of the Goodhart problem that absolute coverage triggers, and what it does about legacy debt.
3. A line is at 100% coverage but a bug in it ships anyway. What kind of test was probably written, and which technique would have caught the gap? Why don't you run that technique on the whole repo?
4. Describe the coverage ratchet, and explain why it's more humane and more effective than a "reach 70% by Q3" mandate for a legacy service.
5. A team's per-PR perf gate fires constantly and is now reflexively overridden. What's the design flaw, what's the consequence the War Story illustrates, and what four things make a perf gate trustworthy enough to block?
6. Leadership wants to declare the quality program a success because coverage rose from 40% to 85%. Why is that the wrong success metric, what should you report instead, and what is this failure mode called?
7. How should exceptions/waivers to a gate be granted at org scale, and what single property of a waiver is most load-bearing?
8. Give three signals that a threshold gate should be *deleted* rather than tuned.

<details>
<summary>Answers</summary>

1. Coverage measures *execution*, not *bug-catching*, so the instant it becomes a gated target, engineers under deadline write the cheapest tests that lift the number — **assertion-free and trivial tests** — covering easy lines (getters, generated code) while hard conditional logic stays untested. Result: coverage hits 80%, escaped defects don't move, strong engineers are demoralized, and leadership wrongly trusts the number (so the gate is *worse* than none). Propose instead: **diff coverage on new code + code review**, with absolute coverage demoted to an advisory dashboard signal. It's far harder to game (the test and the changed line are reviewed together) and doesn't punish legacy.
2. Diff coverage gates only the *changed* lines, so to satisfy it you must test *those specific lines*, and reviewers see the test and the diff in the same PR — empty-assertion gaming is visible. Clean as You Code holds *new* code to the bar and leaves *existing* code alone, so the codebase converges to clean as it's rewritten. **Legacy debt is left untouched until someone modifies it** — which is exactly when writing the test is cheapest.
3. Almost certainly an **assertion-free (or assertion-weak) test** that executed the line but verified nothing. **Mutation testing** would have caught it: a mutant in that line survives because no assertion fails. You don't run it on the whole repo because it reruns the suite *per mutant* — hours of CI — so you scope it to the critical modules (payments, auth) where a bug is catastrophic, on diff/nightly.
4. The ratchet sets the gate's floor to the service's *current* coverage and allows the number only to *rise* — never regress. It's more humane because it never demands a heroic test sprint and never punishes inherited debt; more effective because the number climbs monotonically as code is naturally touched (12% → 70% over a year) with **no gaming pressure** (the bar is "don't go backward," not a distant target to sprint toward and cheat).
5. Flaw: comparing two noisy benchmark runs (esp. on a shared runner) produces constant false positives. Consequence (from the War Story): the team learns it's noise and overrides *every* perf failure on autopilot, so when a real 30% regression fires, it's overridden too and ships. Trustworthy-enough-to-block requires: **(1) dedicated isolated runner, (2) N-run statistical significance with confidence intervals, (3) trend/changepoint detection instead of per-PR compare, (4) a demonstrated low false-positive rate over weeks while advisory.**
6. Coverage rising only proves the gate gates coverage — it's tautological and says nothing about quality (the rise could be all assert-free tests). It's the **meta-Goodhart** failure: the proxy validates itself. Report instead the outcomes the gate was meant to move — **escaped-defect rate, change-failure rate (DORA), incident rate** — ideally comparing gated vs not-yet-gated tiers as a natural experiment.
7. **Waivers as code**: stored in version control, reviewed in a PR, naming an owner and a reason. The most load-bearing property is that the waiver **expires** — an exception that never expires is a permanent, forgotten hole. (Slack-DM waivers are invisible, permanent, and unaccountable.)
8. Any three of: teams universally override it and it never blocks anything real; it has never caught a defect that mattered in a quarter; its failures are nearly always false positives; it's justified only by its own metric rising. A gate that only generates noise actively harms by taxing every PR and training the org to ignore *all* gates.

</details>

---

## Cheat Sheet

```
THE CENTRAL TENSION
  Leadership wants a NUMBER. Goodhart says any gated number gets gamed.
  Job: channel the desire for a number into a gate that can't be cheaply gamed.

GOODHART (absolute coverage as a target)
  coverage = did the line EXECUTE, not did the test CATCH a bug
  mandate 80% absolute → assert-free tests, demoralization, gamed number, 0 defect drop
  → keep coverage as a SIGNAL, gate on the DIFF + review

THE DEFAULT GATE (almost every org)
  diff coverage on NEW code (75-85%) + code review
  Clean as You Code: strict on new, hands-off on legacy
  diff-cover coverage.xml --compare-branch=origin/main --fail-under=80

MUTATION TESTING (scalpel, not fleet policy)
  proves tests are REAL (kills mutants); assert-free tests can't kill mutants
  scope to CRITICAL modules only (payments/auth); diff or nightly
  PIT/Stryker/mutmut/cargo-mutants

THE RATCHET (humane mechanism)
  floor = current coverage; can only RISE; never mandated
  target: auto, threshold: 0%   → 12% climbs to 70% over a year, no sprint

ROLLOUT LADDER (never skip)
  dry-run/informational → advisory → enforce
  per-TIER targets (payments != internal tool); exempt legacy

PERF GATES (advisory until proven)
  per-PR compare on shared runner = NOISE = ignored = misses real regression
  need: dedicated runner + N-run significance + changepoint trend detection
  flaky gate is WORSE than no gate

GOVERNANCE
  thresholds: central rubric, federated placement
  waivers AS CODE: versioned, owned, reasoned, EXPIRING (see policy-as-code 06)
  recalibrate quarterly; DELETE gates that only make noise

MEASURE THE GATE
  NOT by coverage rising (meta-Goodhart, self-validating)
  BY escaped-defect rate + change-failure rate (DORA), gated vs not-yet-gated

LEADERSHIP PLAYBOOK ("just mandate 90%")
  "We won't regress; new code held to a high bar, verified in CI; trend climbs.
   We won't burn a quarter writing assert-free tests for code nobody touches.
   We'll prove it worked with change-failure rate, not the coverage number."
```

---

## Summary

- **The central tension is real:** leadership legitimately wants a number, and Goodhart guarantees any gated number gets gamed. The staff job is to channel that desire into a gate that *can't* be cheaply gamed and *does* correlate with fewer escaped defects — not to refuse measurement.
- **Absolute-coverage mandates backfire mechanically.** Coverage measures execution, not bug-catching, so gating on it org-wide produces assertion-free tests, demoralization, and a gamed number that's worse than none. Keep coverage as a *signal*; put the *gate* elsewhere.
- **The default gate is diff coverage on new code + review, via Clean as You Code** — strict on new work, hands-off on legacy, hard to game in a reviewed PR, and humane to teams carrying debt. Back it with **targeted mutation testing on the critical 5%**, where a bug is catastrophic — a scalpel, never a fleet policy.
- **Roll out as dry-run → advisory → enforce**, with **per-tier targets** and **legacy exempted**, and use **the ratchet** ("only ever improve") as the humane mechanism that climbs a legacy service from 12% to 70% with no mandate and no gaming pressure.
- **Perf gates stay advisory until statistically proven** — a per-PR comparison on shared runners is noise that trains the org to ignore the gate, so the real 30% regression ships. Dedicated runner + significance + changepoint trend detection, or don't gate.
- **Govern the portfolio:** central rubric with federated placement, **waivers as code that expire** ([policy as code](../06-policy-as-code/professional.md)), quarterly recalibration, and *delete* gates that only generate noise.
- **Measure the gate by escaped defects and change-failure rate, never by its own metric** — measuring a coverage gate by rising coverage is meta-Goodhart, and it keeps useless gates alive on a self-validating number.

You can now run threshold policy as an org-level, leadership-facing, anti-Goodhart concern. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone truly understands why "just mandate 80%" is the wrong answer and what the right one is.

---

## Further Reading

- [SonarQube — Clean as You Code](https://docs.sonarsource.com/sonarqube-server/latest/user-guide/clean-as-you-code/) — the authoritative framing of gating new code while leaving legacy alone, and the new-code/overall split.
- [Goodhart's law](https://en.wikipedia.org/wiki/Goodhart%27s_law) and Marilyn Strathern's formulation ("when a measure becomes a target…") — the governing failure mode of every numeric quality gate.
- *Accelerate* (Forsgren, Humble, Kim) and the [DORA metrics](https://dora.dev/) — why you evaluate an intervention by outcome metrics (change-failure rate) rather than activity metrics (coverage).
- [diff-cover](https://github.com/Bachmann1234/diff_cover) and Codecov/SonarQube patch-coverage docs — the tooling for gating the diff instead of the snapshot.
- PIT/Pitest, Stryker, `mutmut`, and `cargo-mutants` docs — mutation testing as a measure of test *effectiveness*; read the cost/scoping guidance.
- [interview.md](interview.md) — the questions that probe whether someone understands threshold policy at scale, not just how to set a percentage.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/professional.md) — the gate framework these thresholds plug into, and how blocking vs advisory checks compose.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/professional.md) — the broader tradeoff space (perf gates, advisory tiers, where strictness pays) these thresholds live within.
- [Code Coverage](../../code-coverage/) — line vs branch, instrumentation, and the mechanics underneath the coverage threshold.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity, duplication, and the SonarQube issue metrics that "no new issues" gates act on.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — escaped-defect and change-failure rate: how to measure whether the gate actually helped, without committing meta-Goodhart.
