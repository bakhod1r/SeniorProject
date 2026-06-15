# Loop Variable Semantics (Go 1.22) — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Why did my loop print the same value three times?" and "What changed in Go 1.22 to fix it?"

For more than a decade, one of the most common bugs in Go programs came from a single, subtle rule about `for` loops. When you wrote `for i, v := range xs`, the variables `i` and `v` were **created once** and **reused** on every turn of the loop. Each iteration overwrote them rather than making new ones. Most of the time you never noticed — you read the value, did some work, and moved on. But the moment you *captured* `v` inside a closure or a goroutine and used it later, the bug appeared: by the time your captured code ran, the loop had finished, and `v` held its **last** value. Every closure saw the same final value.

This caught beginners and experts alike. It was the single most reported gotcha in the language. So in **Go 1.22** (released February 2024), the Go team changed the rule: now **each iteration gets its own fresh copy** of the loop variable. The buggy pattern silently became correct.

```go
// Pre-1.22: prints 3, 3, 3  (the bug)
// 1.22+:    prints 0, 1, 2  (fixed)
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }()
}
```

After reading this file you will:
- Understand the classic "loop variable capture" bug and recognize it on sight
- Know exactly what Go 1.22 changed and why
- Predict the output of a loop both before and after the change
- Know how the change is turned on (the `go` directive in `go.mod`)
- Stop writing the old `v := v` "shadow" workaround when you don't need it
- Read and explain before/after examples with exact output

You do **not** need to understand the compiler's escape analysis or the formal language spec yet. This file is about the moment you say "wait, why are all my goroutines printing the same number?"

---

## Prerequisites

- **Required:** A working Go installation, version 1.22 or newer to see the new behavior. Check with `go version`.
- **Required:** Basic familiarity with `for` loops, both the 3-clause form (`for i := 0; i < n; i++`) and the `range` form (`for i, v := range xs`).
- **Required:** A first encounter with **closures** (functions that capture variables from around them) and **goroutines** (`go func(){...}()`). If these are brand new, skim an intro first.
- **Required:** A `go.mod` file with a `go` directive. The new behavior is gated on this line — `go 1.22` or higher turns it on. See [6.1.1 `go mod init`](../../06-code-organization/01-modules-and-dependencies/01-go-mod-init/junior.md).
- **Helpful:** Having actually *hit* this bug yourself. Nothing teaches it faster.

If `go version` prints `go1.22` or higher and your `go.mod` says `go 1.22`, you are running with the new semantics.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Loop variable** | The variable(s) declared in a `for` statement — `i` and `v` in `for i, v := range xs`. |
| **Per-iteration variable** | The Go 1.22 behavior: a fresh instance of the loop variable on every iteration. |
| **Shared loop variable** | The pre-1.22 behavior: one variable reused across all iterations. |
| **Closure** | A function value that captures (refers to) variables from the surrounding scope. |
| **Capture** | When a closure or goroutine keeps a reference to an outer variable for later use. |
| **Goroutine** | A lightweight concurrent function started with the `go` keyword. |
| **`go` directive** | The `go 1.xx` line in `go.mod` that declares the language version; it gates the loopvar change per package. |
| **`v := v` idiom** | The old workaround: re-declaring the loop variable inside the loop body to force a fresh copy. Now usually redundant. |
| **`loopclosure`** | The `go vet` analyzer that warned about capturing loop variables. Its role shrank after 1.22. |
| **3-clause loop** | The classic `for init; cond; post { }` form. |
| **range-over-func** | A Go 1.23 feature, `for x := range someFunc`, where the loop iterates by calling a function. |

---

## Core Concepts

### The old rule: one variable, reused

Before Go 1.22, a `for` loop declared its variables **once**, before the first iteration. Each pass through the loop **assigned** new values into those same variables. Think of it as:

```go
// What "for i := 0; i < 3; i++" meant pre-1.22, conceptually:
{
    i := 0          // declared ONCE
    for ; i < 3; i++ {
        // body uses the SAME i every time
    }
}
```

