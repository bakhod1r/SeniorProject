# Dead Code & Complexity — Interview Level

> **Roadmap:** [Static Analysis](../README.md) → Dead Code & Complexity

*A question bank for the dead-code-and-complexity slice of a static-analysis interview — what reachability can and can't prove, what the metrics measure, and how not to get gamed.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Metrics & Gaming](#metrics--gaming)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering, crisply and with judgment, the questions interviewers use to separate "ran a linter once" from "governs code health for a team."**

The questions cluster in three places: the *decidability* of dead-code detection (do you know why tools must guess?), the *definition and limits* of complexity metrics (do you know what cyclomatic ignores?), and the *governance* of both (do you know what happens when a metric becomes a target?). The strongest answers always pair a precise definition with the engineering judgment of where it breaks. A candidate who can recite "cyclomatic = 1 + decisions" but can't explain why a flat 30-case switch isn't a problem has read the docs but hasn't done the job.

---

## Prerequisites

- The [junior](junior.md) through [senior](senior.md) tiers; the [professional tier](professional.md) for the org-scale questions.
- Be able to derive cyclomatic complexity by hand and explain the reflective false-positive trap from memory.

---

## Fundamentals

**Q: What is dead code, and what are its varieties?**
*What's really being tested: vocabulary and breadth.*
**A:** Code that has no effect on program behavior. Varieties: unused imports, unused variables (assigned, never read), unused functions/methods, unused parameters, unreachable statements (after `return`/`break`/`throw`/`panic`), and dead branches (conditions always or never true). Removing any of it leaves behavior unchanged.

---

**Q: Why is detecting "unreachable code after a return" easy and certain, but "this function is never called" sometimes not?**
*What's really being tested: control-flow vs whole-program analysis, and the decidability boundary.*
**A:** The first is *intraprocedural* control-flow analysis: build the function's control-flow graph; a block with no incoming edge is unreachable — purely structural, decidable, exact. The second is *whole-program* reachability over the call graph, which depends on having every call edge. Calls made through reflection, dynamic dispatch, DI containers, serialization, or dynamic imports don't appear as static edges, so the analyzer can't see them and must guess.

---

**Q: Is dead-code detection decidable in general?**
*What's really being tested: theoretical grounding.*
**A:** No. General dead-code / reachability detection is undecidable — by Rice's theorem, any non-trivial semantic property of programs is undecidable; reachability of a branch can encode the halting problem. So real tools approximate. They choose to be **sound** (never miss real dead code, accepting false positives) or **precise** (never wrongly flag live code, accepting false negatives). Most dead-code tools lean sound and over-report, which is why their output is a worklist, not a delete script.

---

**Q: What's the difference between cyclomatic and cognitive complexity?**
*What's really being tested: do you know each measures a different thing?*
**A:** **Cyclomatic** (McCabe) counts independent paths: `1 + number of decision points` (if/case/loop/`&&`/`||`/`?:`). It approximates the number of tests for path coverage but is blind to nesting and readability. **Cognitive** (SonarSource) measures how hard code is to *understand*: it increments for breaks in linear flow and multiplies by nesting depth, but does *not* penalize a flat `switch`. A flat 30-case switch scores ~31 cyclomatic but low cognitive — correctly reflecting that it's easy to read.

---

## Technique

**Q: Walk me through deriving the cyclomatic complexity of a function.**
*What's really being tested: can you actually compute it, including the `&&` gotcha.*
**A:** Start at 1. Add 1 for each `if`, `else if`, `case`, `for`, `while`, ternary, and each short-circuit `&&`/`||` (each creates a real branch). Example: a `for` loop containing one `if`, plus a top-level `if a && b` → 1 (base) + 1 (for) + 1 (inner if) + 1 (if) + 1 (`&&`) = 5. The `&&` catches people out: rewriting nested `if`s as `a && b` does *not* lower cyclomatic complexity, because the branches still exist — though it does lower cognitive complexity by removing nesting.

---

