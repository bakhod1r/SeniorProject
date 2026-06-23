# Futures & Promises — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus three live-coding prompts, a concept-check list, and signals interviewers grade on. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim and re-read only the ones you stumbled on. Type the live-coding solutions out at least once. Futures in Go are unusual because the language gives you no `Future` keyword — the pattern lives across four idiomatic shapes (channel, struct, `errgroup`, `singleflight`). Describing all four with trade-offs is what separates senior from junior.

---

## 2. Junior questions (Q1–Q7)

### Q1. What is a Future, and what is a Promise?

**Short answer:** A **Future** is the read-side handle to a value that does not exist yet — it will eventually hold a result or an error, and the consumer can wait for it. A **Promise** is the write-side handle to the same underlying slot — the producer calls `Resolve(value)` or `Reject(error)` exactly once. In Go the two roles are usually combined into one struct, but the distinction matters at API design: who fulfils, who only reads.

**Follow-up:** Does Go have a built-in Future type? Answer: no. Go offers channels, `sync.Once`, `context.Context` — you compose a Future from them. `errgroup.Group` and `singleflight.Group` are the closest stdlib-adjacent shapes. The omission is intentional; Go prefers composable primitives over named patterns.

---

### Q2. How does a Future differ from a regular blocking function call?

**Short answer:** A blocking call holds the caller's goroutine until the result is ready; computation and waiting happen on the same line. A Future splits the two: work starts (or is registered) at one point, the wait happens later — possibly never, possibly with a deadline, possibly in parallel with other work. The benefit is **overlap**: launch three Futures, await all three, wall-clock is `max(t1, t2, t3)` instead of the sum. The cost is the goroutine and the cancellation/leak/panic reasoning that a synchronous call hides.

**Follow-up:** When is a Future worse than a blocking call? Answer: when work is fast, sequential, or has nothing to overlap with. Wrapping a 1 ms computation in a Future adds goroutine and channel overhead for no gain. Use Futures when you have at least two units that can run concurrently and at least one has real latency.

---

### Q3. Write the minimal Future shape in Go using a channel.

**Short answer:**

```go
func fetchUser(id string) <-chan User {
    out := make(chan User, 1) // buffered so producer never blocks
    go func() {
        u := doFetch(id) // real work
        out <- u
        close(out)
    }()
    return out
}

// Caller:
userFuture := fetchUser("alice")
// ... do other work ...
u := <-userFuture // await
```

Receive-only channel is the Future; goroutine is the producer. Buffer 1 keeps the producer unblocked if the consumer is slow.

**Follow-up:** What about errors? Answer: send a `Result{ Val T; Err error }` struct over one channel — keeps value and error inseparable on the wire.

---

### Q4. What is the difference between a Future and a Promise in your own code?

**Short answer:** In Go you usually see one struct with three methods — `Resolve`, `Reject`, `Await`. The Future role holds the read end (`Await`); the Promise role holds the write end (`Resolve`/`Reject`). You can enforce the split by returning two interfaces from one constructor:

```go
type Promise[T any] interface { Resolve(T); Reject(error) }
type Future[T any]  interface { Await(context.Context) (T, error) }
```

`NewPromise[T]() (Promise[T], Future[T])` hands out two views over the same state. Prevents a consumer from accidentally resolving what it should only read.

**Follow-up:** Why distinguish? Answer: API safety. Same discipline as returning `<-chan T` instead of `chan T`.

---

### Q5. What does "resolve" mean and what does "reject" mean? Can both happen?

**Short answer:** **Resolve** completes the Future with a value. **Reject** completes it with an error. They are mutually exclusive — a Future has exactly one outcome. Calling `Resolve` after `Reject` (or vice versa) on the same Future is a bug. In Go we guard against this with `sync.Once`:

```go
func (f *Future[T]) Resolve(v T) {
    f.once.Do(func() { f.val = v; close(f.done) })
}
func (f *Future[T]) Reject(err error) {
    f.once.Do(func() { f.err = err; close(f.done) })
}
```

Without `sync.Once`, double-fulfilment closes an already-closed channel and panics. With it, the first call wins; the rest are no-ops.

**Follow-up:** What if Resolve and Reject race from two goroutines? Answer: `sync.Once` makes one win atomically; the other is a no-op. Application-level racy, runtime-level safe — design should give the promise to exactly one producer.

---

### Q6. Where does the Future pattern appear in the Go standard library or x/sync?

