---
layout: default
title: Future Proposals — Interview
parent: Future Concurrency Proposals
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/interview/
---

# Future Proposals — Interview

[← Back](../)

A senior interviewer asking about future proposals is checking two things: do you read the Go
issue tracker, and can you reason about API design without being dogmatic.

Most candidates will not have used these features in production. The goal is to show that you
understand the motivation, the trade-offs, and how each proposal fits into the broader
concurrency model. A good answer says "I read the proposal, here are the trade-offs, here's
where I'd use it, here's where I'd be skeptical."

---

## testing/synctest

**1. What problem does `testing/synctest` solve, and why is `time.Sleep` in tests not good
enough?**

Real-time tests are flaky on shared CI runners, slow when timeouts are minutes, and unreliable
for code that uses `time.Ticker` or `context.WithDeadline`. Synctest provides a synthetic clock
that advances only when all goroutines in the bubble are blocked, making timeout-driven code
testable in microseconds.

**2. Why is `testing/synctest` experimental in Go 1.24 instead of stable?**

API surface is small, but the runtime hooks it requires (detecting "all goroutines blocked",
synthetic time injection into `time.Now`) need real-world feedback. Issue
[#67434](https://go.dev/issue/67434) is the umbrella tracking the experimental period.

**3. Can `testing/synctest` test code that uses `net.Conn` or `os.File`?**

No. Real I/O is outside the bubble and looks like the goroutine is "permanently blocked" from
synctest's point of view, breaking the wait condition. Use a mock or pipe inside the bubble.

**4. How would you decide between synctest and a manual fake clock library like
`clockwork`?**

Synctest is built into the runtime and requires no clock injection through your APIs.
Clockwork requires you to pass a `Clock` interface everywhere `time` is used. Synctest wins for
new code; clockwork remains relevant if you cannot use Go 1.24+ or need real-time tests
selectively.

**5. What does `synctest.Wait()` do that you cannot do with just `synctest.Run`?**

`Wait` blocks the current goroutine until all other goroutines in the bubble are durably
blocked. Useful for setting up state precisely before advancing the synthetic clock. Without
`Wait`, you'd have to guess when the workers reached their blocked state and might inject input
too early.

---

## Coroutines and iter.Pull

**6. What is `runtime.coro` and why is it not exported?**

It is the runtime-level coroutine stack used to implement `iter.Pull`. The Go team did not
export it because the API is unstable and they want to see whether iterators alone justify the
feature. If a strong external use case emerges (generators, async/await-style code), exporting
may follow.

**7. How does `iter.Pull` differ from spawning a goroutine and using a channel?**

A goroutine + channel involves the scheduler, two M-context switches, and ~3 microseconds of
overhead per step. A coroutine via `iter.Pull` is a stack swap on the same M — sub-microsecond.
Coroutines are also serial by definition; goroutines are parallel and need synchronization.

**8. Is `iter.Pull` thread-safe?**

No. The `next` and `stop` functions returned by `Pull` must be called from a single goroutine.
If you need concurrent consumers, build a channel adapter on top.

**9. What happens if you fail to call `stop` from `iter.Pull`?**

The coroutine and its stack leak until GC eventually reclaims them via cleanup. Always
`defer stop()`.

**10. Could `iter.Pull` be replaced by a goroutine + channel internally? Why isn't it?**

Yes, conceptually. The reason it's not is performance: serial generators are 5-10x faster with
coroutines than with channels, and the iterator API was designed precisely to enable that
optimization. If `iter.Pull` were just `goroutine + channel`, there would be no reason for the
new package.

---

## Range-over-func iterators

**11. How does range-over-func interact with goroutines launched inside the body?**

The iterator does not know about them. If you launch a goroutine and the loop breaks early,
the iterator's yield function returns false on its next call, but your goroutines keep running.
You must coordinate cleanup yourself (context, errgroup).

**12. Can a range-over-func iterator yield from a goroutine?**

Only via the `iter.Pull` adapter pattern: the iterator runs in a coroutine, yields to the
consumer, which is the goroutine of your choice. Direct cross-goroutine yields are not
supported.

**13. What is the runtime cost of a single `yield` call versus a function call?**

A `yield` call is just a function call from the runtime's perspective — there's no special
overhead. The cost is whatever the closure body does, plus the indirect call (a few extra
cycles). This is the major advantage over goroutine+channel iteration.

---

## weak.Pointer

**14. What guarantees does `weak.Pointer.Value()` give about the lifetime of the result?**

It returns either nil or a valid pointer at the instant of the call. Between the call and the
next statement, the GC cannot collect the object because you now hold a strong reference. But
if you store the weak pointer and call `Value()` later, the result may have changed.

**15. Why would you prefer `weak.Pointer` over `sync.Pool` for an interning cache?**

Sync.Pool entries can be reclaimed at any GC, but the pool decides when, and entries are not
keyed. Weak pointers preserve identity (a `weak.Pointer[T]` to the same `*T` survives as long
as the `*T` survives anywhere in the program), which is exactly what interning needs.

**16. What is the race-detector behavior of weak.Pointer?**

Reading a weak pointer is treated as a synchronizing operation by the runtime — the race
detector treats it as a happens-before edge with whatever published the pointer. Writing
through the returned pointer follows normal Go memory model rules.

**17. Can you weak-reference an interior field of a struct?**

No. `weak.Pointer[T]` must point to the start of an allocation, not into the middle. This is a
deliberate restriction tied to how the runtime tracks allocations.

---

## runtime.AddCleanup vs SetFinalizer

**18. Why is `runtime.AddCleanup` recommended over `runtime.SetFinalizer`?**

Three reasons: (a) you can attach multiple cleanups to one object; (b) the cleanup function
does not receive the pointer, so accidental resurrection is impossible; (c) cleanups run on a
dedicated worker pool, not a single finalizer goroutine that can become a bottleneck.

**19. If both `AddCleanup` and `SetFinalizer` are set on the same object, what happens?**

Both run. Order is unspecified. The Go 1.24 release notes recommend not mixing them.

**20. Can a cleanup function safely access the runtime, allocate, or block?**

It can allocate and call runtime functions. It should not block indefinitely — the cleanup pool
has limited workers and blocking starves other cleanups. Treat cleanups like signal handlers in
spirit: short and non-blocking.

**21. How do you cancel an `AddCleanup` registration?**

Call `cleanup.Stop()` on the returned `Cleanup` value. This is the analogue of
`runtime.SetFinalizer(ptr, nil)`. Useful when the object is being closed explicitly and the
cleanup is no longer needed.

---

## Atomic vector ops

**22. What problem would atomic vector ops solve that current `sync/atomic` does not?**

The ABA problem in CAS-based lock-free data structures. With a single-word CAS, a pointer can
be freed and reallocated to a different object with the same address, defeating the CAS check.
A double-width CAS over (pointer, generation) makes ABA impossible by incrementing generation
on every write.

**23. Why has issue [#50860](https://go.dev/issue/50860) stalled?**

Portability: 32-bit platforms have no 128-bit atomic, and even on 64-bit, RISC-V's atomic spec
does not include a paired CAS in the base ISA. The Go team prefers APIs that work everywhere
or have clear fallback semantics.

**24. Without atomic vector ops, how do production codebases handle ABA today?**

Three common patterns: a mutex around the load-store sequence (loses lock-freedom); a versioned
pointer with the version in low bits of an aligned pointer (limited generation bits); or
hazard pointers (correct, complex). Most production Go code does not have an ABA window because
the GC handles allocation lifecycles.

---

## GOMAXPROCS auto-detection

**25. Why is the Go default `GOMAXPROCS = runtime.NumCPU()` wrong on Kubernetes?**

`NumCPU` reads the host's logical CPU count via `sched_getaffinity`, ignoring cgroup CPU quota.
A pod with `cpu: 100m` on a 64-core node gets `GOMAXPROCS=64`, then the scheduler thrashes
through 64 Ps that share 10% of one core.

**26. What does `automaxprocs` do, and what's the proposal to put it in the runtime?**

It reads cgroup v1/v2 quota files and calls `runtime.GOMAXPROCS(ceil(quota))` at init. Issues
[#33803](https://go.dev/issue/33803) and [#73193](https://go.dev/issue/73193) propose making
this the runtime default, gated on a runtime flag for back-compat.

**27. If automaxprocs lands in the runtime, what migration is needed?**

For most users, nothing. Drop the `automaxprocs` import; the runtime does the same thing.
Users who explicitly set `GOMAXPROCS` are unaffected — the runtime preserves explicit settings.

---

## Goroutine-local storage

**28. Why does Go reject goroutine-local storage?**

Russ Cox and other reviewers have repeatedly argued GLS encourages hidden dependencies and
global state, contrary to Go's explicit philosophy. Issue [#21355](https://go.dev/issue/21355)
is the long-running rejection thread.

**29. What is the Go-idiomatic alternative to GLS for request-id propagation?**

`context.Context` carrying the request id as a value, passed explicitly. For libraries that
cannot thread context, `runtime/pprof.Labels` provides goroutine-attached labels visible to
the profiler but not readable by application code.

**30. Why are `pprof.Labels` accepted but GLS not?**

Labels are diagnostic-only. They don't affect program behavior — only how the profiler reports
goroutine identity. Application code cannot read them, so they don't introduce hidden
dependencies in production logic.

---

## Structured concurrency

**31. What is structured concurrency, and what would it look like in Go?**

A model where every goroutine has a parent scope; the scope does not exit until all children
finish. Proposals range from a language-level `go group { ... }` block to a stdlib `sync.Group`
similar to `errgroup`. Issues [#40221](https://go.dev/issue/40221) and
[#61888](https://go.dev/issue/61888) sketch designs.

**32. Why is structured concurrency mostly already in Go via `errgroup`?**

`errgroup.Group` plus `g.Wait()` enforces "parent does not return until children finish" by
convention. The structured-concurrency proposal would make this enforcement a language
guarantee instead of a library discipline, but the practical gain is small.

**33. What would language-level structured concurrency improve over `errgroup`?**

Compiler-enforced waiting: the compiler would reject code where a goroutine outlives its
scope. Today, `errgroup` only catches violations at runtime (or via human review). The
question is whether the additional safety justifies a new keyword.

---

## Meta

**34. What is one thing about a future Go concurrency proposal you would change before it
lands?**

A good answer mentions a specific design choice, like "I would make `weak.Pointer` also
support weak references to map keys so that ephemeron caches become possible without manual GC
hints." This shows you've read the actual proposal docs.

**35. How do you keep up with Go concurrency proposals?**

Read the Go release notes when each version ships, scan the issue tracker periodically
(filtered by the "Proposal" label), follow Russ Cox's blog for design rationale. For your
team, consider rotating a weekly proposal review where one engineer summarizes one active
proposal.

**36. Which proposal on this page do you think is most likely to ship next, and why?**

A defensible answer is automatic GOMAXPROCS detection — it has wide buy-in, a proven polyfill,
no portability issues on supported platforms, and the migration story is trivial. The
counterargument is that the runtime team is conservative about changes that affect every Go
program, so it may slip another version.

**37. Which proposal would you bet against ever shipping?**

Goroutine-local storage. It has been declined multiple times for consistent reasons (hidden
dependencies, goroutine boundary ambiguity). The community returns to it periodically but the
committee's position is stable.
