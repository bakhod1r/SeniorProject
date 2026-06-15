# Loop Variable Semantics (Go 1.22) — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [What Exactly Changed (Both Loop Forms)](#what-exactly-changed-both-loop-forms)
3. [The `go` Directive: How Gating Works](#the-go-directive-how-gating-works)
4. [Mixed-Module Behavior](#mixed-module-behavior)
5. [The 3-Clause Loop and the `post` Statement](#the-3-clause-loop-and-the-post-statement)
6. [The `v := v` Idiom: Now Redundant](#the-v-v-idiom-now-redundant)
7. [Performance and the Escape-Analysis Interaction](#performance-and-the-escape-analysis-interaction)
8. [Edge Cases: Address-of, Defer, Labels](#edge-cases-address-of-defer-labels)
9. [Interaction with Range-over-Integer and Range-over-Func](#interaction-with-range-over-integer-and-range-over-func)
10. [How `go vet` and `loopclosure` Changed](#how-go-vet-and-loopclosure-changed)
11. [Migration Discipline](#migration-discipline)
12. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

You already know the headline: before Go 1.22 a `for` loop reused one variable across iterations, so captured closures and goroutines saw the final value; from 1.22 each iteration gets a fresh variable. The middle-level question is *how the toolchain decides whether to apply the change*, *what the change costs at runtime*, and *how it interacts with the rest of the language* — address-of, `defer`, labels, the new range-over-integer and range-over-func forms, and the vet tooling that used to police the old bug.

This file moves from "what changed" to "how it is gated, what it costs, and where the corners are." It is the level where you stop being surprised by a loop's behavior and start being able to predict it from the `go.mod` directive alone.

After reading this you will:
- Know precisely which variables become per-iteration, in both loop forms
- Understand the `go`-directive gating and mixed-module behavior from first principles
- Reason about the escape-analysis cost model — when the change allocates and when it is free
- Know how `&v`, `defer`, and labels interact with the new semantics
- Understand the range-over-integer and range-over-func interactions
- Know how `go vet`'s `loopclosure` analyzer changed

---

## What Exactly Changed (Both Loop Forms)

The Go 1.22 change applies to the variables **declared by** a `for` statement using `:=`. Two forms qualify.

### Range form

```go
for i, v := range xs { ... }
```

Both `i` and `v` are now per-iteration. Before 1.22, both were declared once and reused. After 1.22, the compiler conceptually inserts a fresh declaration at the top of each iteration.

### 3-clause form

```go
for i := 0; i < n; i++ { ... }
```

`i` is now per-iteration. This is the subtler half of the change, because the 3-clause loop has a `post` statement (`i++`) that must continue to see the *running* value. The compiler handles this by copying the per-iteration variable back out at the end of each iteration (see [The 3-Clause Loop](#the-3-clause-loop-and-the-post-statement)).

### What does NOT change

- `for { ... }` — no loop variable, nothing to make per-iteration.
- `for cond { ... }` — no declared variable.
- Variables declared with `=` to pre-existing names (not `:=` in the loop header) — these are not loop-declared variables.
- The order, count, or values of iterations. The loop runs exactly as before; only the *identity* of the variable per iteration changed.

The mental compression: **the per-iteration rule applies to exactly the variables you introduced in the `for` header with `:=`.**

---

## The `go` Directive: How Gating Works

This is the part that determines real behavior, and it surprises people who expect "new compiler = new behavior."

The change is gated on the **`go` directive** in the `go.mod` of the module being compiled:

```
module example.com/app

go 1.22
```

Rule: **if the `go` directive of the module that contains a package is `1.22` or higher, that package's loops use per-iteration semantics.** If it is `1.21` or lower, that package's loops use the old shared-variable semantics — even when built by a Go 1.22+ toolchain.

Why gate it this way? The Go 1 compatibility promise says a program that compiled and ran under an old Go must keep behaving the same. The `go` directive is the language's "as-of version" marker. By tying the change to it:

- Old modules (directive < 1.22) keep their exact old behavior regardless of toolchain.
- A module opts into the new behavior by *bumping its own directive* — a deliberate, reviewable act.

There is also a **per-file** forward-compatibility mechanism (Go 1.21+): a `//go:build go1.22` constraint can require a minimum language version per file, but the loopvar gate is primarily a module-level decision via the directive. The practical takeaway: **read `go.mod` before reasoning about any loop.**

---

## Mixed-Module Behavior

In any non-trivial build you compile several modules at once: your main module plus its dependencies. Each carries its own `go` directive. The gate is applied **per module**, so different modules in the same binary can use different loop semantics.

Consider:

```
yourapp     go 1.22   → its loops are per-iteration
libfoo      go 1.21   → its loops are shared-variable (old)
libbar      go 1.22   → its loops are per-iteration
```

When you build `yourapp`, the compiler:
- Compiles `yourapp`'s packages with per-iteration loops.
- Compiles `libfoo`'s packages with the old shared-variable behavior.
- Compiles `libbar`'s packages with per-iteration loops.

This is intentional and correct. It means:
- Bumping *your* directive does **not** retroactively fix latent bugs inside a dependency still on 1.21.
- A dependency upgrading *its* directive to 1.22 may change *its* observable behavior — which is why a dependency's `go` directive bump is a semantically meaningful change, not a cosmetic one.

The per-module gate is the mechanism that lets the ecosystem migrate independently, without a flag day.

---

## The 3-Clause Loop and the `post` Statement

The 3-clause loop is where the change is mechanically trickiest, and understanding it deepens your model.

Take `for i := 0; i < n; i++`. The naive "fresh `i := i` each iteration" rule would break the `i++` post statement — which `i` does it increment? The compiler resolves this with a per-iteration copy that is synced back. Conceptually:

```go
// Pre-1.22 (shared):
{
    i := 0
    for ; i < n; i++ {
        BODY(i)
    }
}

// 1.22+ (per-iteration), conceptually:
{
    i_outer := 0
    for ; i_outer < n; {
        i := i_outer        // fresh per-iteration variable
        BODY(i)             // body and any captures see THIS i
        i_outer = i         // sync back so post sees mutations in body
        i_outer++           // the post statement
    }
}
```

Two consequences worth internalizing:

1. **Body mutations of `i` still affect the loop.** If the body does `i++` or `i = 0`, that value is synced back to the controlling variable, so the loop's progression honors it — just as before. The change preserves the loop's control semantics.
2. **Each iteration's captured `i` is independent.** A goroutine capturing `i` in iteration 2 sees its own copy frozen at the value `i` had when the iteration's body ran, not the controlling variable's later state.

This sync-back is why the change is described as "fresh instance per iteration" rather than "scope `i` to the body" — the loop still needs a single thread of control, but each iteration's *captured* identity is distinct.

---

## The `v := v` Idiom: Now Redundant

For years, the idiomatic fix for the capture bug was to shadow the loop variable:

```go
for _, v := range items {
    v := v // fresh copy, scoped to the body
    go func() { use(v) }()
}
```

The `v := v` line created a new variable each iteration, so each closure captured its own. Under Go 1.22+, the compiler does this automatically, making the line **redundant**:

- It still compiles and behaves correctly — `v := v` is harmless.
- It is no longer *necessary* in a `go 1.22+` module.
- In code that must also build under a `go 1.21` directive, keep it (or use argument-passing).

A subtle point: `v := v` and the 1.22 behavior produce the *same allocation profile*. If the closure escapes, both cause one per-iteration variable that escapes to the heap. So removing `v := v` after a 1.22 bump does not change performance — the compiler simply generates the copy implicitly.

For migration, a common move is to run a cleanup pass (e.g. with a custom analyzer or `gofmt -r`) that strips redundant `x := x` shadows in 1.22+ modules. This is cosmetic; do it deliberately and review the diff.

---

## Performance and the Escape-Analysis Interaction

A reasonable fear: "a fresh variable per iteration sounds like a fresh allocation per iteration." It is not, in the common case. The compiler's **escape analysis** decides.

### When the variable does NOT escape

```go
sum := 0
for _, v := range xs {
    sum += v // v is read, used, discarded within the iteration
}
```

`v` does not escape: nothing captures it, nothing takes its address, no goroutine references it. The compiler keeps `v` in a **register or a single stack slot** and reuses that storage across iterations. The generated code is **identical** to the pre-1.22 code. **Zero cost.**

### When the variable DOES escape

```go
var fns []func()
for _, v := range xs {
    fns = append(fns, func() { use(v) }) // v captured by an escaping closure
}
```

Here `v` escapes (the closure outlives the iteration and is stored). The compiler must give each iteration's `v` its own storage that survives — typically a small **heap allocation per iteration**. This is exactly the cost the `v := v` idiom incurred before. The change did not *add* a cost; it moved an already-necessary cost from manual to automatic.

### The key insight

Per-iteration semantics are a **language guarantee**, but the **implementation** only pays for it when correctness requires it. Escape analysis is the bridge: it determines whether a fresh variable can live in reused stack/register storage (free) or must be separately allocated (cheap, and only when captured). Hot loops that don't capture pay nothing.

### Practical guidance

- Don't restructure non-capturing loops out of fear; they're unchanged.
- If a capturing loop is in a hot path and allocations matter, the answer is the same as it always was: avoid capturing in the hot path (pass by argument, hoist the work, or restructure).
- Use `go build -gcflags=-m` to see escape decisions if you need to confirm whether a loop variable escapes.

---

## Edge Cases: Address-of, Defer, Labels

### Address-of (`&v`)

Taking the address of the loop variable is a *capture* — it forces the variable to be addressable and, if the pointer escapes, allocated per iteration.

```go
var ptrs []*int
for _, v := range []int{1, 2, 3} {
    ptrs = append(ptrs, &v)
}
// pre-1.22: all &v identical → *ptrs all 3
// 1.22+:    each &v distinct → *ptrs are 1, 2, 3
```

Note the distinction from `&slice[i]`: `&v` is the address of the per-iteration *copy*; `&slice[i]` is the address of the actual element. If you want to mutate the slice, index it.

### Defer in a loop

1.22 fixes *which variable* a deferred closure captures, but **not** *when* the deferred call runs. Deferred calls still execute at **function** return:

```go
for _, f := range files {
    defer f.Close() // 1.22: each f is correct; but ALL run at function end
}
```

The per-iteration fix means `f.Close()` closes the right file each time. The "all defers pile up until return" behavior is unchanged and unrelated — it remains a reason to avoid `defer` in long loops.

### Labels, `break`, `continue`, `goto`

- `continue` and `break` work exactly as before; the per-iteration variable is simply not created for skipped iterations.
- Labeled `break`/`continue` (`break outer`) are unaffected — they control which loop, not variable identity.
- `goto` jumping around a loop is legal but rarely interacts cleanly with per-iteration variables; the variable is fresh for each iteration the loop actually performs, and `goto` does not manufacture extra iterations. Avoid `goto` near loop bodies for clarity regardless.

---

## Interaction with Range-over-Integer and Range-over-Func

Go 1.22 shipped two related loop additions; both inherit per-iteration semantics.

### Range over an integer (Go 1.22)

```go
for i := range 10 { // i goes 0..9
    go func() { fmt.Println(i) }() // 1.22: prints 0..9, each goroutine its own i
}
```

`i` here is a loop-declared variable, so it is per-iteration. Capturing it is safe. This form is a convenient counted loop, and it composes correctly with goroutines and closures out of the box.

### Range over a function / iterator (Go 1.23)

Range-over-func lets you iterate by calling an iterator function:

```go
for v := range seq { // seq is an iterator func(yield func(T) bool)
    go func() { use(v) }() // v is per-iteration; capture is safe
}
```

The loop variable `v` produced by a range-over-func is per-iteration just like any other range variable. Importantly, the per-iteration guarantee combines naturally with iterators: each value yielded gets its own variable, so capturing yielded values in closures behaves intuitively. (Range-over-func has its own subtleties around the `yield` callback and early termination; those are a separate topic, but the loopvar semantics carry over cleanly.)

The unifying rule: **any variable a `for ... range` declares is per-iteration under a `go 1.22+` module**, regardless of what is being ranged — slice, map, channel, integer, or function.

---

## How `go vet` and `loopclosure` Changed

Before 1.22, the standard library's `go vet` ran a `loopclosure` analyzer that flagged the dangerous pattern: a loop variable captured by a closure that escapes the iteration (commonly via `go` or `defer`). It was a heuristic — it caught the obvious cases and produced the familiar "loop variable captured by func literal" warning.

After 1.22, that warning is **wrong for code in a `go 1.22+` module**, because the captured variable is now per-iteration and the pattern is correct. So the analyzer was updated:

- `loopclosure` now **takes the module's `go` directive into account**. In a `go 1.22+` package, the previously-flagged pattern is no longer reported, because it is no longer a bug.
- In a `go 1.21` or lower package, the analyzer still warns, because the bug is still real there.

This means `go vet`'s output is now version-aware: the same source flagged under an old directive is silent under a new one. If you see a `loopclosure` warning unexpectedly, check the package's effective `go` directive — it is almost certainly below 1.22.

There were also third-party linters (e.g. `exportloopref`, `scopelint`) built specifically to catch this bug. In a fully-1.22 codebase they are largely obsolete; many have been deprecated or repurposed. Don't waste CI time running loop-capture linters on code that is already 1.22-gated.

---

## Migration Discipline

Bumping a module's `go` directive to 1.22 is a behavior change, so treat it like one.

```
go.mod:  go 1.21  →  go 1.22
```

A disciplined migration:

1. **Run the full test suite, especially concurrency and table-driven tests.** The bump may *fix* tests that were accidentally passing (or silently testing one case). It may also, rarely, expose code that depended on the shared variable.
2. **Search for intentional shared-variable reliance.** Patterns that accumulate into a single captured variable on purpose are rare but exist. Grep for loops that capture a variable expecting it to hold the final value.
3. **Use the preview to de-risk.** Before fully committing, you could compile the codebase with the loopvar change forced on (`GOEXPERIMENT=loopvar` on Go 1.21) and run tests to see what changes. (See specification.md for the history of this experiment.)
4. **Clean up redundant `v := v` and argument-passing-only-for-the-bug** in a follow-up cosmetic PR, not the same one as the directive bump — keep the behavior change reviewable in isolation.
5. **Update or remove loop-capture linters** from CI once fully migrated.

The migration is usually a quiet quality win: a class of latent bugs disappears. The discipline is about catching the rare regression, not bracing for a hard one.

---

## Common Errors and Their Real Causes

A field guide to confusion at this level.

### "I upgraded Go but the bug is still there"

Cause: the module's `go` directive is still below 1.22. The toolchain version does not gate the change. Fix: bump the directive.

### "`go vet` warns about loop capture but the code is fine"

Cause: the package's effective `go` directive is below 1.22, so the analyzer correctly still flags it (the bug is real *for that directive*). Fix: bump the directive, or accept that under the old directive the warning is valid.

### "A previously-cheap loop now allocates"

Cause: the loop captures the variable in an escaping closure, so per-iteration semantics allocate. This is correctness — the loop was buggy or already paying this via `v := v`. Fix: if it's a hot path, avoid capturing (pass by argument).

### "Behavior differs between two files that look identical"

Cause: they're in modules with different `go` directives. Fix: align directives, or be explicit (argument-passing) so behavior is version-independent.

### "`&v` gives the same pointer in my old code"

Cause: pre-1.22 shared variable. Fix: bump directive, or use `&slice[i]` if you actually want the element's address.

### "My dependency still has the bug after I migrated"

Cause: the dependency's own `go` directive is below 1.22; the per-module gate leaves its loops on old semantics. Fix: this is by design — update the dependency or file an upstream issue; you cannot fix it from your module.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] State which variables become per-iteration in both the range and 3-clause forms
- [ ] Explain the `go`-directive gate and why the toolchain version does not decide
- [ ] Predict behavior in a mixed-module build where dependencies have different directives
- [ ] Explain the 3-clause loop's sync-back of the per-iteration variable to the post statement
- [ ] Explain why `v := v` is redundant in 1.22+ and identical in allocation profile
- [ ] Describe the escape-analysis cost model: free when not captured, cheap-per-iteration when captured
- [ ] Distinguish `&v` (per-iteration copy) from `&slice[i]` (the element)
- [ ] State that `defer`'s run-at-function-return behavior is unchanged
- [ ] Explain that range-over-integer and range-over-func variables are per-iteration
- [ ] Explain how `go vet`'s `loopclosure` analyzer became directive-aware

---

## Summary

Go 1.22 makes the variables declared by a `for` statement — in both the `range` form and the 3-clause form — **per-iteration**: each iteration gets a fresh instance. The change is gated on the module's **`go` directive**, applied per module, so a 1.22 main module and a 1.21 dependency use different loop semantics in the same binary; this per-module gate is what makes the change safe under the Go 1 compatibility promise. The 3-clause loop preserves control flow by syncing its per-iteration copy back to the post statement. The old `v := v` idiom is now redundant and has the same allocation profile as the implicit behavior. Crucially, the change costs **nothing** for loops that don't capture: escape analysis keeps non-escaping loop variables in reused storage and only allocates per iteration when the variable is captured or addressed — exactly the cost `v := v` paid before. The new range-over-integer and range-over-func variables inherit per-iteration semantics, and `go vet`'s `loopclosure` analyzer became directive-aware so it no longer warns about now-correct code. The middle-level skill is reading the `go.mod` directive and predicting any loop's behavior — and its cost — from it.