**Short answer:** Several places, each a different shape of the same idea.

- **`<-chan T` returned from a function** — the ubiquitous Future shape.
- **`golang.org/x/sync/errgroup`** — N goroutines under one context; `Wait()` is the await; first error cancels.
- **`golang.org/x/sync/singleflight`** — deduplication: many callers, one in-flight result.
- **`sync.WaitGroup.Wait()`** — Future for "all producers done", resolving to nothing.
- **`context.Context.Done()`** — degenerate Future for cancellation.

**Follow-up:** Why no named `Future[T]` in stdlib? Answer: Go prefers small composable primitives over named higher-level patterns. Channels + goroutines + `context` build any Future shape in 30 lines. Cost: every team writes their own. Benefit: every team's Future fits their exact use case.

---

### Q7. Eager vs lazy Futures — what is the difference?

**Short answer:** **Eager** starts work immediately at construction; the goroutine spawns the moment you call `Go(fn)`. **Lazy** does nothing until `Await` is called; the function is held as a value and executed on first await. Eager wastes work if no one awaits; lazy adds a hop of latency at await time. Use eager when work has latency to overlap (network, disk); use lazy when the value might never be needed (caching, fallback chains).

**Follow-up:** Two goroutines await the same lazy Future — what happens? Answer: `sync.Once` inside `Await` runs the function exactly once; both see the same result. `Once.Do(fn)` *is* a lazy Future of `func()`.

---

## 3. Middle questions (Q8–Q15)

### Q8. Why do you need `sync.Once` inside a Promise's Resolve/Reject?

**Short answer:** To prevent double-fulfilment. The "done" signal is `close(done)` on a `chan struct{}`; closing twice panics. Two goroutines calling `Resolve`, or one calling `Resolve` and another `Reject`, would crash without coordination. `sync.Once` makes the first call win and turns subsequent ones into no-ops. It also makes `val` and `err` writes happen-before the channel close — readers after `<-done` see consistent state.

**Follow-up:** Could you use `atomic.CompareAndSwap`? Answer: yes, with care. CAS gates the write but you still need a memory barrier to publish `val`/`err` before the close. `sync.Once.Do` bundles both via its internal mutex. `atomic.Pointer[Result]` is another option — swap the whole result pointer, no done channel needed. `Once` is the shortest.

---

### Q9. How do you thread `context.Context` through a Future?

**Short answer:** Two places. (1) The producer accepts `ctx` and respects `ctx.Done()`, so a cancelled context aborts the work. (2) The consumer's `Await(ctx)` selects on both the Future's done channel and `ctx.Done()`, so the consumer can give up without waiting forever.

```go
func (f *Future[T]) Await(ctx context.Context) (T, error) {
    select {
    case <-f.done:
        return f.val, f.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

Producer and consumer contexts can be different. A consumer may give up while the producer keeps running and resolves into a Future no one awaits (fine — GC'd). Or a parent cancels both. Pick the topology consciously.

**Follow-up:** Producer ignores `ctx`? Answer: consumer's `Await` returns on `ctx.Done()` but producer runs to natural completion — leak unless short-lived. Discipline: every long-running producer selects on `ctx.Done()` at every blocking call.

---

### Q10. Explain `errgroup.Group` semantics in detail.

**Short answer:** A Future of "all done, or first error". Use `WithContext` so the group has a derived cancellable context, launch via `g.Go(fn)`, await via `g.Wait()`. Key semantics: `Wait` returns first non-nil error or nil; first error cancels the group context; subsequent errors are dropped; `SetLimit(n)` bounds concurrency, `Go` blocks until a slot is free.

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(10)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
if err := g.Wait(); err != nil { /* first failure */ }
```

**Follow-up:** Best-effort fan-out? Answer: `errgroup` is wrong — it cancels on first error. Use `sync.WaitGroup` + mutex-protected error slice so all complete regardless. Common mismatch.

---

### Q11. What problem does `singleflight` solve and what is its Future shape?

**Short answer:** Deduplicates concurrent calls for the same key. 1000 goroutines call `Get("alice")` simultaneously; only one fetch runs; all share the result.

```go
var g singleflight.Group
v, err, shared := g.Do(key, func() (any, error) { return fetch(key) })
```

Used for cache stampede prevention, RPC memoization, deduplicating expensive validators. `shared` is for metrics, not correctness.

**Follow-up:** Failure mode? Answer: inner function's context. If A starts the flight with a short context and B waits longer, A's cancellation propagates to B. Use `DoChan` or detach via background context inside the function.

