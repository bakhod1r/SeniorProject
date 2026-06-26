# Escape Analysis — Professional Level

> **Topic:** [Escape Analysis](README.md)
> **Focus:** Reading compiler/JIT output end-to-end, building an allocation-regression workflow, and concrete perf-tuning recipes for Go and Java hot paths.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Professional Workflow](#the-professional-workflow)
3. [Reading Go Escape Output in Depth](#reading-go-escape-output-in-depth)
4. [Measuring Allocations That Matter](#measuring-allocations-that-matter)
5. [Go Tuning Recipes](#go-tuning-recipes)
6. [Reading and Tuning HotSpot Escape Analysis](#reading-and-tuning-hotspot-escape-analysis)
7. [Catching Regressions in CI](#catching-regressions-in-ci)
8. [Worked Case Studies](#worked-case-studies)
9. [Pros & Cons](#pros--cons)
10. [Best Practices](#best-practices)
11. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
12. [Summary](#summary)

---

## Introduction

This tier is operational. You will be handed a service with a p99 latency problem traced to GC pressure, or a hot function allocating in a tight loop, and asked to fix it without rewriting the architecture. The toolchain — `-gcflags='-m -m'`, `pprof`, `benchstat`, HotSpot diagnostic options, JITWatch, async-profiler — is how you turn "the optimizer should handle this" into a verified, regression-guarded result.

The discipline: **profile to find the allocation, read the escape report to understand *why*, make the smallest change that fixes it, and verify with before/after numbers — then lock it in CI.**

---

## The Professional Workflow

1. **Confirm allocations are the problem.** GC CPU%, allocation rate (bytes/op, allocs/op), p99 correlated with GC pauses. Don't tune escapes if GC isn't on the critical path.
2. **Localize** with a CPU + allocation profile (`pprof` / async-profiler) to the specific function and line.
3. **Explain** with the escape report (`-gcflags='-m -m'` / HotSpot logging) — *which* construct forces the heap.
4. **Fix minimally** — remove the boxing, give the caller the buffer, return by value, restructure to inline. One change at a time.
5. **Verify** with `benchstat` / a warmed JMH run — show allocs/op dropped and latency improved, with statistical significance.
6. **Guard** — add a benchmark and/or an escape-output diff to CI so the win can't silently regress.

---

## Reading Go Escape Output in Depth

```bash
# All escape + inlining decisions for a package, with flow chains:
go build -gcflags='-m -m' ./pkg/... 2>&1 | tee escape.txt

# Focus one function; -l disables inlining to see the *un-inlined* worst case:
go build -gcflags='-m -m -l' ./pkg/...

# Annotate a single file:
go tool compile -m -m yourfile.go
```

**Decode the vocabulary precisely:**

- `does not escape` — argument stays on caller's stack; ideal.
- `escapes to heap` — value flowed to a heap-rooted location.
- `moved to heap: x` — a *named local* promoted (you took `&x` and it leaked, or it's captured).
- `leaking param: p` — `p` itself (the pointer) flows to an escaping sink.
- `leaking param content: p to result ~r0 level=1` — the *pointee* escapes, with the *level* indicating indirection depth; useful to see exactly what leaks.
- `... flow: y = &x:` (only with the second `-m`) — the assignment chain. **This is the line that tells you what to change.**

**Reading a flow chain (real shape):**

```
./h.go:12:9: &u escapes to heap:
./h.go:12:9:   flow: ~r0 = &u:
./h.go:12:9:     from return &u (return) at ./h.go:12:2
```

Translation: `&u` escapes because it flows into the function's return value. Fix = don't return a pointer (return by value) or accept that this constructor heap-allocates and pool it.

**Pro tips:**
- Use `-l` to separate "escapes inherently" from "escapes only because not inlined." If adding `-l` introduces new escapes, your win depends on inlining — fragile.
- `//go:noinline` on a probe function lets you isolate one call site's behavior.
- The `level=N` in `leaking param content` distinguishes "the slice header escapes" from "the backing array escapes."

---

## Measuring Allocations That Matter

```go
func BenchmarkDecode(b *testing.B) {
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = Decode(input)
    }
}
```

```bash
go test -run=^$ -bench=Decode -benchmem -count=10 ./pkg > new.txt
benchstat old.txt new.txt   # statistically compares allocs/op, B/op, ns/op
```

`-benchmem` reports `B/op` and `allocs/op` — the two numbers escape tuning moves. `benchstat` with `-count=10` tells you whether a change is real or noise. **Never report a single run.**

For live services, drive allocation profiles:

```bash
go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
go tool pprof -alloc_objects http://localhost:6060/debug/pprof/heap
# top, list <Func>, web  -> attribute allocations to source lines
```

`-alloc_objects` (count) vs `-alloc_space` (bytes): a hot loop boxing small ints shows huge `alloc_objects` but modest `alloc_space` — that's a classic escape-from-boxing signature.

---

## Go Tuning Recipes

**1. Kill interface boxing in hot loops.** `fmt.Sprintf`, `fmt.Println`, `log.Printf` box every argument. Replace with typed building (`strconv.AppendInt` into a reused buffer) on the hot path.

```go
// Before: 2 allocs/op (box + format buffer)
s := fmt.Sprintf("%d", n)
// After: 0 allocs/op with a reused buffer
buf = strconv.AppendInt(buf[:0], int64(n), 10)
```

**2. Return by value for small structs.** Returning `*T` forces a heap allocation of `T`; returning `T` (when small) stays on the stack.

**3. Caller-owned buffers.** Convert `func F() []byte` (allocates per call) to `func F(dst []byte) []byte` (caller controls lifetime; reuse across calls). This is the `append`-style API convention across the stdlib.

**4. Preallocate slices/maps with capacity** so growth doesn't force reallocation of an escaping backing array: `make([]T, 0, n)`.

**5. `sync.Pool` for unavoidable escapes.** When a buffer *must* outlive the frame (e.g., handed to an async writer), pool it instead of allocating fresh.

**6. Avoid closures capturing loop variables in hot code** — each capture can move the variable to the heap; pass values as arguments instead.

**7. Watch the inlining budget.** Split a large hot function so the inner kernel inlines; verify with `-gcflags='-m'` showing `can inline`.

> Reality check: many of these matter only in genuinely hot code. A handler that runs 50 times/sec does not need allocation surgery. Profile first.

---

## Reading and Tuning HotSpot Escape Analysis

**Relevant flags (defaults in modern HotSpot shown):**

```
-XX:+DoEscapeAnalysis        # on by default
-XX:+EliminateAllocations    # scalar replacement, on by default
-XX:+EliminateLocks          # lock elision, on by default
```

To *diagnose*, you generally **disable** them to A/B the effect, since EA is on by default:

```bash
# Baseline vs. EA-off to quantify what EA is buying you:
java -XX:+DoEscapeAnalysis  -XX:+EliminateAllocations Bench   # normal
java -XX:-DoEscapeAnalysis                              Bench   # EA off
```

If allocation rate (via `-Xlog:gc*` or async-profiler `-e alloc`) jumps sharply with EA off, EA is doing real work on your hot path.

**See the actual decisions:**

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintEscapeAnalysis \
     -XX:+PrintEliminateAllocations -XX:+PrintCompilation YourMain
```

Or use **JITWatch** to load a `-XX:+LogCompilation` log and visually see which allocations were eliminated and which calls inlined — the most ergonomic way to read C2's decisions.

**Allocation profiling (the ground truth):**

```bash
# async-profiler: sample allocation sites directly
./profiler.sh -e alloc -d 30 -f alloc.html <pid>
```

`-e alloc` shows allocation flame graphs by call site. A method you *expected* EA to optimize that still dominates the alloc profile (after warmup) means EA didn't fire — usually due to a megamorphic call or failed inlining.

**Tuning levers in Java:**
- **Improve inlining**: keep hot methods small; raise `-XX:MaxInlineSize` / `-XX:FreqInlineSize` only with measurement (blunt instrument).
- **Reduce megamorphism**: a call site with many implementations blocks devirtualization; consider monomorphizing the hot path.
- **Warm up before judging.** Pre-JIT code allocates; conclusions require a warmed run (JMH `@Warmup`, or a manual warmup loop).
- **Consider GraalVM** for partial escape analysis if rare-branch escapes poison hot methods under C2.

---

## Catching Regressions in CI

Escape wins are fragile (inlining budget, an added `fmt` call, a new interface). Lock them:

**Go:**
- **Benchmark gate:** run `-benchmem` benchmarks, compare `allocs/op` against a committed baseline with `benchstat`; fail the build on a significant increase.
- **Escape-output gate:** `go build -gcflags=-m ./hotpkg 2>&1 | grep 'escapes to heap'` and diff against an expected list — or assert `does not escape` for known-hot functions. Catches the regression at the source, not just the benchmark.

**Java:**
- JMH `@BenchmarkMode` with `GC` profiler (`-prof gc`) asserting `gc.alloc.rate.norm` (bytes/op) stays at/near zero for allocation-free hot paths.

The point: **make "this function must not allocate" an executable, enforced contract**, not tribal knowledge.

---

## Worked Case Studies

### Case 1 — JSON field accessor boxing 3M ints/sec (Go)

Profile (`-alloc_objects`) showed 60% of allocations in a metrics hot loop. Escape report:

```
metrics.go:88:21: n escapes to heap:
metrics.go:88:21:   flow: ~arg0 = n: ... call to (*Logger).Debugf
```

`Debugf(format string, args ...interface{})` boxed every int. Fix: a level check so the loop skips formatting entirely (`if log.V(2)`), plus typed counters. Result: `allocs/op` 4 → 0, GC CPU 18% → 4%, p99 down 35%. Guarded with an escape-grep CI check.

### Case 2 — Constructor returning `*T` (Go)

A `newRow()` returned `*Row` used immediately and discarded. `-gcflags=-m` showed `moved to heap: r`. Changing to return `Row` by value (struct was 48 bytes) removed 1 alloc/op; in the 200k-row loop this cut allocation bytes by 9.6 MB/op and removed a GC cycle per request.

### Case 3 — Java StringBuilder in a parser (lock elision + scalar replacement)

A token formatter built strings with a per-call `StringBuilder`. `-XX:-DoEscapeAnalysis` A/B showed EA was eliminating both the `StringBuilder` allocation (scalar replacement) and `char[]` churn on the hot path. A refactor that *stored* the builder in a field to "reuse" it actually **regressed** performance: it made the object escape, killing scalar replacement and lock elision. Lesson: "reuse the object" can be slower than letting EA delete it. Verified with `-prof gc` in JMH.

---

## Pros & Cons

**Pros**
- Tooling gives **direct, line-level attribution** of allocations and the escape reason.
- Fixes are usually **small and local** (remove boxing, return by value, caller-owned buffer).
- Wins are **measurable and guardable** in CI.

**Cons**
- Requires **discipline**: profile → explain → fix → verify → guard, every time.
- Java's picture is **non-deterministic**; conclusions demand warmup and repeated runs.
- Over-tuning (manual pooling, premature reuse) can **regress** by forcing escapes that EA would have deleted.

---

## Best Practices

- **Always pair a fix with a before/after `benchstat` (Go) or warmed JMH `-prof gc` (Java).** No numbers, no claim.
- **Use `-gcflags='-m -m'` flow chains to find the *exact* construct** to change; don't guess.
- **Prefer letting EA delete the object over manually pooling it** unless the object provably escapes — pooling an EA-deletable object is a net loss.
- **Gate hot functions in CI** with an allocation benchmark or escape-output assertion.
- **Profile in a production-representative build** (real optimization flags, warmed JIT), not a debug build.

---

## Edge Cases & Pitfalls

- **`-N` / `-l` debug builds disable optimizations** — never measure escapes there. Use a normal optimized build.
- **`alloc_objects` vs `alloc_space`:** boxing shows as many tiny objects; size-driven escapes show as bytes. Read both.
- **JMH dead-code elimination** can delete the very allocation you're measuring; consume results with a `Blackhole`.
- **HotSpot deopt mid-benchmark** can re-introduce allocations; watch `-XX:+PrintCompilation` for `made not entrant`.
- **"Reuse" anti-pattern:** caching/storing an otherwise-non-escaping object to "avoid allocation" can force it to escape and disable scalar replacement *and* lock elision — measure, don't assume.
- **Grepping escape output naively** catches unrelated lines; assert on specific `func:line` entries to avoid brittle CI checks.

---

## Summary

- The professional loop is **confirm GC matters → localize with a profile → explain with the escape report → fix minimally → verify with statistics → guard in CI.**
- **Go:** `go build -gcflags='-m -m'` (read the *flow* chains), `-benchmem` + `benchstat`, `pprof -alloc_objects/-alloc_space`. Top fixes: kill boxing, return by value, caller-owned buffers, preallocate, pool only true escapes.
- **Java/HotSpot:** EA is on by default — A/B with `-XX:-DoEscapeAnalysis`, read decisions via diagnostic options / JITWatch, profile allocations with async-profiler `-e alloc`, and **always warm up**. Watch for deopt; consider GraalVM's PEA for rare-branch escapes.
- **Lock wins in CI** with allocation benchmarks or escape-output diffs — escape gains are fragile to inlining and a stray boxing call.
- The most counterintuitive pro lesson: **don't manually pool an object EA can delete** — forcing it to escape to "reuse" it is often slower than letting the optimizer make it vanish.
