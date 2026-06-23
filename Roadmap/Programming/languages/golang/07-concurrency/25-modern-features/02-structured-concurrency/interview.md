---
layout: default
title: Structured Concurrency — Interview
parent: Structured Concurrency
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/02-structured-concurrency/interview/
---

# Structured Concurrency — Interview

[← Back](../)

The questions below are ordered roughly from warm-up to deep. Each has a model
answer that an interviewer would expect a senior Go engineer to give.

## Warm-up

**Q1. What is structured concurrency, in one sentence?**

A discipline in which every concurrent task is owned by a syntactic scope, so
when the scope exits all of its tasks have completed, been cancelled, or
failed; there are no orphan goroutines.

**Q2. Why is the bare `go f()` statement considered "unstructured"?**

Because the goroutine's lifetime is decoupled from the caller's. The launcher
can return while the goroutine keeps running. There is no language-enforced
parent that waits for, cancels, or collects errors from it.

**Q3. Does Go have structured concurrency built into the language?**

No. Go has the `go` statement, channels, `sync.WaitGroup`, and `context.Context`.
Structured concurrency is achieved by convention and libraries — most notably
`golang.org/x/sync/errgroup`.

**Q4. What package gives Go the closest approximation to structured concurrency?**

`golang.org/x/sync/errgroup`. It bundles wait, first-error propagation, and (with
`WithContext`) cancellation into a scope object.

**Q5. What is the difference between `errgroup.Group{}` and `errgroup.WithContext`?**

`Group{}` gives you just wait + first-error. `WithContext` additionally returns a
derived `context.Context` that is cancelled when the first error occurs or when
`Wait` returns, enabling sibling-task cancellation.

## Core mechanics

**Q6. What happens if two goroutines in an `errgroup` both return errors?**

Only the first one is recorded; the second is silently dropped. Internally an
`errOnce sync.Once` guards the assignment to `g.err`.

**Q7. Does `Wait` return as soon as the first error occurs?**

No. `Wait` blocks until every started goroutine has finished. The first error
cancels the derived context (when `WithContext` is used) so siblings *can*
notice and exit, but `Wait` still waits for their actual return.

**Q8. What does `SetLimit(n)` do?**

It bounds the maximum number of active goroutines in the group to `n`. New
calls to `Go` block until a slot frees up; `TryGo` returns `false` immediately
when no slot is available.

**Q9. Why does `SetLimit` panic if there are active goroutines in the group?**

Because resizing the underlying semaphore channel while goroutines are using it
would race. The panic is a deliberate guard, codified in `errgroup.go`.

**Q10. What is `TryGo` and when would you use it?**

`TryGo` attempts to start a goroutine but returns `false` (without blocking) if
the limit has been reached. Use it when you want non-blocking submission, e.g.
shedding load when a worker pool is saturated.

## Cancellation and context

**Q11. How does cancellation propagate inside an `errgroup` created with `WithContext`?**

When any `Go`-launched function returns a non-nil error, the group calls the
cancel function of the derived context. Sibling goroutines that pass that
context to downstream calls or check `ctx.Done()` will then exit.

**Q12. If a goroutine in an `errgroup` does not respect `ctx`, does cancellation help?**

No. Cancellation in Go is cooperative. A goroutine that ignores `ctx.Done()`
will keep running; the group will then wait for it in `Wait`, and the parent
function blocks. This is the most common source of "errgroup hangs" bugs.

**Q13. What does `context.Cause(ctx)` return inside the derived context of an `errgroup.WithContext`?**

In modern `errgroup` versions (which use `context.WithCancelCause`),
`context.Cause` returns the first error captured by the group, or
`context.Canceled` if the parent context cancelled first.

**Q14. Can you call `Wait` more than once on the same `Group`?**

`Wait` itself is safe to re-call — the underlying `WaitGroup` is already at
zero, so it returns immediately with the same recorded error. But you should
treat `Wait` as a one-shot lifecycle terminator; reusing the group after `Wait`
is not a documented use case.

**Q15. Is it safe to call `Go` after `Wait` has returned?**

No. The contract is: all `Go` calls precede `Wait`. Calling `Go` after `Wait`
adds work to a `WaitGroup` that has reached zero and races with the consumer.