If your body only *read* `i` and used it immediately, this was fine. The trouble began when something **outlived the iteration** and held a reference to `i`.

### Why capture breaks it

A closure does not copy the variables it uses — it keeps a **reference** to them. So when you write:

```go
funcs := []func(){}
for i := 0; i < 3; i++ {
    funcs = append(funcs, func() { fmt.Println(i) })
}
for _, f := range funcs {
    f()
}
```

Pre-1.22, all three closures reference the *same* `i`. By the time you call them, the loop has run to completion and `i` equals 3. Output: `3 3 3`. The closures never captured "the value 0, 1, 2" — they captured "the variable `i`," and that one variable ended at 3.

Goroutines are worse because of timing. With `go func() { fmt.Println(i) }()`, the goroutine may not even start until the loop finishes, so it almost always sees the final value.

### The Go 1.22 fix: fresh variable per iteration

Go 1.22 changed the rule so that each iteration creates a **new** instance of the loop variable. Conceptually:

```go
// What "for i := 0; i < 3; i++" means in 1.22+, conceptually:
for i := 0; i < 3; i++ {
    i := i   // a fresh i, scoped to THIS iteration
    // body uses this iteration's own i
}
```

Now each closure captures a *different* `i`. Output becomes `0 1 2`. The bug is gone — without you changing a single line of your loop.

This applies to **both** loop forms:
- `for i, v := range xs` — both `i` and `v` are fresh each iteration.
- `for i := 0; i < n; i++` — the 3-clause form's variables are fresh each iteration too.

### What turns the new behavior on

The change is **not** automatic for every file the compiler sees. It is gated on the **`go` directive** in your module's `go.mod`:

```
module example.com/myapp

go 1.22
```

If the `go` line is `1.22` or higher, every package in that module uses the new per-iteration semantics. If it is `1.21` or lower, the package keeps the old shared-variable behavior — even when compiled by a Go 1.22+ toolchain. This is how Go avoids breaking old code: your build version, not the compiler version, decides.

### Why this was safe to change

Changing language behavior sounds dangerous — the Go 1 compatibility promise says old programs keep working. The team studied the question carefully:

- The change only affects programs that **capture** the loop variable in a closure or goroutine, or **take its address** (`&v`). Loops that just read the value are completely unaffected.
- Of programs that *do* capture, the overwhelming majority were **already buggy** — they wanted the new behavior and were getting the old, wrong one. The change fixed them.
- A tiny number of programs deliberately relied on the shared variable. These are rare and are caught by gating on the `go` directive, so they don't change behavior until the author opts in by bumping the version.

The data came from running the change across Google's and the open-source community's large code corpus. Programs that broke were nearly always already broken.

---

## Real-World Analogies

**1. Numbered lockers vs. one shared whiteboard.** Old behavior: there is *one* whiteboard, and each iteration erases it and writes a new number. Anyone who walks by later only sees the last number. New behavior: each iteration gets its *own numbered locker* with its own number inside. Walk by later and each locker still holds its own value.

**2. A photo vs. a live camera feed.** Capturing the old loop variable was like saving a *link to a live camera feed* — when you look at it later, it shows "now," which is the end of the loop. The new behavior is like saving a *photo* at each moment: each saved photo keeps the value it had then.

**3. Sticky notes vs. a single notepad.** Imagine writing reminders. Old way: one notepad, you cross out the previous reminder and write the new one each time — at the end only the last reminder survives. New way: a fresh sticky note per reminder, so all of them survive independently.

**4. Mailboxes on a street.** Each house (iteration) gets its own mailbox (variable). The old behavior was one shared community mailbox that kept getting emptied and refilled; whoever checked it last only found the final letter.

---

## Mental Models

### Model 1 — "Fresh copy at the top of each iteration"

The simplest model: imagine Go inserts `i := i` (and `v := v`) at the very top of every iteration in 1.22+. Each iteration's body works with its own private copy. This is *almost* literally what the compiler does.

### Model 2 — The variable's "lifetime" shrank

