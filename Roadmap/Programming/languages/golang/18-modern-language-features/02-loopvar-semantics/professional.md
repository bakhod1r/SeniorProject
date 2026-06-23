# Loop Variable Semantics (Go 1.22) — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Compiler Desugaring, Precisely](#the-compiler-desugaring-precisely)
3. [The 3-Clause Loop Transform](#the-3-clause-loop-transform)
4. [Escape Analysis Interaction](#escape-analysis-interaction)
5. [The Gating Implementation in the Toolchain](#the-gating-implementation-in-the-toolchain)
6. [Per-File Forward Compatibility](#per-file-forward-compatibility)
7. [The `loopvar` Experiment and Its Diagnostics](#the-loopvar-experiment-and-its-diagnostics)
8. [How `go vet` / `loopclosure` Became Directive-Aware](#how-go-vet-loopclosure-became-directive-aware)
9. [Interaction with Range-over-Integer and Range-over-Func](#interaction-with-range-over-integer-and-range-over-func)
10. [Generated-Code and Debug-Info Implications](#generated-code-and-debug-info-implications)
11. [Edge Cases the Implementation Reveals](#edge-cases-the-implementation-reveals)
12. [Operational Playbook](#operational-playbook)
13. [Summary](#summary)

---

## Introduction

The professional level treats the loopvar change not as a behavior but as a *compiler transform* gated by a language-version check, with a defined interaction with escape analysis, the inliner, and the debugger. The observable rule ("fresh variable per iteration") is the contract; the implementation is a syntactic rewrite the compiler performs early, whose cost is then erased by escape analysis whenever the variable does not escape.

This file is for engineers who maintain Go tooling, write analyzers, debug generated code, own large-scale migrations, or simply want the model precise enough to predict allocation and codegen. After reading you will:

- Know the desugaring the compiler applies, for both loop forms, in pseudocode.
- Understand how escape analysis erases the cost for non-capturing loops.
- Know where and how the `go` directive gates the transform inside the toolchain.
- Understand the per-file forward-compatibility mechanism.
- Know the history and diagnostics of `GOEXPERIMENT=loopvar`.
- Reason about debug-info and inliner interactions.

The change is conceptually a one-line rewrite. Its safety and zero-cost-in-the-common-case properties come from *where* it sits in the compilation pipeline and how later passes treat it.

---

## The Compiler Desugaring, Precisely

The cmd/compile front end implements the change as a syntactic transformation applied during type-checking/walk, before escape analysis and SSA construction. For a range loop:

```go
for i, v := range X {
    BODY
}
```

is rewritten, when the package's language version is ≥ 1.22, to introduce a fresh declaration per iteration. Conceptually:

```go
{
    // hidden iteration variables driven by the range machinery
    for i_iter, v_iter := range X {
        i := i_iter      // fresh, per-iteration
        v := v_iter      // fresh, per-iteration
        BODY             // all references and captures bind to i, v
    }
}
```

The crucial property: the names `i` and `v` visible to `BODY` are **declared inside the loop body**, so any closure or address-of in `BODY` binds to a per-iteration declaration. The range machinery's own iteration variables (`i_iter`, `v_iter`) are never captured by user code.

For the implementation, the compiler does not literally emit `i := i_iter`; it re-points the loop-variable declarations to be per-iteration in the AST. But "the body declares a fresh `i` and `v` each iteration" is an exact model of the resulting semantics.

The rewrite is *purely syntactic at this stage*. It does not yet decide whether the fresh variables are heap-allocated — that is escape analysis's job, run later. This separation is why the transform is simple and the cost is conditional.

---

## The 3-Clause Loop Transform

The 3-clause loop needs more care because of the `post` statement. For:

```go
for i := INIT; COND; POST {
    BODY
}
```

with a per-iteration `i`, the compiler must (a) give the body a fresh `i` each iteration and (b) ensure `POST` and `COND` operate on the running value, including any mutations the body makes to `i`. The desugaring, conceptually:

```go
{
    i_ctl := INIT            // the controlling variable
    first := true
    for {
        if !first {
            i := i_ctl       // (re)load body's fresh i from control
            POST_USING(i)    // post runs on the body's i ...
            i_ctl = i        // ... and is synced back to control
        }
        first = false
        if !(COND_USING(i_ctl)) { break }

        i := i_ctl           // fresh per-iteration i for the body
        BODY                 // body sees and may mutate this i
        i_ctl = i            // sync body mutations back to control
    }
}
```

The actual generated structure is tighter, but the invariants are exact:

1. **The body's `i` is a distinct declaration per iteration**, so captures bind per-iteration.
2. **Body mutations of `i` propagate** to `COND` and `POST` via the sync-back to `i_ctl`. This preserves the loop's control semantics: `for i := 0; i < n; i++ { i++ }` still skips as it did before.
3. **`POST` (e.g. `i++`) runs on the synced value**, so the loop advances correctly.

This sync-back is the heart of why the 3-clause change is correct *and* compatible: control flow is preserved exactly, while the captured identity becomes per-iteration. The Go authors documented this transform in the design doc; reading it alongside the compiler's `loopvar` handling makes the model concrete.

---

## Escape Analysis Interaction

The per-iteration declaration is where the *semantics* live; escape analysis is where the *cost* is decided. They are deliberately separate passes.

### The decision

After the desugaring, the loop body contains a fresh `v` (and `i`) per iteration. Escape analysis asks, per variable: does this escape the iteration?

- **Does not escape** (read, used, discarded within the iteration): the variable is placed in a stack slot or register that is **reused across iterations**. No per-iteration allocation. The generated code is identical to pre-1.22. This is the common case and it is free.
- **Escapes** (captured by a closure that outlives the iteration, address taken and stored, passed to a goroutine): each iteration's variable must have independent, surviving storage. The compiler heap-allocates one per iteration (or stack-allocates if the lifetime is provably bounded, but typically heap for escaping closures).

### Why the cost equals the old `v := v`

Pre-1.22, the manual `v := v` created a body-scoped variable that escape analysis treated identically: free if not captured, heap-allocated per iteration if captured. The 1.22 transform produces the *same* body-scoped declaration implicitly. Therefore the escape decision — and the allocation profile — is unchanged from the manual idiom. The language change automated the declaration; it did not change how escape analysis costs it.

### Verifying

```bash
go build -gcflags=-m ./...
```

reports lines like `moved to heap: v` for escaping loop variables and stays silent for non-escaping ones. In a migrated codebase, a newly-reported `moved to heap: v` on a loop variable indicates the loop captures it — a correctness-relevant signal, not a regression.

### Inliner interaction

If a loop calls a function that the inliner expands, and the inlined body captures the loop variable (e.g. a small helper taking a closure), escape analysis runs on the post-inlining form. Inlining can occasionally turn a non-escaping capture into a non-allocation by proving the closure does not outlive the iteration. The per-iteration semantics are preserved regardless; only the allocation may differ. Do not rely on inlining to elide the allocation in hot paths — restructure to not capture.

---

## The Gating Implementation in the Toolchain

The transform is applied **only when the package's effective language version is ≥ 1.22**. The toolchain computes that version from:

1. The `go` directive in the module's `go.mod` (the primary source).
2. Any per-file `//go:build go1.xx` upper/lower-bound constraints (forward-compatibility, see next section).

Inside the compiler, each package compilation carries a language version (`lang` setting, passed via `-lang=go1.22` by the `go` build tool). The loopvar rewrite checks this version: at or above 1.22, it rewrites; below, it leaves the old shared-variable form.

This is why:

- **The installed toolchain version is irrelevant.** A Go 1.23 toolchain compiling a package whose module declares `go 1.21` passes `-lang=go1.21`, and the loopvar rewrite is skipped for that package.
- **Gating is per package (per module).** The `go` build tool sets `-lang` per package based on the owning module's directive. Different modules in one build get different `-lang` values, hence different loop semantics.
- **You can observe it.** `go build -x` shows the `-lang=go1.NN` flag passed to `compile` for each package; that flag is the gate.

The senior-from-middle deepening: the gate is not a runtime check or a global flag. It is a per-compilation `-lang` setting derived from `go.mod`, consumed by a front-end rewrite. That is the entire mechanism.

---

## Per-File Forward Compatibility

Go 1.21 introduced stricter language-version handling, including per-file build constraints that set a *minimum* language version:

```go
//go:build go1.22

package foo
```

A file with this constraint requires the language version to be at least 1.22; the toolchain refuses to compile it with an older `-lang`. This composes with the loopvar gate: a file that *needs* per-iteration semantics can assert the requirement, and a build with a too-old directive fails loudly rather than silently using old semantics.

Conversely, the forward-compatibility work ensures that a newer toolchain compiling an old module does not *accidentally* apply newer semantics: the `-lang` derived from the old directive holds the line at the old behavior. The two halves — "don't silently upgrade old code" and "let new code require new semantics" — are the forward-compat guarantees that make the gate trustworthy.

For tooling authors: to determine a file's effective language version, you must consider both the module directive *and* any per-file `//go:build go1.xx` constraint. `golang.org/x/tools` provides helpers (the `versions` package) for exactly this computation; do not hand-roll it.

---

## The `loopvar` Experiment and Its Diagnostics

The change shipped as the default in 1.22, but it was previewable earlier.

### History

- **GOEXPERIMENT=loopvar** was available in **Go 1.21**. Building with `GOEXPERIMENT=loopvar go build ./...` forced the new per-iteration semantics *regardless of the `go` directive*, letting teams validate their code against the change before 1.22 made it the gated default.
- This preview was how the community surfaced edge cases and confirmed the low blast radius before the change became permanent.

### Diagnostics

The experiment shipped with a diagnostic mode to *find* loops whose behavior would change:

```bash
go build -gcflags=all=-d=loopvar=2 ./...
```

The `-d=loopvar=2` debug flag makes the compiler print, for each loop, whether its transformation is observable (i.e. whether the loop variable is captured such that the change matters). Output identifies the file:line of every loop that would behave differently under the new semantics. This was invaluable for migration: it pinpoints exactly the loops to review, rather than auditing every loop in the codebase.

`-d=loopvar=1` enables the change with less verbose reporting; `=2` adds the per-loop diagnostics. In 1.22+, the behavior is on by default for gated packages, but the diagnostic flag remains a way to enumerate affected loops during a migration audit.

For tooling: parse the `-d=loopvar=2` output to build a migration checklist — every reported line is a loop whose captured-variable behavior changes, and thus a candidate for test coverage.

---

## How `go vet` / `loopclosure` Became Directive-Aware

`golang.org/x/tools/go/analysis/passes/loopclosure` historically flagged the pattern: a loop variable referenced by a function literal used in a `go` statement or `defer`, where the reference would observe the post-loop value. The diagnostic was correct under shared-variable semantics.

After 1.22 the analyzer was updated to consult the **effective language version** of the analyzed package:

- If the package's version is ≥ 1.22, the previously-flagged pattern is **not reported** — it is correct under per-iteration semantics.
- If the version is < 1.22, the analyzer still reports it.

The analyzer obtains the version via the analysis framework's access to the package's `go` directive (using the `versions` helper). This makes vet output a function of the directive, exactly like the compiler. The implications:

- A `loopclosure` diagnostic in a modern codebase is a strong signal that the package's directive is below 1.22.
- Analyzer authors writing new loop-related checks must do the same version-aware gating, or they will produce false positives on 1.22+ code. The `versions` package is the supported way to get the effective version per file/package.

Third-party loop-capture linters that did *not* update (or were never directive-aware) now produce false positives on 1.22 code; audit and remove them post-migration.

---

## Interaction with Range-over-Integer and Range-over-Func

Both new loop forms are implemented as range loops and therefore inherit the per-iteration desugaring.

### Range over integer (1.22)

```go
for i := range n { BODY }
```

desugars with a per-iteration `i` exactly like any range loop. The compiler generates a counted loop, and `i`'s declaration is body-scoped, so captures bind per-iteration. No special handling beyond the standard transform.

### Range over function / iterator (1.23)

```go
for v := range seq { BODY }   // seq is func(yield func(V) bool)
```

The compiler rewrites this into calls to `seq` with a generated `yield` closure that runs `BODY` for each yielded value. The loop variable `v` is declared per *yield* (per iteration), so captures inside `BODY` bind to that iteration's `v`. The per-iteration guarantee composes with the yield-callback structure: each invocation of the generated `yield` body has its own `v`.

A professional subtlety: range-over-func desugars `BODY` into a closure (the `yield` body) that the iterator calls. The loopvar transform ensures that closure's `v` is per-call. Combined with the machinery that handles `break`/`continue`/`return` across the iterator boundary (via control-flow flags the compiler inserts), the result is that capturing `v` in a nested closure inside `BODY` behaves intuitively. The two features were designed to compose; the loopvar rule is what makes captured yielded values correct.

---

## Generated-Code and Debug-Info Implications

### Debug info

Because the loop variable is now per-iteration, the debugger sees a variable whose storage may change per iteration (when it escapes) or be reused (when it does not). DWARF debug info reflects the body-scoped declaration. In practice:

- Setting a breakpoint inside the loop and inspecting `v` shows the current iteration's value, as expected.
- For escaping variables, the debugger correctly shows distinct values for distinct captured instances.

Tooling that parses DWARF to map variables should treat the loop variable as body-scoped under 1.22+, not loop-scoped.

### Codegen size

For non-capturing loops, codegen is unchanged (same reused slot/register). For capturing loops, the per-iteration allocation adds a small amount of code (the allocation call) and runtime cost per iteration — identical to what `v := v` produced. Binary size impact is negligible in aggregate.

### Profiling

A migrated service may show *new* small allocations in loops that capture. In a heap profile (`pprof`), these attribute to the loop's source line. If they matter, the remedy is to not capture in the hot path — the same remedy as before the change. A profile that shows these allocations is surfacing real, previously-hidden (or previously-`v := v`) cost.

---

## Edge Cases the Implementation Reveals

A close reading of the design doc and the compiler's loopvar handling exposes corners:

- **Multiple variables, partial capture.** In `for i, v := range xs` where only `v` is captured, both are made per-iteration by the transform, but escape analysis only allocates `v`; `i` stays in a reused slot. The transform is uniform; the cost is per-variable.
- **Body shadows the loop variable.** `for v := range xs { v := compute(); ... }` — the inner `v := compute()` shadows the loop's `v`. The loop's per-iteration `v` and the inner `v` are distinct; captures bind to whichever is in scope at the capture site. The transform does not interfere with normal shadowing.
- **`for i := 0; ; i++` (no condition).** The 3-clause transform still applies; the per-iteration `i` is synced to `i_ctl` and incremented. Infinite loops with a counter capture correctly.
- **Loop variable mutated in body and captured.** The captured closure sees the value of `i` *at the point of capture* within that iteration, then any later body mutation, per normal closure-by-reference rules — but scoped to that iteration's `i`. The sync-back to control happens after the body.
- **`continue` before capture.** If `continue` skips the capture, no closure is created for that iteration; the per-iteration variable simply has no surviving reference and is not allocated.
- **Labeled loops.** The label names the loop for `break`/`continue`; it has no effect on variable identity. The transform is unchanged.
- **Range over a map.** Iteration order is unspecified (as always), but each key/value pair gets its own per-iteration variables; capturing them is safe and each closure sees its own pair.

These are not facts to memorize but pointers to reach for the design doc and `-gcflags=-m` / `-d=loopvar=2` when a loop surprises you.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Enable per-iteration semantics for a module | Set `go 1.22` (or higher) in `go.mod`. |
| Preview the change on Go 1.21 | `GOEXPERIMENT=loopvar go build ./...` and run tests. |
| Enumerate loops whose behavior changes | `go build -gcflags=all=-d=loopvar=2 ./... 2>&1 \| grep loopvar`. |
| Confirm a loop variable escapes (allocates) | `go build -gcflags=-m ./...` and look for `moved to heap`. |
| See the gate the compiler receives | `go build -x ./...` and inspect the `-lang=go1.NN` flag. |
| Make a file require ≥ 1.22 semantics | Add `//go:build go1.22` to the file. |
| Stop `go vet` flagging now-correct loops | Bump the package's `go` directive to ≥ 1.22. |
| Find redundant `v := v` after migration | Grep for `(\w+) := \1` shadows in loop bodies; review and remove. |
| Verify no behavior change on non-capturing loops | Compare `-gcflags=-S` (assembly) before/after the bump for hot loops. |
| Audit dependency loop semantics | Check each dependency's `go` directive; below 1.22 means old semantics. |
| Retire obsolete loop-capture linters | Remove `exportloopref`/`scopelint`-style checks from `golangci-lint`. |

---

## Summary

The Go 1.22 loopvar change is, at the implementation level, a front-end syntactic rewrite that makes a `for` statement's `:=`-declared variables body-scoped — declared fresh inside each iteration — so that captures and address-of bind per iteration. For the 3-clause form, the rewrite adds a sync-back of the body's per-iteration variable to a controlling variable, preserving `COND`/`POST` semantics exactly. The transform is gated by the per-package `-lang=go1.NN` flag the `go` tool derives from the module's `go` directive (composed with per-file `//go:build go1.xx` constraints); the installed toolchain version is irrelevant. Escape analysis, a separate later pass, erases the cost: non-capturing loop variables stay in reused stack/register storage (identical codegen to pre-1.22, zero cost), while escaping ones allocate per iteration — exactly the cost the manual `v := v` idiom incurred. The change was previewable via `GOEXPERIMENT=loopvar` on Go 1.21, with `-d=loopvar=2` diagnostics to enumerate affected loops, and `go vet`'s `loopclosure` analyzer was made directive-aware using the `versions` helper so it no longer flags now-correct code. Range-over-integer (1.22) and range-over-func (1.23) inherit the per-iteration desugaring and compose cleanly with it. The professional model is precise: a version-gated front-end rewrite whose cost is conditionally erased by escape analysis — simple in mechanism, surgical in effect.
