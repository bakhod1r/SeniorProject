---
layout: default
title: Property-Based Testing — Optimize
parent: Property-Based Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/16-property-based-testing/optimize/
---

# Property-Based Testing — Optimize

[← Back](../)

PBT properties run hundreds of times per check, so small inefficiencies
compound. Below are practical tactics to keep PBT fast without losing
coverage.

## 1. Reduce input size, not the number of checks

A common reflex is to lower `-rapid.checks` to speed up CI. That kills
coverage. Prefer to **bound the generator**:

```go
// slow: unbounded slice up to a few thousand elements
xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")

// fast: same coverage of edge cases, much smaller
xs := rapid.SliceOfN(rapid.Int(), 0, 64).Draw(t, "xs")
```

For most algorithms, a slice of 64 random values exercises every code
path. Doubling the size doubles runtime without doubling coverage.

## 2. Hoist constant setup out of the property body

The property runs N times. Anything constant should live outside:

```go
// bad: recompiles the regex 100 times
rapid.Check(t, func(t *rapid.T) {
    re := regexp.MustCompile(`^[a-z]+$`)
    s := rapid.StringMatching(`[a-z]+`).Draw(t, "s")
    require.True(t, re.MatchString(s))
})

// good: compile once
var re = regexp.MustCompile(`^[a-z]+$`)
rapid.Check(t, func(t *rapid.T) {
    s := rapid.StringMatching(`[a-z]+`).Draw(t, "s")
    require.True(t, re.MatchString(s))
})
```

## 3. Avoid `t.Logf` inside hot paths

Every `Logf` allocates and the buffer is retained until end of test. With
1000 runs and verbose logging the test binary can use hundreds of MB.

Log only on failure: `if !ok { t.Logf(...) }`.

## 4. Choose cheap reference oracles

Comparing your implementation against a "naive" reference is a powerful
property, but the reference must be cheap **relative** to the unit under
test. If the reference is `O(n^3)` and the unit is `O(n log n)`, the
property is bottlenecked by the reference.

