# Dead Code & Complexity — Middle Level

> **Roadmap:** [Static Analysis](../README.md) → Dead Code & Complexity

*Reachability is decidable in a straight line and undecidable in general — the gap between those two facts is where dead-code tools earn their reputation for lying. Understanding the gap, and the metrics that sit beside it, is the middle-tier job.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — How reachability analysis actually works](#core-concept-1--how-reachability-analysis-actually-works)
5. [Core Concept 2 — Why dead-code detection is undecidable in general](#core-concept-2--why-dead-code-detection-is-undecidable-in-general)
6. [Core Concept 3 — The reflective / dynamic false-positive trap](#core-concept-3--the-reflective--dynamic-false-positive-trap)
7. [Core Concept 4 — The metrics defined precisely](#core-concept-4--the-metrics-defined-precisely)
8. [Core Concept 5 — Deriving cyclomatic complexity by hand](#core-concept-5--deriving-cyclomatic-complexity-by-hand)
9. [Core Concept 6 — Thresholds, gates, and baselining](#core-concept-6--thresholds-gates-and-baselining)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the limits of static reachability, the precise definitions of the complexity metrics, and how to turn a number into a gate without breaking the team.**

At the junior tier you ran the tools and read the output. Now you need to know *when to trust them*. Dead-code analysis is one of the most over-promised features in static tooling: intraprocedurally (within one function) it is trivial and correct; whole-program, in a language with reflection or dynamic dispatch, it is fundamentally a *guess*. Get this wrong and you delete code that something calls through a string name, and production breaks in a way no test caught.

You also need the metrics nailed down — what cyclomatic complexity counts, what it ignores, how cognitive complexity differs, and how to wire a `max-complexity` rule into CI so it ratchets debt *down* over time instead of either doing nothing or blocking every PR.

---

## Prerequisites

- You have completed the [junior tier](junior.md) or can find unused symbols and read a complexity score.
- You know what a control-flow graph (CFG) is, at least informally.
- You have configured a linter rule with options (severity, thresholds).
- Helpful: a passing familiarity with reflection / dynamic dispatch in your language.

---

## Glossary

| Term | Meaning |
|---|---|
| **Control-flow graph (CFG)** | Nodes = basic blocks, edges = possible transfers of control. |
| **Reachability** | Whether a node in the CFG (or call graph) has any path from an entry point. |
| **Call graph** | Nodes = functions, edges = "may call". The whole-program reachability map. |
| **Entry point** | A root the program starts from: `main`, an HTTP handler, a test, an exported API. |
| **Rice's theorem** | Any non-trivial semantic property of a program is undecidable. |
| **False positive** | Tool says "dead" but the code is actually used. |
| **Cognitive complexity** | SonarSource metric: increments for breaks in linear flow, with a nesting multiplier. |
| **Baseline** | A snapshot of existing violations that are grandfathered so only *new* ones fail CI. |
| **Ratchet** | A threshold that can only tighten, never loosen, over time. |

---

## Core Concept 1 — How reachability analysis actually works

For a single function, reachability is exact. The tool builds a CFG: each straight run of statements is a *basic block*, and edges connect blocks that control can flow between. A block with no incoming edge (other than via an entry) is unreachable. After a `return`, the next block has no edge into it — dead. This is decidable, fast, and correct.

For whole-program "is this function ever called?", the tool builds a **call graph**: it starts from entry points (`main`, exported handlers, `init`, tests) and marks every function reachable through call edges. Anything left unmarked is reported as dead.

```console
$ deadcode -whylive=internal.legacy.parseV1 ./...
internal.legacy.parseV1 is dead: no path from any entry point
```

The accuracy of this hinges entirely on **how complete the call graph is**. And that is where it falls apart — because some calls don't appear as call edges in the source at all.

---

## Core Concept 2 — Why dead-code detection is undecidable in general

Intraprocedural reachability is decidable. **General dead-code detection is not** — it reduces to the halting problem via Rice's theorem, which states that every non-trivial semantic property of programs is undecidable.

A concrete reduction: "is this branch reachable?" can encode "does this other computation halt?":

```python
def maybe_dead(n):
    if collatz_terminates(n):  # nobody knows if this is always True
        do_thing()             # is this reachable? depends on an open math problem
```

No analyzer can decide reachability here without solving the underlying problem. So real tools make a deliberate trade-off. They are either:

- **Sound** (never miss real dead code) at the cost of **false positives** — flagging live code as dead, OR
- **Precise** (never wrongly flag live code) at the cost of **false negatives** — missing some dead code.

Most dead-code tools lean toward soundness: they over-report. That is exactly why their output must be *reviewed*, not blindly applied. `vulture` even prints a **confidence percentage** precisely because it cannot be certain:

```console
$ vulture mypackage/
mypackage/api.py:12: unused function 'webhook_handler' (60% confidence)
```

Sixty percent confidence on a function named `webhook_handler` is the tool whispering "I can't see who calls this — and I suspect it's a framework."

---

## Core Concept 3 — The reflective / dynamic false-positive trap

This is the **number-one reason dead-code tools are distrusted**, so it deserves its own concept. A function can be 100% live yet appear in *no* call graph because nothing names it directly in source. The call happens through a string, a registry, an annotation, or a network boundary the analyzer cannot see.

**Reflection / dynamic dispatch (Java, Go, Python).** The method is invoked by name at runtime:

```java
// Nothing calls processPayment() syntactically — it's invoked by reflection.
Method m = handler.getClass().getMethod("processPayment", Order.class);
m.invoke(handler, order);  // call graph has no edge to processPayment
```

**Dependency-injection containers (Spring, NestJS, Guice).** A class is registered and constructed by the framework; its constructor and `@Bean` methods have no in-repo caller.

**Serialization / ORM (Jackson, GORM, SQLAlchemy).** Getters, setters, and no-arg constructors are called reflectively during (de)serialization. Tools flag them as unused constantly.

**Dynamic imports / string routing (JS/TS, Python).**

```javascript
// Route handlers loaded by filename — no static import edge.
const handler = await import(`./routes/${name}.js`);
```

**Public-API surface with no in-repo caller.** A library's exported function is *meant* to be called by code that doesn't exist in this repo. `ts-prune` will list every public export of a published package as "unused."

The practical rule: **before deleting tool-flagged dead code, ask "who could call this that the analyzer can't see?"** Check for reflection, DI registration, serialization annotations, dynamic import strings, framework entry points, and external consumers. Most tools let you mark these:

```python
# vulture: a whitelist file enumerating reflectively-used names
webhook_handler  # used by Flask route decorator
```

```jsonc
// knip: tell it your real entry points so it doesn't flag them
{ "entry": ["src/index.ts", "src/routes/**/*.ts"], "project": ["src/**"] }
```

---

## Core Concept 4 — The metrics defined precisely

| Metric | What it counts | What it ignores | Tools |
|---|---|---|---|
| **Cyclomatic complexity** | Independent paths: `1 + decisions` (if/case/loop/&&/\|\|/?:) | How nested or readable the code is | gocyclo, radon, ESLint `complexity`, PMD |
| **Cognitive complexity** | Breaks in linear flow, **× nesting level** | Flat `switch` cases (not penalized) | SonarQube, ESLint `sonarjs/cognitive-complexity` |
| **Nesting depth** | Max levels of stacked blocks | Total branch count | ESLint `max-depth`, PMD |
| **Function length** | Lines / statements per function | Whether length is essential | ESLint `max-lines-per-function`, PMD |
| **Fan-in** | How many functions call this one | — | call-graph tools |
| **Fan-out** | How many distinct functions this one calls | — | call-graph tools |

**Cyclomatic** answers *"how many test cases for full path coverage?"* — useful for test planning, blind to readability. **Cognitive** answers *"how hard is this to understand?"* — it does not increment for a flat `switch` (low reading cost) but adds the current nesting depth for each nested control structure, so deeply nested logic explodes.

**Fan-in / fan-out** describe coupling: a function with fan-in 0 (and no reflective callers) is a dead-code candidate; a function with huge fan-out is doing too much and is hard to test in isolation. None of these is "the" quality number — each measures a different thing, and a high value is a question, not an answer.

---

## Core Concept 5 — Deriving cyclomatic complexity by hand

Knowing the formula matters because it tells you *which constructs* drive the number — and therefore which refactorings actually move it. Here is a genuinely complex function:

```go
func priceOrder(o Order) (float64, error) {
    var total float64
    for _, item := range o.Items {              // +1
        if item.Qty <= 0 {                       // +1
            return 0, errInvalidQty
        }
        price := item.Unit * float64(item.Qty)
        if o.Tier == "gold" && item.Qty > 10 {  // +1 (if), +1 (&&)
            price *= 0.85
        } else if o.Tier == "silver" {           // +1
            price *= 0.95
        }
        if item.Category == "hazmat" {           // +1
            if o.Region == "EU" {                // +1
                price += 12.0
            } else if o.Region == "US" {         // +1
                price += 8.0
            }
        }
        total += price
    }
    if total > 1000 {                            // +1
        total *= 0.97
    }
    return total, nil
}
```

Counting: base **1** + 9 decision points = **cyclomatic complexity 10**. Confirm it:

```console
$ gocyclo -over 9 .
10 main priceOrder price.go:3:1
```

Note the `&&` counts as its own +1 — short-circuit operators create a real branch. The number 10 tells you full path coverage needs on the order of 10 tests, *and* that this function is doing pricing, tier discounts, hazmat surcharges, and bulk discounts all at once: a refactoring target. Extracting `hazmatSurcharge(item, region)` and `tierMultiplier(tier, qty)` would split the complexity across small, independently testable functions — and meaningfully so, because each extracted concern *is* a separate concern.

---

## Core Concept 6 — Thresholds, gates, and baselining

A complexity number is useless until it changes behavior. The lever is a **threshold** in your linter:

```console
$ gocyclo -over 15 .              # fail/flag anything above 15
```

```jsonc
// ESLint
{ "rules": { "complexity": ["error", 15], "max-depth": ["error", 4] } }
```

```ini
# Python: xenon wraps radon as a CI gate
$ xenon --max-absolute B --max-average A mypackage/
```

Choosing the number and the scope:

- **Per-function vs per-file.** Per-function thresholds are the standard; per-file averages can hide one monster among many trivial functions.
- **Common starting points.** 10 is McCabe's classic "consider refactoring" line; 15 is a pragmatic "this needs justification"; >20 is "almost certainly too much."
- **A hard gate on a fresh repo is fine.** A hard gate retrofitted onto a legacy repo will block every PR and breed resentment — and gaming (see senior tier).

The fix for legacy is a **baseline**: snapshot existing violations, grandfather them, and fail CI only on *new or worsened* ones. Then **ratchet** — lower the ceiling as functions get refactored, never raise it.

```console
# golangci-lint baselines via new-from-rev: only report issues new since main
$ golangci-lint run --new-from-rev=origin/main
```

This converts "fix 400 violations or turn the rule off" into "don't add a 401st" — the only gate strategy that survives contact with a real codebase.

---

## Real-World Examples

**The DI false positive that nearly shipped.** A Spring team enabled an "unused public method" inspection and a developer deleted six `@EventListener` methods the IDE marked grey. They were invoked reflectively by the event bus. Integration tests caught it — but only because those happened to exist. The lesson: DI, serialization, and reflection are systematic blind spots, not one-offs.

**Ratcheting a legacy monolith.** A Python team had 230 functions over radon grade C. A hard `xenon --max-absolute B` would have failed every PR. They baselined the 230, added `xenon` in `--new-from-rev` mode, and dropped the absolute ceiling by one grade each quarter. After a year the count was 60, with zero PRs blocked on unrelated work.

**The `&&` surprise.** A developer "simplified" `if a { if b {` into `if a && b {` to reduce nesting — and was puzzled that cyclomatic complexity didn't drop. It can't: the two branches still exist. Cognitive complexity *did* drop (less nesting), which is the metric that matched the actual readability win.

---

## Mental Models

- **Two reachability problems, two difficulties.** *Within a function*: decidable, trust it. *Across the program with reflection*: a guess, verify it.
- **Soundness vs precision is a dial.** Dead-code tools turn it toward soundness, so they over-report and need a human.
- **Reflection is invisible to the call graph.** If a call goes through a string, the analyzer can't see the edge.
- **Cyclomatic counts paths; cognitive counts pain.** Pick the one that matches the question you're asking.
- **A baseline turns an impossible cleanup into a one-way ratchet.** Stop the bleeding first; heal over time.

---

## Common Mistakes

| Mistake | Why it bites | Better |
|---|---|---|
| Blindly deleting tool-flagged dead code | Reflective/DI/serialized/public-API code is live but invisible | Verify callers across all entry points first |
| Enabling a hard complexity gate on a legacy repo | Blocks every unrelated PR; breeds gaming | Baseline + ratchet via `--new-from-rev` |
| Trusting `ts-prune` on a published library | Every public export looks "unused" with no in-repo caller | Configure entry points; use `knip`'s library awareness |
| Assuming cyclomatic reflects readability | A flat 30-case switch is readable but scores 31 | Use cognitive complexity for the readability question |
| Forgetting `&&`/`\|\|` add to cyclomatic count | Refactoring nesting into `&&` doesn't lower it | Know which constructs the metric counts |

---

## Test Yourself

1. Why is intraprocedural reachability decidable but whole-program dead-code detection not? Name the theorem.
2. Give three mechanisms by which live code appears dead to a call-graph analyzer.
3. A function has `for` → `if` → (`if`/`else if`) plus one top-level `if`. Derive its cyclomatic complexity.
4. When would you choose cognitive complexity over cyclomatic for a gate, and why?
5. You inherit a repo with 300 complexity violations. Describe a gate strategy that doesn't block unrelated PRs.
6. Why does `vulture` print confidence percentages instead of a yes/no?

---

## Cheat Sheet

```text
REACHABILITY
  intraprocedural (after return)   → decidable, trust it
  whole-program "is X ever called" → call-graph guess; reflection breaks it

FALSE-POSITIVE SOURCES (verify before deleting)
  reflection / m.invoke    DI containers (Spring/Nest)   serialization (Jackson/ORM)
  dynamic import(`${x}`)   string routing                public API w/ no in-repo caller

METRICS
  cyclomatic = 1 + decisions   → ≈ #tests, blind to nesting
  cognitive  = flow-breaks × nesting → readability, ignores flat switch
  nesting depth / length / fan-in / fan-out → coupling & shape

GATES
  per-function thresholds (10 watch / 15 justify / 20 too much)
  legacy → baseline + ratchet:
    golangci-lint run --new-from-rev=origin/main
    xenon --max-absolute B --max-average A
```

---

## Summary

Reachability is exact inside one function (trust the "unreachable after return" flags) but a heuristic guess across a whole program — and by Rice's theorem it can never be exact in general. Tools lean toward soundness and over-report, which is why their output is a worklist, not a delete script. The dominant false-positive source is **dynamic invocation**: reflection, DI containers, serialization, dynamic imports, and public-API surface with no in-repo caller. On the complexity side, **cyclomatic** counts branches (≈ test count, blind to nesting) while **cognitive** weights nesting to track readability; deriving them by hand tells you which refactorings actually move the number. Finally, gate complexity with **per-function thresholds**, and on legacy code use a **baseline + ratchet** so CI fails only on new or worsened violations.

---

## Further Reading

- H. G. Rice, *Classes of Recursively Enumerable Sets and Their Decision Problems* (1953) — the undecidability result.
- SonarSource, *Cognitive Complexity* white paper — the nesting-weighted definition.
- `knip` and `vulture` docs — entry-point configuration and whitelists for reflective code.
- `golangci-lint` `--new-from-rev` and `xenon` docs — baselining in practice.

---

## Related Topics

- [Taint & Data-Flow Analysis](../08-taint-and-dataflow-analysis/) — interprocedural reachability done rigorously.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — baselines, blocking vs advisory gates, SARIF.
- [Code Quality Metrics](../../code-quality-metrics/) — where complexity sits among other measures.
- [Technical Debt Management](../../technical-debt-management/) — using complexity to prioritize cleanup.
- The **code-smell-detection**, **refactoring-techniques**, and **function-design** skills.
