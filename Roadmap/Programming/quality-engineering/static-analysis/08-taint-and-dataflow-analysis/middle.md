# Taint & Data-Flow Analysis — Middle Level

> **Roadmap:** [Static Analysis](../README.md) → Taint & Data-Flow Analysis

*The control-flow graph, propagation rules, and the jump from one function to the whole program.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Control-Flow Graph (CFG)](#core-concept-1--the-control-flow-graph-cfg)
5. [Core Concept 2 — Data-Flow as Facts That Travel the CFG](#core-concept-2--data-flow-as-facts-that-travel-the-cfg)
6. [Core Concept 3 — Taint Propagation Rules](#core-concept-3--taint-propagation-rules)
7. [Core Concept 4 — Intraprocedural vs Interprocedural](#core-concept-4--intraprocedural-vs-interprocedural)
8. [Core Concept 5 — Sanitizers, Implicit Flows, and Where Tools Give Up](#core-concept-5--sanitizers-implicit-flows-and-where-tools-give-up)
9. [Core Concept 6 — Semgrep Taint Mode in Practice](#core-concept-6--semgrep-taint-mode-in-practice)
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

> Focus: **modelling a program as a control-flow graph, watching taint travel along it, and understanding why crossing function boundaries (interprocedural analysis) is where both the power and the cost live.**

At the junior tier, taint was an intuition: untrusted data flows to a dangerous place. At this tier we make "flows" mechanical. A program is a **graph of basic blocks** (the control-flow graph). A taint analysis is a procedure that pushes a set of facts — *"variable `x` is tainted here"* — along that graph until nothing changes. That's the engine. Once you see it, you understand why intraprocedural analysis is cheap and shallow, why interprocedural analysis is expensive and powerful, and why every real tool makes compromises.

## Prerequisites

- You can read the [junior](junior.md) tier: source / sanitizer / sink, the worked SQLi trace.
- You can read code in Python, JS, Go, or Java and recognize function calls, branches, and loops.
- You have run a SAST tool (Semgrep, CodeQL, Bandit) at least once — see [SAST & Security Scanners](../04-sast-security-scanners/).
- Helpful: you know what an **AST** is — see [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/).

## Glossary

| Term | Meaning |
|------|---------|
| **CFG** | Control-flow graph — basic blocks as nodes, possible execution transitions as edges. |
| **Basic block** | A straight-line run of statements with one entry and one exit (no branches in the middle). |
| **Data-flow fact** | A piece of information attached to a program point (e.g. "`x` is tainted"). |
| **Transfer function** | The rule for how one statement transforms the incoming facts into outgoing facts. |
| **Forward analysis** | Facts flow along execution direction (taint, reaching definitions). |
| **Backward analysis** | Facts flow against execution direction (live variables). |
| **Intraprocedural** | Analysis within a single function, no call following. |
| **Interprocedural** | Analysis across function calls, via a call graph and/or summaries. |
| **Call graph** | Which functions can call which — the map interprocedural analysis walks. |
| **Summary** | A compact "if tainted in, tainted out" description of a function, reused at every call site. |
| **Implicit flow** | Taint that leaks through *control* (a branch on tainted data) rather than direct assignment. |

## Core Concept 1 — The Control-Flow Graph (CFG)

Every data-flow analysis starts by turning code into a **control-flow graph**: nodes are *basic blocks* (straight-line code), edges are the jumps between them. Consider:

```python
def f(req):
    x = req.args["q"]      # B0
    if admin(req):
        x = sanitize(x)    # B1
    log(x)                 # B2
    db.execute(x)          # B2
```

Its CFG:

```
        ┌──────────────────────┐
        │ B0:  x = req.args[q]  │   (source: x tainted)
        └──────────┬───────────┘
            true   │   false
        ┌──────────┴───────────┐
        ▼                      │
 ┌──────────────────┐          │
 │ B1: x=sanitize(x)│          │
 └────────┬─────────┘          │
          │                    │
          ▼                    ▼
        ┌──────────────────────┐
        │ B2:  log(x)          │
        │      db.execute(x)   │   (sink)
        └──────────────────────┘
```

The CFG makes branching explicit. Block `B2` has **two incoming edges**: one path went through the sanitizer (`B1`), one didn't (the `false` branch). What happens at the *merge* point is the whole game — and it's where soundness decisions are made (Core Concept 5).

## Core Concept 2 — Data-Flow as Facts That Travel the CFG

A data-flow analysis attaches a **set of facts** to each program point and computes how each statement changes them. For taint, the fact is "which variables are tainted." Each statement has a **transfer function** — given the taint set coming in, it produces the taint set going out:

```
  in[B]  ── transfer(B) ──►  out[B]
```

Classic textbook analyses are the same machinery with different facts:

| Analysis | Fact tracked | Direction | What it answers |
|---|---|---|---|
| **Reaching definitions** | which assignments can reach here | forward | "could this var have been set there?" |
| **Live variables** | which vars are used later | backward | "is this assignment dead?" |
| **Available expressions** | which expressions are already computed | forward | "can I reuse this?" |
| **Taint** | which vars carry untrusted data | forward | "did untrusted data get here?" |

Taint is a **forward** analysis (facts move with execution) and — as you'll see — a **may** analysis: a variable is treated as tainted if it's tainted on *any* incoming path. The rigorous lattice/fixpoint formulation of all of this lives in [senior.md](senior.md); here, hold the picture: *facts in, statement transforms them, facts out, repeat until stable.*

## Core Concept 3 — Taint Propagation Rules

The analysis needs rules for how taint moves through each kind of statement. A representative rule set:

```
ASSIGNMENT     y = x            if x tainted → y tainted; else y clean (kills old taint)
CONCATENATION  z = a + b        z tainted if a OR b tainted
METHOD/PROP    z = x.foo()      z tainted if x tainted (default: methods propagate)
              z = x.field       z tainted if x.field tainted (field-sensitivity, see senior)
COLLECTION     list.add(x)      list "carries" taint if x tainted
SOURCE         x = req.param    x tainted (rule says this call is a source)
SANITIZER      y = escape(x)    y CLEAN regardless of x (rule says this call cleans)
SINK           exec(x)          if x tainted at this point → FINDING
```

Two subtleties that trip people up:

- **Assignment kills taint.** `y = "constant"` makes `y` clean even if it was tainted before — the old value is gone. This is why flow-sensitivity (tracking facts *per program point*) matters.
- **Propagation is the default; cleaning is the exception.** Tools assume most operations *preserve* taint (over-approximate) and only clear it at functions explicitly modeled as sanitizers. That bias is deliberate: it favors catching bugs (fewer false negatives) over silence.

## Core Concept 4 — Intraprocedural vs Interprocedural

This is the central distinction of the topic.

**Intraprocedural** analysis stays inside one function. It's fast and simple but blind at call boundaries — it must *assume* something about every call. Either it assumes calls don't propagate taint (misses real bugs) or that they always do (drowns in false positives). The junior worked-trace bug — source in `get_user`, sink three calls deep in `build_query` — is **invisible** to a purely intraprocedural analysis.

**Interprocedural** analysis follows calls. Two strategies:

1. **Inlining / call-graph walking** — virtually expand callees at each call site. Precise but explodes in size; recursion needs special handling.
2. **Function summaries** — analyze each function *once* to produce a compact summary like *"argument 0's taint flows to the return value"*, then reuse that summary at every call site.

```
  build_query summary:   taint(arg0)  ⇒  taint(return)
  lookup summary:        taint(arg0)  ⇒  taint(return)  [because it calls build_query]
  get_user:              source → lookup(arg) → db.execute(...)  ← FINDING via summaries
```

Summaries are how real tools (CodeQL, Infer, Pysa) scale to millions of lines: analyze functions bottom-up, reuse results. **Interprocedural analysis is where taint analysis earns its keep — and where almost all the cost and complexity live.**

A related cost dimension is **context-sensitivity**: does the analysis distinguish two *different* call sites of the same function? A context-*insensitive* analysis merges them — if `helper` is ever called with tainted input anywhere, it treats `helper`'s output as tainted *everywhere*, causing false positives. Context-sensitivity fixes that at real expense (covered in [senior.md](senior.md)).

## Core Concept 5 — Sanitizers, Implicit Flows, and Where Tools Give Up

**Merge points and sanitizers.** Recall the CFG in Concept 1: `B2` is reached by a sanitized path and an unsanitized path. A *may* analysis takes the **union** at merges — tainted on *any* path means tainted — so `B2` sees `x` as tainted and reports the sink. That's correct: the `false` branch really is exploitable. Sanitizing on *one* branch isn't enough; you must sanitize on *all* paths to the sink (or, better, right before the sink).

**Implicit (control-flow) taint.** Taint can leak without a direct assignment:

```python
secret = read_secret()        # tainted (sensitive)
if secret[0] == 'a':
    print("starts with a")    # leaks 1 bit, no assignment of `secret`
```

This is an **implicit flow** — information flows through the *branch decision*, not through data. Most security taint tools deliberately **ignore implicit flows**: tracking them precisely is intractable and floods the report with noise. Knowing tools skip implicit flows tells you a real class of leak they will miss.

**Where tools give up entirely** (all detailed in [senior.md](senior.md) and [professional.md](professional.md)):

- **Reflection / dynamic dispatch** — `getattr(obj, name)()`, `Method.invoke()` — the callee isn't known statically, so the call graph has holes.
- **`eval` / dynamic code** — code constructed at runtime can't be analyzed.
- **Deserialization / ORMs / framework "magic"** — data appears in variables the tool never saw assigned.
- **Native / FFI calls** — opaque; the tool needs a hand-written **model** (stub) saying what taint they propagate.

The fix for all of these is the same: supply **models** — small declarations telling the tool "this framework function is a source," "this returns its argument's taint," "this is a sink." Modeling is the unglamorous core skill of running these tools well.

## Core Concept 6 — Semgrep Taint Mode in Practice

Semgrep's **taint mode** is the most approachable real taint engine: you declare sources, sinks, and sanitizers as patterns and it does intraprocedural (and, in newer versions, limited interprocedural) propagation. A rule for the SQLi from the junior trace:

```yaml
rules:
  - id: tainted-sql-execution
    mode: taint
    message: User input flows into a SQL query without parameterization.
    severity: ERROR
    languages: [python]
    pattern-sources:
      - pattern: request.args[...]
      - pattern: request.form[...]
    pattern-sanitizers:
      - pattern: db.execute("...", ...)      # parameterized call shape is safe
      - pattern: int($X)                       # casting to int removes SQLi risk
    pattern-sinks:
      - pattern: db.execute($SQL, ...)
```

Semgrep tracks taint from any source pattern to any sink pattern *unless* it passes a sanitizer pattern. Compared to a plain `pattern:` rule (which is pure AST matching, see [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/)), taint mode adds the *flow* — so it won't fire when the value was `int()`-cast first, and it *will* fire when the value travels through intermediate variables. The trade-off: Semgrep's interprocedural reach is far shallower than CodeQL's. Semgrep is fast and rule-author-friendly; CodeQL is deep and slow. Choosing between them is a [senior](senior.md)/[professional](professional.md) decision.

## Real-World Examples

- **The branch that wasn't sanitized.** A code path sanitized user input inside an `if is_admin:` block but used the raw value on the `else` path. Intraprocedural taint with proper merge-point handling flagged the unsanitized path; a careless reviewer missed it.
- **Summary reuse catching a deep bug.** A utility `render_template(name)` deep in a shared library was a sink. The taint tool's summary for it propagated to dozens of call sites; one of them passed a request header. No human had connected those files.
- **The reflection blind spot.** A plugin system dispatched handlers via `getattr(module, action)(payload)`. The tool couldn't resolve `action`, so it never connected the request to the handler's SQL sink — a false negative fixed only by adding a model.
- **Semgrep noise from no sanitizer model.** A team's custom `safe_query()` wrapper *was* safe, but Semgrep didn't know it, so every call lit up. Adding it as a `pattern-sanitizers` entry killed the noise.

## Mental Models

- **The CFG is the road map; taint is a rumor spreading along it.** At every fork the rumor takes both roads; at a merge, anyone who heard it on *either* road now knows it.
- **Summaries are pre-computed answers.** Analyze a function once, write down "taint in arg → taint in return," reuse forever. This is dynamic programming for whole-program analysis.
- **Intraprocedural = reading one chapter; interprocedural = reading the whole book.** A bug whose source and sink are in different chapters is invisible to per-chapter reading.
- **The tool only knows what you model.** Frameworks, native calls, and reflection are black boxes until you describe them.

## Common Mistakes

- **Sanitizing on one branch.** A sanitizer on the `if` path doesn't protect the `else` path. Sanitize on every path to the sink, or immediately before it.
- **Expecting intraprocedural tools to find cross-function bugs.** If source and sink are in different functions, you need interprocedural analysis or you'll get false negatives.
- **Forgetting to model custom sanitizers.** Your `safe_query()` wrapper is invisible until declared a sanitizer — until then you drown in false positives.
- **Assuming taint tools catch implicit flows.** Most ignore control-flow leaks by design. Don't rely on them for information-leak detection.
- **Treating Semgrep taint mode and CodeQL as interchangeable.** Their depth and cost differ by an order of magnitude.

## Test Yourself

1. Draw the CFG for a function with one `if/else` and identify the merge block.
2. What is a *transfer function*? Give the rule for `z = a + b`.
3. Why does assignment of a constant *kill* taint? What property of the analysis makes that possible?
4. Why is the junior-tier SQLi bug invisible to a purely intraprocedural analysis?
5. What is a function *summary* and why does it matter for scale?
6. At a CFG merge with one sanitized and one unsanitized path, is the variable tainted afterward? Why?
7. What is an implicit flow, and why do most security taint tools ignore it?
8. Write a Semgrep taint rule with one source, one sink, and one sanitizer.

## Cheat Sheet

```
CFG               basic blocks (nodes) + control edges; merges are where soundness is decided
DATA-FLOW         in[B] --transfer(B)--> out[B], repeat until stable
TAINT             forward + may analysis (tainted on ANY incoming path = tainted)
PROPAGATION       y=x copies taint; a+b unions; assign-constant KILLS taint
                  default = propagate; sanitizer = the only thing that clears

INTRA vs INTER
  intraprocedural   one function; fast; blind at calls (false negatives across functions)
  interprocedural   follows calls via call graph + SUMMARIES; powerful; expensive
  context-sensitive distinguishes call sites; fewer FPs; costlier

TOOLS GIVE UP ON  reflection, dynamic dispatch, eval, deserialization, native/FFI → need MODELS
IMPLICIT FLOW     taint via branch decision, not assignment → most tools IGNORE it

SEMGREP TAINT MODE
  mode: taint + pattern-sources / pattern-sanitizers / pattern-sinks
  shallow interprocedural; fast; rule-author-friendly (vs CodeQL: deep + slow)
```

## Summary

A program becomes a **control-flow graph**; a data-flow analysis pushes **facts** along it via **transfer functions** until they stabilize. Taint is the forward, may-flavored instance: untrusted values propagate by default and are cleared only at modeled **sanitizers**; a tainted value live at a **sink** is a finding. The decisive axis is **intraprocedural vs interprocedural** — staying in one function is cheap but misses cross-function bugs, while following calls (via a call graph and **summaries**) is where the real power and nearly all the cost reside. Tools go blind at reflection, `eval`, deserialization, and native calls, requiring hand-written **models**, and most deliberately ignore **implicit flows**. Semgrep's taint mode is the friendliest place to practice declaring sources, sinks, and sanitizers. The formal lattice/fixpoint underpinning and the precision/soundness trade-offs are the next tier.

## Further Reading

- Aho, Lam, Sethi & Ullman — *Compilers: Principles, Techniques, and Tools* ("the Dragon Book"), Ch. 9 — data-flow analysis and the CFG framework.
- Semgrep documentation — *Taint mode* (sources, sanitizers, sinks; the rule syntax above).
- Reps, Horwitz & Sagiv — *Precise Interprocedural Dataflow Analysis via Graph Reachability* (the IFDS framework behind interprocedural summaries) — skim for the idea.
- [SAST & Security Scanners](../04-sast-security-scanners/) — `middle.md` for tool selection and signal management.

## Related Topics

- [SAST & Security Scanners](../04-sast-security-scanners/) — the product category this engine powers.
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — AST matching, the layer below data-flow propagation.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — runtime taint tracking, which sidesteps the static blind spots at the cost of needing execution.
- [Formal Methods & Verification](../../formal-methods-and-verification/) — the same lattice/fixpoint rigor, pushed toward proof.