Pre-1.22 the loop variable lived for the *entire loop*. Post-1.22 it lives for *one iteration*. Anything that escapes the iteration (a closure, a goroutine, an `&i`) gets its own per-iteration variable, not the shared one.

### Model 3 — Capture-by-reference is unchanged; what's referenced changed

Closures still capture *by reference*, not by value — that did not change. What changed is *which* variable they reference. Now it's a brand-new one each iteration, so the reference points somewhere unique.

### Model 4 — The `go` directive is a behavior switch

Think of `go 1.22` in `go.mod` as a literal switch labeled "per-iteration loop variables: ON." Flip it to `go 1.21` and the switch is OFF for that module. The compiler reads this switch per package.

### Model 5 — Read-only loops never cared

If you only ever *read* the loop variable inside the loop and never let it escape, the two behaviors are **identical** and produce the same machine code. The change is invisible — and free — for the common case.

---

## Pros & Cons

### Pros

- **Eliminates the #1 Go gotcha.** A whole class of concurrency and closure bugs simply vanishes.
- **No code changes required.** Bump your `go` directive and buggy loops become correct.
- **The intuitive behavior is now the real behavior.** What beginners *expect* is what happens.
- **The `v := v` workaround becomes unnecessary** — less boilerplate, cleaner code.
- **Zero performance cost for the common case.** Loops that don't capture compile to the same code as before.

### Cons

- **Behavior changes between versions.** The *same source* can behave differently under `go 1.21` vs `go 1.22`. You must know which gate is active.
- **A handful of programs that relied on the shared variable break.** Rare, but real.
- **Mixed-version codebases can confuse.** One module on 1.22, a dependency on 1.21 — they use different semantics. (Each module follows its own `go` directive, which is actually the safe design, but it can surprise you.)
- **Old tutorials and Stack Overflow answers are now half-wrong.** The internet still tells you to write `v := v`.

The trade-off was overwhelmingly worth it: a tiny breakage surface in exchange for killing a bug that cost the community countless hours.

---

## Use Cases

The change matters most when you:

- **Launch goroutines inside a loop**, each needing its own iteration value — workers, fan-out, per-item processing.
- **Build a slice of closures** in a loop, e.g. deferred cleanups, callbacks, table-driven test cases that run in parallel.
- **Take the address of the loop variable** (`&v`) and store it — appending `&item` to a slice of pointers.
- **Use `defer` inside a loop** that captures the loop variable.
- **Write table-driven tests** with `t.Parallel()` subtests — a notorious source of the old bug.

You can mostly **ignore** the change when:

- Your loop body only reads the variable and finishes using it within the iteration.
- You never capture, never take its address, never start a goroutine, never defer with it.

In those cases old and new code behave identically.

---

## Code Examples

### Example 1 — The canonical goroutine bug

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i)
        }()
    }
    wg.Wait()
}
```

- **Under `go 1.21` or earlier:** prints `3 3 3` (in some order). All goroutines share one `i`, which is 3 when they run.
- **Under `go 1.22` or later:** prints `0 1 2` (in some order). Each goroutine captured its own iteration's `i`.

### Example 2 — Appending the address of a range variable

```go
package main

import "fmt"

func main() {
    nums := []int{10, 20, 30}
    var ptrs []*int
    for _, v := range nums {
        ptrs = append(ptrs, &v)
    }
    for _, p := range ptrs {
        fmt.Print(*p, " ")
    }
    fmt.Println()
}
```

- **Pre-1.22:** prints `30 30 30`. Every `&v` is the address of the *same* variable, which ends at 30.
- **1.22+:** prints `10 20 30`. Each `&v` points to a distinct per-iteration variable.

### Example 3 — Closures collected in a slice

```go
package main

import "fmt"

