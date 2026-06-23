# Taint & Data-Flow Analysis — Senior Level

> **Roadmap:** [Static Analysis](../README.md) → Taint & Data-Flow Analysis

*Lattices, monotone frameworks, the precision/scalability frontier, and why no tool can be both sound and complete.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Monotone Framework: Lattice + Transfer + Fixpoint](#core-concept-1--the-monotone-framework-lattice--transfer--fixpoint)
5. [Core Concept 2 — A Worked One-Step Lattice Example](#core-concept-2--a-worked-one-step-lattice-example)
6. [Core Concept 3 — Forward/Backward, May/Must, and Taint's Place in the Grid](#core-concept-3--forwardbackward-maymust-and-taints-place-in-the-grid)
7. [Core Concept 4 — The Precision Dimensions and Their Cost](#core-concept-4--the-precision-dimensions-and-their-cost)
8. [Core Concept 5 — Soundness vs Completeness and Rice's Theorem](#core-concept-5--soundness-vs-completeness-and-rices-theorem)
9. [Core Concept 6 — CodeQL as a Data-Flow Engine](#core-concept-6--codeql-as-a-data-flow-engine)
10. [Core Concept 7 — Interprocedural Mechanics: Call Graphs, Summaries, k-CFA](#core-concept-7--interprocedural-mechanics-call-graphs-summaries-k-cfa)
11. [Core Concept 8 — The Engines Compared](#core-concept-8--the-engines-compared)
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

> Focus: **the formal theory — lattices, monotone transfer functions, fixpoint iteration — and the engineering consequences: the precision dimensions, the soundness/completeness impossibility, and how CodeQL turns all of it into queryable facts.**

A senior owns the rule set and must reason about what the tool can and cannot *prove*. That requires the actual theory, not the metaphor. Data-flow analysis is an instance of **abstract interpretation**: instead of running the program on concrete values, you run it on *abstract* values drawn from a lattice, using monotone transfer functions, and iterate to a fixpoint that over-approximates every possible execution. Once you have that frame, every practical knob — flow-, path-, context-, field-sensitivity — and every limitation — Rice's theorem, soundness vs completeness — falls into place.

## Prerequisites

- The [middle](middle.md) tier: CFG, transfer functions, intra/interprocedural, summaries, Semgrep taint mode.
- Comfort with basic discrete math: partial orders, sets, monotonicity.
- Exposure to at least one SAST tool's query/rule language (CodeQL or Semgrep).
- Helpful: the [Formal Methods & Verification](../../formal-methods-and-verification/) section for the proof-theoretic neighbors.

## Glossary

| Term | Meaning |
|------|---------|
| **Lattice** | A partially ordered set where every pair of elements has a least upper bound (join, ⊔) and greatest lower bound (meet, ⊓). |
| **Join (⊔)** | The merge operator at CFG confluence points; ⊔ = union for may-analyses. |
| **Monotone** | A transfer function `f` such that `x ⊑ y ⇒ f(x) ⊑ f(y)` — more info in, no less info out. |
| **Fixpoint** | A solution `X` with `F(X) = X`; iteration converges to the *least* fixpoint for over-approximation. |
| **Abstract interpretation** | Executing a program over abstract values that soundly over-approximate concrete behavior. |
| **Flow-sensitive** | Distinguishes facts at different program points (respects statement order). |
| **Path-sensitive** | Distinguishes facts per execution path / branch condition. |
| **Context-sensitive** | Distinguishes a function's behavior per call site / calling context. |
| **Field-sensitive** | Distinguishes taint per object field rather than per whole object. |
| **Sound** | No false negatives — every real bug of the class is reported (over-approximation). |
| **Complete** | No false positives — every reported bug is real (under-approximation). |
| **Soundy** | Pragmatically sound except for a documented, well-understood set of unsound features. |
| **k-CFA** | Context-sensitive call analysis bounded to the last `k` call sites. |

## Core Concept 1 — The Monotone Framework: Lattice + Transfer + Fixpoint

A **monotone data-flow framework** has four pieces:

1. **A lattice `L`** of abstract facts, with a partial order `⊑` ("at least as much information as") and a **join** `⊔` for merging facts at confluence points. For taint, the lattice over a single variable is the two-point lattice `{Clean ⊑ Tainted}` with `⊔ = "tainted if either is tainted"`. For the whole program state, `L` is the powerset of (variable, tainted) facts, ordered by ⊆.

2. **Transfer functions** `f_B : L → L`, one per basic block, each **monotone**: feeding in more taint never produces less taint out. Monotonicity is what *guarantees the iteration terminates* on a finite-height lattice.

3. **A direction.** Forward analyses compute `out[B] = f_B(in[B])`, `in[B] = ⊔ out[P]` over predecessors `P`. Backward analyses reverse it.

4. **Fixpoint iteration.** Initialize, then repeatedly apply transfer functions and joins until nothing changes. The result is the **least fixpoint** — the smallest set of facts consistent with the equations, which is exactly the *most precise sound over-approximation* the abstraction allows.

```
  repeat:
    for each block B:
      in[B]  = ⊔ { out[P] : P → B }        # join over predecessors
      out[B] = transfer_B(in[B])           # apply transfer function
  until no in[]/out[] changed               # fixpoint reached
```

Termination is not an accident: monotone transfer functions over a **finite-height lattice** can only increase the fact set, which is bounded, so iteration must stabilize. This is the theoretical bedrock under every taint tool, the Dragon Book's classical analyses, and abstract interpretation in general.

## Core Concept 2 — A Worked One-Step Lattice Example

Take the merge-point CFG from the middle tier. Lattice element = set of tainted variables; `⊑` = ⊆; `⊔` = ∪.

```
B0:  x = req.args["q"]      transfer: in ∪ {x}            (source adds x)
B1:  x = sanitize(x)        transfer: in \ {x}            (sanitizer removes x)
B2:  db.execute(x)          transfer: identity; CHECK x ∈ in → finding
```

Iterate (one variable, so the lattice has height 1 → converges in one pass):

```
  out[B0] = {} ∪ {x}            = {x}                  # x tainted after source
  in[B1]  = out[B0]            = {x}
  out[B1] = {x} \ {x}          = {}                    # sanitizer cleared x
  in[B2]  = out[B0] ⊔ out[B1] = {x} ∪ {} = {x}         # JOIN over both paths
  out[B2] = {x}
  ──────────────────────────────────────────────
  CHECK at B2:  x ∈ in[B2] = {x}  →  FINDING (the unsanitized false-branch path)
```

The **join at `B2`** is the crux: the false branch (skipping `B1`) contributes `{x}`, the sanitized branch contributes `{}`, and `{x} ⊔ {} = {x}`. The analysis reports the sink because *some* path reaches it tainted. This is correct — that path is genuinely exploitable — and it is the mechanical reason "sanitize on one branch" never satisfies a sound taint analysis. To clear the finding, the sanitizer must dominate the sink (lie on *every* path to it).

## Core Concept 3 — Forward/Backward, May/Must, and Taint's Place in the Grid

Two orthogonal axes classify any data-flow analysis:

|  | **May** (⊔ = ∪, "on some path") | **Must** (⊔ = ∩, "on all paths") |
|---|---|---|
| **Forward** | **Taint**, reaching definitions | available expressions |
| **Backward** | live variables (may-live) | very-busy expressions |

- **Forward** because taint moves *with* execution: a value is tainted at point *p* if it was tainted at some predecessor and not cleaned. (Live variables, by contrast, are backward — usefulness flows from future uses back to definitions.)
- **May** because the safe-but-imprecise default for *security* is "report if tainted on *any* path." Using ∩ (must) would only report values tainted on *every* path — fewer alarms, but missing the single dangerous branch. May-analysis trades false positives for the guarantee of catching the bug. This choice — ⊔ = ∪ — *is* the soundness bias made concrete in the merge operator.

Knowing taint is "forward + may" instantly tells you its merge behavior, its convergence direction, and why it errs toward over-reporting.

## Core Concept 4 — The Precision Dimensions and Their Cost

Every taint engine sits somewhere on four precision axes. Each one moves you toward fewer false positives and toward worse scalability. The whole craft is choosing where to sit.

| Dimension | Imprecise (cheap) | Precise (costly) | What it fixes |
|---|---|---|---|
| **Flow-sensitivity** | ignores statement order | respects order; facts per program point | `x` cleaned then reused — flow-insensitive sees it as "ever tainted" |
| **Path-sensitivity** | merges branches | tracks branch conditions (often via SMT) | "tainted only when `if (unsafe)`" — kills infeasible-path FPs |
| **Context-sensitivity** | one summary for all callers | per-call-site behavior | a helper tainted by *one* caller marked tainted for *all* |
| **Field-sensitivity** | whole object tainted if any field is | per-field taint | tainting `user.name` shouldn't taint `user.id` |

```
        precision  ───────────────────────────────►  fewer false positives
            │
   scalability │  ◄───────────────────────────────  whole-program sound analysis
            │      does NOT scale; tools approximate everywhere
```

**Why whole-program sound analysis doesn't scale.** Full path-sensitivity is exponential in branches; full context-sensitivity is exponential in call depth; precise field-, array-, and alias-sensitivity compound it. A truly sound, fully precise, whole-program analysis is intractable on real codebases. So every production tool *bounds* something: k-limited context (k-CFA), access-path-limited field sensitivity, no path-sensitivity, heuristic alias analysis. The art is spending precision *only where it buys signal* — usually flow- and field-sensitivity (cheap, high payoff) and limited context-sensitivity, while skipping general path-sensitivity.

## Core Concept 5 — Soundness vs Completeness and Rice's Theorem

The two words that govern what any analysis can promise:

- **Sound** = **no false negatives**. Every real vulnerability of the class is reported. Achieved by *over-approximating*: when unsure, assume tainted. Cost: false positives.
- **Complete** = **no false positives**. Every reported finding is a genuine bug. Achieved by *under-approximating*: only report when certain. Cost: false negatives (missed bugs).

```
  reality:   { actual vulnerabilities }
  SOUND tool:      reports ⊇ reality     (catches all, plus extras = false positives)
  COMPLETE tool:   reports ⊆ reality     (all real, but misses some = false negatives)
```

**You cannot have both, decidably.** **Rice's theorem** says any non-trivial semantic property of programs (and "is this value attacker-controlled at this sink on some real execution?" is one) is **undecidable**. No algorithm can answer it exactly for all programs. Therefore every taint tool *must* approximate — and approximation means trading false positives against false negatives. There is no precise tool, only differently-biased ones.

**How real tools choose.** Most security SAST leans **toward soundness** (catch the bug) but isn't *fully* sound, because true soundness over reflection/eval/native code would make it unusably noisy. They land in the pragmatic middle nicknamed **"soundy"**: sound *except* for an explicit, documented list of swept-under features (reflection, dynamic dispatch, some library calls, implicit flows). A senior must know *which* unsound assumptions a given tool makes, because those are exactly the bugs it will silently miss. "Soundy" is honesty about the gap, not a cure for it.

## Core Concept 6 — CodeQL as a Data-Flow Engine

CodeQL compiles your codebase into a **relational database** of program facts — AST nodes, the CFG, the call graph, and a precomputed data-flow graph — then lets you run **declarative queries** (a Datalog-like language) over it. Taint tracking is a library on top: you extend a configuration declaring sources, sinks, and additional taint steps/sanitizers, and CodeQL computes interprocedural reachability for you.

```ql
/**
 * @name User input flows into SQL execution
 * @kind path-problem
 * @problem.severity error
 */
import python
import semmle.python.dataflow.new.TaintTracking
import semmle.python.dataflow.new.DataFlow

module SqlInjectionConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node source) {
    // any read of an untrusted request attribute
    exists(Attribute a |
      a = source.asExpr() and
      a.getObject().(Name).getId() = "request" and
      a.getName() in ["args", "form", "values", "GET", "POST"]
    )
  }

  predicate isSink(DataFlow::Node sink) {
    // first argument of db.execute(...)
    exists(Call c |
      c.getFunc().(Attribute).getName() = "execute" and
      sink.asExpr() = c.getArg(0)
    )
  }

  predicate isBarrier(DataFlow::Node node) {
    // a sanitizer: int() cast or our vetted parameterizer
    exists(Call c |
      c.getFunc().(Name).getId() in ["int", "parameterize"] and
      node.asExpr() = c
    )
  }
}

module SqlFlow = TaintTracking::Global<SqlInjectionConfig>;

from SqlFlow::PathNode src, SqlFlow::PathNode sink
where SqlFlow::flowPath(src, sink)
select sink.getNode(), src, sink, "Untrusted data reaches SQL execution."
```

The three predicates — `isSource`, `isSink`, `isBarrier` (the sanitizer) — are exactly the junior-tier triad, now backed by a *global, interprocedural, field-sensitive* data-flow engine. `@kind path-problem` makes CodeQL emit the **full witness path** from source to sink, which is what turns a finding into something a reviewer can act on. Writing and maintaining these queries — and the framework **models** that feed them — is the org capability covered in [professional.md](professional.md).

## Core Concept 7 — Interprocedural Mechanics: Call Graphs, Summaries, k-CFA

Interprocedural taint needs a **call graph** (who calls whom). Building it precisely is itself undecidable in the presence of dynamic dispatch and function values, so tools approximate (class-hierarchy analysis, rapid type analysis, points-to-based). Holes in the call graph = missed flows.

Two ways to compute flow across the graph:

- **Summary-based (functional approach).** Compute, per function, a relation from input taint to output taint (return value, mutated parameters, mutated globals). Reuse at every call site. This is the IFDS/IDE framework (Reps–Horwitz–Sagiv) reduced to graph reachability — the reason CodeQL and Infer scale.
- **Cloning / call-strings (k-CFA).** Distinguish calling contexts by the last `k` call sites. `k=0` is context-insensitive (cheap, FPs); larger `k` is more precise and exponentially costlier. Most tools use small `k` or access-path-based context.

The tension: **context-insensitivity merges callers**, so one tainted caller of a shared utility poisons every caller's verdict (false positives); **context-sensitivity** fixes it at real cost. This is why a shared logging/formatting helper is a notorious false-positive generator in cheap analyses.

## Core Concept 8 — The Engines Compared

| Tool | Analysis style | What it's strong at |
|---|---|---|
| **CodeQL** | Whole-program, interprocedural, field-sensitive data flow over a code DB | Deep taint, custom queries, path witnesses; the reference for serious SAST |
| **Semgrep (taint mode)** | Pattern-driven, mostly intraprocedural + shallow interprocedural | Fast, readable rules, great for org-specific patterns; less deep |
| **Infer** | Separation-logic / abstract interpretation, compositional summaries | Null-deref, resource/memory leaks, concurrency; bi-abduction at scale |
| **Pysa** (Pyre) | Interprocedural taint for Python with model files | Python taint at Meta scale; explicit source/sink model `.pysa` files |
| **Checker Framework** | Pluggable types — taint as a *type qualifier* (`@Tainted`/`@Untainted`) | Compile-time, sound *within the type discipline*; developer-annotated |

Note the spectrum: from **type-based** (Checker Framework: taint is a type, checked soundly but requiring annotations) through **data-flow** (CodeQL, Pysa) to **pattern + flow** (Semgrep) to **separation logic** (Infer). Choosing among them is a [professional](professional.md)-tier cost/signal decision; understanding *what class of analysis each performs* is the senior prerequisite for that decision.

## Real-World Examples

- **The infeasible-path false positive.** A flow-insensitive analysis reported taint that, on any *real* execution, was guarded by a prior `if (validated) return`. Only path-sensitivity (or a barrier model of the validator) clears it — and the team chose to model the validator rather than pay for path-sensitivity.
- **Context-insensitivity poisoning a logger.** A central `format(msg)` helper, called once with a tainted value, was marked taint-propagating everywhere; the report listed 200 "findings" all flowing through `format`. Adding context-sensitivity (or a precise summary that didn't route taint to the log sink) collapsed it to the one real case.
- **Soundy gap exploited.** A deserialization gadget (`pickle.loads`) reintroduced attacker-controlled objects the analysis treated as clean — the documented unsound corner. The fix was a *model* declaring `pickle.loads` a source.
- **Type-based prevention.** A Java service annotated its query API parameters `@Untainted`; the Checker Framework rejected, at compile time, any code passing a `@Tainted` value — soundness within the discipline, paid for in annotation effort.

## Mental Models

- **Abstract interpretation = running the program in a fog.** You replace concrete values with abstract ones (Clean/Tainted) and accept that the fog makes you over-cautious — that over-caution *is* soundness.
- **The lattice is the vocabulary; the transfer functions are the grammar; the fixpoint is the only sentence the program can say about itself.**
- **Precision is a budget, not a goal.** Spend it where false positives actually hurt; flow- and field-sensitivity are usually the best value.
- **Rice's theorem is the speed limit.** Any tool promising "no false positives *and* no false negatives" is lying or solving a trivial sub-problem.
- **"Soundy" is a confession.** Read the tool's list of unsound assumptions; that list is your exact false-negative surface.

## Common Mistakes

- **Believing a tool is "sound."** Almost none are, fully. Find and trust the documented soundy gaps instead of assuming completeness.
- **Buying path-sensitivity you don't need.** It's the most expensive axis; a barrier model of the guard often clears the same FPs far cheaper.
- **Ignoring call-graph holes.** Dynamic dispatch and function values silently drop edges; your interprocedural analysis is only as good as its call graph.
- **Confusing field-insensitivity FPs for real bugs.** "Whole object tainted" can fire on a clean field; check whether the *specific* field carries taint.
- **Treating the join operator as a detail.** ⊔ = ∪ vs ∩ is the difference between a may and a must analysis — it changes what the tool means by a finding.

## Test Yourself

1. State the four components of a monotone data-flow framework and why monotonicity guarantees termination.
2. Run the one-step lattice example and explain why the join at `B2` yields a finding.
3. Place taint in the forward/backward × may/must grid and justify each axis.
4. Rank the four precision dimensions by cost and give a false positive each one fixes.
5. Define sound and complete in terms of false negatives/positives; state why Rice's theorem forbids both.
6. What does "soundy" mean, and how do you find a given tool's unsound surface?
7. In the CodeQL config, which predicate is the sanitizer, and what does `@kind path-problem` buy you?
8. Why does context-insensitivity turn shared helpers into false-positive factories?

## Cheat Sheet

```
MONOTONE FRAMEWORK   lattice L (⊑, ⊔) + monotone transfer f_B + direction + fixpoint
  termination       monotone f over finite-height lattice ⇒ iteration stabilizes
  result            LEAST fixpoint = most precise SOUND over-approximation

TAINT'S CLASS        forward + may  → merge with ⊔ = ∪  → tainted on ANY path
ONE-STEP            out=in∪{x} at source; in\{x} at sanitizer; check x∈in at sink
                    sanitizer must DOMINATE the sink to clear a finding

PRECISION AXES (cheap→precise, each ↑ cost ↓ false positives)
  flow-sensitive    respects statement order        (best value)
  field-sensitive   per-field taint                  (best value)
  context-sensitive per-call-site (k-CFA)            (moderate cost)
  path-sensitive    per branch condition / SMT       (most expensive)

SOUND  = no false negatives (over-approx, has FPs)
COMPLETE = no false positives (under-approx, has FNs)
RICE'S THEOREM ⇒ can't have both decidably ⇒ all tools approximate
SOUNDY = sound except a documented list (reflection/eval/native/implicit) ← your FN surface

CODEQL   code → relational DB → queries; isSource/isSink/isBarrier; path-problem = witness
ENGINES  CodeQL deep DF · Semgrep pattern+shallow DF · Infer sep-logic · Pysa Python DF · Checker Framework pluggable types
```

## Summary

Data-flow analysis is **abstract interpretation** in the **monotone framework**: a lattice of facts, monotone transfer functions, a direction, and a fixpoint that over-approximates all executions. Taint is its **forward, may** instance — the join is union, so a value tainted on *any* path is reported, and a sanitizer clears a finding only when it dominates the sink. Real tools live on a four-axis precision frontier (flow-, path-, context-, field-sensitivity); buying precision means losing scalability, and whole-program sound-and-precise analysis is intractable, so everyone approximates. **Rice's theorem** makes the soundness/completeness trade-off mandatory: no tool is both, decidably, and most security SAST is **soundy** — sound except a documented gap that *is* its false-negative surface. **CodeQL** operationalizes all of this as queries over a code database with `isSource`/`isSink`/`isBarrier`, while Semgrep, Infer, Pysa, and the Checker Framework occupy different points on the analysis spectrum. The professional tier turns this understanding into an org capability.

## Further Reading

- Nielson, Nielson & Hankin — *Principles of Program Analysis* (the definitive treatment of lattices, monotone frameworks, and interprocedural analysis).
- Cousot & Cousot — *Abstract Interpretation* (1977) — the foundational paper behind sound over-approximation.
- Reps, Horwitz & Sagiv — *Precise Interprocedural Dataflow Analysis via Graph Reachability* (IFDS) and Sagiv–Reps–Horwitz (IDE).
- Livshits et al. — *In Defense of Soundiness: A Manifesto* (CACM) — what "soundy" means and why it's honest.
- CodeQL documentation — *Analyzing data flow* and *Creating path queries*; GitHub Security Lab query packs.

## Related Topics

- [SAST & Security Scanners](../04-sast-security-scanners/) — `senior.md` for the program-level deployment of these engines.
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — pattern matching, the layer beneath data-flow reachability.
- [Formal Methods & Verification](../../formal-methods-and-verification/) — the rigorous neighbor: where over-approximation becomes proof.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — runtime taint tracking that escapes Rice's theorem by observing actual executions (at the cost of coverage).