For very large inputs, fall back to invariants ("output is sorted, output
length == input length") instead of comparing against a slow oracle.

## 5. Parallelise independent properties

PBT properties are usually pure. Add `t.Parallel()` to the outer test:

```go
func TestSortInvariants(t *testing.T) {
    t.Parallel()
    rapid.Check(t, ...)
}
```

`go test -p` then runs many properties simultaneously. The `rapid.Check`
loop itself is sequential — don't try to fan out inside it; concurrency
breaks shrinking.

## 6. Tune `-rapid.checks` per environment

```bash
# Dev — fast feedback
go test -rapid.checks=50 ./...

# CI — broader coverage
go test -rapid.checks=1000 ./...

# Nightly — exhaustive
go test -rapid.checks=10000 -rapid.steps=200 ./...
```

Set the default in code via `rapid.MakeConfig(rapid.Config{Checks: 100})`
and override via flag.

## 7. Cache expensive generators

If a custom generator builds a complex object (e.g. a parsed AST), make
sure you do not rebuild it inside `Map` chains unnecessarily. Generators
are pure — but they run every check. Profile with `go test -cpuprofile`
to confirm the bottleneck is the unit under test, not generation.

## 8. Short-circuit obvious cases

```go
xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
if len(xs) == 0 {
    return // skip; cheaper than the full property
}
```

This wastes some draws but is faster than running the property body on
trivial inputs that are unlikely to expose bugs. Use sparingly — every
skip is coverage you lose.

## 9. Profile to find the bottleneck

```bash
go test -run=TestProperty -rapid.checks=1000 -cpuprofile=cpu.out
go tool pprof -top cpu.out
```

If most time is in `rapid.Draw*`, narrow your generators. If most time is
in your code, the property is well-scoped and the unit under test is
genuinely slow — optimise that.

## 10. Avoid global mutable state

Properties that touch a shared DB, file, or global var serialise badly and
make `t.Parallel()` unsafe. Refactor to pass dependencies via parameters
so each property body is independent and fast.

## Summary

- Bound input size.
- Hoist constants.
- Parallelise outer tests.
- Tune `-rapid.checks` per env (dev vs CI vs nightly).
- Profile before guessing.

## 11. Beware accidental quadratic behaviour

A property body that does `O(n)` work inside a generator that produces
`O(n)` values gives you `O(n^2)` per check. Multiplied by 100 checks
this can dominate test time:

```go
// O(n^2) — for each pair, search the slice
xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
for i := range xs {
    for j := range xs {
        if i != j && xs[i] == xs[j] { ... }
    }
}
```

Use a map for membership checks. Test code is still code; algorithmic
efficiency matters when properties run hundreds of times.

## 12. Avoid `defer` inside the property body

`defer` adds a small overhead per call. Inside a property body called
1000 times during a single check, those allocations add up:

```go
rapid.Check(t, func(t *rapid.T) {
    f, _ := os.CreateTemp("", "")
    defer os.Remove(f.Name()) // adds work per iteration
    // ...
})
```

If possible, set up resources outside `rapid.Check` and use `t.Cleanup`
on the outer `*testing.T`. PBT bodies should be lean.

## 13. Memory: shrinking large structures is slow

A 1 MB drawn value takes time to copy during shrinking. The shrinker
may make hundreds of attempts. Total: tens of seconds spent shrinking
one failure.

Mitigations:

- Cap container sizes (`rapid.SliceOfN(g, 0, 1024)` not unbounded).
- Use simple element types in generators.
- For state machines, keep the action alphabet small.

## 14. Reuse buffers across runs

If your property body allocates a buffer every run:

```go
rapid.Check(t, func(t *rapid.T) {
    buf := make([]byte, 1<<20) // 1 MB per check!
    // ...
})
```

For 1000 checks that is 1 GB of garbage. Hoist to a `sync.Pool` or
declare outside:

```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 1<<20) },
}
rapid.Check(t, func(t *rapid.T) {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf)
    // ...
})
```

The pool keeps GC pressure low under PBT load.

## 15. Concurrent state machines

`rapid.StateMachine` is sequential. If you want concurrent state-machine
PBT (multiple goroutines firing actions), you must build it yourself.
The cost is shrinking complexity: shrinking *interleavings* is harder
than shrinking sequences. Most teams stick to sequential PBT plus
`-race` and reserve true concurrency PBT for high-stakes components.

## 16. Disabling rapid in unrelated test runs

If you have a test target that does not need PBT (e.g. integration
tests), gate with build tags:

```go
//go:build !no_rapid
```

Or just run `go test -short`. Inside the property:

```go
rapid.Check(t, func(t *rapid.T) {
    if testing.Short() { t.Skip() }
    // ...
})
```

Skipped PBT means faster smoke tests; PBT runs as part of CI's
"full test" job.

## 17. Avoid sleeping inside properties

```go
rapid.Check(t, func(t *rapid.T) {
    // ...
    time.Sleep(10 * time.Millisecond)
    // ...
})
```

10 ms × 1000 checks = 10 seconds of wall time spent sleeping. Replace
sleeps with injectable clocks. Most "we need to sleep" requirements are
really "we need a fake clock" requirements.

## 18. Reuse compiled assertions

If your property uses a regex or a complex matcher, compile it once
outside the property:

```go
var emailRE = regexp.MustCompile(`^[a-z]+@[a-z]+\.[a-z]+$`)

rapid.Check(t, func(t *rapid.T) {
    s := genEmail.Draw(t, "s")
    if !emailRE.MatchString(s) { t.Fatal("not an email") }
})
```

Saves the compile cost per iteration.

## 19. Last word

PBT performance is rarely the bottleneck in real codebases — the unit
under test usually dominates. But when PBT *does* dominate (large
inputs, slow oracles, allocation-heavy generators), the techniques above
recover orders of magnitude. Profile first, optimise second.

A practical target: each property runs in under 1 second locally at the
default 100 checks. If it doesn't, apply the techniques on this page in
order: bound size, hoist constants, parallelise, cache, then profile.
