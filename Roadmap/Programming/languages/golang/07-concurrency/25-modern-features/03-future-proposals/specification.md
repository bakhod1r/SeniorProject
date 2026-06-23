---
layout: default
title: Future Proposals — Specification
parent: Future Concurrency Proposals
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/specification/
---

# Future Proposals — Specification

[← Back](../)

This page summarizes the actual proposal documents that drive each upcoming feature, the
discussion that surrounds them, and the current accepted/declined/experimental status as of Go
1.24. Where a proposal has multiple linked issues, the canonical one is named.

Status terminology follows the Go proposal process:

- **accepted** means the proposal review committee approved the API and an implementation is
  landing or has landed behind a build tag or in the standard library.
- **experimental** means the package or feature is in the tree under `GOEXPERIMENT` or with an
  explicit "API may change" disclaimer.
- **likely accept** means the committee has signalled positive intent in the discussion thread
  but the proposal is not yet formally accepted.
- **on hold** means discussion has stalled or is waiting on another feature.
- **declined** means the committee rejected the proposal, sometimes for a good reason,
  sometimes pending a better design.

---

## testing/synctest — issue #67434

**Status:** experimental in Go 1.24 behind `GOEXPERIMENT=synctest`, expected stable in Go 1.25
under the same package name. Accepted in late 2024 after roughly a year of discussion.

**Summary from the proposal:** introduce a `testing/synctest` package that provides
`Run(func())` and `Wait()` to run goroutines under a synthetic clock. Inside a bubble,
`time.Now`, `time.Sleep`, `time.After`, `time.Tick`, and the `context` deadline machinery all
advance only when every goroutine in the bubble is blocked. The result is fully deterministic
tests for code that uses timeouts, retries, and tickers, without `time.Sleep` calls in the test
itself.

**Key API:**

```go
package synctest

// Run executes f in a new "bubble". Time inside the bubble is synthetic.
// Run returns when all goroutines started inside f have exited.
func Run(f func())

// Wait blocks until every goroutine in the current bubble is durably
// blocked (on a channel, mutex, time.Sleep, etc.). Then it returns.
func Wait()
```

**Notable details:** the bubble has its own clock that starts at a fixed instant. Goroutines
launched outside the bubble are not affected. The implementation hooks into the runtime
scheduler to detect "all goroutines blocked" — the same mechanism deadlock detection uses, but
bubble-scoped.

