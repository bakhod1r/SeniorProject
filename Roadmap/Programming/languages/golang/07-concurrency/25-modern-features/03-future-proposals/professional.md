---
layout: default
title: Future Proposals — Professional
parent: Future Concurrency Proposals
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/professional/
---

# Future Proposals — Professional

[← Back](../)

A professional Go engineer treats future proposals as a portfolio. Some are bets you make now
(write polyfills, leave clear migration paths) because the win is large and the risk of the
proposal changing is low. Some are bets you decline (wait for stable, do not pre-adopt
experimental APIs) because the risk of churn outweighs the gain.

This page walks through each upcoming feature from that risk-vs-reward angle: what would you
change in production code today, what would you only sketch in a feature branch, what would you
ignore until further notice.

The framing throughout is **codebase migration**: not "is this feature cool?" but "what is the
cheapest path to a codebase that uses this feature where it helps, and remains correct where it
doesn't?". Cheapness includes engineering hours, regression risk, on-call risk, and the cost of
training future engineers to read the resulting code.

---

## testing/synctest — adopt aggressively in tests, never in production

`testing/synctest` ships in Go 1.24 behind `GOEXPERIMENT=synctest` and is expected to graduate
in Go 1.25. The risk profile is exceptionally favorable: it's a **test-only** package, so any
breakage affects your CI signal, not your production binary. The win is large: deterministic
tests for retry loops, backoff timers, deadline propagation, and ticker-driven loops, all in
microseconds of wall time.

What to do today, on Go 1.24:

1. Add a `//go:build goexperiment.synctest` build tag to a separate test file. Keep the
   original real-time test alongside it during the transition.
2. Set `GOEXPERIMENT=synctest` in your CI environment for that build tag.
3. Refactor flaky timing tests one at a time, deleting the real-time version once the synctest
   version is stable.

What **not** to do: do not write synctest as the only test for code that interacts with the OS
scheduler (e.g. `runtime.Gosched`, real network I/O). Synctest cannot model real I/O, and a
passing synctest test does not prove the code works against real timing.

A pragmatic team adopts synctest the same way they adopted `t.Parallel()` — gradually, file by
file, with a `make lint` rule that flags new `time.Sleep` in tests.

### CI integration sketch

Your `go test` invocation in CI gains an environment variable:

```bash
GOEXPERIMENT=synctest go test ./...
```

This sets the build tag globally. Tests that don't use synctest are unaffected. Tests guarded
by `//go:build goexperiment.synctest` only compile when this is set, so a developer running
`go test` locally without the env var will skip those files entirely. That's fine for local
iteration; the CI ensures the synctest tests actually run.

A reasonable migration policy: for each PR that touches timing-sensitive code, require either a
synctest test or an explicit comment explaining why real-time is necessary. This is the kind of
rule a senior engineer adds once and then enforces in code review.

### What synctest does not cover

- **Real I/O.** Discussed above. Mock it.
- **Race detection.** Synctest is orthogonal to `-race`. You still want to run with `-race` to
  catch data races that synctest's determinism would not expose.
- **Memory pressure tests.** Synctest does not control GC. If your test depends on the GC
  running at a specific moment, you need `runtime.GC()` explicitly.
- **Real wall-clock tests.** If you genuinely need to know whether a code path completes within
  a real 100ms, you cannot use synctest. Keep a small set of real-time tests for these
  scenarios.

The goal is not 100% synctest adoption. The goal is to get the deterministic test for code that
should be timing-independent, while leaving real-time tests for the small set that genuinely
isn't.

---

## iter.Pull and coroutines — write code that works either way

`iter.Pull` shipped in Go 1.23 and is stable. The underlying coroutine mechanism is internal.
The likelihood of `runtime.coro` becoming a public API in the next two Go versions is low; the
Go team's stated preference is to see whether iterators alone justify it.

How to use this in production today:

- For serial generators (parsers, tree walks, paginators), prefer `iter.Pull` over `goroutine +
  channel`. The performance win is 5-10x per step.
- For parallel work, **do not** misuse `iter.Pull` — the `next` function is single-goroutine.
  Keep using goroutines and channels.
- Document iterator contracts: state explicitly whether they are safe to consume from multiple
  goroutines.