---

### Q12. When do you use a channel-shaped Future vs a struct-shaped Future?

**Short answer:** Channels when the consumer needs to `select` on the result alongside other signals (`ctx.Done()`, another channel, a timer). Structs when the consumer needs to hold the Future as a value, pass it around, attach combinators, or have multiple awaiters share one result. Many real codebases mix both: struct holds a channel internally, exposes `Done() <-chan struct{}` for `select` and `Await(ctx)` for ergonomic blocking with cancellation.

**Follow-up:** Multiple awaiters on a channel-shaped Future? Answer: only one receives a value sent over a capacity-1 channel; the rest block forever. Closed channels deliver zero to all receivers but you lose the actual value. The struct shape (`val` field + `chan struct{}` done) is strictly more powerful — why it dominates production code.

---

### Q13. How do you prevent goroutine leaks in Future-heavy code?

**Short answer:** Three rules. (1) Producer accepts a context and selects on `ctx.Done()` at every blocking call. (2) Channels written by the producer are buffered or owned — never send unbuffered to a channel the consumer may have abandoned. (3) Cleanup paths exist for "consumer gone" — if the producer cannot detect that, ensure work is short or bounded. Common leak: producer does `out <- result` to an unbuffered channel; consumer's `Await` returned on `ctx.Done()`; producer blocks forever. Fix: buffer the channel or select on `ctx.Done()` around the send.

**Follow-up:** Detect leaks in tests? Answer: `goleak` from Uber. `goleak.VerifyNone(t)` at test end fails on non-system goroutine survival. Adopt once, fix everything, catches what reviews miss.

---

### Q14. How do you propagate a panic from a Future producer to the awaiter?