func main() {
    var funcs []func()
    for _, name := range []string{"a", "b", "c"} {
        funcs = append(funcs, func() { fmt.Print(name, " ") })
    }
    for _, f := range funcs {
        f()
    }
    fmt.Println()
}
```

- **Pre-1.22:** prints `c c c`.
- **1.22+:** prints `a b c`.

### Example 4 — The old workaround (now redundant)

The pre-1.22 fix was to shadow the variable inside the body:

```go
for i := 0; i < 3; i++ {
    i := i // shadow: a fresh copy, scoped to the body
    go func() { fmt.Println(i) }()
}
```

This printed `0 1 2` even on old Go. Under 1.22 the `i := i` line is **harmless but unnecessary** — the compiler already does this for you. New code does not need it.

### Example 5 — A loop that is unaffected by the change

```go
sum := 0
for _, v := range []int{1, 2, 3} {
    sum += v // read-only, used immediately
}
fmt.Println(sum) // 6, under any Go version
```

No capture, no address-of, no goroutine. Identical behavior and identical generated code before and after 1.22.

### Example 6 — Table-driven parallel tests (the test-suite classic)

```go
func TestThings(t *testing.T) {
    cases := []struct {
        name string
        in   int
        want int
    }{
        {"double 2", 2, 4},
        {"double 3", 3, 6},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            if got := tc.in * 2; got != tc.want {
                t.Errorf("got %d, want %d", got, tc.want)
            }
        })
    }
}
```

- **Pre-1.22:** because `t.Parallel()` defers the subtest until the loop finishes, all subtests saw the *last* `tc`. The whole table effectively tested one case. You needed `tc := tc`.
- **1.22+:** each subtest gets its own `tc`. The `tc := tc` line is no longer required.

---

## Coding Patterns

### Pattern: write the obvious loop and trust 1.22

```go
for _, item := range items {
    go process(item) // pass by value — always safe
    go func() { handle(item) }() // 1.22+: captures this iteration's item
}
```

Under 1.22 you can capture freely. Under any version, passing the value as an argument (`go process(item)`) is unconditionally safe.

### Pattern: pass-by-argument is version-independent

When in doubt, hand the value to the goroutine as a parameter:

```go
for _, item := range items {
    go func(it Item) { handle(it) }(item)
}
```

This works on *every* Go version because it copies `item` at call time. It is the bulletproof style for code that must compile correctly regardless of the `go` directive.

### Pattern: drop the `:= same` shadow in new modules

If your `go.mod` says `go 1.22+`, delete redundant `v := v` lines. They add noise without effect. (Leave them only if your code might also build under an older directive.)

### Pattern: be explicit about value vs. pointer

If you genuinely want a pointer that survives the loop, 1.22 makes `&v` safe. If you want to mutate the original slice element, index it instead: `&nums[i]`.

---

## Clean Code

- **Prefer the simplest loop that reads correctly.** Under 1.22 the naive version is the correct version.
- **Delete obsolete `v := v` lines** in modules that target `go 1.22+`. They are leftover scaffolding.
- **Keep `go func(x){...}(v)` for code that must support old Go versions** — it is unambiguous and version-proof.
- **Set your `go` directive deliberately.** `go 1.22` is not just a minimum version; it changes loop semantics. Treat bumping it as a real decision.
- **Don't rely on the shared-variable behavior.** Code that depends on the old reuse is fragile and confusing; rewrite it to be explicit.

---

## Product Use / Feature

In real software, the loopvar change touches:

- **Concurrency-heavy services.** Worker pools, fan-out request handlers, and batch processors that spawn goroutines per item become correct by default.
- **Test suites.** Parallel table-driven tests stop silently testing only the last case — a real correctness win for product quality.
- **Background job dispatch.** Loops that enqueue closures or callbacks now carry the right per-item data.
- **Migration effort.** Bumping a service's `go` directive to 1.22 may *fix* latent bugs you didn't know you had — and, very rarely, expose a place that relied on the old behavior.

For most teams, adopting 1.22 is a quiet quality upgrade: a category of hard-to-find concurrency bugs disappears from new code.

---

## Error Handling

The loopvar change is not about `error` values, but it interacts with error handling in loops:

### Capturing `err` in deferred closures

```go
for _, f := range files {
    defer func() {
        if err := f.Close(); err != nil { // f is per-iteration in 1.22+
            log.Println("close failed:", err)
        }
    }()
}
```

Pre-1.22, all deferred closures referenced the same `f` and closed the last file three times. 1.22+ closes each file correctly. (Note: `defer` in a loop still defers to function return — that's a separate concern.)

### Collecting per-iteration errors via goroutines

```go
errs := make([]error, len(jobs))
var wg sync.WaitGroup
for i, job := range jobs {
    wg.Add(1)
    go func() {
        defer wg.Done()
        errs[i] = run(job) // both i and job are per-iteration in 1.22+
    }()
}
wg.Wait()
```

Pre-1.22 this wrote every result into `errs[last]` and ran the last job repeatedly. 1.22+ makes it correct without `i := i; job := job`.

---

## Security Considerations

- **Silent data corruption is a security concern.** The old bug could cause a request handler to process the wrong item, leak one user's data into another's response, or apply the wrong permissions — all because a goroutine captured the final loop value. The 1.22 fix removes this class of latent vulnerability.
- **Audit before bumping the directive on security-critical code.** While the change usually *fixes* bugs, you should re-test concurrency-heavy, security-sensitive paths after moving to `go 1.22` — both to confirm fixes and to catch the rare code that depended on the old behavior.
- **Don't assume dependencies changed.** A library still on `go 1.21` keeps the old semantics inside its own code. Your bump does not retroactively fix it; that is by design.

---

## Performance Tips

- **There is no slowdown for the common case.** The compiler is smart: it only allocates a fresh, separately-stored variable when the variable actually **escapes** (is captured or has its address taken). A plain read-only loop reuses a register or stack slot exactly as before.
- **Capturing in a loop may now allocate per iteration.** If a closure captures the loop variable and that closure escapes to the heap, you get one small allocation per iteration. This was *already true* whenever you wrote the `v := v` workaround — 1.22 just makes it automatic and visible.
- **Hot loops that don't capture pay nothing.** Don't restructure tight numeric loops out of fear; if they don't capture, the generated code is unchanged.
- **Profile if a previously-cheap loop got slower after the bump.** The likely cause is a capturing closure now allocating per iteration — which means it was buggy before and is correct now. The fix is the same as always: avoid capturing in the hot path.

---

## Best Practices

1. **Target `go 1.22+` in new modules** to get per-iteration semantics from day one.
2. **Write the natural loop** and trust the new behavior; don't pre-emptively add `v := v`.
3. **Pass values as goroutine arguments** when you need code that compiles correctly under any `go` directive.
4. **Re-run tests after bumping the directive** — especially concurrency and table-driven tests.
5. **Remove obsolete shadowing** (`v := v`) when you raise a module to `go 1.22`.
6. **Know your module's `go` directive** before reasoning about any loop's behavior.
7. **Don't write code that depends on the shared variable.** It is fragile and now non-idiomatic.
8. **Use `go vet`** — its `loopclosure` analyzer still flags genuinely suspicious patterns on older directives.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Assuming the toolchain version decides

It does **not**. The `go` directive in `go.mod` decides. A Go 1.22 toolchain compiling a `go 1.21` module uses the *old* semantics for that module.

### Pitfall 2 — Mixed-version monorepos

Module A (`go 1.22`) and module B (`go 1.21`) in the same repo use different loop semantics. Code copied from one to the other can behave differently.

### Pitfall 3 — Forgetting `go func(x){}(v)` is always safe

Beginners sometimes "modernize" by removing the argument-passing pattern, assuming 1.22 makes everything safe. It does — but only if the *module's* directive is 1.22+. The argument-passing form needs no such guarantee.

### Pitfall 4 — `&nums[i]` vs `&v`

`&v` gives the address of the (now per-iteration) loop copy. `&nums[i]` gives the address of the *actual slice element*. If you want to mutate the slice, you still need `&nums[i]`. They are different things.

### Pitfall 5 — `defer` in a loop is still a separate trap

1.22 fixes *which variable* the deferred closure captures, but deferred calls still run at **function** return, not at iteration end. A loop that `defer file.Close()` thousands of times still holds them all open until the function returns. That problem is unrelated and unchanged.

### Pitfall 6 — Labels, `goto`, and `continue`

The per-iteration variable interacts cleanly with `continue` and `break`. But unusual control flow with `goto` jumping into or around a loop body can be confusing; the fresh-variable rule still applies per iteration the loop actually performs.

### Pitfall 7 — `for i := range 10` (range over integer)

Go 1.22 also added ranging over an integer: `for i := range 10` iterates `i` from 0 to 9. This loop's `i` is per-iteration too — capturing it in a closure is safe under 1.22.

### Pitfall 8 — Code samples online

Most pre-2024 examples and answers still show `v := v` as "required." It isn't, in 1.22+. Don't be confused when modern code omits it.

---

## Common Mistakes

- **Believing the bug still exists in 1.22+.** It doesn't, once your module targets 1.22.
- **Believing the bug is fixed in a `go 1.21` module just because you have Go 1.22 installed.** It isn't — the directive gates it.
- **Removing `go func(x){}(v)` and relying on capture in code meant to support old Go.** Risky if the directive isn't 1.22+.
- **Confusing `&v` with `&slice[i]`.** They address different memory.
- **Thinking the change affects loops that only read the variable.** It doesn't — those are identical.
- **Leaving redundant `v := v` lines everywhere after a bump.** Harmless but noisy; clean them up.

---

## Common Misconceptions

> *"Go 1.22 made closures capture by value."*

No. Closures still capture by **reference**. What changed is that each iteration has a *new* variable to reference.

> *"If I install Go 1.22, all my loops are fixed."*

No. Only modules whose `go.mod` declares `go 1.22` (or higher) get the new behavior. Your installed toolchain version alone does not flip the switch.

> *"The change slows down all my loops."*

No. Loops that don't capture the variable compile to identical code. Only capturing loops may allocate per iteration — and they were already buggy or already paying that cost via `v := v`.

> *"I still need to write `v := v` to be safe."*

Not in a `go 1.22+` module. There it is redundant. You only need it (or argument-passing) if your code must also build under an older directive.

> *"This change affects all `for` loops including `for { }`."*

The infinite loop `for { }` has no loop variable, so there is nothing to make per-iteration. The change affects loops that declare variables: 3-clause loops and `range` loops.

> *"Both `i` and `v` change, but only one is fresh."*

Both are fresh. In `for i, v := range xs`, each iteration gets a new `i` *and* a new `v`.

---

## Tricky Points

- **The directive, not the toolchain, gates the change.** `go 1.22` in `go.mod` is the switch.
- **Per-package gating.** Each module compiles under its own directive; a 1.21 dependency keeps old behavior even in a 1.22 build.
- **Both loop forms are affected** — `range` and 3-clause. Many people think only `range` changed.
- **`&v` is now safe to store**, but `&slice[i]` is still what you want to mutate the slice itself.
- **Zero cost when not captured** — escape analysis ensures no extra allocation for read-only loops.
- **`v := v` is not wrong in 1.22**, just redundant. It still compiles and behaves correctly.
- **`for i := range 10`** (integer range, also new in 1.22) gives a per-iteration `i`.

---

## Test

Try this in a scratch folder with a `go.mod` that says `go 1.22`.

```go
package main