Forward-looking code shape: write your APIs as `iter.Seq[T]` push iterators. They are equally
useful to a `range` consumer or to a `Pull` consumer. If the runtime later exports a user
coroutine API, your iterator code will not need to change.

### The migration from channels to iterators

Many production codebases have a layer of APIs that return `<-chan T`. The classic example:

```go
func Walk(root *Tree) <-chan *Node {
    ch := make(chan *Node)
    go func() {
        defer close(ch)
        walk(root, ch)
    }()
    return ch
}
```

This is fine but has problems:

- If the consumer breaks out of the range, the producer goroutine leaks until it tries to send
  to the closed channel. (Or you can wire a `done` channel, adding complexity.)
- Per-element overhead is ~150ns from the channel hop.
- The goroutine is opaque to debugging — its stack trace blames the closure, not the caller.

The iterator-based equivalent:

```go
func Walk(root *Tree) iter.Seq[*Node] {
    return func(yield func(*Node) bool) {
        walk(root, yield)
    }
}

func walk(n *Tree, yield func(*Node) bool) bool {
    if n == nil {
        return true
    }
    if !yield(n) {
        return false
    }
    if !walk(n.Left, yield) {
        return false
    }
    return walk(n.Right, yield)
}
```

No goroutine, no channel, no leak. Consumer break is just `yield` returning false. The per-
element overhead is a function call.

For an existing codebase, the migration is mechanical but invasive: every call site that ranges
over the channel changes to range over the iterator. APIs that mix the two during the
transition can adapt:

```go
func WalkChan(root *Tree) <-chan *Node {
    ch := make(chan *Node)
    go func() {
        defer close(ch)
        for n := range Walk(root) {
            ch <- n
        }
    }()
    return ch
}
```

This wraps the iterator in a channel-compatible API for legacy consumers, while internal code
uses the iterator directly.

### When iterators are wrong

Not every API benefits from iterators. Specifically:

- **Network streams.** A network read is inherently blocking, and a goroutine + channel
  provides a natural concurrency boundary. Trying to wrap it in an iterator forces the consumer
  to deal with blocking reads in their own goroutine, with no help from the iterator
  abstraction.
- **Fan-out producers.** If one producer feeds many consumers, channels broadcast naturally;
  iterators do not.
- **Push-style notifications.** Events that the producer wants to push without consumer
  cooperation are channels, not iterators.

Use iterators for "here is a sequence I will compute on demand for you". Use channels for "here
is a stream of independent events".

---

## weak.Pointer — adopt for identity caches, audit existing patterns

`weak.Pointer` is the cleanest of the Go 1.24 additions. It directly enables patterns that were
ugly or impossible before:

- **String interning / canonicalization**: a map from byte content to canonical `*String` where
  dead entries vanish automatically.
- **Object identity caches**: a per-object map of expensive derived values (parsed AST, decoded
  thumbnail) keyed by identity rather than by content hash.
- **Observers without leaks**: register a callback with a weak reference to the observer; when
  the observer is collected, the registration becomes inert.

The migration question is "do I have caches that grow unboundedly?" If yes, audit them. A
`sync.Map` keyed by `*Object` keeps every `Object` alive. Replacing with `weak.Pointer[Object]`
lets the GC reclaim them, often saving substantial memory. The race detector treats `Value()`
as a synchronizing read; existing code with non-atomic access to the cached pointer needs no
changes.

What to avoid: do not use `weak.Pointer` as a sloppy workaround for lifetime bugs. If you don't
know when an object should be collected, weak references will not fix that — they will just
make the bug intermittent.

### Audit checklist

Walk through these in your codebase:

1. **Caches with manual size limits.** A `map[K]*V` paired with an LRU eviction is a candidate
   for `weak.Pointer[V]`. The LRU's job becomes "keep the N most recent strongly referenced"
   while the GC handles the rest.
2. **Connection pools that retain idle connections.** If you have a slice of `*Conn` waiting to
   be checked out, weak pointers let you discard idle ones under memory pressure.
3. **Listener / observer registries.** A `map[Source][]*Observer` retains observers forever. A
   `map[Source][]weak.Pointer[Observer]` lets observers be collected; you sweep dead entries
   during emit.

The audit takes a day or two for a medium-sized codebase. The memory savings vary wildly. Some
services see no difference (their working set was already bounded). Some see 30-60% reductions
(they had unbounded caches they did not realize).