**Short answer:** A panic in a goroutine crashes the whole program. Producer must `recover()` and convert to `Reject(err)`:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            f.Reject(fmt.Errorf("future panic: %v\n%s", r, debug.Stack()))
        }
    }()
    v, err := work()
    if err != nil { f.Reject(err) } else { f.Resolve(v) }
}()
```

Logging the stack at recovery is essential — otherwise you debug "future failed: nil map access" with no panic site.

**Follow-up:** Should the awaiter re-panic? Answer: usually no. Re-panicking moves the crash without fixing the bug. Log stack at recovery, return error, let the caller decide.

---

### Q15. How do you time-box a Future?

**Short answer:** Two patterns. **Context with timeout** kills both producer and consumer: `ctx, cancel := context.WithTimeout(parent, 5*time.Second); defer cancel(); future.Await(ctx)`. **Awaiter-side timeout** with `select { case r := <-future: ...; case <-time.After(5*time.Second): ... }` only the consumer gives up; producer keeps running. Prefer the first whenever the producer accepts context — only way to free producer resources. The second is a leak in waiting, acceptable only when the producer truly cannot be cancelled (e.g. C library ignoring signals).

**Follow-up:** `time.After` in a loop pitfall? Answer: every call leaks a fresh timer until expiry. Use `time.NewTimer` once outside the loop with `t.Reset(d)` each iteration, or `context.WithTimeout` with `defer cancel()`. Convenient at function scope, treacherous in loops.

---

## 4. Senior questions (Q16–Q22)

### Q16. Show a generic `Future[T]` and explain the design choices.

**Short answer:** See Live-Coding Prompt 1 for the implementation. Design choices: (1) generics over `any` to avoid boxing; (2) `sync.Once` for idempotent crash-safe fulfilment; (3) `Await(ctx)` so consumers can give up; (4) `Done()` exposed so callers can compose in their own `select`; (5) channel is `chan struct{}` not `chan T` — the channel signals readiness, the value lives in the struct, which lets multiple awaiters share one value.

**Follow-up:** Why expose `Done()` not the channel? Answer: receive-only `<-chan struct{}` prevents callers from accidentally closing it (panic on next `Resolve`). Same reasoning as `context.Context.Done()`.

---

### Q17. What is structured concurrency, and how do Futures fit?

**Short answer:** Structured concurrency is the rule that **every goroutine has a definite lifetime shorter than its parent's**. A goroutine launched inside a function must complete (or be cancelled) before that function returns. Benefits: no orphans, errors propagate cleanly, cancellation works end-to-end. In Go, `errgroup` is the closest stdlib expression: `g.Wait()` blocks the parent until every `g.Go(...)` returns. The mismatch with naive Futures: a "background" resolver outlives its caller's scope. Fix: bound work with a parent context and `Wait` before returning.

**Follow-up:** Impact of breaking structured concurrency? Answer: leaks, stale data, wrong cancellation. Classic bug — a request handler launches a "background" Future to update a cache, returns the response, the goroutine outlives the request and writes stale data. Kotlin (`coroutineScope`) and Python (`asyncio.TaskGroup`) enforce this at the language level; Go enforces by discipline.

---

### Q18. Design a distributed promise — a Future that resolves across process boundaries.

**Short answer:** You cannot send a goroutine over the network, so a distributed promise becomes a request-response with state. Five pieces.

1. **Promise ID** — a unique identifier the consumer holds.
2. **Resolution endpoint** — the producer service has an API to mark the promise resolved with value or error.
3. **State store** — a database row keyed by promise ID, storing pending/resolved/rejected state and the result.
4. **Consumer poll or push** — consumers either long-poll the state store, or the producer pushes via webhook/SSE/WebSocket when state changes.
5. **TTL and reaper** — promises do not live forever; expired ones are garbage-collected from the store.

Real systems: Temporal signals, AWS Step Functions task tokens, Google Cloud Tasks. **Same as a Future, just durable** — one-shot slot transitioning from pending to terminal, observable by N waiters.

**Follow-up:** Producer crashes mid-resolve? Answer: depends on implementation. Single atomic DB write — committed or not, no in-between. "Publish + write DB" — dual-write problem, needs 2PC (rarely worth it) or outbox. Resolution endpoint should be one transaction: validate token, update state row, ack. Idempotency by promise ID handles retry-after-network-error.

---

### Q19. Implement `All` and `First` combinators on `Future[T]`.

**Short answer:** `All` uses `errgroup.WithContext` — first error cancels the group, `Wait` returns it, siblings bail out; collect successes in a result slice indexed by input position. `First` launches one awaiter goroutine per Future, sending results to a channel buffered to `len(fs)` so losers never block; main loop returns on the first non-error result, falls through to the last error otherwise. Both accept a `ctx` argument and propagate it to each `Await`. See Live-Coding Prompt 2 for the full implementation.

**Follow-up:** What is missing? Answer: loser cancellation in `First`. If three RPCs race and one wins, the other two keep running until they observe context cancellation. Caller must use `context.WithCancel` + `defer cancel()`, or wrap `First` in its own derived context.

---

### Q20. What observability do you need for a Future-heavy system?

**Short answer:** Futures fail silently more often than synchronous calls because the goroutine and the awaiter are decoupled. Required signals:

1. **`futures_created_total{topic}`** counter — proves the producer side fires.
2. **`futures_resolved_total{topic,outcome=resolved|rejected|abandoned}`** — proves outcomes happen; abandoned (no one awaited) is its own bucket.
3. **`futures_await_duration_seconds{topic}`** histogram — time-from-create-to-await, exposes slow producers.
4. **`futures_in_flight{topic}`** gauge — pending Future count; growing without bound means leaks.
5. **`goroutines_count`** at process level — sustained growth is the canary for leaked Future producers.

Plus correlation IDs (trace context) propagated into the producer goroutine — otherwise traces break at `go func()`.

**Follow-up:** Most useful single metric? Answer: `futures_in_flight`. Flat baseline = balanced; monotonic rise = backlog or leak. Pair with `pprof.Lookup("goroutine")` to find the site. SLO: in-flight slope over an hour < 0.

---

### Q21. Abort-on-first-error fan-out — show the pattern.

**Short answer:** Use `errgroup.WithContext`. Each goroutine accepts the group's context; the first error cancels it, the others observe and bail out. The trick is that every blocking call inside each goroutine must respect that context — otherwise "abort" is theoretical.

```go
g, gctx := errgroup.WithContext(ctx)
g.SetLimit(50) // bound concurrency

for _, work := range workItems {
    work := work
    g.Go(func() error {
        // Every blocking call must take gctx.
        result, err := doRPC(gctx, work)
        if err != nil { return err } // triggers cancel of gctx
        return persist(gctx, result)
    })
}