import "fmt"

func main() {
    var fs []func()
    for i := 0; i < 3; i++ {
        fs = append(fs, func() { fmt.Print(i, " ") })
    }
    for _, f := range fs {
        f()
    }
    fmt.Println()
}
```

Run it. Now edit `go.mod` to say `go 1.21` and run again.

Answer:
1. What does it print under `go 1.22`? (Answer: `0 1 2`.)
2. What does it print under `go 1.21`? (Answer: `3 3 3`.)
3. Which line in `go.mod` controls the difference? (Answer: the `go` directive.)
4. If you add `i := i` as the first line of the loop body, what prints under `go 1.21`? (Answer: `0 1 2`.)

---

## Tricky Questions

**Q1.** I upgraded my Go toolchain to 1.22 but my loop still prints `3 3 3`. Why?

A. Your `go.mod` probably still says `go 1.21` (or lower). The behavior is gated on the directive, not the installed compiler. Bump it to `go 1.22`.

**Q2.** Does the change affect the 3-clause `for i := 0; i < n; i++` loop or only `range`?

A. Both. The per-iteration rule applies to the 3-clause form and the `range` form equally.

**Q3.** Is `go func(x int){...}(i)` still needed in 1.22?

A. Not for correctness in a 1.22+ module — capture works now. But it's still the safest style if your code must also compile under older directives, and some teams keep it for clarity.

**Q4.** Will my read-only numeric loop get slower under 1.22?

A. No. If the variable doesn't escape, the compiler reuses the same storage; the generated code is unchanged.

**Q5.** I have a closure capturing `v` and it now allocates once per iteration. Is that a regression?

A. No — it's correctness. That allocation is what `v := v` would have caused before. The old code either had this cost already or was silently buggy.

**Q6.** Does `&v` inside the loop now give a unique pointer each iteration?

A. Yes, under 1.22+. Each iteration's `v` is a distinct variable, so `&v` differs each time. Pre-1.22 they were all the same address.

**Q7.** What about `for i := range 10`?

A. That's the new integer-range form (also 1.22). Its `i` is per-iteration, so capturing it is safe.

**Q8.** If a dependency is still on `go 1.21`, does my `go 1.22` build fix its internal loops?

A. No. Each module follows its own directive. The dependency's loops keep old semantics until *its* authors bump *its* directive. This is intentional and safe.

**Q9.** Can I rely on the old shared-variable behavior on purpose?

A. You can, by keeping the directive at `go 1.21`, but it's strongly discouraged. It's fragile, surprising, and non-idiomatic. Rewrite to be explicit.

**Q10.** Does the change affect `for range ch` over a channel?

A. The receive form `for v := range ch` declares a loop variable `v`, so yes — `v` is per-iteration under 1.22+.

---

## Cheat Sheet

```go
// THE BUG (pre-1.22): all print the final value
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }() // 3 3 3 under go 1.21
}

