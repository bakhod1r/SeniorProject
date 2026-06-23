# Custom Lint Rules & AST — Senior Level

> **Roadmap:** [Static Analysis](../README.md) → Custom Lint Rules & AST
> *Writing type-aware analyzers against the real compiler AST, testing them like production code, rolling them out without a revolt, and knowing when a rule is the wrong tool entirely.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- The Semgrep-to-Native Decision](#core-concept-1----the-semgrep-to-native-decision)
5. [Core Concept 2 -- The go/analysis Framework](#core-concept-2----the-goanalysis-framework)
6. [Core Concept 3 -- A Real go/analysis Analyzer End to End](#core-concept-3----a-real-goanalysis-analyzer-end-to-end)
7. [Core Concept 4 -- Type Information vs. Pure Syntax](#core-concept-4----type-information-vs-pure-syntax)
8. [Core Concept 5 -- Testing Custom Rules Properly](#core-concept-5----testing-custom-rules-properly)
9. [Core Concept 6 -- Rolling Out a New Rule: Warn -> Baseline -> Error](#core-concept-6----rolling-out-a-new-rule-warn---baseline---error)
10. [Core Concept 7 -- When a Rule Beats Review, a Comment, a Wrapper, or a Type](#core-concept-7----when-a-rule-beats-review-a-comment-a-wrapper-or-a-type)
11. [Core Concept 8 -- Performance and False Positives](#core-concept-8----performance-and-false-positives)
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

> Focus: **native analyzers (`go/analysis`) with type information, testing rules as production code, staged rollout, and the engineering judgment of when *not* to write a rule.**

Semgrep takes you a long way, but it matches mostly on syntax. The instant a rule needs to know *types* ("this `$X` is a `*sql.DB`," "this argument implements `io.Closer`"), resolve *what an identifier refers to* across files, or walk the AST with full control, you need a native analyzer. In Go that's the `go/analysis` framework — the same framework `go vet` and every `golangci-lint` analyzer use.

This page builds a real type-aware analyzer, shows how to test it the way Go's own analyzers are tested, lays out a humane rollout (warn -> baseline -> error), and — most importantly — develops the senior judgment of when a rule is genuinely the right mechanism versus when a wrapper API, a type, or a one-line comment would serve better at a fraction of the maintenance cost.

---

## Prerequisites

**Required**

- Middle level: Semgrep composition, ESLint rule structure, autofix, codemod vs rule.
- Working Go knowledge (packages, interfaces, the standard `testing` package).
- Comfort reading `go/ast` and `go/types` at a high level.

**Helpful**

- Experience operating a linter in CI across more than one repo.
- Familiarity with [Static Analysis in CI](../09-static-analysis-in-ci/) gating models.

---

## Glossary

| Term | Meaning |
|---|---|
| `go/analysis` | Go's framework for composable static analyzers (`Analyzer`, `Pass`). |
| `Analyzer` | A declared analysis: name, doc, run function, requirements, result type. |
| `Pass` | The per-package context handed to your run function (files, types, reporter). |
| `inspector` | Efficient AST traversal helper (`golang.org/x/tools/go/ast/inspector`). |
| `go/types` | The type checker; resolves identifiers to their types and definitions. |
| `analysistest` | Go's harness for testing analyzers against annotated `// want` fixtures. |
| Baseline | A recorded set of existing violations that the gate ignores ("grandfathered"). |
| SuggestedFix | A `go/analysis` autofix attached to a diagnostic. |
| False positive | A finding that is not actually a violation; the rule's biggest enemy. |
| Flow-insensitive | A rule that ignores execution order/paths (most syntactic rules). |

---

## Core Concept 1 -- The Semgrep-to-Native Decision

Don't reach for a native analyzer by default — they cost 5-10x more to build and maintain than a Semgrep rule. Reach for one only when Semgrep genuinely can't express the rule:

| Need | Tool |
|---|---|
| Ban/require a call or import, scoped syntactically | **Semgrep** |
| Match a code shape, prune with `pattern-not` | **Semgrep** |
| Source-to-sink data flow within a function | **Semgrep taint mode** |
| Decisions based on *resolved types* ("is this a `*sql.DB`?") | **Native** (`go/analysis`, ESLint+TS) |
| Cross-file symbol resolution / whole-program facts | **Native** |
| Complex control/data-flow across functions | **Native** |
| Conditional, context-sensitive autofixes | **Native** |

> The senior move is to *start* in Semgrep, ship value in a day, and graduate to native only when a concrete false-positive class proves syntax isn't enough.

---

## Core Concept 2 -- The go/analysis Framework

`go/analysis` standardizes analyzers so they compose (one driver runs many) and share work (type info computed once). Three objects:

- **`Analyzer`** — the declaration:

```go
var Analyzer = &analysis.Analyzer{
    Name:     "noprintln",
    Doc:      "reports use of fmt.Println in non-test code",
    Run:      run,
    Requires: []*analysis.Analyzer{inspect.Analyzer}, // reuse the AST inspector
}
```

- **`Pass`** — passed to `run` for each package. It carries `pass.Files` (the ASTs), `pass.TypesInfo` and `pass.Pkg` (type info), `pass.Report(...)` / `pass.Reportf(...)` (emit diagnostics), and `pass.ResultOf[...]` (results of required analyzers).

- **`inspector`** — efficient typed traversal: `inspect.Preorder(nodeFilter, func(n ast.Node){...})` calls you only for the node types you ask for, far faster than a hand-rolled `ast.Walk`.

The driver (`singlechecker`, `multichecker`, `go vet`, or `golangci-lint`) wires analyzers together. You write only the `Analyzer` value and its `run`.

---

## Core Concept 3 -- A Real go/analysis Analyzer End to End

The same rule from junior — *ban `fmt.Println` outside tests* — as a native analyzer, with a suggested fix.

```go
package noprintln

import (
    "go/ast"
    "strings"

    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/passes/inspect"
    "golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
    Name:     "noprintln",
    Doc:      "use the structured logger, not fmt.Println",
    Run:      run,
    Requires: []*analysis.Analyzer{inspect.Analyzer},
}

func run(pass *analysis.Pass) (interface{}, error) {
    insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)

    // Only visit call expressions.
    filter := []ast.Node{(*ast.CallExpr)(nil)}

    insp.Preorder(filter, func(n ast.Node) {
        call := n.(*ast.CallExpr)
        sel, ok := call.Fun.(*ast.SelectorExpr)
        if !ok {
            return
        }
        pkg, ok := sel.X.(*ast.Ident)
        if !ok || pkg.Name != "fmt" || sel.Sel.Name != "Println" {
            return
        }
        // skip _test.go files
        if pos := pass.Fset.File(call.Pos()); pos != nil &&
            strings.HasSuffix(pos.Name(), "_test.go") {
            return
        }
        pass.Report(analysis.Diagnostic{
            Pos:     call.Pos(),
            Message: "use log.Info, not fmt.Println",
            SuggestedFixes: []analysis.SuggestedFix{{
                Message: "replace with log.Info",
                TextEdits: []analysis.TextEdit{{
                    Pos:     sel.Pos(),
                    End:     sel.End(),
                    NewText: []byte("log.Info"),
                }},
            }},
        })
    })
    return nil, nil
}
```

Wire it into a standalone binary:

```go
package main

import (
    "golang.org/x/tools/go/analysis/singlechecker"
    "example.com/analyzers/noprintln"
)

func main() { singlechecker.Main(noprintln.Analyzer) }
```

```bash
go run ./cmd/noprintln ./...        # run
go run ./cmd/noprintln -fix ./...   # apply the suggested fix
```

Compared to the Semgrep version, this is more code — but it has full access to `pass.TypesInfo`, can resolve symbols across files, and ships a real autofix. That's the trade.

---

## Core Concept 4 -- Type Information vs. Pure Syntax

The reason to leave Semgrep is *types*. Syntactic matching can't tell `db.Close()` (a `*sql.DB`) from `file.Close()` (an `*os.File`) — both are `X.Close()`. With `go/types` you can:

```go
// Inside the inspector callback, resolve the receiver's type:
if tv, ok := pass.TypesInfo.Types[sel.X]; ok {
    named, ok := tv.Type.Underlying().(*types.Pointer)
    _ = named // inspect tv.Type.String() == "*database/sql.DB", etc.
}
```

This unlocks rules impossible with syntax alone:

- "Any value implementing `io.Closer` returned by `Open*` must be `Close`d" (resolved by type, not by name).
- "Don't pass a `context.Context` as anything but the first parameter" (a type-positioned rule).
- "This function returns an error that is being ignored" — `errcheck` is exactly this.

In TypeScript, the equivalent is a `@typescript-eslint` rule using `context.getTypeChecker()` / the parser services — type-aware ESLint rules are how you express "the awaited value is not actually a Promise."

> If your rule contains the words "of type," "that implements," or "that refers to," it is a type-aware rule and Semgrep will give you false positives. Go native.

---

## Core Concept 5 -- Testing Custom Rules Properly

A rule shipped without tests is a liability — it will false-positive on a teammate's PR and erode trust in the whole linter. Treat rules as production code.

**Go (`analysistest`).** Place a fixture package under `testdata/src/a/` with `// want` comments:

```go
// testdata/src/a/a.go
package a

import "fmt"

func bad() {
    fmt.Println("x") // want `use log.Info, not fmt.Println`
}

func good() {
    log.Info("x") // no want comment -> must NOT be flagged
}
```

```go
func TestNoPrintln(t *testing.T) {
    testdata := analysistest.TestData()
    analysistest.Run(t, testdata, noprintln.Analyzer, "a")
}
// For autofix correctness:
// analysistest.RunWithSuggestedFixes(t, testdata, noprintln.Analyzer, "a")
```

`analysistest` asserts that *exactly* the `// want`-annotated lines fire — extra findings fail the test, just like missing ones. `RunWithSuggestedFixes` applies your fix and diffs against a `.golden` file, so autofixes are tested too.

**ESLint (`RuleTester`).** The valid/invalid contract made explicit:

```js
const { RuleTester } = require("eslint");
new RuleTester().run("no-console-log", rule, {
  valid: ["logger.info('ok')"],
  invalid: [{
    code: "console.log('x')",
    output: "logger.info('x')",          // tests the autofix
    errors: [{ messageId: "noConsole" }],
  }],
});
```

The discipline is universal: **every rule ships a valid case (must stay silent) and an invalid case (must fire), and any rule with a fix tests the fixed output.**

---

## Core Concept 6 -- Rolling Out a New Rule: Warn -> Baseline -> Error

Turning a rule to `error` on a large existing codebase on day one breaks every red build and gets your rule disabled in anger. Roll out in stages:

```text
1. WARN        ship as a warning. CI is green; violations are visible.
               Watch for false positives for a sprint or two.

2. BASELINE    snapshot existing violations; the gate ignores them
               (grandfathered) but fails on ANY NEW one.
                 golangci-lint:   --new-from-rev=origin/main  (or revgrep)
                 semgrep:         --baseline-commit=<sha>
               Now the codebase can only get better, never worse.

3. ERROR       once the baseline is burned down (codemod the rest,
               or fix opportunistically), flip to error and delete
               the baseline. The rule is now load-bearing.
```

Pair the rollout with a **codemod** to clear the existing backlog (`ast-grep`, `gofmt -r`, or the analyzer's own `-fix`), so step 3 arrives quickly. Announce the rule, link the doc, and make sure the diagnostic message tells people *what to do instead* — a finding that only says "don't" without "do this" generates support tickets.

---

## Core Concept 7 -- When a Rule Beats Review, a Comment, a Wrapper, or a Type

The most senior skill here is *not writing the rule*. A custom rule is one of several enforcement mechanisms, and it's frequently the worst one. Compare cost vs. strength:

| Mechanism | Strength | Cost | Use when |
|---|---|---|---|
| Code-review comment | Weak, human, forgettable | ~free | One-off; not a repeating pattern. |
| Doc / convention | Weak (advisory) | low | Guidance, not enforcement. |
| **Type / API design** | **Strongest** (can't compile the bad code) | medium | The bad state is *expressible* in the type system. |
| **Wrapper API** | Strong (only the safe path exists) | medium | You can remove the dangerous primitive. |
| **Custom lint rule** | Strong (CI blocks) | high, ongoing | Bad code is *valid* code; no type/API can forbid it. |

The decisive question: **can you make the wrong thing impossible to *write* rather than merely *flagged*?**

- "Don't call `time.Now()` in domain" -> *better as a `Clock` interface injected by the framework* — then `time.Now()` simply isn't reachable. A rule is the fallback for legacy code that can't take the dependency.
- "Use our logger not `fmt.Println`" -> a lint rule is genuinely right; you can't delete `fmt`.
- "This ID must be a user ID not an order ID" -> a *newtype* (`type UserID string`) makes the mix-up a compile error. A rule is strictly worse.
- "Web layer must not import db" -> a rule (or a module-boundary tool like `depguard` / `import-linter`) is right; the language won't enforce layering.

> A lint rule earns its high maintenance cost only when the violation is *valid code that no type or API can prevent*. If a type can forbid it, prefer the type — it's cheaper to maintain and impossible to bypass.

---

## Core Concept 8 -- Performance and False Positives

**Performance.** Rules run on every file on every CI run; sloppy ones add minutes. Use the framework's traversal (`inspector.Preorder` with a node filter, narrow ESLint selectors) so you only visit relevant nodes. Never re-parse or re-read files; never do O(n²) cross-node scans inside a per-node callback. In `golangci-lint`, analyzers share the typed AST — write yours to fit that model rather than loading packages yourself.

**False positives are existential.** One bad finding on a respected engineer's PR and the team learns to add `// nolint` reflexively — at which point the rule enforces nothing. Budget false positives near zero:

- Prune aggressively with `pattern-not` / explicit early-returns.
- Honor inline suppression (`// nolint:rulename`, `// eslint-disable-next-line`, `// nosemgrep`) and *require a reason*.
- Track the suppression rate; a rule suppressed 30% of the time is mis-scoped — fix the rule, don't blame the users.

---

## Real-World Examples

- **`errcheck` (Go).** A `go/analysis` analyzer that uses type info to find error returns that are silently dropped — impossible without `go/types`.
- **`depguard` / Python `import-linter`.** Enforce "layer A must not import layer B" — architecture as an enforced rule.
- **`@typescript-eslint/no-floating-promises`.** Type-aware: needs the checker to know the expression is a `Promise`.
- **Internal "handler must authorize" analyzer.** Starts as the Semgrep rule from the middle page; graduates to native once it must confirm the *authorized principal* actually reaches the protected action — at which point it's [taint/dataflow](../08-taint-and-dataflow-analysis/), not pattern matching.

---

## Mental Models

- **Graduate, don't start native.** Semgrep first; native when a false-positive class proves syntax is insufficient.
- **`Analyzer` declares, `Pass` provides, `inspector` traverses.** Three nouns and you have `go/analysis`.
- **Types are the dividing line.** "Of type X" / "implements Y" = native. Plain shapes = Semgrep.
- **`// want` and valid/invalid are the same contract.** Every ecosystem tests rules by asserting exactly what fires.
- **Warn -> baseline -> error.** Never flip a rule to blocking on a populated codebase in one move.
- **Make it impossible, not flagged.** A type beats a rule whenever the type can express the constraint.

---

## Common Mistakes

- **Writing native when Semgrep would do.** Paying 10x maintenance for a rule that's a three-line YAML pattern.
- **Ignoring type info, then drowning in false positives.** Matching `X.Close()` by name flags `os.File` and `sql.DB` alike.
- **Flipping straight to `error`.** Breaking every build on rollout day; the rule gets disabled.
- **No "do this instead" in the message.** A finding that only forbids generates confusion and `// nolint`.
- **Untested rules.** No `analysistest`/`RuleTester` fixtures; the rule false-positives in production.
- **Writing a rule for something a type could forbid.** High ongoing cost for a constraint the compiler could enforce for free.
- **Slow rules.** Hand-rolled `ast.Walk`, re-reading files, O(n²) callbacks — minutes added to every CI run.

---

## Test Yourself

1. Name three things a `go/analysis` analyzer can do that a Semgrep rule cannot.
2. What does `pass.ResultOf[inspect.Analyzer]` give you and why use it?
3. How does `analysistest` decide a test passed?
4. Walk through warn -> baseline -> error: what does each stage buy you?
5. A teammate wants a rule banning a function that mixes up `UserID` and `OrderID` strings. What do you propose instead, and why?
6. A rule is suppressed with `// nolint` on 25% of its findings. What does that tell you and what do you do?

---

## Cheat Sheet

```text
SEMGREP vs NATIVE
  ban/require call, shapes, intra-fn taint  -> Semgrep
  needs RESOLVED TYPES / cross-file / cmplx flow / conditional fix -> native

go/analysis
  Analyzer{ Name, Doc, Run, Requires:[inspect.Analyzer] }
  run(pass) { insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
              insp.Preorder([]ast.Node{(*ast.CallExpr)(nil)}, fn) }
  emit:  pass.Report(analysis.Diagnostic{ Pos, Message, SuggestedFixes })
  types: pass.TypesInfo.Types[expr].Type
  run:   go run ./cmd/x ./...      fix: ... -fix ./...

TESTING
  Go:     analysistest.Run / RunWithSuggestedFixes + // want `msg`
  ESLint: RuleTester { valid:[...], invalid:[{code, output, errors}] }
  rule = one valid (silent) + one invalid (fires) + fix output asserted

ROLLOUT  warn  ->  baseline (--new-from-rev / --baseline-commit)  ->  error
         + codemod the backlog  + message says what to DO

CHOOSE THE MECHANISM (cheapest sufficient one)
  type/newtype  > wrapper API  > lint rule  > review comment > doc
  ask: can I make the wrong thing IMPOSSIBLE, not just flagged?

FALSE POSITIVES are existential -> prune, honor suppressions, track rate
```

---

## Summary

Native analyzers exist for what Semgrep can't reach: resolved types, cross-file symbols, real control/data flow, conditional fixes. In Go that's `go/analysis` — an `Analyzer` declaration plus a `run(pass)` that traverses with the shared `inspector` and emits `Diagnostic`s, optionally with `SuggestedFixes`; `go/types` is the reason to be there. Test rules like production code (`analysistest` with `// want`, ESLint `RuleTester` with valid/invalid/output), roll them out warn -> baseline -> error with a codemod to clear the backlog, and guard false positives obsessively because they kill trust in the whole linter. The defining senior judgment is mechanism selection: a type or a wrapper API that makes the wrong code *impossible to write* beats a high-maintenance lint rule that merely flags it — reserve custom rules for violations that are valid code no type can forbid.

---

## Further Reading

- *golang.org/x/tools/go/analysis* package docs and the `passes/` directory (read `errcheck`, `nilness`, `printf`).
- *Using go/analysis to write a custom linter* — the canonical Go blog/talk material.
- *@typescript-eslint — Custom Rules & Typed Linting* docs.
- *golangci-lint* docs on `--new-from-rev`; *Semgrep* docs on baselines (`--baseline-commit`).
- The `refactoring-techniques` skill — the behaviour-preserving transforms a SuggestedFix/codemod must respect.

---

## Related Topics

- [Linters & Style Checkers](../01-linters-and-style-checkers/) — the drivers that host native analyzers.
- [SAST Security Scanners](../04-sast-security-scanners/) — type-aware security rules built the same way.
- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — where "did the call happen" becomes "did the data flow."
- [Static Analysis in CI](../09-static-analysis-in-ci/) — baselines, gating, and where rollout actually happens.
- Professional level of this topic — running an internal rules library as a product, monorepo codemods, governance and ROI.