### Pitfalls of incorrect adoption

1. **Weakening a primary reference.** If `weak.Pointer[T]` is the **only** reference to `T`,
   `T` will be collected on the next GC. The cache will always be empty. Weak references are a
   complement to strong references, not a replacement.
2. **Weak pointers in long-lived maps.** A `sync.Map` of weak pointers grows unboundedly with
   dead entries. You need a cleanup hook (see `runtime.AddCleanup`) to remove them.
3. **Confusing weak and strong semantics in concurrent code.** A second goroutine reading the
   weak pointer may see nil at any moment. If the first goroutine assumed the pointer was
   stable, the contract breaks.

### Use case I've seen succeed: per-request caches

A web service that processes complex queries often computes intermediate results (parsed
filters, compiled regexes, prepared SQL). If two requests share a key, both should reuse the
intermediate result. Once neither request is in flight, the result can be discarded.

```go
type Cache struct {
    mu  sync.Mutex
    m   map[string]weak.Pointer[Compiled]
}

func (c *Cache) Get(query string) *Compiled {
    c.mu.Lock()
    defer c.mu.Unlock()
    if wp, ok := c.m[query]; ok {
        if p := wp.Value(); p != nil {
            return p
        }
    }
    p := compile(query)
    c.m[query] = weak.Make(p)
    runtime.AddCleanup(p, func(k string) {
        c.mu.Lock()
        defer c.mu.Unlock()
        delete(c.m, k)
    }, query)
    return p
}
```

Each call returns a `*Compiled` for that query. As long as some in-flight request holds the
pointer, future callers reuse it. Once no request holds it, the GC collects it and the cleanup
removes the map entry.

---

## runtime.AddCleanup — migrate SetFinalizer code

Every `runtime.SetFinalizer` site in your codebase is a candidate for `runtime.AddCleanup`.
The migration is mechanical: change the call, and capture only the resource (not the parent
object) in the closure. Benefits:

- No accidental resurrection (the cleanup does not see the about-to-be-collected pointer).
- Multiple cleanups per object (useful for objects holding multiple resources).
- Better parallelism (cleanup goroutine pool vs the single finalizer goroutine).

The migration risk is low because both APIs coexist in Go 1.24+. Migrate one package at a time,
run your full integration test suite, watch for regressions in memory pressure.

What about cleanup ordering? `SetFinalizer` and `AddCleanup` on the same object run in
unspecified order. The Go 1.24 release notes recommend not mixing them. If you have multi-step
cleanup (close a file, then remove a temp directory), express the order as nested cleanups: the
outer object's cleanup performs the second step, an inner object's cleanup performs the first.

### Mechanical migration recipe

For each `runtime.SetFinalizer(ptr, fn)` site:

1. Identify what `fn` actually does. It probably calls a method on `ptr` (e.g.
   `func(p *T) { p.Close() }`).
2. Identify what resource the method actually closes. Usually a file, socket, or memory
   region.
3. Rewrite as `runtime.AddCleanup(ptr, func(r Resource) { r.Close() }, ptr.resource)`.

The mechanical transformation captures the resource as a value, never the parent. The compiler
will not catch a wrong transformation, so write a unit test that exercises the cleanup path
(use `runtime.GC()` and `runtime.SetFinalizer`-style detection).

### When SetFinalizer is still right

There is one case where `SetFinalizer` is still legitimate: setting it to nil to cancel a
finalizer. The equivalent for `AddCleanup` is calling `cleanup.Stop()`. If you have legacy code
that relies on the cancellation behavior, the migration still works — store the `Cleanup` value
and call `Stop()` instead of `SetFinalizer(ptr, nil)`.

---

## Atomic vector ops — write the polyfill once, mark for migration