if err := g.Wait(); err != nil {
    // First error. The other goroutines have all observed gctx.Done()
    // and returned — though their work may not have rolled back.
}
```

Gotcha: **`Wait` returns on first error, but other goroutines have not necessarily stopped**. They will return on their next context check but may still hold resources or write partial state in-flight. If "abort" means "no partial writes", you need transactional semantics on top. `errgroup` is cancellation, not rollback.

**Follow-up:** Collect all errors? Answer: `errgroup.Wait` returns only the first. For all-errors, use `sync.WaitGroup` + an error channel — trade-off: you lose the cancel-on-first-error affordance and wire cancellation manually.

---

### Q22. In-memory Future vs durable workflow — when do you reach for which?

**Short answer:** In-memory Future when the work fits within one process lifetime and the result becomes irrelevant if the process dies (HTTP request handlers, batch operations within one job). Durable workflow (Temporal, AWS Step Functions, Cadence) when the work spans days, survives crashes, involves human approvals, or coordinates retries across multiple services. The dividing line is **the cost of losing the in-flight state on process restart**. If "we crashed, the user retries" is fine, in-memory Future is enough. If "we crashed, the payment is now in limbo and a human must intervene", you need durability.

Durable workflows are not magical — Futures whose state lives in a database, with retry/timeout/heartbeat policies declared up front. Same conceptual model, different substrate.

**Follow-up:** Teams pick the wrong one? Answer: (1) Temporal for a 100-ms in-process fan-out — three weeks of integration for zero benefit. (2) "Background jobs" as goroutines that must survive restarts — works in dev, melts in prod on deploy. Heuristic: if you would be paged when this work disappeared mid-flight, durable workflow. Otherwise in-memory Future.

---

## 5. Staff/Architect questions (Q23–Q25)

### Q23. Design a Future-based RPC fanout layer for a microservices platform.

**Short answer:** Seven decisions grounded in production reality.

1. **One Future type with explicit producer/consumer roles** via two-interface constructor — prevents accidental double-resolve from caller code.
2. **Context propagation is mandatory.** Every producer accepts caller's context; cancellation end-to-end; enforced by linter.
3. **Bounded concurrency by default.** Every fanout uses `errgroup.SetLimit(N)`; "unlimited" is the leak in waiting.
4. **Combinators in a shared library.** `All`, `First`, `Map`, `Any`, `Race` written once with consistent semantics. Ad-hoc combinators bite during incidents.
5. **Timeouts at every layer.** Per-Future, per-RPC, per-host circuit breaker. Defense in depth.
6. **Observability built in.** Every Future emits created/resolved/rejected/duration; trace context auto-propagated; no unobserved fanout ships.
7. **Idempotency by request ID.** Retries inside the Future layer are safe because the downstream deduplicates.

Staff move: name what is **not** in scope — durable retries, cross-deploy state, scheduled fanout belong to a workflow engine, not the in-process Future layer.

**Follow-up:** Partial failures? Answer: depends on semantics. "All-or-nothing" → `errgroup`, accept observed errors do not roll back completed RPCs. "Best-effort" → separate combinator returning result-per-input. Worst prod bug: `errgroup` used when you want best-effort.

---

### Q24. Multi-region promise replication — how do you make a Future-backed system survive a region outage?

**Short answer:** A Future is a one-shot slot transitioning to a terminal state — replicating across regions reduces to "replicate small state with a single transition". Three architectures.

1. **Active-passive durable store.** Primary writes promise state to a cross-region-replicated DB (Aurora Global, Spanner). Failover promotes secondary. In-flight may resolve to "unknown" until replication catches up. RTO seconds, RPO ms.
2. **Active-active with conflict resolution.** Both regions accept resolves; conflicts resolved by last-write-wins or CRDT merge. Risk: divergence — promise resolves to V in A, V' in B. Only viable if values tolerate divergence.
3. **Region-affine.** Each promise belongs to one region (encoded in ID). Outage = that region's promises lost until failover; other regions unaffected. Simpler consistency, blast radius bounded.

Staff move: name the **observability gap** — replication lag is invisible to app code. Build a `replication_lag_seconds` SLO + alert. Practice failover quarterly.

**Follow-up:** Future awaited but never resolved across failover? Answer: depends on lifecycle. Awaiter in failed region died with it — fine. Awaiter elsewhere waits on a promise that may resolve after failover or be lost. Defensive: every awaiter has a deadline; on timeout, retry the originating action. Future is the optimization, durable retry is the correctness guarantee.

---

### Q25. Debug story — a service leaks 10,000 goroutines per hour, all blocked on Future awaits. Walk me through diagnosis.

**Short answer:** Five data-driven steps.

1. **Capture a goroutine dump** via `/debug/pprof/goroutine?debug=2`. Every blocking site is named. Group by top stack frame.
2. **Identify the bottleneck stack.** 10K goroutines blocked on the same `<-future.done` is the leak site; stack gives the call chain.
3. **Walk back to the producer.** Who was supposed to resolve? If no producer exists, the Future was created and abandoned — bug in constructor code.
4. **Check context propagation.** If producer is blocked on its own downstream, the issue is upstream. If awaiter's ctx is not threaded into producer, cancellation never propagates.
5. **Reproduce with a unit test** + `goleak.VerifyNone`. Fix until it passes.

Common root causes: (a) unbuffered channel, sender blocks because receiver gave up; (b) `errgroup.Wait` not called, parent returns while children run; (c) producer ignores context; (d) panic in producer with no recovery, Resolve/Reject never called; (e) circular dependency — A waits on B, B waits on A.

**Follow-up:** Earlier-warning metrics? Answer: `runtime_goroutines` gauge with alert on 1-hour slope > 0. `futures_in_flight` per topic to localize. `futures_abandoned_total` for the inverse leak. Teams watching goroutine counts catch leaks at hundreds, not 10K.

---

## 6. Live-coding prompts

### Prompt 1: Generic `Future[T]` with `sync.Once` and context-aware Await

**Problem.** Implement `Future[T any]` with `Resolve(v T)`, `Reject(err error)`, and `Await(ctx context.Context) (T, error)`. Resolve and Reject must be idempotent and crash-safe under concurrent calls. Await must return early on context cancellation. Expose `Done() <-chan struct{}` for callers who want to use the Future in their own `select`.

**Answer.**

```go
package future

