# Dead Code & Complexity — Senior Level

> **Roadmap:** [Static Analysis](../README.md) → Dead Code & Complexity

*Removing dead code at scale is a verification problem, not a delete problem; governing complexity is a trend problem, not a threshold problem. The senior job is to make both safe and to stop the metric from being gamed.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Dead-code removal at scale as a verification problem](#core-concept-1--dead-code-removal-at-scale-as-a-verification-problem)
5. [Core Concept 2 — The "all entry points" enumeration](#core-concept-2--the-all-entry-points-enumeration)
6. [Core Concept 3 — Safe-deletion playbook: deprecate, observe, delete](#core-concept-3--safe-deletion-playbook-deprecate-observe-delete)
7. [Core Concept 4 — Complexity as a proxy: defect risk and test difficulty](#core-concept-4--complexity-as-a-proxy-defect-risk-and-test-difficulty)
8. [Core Concept 5 — Gaming cyclomatic complexity (Goodhart in miniature)](#core-concept-5--gaming-cyclomatic-complexity-goodhart-in-miniature)
9. [Core Concept 6 — Trend over time vs absolute threshold](#core-concept-6--trend-over-time-vs-absolute-threshold)
10. [Core Concept 7 — Targeting refactoring with the metrics](#core-concept-7--targeting-refactoring-with-the-metrics)
11. [Core Concept 8 — Portfolio view: hotspots = complexity × churn](#core-concept-8--portfolio-view-hotspots--complexity--churn)
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

> Focus: **safely removing dead code across a large system, and governing complexity through trends and hotspots rather than blunt thresholds that get gamed.**

A junior deletes the function the tool flagged. A senior asks: *is it truly unused across every entry point — including the ones the analyzer can't see — and if I'm not sure, how do I find out before deleting rather than after?* Dead-code removal at scale is fundamentally a verification problem: the cost of a wrong deletion is a production incident, and the analyzer's call graph is incomplete by construction.

The same maturity applies to complexity. A senior knows the cyclomatic number is a *proxy* for defect risk and test difficulty — empirically correlated, not causal — and that turning a proxy into a hard target invites Goodhart's law: people split functions to dodge the gate, scattering logic and making the code *worse* while the metric improves. This tier is about making removal safe and making the metric serve the codebase instead of the other way around.

---

## Prerequisites

- The [middle tier](middle.md): reachability limits, the reflective false-positive trap, metric definitions, baselining.
- You have run static analysis in CI and tuned a gate.
- You understand Goodhart's law at least in slogan form ("a measure that becomes a target ceases to be a good measure").
- Familiarity with version-control history tools (`git log`, churn).

---

## Glossary

| Term | Meaning |
|---|---|
| **Entry point** | Any root from which execution can begin: `main`, handlers, cron, tests, exported API, reflective dispatch. |
| **Call-graph soundness** | A property where every real call edge is represented (impossible with reflection unless modeled). |
| **Goodhart's law** | When a measure becomes a target, it stops measuring what it did. |
| **Hotspot** | A file/function that is both complex *and* frequently changed — the highest-leverage refactoring target. |
| **Churn** | How often a piece of code changes (commits / lines changed over time). |
| **Tombstone** | A logged marker placed in suspected-dead code to detect runtime calls before deletion. |
| **Ratchet** | A monotonically tightening threshold. |
| **Trend metric** | A measure watched as a slope over time rather than against a fixed line. |

---

## Core Concept 1 — Dead-code removal at scale as a verification problem

At small scale you read the call sites and delete. At scale — millions of lines, dozens of services, plugins, reflection, a public API — you *cannot* read everything, and the analyzer's call graph is provably incomplete. So the question shifts from "did the tool flag it?" to "**can I prove it's unused across all entry points, including the invisible ones — and if not, how do I gather evidence?**"

The failure mode is asymmetric and brutal: a missed deletion of live code is a production incident, while leaving genuinely-dead code costs nothing acute. That asymmetry should make you *conservative* — but not paralyzed, because dead code does carry real long-term cost (maintenance, misleading readers, security surface). The resolution is **runtime confirmation**: combine static analysis (the candidate list) with runtime evidence (proof nothing actually calls it) before deleting.

```console
# Static candidate list (Go): every function with no static caller
$ deadcode -filter "myapp/..." ./... > candidates.txt
$ wc -l candidates.txt
   312 candidates.txt   # 312 candidates — NOT 312 safe deletions
```

312 candidates is a research backlog, not a delete script. The senior turns it into a *prioritized, evidence-gathering* program.

---

## Core Concept 2 — The "all entry points" enumeration

Before trusting any "dead" verdict, enumerate every way code can be entered — because the analyzer only modeled some of them. A working checklist:

- **`main` and `init`** — the obvious roots.
- **HTTP/gRPC/GraphQL handlers** registered by string route or annotation.
- **CLI subcommands** dispatched by name.
- **Background jobs / cron / queue consumers** wired by config.
- **Tests and benchmarks** (a function used *only* by tests is "dead" in prod but the tool may or may not count tests as roots — know your tool's setting).
- **Reflection / dynamic dispatch** — `reflect`, `Method.invoke`, `getattr`.
- **DI containers** — Spring beans, NestJS providers, Guice modules.
- **Serialization** — JSON/protobuf/ORM (de)serialization touching getters/setters/constructors.
- **Plugin / SPI mechanisms** — `ServiceLoader`, entry-point groups.
- **The public API** — exported symbols whose callers live in *other repos*. For a library, "no in-repo caller" is the normal, correct state.
- **Build-time codegen** that emits calls into generated files the analyzer may exclude.
- **Feature flags** gating code that's off today but shipped.

```console
# Make tests count as roots so test-only helpers aren't falsely "dead"
$ deadcode -test ./...
```

The discipline: for each candidate, walk this list and ask "could any of these reach it?" A `webhook_handler` flagged dead with reflection and an annotation present is almost certainly a false positive. A private helper with truly zero references is almost certainly real. Triage accordingly.

---

## Core Concept 3 — Safe-deletion playbook: deprecate, observe, delete

When static analysis can't *prove* a symbol dead and you can't manually rule out every entry point, gather runtime evidence. The pattern is **deprecate → observe → delete**, often via a **tombstone**:

```go
func legacyExport(o Order) Report {
    // Tombstone: log+alert if this is ever actually called in prod.
    metrics.Incr("deadcode.legacyExport.called")
    log.Warn("DEPRECATED legacyExport invoked",
        "caller", string(debug.Stack()))
    return buildLegacyReport(o)
}
```

Steps:

1. **Mark** the candidate deprecated (annotation/comment + lint suppression so the dead-code tool stops re-flagging it during the observation window).
2. **Instrument** with a counter/log that fires on any call, capturing the stack so you learn *who* the invisible caller is.
3. **Observe** for at least one full business cycle — a billing month, a quarterly report run, an annual job. Dead-looking code is often *seasonal*, not dead.
4. **Delete** only after the counter stays at zero across that window. The stack traces from any non-zero counter become your map of the reflective callers the analyzer missed.

This trades calendar time for safety, and it's the only honest way to retire code whose callers you cannot see statically. For truly internal, truly zero-reference private helpers, skip straight to deletion — reserve the ceremony for code with plausible invisible callers.

---

## Core Concept 4 — Complexity as a proxy: defect risk and test difficulty

Cyclomatic complexity matters because it *correlates* with two things teams care about:

- **Test difficulty.** N independent paths require ~N tests for path coverage. High complexity literally means more cases to cover, so under-tested functions cluster at high complexity.
- **Defect density.** Empirically, defects concentrate in complex functions — though the effect is confounded by size, and many studies find lines-of-code predicts defects about as well as cyclomatic complexity does. So complexity is a *useful, imperfect* proxy, not a law.

The senior stance: use complexity to **target attention and tests**, not to pronounce judgment. A complexity-12 function with 3 tests is a louder risk signal than a complexity-20 function with 25 tests. Crossing complexity with coverage is far more informative than either alone:

```text
                 high complexity      low complexity
  low coverage   ── DANGER ──         watch
  high coverage  managed risk          fine
```

The DANGER quadrant — complex *and* under-tested — is where senior effort belongs. That's the real meaning of "complexity as a proxy": it points at risk, and you confirm or refute it with coverage and history.

---

## Core Concept 5 — Gaming cyclomatic complexity (Goodhart in miniature)

The moment cyclomatic complexity becomes a *hard gate*, people optimize the number instead of the code — Goodhart's law in miniature. The classic dodge: **split a function purely to dock the score**, with no conceptual boundary.

```go
// Before: one honest function, cyclomatic 16, fails the gate.
func handle(req Request) Response { /* 16 branches, one coherent flow */ }

// "After" gaming: same logic, two functions, gate passes — code is WORSE.
func handle(req Request) Response {
    return handlePart2(handlePart1(req)) // arbitrary split; state now threaded
}
func handlePart1(req Request) intermediateState { /* cyclomatic 8 */ }
func handlePart2(s intermediateState) Response   { /* cyclomatic 8 */ }
```

Total complexity didn't fall — it *rose* (a new function, new parameter passing, an artificial `intermediateState` type) — yet the gate is green. The metric improved while the code degraded. Other dodges: replacing an `if`-chain with a less-readable lookup table solely to drop the count; pushing logic into a helper file the scanner doesn't cover; raising the threshold "just for this PR."

Defenses (this is the heart of governing the metric):

- **Treat the number as advisory at the per-PR level, diagnostic at the portfolio level.** A reviewer sees "complexity went 14→16" as a *prompt to look*, not an auto-block.
- **Pair the gate with code review.** A human catches a pointless split that the linter rewards. The metric flags; the human judges.
- **Watch cognitive complexity alongside cyclomatic.** Pointless splits that thread state often *raise* cognitive complexity, exposing the dodge.
- **Make the threshold soft + ratcheting**, not a brittle hard line that incentivizes cliff-edge gaming.

This connects directly to [Engineering Metrics & DORA](../../engineering-metrics-and-dora/), where Goodhart effects on developer metrics are the central governance problem.

---

## Core Concept 6 — Trend over time vs absolute threshold

An absolute threshold ("no function over 15") asks a binary question. A **trend** ("is total/average complexity rising or falling release over release?") asks the question that actually predicts maintainability — and it's far harder to game across a whole codebase than a single function is.

```console
# Track project-wide average complexity over time (Python)
$ radon cc --average --total-average mypackage/
...
Average complexity: A (2.91)

# Capture into a time series your dashboard plots
$ radon cc -j mypackage/ | jq '[.. | .complexity? // empty] | add/length'
3.04   # last release was 2.91 — slope is up, investigate why
```

Use both, for different audiences:

- **Per-PR gate (absolute, soft):** "this new function is complexity 22 — justify or refactor." Catches local regressions at the cheapest moment.
- **Portfolio trend (slope):** "average complexity has risen four releases straight" — a leading indicator of decaying maintainability that no single PR would reveal.

A rising trend with every individual gate green is the signature of either gaming or a thousand small concessions. The slope catches what the line misses.

---

## Core Concept 7 — Targeting refactoring with the metrics

Metrics earn their keep by *directing* refactoring effort. The workflow:

1. **Rank** functions by complexity (or cognitive complexity for readability work).
2. **Filter** to those that are also under-tested (low coverage) or frequently changed (high churn) — the high-leverage subset.
3. **Refactor the highest-leverage few**, using the **refactoring-techniques** and **function-design** skills: Extract Function along *conceptual* seams, Replace Nested Conditional with Guard Clauses, Decompose Conditional. Crucially, refactor for clarity — the complexity drop should be a *consequence* of a real conceptual split, not the goal.
4. **Add tests first** (characterization tests) so the refactor is provably behavior-preserving — high complexity made tests hard, so this is exactly where they were missing.
5. **Re-measure** to confirm cyclomatic *and* cognitive both improved. If only cyclomatic moved, suspect a cosmetic split.

```console
# Before refactoring priceOrder (from middle tier): cyclomatic 10
# After extracting hazmatSurcharge() and tierMultiplier() along real seams:
$ gocyclo -top 5 .
4 main priceOrder       price.go:3:1     # core loop now reads top-to-bottom
3 main hazmatSurcharge  price.go:30:1
2 main tierMultiplier   price.go:40:1
```

Note the contrast with gaming: here the split follows genuine concepts (hazmat rules, tier rules), each piece is independently testable and nameable, and *both* metrics fell. That's the difference between refactoring and gaming — same mechanical move, opposite intent and outcome.

---

## Core Concept 8 — Portfolio view: hotspots = complexity × churn

A complexity ranking alone over-invests in stable, complex code that nobody ever touches (a gnarly but frozen parser is low-risk). The senior portfolio metric is the **hotspot**: code that is both **complex and frequently changed**. High churn × high complexity is where bugs are introduced fastest and reviews are hardest — the maximum return on refactoring.

```console
# Churn: files changed most often in the last year
$ git log --since="1 year ago" --name-only --pretty=format: \
    | grep -E '\.(go|ts|py)$' | sort | uniq -c | sort -rn | head
    142 internal/billing/engine.go
     98 internal/auth/session.go

# Cross-reference with complexity: engine.go is also the worst gocyclo offender
$ gocyclo -top 1 internal/billing/engine.go
27 billing computeInvoice engine.go:88:1
```

`billing/engine.go` — changed 142 times *and* harboring a complexity-27 function — is the textbook hotspot. Tools like Code Climate and CodeScene formalize this (CodeScene's "behavioral code analysis" is essentially complexity × churn × team-coupling). Feed the ranked hotspot list into [Technical Debt Management](../../technical-debt-management/) to prioritize debt by *risk-weighted* leverage rather than by gut feel.

---

## Real-World Examples

**The seasonal "dead" code.** A team deleted a report generator that `deadcode` flagged and that nobody had touched in 11 months. It was the *annual* tax-summary job, invoked by a cron-registered string name the analyzer couldn't see. It failed silently in production at fiscal year-end. The fix that should have run first: a tombstone counter observed across a full year.

**The gamed gate.** A team's `complexity: 15` ESLint gate produced a wave of `processStepA/B/C` helper triplets — functions split at arbitrary points to pass CI. Cyclomatic fell; cognitive complexity *rose* (state threaded through new parameters), and bug rates in those modules didn't improve. They switched the gate to advisory, added cognitive complexity tracking, and leaned on review. The gaming stopped.

**Hotspot-driven cleanup.** Instead of "reduce complexity everywhere," an org ranked files by complexity × churn and refactored the top 10. Those 10 files (under 2% of the codebase) accounted for ~40% of recent production incidents; cleaning them measurably dropped the incident rate, while the long tail of stable-complex files was correctly left alone.

---

## Mental Models

- **Dead-code removal is verification, not deletion.** The analyzer gives candidates; runtime evidence gives proof.
- **The cost is asymmetric.** Wrong deletion = incident; left-in dead code = slow drag. Be conservative, but not frozen.
- **Complexity is a proxy, not a verdict.** It points at risk; coverage and churn confirm or refute it.
- **Goodhart guards everything.** The instant a metric is a hard target, expect the number to improve and the code to degrade.
- **Trend beats threshold.** A rising slope with all gates green is the smell of gaming or slow rot.
- **Hotspots, not headcounts.** Complexity × churn finds the few files worth your weekend.

---

## Common Mistakes

| Mistake | Why it bites | Better |
|---|---|---|
| Deleting analyzer-flagged code without runtime confirmation | Seasonal / reflective callers are invisible to the call graph | Tombstone, observe a full cycle, then delete |
| Hard cyclomatic gate with no review | Invites pointless function-splitting (Goodhart) | Soft/advisory + review + watch cognitive too |
| Watching only absolute thresholds | Misses codebase-wide drift; every PR green while rot accumulates | Track the trend slope per release |
| Refactoring the most complex code regardless of churn | Wastes effort on frozen, low-risk modules | Prioritize complexity × churn hotspots |
| Refactoring without characterization tests first | High complexity meant low coverage; you can't prove behavior held | Add tests, then refactor along real seams |
| Reporting cyclomatic dropped as success | A cosmetic split lowers it while worsening the code | Confirm cognitive complexity dropped too |

---

## Test Yourself

1. Why is dead-code removal at scale a verification problem rather than a deletion problem? What makes the cost asymmetric?
2. Enumerate at least eight "entry points" that can make live code look dead to a call-graph analyzer.
3. Design a safe-deletion process for a function you *suspect* is dead but cannot prove statically.
4. Show how splitting a function can lower cyclomatic complexity while making the code worse. How do you detect this dodge?
5. Contrast a per-PR absolute complexity gate with a portfolio trend metric — what does each catch that the other misses?
6. Define a hotspot and explain why complexity × churn beats complexity alone for prioritizing refactoring.

---

## Cheat Sheet

```text
SAFE DEAD-CODE REMOVAL
  1. static candidate list (deadcode/staticcheck/knip) — NOT a delete script
  2. walk ALL entry points: main, handlers, cron, tests, reflection, DI,
     serialization, plugins, PUBLIC API (external callers!), codegen, flags
  3. unprovable? tombstone (counter+stack) → observe ≥ 1 business cycle → delete
  4. truly-zero-ref private helper → delete now

COMPLEXITY GOVERNANCE
  proxy for: test difficulty + defect risk (imperfect, size-confounded)
  per-PR     → soft/advisory threshold + human review   (catches local regression)
  portfolio  → TREND slope per release                  (catches drift & gaming)
  prioritize → HOTSPOTS = complexity × churn            (max leverage)

GOODHART DEFENSE
  hard gate → people split functions pointlessly (cyclomatic ↓, cognitive ↑, code worse)
  defenses: advisory + review + track cognitive too + ratchet, never brittle line

REFACTOR FOR CLARITY, NOT THE NUMBER
  characterization tests → extract along real seams → confirm BOTH metrics dropped
```

---

## Summary

At scale, removing dead code is a verification problem: the call graph is incomplete by construction, the cost of a wrong deletion is a production incident, and "the tool flagged it" is the *start* of the work, not the end. Enumerate every entry point — including reflection, DI, serialization, plugins, and the external-only public API — and when you can't prove a symbol dead, **tombstone it, observe across a full business cycle, then delete**, harvesting the stack traces of any invisible callers. On complexity, treat the number as a *proxy* for test difficulty and defect risk: cross it with coverage and churn to find the DANGER quadrant and the hotspots worth refactoring. Above all, govern the metric against Goodhart — hard gates breed pointless function-splitting that improves the number while degrading the code — by keeping per-PR thresholds advisory, pairing them with review, watching cognitive complexity, and judging the codebase by its **trend** rather than any single line.

---

## Further Reading

- Adam Tornhill, *Software Design X-Rays* / *Your Code as a Crime Scene* — complexity × churn hotspots and behavioral code analysis.
- Norman Fenton & Martin Neil, *Software Metrics: A Rigorous and Practical Approach* — what complexity does and doesn't predict.
- Martin Fowler, *Refactoring* (2nd ed.) — Extract Function, guard clauses, decompose conditional.
- Michael Feathers, *Working Effectively with Legacy Code* — characterization tests before changing complex code.
- SonarSource *Cognitive Complexity* white paper — the readability-oriented metric.

---

## Related Topics

- [Technical Debt Management](../../technical-debt-management/) — prioritizing debt by risk-weighted hotspots.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — Goodhart's law as the central metrics-governance problem.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity within the broader metrics portfolio.
- [Taint & Data-Flow Analysis](../08-taint-and-dataflow-analysis/) — rigorous interprocedural reachability.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — wiring trend tracking and soft gates into the pipeline.
- The **refactoring-techniques**, **function-design**, and **code-smell-detection** skills.
