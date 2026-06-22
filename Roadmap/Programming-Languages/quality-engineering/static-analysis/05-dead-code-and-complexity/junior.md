# Dead Code & Complexity — Junior Level

> **Roadmap:** [Static Analysis](../README.md) → Dead Code & Complexity

*Code that never runs and code that's too tangled to follow — both can be spotted before you ship, by tools that read your source without executing it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What "dead code" means](#core-concept-1--what-dead-code-means)
5. [Core Concept 2 — Finding unused symbols with tools](#core-concept-2--finding-unused-symbols-with-tools)
6. [Core Concept 3 — Unreachable code after return](#core-concept-3--unreachable-code-after-return)
7. [Core Concept 4 — Your first complexity number](#core-concept-4--your-first-complexity-number)
8. [Core Concept 5 — Why a high number is a smell, not a verdict](#core-concept-5--why-a-high-number-is-a-smell-not-a-verdict)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **recognizing code that never runs and code that is too tangled to read, and using the tools that flag both for free.**

Two kinds of rot accumulate in every codebase. The first is **dead code** — a function nobody calls, an `import` nobody uses, a variable assigned and then ignored, a branch that can never be true. The second is **complexity** — a function so full of `if`s, loops, and nesting that you cannot hold it in your head. Both make the codebase harder to change, and both can be *measured statically*: a tool reads your files, builds a model of them, and tells you where the problems are without ever running your program.

This page is about the everyday wins. You will learn what your IDE's grey "unused" underline really means, how to run a command-line tool that lists dead symbols, why some code after a `return` is genuinely unreachable, and how to read your first complexity score. The deeper traps — why these tools sometimes lie, and how teams turn the numbers into gates — come in later tiers.

---

## Prerequisites

- You can read and write code in at least one language (Go, TypeScript, or Python examples are used here).
- You have run a linter or seen your editor underline a problem. If not, start with [Linters & Style Checkers](../01-linters-and-style-checkers/).
- You understand functions, branches (`if`/`else`), loops, and `return`.

---

## Glossary

| Term | Meaning |
|---|---|
| **Dead code** | Code that is never executed or whose result is never used. |
| **Unreachable code** | Statements the program can provably never reach (e.g. after a `return`). |
| **Unused symbol** | A declared variable, import, function, or parameter that nothing references. |
| **Reachability** | Whether execution can ever arrive at a given line. |
| **Cyclomatic complexity** | A count of the independent paths through a function (McCabe's metric). |
| **Cognitive complexity** | A measure of how *hard a function is to read* (SonarSource's metric). |
| **Nesting depth** | How many `if`/`for`/`while` blocks are stacked inside one another. |
| **Static** | Computed by reading source code, without running it. |

---

## Core Concept 1 — What "dead code" means

Dead code is code that has no effect on what your program does. If you deleted it, the program would behave identically. The common species:

- **Unused imports** — you imported a package and never used it.
- **Unused variables** — you assigned a value that is never read.
- **Unused functions** — a function nobody calls.
- **Unused parameters** — an argument the function ignores.
- **Unreachable statements** — lines after a `return`, `break`, `panic`, or `throw`.
- **Dead branches** — an `if` condition that is always (or never) true.

Why care? Dead code is not harmless. It:

- **Misleads readers.** People assume code exists for a reason and waste time understanding it.
- **Hides bugs.** A function you *think* is called but isn't may mask a wiring mistake.
- **Inflates the surface.** Every line is a line someone has to maintain, test, and review.

```go
package main

import (
    "fmt"
    "strings" // imported but never used → dead
)

func greet(name string) string {
    prefix := "Hello, " // assigned and used
    unused := "ignored" // assigned, never read → dead
    return prefix + name
}

func main() {
    fmt.Println(greet("world"))
}
```

A compiler like Go's is strict: **unused imports and unused local variables are compile errors** in Go, so the snippet above won't even build. Most languages are more permissive and rely on a linter to warn you instead.

---

## Core Concept 2 — Finding unused symbols with tools

Every ecosystem has a tool that lists dead symbols. You run it; it prints a list of file:line locations.

**Go** — the official `deadcode` tool finds unreachable functions across the whole program:

```console
$ go install golang.org/x/tools/cmd/deadcode@latest
$ deadcode ./...
internal/legacy/parser.go:42:6: func parseV1 is unreachable
internal/util/strings.go:88:6: func reverseRunes is unreachable
```

**TypeScript** — `ts-prune` (or its successor, `knip`) lists exports nothing imports:

```console
$ npx ts-prune
src/utils/format.ts:14 - formatLegacyDate
src/api/client.ts:9 - RawResponse (used in module)
```

**Python** — `vulture` finds unused code by name analysis:

```console
$ vulture mypackage/
mypackage/helpers.py:23: unused function 'normalize_phone' (60% confidence)
mypackage/models.py:5: unused import 'datetime' (90% confidence)
```

**JavaScript/TypeScript linting** — ESLint's `no-unused-vars` flags unused locals and imports inline:

```console
$ npx eslint src/
src/cart.ts
  3:10  error  'computeTax' is defined but never used  no-unused-vars
```

**Rust** — the compiler's built-in `dead_code` lint warns automatically:

```console
warning: function `helper` is never used
  --> src/lib.rs:12:4
   |
12 | fn helper() {}
   |    ^^^^^^
```

The pattern is always the same: install the tool, point it at your code, read the list, delete what's truly dead. (The "*truly*" is doing a lot of work — see the next tier for why.)

---

## Core Concept 3 — Unreachable code after return

The simplest, most certain kind of dead code is code the program can never reach. Once a function `return`s, anything after it in the same block is unreachable:

```typescript
function classify(n: number): string {
  if (n > 0) {
    return "positive";
    console.log("never runs"); // unreachable
  }
  return "non-positive";
}
```

Detecting this is **easy and certain**, even for a machine, because it doesn't depend on runtime values — it's pure control flow. The tool builds a *control-flow graph* (a map of which statement can follow which) and notices the `console.log` has no incoming edge. ESLint's `no-unreachable` and Go's compiler both flag this.

The same logic catches code after `break`, `continue`, `throw`, `panic`, and infinite loops. This is the part of reachability analysis that tools get right essentially always. The hard part — code that's reachable *in theory* but never *in practice* — is a later-tier topic.

---

## Core Concept 4 — Your first complexity number

**Cyclomatic complexity** (McCabe, 1976) counts the number of independent paths through a function. The intuition: start at 1, and **add 1 for every decision point** — each `if`, `case`, `for`, `while`, `&&`, `||`, and `?:`. A straight-line function with no branches scores 1.

Consider this function:

```go
func grade(score int) string {
    if score >= 90 {        // +1
        return "A"
    } else if score >= 80 { // +1
        return "B"
    } else if score >= 70 { // +1
        return "C"
    } else if score >= 60 { // +1
        return "D"
    }
    return "F"
}
```

Base 1 + four `if`/`else if` decisions = **cyclomatic complexity 5**. Run a tool to confirm:

```console
$ go install github.com/fzipp/gocyclo/cmd/gocyclo@latest
$ gocyclo -top 3 .
5 main grade grade.go:3:1
1 main main grade.go:15:1
```

The number 5 means there are five distinct paths through `grade`, which is also a strong hint that **a thorough test needs five test cases** — one per branch. That link between complexity and test effort is the metric's real value.

In Python, `radon` computes the same idea and grades it A–F:

```console
$ pip install radon
$ radon cc -s grade.py
grade.py
    F 3:0 grade - A (5)
```

---

## Core Concept 5 — Why a high number is a smell, not a verdict

Here is the single most important idea about complexity metrics: **a high number is a smell, not a verdict.** It tells you *where to look*, not *what to do*.

A `switch` over 30 country codes might have a cyclomatic complexity of 31 and be perfectly clear — flat, repetitive, easy to read. Meanwhile a function scoring 6 with three levels of clever nesting and a misleading variable name can be far harder to maintain. The number is a flashlight, not a judge.

This is why the second metric, **cognitive complexity**, exists. SonarSource designed it to track *how hard code is to understand*, not how many paths it has. It doesn't penalize a flat `switch`, but it adds a heavy penalty for **nesting** — each level deeper costs more — because nested logic is what actually overloads a reader's working memory.

```python
# cyclomatic ~ 4, but cognitively heavy: 3 levels of nesting
def find(rows, target):
    for row in rows:
        if row.active:
            for cell in row.cells:
                if cell.value == target:
                    return cell
    return None
```

When you see a high number, your job isn't to "make the number go down." It's to *read the function* and ask: can a colleague understand this in one pass? If yes, leave it. If no, that's a refactoring candidate.

---

## Real-World Examples

**The import that broke the build.** A junior adds `import pandas as pd` while prototyping, removes the code that used it, and commits. CI runs `ruff` with `F401` (unused import) enabled and fails the PR in 200 ms — cheaper than a human reviewer noticing, and far cheaper than shipping a needless dependency.

**The function nobody called.** A team ran `deadcode ./...` for the first time on a three-year-old Go service and found 40 unreachable functions — an entire abandoned "v1 export" path. Deleting it removed 1,200 lines and three test files. The code had been read, reviewed, and maintained for years, all for nothing.

**The grade function above.** A new hire's first PR had a 5-path `grade` function and exactly one test (the "A" case). The reviewer pasted the `gocyclo` output: *"complexity 5 means at least 5 cases to be safe."* The metric turned a vague "add more tests" into a concrete count.

---

## Mental Models

- **Dead code is a lie the codebase tells.** It says "I matter" while doing nothing. Tools call the bluff.
- **Reachability is a graph problem.** Tools draw a map of "what can follow what." If a node has no path in, it's dead.
- **Cyclomatic = number of paths ≈ number of tests.** Count the branches; that's roughly how many test cases the function demands.
- **Cognitive = how much it hurts to read.** Nesting hurts most. A flat list of cases barely hurts at all.
- **The number is a flashlight.** It points; you decide.

---

## Common Mistakes

| Mistake | Why it bites | Better |
|---|---|---|
| Deleting "dead" code a tool flagged without checking | Some "dead" code is called by reflection, tests, or external users | Confirm with a search before deleting (see middle tier) |
| Treating complexity as a grade to optimize | You game the number instead of improving the code | Use it to *find* candidates, then judge by reading |
| Ignoring the grey "unused" underline | It accumulates into clutter that hides real issues | Clean it as you go; it's the cheapest fix there is |
| Adding `_ = unused` to silence Go's unused-variable error | Hides a real "I forgot to use this" mistake | Use the variable or delete it |
| Splitting a function in two just to lower its complexity score | The logic is now spread across two places — often *harder* to read | Refactor for clarity, not for the metric |

---

## Test Yourself

1. Name three kinds of dead code besides "unreachable after return."
2. What is the cyclomatic complexity of a function with one `if/else` and no loops? (Hint: start at 1.)
3. Why is "code after a `return`" easy for a tool to detect with certainty, but "a function that's never called at runtime" sometimes not?
4. A flat `switch` with 20 cases scores 21 on cyclomatic complexity but is easy to read. Which metric is *designed* to reflect that it's actually simple?
5. Your IDE greys out an `import`. What does that mean and what should you do?

---

## Cheat Sheet

```text
FIND DEAD CODE
  Go          deadcode ./...        staticcheck ./...
  TS/JS       npx ts-prune          npx knip          eslint (no-unused-vars)
  Python      vulture mypackage/    ruff (F401 unused import, F841 unused var)
  Rust        cargo build           (dead_code lint is on by default)

MEASURE COMPLEXITY
  Go          gocyclo -over 10 .
  Python      radon cc -s .         (grades A–F)
  JS/TS       eslint complexity rule
  Java        pmd / checkstyle (CyclomaticComplexity)

CYCLOMATIC = 1 + (number of if / case / for / while / && / || / ?:)
  ≈ number of independent paths ≈ minimum thorough test count

A HIGH NUMBER IS A SMELL, NOT A VERDICT — read the code, then decide.
```

---

## Summary

Dead code (unused imports, variables, functions, and unreachable statements) and excessive complexity are both detectable *statically* — by tools that read your source without running it. Use `deadcode`/`staticcheck`, `ts-prune`/`knip`, `vulture`, and your linter's `no-unused-vars` rule to find dead symbols. Code after a `return` is provably unreachable and tools catch it with certainty. **Cyclomatic complexity** counts branches (≈ the number of tests a function needs); **cognitive complexity** estimates how hard code is to read and punishes nesting. Treat every number as a flashlight pointing you toward code worth a second look — never as a grade to game.

---

## Further Reading

- Thomas McCabe, *A Complexity Measure* (1976) — the original cyclomatic paper.
- SonarSource, *Cognitive Complexity: A new way of measuring understandability* (white paper).
- `gocyclo`, `radon`, `vulture`, `ts-prune`, and `knip` project READMEs.
- Go `deadcode` tool documentation (golang.org/x/tools).

---

## Related Topics

- [Linters & Style Checkers](../01-linters-and-style-checkers/) — where `no-unused-vars` lives.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — running these checks on every PR.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity in the wider metrics picture.
- The **refactoring-techniques** and **function-design** skills — how to actually reduce a complex function.