## Design questions

**Q16. Why doesn't Go have structured concurrency natively?**

Several reasons cited by the Go team: (1) the `go` keyword's fire-and-forget
semantics is part of Go's identity, (2) `context.Context` already covers
cancellation, (3) channels + `sync.WaitGroup` are flexible enough, (4)
proposals to add a "go expression" with a handle would change the language
substantially. The team has consistently preferred library solutions.

**Q17. How would you compare `errgroup` to Kotlin's `coroutineScope`?**

Both are scope objects that wait for children before returning. Kotlin
enforces it at the language level — you literally cannot escape the scope
without children finishing. `errgroup` enforces it only if the caller
remembers to call `Wait`. There is no compile-time check.

**Q18. How does Trio's "nursery" pattern map to Go?**

A nursery is `errgroup.WithContext` plus mandatory block-structure. The closest
Go analog is to use `errgroup` inside a function that returns the result of
`Wait`, and to never store the group in a struct field.

**Q19. What is the "go expression" proposal?**

A draft (informal) proposal where `go` would be an expression returning a
handle object with `Wait()` and `Cancel()` methods, similar to JavaScript's
`Promise` or Swift's `async let`. It was deferred in favour of `errgroup`-style
libraries.

**Q20. Why does `errgroup` not have a panic-recovery feature?**

Because the Go team prefers panics to crash the program — they indicate
programmer bugs. Adding recovery would mask bugs. Wrappers in production code
that need to keep the process alive add their own `defer recover()` around `f`.

## Production and pitfalls

**Q21. You see `go doWork()` in a library. Why is this a code smell?**

The library has no way to communicate the goroutine's completion or error to
its caller. The caller cannot wait for it, cancel it, or learn whether it
failed. In a long-lived process this leaks goroutines and hides bugs.

**Q22. How do you write a library function that needs to do background work?**

Either (a) accept a `context.Context` and an `errgroup.Group` from the caller,
(b) return a "handle" the caller can `Wait` on, or (c) document very clearly
that the goroutine is a daemon and provide a `Stop` method that joins it.
Never bare `go` with no exit path.

**Q23. Compare `errgroup` to a raw `sync.WaitGroup + chan error`. When would you pick which?**

`errgroup`: when you want first-error semantics and (optionally) cancellation
propagation. It is also more readable. Raw `WaitGroup + chan error`: when you
need *all* errors, fine-grained control over the error channel buffer, or to
keep the dependency surface small. Use `errgroup` by default.

**Q24. How do you bound concurrency to N workers with `errgroup`?**

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

`SetLimit(8)` makes `g.Go` block once 8 goroutines are active. The same pattern
with `TryGo` lets you shed work when saturated.

**Q25. What is a "supervision tree" and how does it relate to structured concurrency?**

A supervision tree (from Erlang) is a hierarchy where each node owns its
children and decides what to do on child failure (restart, escalate, etc.).
Structured concurrency is a weaker form: every task has an owner that at least
*waits* for and *propagates* its result. Production Go services often layer a
small supervision-tree pattern on top of `errgroup` for restart logic.

**Q26. How would you detect a goroutine leak in tests?**

Use `go.uber.org/goleak`. Call `goleak.VerifyTestMain(m)` from `TestMain`, or
`goleak.VerifyNone(t)` at the end of individual tests. It snapshots the
goroutine stacks before and after; any extras are reported as leaks.

**Q27. What is the relationship between `context.WithCancel` and structured concurrency?**

`context.WithCancel` covers half of the principle: it lets a parent signal
children to stop. It does not cover the other half: waiting for them to
actually stop. Structured concurrency needs both signal *and* join.

**Q28. Is `errgroup` safe to use from multiple goroutines?**

Yes. `Go`, `TryGo`, and `Wait` are concurrency-safe. `SetLimit` is the
exception — it must be called before any goroutines are active.

**Q29. What is the cost of `errgroup` over a raw `WaitGroup`?**

A `sync.Once` and (if `WithContext` was used) a cancellable context. The
overhead is small — a single allocation for the `Group` itself, plus the
context derivation. For tight loops launching thousands of tiny goroutines, the
raw `WaitGroup` is marginally faster but the difference is rarely measurable
in practice.