Proposal [#50860](https://go.dev/issue/50860) is on hold. If you have an ABA-resistant pointer
in your codebase today, you have already solved it with one of:

- A mutex around the load/store (correct, lock-free lost).
- A versioned pointer where the version is in the low bits of an aligned pointer (works for
  8-byte-aligned objects, gives you ~57 generation bits).
- A hazard-pointer scheme (correct, complex).

The professional move: pick the simplest correct option (usually the mutex), encapsulate it
behind a `TaggedPointer[T]` type, and add a comment pointing to issue #50860. If the proposal
lands, swap the implementation in one place.

```go
// TaggedPointer is an ABA-resistant pointer. The current implementation
// uses a mutex; if golang/go#50860 lands, swap to atomic 128-bit CAS.
type TaggedPointer[T any] struct {
    mu  sync.Mutex
    ptr *T
    gen uint64
}
```

This idiom lets the team's lock-free experts work on the higher-level data structure while the
primitive itself is ready to be upgraded. The performance loss from the mutex is usually
acceptable because lock-free data structures typically have low contention by design.

### Honest assessment: do you need this?

Most production Go code does **not** need ABA-resistant pointers. The Go GC tracks every heap
allocation, so the "pointer recycled to a different object" scenario does not happen for GC-
managed memory. The classic ABA arises in C/C++ freelists where the allocator hands back the
same address.

If you have an ABA window, it's most likely in:

- Code that uses `unsafe.Pointer` to point into a custom arena.
- Code that does its own object recycling (e.g. a memory pool).
- Code ported from a C++ lock-free library that assumes manual memory management.

In any of these cases, a code review with a senior engineer is warranted before adding atomic
primitives. Often, the simpler fix is to drop the custom recycling and let the GC handle it.

---

## Automatic GOMAXPROCS — adopt automaxprocs now, expect runtime to absorb it

Today: import `go.uber.org/automaxprocs` as a side-effect import in `main.go`. Six years of
production use across many large Go shops have ironed out the bugs.

Tomorrow: when issue [#33803](https://go.dev/issue/33803) or
[#73193](https://go.dev/issue/73193) lands, you can drop the dependency without a code change.
The library and the runtime use the same logic, so behavior is the same.

What to watch out for: services that explicitly set `GOMAXPROCS` to a specific number (e.g.
for benchmarking) override the auto-detection. Make sure your benchmark harness sets it
explicitly, not your production binary.

### Why this is the single highest-leverage change

For Go services on Kubernetes, this is often the single biggest production improvement you can
make. Anecdotes from real services:

- A 100m-CPU sidecar where CPU usage dropped 60% after adding automaxprocs.
- A 500m-CPU API server where P99 latency dropped from 80ms to 25ms because the scheduler
  stopped thrashing.
- A 2-CPU batch job where wall-clock time dropped 30% because the GC stopped trying to use 32
  worker threads on 2 cores.

The downside is none. The library's fallback behavior (use `NumCPU` when cgroup files are
missing) is exactly what the runtime does today. Services that don't run in containers see no
change.

### Init order considerations

`automaxprocs` calls `runtime.GOMAXPROCS` in its `init()` function. If your code reads
`runtime.GOMAXPROCS(0)` in another package's init, you have an init-order dependency: if your
package initializes first, you see the wrong value.

The fix is to defer the read until after `main` starts:

```go
var (
    workersOnce sync.Once
    workers     int
)

func numWorkers() int {
    workersOnce.Do(func() {
        workers = runtime.GOMAXPROCS(0)
    })
    return workers
}
```

This pattern is also more correct because `GOMAXPROCS` can change at runtime (some operators
adjust it dynamically).

---

## Goroutine-local storage — do not adopt anything

GLS proposals have been declined repeatedly. Production codebases that emulate GLS (scraping
goroutine IDs from `runtime.Stack`, using `unsafe.Pointer` tricks) are technical debt — they
break on Go upgrades and are hard to audit. The professional move is to refuse to introduce or
maintain them.

What if you inherit a codebase that uses such a hack? Migrate it to `context.Context`. Yes, it
means threading `ctx` through every function. The compile-time errors when you remove the GLS
dependency will tell you exactly which functions are missing it. This is a one-week refactor
for most services, and the resulting code is easier for new engineers to read.

### How GLS hacks fail

A common GLS hack scrapes the goroutine ID from `runtime.Stack` output:

```go
func goID() int64 {
    b := make([]byte, 64)
    b = b[:runtime.Stack(b, false)]
    // parse "goroutine 12345 [running]:" prefix
    ...
}
```

This is slow (allocates, runs string parsing) and unstable (the format of `runtime.Stack`
output is not part of the Go 1 compatibility promise — though it hasn't changed in practice).

Worse, goroutine IDs are reused. When a goroutine exits, its ID is returned to a pool. A new
goroutine may get the same ID. If a library stores `map[goroutineID]Context`, the new
goroutine reads stale context.

I've seen production codebases bitten by this bug. The fix was a multi-week migration to
explicit context threading. The cost was paid once, and the resulting code stopped having
"why is this request seeing another request's logs" mysteries.

---

## Structured concurrency — use errgroup, do not invent your own

Issues [#40221](https://go.dev/issue/40221) and [#61888](https://go.dev/issue/61888) discuss
language-level structured concurrency, but no consensus exists. The committee's position is
that `errgroup.Group` covers 95% of the use case. Your production rule: every place where you
launch goroutines should have an `errgroup.WithContext`-style owner that waits and propagates
errors. Make this a code review rule.

The bad pattern to refactor away from: `go func() { ... }()` calls scattered in a handler with
no `Wait`. Even if you "know" they will finish quickly, you have no mechanism to abort them on
shutdown, no error propagation, no observability. Wrap them in an errgroup.

If a future Go version adds language-level structured concurrency, your `errgroup` code is the
closest possible analog and will migrate cleanly.

### Code review rule

Add this to your team's review checklist:

> Every `go` statement must be inside an `errgroup.Group.Go` call, a worker pool with a
> documented lifetime, or a clearly named "background" function with shutdown handling.

The rule has three categories instead of one because there are legitimate cases for non-
errgroup goroutines:

1. **errgroup** for request-scoped concurrency (the most common case).
2. **Worker pool** for long-lived background work (e.g. a queue consumer).
3. **Named background goroutine** for one-of-a-kind tasks (e.g. the program's main scheduler),
   with explicit lifetime management.

`go func() { logSomething() }()` in a handler matches none of these and is the antipattern. The
review rule catches it without prohibiting legitimate concurrency.

### What language-level structured concurrency would add

If the committee accepted sketch 1 (a `go group { ... }` block), the migration from errgroup
would be:

```go
// Today
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })
if err := g.Wait(); err != nil { return err }
```

```go
// Hypothetical future
go group {
    go fetchA(ctx)
    go fetchB(ctx)
} // implicit wait + first-error
```

The conceptual structure is the same. The migration would be a syntax change, not a redesign.
Code that uses errgroup today is already "structured concurrency by convention" and will
translate one-to-one.

---

## Migration checklist for Go 1.24+

A concrete checklist for upgrading a production codebase to Go 1.24, leveraging the new
concurrency-adjacent features:

1. Replace `go.uber.org/automaxprocs` with a comment noting the future runtime-native version.
2. Audit `runtime.SetFinalizer` call sites; migrate the ones that need multiple cleanups to
   `runtime.AddCleanup`.
3. Audit unbounded identity-keyed caches; consider `weak.Pointer` replacements.
4. Add `testing/synctest` to your CI environment with the experiment flag.
5. Refactor at least one flaky timing test to use synctest as a proof of concept.
6. Replace serial `goroutine + channel` generators with `iter.Pull` where the per-step latency
   matters.
7. Document anywhere you depend on the current `runtime.coro` internals (you should not).

For each item, estimate the engineering cost and the expected return:

| Item | Cost | Return | Priority |
|---|---|---|---|
| automaxprocs | 1 line | 30-70% CPU reduction in containers | P0 |
| SetFinalizer → AddCleanup | 1 day per package | Better GC pause distribution | P2 |
| Unbounded cache audit | 2-5 days | Variable memory savings | P1 |
| Synctest in CI | Half a day | Better CI determinism | P1 |
| Synctest first test | Half a day | Proof of concept | P2 |
| Channel → iter migration | 1 week+ | 5-10x per-step speedup | P3 |

P0 items pay for themselves immediately. P3 items are quality-of-life improvements for hot
paths.

---

## How to track Go concurrency proposals

Practical sources for staying current:

- **golang/go issue tracker, label "Proposal"**: filter by `comments:50..` to find the active
  proposals worth reading.
- **Russ Cox blog (research.swtch.com)**: long-form posts that explain proposal rationale
  better than the issue threads.
- **The Go proposal review minutes**, published as `golang.org/issue/...` discussion comments
  by the committee.
- **Conferences (GopherCon, dotGo)**: most stable features are presented before they ship.

A team that reads one proposal a week stays ahead of the migration curve. A team that waits for
"Go 2" or "the next big release" is always retroactively migrating.

### Building team knowledge

A practice that works well: assign a different engineer each week to summarize one new or
active concurrency proposal. The summary goes in a shared doc — five bullet points: what does
it do, why is it being proposed, what's the status, what's the migration impact, what's our
position. Over a year, the team builds a shared reference covering 50 proposals.

The byproduct is that everyone on the team has read at least a few proposals in detail. When a
new feature ships, the team is not surprised, and someone already understands the design.

---

## Common professional mistakes around future-proofing

1. **Pre-adopting experimental APIs in production code.** Synctest is experimental in 1.24. If
   you write production code that imports it (you cannot, but the equivalent for other
   experimental APIs), you take on the risk of a breaking change. Wait for stable.

2. **Writing polyfills that hide future migration.** A `weakref.Ref[T]` polyfill that wraps
   `sync.Map` plus finalizers does not behave like the real `weak.Pointer`. When you migrate,
   behavior changes subtly (objects become collectable). Either write a polyfill with the
   exact semantics you want, or wait.

3. **Refusing to use `errgroup` because "structured concurrency might come later."** Don't
   write defensive code against language changes that may never happen. Use the best current
   idiom and migrate when the language gives you something better.

4. **Optimizing for `runtime.GOMAXPROCS = NumCPU` assumptions.** Code that assumes
   Hyperthreaded core count, NUMA topology, or specific scheduler behavior will break when the
   runtime adds auto-detection. Stay flexible: read `runtime.GOMAXPROCS(0)` at runtime, not at
   init.

5. **Building goroutine pools to "save scheduler cost."** The Go scheduler is fast. Most
   goroutine pools in production benchmarks are slower than just spawning goroutines, because
   the pool adds a channel hop. The future proposals do not change this — they make goroutines
   cheaper, not pools more useful.

6. **Using `runtime.Gosched` to "encourage scheduling."** This is almost always wrong. The
   scheduler is preemptive (since Go 1.14). Manual `Gosched` calls do nothing useful and add
   noise. Future proposals do not change this — the scheduler will not become less effective.

7. **Assuming proposals will land in the next release.** Some have been "likely accept" for
   years. Don't bet a feature on a specific Go version unless it's already shipping.

8. **Writing one-off polyfills for code that already has a stable alternative.** If
   `errgroup` works, don't write your own `Group` waiting for the standard library version.
   The standard library `Group`, if it ever exists, will look like `errgroup`. Use the
   library.

---

## Designing APIs that age well across Go versions

A few design principles for code that will outlive several Go versions:

1. **Accept `context.Context` as the first parameter** of any function that does I/O or that
   may take more than a millisecond. This is a Go 1 idiom that is not going to change.

2. **Return iterators (`iter.Seq[T]`)** for new APIs that produce sequences. If you are on a
   Go version before 1.23, document the intent and use a callback for now.

3. **Use `errgroup.WithContext`** for fan-out concurrency. If a future feature replaces it, the
   migration is mechanical.

4. **Avoid `runtime.SetFinalizer`** in new code. Use `runtime.AddCleanup` if you're on Go 1.24
   or later, otherwise use explicit `Close()` patterns.

5. **Avoid `sync.Map` for identity-keyed caches**. Use `weak.Pointer` if you're on Go 1.24 or
   later, otherwise document the unboundedness and use an LRU.

6. **Avoid goroutine-local storage emulations.** Pass `context.Context`.

7. **Avoid worker pools as a default.** A function that spawns one goroutine per task is
   usually correct and easier to reason about. Reach for a pool only when you have measured the
   overhead.

These principles compose into a coding style that survives several Go versions without major
refactoring. New engineers joining the team in 2027 should be able to read the codebase
without confusion from outdated patterns.

---

## A final thought on speculation

Most of this content speculates about features that may or may not land. Treat the speculation
as a default, not a commitment. The Go committee changes its mind, and so should you. When a
new release ships, re-read the release notes carefully, and update your team's playbook.

The professional summary: read the proposals, adopt the stable ones, polyfill the high-value
ones, ignore the unlikely ones. Time-box decisions: "we will revisit this proposal in Go
1.26" is a fine answer. Build a habit of re-reading the proposal list once per quarter and
updating your priorities. The codebases that age best are the ones whose maintainers stay
slightly ahead of the language without ever betting the codebase on a particular outcome.