**Pre-1.24 history:** the proposal grew out of years of discussion about deterministic
concurrency testing in Go. Earlier attempts (issues #59989, #65336) tried different approaches
that all foundered on the same problem: distinguishing "blocked on time" from "blocked on real
I/O." The eventual solution uses runtime hooks rather than wrapping `time`.

**Anticipated changes between 1.24 experimental and 1.25 stable:** the API is small enough that
breaking changes are unlikely. The most likely refinement is more aggressive detection of
"durably blocked" — currently the bubble considers a goroutine blocked only if it's parked on a
synchronization primitive the runtime knows about. Adding new primitives (like
`runtime/trace`-aware operations) would expand the scope.

---

## iter.Pull and runtime.coro — issue #61897 (range-over-func) and #61405 (iter package)

**Status:** accepted, shipped in Go 1.23. The `runtime.coro` type is an internal implementation
detail of `iter.Pull` and is **not** exported. The proposal explicitly leaves a door open to
expose user-mode coroutines later but does not commit.

**Summary:** Go 1.23 added range-over-func iterators (`for x := range func(yield func(T)
bool)`). To support `iter.Pull`, which turns a push iterator into a pull iterator, the runtime
gained coroutines: lightweight stacks switched cooperatively without involving the goroutine
scheduler.

The relevant runtime symbols are `runtime.newcoro`, `runtime.coroswitch`, and
`runtime.coroexit`, exposed only via `//go:linkname` from `iter`.

```go
package iter

// Pull converts a push iterator into a pull iterator: each call to next
// returns the next value, or (zero, false) when done. stop must be called
// when the consumer is done, to release coroutine resources.
func Pull[V any](seq Seq[V]) (next func() (V, bool), stop func())

func Pull2[K, V any](seq Seq2[K, V]) (next func() (K, V, bool), stop func())
```

**Implementation note:** the coroutine stack is allocated from the same pool as goroutine
stacks but is owned by the calling goroutine. Stack switches do not involve the scheduler — the
runtime simply saves the caller's stack pointer, swaps to the coroutine's stack, and restores.
This is roughly as cheap as a function call (~20-40ns) compared to ~150-300ns for a goroutine
context switch.

**Outlook:** the discussion in #61897 mentions that "if user-mode coroutines turn out to be
useful beyond iterators, we may export them." No formal proposal exists yet as of Go 1.24. The
runtime symbols are not part of the Go 1 compatibility promise; they can change between
releases without notice. Code that uses `//go:linkname` against them is fragile.

---

## weak package — issue #67552

**Status:** accepted, shipped in Go 1.24. Package path: `weak`.

**Summary:** introduce `weak.Pointer[T]` for weak references that do not prevent garbage
collection. The intended use is caches keyed by object identity (canonicalization, interning)
where the cache should not retain entries forever.

```go
package weak

type Pointer[T any] struct { /* ... */ }

func Make[T any](p *T) Pointer[T]
func (p Pointer[T]) Value() *T   // returns nil if collected
```

**Concurrency notes:** `weak.Pointer` is safe for concurrent reads via `Value()`. The pointer
may transition to nil at any GC cycle, so callers must treat the return value as racy with the
collector and re-check. The proposal explicitly disallows weak pointers to interior fields and
to pinned objects.

**Race detector behavior:** reading a weak pointer is a synchronizing operation. The race
detector treats it as a happens-before edge with whatever published the pointer, which means
existing pointer-publish patterns (e.g. `atomic.Pointer[T].Store` followed by `weak.Make`) do
not need additional fences.

**Restrictions:**

- A `weak.Pointer[T]` may only point to the start of an allocated `*T`, not to an interior
  field.
- An object pinned with `runtime.Pinner` cannot be weakly referenced.
- Cyclic weak references are allowed and behave naturally: both objects can be collected if
  no strong reference reaches either.

**Open design questions** (visible in the issue thread):

- Whether a future "weak map" type (`weak.Map[K, V]`) should be added. The current consensus is
  that users can build it from `weak.Pointer` plus `sync.Map`.
- Whether equality should compare the underlying address. Currently `weak.Pointer[T]` is a
  comparable value type, but two `weak.Pointer[T]` values are equal only if they were made from
  the same `Make` call.

---

## runtime.AddCleanup — issue #67535

**Status:** accepted, shipped in Go 1.24. Marked as the recommended replacement for
`runtime.SetFinalizer`.

**Summary:** `runtime.AddCleanup(ptr, fn, arg)` attaches a cleanup function that runs when
`ptr` is collected. Unlike `SetFinalizer`, multiple cleanups may be attached to the same
object, the cleanup function does not receive the about-to-be-collected pointer (avoiding
accidental resurrection), and cleanups run on a dedicated cleanup goroutine pool, not the
finalizer goroutine.

```go
package runtime

func AddCleanup[T, V any](ptr *T, cleanup func(V), arg V) Cleanup

type Cleanup struct{ /* ... */ }

func (c Cleanup) Stop()
```

**Implementation note:** the cleanup pool is sized based on `GOMAXPROCS`, with a minimum of 1.
Cleanups can run in parallel, so a cleanup that blocks (e.g. on a network close) does not
prevent other cleanups from making progress. This is a strict improvement over `SetFinalizer`,
where one slow finalizer could stall the entire finalizer goroutine.

**Compatibility with SetFinalizer:** both APIs can be used in the same program. The Go 1.24
release notes recommend not mixing them on the same object because the run order is
unspecified. `SetFinalizer` is not deprecated in the formal sense but is soft-deprecated for
new code.

**Outlook:** `SetFinalizer` will not be removed but is now soft-deprecated for new code. Future
Go versions may add `runtime.AddCleanup` variants for special cases (e.g. memory-typed
cleanup), but the core API is considered stable.

---

## Atomic vector ops — issue family around #50860

**Status:** proposed, **on hold**. No accepted variant as of Go 1.24.

**Summary:** add atomic operations that act on a small fixed-width vector (e.g. two adjacent
int64s, or a 128-bit value) using `LOCK CMPXCHG16B` on amd64 and `LDXP/STXP` on arm64. The
motivation is double-width CAS for ABA-resistant lock-free data structures and for storing a
`(pointer, generation)` pair atomically.

**Sketches proposed in the thread:**

```go
// Sketch 1: paired CAS over a struct
type Pair struct { A, B uint64 }
func CompareAndSwapPair(addr *Pair, old, new Pair) bool

// Sketch 2: 128-bit integer
type Uint128 struct { Lo, Hi uint64 }
func CompareAndSwapUint128(addr *Uint128, old, new Uint128) bool
```

**Why it stalled:** portability concerns (32-bit platforms, RISC-V, older ARMv7), and a
competing design that pushes the use case toward `sync.Map` or higher-level primitives. The
committee has not declined it but has not moved toward acceptance.

**Related issues:**

- [#56102](https://go.dev/issue/56102) — atomic.Pointer typed atomic for pairs (declined as
  too specific).
- [#52623](https://go.dev/issue/52623) — atomic 128-bit operations on amd64 (declined as
  platform-specific).
- [#50860](https://go.dev/issue/50860) — the umbrella issue.

---

## Automatic GOMAXPROCS — issue #33803, #73193

**Status:** proposed, discussion ongoing as of Go 1.24. Likely to land in Go 1.25 or 1.26.

**Summary:** read the cgroup v2 `cpu.max` (or cgroup v1 `cpu.cfs_quota_us`/`cpu.cfs_period_us`)
at startup and set `GOMAXPROCS` to the quota, rounded up. The current default reads
`runtime.NumCPU()` which on Kubernetes nodes returns the host's logical CPU count — often 64 or
128 — even when the container has a 1-CPU limit, causing massive scheduler thrash.

**Behavior under the proposal:**

1. At runtime initialization, probe `/sys/fs/cgroup/cpu.max` (cgroup v2).
2. If absent, probe `/sys/fs/cgroup/cpu/cpu.cfs_quota_us` and `cpu.cfs_period_us` (cgroup v1).
3. If quota is unbounded (`max` in v2, `-1` in v1), fall back to `runtime.NumCPU()`.
4. Otherwise, compute `ceil(quota / period)`, clamp to at least 1, and set as default
   `GOMAXPROCS`.

**Override behavior:** an explicit `GOMAXPROCS` environment variable wins over the cgroup
detection. An explicit `runtime.GOMAXPROCS(N)` call also wins. The proposal preserves all
existing escape hatches.

**Outlook:** Uber's `automaxprocs` library has been the de-facto polyfill since 2017. The
proposal is essentially "fold automaxprocs into the runtime." The remaining design question
is whether to read cgroup quota only at startup (current automaxprocs behavior) or to watch the
cgroup files for changes (more complex but supports dynamic CPU limit changes).

---

## Goroutine-local storage — issue #21355

**Status:** **declined** repeatedly, but discussion keeps reopening. The committee's position:
explicit `context.Context` is the Go way; GLS encourages thread-local globals that hide
dependencies.

**Summary:** add a `runtime.GoroutineLocal` or similar API to attach key/value pairs to a
goroutine that descendants automatically inherit. Motivated by request-id propagation,
OpenTelemetry, and structured logging.

**Decline rationale** (extracted from committee comments):

1. **Hidden state.** GLS hides dependencies. Reading a function does not tell you that it
   depends on a request-id set by an ancestor.
2. **Goroutine boundary ambiguity.** Should child goroutines inherit GLS? Yes leads to leaks;
   no breaks common patterns.
3. **Existing alternative.** `context.Context` does the same thing, explicitly. The verbosity
   of threading it is a feature, not a bug.

**Profiling-only labels are accepted:** `runtime/pprof.Labels` and `pprof.Do` attach
goroutine-local labels for profiler use only. Application code cannot read them. This is
considered the maximum acceptable surface for "goroutine-local data" in Go.

**Outlook:** unlikely to land in any form. The de-facto answer remains `context.Context` plus,
for libraries that cannot thread context, `runtime/pprof.Labels` for diagnostics only.

---

## Structured concurrency — issues #40221, #61888

**Status:** discussion, **no formal proposal accepted**. Several sketches exist; none has
consensus.

**Summary:** add a primitive where a parent goroutine block waits for all children launched
inside it to finish before returning. Inspired by Trio's nurseries and Kotlin's
`coroutineScope`. Proposed syntax has ranged from `go group { ... }` blocks to a library API
like:

```go
var g concurrency.Group
g.Go(func() { ... })
g.Go(func() { ... })
g.Wait() // implicit at end of scope
```

**Why language-level structured concurrency is unlikely:**

1. The `errgroup` package covers most production needs.
2. Adding a new keyword (`group`, `scope`, etc.) has a very high bar.
3. The trade-offs around panic propagation, cancellation, and error aggregation are subtle and
   the committee has not seen a design that handles all three cleanly.

**Why library-level is possible:** promoting `errgroup` to `sync.Group` or similar is a small
change. The main blocker is bikeshedding on the API shape — should it return the first error,
all errors, or panic on the first? Should the wait be implicit (defer-based) or explicit?

**Outlook:** unlikely as syntax; possible as a stdlib `sync.Group` or `errgroup` promotion.

---

## Cross-cutting: the Go memory model and these proposals

None of these proposals changes the [Go memory model](https://go.dev/ref/mem) itself.

- `weak.Pointer.Value()` is documented as a "synchronizing read" — a happens-before edge with
  the GC marker — but does not introduce a new ordering primitive.
- `synctest` does not relax the memory model; it just controls when time advances.
- Coroutines via `iter.Pull` run on the calling goroutine's M, so all memory operations are
  sequenced from the goroutine's point of view. There is no inter-coroutine synchronization
  because there's no concurrency between a coroutine and its caller — they alternate.
- `runtime.AddCleanup` adds happens-before edges from the cleanup site to the function that
  references the object, similar to `SetFinalizer`.

The Go memory model has been stable since Go 1.19 (when typed atomics were added). The
committee's stated position is that the memory model is "done" — major future changes are not
on the roadmap.

---

## Notes on reading the proposal documents directly

The Go proposal process produces three artifacts:

1. **Design doc** (Markdown in `golang/proposal` repo, e.g. `design/67434-synctest.md`).
   The most detailed source.
2. **Issue thread** (on `golang/go`). Where discussion happens. The most current source.
3. **Release notes** (on `go.dev/doc/go1.24` and similar). The most authoritative source for
   what shipped.

When citing a feature in production code or documentation, prefer the release notes for what
landed and the design doc for the rationale. The issue thread is invaluable but contains
hundreds of comments, not all of which reflect the final design.

A common reading pattern: skim the design doc to understand the API and rationale, then jump
to the most recent committee comments in the issue thread to see the current status. Skip the
hundreds of community comments unless you specifically want a survey of objections.