**Q30. If I do `g.Go(func() error { panic("x") })`, what happens?**

The goroutine panics and (with the default `errgroup`) brings down the whole
process. `errgroup` does not catch panics. The group's `Wait` will never
return because `g.wg.Done` is bypassed by the panic. This is why production
wrappers add a `defer recover()` around `f`.

**Q31. Why is it dangerous to capture the loop variable in `g.Go`?**

Before Go 1.22, the loop variable was reused across iterations; capturing it
without rebinding (`item := item`) meant every goroutine saw the same — and
last — value. Go 1.22 changed loop semantics so each iteration has its own
variable, removing the bug but breaking older codebases that relied on the
old behaviour.

**Q32. Walk me through `errgroup.WithContext`'s implementation.**

It calls `context.WithCancelCause(parent)` to derive a cancellable context.
The cancel function is stored in `g.cancel`. When a goroutine's `f` returns
an error, `errOnce.Do` records the first one and calls `g.cancel(err)`,
which propagates as the cancellation cause. `Wait` calls `g.cancel(g.err)`
at the end to ensure the derived context is always cancelled, even on
success.

**Q33. What is the difference between cancellation and completion in structured concurrency?**

Cancellation = "please stop." Completion = "you have stopped." Languages with
real structured concurrency guarantee completion (the parent does not return
until children are done). Go's `context.Context` guarantees cancellation but
not completion; `errgroup.Wait` adds the completion guarantee.

**Q34. Bonus: when should you *not* use `errgroup`?**

When the goroutines are long-lived daemons that intentionally outlive the
launcher (e.g. background flushers, supervisors). For these, design a
`Start`/`Stop` lifecycle with its own waitgroup, and document the daemon
nature. Forcing daemon-style code into `errgroup` either misuses the package
or blocks forever in `Wait`.

## Deeper / behavioural

**Q35. Walk me through a production incident you'd expect to see with bare `go`.**

Classic pattern: an HTTP handler calls `go logAudit(event)` on every
request. `logAudit` does a network call. The log aggregator slows down.
Each request spawns a goroutine that piles up. Goroutine count goes
from a few hundred to tens of thousands. GC pressure spikes. Latency
tanks. On-call gets paged. Root cause: bare `go` in a hot path. Fix:
a supervised audit worker draining a buffered channel, dropping events
when full.

**Q36. How would you migrate a large codebase from bare `go` to `errgroup`?**

Three steps. (1) Add a custom `go/analysis` linter that flags every
bare `go` outside an allowlist; run it in CI as a warning, not an
error, to surface the count. (2) Pick the worst offenders by frequency
or by incident history; rewrite them one PR at a time. (3) Once the
backlog drops to zero, flip the lint to error. The whole process
typically takes weeks-to-months for a large service.

**Q37. What's the difference between `errgroup` and `sourcegraph/conc`?**

`conc` is a structured-concurrency library that builds on the same
ideas but adds generic types, mandatory panic recovery, and helpers
like `Pool` and `Iterator`. Use `conc` when you want type-safe result
aggregation and don't mind the extra dependency. Use `errgroup` for
the small dependency surface and the de-facto-standard API.

**Q38. Is the `errgroup` package likely to ever land in the standard library?**

Unclear. The Go team has discussed it. The package is stable and
well-used; promoting it to stdlib would require freezing the API. The
team has been content to leave it in `x/sync`. A more likely change
is a future `task` or `sync/scope` package that learns from `errgroup`
but ships a more enforced API.

**Q39. How does `errgroup.WithContext` interact with `context.WithValue`?**

`errgroup.WithContext(parent)` returns a derived context that inherits
all of `parent`'s values. Values placed in `parent` are visible via
`gctx`. Cancellation is independent: cancelling `gctx` does not affect
`parent`. This is the standard `context.Context` behaviour — `errgroup`
doesn't do anything special.

**Q40. Final big-picture question: where does Go fall on the structured-concurrency spectrum?**

Level 1 in the taxonomy: library convention, no language enforcement.
Kotlin, Swift, and Trio are at Level 3 (compile-time enforcement). C
is at Level 0 (no support). Go's choice trades enforcement for
flexibility; the cost is that discipline lives in the team, not the
compiler.
