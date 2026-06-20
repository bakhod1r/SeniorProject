# Cyclomatic & Cognitive Complexity — Middle Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Cyclomatic & Cognitive Complexity
> *The junior page told you these numbers exist and roughly what they warn about. This page makes them precise: the control-flow graph McCabe actually counts, the three formulas that all give the same answer, the exact rules SonarSource uses for cognitive complexity, and the function where the two metrics openly disagree about which version is worse.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Control-Flow Graph — What McCabe Actually Counts](#the-control-flow-graph--what-mccabe-actually-counts)
4. [Three Formulas, One Number](#three-formulas-one-number)
5. [What V(G) Bounds — Basis Paths and the Test-Count Link](#what-vg-bounds--basis-paths-and-the-test-count-link)
6. [Where Cyclomatic Misleads — switch and Guard Clauses](#where-cyclomatic-misleads--switch-and-guard-clauses)
7. [Cognitive Complexity — the SonarSource Rules in Detail](#cognitive-complexity--the-sonarsource-rules-in-detail)
8. [Worked Example — One Function, Two Numbers, Opposite Verdicts](#worked-example--one-function-two-numbers-opposite-verdicts)
9. [Thresholds, Aggregation, and Tooling](#thresholds-aggregation-and-tooling)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I compute each metric precisely, and what decision does each number actually license?**

At the junior level both metrics are "bigger means harder to follow." That's directionally true and operationally useless. It can't tell you *why* a 12-arm `switch` scores 13 on one metric and 1 on the other, *why* McCabe's number is also a statement about your test suite, or *why* two functions with identical cyclomatic complexity can be ten minutes apart in how long they take to understand.

The answers are mechanical. **Cyclomatic complexity** is a property of a graph — the control-flow graph — and McCabe gives three formulas that provably agree. **Cognitive complexity** is a property of how that control flow reads to a human, computed by a small rulebook from SonarSource that does the one thing McCabe refuses to do: it charges extra for *nesting*. This page derives both from the same code, shows you the tool output, and walks the example where they point in opposite directions — because knowing which metric to trust *when* is the entire skill.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say what each metric warns about in one sentence.
- **Required:** You can read a control-flow diagram (boxes for statements, arrows for branches).
- **Helpful:** You've run at least one linter and seen a "function too complex" warning.
- **Helpful:** A rough sense of "branch coverage" from [Code Coverage](../../code-coverage/).

---

## The Control-Flow Graph — What McCabe Actually Counts

Cyclomatic complexity is **not** a property of source text. It is a property of the program's **control-flow graph (CFG)**: a directed graph where **nodes** are maximal straight-line blocks of code (a "basic block" — statements that always execute together, with no branch in or out), and **edges** are the possible transfers of control between them.

Consider a small function:

```python
def classify(n):          # 1  ENTRY / first block
    if n < 0:             #    decision
        label = "neg"     # 2
    else:
        label = "nonneg"  # 3
    if n % 2 == 0:        # 4  decision (both branches converge here)
        label += "-even"  # 5
    return label          # 6  EXIT
```

Its CFG has these nodes and edges:

```
        (1) if n<0
        /        \
   (2) neg    (3) nonneg
        \        /
        (4) if even        ← both paths merge, then branch again
        /        \
  (5) +="-even"   |
        \        /
        (6) return         ← EXIT
```

Counting: **N = 6 nodes**, **E = 7 edges** (1→2, 1→3, 2→4, 3→4, 4→5, 4→6, 5→6), and **P = 1** connected component (one function). Hold these three numbers; the next section turns them into V(G) three different ways.

> **Key insight:** Cyclomatic complexity measures the *shape of the control flow*, not the amount of code. A 500-line function that is one long straight line of assignments has V(G) = 1. A 10-line function with nested branches can score 6. The metric counts *decisions*, and a decision is anything that makes the CFG fork.

---

## Three Formulas, One Number

McCabe (1976) gave three formulations. On a structured CFG they all produce the same value — that equivalence is the heart of the metric, and seeing it makes the number stop feeling arbitrary.

**1. The graph formula:** `V(G) = E − N + 2P`

With `E = 7`, `N = 6`, `P = 1`:

```
V(G) = 7 − 6 + 2(1) = 3
```

(The `2P` term is the textbook form for a graph with one entry and one exit per component. You will also see `E − N + P` — that's the *cyclomatic number* of graph theory, which counts independent cycles; McCabe adds `P` to account for the implicit edge from exit back to entry, giving `E − N + 2P`. For a single routine, `P = 1`, so the two differ by exactly 1. Pick one convention and state it.)

**2. The decision-point formula:** `V(G) = D + 1`

Count the **decision points** `D` — the constructs that fork control — and add one:

| Construct | Adds to D |
|---|---|
| `if`, `else if` | +1 each |
| `for`, `while`, `do…while` | +1 each |
| `case` label in a `switch` (per arm) | +1 each |
| `catch` clause | +1 each |
| `&&`, `\|\|` (short-circuit operators) | +1 each |
| ternary `?:` | +1 |

Our `classify` has two `if` decisions, so `D = 2` and `V(G) = 2 + 1 = 3`. ✓ Matches the graph formula.

**3. The regions formula:** `V(G) = number of closed regions + 1`

Draw the CFG on paper (planar). Count the **bounded regions** the edges enclose, then add 1 for the unbounded outer region. `classify` encloses two "eye" shapes (one per `if`/merge diamond), so `2 + 1 = 3`. ✓

All three agree: **V(G) = 3**. That's not a coincidence of this example — it's a theorem. The decision-point formula is the one you compute by hand; the graph formula is the one tools compute; the regions formula is the one that makes it visual.

> **Key insight:** `V(G) = D + 1` is the working definition. Every decision point adds exactly one to the count, and the `+1` is the single straight-line path you'd have with no decisions at all. If you can count `if`/loop/`case`/`&&`/`?:`, you can compute cyclomatic complexity without ever drawing a graph.

---

## What V(G) Bounds — Basis Paths and the Test-Count Link

Cyclomatic complexity is famous as "number of paths," which is *wrong* and worth correcting precisely. A function with a loop has *infinitely* many execution paths (loop zero times, once, twice…). V(G) bounds something stricter: the number of **linearly independent paths** through the CFG — the **basis paths**.

A basis path is one that introduces at least one edge no previous basis path used. Just as any vector in a plane is a combination of two basis vectors, *any* execution path through the function is a combination of these `V(G)` basis paths. For `classify` (V(G) = 3), a basis set is:

```
Path A: 1→2→4→6           (neg, odd)         covers edges 1-2, 2-4, 4-6
Path B: 1→3→4→6           (nonneg, odd)      adds edge 1-3, 3-4
Path C: 1→2→4→5→6         (neg, even)        adds edge 4-5, 5-6
```

Three paths exercise every edge at least once. This is the operational payoff: **V(G) is the minimum number of test cases needed to cover every edge of the CFG** — i.e., to achieve **branch coverage** by traversing each independent path. This is McCabe's **basis-path testing**, and it's the bridge to [Code Coverage](../../code-coverage/): if a function has V(G) = 12, you need *at least* 12 tests to drive every branch through, and a coverage report showing 4 tests at 100% line coverage is telling you lines were *executed*, not that the *branches* were covered.

> **Key insight:** V(G) is a lower bound on the number of tests for full branch coverage, not the number of runtime paths (which loops make infinite). When someone says "this function needs more tests," cyclomatic complexity gives the *minimum* number that could possibly cover its branches. A test count well below V(G) is mathematically guaranteed to leave branches unexercised.

---

## Where Cyclomatic Misleads — switch and Guard Clauses

McCabe's number is precise but blunt in two recurring cases, both of which a senior reviewer learns to discount.

**1. `switch` statements inflate it.** Every `case` adds +1, so a flat dispatch over an enum scores high:

```go
func opcodeName(op byte) string {
    switch op {                 // 12 cases →
    case 0x01: return "PUSH"    // +1
    case 0x02: return "POP"     // +1
    case 0x03: return "ADD"     // +1
    // ... 9 more arms ...
    default:   return "UNKNOWN" // +1
    }
}
```

V(G) here is **13**. By the threshold rules below, that flags as "very complex" — but no human finds a flat `switch` hard to read. The control flow is a fan-out with no nesting; each arm is independent and trivial. The metric is counting *branches* and can't tell that they're *parallel and shallow* rather than *tangled and deep*. This is the single most common false positive in cyclomatic complexity, and it's exactly the case cognitive complexity was designed to forgive.

**2. Guard clauses look the same as nesting.** Early returns add decision points just like nested `if`s, so the metric can't distinguish the *clearer* style from the *muddier* one:

```python
# Guard-clause style — easy to read, V(G) = 4
def withdraw(acct, amt):
    if amt <= 0:       return Err("nonpositive")
    if acct.frozen:    return Err("frozen")
    if amt > acct.bal: return Err("insufficient")
    acct.bal -= amt
    return Ok()

# Nested style — same V(G) = 4, harder to read
def withdraw(acct, amt):
    if amt > 0:
        if not acct.frozen:
            if amt <= acct.bal:
                acct.bal -= amt
                return Ok()
            else: return Err("insufficient")
        else: return Err("frozen")
    else: return Err("nonpositive")
```

Both score **V(G) = 4** — four decisions either way. Yet the first version is the textbook refactor *of* the second. Cyclomatic complexity is blind to the difference because it only counts decisions, not how deeply they're stacked. That blindness is precisely the gap cognitive complexity fills.

---

## Cognitive Complexity — the SonarSource Rules in Detail

Cognitive complexity (G. Ann Campbell, SonarSource, 2017) is built to measure **how hard code is to *understand***, not how many tests it needs. It abandons McCabe's graph entirely and scores source structure with three rules:

**Rule 1 — Increment for each break in linear flow.** Add **+1** for every construct that interrupts straight-line reading: `if`, `else if`, `else`, ternary, `switch` (the whole statement, **+1 once** — not per case), `for`, `while`, `do…while`, `catch`, and each sequence of boolean operators (a run of `&&` is +1, a run of `||` is +1; mixing them adds again). Also `goto`/`break`/`continue` *to a label*, and recursion.

**Rule 2 — Increment for nesting.** Each of those flow-breaking structures *also* adds **+1 for every level of nesting it sits inside**. An `if` at the top level adds 1; the same `if` nested two levels deep adds 1 (its own increment) **+ 2** (the nesting penalty) = 3. This is the rule McCabe lacks, and it's why cognitive complexity punishes the deeply-nested `withdraw` and forgives the flat one.

**Rule 3 — No penalty for shorthand that aids reading.** Structures that *reduce* cognitive load cost nothing. The `else if` chain doesn't re-pay nesting for each link. A whole `switch` is +1 regardless of arm count (because once you see `switch (x)` you read the arms as a flat table). Named methods don't add nesting to their callers the way inlined logic would. The metric is explicitly tuned so that *idioms a human reads fluently are free*.

Applying these to the two `withdraw` versions:

```
Guard-clause version:
  if amt<=0      → +1  (nesting 0)
  if acct.frozen → +1  (nesting 0)
  if amt>bal     → +1  (nesting 0)
  Cognitive = 3

Nested version:
  if amt>0           → +1  (nesting 0)
    if not frozen    → +1 +1 (nesting 1)        = 2
      if amt<=bal    → +1 +2 (nesting 2)        = 3
      else           → +1 +2                    = 3   (else also nests)
    else             → +1 +1                    = 2
  else               → +1                       = 1
  Cognitive = 11
```

Same cyclomatic complexity (4); cognitive complexity of **3 vs 11**. The metric now *agrees with the reviewer*: the nested version is meaningfully harder, and the number says so.

> **Key insight:** The defining difference is nesting. Cyclomatic complexity adds 1 per decision regardless of depth; cognitive complexity adds 1 per decision **plus 1 per level of enclosing nesting**. That single rule is why flattening `if`-pyramids into guard clauses leaves V(G) unchanged but slashes cognitive complexity — and why cognitive complexity tracks "how this code *feels*" far better.

---

## Worked Example — One Function, Two Numbers, Opposite Verdicts

Two functions, deliberately constructed so the metrics disagree about which is worse.

**Function 1 — a flat dispatcher (high cyclomatic, low cognitive):**

```python
def http_status_text(code):
    if   code == 200: return "OK"
    elif code == 201: return "Created"
    elif code == 204: return "No Content"
    elif code == 400: return "Bad Request"
    elif code == 401: return "Unauthorized"
    elif code == 404: return "Not Found"
    elif code == 500: return "Internal Error"
    else:             return "Unknown"
```

- **Cyclomatic:** 7 `elif` decisions + 1 = **V(G) = 8** → over the usual "watch" threshold.
- **Cognitive:** The `if/elif/else` chain is one linear ladder at nesting 0. SonarSource scores the chain's first `if` as +1 and each `elif` as +1 *without* re-charging nesting → roughly **3–4**; many engineers read it as essentially **1** because it's a flat lookup. Either way: *low*.

**Function 2 — a nested validator (low cyclomatic, high cognitive):**

```python
def parse(record):
    if record:                          # +1   (n0)
        for field in record:            # +1+1 (n1)
            if field.required:          # +1+2 (n2)
                if field.value is None: # +1+3 (n3)
                    return Err(field)   #
    return Ok()
```

- **Cyclomatic:** decisions are `if record`, `for`, `if required`, `if None` = 4 + 1 = **V(G) = 5** → *under* the threshold; looks fine.
- **Cognitive:** `1 + (1+1) + (1+2) + (1+3) = 1 + 2 + 3 + 4 = ` **10** → *over* the threshold; flagged as hard.

Side by side:

| | Function 1 (flat) | Function 2 (nested) |
|---|---|---|
| Cyclomatic V(G) | **8** (high) | **5** (low) |
| Cognitive | ~3 (low) | **10** (high) |
| Which metric "flags" it | cyclomatic | cognitive |
| The honest verdict | easy to read | hard to read |

The flat dispatcher trips cyclomatic complexity and is *fine*. The nested validator slips under cyclomatic complexity and is the one that actually needs refactoring (extract the inner loop, invert with a guard clause). **This is the case for tracking both:** cyclomatic complexity flags branch-heavy code (relevant to *testing effort*), cognitive complexity flags tangled code (relevant to *reading and changing it*). When they disagree, cognitive complexity is the better predictor of "will a human struggle with this," and cyclomatic complexity is the better predictor of "how many tests does this need."

---

## Thresholds, Aggregation, and Tooling

**Thresholds in practice** are conventions, not laws — but the commonly cited bands (originating with McCabe and echoed by tools) are:

```
Cyclomatic V(G):  1–10   simple, low risk
                 11–20   moderate — review, more tests
                 21–50   high risk — refactor candidate
                  > 50   untestable / unmaintainable in practice

Cognitive:        0–5    clear
                  6–10   getting busy
                 11–15   hard — refactor candidate (Sonar default warn ~15)
                  > 25   Sonar default failure on many profiles
```

Treat these as **triggers to go look**, never as grades. A function at V(G) = 11 isn't "failing"; it's *asking for a second pair of eyes*.

**Per-function vs per-file aggregation.** Both metrics are defined *per function*. How a tool rolls them up to a file or module changes the story:

- **Sum** over a file punishes large files even if every function is simple — a 40-function file of trivial getters can out-score a 3-function file of nightmares. Misleading on its own.
- **Max** (the worst single function) is usually the most actionable file-level number: it points at the one function to fix.
- **Average** hides outliers — a file with one V(G) = 60 monster and 30 trivial functions averages out to "fine."

The senior default: **report per-function, sort by the worst, and use max (not sum or average) as the file-level summary.** The decision the number drives is always "open *this function*," and only the per-function value supports that.

**Tooling** — the metric is only useful if it's wired into the build:

| Tool | Language(s) | What it reports |
|---|---|---|
| **lizard** | many (C/C++, Java, Python, Go, JS…) | cyclomatic (CCN), token count, params; great for polyglot repos |
| **gocyclo** | Go | cyclomatic per function; `gocyclo -over 10 .` |
| **radon** | Python | cyclomatic (`radon cc`), maintainability index (`radon mi`) |
| **ESLint `complexity`** | JS/TS | cyclomatic per function as a lint rule: `complexity: ["error", 10]` |
| **SonarQube / SonarLint** | many | **both** cyclomatic *and* cognitive, with the threshold gating built in |

A representative run:

```bash
$ gocyclo -over 10 .
13 main opcodeName ./vm/opcodes.go:14:1     # the flat switch — flagged, but a false positive
12 svc handleRequest ./svc/handler.go:88:1  # worth a real look

$ radon cc -s parser.py
parser.py
    F 12:0 parse - C (10)        # grade C, complexity 10
    F 30:0 tokenize - A (3)

$ npx eslint --rule '{"complexity": ["warn", 10]}' src/
src/router.js
  44:1  warning  Function 'dispatch' has a complexity of 14. Maximum allowed is 10
```

SonarQube is the one that shows cognitive complexity alongside cyclomatic, which is exactly why teams that care about *readability* (not just test count) standardize on it. Note how `gocyclo` flags the flat `switch` — the tool can't apply judgment, so the *reviewer* must: high cyclomatic + low cognitive on a flat dispatch is the signal to override the warning.

---

## Mental Models

- **Cyclomatic complexity counts forks in the road; cognitive complexity counts how lost you get.** Both start from control flow, but the first asks "how many ways through?" and the second asks "how hard is it to hold in your head?" — and nesting is the wedge between them.

- **V(G) is a test budget, not a path count.** It's the minimum number of tests to cover every branch. Loops make actual paths infinite; the *basis* paths are finite and equal to V(G). A test count below V(G) leaves branches uncovered, guaranteed.

- **Nesting is the tax cognitive complexity charges and cyclomatic doesn't.** Flatten an `if`-pyramid into guard clauses: V(G) stays put (same number of decisions), cognitive complexity drops sharply (no more nesting penalty). The refactor that "feels" cleaner *is* cleaner by exactly the cognitive metric.

- **A flat `switch` is the canonical "high cyclomatic, low cognitive" — trust the cognitive number there.** A deep `if`-nest is the canonical opposite. When the two metrics disagree, they're each telling the truth about a *different* property; read both, don't average them.

---

## Common Mistakes

1. **Saying V(G) is "the number of paths."** It's the number of *linearly independent* (basis) paths, which for any function with a loop is finite while the real paths are infinite. The correct framing is "minimum tests for branch coverage."

2. **Treating a flat `switch`'s high cyclomatic score as a problem.** A 15-arm `switch` scores 16 and is perfectly readable. Cross-check with cognitive complexity (which scores it ~1) before "refactoring" a clear dispatch into something worse.

3. **Believing cyclomatic complexity can tell guard clauses from nested `if`s.** It can't — both styles have identical V(G). Only cognitive complexity (via the nesting penalty) distinguishes the clean refactor from the mess it replaced.

4. **Aggregating per-file by sum or average.** Sum punishes big-but-simple files; average hides the one monster function. Report per-function and use *max* as the file summary, since the action is always "fix this function."

5. **Turning the threshold into a grade.** "Keep every function under 10" as a hard gate breeds gaming — people split one coherent function into three artificial ones to dodge the number, making the code *harder* to follow. Thresholds are "go look," not "you failed." (See [Maintainability Index](../02-maintainability-index/middle.md) for how composite scores amplify this trap.)

6. **Forgetting `&&`, `||`, and `?:` count.** Boolean short-circuit operators each add a decision point in cyclomatic complexity. A single line `return a && b && c || d` quietly adds 3 to V(G); people miss these and compute the number too low.

---

## Test Yourself

1. State McCabe's graph formula and compute V(G) for a CFG with `E = 9`, `N = 7`, `P = 1`. Confirm it with the decision-point formula if the routine has 3 `if`s.
2. Why is "cyclomatic complexity = number of execution paths" wrong, and what is the correct statement about what it counts?
3. A function has V(G) = 9. What is the minimum number of tests for full branch coverage, and why is that a *lower* bound, not an exact count?
4. A flat 12-arm `switch` scores V(G) = 13 but cognitive complexity ≈ 1. Explain the divergence in terms of each metric's definition.
5. Give the cognitive-complexity increment for an `if` that sits three levels deep inside other control structures. Show the arithmetic.
6. Two `withdraw` implementations (guard-clause vs nested) both have V(G) = 4. Which metric distinguishes them, by how much, and which rule causes the difference?

<details>
<summary>Answers</summary>

1. `V(G) = E − N + 2P = 9 − 7 + 2(1) = 4`. Decision-point check: 3 `if`s → `D + 1 = 3 + 1 = 4`. ✓ Both agree.
2. A function with a loop has infinitely many runtime paths (loop 0, 1, 2… times). V(G) counts the **linearly independent (basis) paths** — a finite set from which all paths are combinations. The correct statement: V(G) is the minimum number of tests to cover every *edge* (branch) of the CFG.
3. **9 tests minimum.** It's a lower bound because some basis paths may be *infeasible* (contradictory conditions can make a given edge-combination unreachable), and full path/condition coverage can require *more*; but you can never cover all branches with *fewer* than V(G) tests.
4. Cyclomatic counts each `case` as a decision (+1 per arm → 13). Cognitive counts the whole `switch` as **+1 once** (a flat table reads fluently) and applies no nesting penalty (depth 0). The metrics measure different properties: branch count vs reading difficulty.
5. `+1` (its own flow-break increment) `+ 3` (one per enclosing nesting level) = **4**.
6. **Cognitive complexity** distinguishes them: **3 (guard-clause) vs 11 (nested)** — roughly. The cause is **Rule 2, the nesting increment**: each nested `if`/`else` pays +1 per enclosing level, which the flat guard-clause version never incurs. Cyclomatic complexity is identical (4) because both have the same number of decisions.

</details>

---

## Cheat Sheet

```
CYCLOMATIC V(G) — three equal formulas (state your P convention)
  graph:      V(G) = E − N + 2P     (E edges, N nodes, P components; per routine P=1)
  decisions:  V(G) = D + 1          (D = if/elif/loop/case/catch/&&/||/?: )
  regions:    V(G) = bounded regions + 1   (draw planar CFG, count enclosed areas)
  MEANS:      min # tests for full BRANCH coverage (basis paths) — NOT runtime paths

COGNITIVE (SonarSource) — three rules
  +1   per break in linear flow (if/else/loop/catch/ternary; whole switch = +1; bool-op run)
  +1   per ENCLOSING nesting level, added on top of the structure's own increment
  +0   for shorthand that aids reading (else-if chain, named methods, flat switch)
  MEANS:      how hard a HUMAN finds it to understand

WHEN THEY DISAGREE
  flat switch / if-elif ladder :  HIGH cyclomatic, LOW cognitive  → trust cognitive (it's fine)
  deep nested if-pyramid       :  LOW  cyclomatic, HIGH cognitive  → trust cognitive (refactor)
  guard clauses vs nested ifs  :  SAME cyclomatic; cognitive splits them (nesting penalty)

THRESHOLDS (triggers to LOOK, not grades)
  cyclomatic  1–10 ok | 11–20 review | 21–50 refactor | >50 untestable
  cognitive   ≤5 clear | 6–10 busy | 11–15 hard | >25 Sonar fail (default)

AGGREGATION
  per-function is the real metric.  File summary = MAX (not sum, not average).

TOOLS
  lizard (polyglot) · gocyclo (Go) · radon cc (Py) · ESLint complexity (JS/TS)
  SonarQube/SonarLint → BOTH cyclomatic AND cognitive, with gating
```

---

## Summary

- Cyclomatic complexity is a property of the **control-flow graph**, not the source text: nodes are basic blocks, edges are control transfers. It counts the *shape* of the branching, so straight-line code scores 1 no matter how long.
- McCabe's three formulas agree by theorem: **`V(G) = E − N + 2P`** (graph), **`V(G) = D + 1`** (decision points — the one you compute by hand), and **regions + 1** (visual). State whether you use the `2P` or `+P` convention.
- V(G) bounds the **linearly independent (basis) paths**, which equals the **minimum number of tests for branch coverage** — the link to [Code Coverage](../../code-coverage/). It is *not* the number of runtime paths (loops make those infinite).
- Cyclomatic complexity **misleads on flat `switch`** statements (inflated) and **can't distinguish guard clauses from nested `if`s** (identical scores). These are exactly the gaps cognitive complexity fills.
- **Cognitive complexity** (SonarSource) scores reading difficulty with three rules: **+1 per flow break**, **+1 per nesting level** (the rule McCabe lacks), and **+0 for readable shorthand** (whole `switch` = +1, `else-if` chains free). Nesting is the wedge between the two metrics.
- When the metrics **disagree** — flat dispatch (high cyclomatic, low cognitive) vs deep nest (low cyclomatic, high cognitive) — each is right about a different property. Track both: cyclomatic for *test effort*, cognitive for *readability*. Report per-function, summarize files by **max**, and treat thresholds as "go look," never as grades.

---

## Further Reading

- *A Complexity Measure* — Thomas McCabe (IEEE TSE, 1976). The original paper; the graph formula and basis-path testing are defined here.
- *Cognitive Complexity: A new way of measuring understandability* — G. Ann Campbell / SonarSource (white paper, 2017). The exact rulebook, with the nesting-increment rationale.
- *Structured Testing: A Testing Methodology Using the Cyclomatic Complexity Metric* — McCabe & Watson (NIST 500-235). The definitive treatment of basis-path testing and the test-count bound.
- Tool docs: `lizard --help`, `gocyclo`, `radon cc --help`, ESLint `complexity` rule, and SonarQube's "Metric Definitions" page (cyclomatic *and* cognitive).

---

## Related Topics

- [junior.md](junior.md) — the intuition layer: what each metric warns about, without the formulas.
- [senior.md](senior.md) — gaming, governance, when to suppress a warning, and complexity as a risk signal rather than a gate.
- [02 — Maintainability Index](../02-maintainability-index/middle.md) — how cyclomatic complexity feeds the composite MI formula (and why composites are weaker than their parts).
- [03 — Coupling & Cohesion Metrics](../03-coupling-and-cohesion-metrics/middle.md) — complexity *within* a function vs complexity *between* modules.
- [Code Coverage](../../code-coverage/) — basis-path testing in practice: why V(G) is the floor on your test count for branch coverage.