**Q: A dead-code tool flags a function. Before deleting it, what do you check?**
*What's really being tested: the reflective false-positive trap — the senior-defining answer.*
**A:** I enumerate every entry point the analyzer might not see: reflection (`Method.invoke`, `getattr`), DI containers (Spring beans, NestJS providers), serialization (Jackson getters/setters, ORM constructors), dynamic imports / string routing, plugin/SPI mechanisms (`ServiceLoader`), feature-flagged code, and especially the **public API** — exported symbols whose callers live in other repos, where "no in-repo caller" is normal and correct. If I can't rule all of those out, I don't delete; I tombstone (add a call counter + stack log), observe across a full business cycle to catch seasonal callers, and delete only if it stays at zero.

---

**Q: How do you introduce a complexity gate onto a large legacy codebase without blocking every PR?**
*What's really being tested: baselining and ratcheting.*
**A:** Never a hard absolute gate on day one — it would fail every PR and breed gaming. Instead baseline: snapshot existing violations and grandfather them, then fail CI only on *new or worsened* ones (`golangci-lint run --new-from-rev=origin/main`, `xenon` in new-code mode). Then ratchet the ceiling down over time, never up. This converts "fix 400 violations or disable the rule" into "don't add a 401st."

---

**Q: When does dead-code removal actually pay off?**
*What's really being tested: economic judgment, not reflexive "cleanup is good."*
**A:** Removal has real cost (verification effort, regression risk on false positives) and mostly deferred benefit, so I time it. It pays most before a large migration (don't port dead code), when dead code inflates the attack surface (unused auth/crypto paths), or when it blocks a dependency removal. I defer it for stable, isolated code with plausible external callers and no migration on the horizon. The trivial tier — unused imports and locals — I auto-fix in CI and never debate.

---

## Metrics & Gaming

**Q: Show me how a hard cyclomatic-complexity gate gets gamed.**
*What's really being tested: Goodhart's law, concretely.*
**A:** People split a function purely to dock the score, with no real conceptual boundary — e.g. `handle()` becomes `handlePart1()` + `handlePart2()` threading an artificial intermediate state. Total complexity doesn't fall (it often rises, plus new parameter passing), and cognitive complexity *increases* from the threaded state — but the per-function gate goes green. The metric improved while the code got worse. That's Goodhart: a measure turned into a target stops measuring what it did.

---

**Q: How do you defend a complexity metric against gaming?**
*What's really being tested: structural governance, not wishful thinking.*
**A:** Structurally. Keep per-PR thresholds advisory and paired with human review (a reviewer catches the pointless split the linter rewards). Pair cyclomatic with a balancing metric — cognitive complexity, or coverage — since gaming one usually degrades its pair, exposing the dodge. Report distributions and trends, never per-team or per-engineer leaderboards. Never tie complexity to performance reviews — that's the single fastest way to corrupt it. And audit sudden cliff-drops in a service's complexity before a deadline as a gaming signal.

---

**Q: Per-PR threshold vs portfolio trend — which matters more?**
*What's really being tested: scope judgment.*
**A:** They answer different questions, so I use both. The per-PR threshold (soft) catches local regressions at the cheapest moment. The portfolio trend — average complexity or the complexity-per-KLOC slope per service over quarters — predicts maintainability and is far harder to game across a whole codebase. A rising trend with every individual gate green is the signature of either gaming or a thousand small concessions; only the slope catches it. Investment decisions come from the trend, not the gate.

---

**Q: Is the Maintainability Index a good single metric?**
*What's really being tested: skepticism of composite scores.*
**A:** No. It compresses orthogonal signals (Halstead volume, cyclomatic complexity, comment ratio) into one number, which hides *which* signal is the problem and is trivially gamed — adding comments raises the score without improving anything. I prefer a small dashboard of orthogonal signals (complexity trend, coverage on complex code, churn, incidents) so the picture can't be moved by one cheap lever.

---

**Q: Does high cyclomatic complexity cause bugs?**
*What's really being tested: distinguishing correlation, causation, and confounding.*
**A:** It correlates with defect density and clearly increases test difficulty (more paths to cover), but it doesn't *cause* bugs and the relationship is confounded by size — several studies find lines-of-code predicts defects about as well. So I treat it as a useful, imperfect proxy: it points me at code worth attention, which I confirm by crossing with coverage and churn. I never claim it as causal, because over-claiming erodes the metric's credibility.

---

## Scenarios

**Q: How does a tool actually decide a function is unreachable?**
*What's really being tested: do you understand the underlying graph, not just the command.*
**A:** For "after return," it builds the function's control-flow graph (basic blocks as nodes, possible transfers as edges) and reports any block with no incoming edge. For "never called," it builds a whole-program call graph: it seeds the roots (`main`, `init`, exported handlers, and — if configured — tests) and marks every function transitively reachable through call edges; anything left unmarked is reported. The accuracy is entirely a function of call-graph completeness, which reflection and dynamic dispatch break.

---

**Q: Should test-only helper functions count as dead code?**
*What's really being tested: nuance about entry points and tool configuration.*
**A:** It depends on intent and tool config. A helper used only by tests is dead in *production* but not actually dead. Most tools let you choose whether tests are roots (`deadcode -test ./...`). If you exclude tests as roots, test-only helpers get flagged — usually a false positive. The right move is to know your tool's setting and decide deliberately: include tests as roots if you want test-only code to count as live.

---

**Q: A teammate deleted six methods the IDE marked grey. Production broke. What happened and how do you prevent it?**
*What's really being tested: the DI/reflection blind spot and process design.*
**A:** The methods were almost certainly invoked reflectively or by a framework — DI event listeners, serialization hooks, or annotation-dispatched handlers — so they had no static caller and looked unused. Prevention: never delete framework-adjacent symbols on the IDE's word; maintain an org allowlist for the systematic blind spots (DI bean naming, serialization annotations); and for anything not provably unused, tombstone-observe-delete. Integration tests help but are a backstop, not the primary control.

---

**Q: Leadership wants a single "code health score" to track quarterly. How do you respond?**
*What's really being tested: protecting metrics from misuse while staying useful.*
**A:** I'd push back on a single score — it invites false confidence and gaming — and offer instead a small dashboard: incident/change-failure trend as the headline outcome, with complexity and coverage trends for the implicated services as the *explanation*. I'd report distributions and slopes, not absolute composites, and I'd refuse a per-team leaderboard because domain difficulty varies (a query planner is legitimately more complex than a CRUD service). The ask becomes "fund these three hotspots to cut incidents," tied to risk, not aesthetics.

---

**Q: You have 312 dead-code candidates from `deadcode ./...`. What now?**
*What's really being tested: scale judgment — verification, not deletion.*
**A:** 312 candidates is a research backlog, not 312 safe deletions. I triage: truly-zero-reference private helpers get deleted now (zero risk); anything with plausible invisible callers (reflection/DI/serialization/public API) goes through tombstone-observe-delete. At org scale the binding constraint is *verification*, so I'd invest in shared infrastructure — tombstone-as-a-service and a central false-positive allowlist — rather than grinding through deletions one risky guess at a time, and add a `--new-from-rev` gate to stop new dead code at the PR that introduces it.

---

## Rapid-Fire

**Q: Cyclomatic complexity of a function with no branches?** A: 1.

**Q: Does `&&` add to cyclomatic complexity?** A: Yes — each short-circuit operator is a branch.

**Q: Does a flat `switch` raise cognitive complexity much?** A: No — cognitive complexity doesn't penalize a flat switch; cyclomatic does.

**Q: One Go-specific dead-code fact?** A: Unused imports and unused local variables are *compile errors*, not warnings.

**Q: Why does `vulture` print confidence percentages?** A: Because it can't be certain a name is unused — reflection/dynamic use is invisible to it.

**Q: Tool to find unused TS exports?** A: `ts-prune` or `knip`.

**Q: ESLint rule for unused variables?** A: `no-unused-vars`. For unreachable code: `no-unreachable`.

**Q: What theorem makes general dead-code detection undecidable?** A: Rice's theorem.

**Q: Sound vs precise dead-code tool?** A: Sound = never miss dead code (false positives); precise = never wrongly flag live code (false negatives).

**Q: Best refactoring target signal?** A: Hotspot = high complexity × high churn (× low coverage).

**Q: Why baseline complexity on legacy code?** A: So CI fails only on new/worsened violations, not the existing 400.

**Q: One structural Goodhart defense?** A: Never put complexity in performance reviews (or: keep gates advisory + reviewed).

**Q: Fan-in of 0 means what?** A: No callers — a dead-code candidate (unless reached reflectively).

**Q: Tombstone-as-a-service is for?** A: Cheap, standardized runtime verification of suspect-dead symbols across many teams.

**Q: Per-function or per-file complexity threshold?** A: Per-function — per-file averages hide one monster among many trivial functions.

**Q: Common cyclomatic thresholds?** A: ~10 watch, ~15 justify, >20 likely too much.

**Q: Why prefer complexity-per-KLOC over absolute for trends?** A: Absolute scales with size; normalized lets you compare across services.

---

## Red Flags / Green Flags

**Green flags (strong candidate):**
- Distinguishes intraprocedural (decidable) from whole-program (undecidable) reachability and names Rice's theorem.
- Volunteers the reflective/DI/serialization/public-API false-positive trap without prompting.
- Knows `&&` counts toward cyclomatic and that a flat switch doesn't hurt cognitive complexity.
- Treats metrics as proxies/signals and reaches for tombstone-observe-delete and complexity × churn.
- Talks about Goodhart and *structural* defenses (advisory gates, no perf-review tie, balancing metrics).

**Red flags (weak candidate):**
- "The tool said it's dead, so I deleted it" — no awareness of false positives.
- Thinks high cyclomatic complexity directly *causes* bugs, or that lowering the number always improves code.
- Wants a single composite "health score" with no awareness of gaming.
- Would impose a hard complexity gate on a legacy repo on day one.
- Can't compute cyclomatic complexity by hand or forgets `&&`.
- Conflates cyclomatic and cognitive complexity as "the same thing."

---

## Cheat Sheet

```text
DECIDABILITY
  after return            → intraprocedural CFG, decidable, exact
  "ever called?"          → call graph, undecidable in general (Rice's theorem)
  tools choose: SOUND (false positives) vs PRECISE (false negatives); most are sound

FALSE-POSITIVE TRAP (verify before deleting)
  reflection · DI containers · serialization · dynamic import · plugins · PUBLIC API
  unprovable → tombstone (counter+stack) → observe a full business cycle → delete

METRICS
  cyclomatic = 1 + decisions (incl. && ||)  → ≈ #tests, blind to nesting
  cognitive  = flow-breaks × nesting        → readability, ignores flat switch
  high number = SMELL not verdict; proxy for risk, confounded by size

GOVERNANCE
  legacy → baseline + ratchet (--new-from-rev)
  per-PR gate soft+reviewed · portfolio = TREND slope · refactor HOTSPOTS (cx×churn)
  Goodhart: hard gate → pointless splits (cyclomatic↓, cognitive↑, code worse)
  defenses: advisory · balancing metric · no leaderboards · NOT in perf reviews
  no single composite score (Maintainability Index is gameable)
```

---

## Summary

The interview probes three things. **Decidability:** intraprocedural reachability is exact, whole-program is undecidable (Rice's theorem), so tools approximate and over-report — the candidate must know the reflective/DI/serialization/public-API false-positive trap and the tombstone-observe-delete remedy. **Metrics:** cyclomatic counts branches (including `&&`) and approximates test count but is blind to nesting; cognitive weights nesting for readability and ignores a flat switch; both are proxies, confounded by size, never verdicts. **Governance:** baseline-and-ratchet for legacy, soft per-PR gates plus portfolio trends, complexity × churn for prioritization, and structural Goodhart defenses — balancing metrics, no leaderboards, never in performance reviews, no single composite score. The differentiator is always judgment: pairing each precise definition with where it breaks.

---

## Further Reading

- Thomas McCabe, *A Complexity Measure* (1976); SonarSource *Cognitive Complexity* white paper.
- H. G. Rice (1953) — the undecidability theorem.
- Adam Tornhill, *Software Design X-Rays* — hotspots and behavioral code analysis.
- Nicole Forsgren et al., *Accelerate* — outcome metrics and the danger of vanity/individual metrics.
- `deadcode`, `gocyclo`, `radon`/`xenon`, `knip`, `vulture` project docs.

---

## Related Topics

- [Linters & Style Checkers](../01-linters-and-style-checkers/) — where unused-symbol rules live.
- [Taint & Data-Flow Analysis](../08-taint-and-dataflow-analysis/) — rigorous interprocedural reachability.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — baselines, soft gates, SARIF.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — Goodhart and outcome metrics.
- [Technical Debt Management](../../technical-debt-management/) — prioritizing debt from static signals.
- The **refactoring-techniques**, **function-design**, and **code-smell-detection** skills.