// THE FIX (1.22+): same code, now correct
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }() // 0 1 2 under go 1.22
}

// ALWAYS-SAFE STYLE (any version): pass as argument
for i := 0; i < 3; i++ {
    go func(n int) { fmt.Println(n) }(i) // 0 1 2 everywhere
}

// OLD WORKAROUND (now redundant in 1.22+)
for i := 0; i < 3; i++ {
    i := i // unnecessary under go 1.22
    go func() { fmt.Println(i) }()
}
```

```
What turns it on:

    go.mod:
        go 1.22      ← per-iteration loop variables ON
        go 1.21      ← shared loop variable (old) for THIS module

The toolchain version does NOT decide. The directive does.
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Goroutines print same value | `go.mod` directive < 1.22 | Bump to `go 1.22` |
| `&v` slice all same pointer | Old shared-variable behavior | Bump directive, or `&slice[i]` |
| Parallel subtests all run last case | Pre-1.22 capture in `t.Run` | Bump directive (drop `tc := tc`) |
| Redundant `v := v` everywhere | Leftover old workaround | Delete in 1.22+ modules |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what changed in Go 1.22 about loop variables
- [ ] Predict the output of a goroutine-in-loop under both `go 1.21` and `go 1.22`
- [ ] Name the exact thing that gates the new behavior (the `go` directive)
- [ ] Explain why the toolchain version does not decide the behavior
- [ ] Recognize the `&v`-in-a-slice bug and its fix
- [ ] Explain why `v := v` is now redundant in 1.22+
- [ ] State that both 3-clause and `range` loops are affected
- [ ] Explain why read-only loops are unaffected and pay no performance cost
- [ ] Give the always-safe, version-independent pattern (pass as argument)
- [ ] Explain why the change was safe to make under the Go 1 compatibility promise

