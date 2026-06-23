# Taint & Data-Flow Analysis — Professional Level

> **Roadmap:** [Static Analysis](../README.md) → Taint & Data-Flow Analysis

*Deep data-flow vs pattern matching as a budget decision; custom queries and framework models as an org capability; running it at monorepo scale.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Deep Data-Flow vs Pattern Matching: The Cost Decision](#core-concept-1--deep-data-flow-vs-pattern-matching-the-cost-decision)
5. [Core Concept 2 — Modeling Your Frameworks: Sources, Sinks, Steps, Barriers](#core-concept-2--modeling-your-frameworks-sources-sinks-steps-barriers)
6. [Core Concept 3 — Custom Queries as a Maintained Asset](#core-concept-3--custom-queries-as-a-maintained-asset)
7. [Core Concept 4 — Tuning Precision for Signal](#core-concept-4--tuning-precision-for-signal)
8. [Core Concept 5 — Running It at Scale: Monorepos, Incremental, Diff-Aware](#core-concept-5--running-it-at-scale-monorepos-incremental-diff-aware)
9. [Core Concept 6 — The Soundy Gap as an Operational Risk Register](#core-concept-6--the-soundy-gap-as-an-operational-risk-register)
10. [Core Concept 7 — The Research-to-Practice Gap](#core-concept-7--the-research-to-practice-gap)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **deciding when deep data-flow earns its cost over pattern matching, building the custom-query and framework-modeling capability that makes either tool find *your* bugs, and operating it across a large codebase without the team learning to ignore it.**

At this tier the question is no longer "what is taint analysis" but "what should the organization *do* with it." Deep interprocedural data flow (CodeQL) is powerful and expensive; pattern matching (Semgrep) is cheap and shallow. Neither finds anything useful out of the box on a real codebase with custom frameworks — both require **models** and **tuning**. The professional job is to spend the analysis budget where it converts to caught vulnerabilities, to build modeling/query capability as a durable asset, and to run it at scale on every PR without drowning the org in noise or latency.

## Prerequisites

- The [senior](senior.md) tier: monotone frameworks, precision axes, soundness vs completeness, CodeQL configs.
- Operating experience with CI gates — see [Static Analysis in CI](../09-static-analysis-in-ci/).
- Familiarity with your org's web framework(s), ORMs, and RPC layer — you'll be modeling them.
- Helpful: the [SAST & Security Scanners](../04-sast-security-scanners/) professional tier for program/governance context.

## Glossary

| Term | Meaning |
|------|---------|
| **Model / stub** | A declaration teaching the analyzer a function's taint behavior (source/sink/step/barrier) without its body. |
| **Taint step** | A custom propagation edge: "taint flows from this arg to this return." |
| **Barrier** | CodeQL's term for a sanitizer node that blocks flow. |
| **Query pack** | A versioned, distributable set of custom queries and models. |
| **MRVA** | Multi-Repository Variant Analysis — running one CodeQL query across many repos at once. |
| **Diff-aware scan** | Analyzing/reporting only on code changed in a PR, not the whole tree. |
| **Baseline** | A snapshot of existing findings, suppressed so only *new* findings gate. |
| **TP/FP/FN** | True positive / false positive / false negative. |
| **Triage rate** | Fraction of findings a human can disposition per unit time — the real throughput limit. |
| **Coverage (analysis)** | Fraction of source→sink paths the modeling actually lets the tool see. |

## Core Concept 1 — Deep Data-Flow vs Pattern Matching: The Cost Decision

The two engines are not competitors; they sit at different points on a cost/depth curve. The professional decision is *which class of bug justifies which engine*.

| | **Pattern matching (Semgrep)** | **Deep data flow (CodeQL)** |
|---|---|---|
| Finds | local, syntactic anti-patterns; org conventions | cross-function, cross-file injection where source/sink are far apart |
| Authoring | minutes; readable YAML; any engineer | hours/days; a real query language; specialist skill |
| Runtime | seconds; runs in pre-commit | minutes–hours; database build dominates |
| FP profile | misses flows it can't see (FN-heavy) | infeasible-path / context FPs unless modeled |
| Best for | "never call `os.system`," secret patterns, framework misuse | "does *any* untrusted input reach *any* SQL sink anywhere" |

**The rule of thumb:** use pattern matching for **dense, local, high-frequency** checks you want on every keystroke, and reserve deep data flow for the **sparse, cross-cutting, high-severity** classes (injection, SSRF, deserialization) where the bug *is* the long flow and a pattern can't see it. Spending CodeQL's cost on something Semgrep catches locally is waste; trying to catch a 6-hop interprocedural SQLi with a Semgrep pattern is a guaranteed false negative. A mature program runs **both**: Semgrep broad and fast in the inner loop, CodeQL deep and scheduled for the flow-shaped vulnerabilities.

## Core Concept 2 — Modeling Your Frameworks: Sources, Sinks, Steps, Barriers

Out of the box, an analyzer knows the *standard library* and a handful of popular frameworks. It knows nothing about *your* RPC framework, *your* template engine, or *your* `db` wrapper. **Until you model them, taint dies at your framework boundary and the tool finds almost nothing.** Modeling is the single highest-leverage activity in running these tools.

Four things you model:

- **Sources** — your framework's request accessors, message-queue consumers, CLI parsers, and *internal* trust boundaries (e.g. fields other tenants can write).
- **Sinks** — your `db.query` wrapper, your templating render, your shell helper, your URL fetcher (SSRF).
- **Taint steps** — propagation through wrappers the tool can't see into: `taint(arg) ⇒ taint(return)` for a builder, a DTO mapper, a serializer.
- **Barriers (sanitizers)** — your vetted `parameterize()`, your context-aware HTML encoder, your allow-list validator.

A CodeQL model extending the configuration with a custom step and a custom sink for *your* framework:

```ql
import semmle.python.dataflow.new.TaintTracking

// Teach CodeQL that OUR request wrapper is a source.
predicate isCompanySource(DataFlow::Node n) {
  exists(Call c |
    c.getFunc().(Attribute).getName() = "get_param" and
    c.getFunc().(Attribute).getObject().(Name).getId() = "ctx" and
    n.asExpr() = c
  )
}

// Teach it that OUR query builder propagates taint arg -> return (a taint STEP).
predicate companyTaintStep(DataFlow::Node pred, DataFlow::Node succ) {
  exists(Call c |
    c.getFunc().(Name).getId() = "build_sql" and
    pred.asExpr() = c.getArg(0) and
    succ.asExpr() = c
  )
}

// Teach it that OUR vetted parameterizer is a barrier (sanitizer).
predicate isCompanyBarrier(DataFlow::Node n) {
  exists(Call c | c.getFunc().(Name).getId() = "parameterize" and n.asExpr() = c)
}
```

Semgrep models the same concepts more cheaply with `pattern-sources`/`pattern-sinks`/`pattern-sanitizers` and `pattern-propagators`. Pysa uses `.pysa` model files (`def app.get_param() -> TaintSource[UserControlled]: ...`). The mechanism differs; the discipline is identical: **the tool's recall on your code equals the completeness of your models.** A finding count that *drops* after onboarding a new framework usually means missing models, not a clean codebase.

## Core Concept 3 — Custom Queries as a Maintained Asset

Custom queries and models are **code** — they rot, they need owners, tests, and versioning. Treat them as a product:

- **Source of truth & review.** Queries live in a repo, reviewed like any change. A query that gates merges has the same blast radius as production config.
- **Tests.** Every custom query ships with `.expected` test fixtures (CodeQL's query-test harness; Semgrep's `--test`): positive cases that *must* fire and negative cases that *must not*. Without tests, a model edit silently turns off detection org-wide.
- **Versioning & distribution.** Package as **query packs** with semantic versions; pin them in CI so a query update is a deliberate, reviewable bump, not an invisible behavior change.
- **Ownership.** A named team (security or a platform guild) owns the pack, triages new false-positive reports, and adds models when frameworks change. Unowned query packs become noise everyone suppresses.
- **Variant analysis as a capability.** When a vulnerability is found, write the query that finds *that class everywhere* (CodeQL MRVA across all repos). Turning each incident into a permanent, org-wide query is the compounding payoff of the investment.

The capability — not any single query — is the asset: a team that can model a new framework in a day and convert an incident into a fleet-wide query in an afternoon.

## Core Concept 4 — Tuning Precision for Signal

The metric that matters is not findings, it's **actioned true positives per unit of human triage time.** A tool emitting 500 findings at 10% precision is *worse* than one emitting 30 at 80%, because the team learns to ignore the channel. Levers, cheapest first:

1. **Add barriers/sanitizer models.** Most false positives are real flows through a sanitizer the tool didn't know about. Model it; the whole cluster disappears.
2. **Tighten sources/sinks.** Over-broad sources (every string field) and over-broad sinks generate noise. Scope to genuine trust boundaries and genuinely dangerous calls.
3. **Add the right amount of context-sensitivity.** Shared helpers generating fan-out FPs (senior tier) are fixed by per-call-site precision or a precise summary — not by suppressing the helper.
4. **Buy path-sensitivity only as a last resort.** It's the most expensive axis; usually a barrier model of the guard is cheaper and clearer.
5. **Baseline legacy, gate on new.** Snapshot existing findings, suppress them, and gate only on *new* flows in changed code — this is what makes adoption survive contact with a large legacy tree (see [Static Analysis in CI](../09-static-analysis-in-ci/)).

Run a quarterly precision audit: sample findings, label TP/FP, and drive the FP rate of *gating* rules toward a target (often ≥70–80% precision for blocking, lower for advisory). Severity-tier the rules: block on high-precision high-severity flows, advise on the rest.

## Core Concept 5 — Running It at Scale: Monorepos, Incremental, Diff-Aware

CodeQL's cost is dominated by **database construction** (it compiles/extracts the code), which is linear-ish in code size but absolutely large on a monorepo. Strategies that keep deep analysis viable:

- **Diff-aware reporting.** Build is whole-program (flows can cross the diff boundary), but *report* only findings whose path touches changed code. This keeps PR signal relevant without sacrificing interprocedural reach.
- **Caching & incremental builds.** Cache the CodeQL DB and rebuild only changed extraction units where the tooling supports it; otherwise schedule full builds nightly and run lighter Semgrep diff-scans on every PR.
- **Partition the monorepo.** Build per-service or per-language databases rather than one giant DB; trade some cross-service flow visibility for tractable build times, and model the service boundaries explicitly.
- **Two-speed pipeline.** Fast lane: Semgrep diff-scan on every PR (seconds, blocking on high-precision rules). Slow lane: CodeQL deep scan nightly or on merge to main (minutes–hours, files issues / dashboards). Most orgs converge on exactly this split.
- **Distribute and aggregate via SARIF.** Emit SARIF, dedupe across runs, and feed a single triage surface so findings don't fragment across tools.

```
  PR opened ──► Semgrep diff-scan (sec)  ──► block high-precision findings   [fast lane]
        └────► CodeQL (nightly/on-merge, min–hr) ──► dashboard + issues      [slow lane]
                 build DB once · diff-aware report · baseline legacy · SARIF aggregate
```

## Core Concept 6 — The Soundy Gap as an Operational Risk Register

Senior tier established that every tool is **soundy** — sound except a documented set of unsound features. Professionally, that gap is a **risk register you maintain**, not a footnote. For each gap, decide a mitigation:

| Soundy gap | Why the tool misses it | Operational mitigation |
|---|---|---|
| Reflection / dynamic dispatch | call graph holes | model the dispatcher; restrict reflective patterns via a lint rule |
| `eval` / dynamic code | code not present statically | ban via pattern rule (Semgrep); treat as source if unavoidable |
| Deserialization gadgets | objects appear "clean" | model `loads`/`unmarshal` as sources; runtime allow-lists |
| Native / FFI | opaque bodies | hand-written models for each crossing |
| Framework "magic" (DI, ORM hydration) | values assigned invisibly | model the framework's injection points as sources |
| Implicit flows | tools ignore by design | accept the gap; cover with review / dynamic analysis |

The mitigations split across **modeling** (close the gap in the static tool) and **defense in depth** — pairing static taint with the runtime counterpart in [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) and with the rigor of [Formal Methods & Verification](../../formal-methods-and-verification/) for the highest-assurance components. Maturity is *knowing exactly what your toolchain cannot prove* and having a deliberate answer for each line of that list.

## Core Concept 7 — The Research-to-Practice Gap

Academic data-flow analysis assumes whole programs, soundness, and unbounded resources. Production assumes partial code, "soundy," CI time budgets, and humans who'll ignore a noisy channel. Reasoning across that gap is the senior-most skill:

- **What the tool can *prove* vs *suggest*.** A CodeQL path is *evidence* of a flow, not a proof of exploitability — feasibility (auth, reachability, real attacker control) is human judgment. Treat findings as leads, not verdicts.
- **Absence of findings proves almost nothing.** Given Rice's theorem and the soundy gaps, "0 findings" means "the tool, with these models, on this code, found nothing" — never "the code is safe." Communicate this honestly to stakeholders who want a green checkmark.
- **Recall is a function of *your* investment.** Out-of-the-box recall on a custom codebase is low; the published "we found N CVEs" results assume heavy modeling. Budget for modeling or expect to miss the long-tail flows.
- **Precision and recall trade against triage cost, not against each other only.** The binding constraint is human attention; design the program around triage throughput, not theoretical detection power.

## Real-World Examples

- **Two-speed pipeline at scale.** A platform team ran Semgrep diff-scans (blocking, ~20s) on every PR and CodeQL nightly on the monorepo with diff-aware reporting. PR latency stayed flat; deep injection flows still surfaced within a day.
- **Modeling unlocked detection.** After modeling the in-house `Request.attr()` accessor and `Sql.build()` wrapper as a source and taint-step, CodeQL findings on real SQLi went from ~0 to dozens — the code was always vulnerable; the tool just couldn't see across the wrappers.
- **Incident → fleet query.** An SSRF in one service was patched, then encoded as a CodeQL query and run via MRVA across 400 repos, finding 11 more instances of the same class. The query became a permanent gate.
- **The green-checkmark trap.** Leadership read "0 SAST findings" as "secure." The security team had to reframe it: the scanner covered 60% of the trust boundaries by model coverage, and the deserialization path was a known soundy blind spot — mitigated separately at runtime.

## Mental Models

- **Models are the API between your code and the analyzer.** The tool sees your codebase exactly as well as your models describe it — no better.
- **Triage throughput is the bottleneck resource.** Optimize for actioned true positives per analyst-hour, not for raw detection.
- **Two speeds, two purposes.** Pattern matching guards the inner loop; deep data flow guards the long, dangerous flows. Don't make either do the other's job.
- **A finding is a lead; absence is not an alibi.** Static taint proposes; humans (and runtime defenses) dispose.
- **Each soundy gap is a line item you own.** Either close it with a model or cover it with defense in depth — never leave it implicit.

## Common Mistakes

- **Deploying deep data flow with no models and concluding the code is clean.** Zero findings on an unmodeled framework is a measurement of *your models*, not your code.
- **Using CodeQL where Semgrep suffices (or vice versa).** Paying deep-analysis cost for local patterns, or expecting patterns to catch long flows.
- **Letting query packs go unowned.** Unmaintained rules drift, false-positive, and get globally suppressed — worse than not running them.
- **Gating on the whole legacy tree at once.** Without baselining, the first run buries the team and the program dies. Baseline, then gate on new flows.
- **Selling "0 findings" as "secure."** It violates Rice's theorem and ignores the soundy gaps; it destroys credibility when the breach lands in a blind spot.
- **Tuning by suppression instead of modeling.** Suppressing the shared helper hides the real flow too; model the sanitizer or add context-sensitivity instead.

## Test Yourself

1. Give the rule of thumb for choosing pattern matching vs deep data flow, with a bug class each catches that the other misses.
2. Name the four things you model (source/sink/step/barrier) and write a CodeQL taint step for an in-house wrapper.
3. Why does recall on a custom codebase depend on *your* models? What does a sudden drop in findings after a framework migration suggest?
4. Order the precision-tuning levers cheapest-first and justify why barriers come before path-sensitivity.
5. Design a two-speed pipeline for a monorepo; which engine runs where, and what is diff-aware reporting?
6. Turn the soundy gap into an operational risk register: pick three gaps and give a mitigation for each.
7. Why does "0 findings" not mean "secure," and how do you communicate that to leadership?
8. What is the actual bottleneck resource a SAST program optimizes, and what metric expresses it?

## Cheat Sheet

```
ENGINE CHOICE
  pattern (Semgrep)    local, dense, fast, inner-loop, FN-heavy on long flows
  deep DF (CodeQL)     cross-function, sparse, slow, high-severity injection/SSRF/deser
  rule of thumb        both: Semgrep broad+fast, CodeQL deep+scheduled

MODELING (highest leverage)  sources · sinks · taint STEPS · barriers
  recall on YOUR code = completeness of YOUR models
  unmodeled framework ⇒ taint dies at the boundary ⇒ ~0 findings (false comfort)

QUERIES AS ASSET   repo + review + .expected tests + versioned packs + named owner
  variant analysis: incident → query → MRVA across all repos (compounding)

TUNE FOR SIGNAL (cheap→costly)
  1 add barriers  2 tighten src/sink  3 context-sensitivity  4 path-sensitivity (last)
  5 baseline legacy, gate on NEW       metric: actioned TP / analyst-hour

SCALE   DB build dominates · diff-aware REPORT (whole-program build) · partition monorepo
        two-speed: Semgrep diff-scan/PR (block) + CodeQL nightly (dashboard) · SARIF aggregate

SOUNDY GAP = risk register   reflection/eval/deser/native/DI/implicit
  mitigate per line: model it OR defense-in-depth (runtime taint, review, formal)
RICE'S THEOREM ⇒ "0 findings" ≠ "secure"; a finding is a LEAD not a verdict
```

## Summary

Professionally, taint analysis is a **budget and capability** problem. Deep data flow (CodeQL) and pattern matching (Semgrep) sit at different cost/depth points: run patterns broad and fast in the inner loop, reserve deep data flow for the sparse, high-severity, *flow-shaped* vulnerabilities a pattern can't see — and run both. Neither finds your bugs until you **model your frameworks** (sources, sinks, taint steps, barriers); recall equals model completeness, so modeling is the highest-leverage work. Treat custom **queries and models as a maintained asset** — reviewed, tested, versioned, owned — and convert each incident into a fleet-wide variant-analysis query. Tune for **actioned true positives per analyst-hour**, not raw findings: add barriers before buying path-sensitivity, baseline legacy and gate on new flows. Run it at scale with diff-aware reporting and a two-speed pipeline. Maintain the **soundy gap as a risk register** with a per-line mitigation, and communicate honestly that — by Rice's theorem and those gaps — "0 findings" never means "secure." The tool proposes leads; engineering judgment, runtime defenses, and formal methods dispose.

## Further Reading

- *Software Engineering at Google*, static-analysis chapter — Tricorder, "fix it don't just report it," and making analysis survive at scale.
- CodeQL documentation — *Customizing library models*, *Creating query suites/packs*, *Multi-Repository Variant Analysis (MRVA)*.
- Pysa / Pyre documentation — taint model (`.pysa`) files; Meta's account of running interprocedural taint at scale.
- Bessey et al. — *A Few Billion Lines of Code Later* (CACM) — the Coverity team on the brutal realities of selling and tuning static analysis in industry.
- Semgrep documentation — *Taint mode propagators*, *autofix*, and CI integration; SARIF interchange.

## Related Topics

- [SAST & Security Scanners](../04-sast-security-scanners/) — `professional.md` for the surrounding security program and governance.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — baselines, diff-aware gating, SARIF, and suppression discipline at the pipeline level.
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — authoring the patterns and matchers that feed the fast lane.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — the runtime taint counterpart that covers the static soundy gaps.
- [Formal Methods & Verification](../../formal-methods-and-verification/) — the highest-assurance complement for components where leads aren't enough.
