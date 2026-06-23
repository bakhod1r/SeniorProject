---
layout: default
title: Subtests — Interview
parent: Subtests (t.Run)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/07-subtests/interview/
---

# Subtests — Interview

[← Back](../)

## Q1. What does `t.Run` do?

It declares a named child test under the current `*testing.T`, runs the
provided function in a fresh goroutine, and returns whether it passed. The
child has its own `t` with its own failure flag, cleanup stack, and
parallelism state.

## Q2. How do I run a single subtest from the command line?

`go test -run 'TestParse/valid_input'`. Each path segment is a regex matched
at that depth. Anchor with `^...$` when names share prefixes:
`-run '^TestParse$/^valid_input$'`.

## Q3. What was the pre-Go 1.22 loop variable bug?

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        check(tc) // all goroutines saw the last tc
    })
}
```

Before Go 1.22 the single `tc` was shared across iterations; parallel
subtests captured the same variable and observed the final value. Fix: add
`tc := tc` before `t.Run`. Go 1.22 made each iteration get its own `tc`, so
the workaround is no longer needed when `go 1.22` (or later) is set in
`go.mod`.

## Q4. When does a parent test see its parallel children's failures?

After all parallel children finish. The parent's body returns first, then
the framework waits for parallel siblings, then the parent's cleanup runs.
If any child failed, the parent is marked failed too.

## Q5. How does `t.Cleanup` order interact with subtests?

Each subtest has its own LIFO cleanup stack that drains when that subtest
ends. Parent cleanups drain when the parent ends, after all parallel
children. Cleanups never cross test boundaries.

## Q6. Subtests vs separate `TestXxx` functions?

Subtests share setup, give a single failure context per scenario family,
and allow targeted filtering with `-run`. Separate functions are easier to
discover in IDEs, run in isolation by default, and avoid shared-state
pitfalls. Use subtests for table-driven cases of one behavior; use
functions for unrelated behaviors.

## Q7. What happens if a subtest panics?

The panic is recovered by the testing framework, the subtest is marked
failed, siblings continue, and the parent is marked failed. Stack trace is
printed under the subtest's `-v` output.

## Q8. Does `t.Skip` in a subtest skip the parent?

No. Skipping a subtest only skips that subtest. To skip the whole parent,
call `t.Skip` before any `t.Run`.

## Q9. Can subtests share state?

Yes, via closure over variables in the parent function, but parallel
subtests must treat that state as read-only or guard it with a mutex.
Mutations between sequential subtests are a code smell that hides ordering
dependencies.

## Q10. What happens if `t.Run` is called with `nil` as the function?

The framework dereferences the function pointer and panics. The panic is
recovered, the subtest is marked failed, and the parent is marked failed
too. Never pass `nil`.

## Q11. How do you list all subtests in a package?

`go test -list '.*'` lists only top-level test functions. To list
subtests you must run the package; subtests are constructed at runtime
inside the parent's body. A common workaround is `go test -v -run X`
combined with grep on `=== RUN`. Some tooling parses `go test -json`
output to build the full hierarchy.

## Q12. How does `t.Cleanup` ordering differ between parent and subtest?

Each `*T` has its own LIFO cleanup stack. The subtest's stack drains
when the subtest's body returns (and its parallel children, if any,
finish). The parent's stack drains when the parent ends, which is after
all subtests including parallel ones.

## Q13. Why does the framework rewrite spaces in subtest names?

To make the names safe for `-run` regex matching and shell quoting.
Spaces become `_`, non-printable runes are escaped. The original name
you passed is preserved for debugging but not displayed.

## Q14. Can a subtest fail without failing the parent?

No. By design, a failed subtest also marks the parent failed. The parent
can continue running siblings, but its final status is FAIL. There is no
flag to opt out of this.

## Q15. What is the cost of `t.Run`?

Roughly 5-10us per call on modern hardware: allocate a new `*T`, start
a goroutine, hook signal channels, register with parent. For tables of
millions of cases this would add up; for any normal test it is
invisible.

## Q16. Does `b.Run` behave the same way?

The semantics are parallel (`*testing.B` has a similar `Run`), but a
sub-benchmark has its own `b.N` calibration and does not use
`b.Parallel` the same way. `RunParallel` exists for parallel
benchmarking with goroutines.

## Q17. How does `-shuffle=on` interact with subtests?

`-shuffle` shuffles only the top-level test functions, not subtests.
Subtests run in declaration order within their parent. There is no
built-in shuffle for subtests.

## Q18. Why does `t.Parallel` panic in some contexts?

Common causes:

- Calling it twice on the same `*T`.
- Calling it after `t.Setenv` (env vars are not thread-safe).
- Calling it from outside the testing goroutine.

The panic message is descriptive; read it carefully.

## Q19. Can a top-level test be parallel with its own subtests?

Yes if the parent calls `t.Parallel` and the subtests do not depend on
each other. The parent's body still executes sequentially; the parent
just becomes eligible to be scheduled in parallel with other top-level
parallel tests.

## Q20. How do you propagate context to a subtest?

Pass it as an argument or use `t.Context()` (Go 1.24+). For older
versions, derive a `context.Context` from `context.Background()` and
register `t.Cleanup` to cancel it when the subtest ends.

## Q21. Are subtests visible from `go test -coverprofile`?

Coverage is aggregated at the package level; per-subtest coverage is
not produced by standard tooling. Code executed by any subtest counts
toward the package's coverage.

## Q22. What is the difference between `t.Skip` and `t.SkipNow`?

`t.Skip` is `t.Log(args)` followed by `t.SkipNow`. They both mark the
test skipped and stop execution. Use `t.Skip` when you want a message
visible in `-v` output.

## Q23. Can I create a subtest after `t.Parallel`?

Yes; calling `t.Run` from a parallel parent creates child subtests
that inherit the parent's parallel scheduling rules. The child must
also call `t.Parallel` to be scheduled in parallel.

## Q24. What's the smallest change to make a flat test suite use subtests?

Wrap the existing function body in `t.Run("default", func(t *testing.T) { ... })`.
Output now has `Parent/default`. Then split the body into multiple
`t.Run` calls one case at a time. This incremental migration avoids
big-bang refactors.

## Q25. How do you debug a test where one subtest passes alone but fails in the suite?

Likely an ordering dependency or shared-state mutation. Steps:

1. Run the suite with `go test -race`.
2. Run just the suspect subtest 100 times with `-count=100`.
3. Check for package-level variables mutated by earlier subtests.
4. Look for `init()` side effects.
5. Try `-shuffle=on` to see if test ordering matters.

## Q26. How does `t.Parallel()` know which tests to run together?

The framework maintains a counter and a barrier channel. When a test
calls `t.Parallel`, it blocks on the barrier. When the parent's body
returns, the framework releases blocked children up to the
`-parallel N` limit. As each child finishes, the framework releases
another.

## Q27. Can `t.Run` create a subtest with the same name as a top-level test?

Yes. The hierarchical name disambiguates: `TestX` is the top-level
test, `TestY/TestX` is a subtest of `TestY` named "TestX". They are
different tests.

## Q28. What is the difference between `t.Fail` and `t.FailNow`?

`t.Fail` marks the test failed but continues execution. `t.FailNow`
marks the test failed and terminates the goroutine via
`runtime.Goexit`. `t.Errorf` is `t.Logf` + `t.Fail`. `t.Fatalf` is
`t.Logf` + `t.FailNow`.

## Q29. Does `t.Run` count as a "test" for cache purposes?

The Go test cache operates at the package binary level, not per
subtest. A package is fully re-run when any input (source, env vars
listed in `GOFLAGS`, etc.) changes. Adding a subtest invalidates the
cache for its package.

## Q30. How do I run a subtest in a debugger?

Use the IDE's "debug test" affordance at the parent function. Then
the debugger runs `TestX/case` if you set a breakpoint inside the
specific case. Some IDEs (GoLand) offer "run specific subtest"
directly from the gutter.

For Delve from the command line:

```
dlv test -- -run 'TestX/^case$'
```

The `-run` filter limits execution to the specific subtest.

## Q31. Why do I see `=== PAUSE` and `=== CONT` in `-v` output?

`PAUSE` indicates a subtest called `t.Parallel` and is waiting to be
scheduled. `CONT` indicates it resumed. These verbs help you trace
parallel execution flow visually.

## Q32. Is `t.Run` safe for non-test packages?

`*testing.T` is constructed only by the testing framework. You
cannot synthesize one yourself for use in production code. If you
need a similar abstraction for non-test purposes, build your own;
don't try to repurpose `testing.T`.

## Q33. Do subtests affect benchmarks?

`*testing.B` has its own `Run` method that creates sub-benchmarks.
Subtests in `*testing.T` and sub-benchmarks in `*testing.B` are
separate APIs with similar shapes. You cannot use `t.Run` inside a
benchmark or `b.Run` inside a test (different receiver types).

## Q34. How do I cancel a long-running subtest?

If you control the function under test, pass `t.Context()` (Go 1.24+)
and let the framework cancel it when the test ends or a timeout
fires. For older Go versions, derive a context and cancel it in
`t.Cleanup`.

## Q35. What if my subtest blocks forever?

`go test -timeout 30s` (default) kills the test binary if any test
exceeds the timeout. The dump includes goroutine traces, helpful for
identifying which subtest hung. Adjust the timeout via `-timeout` or
set `t.Deadline()` for finer control.

## Q36. Can I run subtests in random order?

Not via a built-in flag (`-shuffle=on` only randomizes top-level
tests). To randomize subtest order, sort or shuffle the cases slice
yourself before the loop.

## Q37. How do I find which subtest is the slowest?

Run with `-v` and parse the `--- PASS: name (duration)` lines. Or
use `go test -json` and a tool that sorts events by `Elapsed`.

## Q38. What does `t.Run` do if called inside a `t.Cleanup`?

Undefined. The test is past its execution phase; calling `t.Run`
likely panics or fails silently. Don't do this.

## Q39. Can I have a subtest with no name?

You can pass an empty string. The framework will treat the name as
empty, joining with the parent's name as `Parent/`. This is legal
but confusing; always use a meaningful name.

## Q40. What's the maximum number of parallel subtests?

Bounded by `-parallel N` (default `GOMAXPROCS`). The framework
queues additional parallel subtests and releases them as slots free
up.

## Q41. Do subtests share the parent's `t.Cleanup` stack?

No. Each `*T` has its own cleanup stack. Subtest cleanups drain at
subtest end; parent cleanups drain at parent end, after all
subtests finish.