---

## Summary

Before Go 1.22, a `for` loop reused a single set of variables across all iterations. Code that captured a loop variable in a closure or goroutine — or took its address — saw the variable's **final** value, producing the most common gotcha in the language. Go 1.22 changed the rule: **each iteration gets a fresh instance** of the loop variable, for both the 3-clause and `range` forms. The naive, intuitive loop is now the correct loop.

The change is gated on the **`go` directive** in `go.mod`: a module declaring `go 1.22` or higher gets the new behavior; one declaring `go 1.21` keeps the old. The toolchain version does not decide — the directive does. This per-module gating is what makes the change safe under Go's compatibility promise.

There is **no performance cost** for the common case: the compiler only creates a separately-stored variable when it actually escapes (is captured or addressed). Read-only loops compile exactly as before. The old `v := v` workaround is now redundant in 1.22+ modules, and the always-safe `go func(x){...}(v)` pattern still works under any version.

---

## What You Can Build

After learning this:

- **Worker pools and fan-out loops** that correctly hand each goroutine its own item — without workarounds.
- **Parallel table-driven test suites** where every case actually runs, not just the last one.
- **Callback and closure collections** built in a loop that carry the right per-item data.
- **Migration-ready services** where bumping the `go` directive quietly fixes latent concurrency bugs.

