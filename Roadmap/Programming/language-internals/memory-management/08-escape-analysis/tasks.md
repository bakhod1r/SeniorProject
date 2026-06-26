# Escape Analysis — Hands-On Tasks

> **Topic:** [Escape Analysis](README.md)

Practical exercises to build escape-analysis intuition: predict the decision, read the compiler/JIT output, fix an allocating hot path, and guard the win. Most tasks use Go (because its escape report is the clearest); the Java tasks need a JDK. Do them in order — each builds on the last.

> **Setup:** A working `go` toolchain. For the Java tasks, a JDK 17+ and (optionally) [JMH] and async-profiler. Everywhere below, "escape report" means `go build -gcflags='-m -m' .`.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Predict, then verify (stack vs heap)

Write four tiny Go functions and **predict** for each whether the value escapes *before* running the tool:
1. returns `x + y` (two local ints),
2. returns `&u` (a local struct),
3. returns `u` (the struct by value),
4. takes `p *T` and only reads `p.Field`.

Then run `go build -gcflags='-m' .` and compare your predictions to `moved to heap` / `does not escape`.

**Self-check:**
- [ ] I predicted all four before running the tool.
- [ ] I can point to the exact line in the output that confirms each decision.
- [ ] I can explain *why* #2 escapes but #3 does not.

<details><summary>Hint</summary>Returning a pointer to a local leaks a reference past the frame; returning a copy does not.</details>

### Task 2 — Make the boxing escape appear and disappear

Write a loop that calls `fmt.Println(i)` for `i` in `0..n`. Capture the escape report and find the `escapes to heap` line for `i`. Now replace the body with a typed sink:

```go
func sink(x int) { _ = x }
//go:noinline
```

Re-run the report and confirm the escape is gone.

**Self-check:**
- [ ] I saw `i escapes to heap` (or equivalent) with `fmt.Println`.
- [ ] The typed-sink version shows no escape for `i`.
- [ ] I can explain the role of `interface{}` boxing in the difference.

<details><summary>Hint</summary>`fmt.Println` takes `...interface{}`; the conversion forces a pointer the analysis can't prove is non-retained.</details>

### Task 3 — Read a flow chain

Take the `return &u` function from Task 1 and run `go build -gcflags='-m -m' .`. Read the `flow:` chain and write one sentence describing the path by which `&u` reaches a heap root.

**Self-check:**
- [ ] I located the `flow:` lines (only present with the doubled `-m`).
- [ ] My sentence names the return value as the escaping root.
- [ ] I understand why the single `-m` didn't show the chain.

---

## Core

### Task 4 — Closures and capture

Write `counter()` that returns `func() int` incrementing a captured local `n`. Confirm via the escape report that `n` is `moved to heap`. Then write a variant where the closure is *called inside* `counter` and not returned; check whether `n` still escapes.

**Self-check:**
- [ ] The returned-closure version moves `n` to the heap.
- [ ] I tested whether a non-escaping closure keeps `n` on the stack.
- [ ] I can state the rule: capture escapes only if the closure outlives the call.

<details><summary>Hint</summary>An inlined closure that doesn't outlive the frame may keep its captures on the stack; a returned one cannot.</details>

### Task 5 — Benchmark the difference

Write two implementations of a small function — one returning `*T`, one returning `T` (small struct). Add `b.ReportAllocs()` benchmarks for both and run:

```bash
go test -bench=. -benchmem -count=10 . | tee out.txt
benchstat out.txt   # or compare manually
```

Record `allocs/op` and `B/op` for each.

**Self-check:**
- [ ] The `*T` version reports ≥1 alloc/op; the `T` version reports 0.
- [ ] I ran `-count=10` (not a single run).
- [ ] I can quantify the per-call difference in bytes.

<details><summary>Hint</summary>`-benchmem` adds the `B/op` and `allocs/op` columns that escape tuning moves.</details>

### Task 6 — Caller-owned buffer refactor

Take a function `func Format(n int) []byte` that allocates a fresh slice each call. Refactor it to `func Format(dst []byte, n int) []byte` (append-style) and reuse one buffer across a loop. Benchmark both; confirm the refactor removes the per-call allocation.

**Self-check:**
- [ ] The append-style version reaches 0 allocs/op in a reuse loop.
- [ ] The escape report shows the backing array no longer escaping per call.
- [ ] I understand why moving lifetime ownership to the caller sidesteps escape entirely.

### Task 7 — Profile a hot path

Add `net/http/pprof` to a small program (or use a benchmark with `-memprofile`). Generate an allocation profile and use `go tool pprof -alloc_objects` → `top` and `list <Func>` to attribute allocations to a specific line. Identify whether the dominant allocation is boxing (many tiny objects) or size-driven (large bytes).

**Self-check:**
- [ ] I attributed allocations to a specific source line.
- [ ] I distinguished `-alloc_objects` from `-alloc_space` and read both.
- [ ] I diagnosed the allocation *cause* from the profile shape.

---

## Advanced

### Task 8 — Inlining-dependent escape

Write a hot function `A` that calls a tiny helper `B` returning a value that *should* stay on the stack. Confirm via `-gcflags='-m'` that `B` is inlined and nothing escapes. Now add `//go:noinline` to `B` and re-run. Observe whether an allocation appears, and explain the connection between inlining and escape.