import (
    "context"
    "fmt"
    "sync"
)

// One-shot promise of a value or error. After fulfilment the outcome
// is fixed; subsequent attempts are silent no-ops.
type Future[T any] struct {
    done chan struct{}
    val  T
    err  error
    once sync.Once
}

func New[T any]() *Future[T] {
    return &Future[T]{done: make(chan struct{})}
}

func (f *Future[T]) Resolve(v T) {
    f.once.Do(func() { f.val = v; close(f.done) })
}

func (f *Future[T]) Reject(err error) {
    f.once.Do(func() { f.err = err; close(f.done) })
}

// Await returns on fulfilment or ctx cancellation. Producer keeps
// running on ctx cancel unless it independently observes it.
func (f *Future[T]) Await(ctx context.Context) (T, error) {
    select {
    case <-f.done:
        return f.val, f.err
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}

// Done is receive-only so callers cannot close it.
func (f *Future[T]) Done() <-chan struct{} { return f.done }

// Go launches fn in a goroutine; panics convert to Reject so awaiters
// see an error rather than a dead goroutine.
func Go[T any](ctx context.Context, fn func(context.Context) (T, error)) *Future[T] {
    f := New[T]()
    go func() {
        defer func() {
            if r := recover(); r != nil {
                f.Reject(fmt.Errorf("future panic: %v", r))
            }
        }()
        v, err := fn(ctx)
        if err != nil { f.Reject(err) } else { f.Resolve(v) }
    }()
    return f
}
```

Senior moves: (a) `sync.Once` makes resolve/reject crash-safe; (b) `Await` selects on `ctx.Done()`; (c) `Done()` is receive-only; (d) `Go` recovers panics into errors; (e) generics avoid `any` boxing.

---

### Prompt 2: Build `All` and `First` combinators

**Problem.** Given `Future[T]`, write `All(ctx, futures...)` that returns all results or the first error (and cancels the rest), and `First(ctx, futures...)` that returns the first successful result and ignores the rest. Both must propagate context cancellation correctly.

**Answer.**

```go
package future

import (
    "context"
    "errors"

    "golang.org/x/sync/errgroup"
)

// All resolves with all values in input order, or rejects with first error.
func All[T any](ctx context.Context, fs ...*Future[T]) ([]T, error) {
    out := make([]T, len(fs))
    g, gctx := errgroup.WithContext(ctx)
    for i, f := range fs {
        i, f := i, f // pre-Go-1.22 loop capture
        g.Go(func() error {
            v, err := f.Await(gctx)
            if err != nil { return err }
            out[i] = v
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return out, nil
}

// First returns the first successful Future. Loser producers keep
// running until they observe ctx cancellation — callers should pass
// a cancellable context.
func First[T any](ctx context.Context, fs ...*Future[T]) (T, error) {
    type result struct { v T; err error }
    ch := make(chan result, len(fs)) // buffered so losers never block

    for _, f := range fs {
        f := f
        go func() {
            v, err := f.Await(ctx)
            select {
            case ch <- result{v, err}:
            case <-ctx.Done():
            }
        }()
    }

    var lastErr error
    for i := 0; i < len(fs); i++ {
        r := <-ch
        if r.err == nil { return r.v, nil }
        lastErr = r.err
    }
    var zero T
    if lastErr == nil { lastErr = errors.New("no futures provided") }
    return zero, lastErr
}
```

Senior moves: (a) `All` uses `errgroup.WithContext` for free cancellation; (b) `First` buffers `ch` to `len(fs)` so losers never block; (c) losers also select on `ctx.Done()`; (d) loser-cancellation semantics named in comments.

---

### Prompt 3: Worker pool with bounded concurrency consuming `Future[T]`

**Problem.** You have a stream of input jobs and need to process them concurrently, but with at most N workers in flight. Each job produces a `Future[Result]`. Show the pool, ensure no goroutines leak when the input channel closes, and let callers cancel via context.

**Answer.**

```go
package future

import (
    "context"
    "sync"
)

// Pool processes jobs from `in` with at most `workers` goroutines.
// Each job becomes a Future[R] sent to `out`. Closing `in` drains
// then closes `out`. Cancelling ctx exits cleanly.
func Pool[J, R any](
    ctx context.Context,
    in <-chan J,
    workers int,
    process func(context.Context, J) (R, error),
) <-chan *Future[R] {
    out := make(chan *Future[R])
    sem := make(chan struct{}, workers) // bounded-concurrency token bucket

    go func() {
        var wg sync.WaitGroup
        defer func() { wg.Wait(); close(out) }()

        for {
            select {
            case <-ctx.Done():
                return
            case job, ok := <-in:
                if !ok { return }

                select {
                case sem <- struct{}{}:
                case <-ctx.Done():
                    return
                }

                f := New[R]()
                wg.Add(1)
                go func(job J, f *Future[R]) {
                    defer wg.Done()
                    defer func() { <-sem }()
                    v, err := process(ctx, job)
                    if err != nil { f.Reject(err) } else { f.Resolve(v) }
                }(job, f)

                select {
                case out <- f: // backpressure propagates upstream
                case <-ctx.Done():
                    return
                }
            }
        }
    }()

    return out
}
```

Senior moves: (a) semaphore channel of buffer = N is the standard bounded-concurrency primitive; (b) `sync.WaitGroup` ensures `out` closes only after workers finish — closing early would race with workers still resolving Futures; (c) every blocking step selects on `ctx.Done()`; (d) backpressure on `out` propagates upstream — no unbounded buffering; (e) Futures emitted after cancel reject with `ctx.Err()` so awaiters see the cancellation.

---

## 7. Concept checks

If you cannot answer any of these in one breath, study more before the interview.

- What is the difference between a Future and a Promise? (Future is the read side; Promise is the write side. Often combined into one type in Go.)
- Name the four idiomatic Future shapes in Go. (Channel-returning function, struct with Resolve/Reject/Await, `errgroup.Group`, `singleflight.Group`.)
- Why does the Promise's Resolve need `sync.Once`? (To prevent double-close of the done channel and to publish val/err before the close signal — first call wins, the rest are no-ops.)
- Eager vs lazy Future — what is the difference? (Eager starts work at creation; lazy starts work at first Await. Eager wastes work if unwanted; lazy adds latency on demand.)
- How do you cancel a Future's underlying work? (Pass `context.Context` into the producer; producer respects `ctx.Done()` at every blocking call. Consumer's `Await(ctx)` returns on cancellation but does not stop the producer unless the producer itself observes the context.)
- What does `errgroup.WithContext` guarantee? (Group has a derived cancellable context; first error from any goroutine cancels it; `Wait` returns the first error and discards the rest.)
- What problem does `singleflight` solve? (Deduplication of concurrent calls for the same key — only one underlying execution; all callers share the result.)
- Common goroutine leak pattern with Futures? (Producer sends to an unbuffered channel; consumer gave up via context; producer blocks forever on send. Fix: buffer the channel or select on `ctx.Done()` in producer.)
- How do you propagate a panic from a Future producer? (Recover in the goroutine, convert to `Reject(err)`; awaiter sees an ordinary error.)
- Pitfall with `time.After` in a loop? (Each call leaks a timer until expiry. Use `time.NewTimer` + `Reset` or `context.WithTimeout` instead.)
- What is structured concurrency? (Every goroutine has a definite lifetime shorter than its parent's. `errgroup` is Go's closest expression.)
- When do you use an in-memory Future vs a durable workflow? (In-memory when state can be lost on crash; durable when "lost mid-flight" would page someone.)
- What is the abort-on-first-error trick in `errgroup`? (First error cancels the group context; siblings observe and bail out. Wait returns the first error; subsequent errors are dropped.)
- What two metrics catch most Future leaks? (`runtime_goroutines` sustained growth; `futures_in_flight` per topic.)
- What is the most common combinator mistake? (Using `errgroup` for best-effort fanout — first error cancels everyone else's work and you lose half the results.)

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **No mention of context.** Builds a Future without `Await(ctx)`; does not see that the consumer needs a way to give up.
- **No `sync.Once` in Resolve/Reject.** Hand-rolls a Promise that panics on the second call. Has not been bitten by double-fulfilment in production.
- **Unbuffered send from the producer.** Sends to `out <- result` on an unbuffered channel; cannot articulate why this is a leak waiting to happen.
- **Treats `errgroup` as "wait for all".** Does not realize that `Wait` returns on the first error and the other goroutines may still be running.
- **No panic recovery in the producer.** A panic in a goroutine kills the process; candidate does not think about it.
- **Reaches for `time.After` in a loop.** Does not know it leaks timers.
- **"Just spawn a goroutine."** No discussion of bounded concurrency, no `SetLimit`, no semaphore. Has never seen a service blow up from unbounded fanout.
- **Confuses in-process Future with distributed promise.** Tries to "pass a Future" between services. Does not grasp the process boundary.
- **No observability story.** Does not mention in-flight gauges, goroutine count alerts, or trace propagation. Future bugs are silent and candidate does not see it.
- **Uses `singleflight` without naming the context propagation pitfall.** Recommends it for caching without flagging that the first caller's context cancellation cancels everyone's work.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Names all four Future shapes unprompted.** Channel, struct, `errgroup`, `singleflight` — and explains when to use each.
- **`sync.Once` in Resolve/Reject without prompting.** Knows the happens-before story between the `Once`-guarded write and the `close(done)`.
- **Context threaded through producer *and* consumer.** Treats end-to-end cancellation as table stakes; does not need to be asked.
- **Buffered channel for the result.** Names the unbuffered-send leak by reflex; defaults to buffer 1 or struct-shaped Futures.
- **Bounded concurrency by default.** Reaches for `errgroup.SetLimit` or a semaphore without prompting. Has been on call for a goroutine explosion.
- **Panic recovery in the producer.** Discusses converting panic into Reject; logs stack at recovery, not just message.
- **Knows the `singleflight` context pitfall.** Names the first-caller-cancels-everyone bug before being asked.
- **Distinguishes in-memory Future from durable workflow.** Articulates the dividing line ("would I be paged if this disappeared?"). Has reached for Temporal at the right times and rejected it at the wrong ones.
- **Observability before deployment.** Wires in-flight gauges, await durations, and trace context into the design. Has debugged a goroutine leak with pprof.
- **Knows when *not* to use a Future.** Mentions that synchronous code is cheaper, simpler, and easier to debug when there is no parallelism to gain. Does not reach for Futures as a default.

---

## 10. Further reading

- **`golang.org/x/sync/errgroup` source code**: <https://cs.opensource.google/go/x/sync/+/refs/heads/master:errgroup/> — under 200 lines, every line worth reading. The `SetLimit` trick alone teaches three idioms.
- **`golang.org/x/sync/singleflight` source code**: <https://cs.opensource.google/go/x/sync/+/refs/heads/master:singleflight/> — read it once, then read it again after you have hit the context-propagation pitfall in production.
- **"Pipelines and cancellation"** (Sameer Ajmani, Go blog): <https://go.dev/blog/pipelines> — the canonical Go essay on channels, cancellation, and structured fan-out. Every Go developer should re-read this annually.
- **Temporal documentation, "Workflows" section**: <https://docs.temporal.io/workflows> — the closest production-grade "durable Future" model in mainstream use. Reading the API teaches when in-memory Futures stop being enough.
- **Pat Helland, *Life beyond Distributed Transactions***: <https://www.ics.uci.edu/~cs223/papers/cidr07p15.pdf> — not Future-specific, but the canonical paper on why cross-process state transitions need durability. Required framing for distributed promises.