You cannot yet:
- Reason about the compiler's escape analysis and the exact allocation behavior (next: middle.md and professional.md)
- Plan a fleet-wide migration with `gofix`/`go vet` tooling (senior.md)
- Explain how the change is desugared in the compiler IR (professional.md)
- Handle range-over-func interaction in depth (middle.md)

---

## Further Reading

- ["Fixing for loops in Go 1.22"](https://go.dev/blog/loopvar-preview) — the official blog post; read this first.
- [Go 1.22 Release Notes — Language changes](https://go.dev/doc/go1.22#language) — the authoritative summary.
- [The Go Programming Language Specification — For statements](https://go.dev/ref/spec#For_statements) — the formal rule.
- [Loop Variable Scoping design doc](https://go.googlesource.com/proposal/+/master/design/60078-loopvar.md) — the proposal and the data behind it.
- [`go vet` loopclosure analyzer](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/loopclosure) — how the vet check evolved.

---

## Related Topics

- [18.1 Modern Language Features overview](../) — the section index
- 18.3 Range Over Function (`for x := range fn`) — the Go 1.23 iterator feature
- [6.1.1 `go mod init`](../../06-code-organization/01-modules-and-dependencies/01-go-mod-init/junior.md) — where the `go` directive lives
- 12.x Goroutines and Closures — the concurrency context that exposed the bug
- 13.x Table-Driven Tests — where the bug bit hardest

---

## Diagrams & Visual Aids

```
Pre-1.22: ONE variable, reused

    for i := 0; i < 3; i++ { go func(){ print(i) }() }

        ┌─────────────┐
        │   i  (one)  │ ◄── iteration 0 sets i=0
        │             │ ◄── iteration 1 sets i=1
        │             │ ◄── iteration 2 sets i=2  (now i=3 after loop)
        └─────────────┘
              ▲  ▲  ▲
              │  │  │   all three goroutines point HERE
           g0 g1 g2     → all read 3

Output: 3 3 3
```

```
1.22+: a FRESH variable per iteration

    for i := 0; i < 3; i++ { go func(){ print(i) }() }

        ┌────┐  ┌────┐  ┌────┐
        │i=0 │  │i=1 │  │i=2 │
        └────┘  └────┘  └────┘
           ▲       ▲       ▲
           │       │       │
          g0      g1      g2

Output: 0 1 2
```

```
What flips the switch:

    go.mod
    ┌───────────────────────┐
    │ module example.com/app│
    │                       │
    │ go 1.22   ── ON  ─────┼──► per-iteration variables
    │ go 1.21   ── OFF ─────┼──► shared variable (old)
    └───────────────────────┘

    NOT the installed toolchain. The directive.
```

```
Escape analysis decides the cost:

    for _, v := range xs {
        sum += v            ← v does NOT escape → reuse storage, ZERO cost
    }

    for _, v := range xs {
        go use(v)           ← v escapes (captured) → fresh var, small alloc
    }
```