**Self-check:**
- [ ] I saw `can inline B` / `inlining call to B` in the inlined case.
- [ ] Disabling inlining changed the escape outcome (or I can explain why it didn't).
- [ ] I can articulate "no inlining ⇒ interprocedural ⇒ conservative escape."

<details><summary>Hint</summary>Inlining turns an interprocedural escape (which the analysis handles poorly) into an intraprocedural one (which it handles well).</details>

### Task 9 — Channel send and goroutine capture

Write a function that sends a locally-constructed value on a channel, and another that captures a local in a `go func(){...}()`. Confirm both escape. Then explain which axis is at play — lifetime escape, thread escape, or both.

**Self-check:**
- [ ] Both the channel send and the goroutine capture escape to the heap.
- [ ] I correctly identify these as *thread* escapes (and therefore also heap escapes).
- [ ] I can explain why Go must keep these alive independent of frame lifetime.

### Task 10 — Java: prove EA via A/B

Write a Java method with a hot loop that constructs a small non-escaping object each iteration (e.g., a `Point` whose fields you sum). Run it warmed under `-XX:+DoEscapeAnalysis` and `-XX:-DoEscapeAnalysis`, measuring allocation rate (async-profiler `-e alloc`, or `-Xlog:gc*` to compare GC frequency).

**Self-check:**
- [ ] I warmed the JIT before measuring (warmup loop or JMH `@Warmup`).
- [ ] Allocation rate rose sharply with EA disabled.
- [ ] I can name the optimization EA used here (scalar replacement).

<details><summary>Hint</summary>EA is on by default; the way to *see* its effect is to turn it off and watch allocations reappear.</details>

### Task 11 — Java: the "reuse" anti-pattern

Take the Task 10 method and "optimize" it by hoisting the object into a field and reusing it across iterations. Benchmark (warmed) against the original. Confirm — and explain — whether it got faster or slower.

**Self-check:**
- [ ] I measured warmed, repeated runs (not a single cold run).
- [ ] I observed (and can explain) that forcing the object to escape disabled scalar replacement.
- [ ] I can state when manual reuse helps vs hurts relative to letting EA delete the object.

---

## Capstone

### Task 12 — Eliminate allocations in a realistic hot path, then guard it

You're given (or write) a small request handler that parses a fixed-format message and emits a metric on every call, currently allocating several objects per request. Your job:

1. **Profile** it (`-benchmem` benchmark + `pprof -alloc_objects`) to find every allocation source.
2. **Explain** each with the escape report (`-gcflags='-m -m'`) — name the construct (boxing, pointer return, closure, growing slice, interface).
3. **Fix** the hot path to 0 allocs/op using only minimal changes (typed sinks / level checks for logging, caller-owned buffers, value returns, preallocated capacity, pooling for any *true* escape).
4. **Verify** with `benchstat` over `-count=10`, reporting the before/after `allocs/op`, `B/op`, and `ns/op`.
5. **Guard** the result: add a benchmark assertion or an escape-output diff so the win can't silently regress, and write a one-paragraph note on *why* each fix worked.

**Self-check:**
- [ ] The hot path reaches 0 allocs/op (or I justify every remaining allocation as a true, pooled escape).
- [ ] Each original allocation is explained by a specific escape construct, with the report line.
- [ ] `benchstat` shows a statistically significant improvement, not noise.
- [ ] I added an automated guard (allocation benchmark threshold or escape-output assertion).
- [ ] My note correctly explains the mechanism behind each fix.

<details><summary>Hint — common offenders to look for</summary>
Logging/formatting that boxes (`fmt`/`log` with `...interface{}`), constructors returning `*T`, per-call `make` without reused capacity, closures capturing per-request state, and interface conversions in the inner loop. Push any unavoidable interface to the boundary, not the kernel.
</details>

---

## Self-Assessment

You've mastered this topic when you can, without notes:

- [ ] Predict whether a given Go function's values escape, and confirm with `-gcflags='-m -m'`, reading the **flow** chain to find the cause.
- [ ] Explain the difference between **escape to heap** (lifetime) and **escape to thread** (sharing), and which optimizations each enables (placement/scalar replacement vs lock/barrier elision).
- [ ] List the standard escape triggers (pointer return, field/global store, closure capture, interface boxing, un-analyzable call, channel/goroutine, unknown size) and why each forces the heap.
- [ ] Describe when HotSpot's EA runs (JIT, post-inlining, post-warmup), what it enables (scalar replacement, stack allocation, lock elision), and how to A/B-verify it with `-XX:±DoEscapeAnalysis`.
- [ ] Explain why EA is conservative, inlining-dependent, defeated by megamorphism/reflection, and offers **no guarantee** — and why you therefore design hot paths to be allocation-light *by construction*.
- [ ] Explain Partial Escape Analysis (GraalVM) and the per-path design implications.
- [ ] Run the full professional loop — profile → explain → fix → verify with `benchstat`/warmed JMH → guard in CI — on a realistic hot path.
- [ ] Recognize the "reuse the object" anti-pattern that forces an otherwise-deletable object to escape.
