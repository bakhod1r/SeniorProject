# Context Internals — Interview

[← Back to index](index.md)

## How to Read This Page

Each block is a single interview question with a model answer. Difficulty progresses from "warm-up for a junior screen" to "designing a replacement for `context` in a staff-level architecture review." All questions focus on the **internals** — how the package works, not just how to use it.

Use the questions to drill yourself before an interview, or to set a bar for your own interview rubric.

---

## Junior Tier

### Q1. What four methods does the `Context` interface have, and what does each return?

`Deadline() (time.Time, bool)` — absolute deadline plus a "is one set" flag.
`Done() <-chan struct{}` — a channel that closes when the context is canceled, or nil if uncancellable.
`Err() error` — `nil` before cancel; `Canceled` or `DeadlineExceeded` after.
`Value(key any) any` — request-scoped lookup.

### Q2. What is the difference between `Background()` and `TODO()`?

Both return uncancellable singletons. They differ only in `String()`: `"context.Background"` vs `"context.TODO"`. The intent is documentation — `TODO` marks unfinished plumbing.

### Q3. What does `WithCancel` allocate?

A `*cancelCtx` struct and a `CancelFunc` closure. If the parent is recognised as a `*cancelCtx`, no goroutine. Otherwise, depending on parent type, possibly one forwarder goroutine.

### Q4. Why is `Done()` lazy?

Many contexts never have their `Done` channel observed (work completes before any select fires). Deferring the `make(chan struct{})` until first read saves the allocation in the common case.

### Q5. What does `cancel()` do internally?

Takes the mutex, sets `err` and `cause`, closes the done channel (or stores `closedchan`), recursively cancels all children, nils the children map, releases the mutex, and removes itself from the parent's children map.

### Q6. What is `closedchan`?

A package-global channel of type `chan struct{}` that is closed at package init. It is the shared "already done" channel substituted into canceled contexts whose `Done` was never observed.

---

## Middle Tier

### Q7. Walk through `propagateCancel`. What are its five branches?

1. Parent's `Done()` is nil — no-op.
2. Parent is already canceled — immediately cancel the child.
3. Parent is a recognised `*cancelCtx` — register in parent's children map.
4. Parent implements `AfterFunc(func()) func() bool` — register a callback.
5. Otherwise — spawn a forwarder goroutine.

### Q8. What is the `&cancelCtxKey` trick and what does it accomplish?

`cancelCtxKey` is an unexported `int` whose address is used as a sentinel context-key. `cancelCtx.Value` is overridden to return self when this key is requested. This lets `parentCancelCtx` walk up arbitrary chains (through `valueCtx` wrappers) and recognise the nearest cancelCtx — reflection-free type recognition.

### Q9. Why does `parentCancelCtx` cross-check `pdone == done`?

To detect custom wrappers that change `Done()` identity. If a wrapper overrides `Done` to return its own channel, registering on the inner cancelCtx would not flow cancellation through the wrapper's channel. The cross-check forces such cases to the slow (forwarder-goroutine) path.

### Q10. Why is `Err` an `atomic.Value` instead of mutex-protected?

Reads must be lock-free for hot loops like `for ctx.Err() == nil { … }`. Atomic load on the read path; mutex still used on the write path (cancel) to coordinate with channel close.

### Q11. How does `Err` guarantee that `Done` is closed before returning a non-nil error?

After atomically loading a non-nil `err`, it does `<-c.Done()`. Receiving from the closed channel succeeds immediately *and* establishes a happens-before edge that publishes the close to the caller.

### Q12. What is the children-map memory leak?

Discarding a `CancelFunc` from `WithCancel` (or similar) without ever calling it means the parent's `children` map keeps a reference to the child. As long as the parent lives, the child is unreachable to GC but still pointed at. Long-lived parents accumulate dead children.

### Q13. What does `WithoutCancel` actually do?

Returns a `withoutCancelCtx{c: parent}`. Its `Done()` is nil; `Err()` is nil; `Deadline()` is zero. Values are inherited via `value()`. The boundary is enforced in `value()`'s switch: `withoutCancelCtx` case returns nil for `&cancelCtxKey`, preventing `parentCancelCtx` from reaching across.

### Q14. Trace what happens when `WithTimeout(parent, 100ms)` is called and the parent has a 50ms deadline.

`WithDeadlineCause` (which `WithTimeout` calls) checks `cur, ok := parent.Deadline()`. If `cur` is before the new deadline (50ms < 100ms), it returns `WithCancel(parent)` — no timer is allocated. The parent's deadline will cancel us first; allocating our own 100ms timer would be wasted.

---

## Senior Tier

### Q15. Explain the lock-order invariant in cancel cascades.

When a `cancelCtx.cancel` runs, it holds its own mutex and iterates children, calling `child.cancel(false, …)` — which acquires the child's mutex. Lock order is always parent-to-child. Since cancel only ever flows down the tree (never up), there is no opposing direction, so no deadlock is possible.

### Q16. Why is `removeChild` called *outside* the mutex in `cancelCtx.cancel`?

`removeChild` acquires the grand-parent's mutex. If we were still holding our own mutex while doing that, we would hold two ascending locks — and a concurrent cancel cascade going downward could try to acquire ours while we wait for the grand-parent's, producing a cycle. Releasing our mutex first breaks the cycle.

### Q17. Walk through the AfterFunc implementation and the use of `sync.Once`.

`AfterFunc` creates an `afterFuncCtx` that embeds `cancelCtx` plus a `sync.Once` and a callback `f`. It propagates cancellation from the parent. The returned `stop` closure calls `a.once.Do(func() { stopped = true })`. The overridden `afterFuncCtx.cancel` calls `a.once.Do(func() { go a.f() })`.

`sync.Once` guarantees only one of the two closures runs. If `stop()` is first, `f` is prevented. If cancel is first, `f` runs on a new goroutine. The boolean return of `stop()` tells the caller which side won.

### Q18. Why does the `afterFuncCtx.cancel` spawn a new goroutine for `f` instead of calling it inline?

Because `cancel` is invoked inside the parent's cancellation cascade, holding parent locks. If `f` blocked on anything held by an ancestor cancel — a channel send, a mutex acquisition — we would deadlock. Decoupling via a goroutine isolates `f` from the cancellation machinery.

### Q19. How does `Cause` resolve the cause when a chain has multiple `cancelCtx` ancestors?

`Cause` does `c.Value(&cancelCtxKey)` which returns the **nearest** ancestor cancelCtx. So `Cause` reflects the cause of the closest cancel, not any deeper one. If a grandparent canceled with cause X and a parent later canceled with cause Y, `Cause(child)` returns Y.

### Q20. What allocation costs does `WithDeadline` incur in the common case?

Three: the `timerCtx` struct (~80 bytes including embedded cancelCtx), the `time.Timer` struct + runtime timer record (~150 bytes total), and the `CancelFunc` closure (~16 bytes). Plus, if this is the parent's first child, one map allocation (~48 bytes).

### Q21. What is `stopCtx` and when is it created?

`stopCtx` is an internal wrapper used when `propagateCancel` recognises a parent that implements the `afterFuncer` interface. It wraps the parent and remembers the `stop` function returned by the parent's `AfterFunc`. This lets `removeChild` later call `stop()` to unregister.

`stopCtx` never appears in user code — it lives entirely inside the child's stored parent reference.

### Q22. Explain the `value()` function. Why is it iterative, not recursive?

`value(c, key)` is an unexported helper that walks the parent chain looking for a match. It uses a `for` loop and rebinds `c` on each iteration, never grows the call stack. Chain depth of 1,000 costs 1,000 iterations, not 1,000 stack frames.

It switches on the dynamic type of `c` for each step, handling `*valueCtx`, `*cancelCtx`, `withoutCancelCtx`, `*timerCtx`, the two singletons, and a `default` for custom types.

### Q23. Compare `context.Context` to Rust's `tokio_util::sync::CancellationToken`.

Both support hierarchical cancellation via a parent-child token relationship. Both have flag-style observation (`is_cancelled()` in Rust, `<-ctx.Done()` in Go). Differences:

- Go bundles deadline and value propagation into the same type; Rust uses separate primitives (`tokio::time::timeout`, `tracing::Span`).
- Go's value lookup is O(chain depth); Rust avoids the problem by not having one.
- Rust's `CancellationToken` is `Clone` and shares state via `Arc`; Go's `Context` is interface-typed and immutable.

Mechanically similar. The architectural divergence is in how values flow.

---

## Staff Tier

### Q24. The team is rolling out a service mesh that intercepts gRPC calls. Each interceptor wraps the request context with a custom type carrying mesh metadata. The custom type forwards `Done`, `Err`, `Deadline` correctly but does not implement `AfterFunc` and does not forward `&cancelCtxKey`. At 50k QPS, the service's goroutine count grows by ~3,000. What is happening?

Every `context.WithTimeout` (or `WithCancel`) inside the handler derives from the mesh's custom context. `propagateCancel` cannot recognise it as a `*cancelCtx` (the magic key lookup fails) and has no `AfterFunc` to use, so it falls to the slow path: one forwarder goroutine per derivation.

At 50k QPS, with say 1.5 derivations per request on average, the system spawns 75k forwarder goroutines per second. Each is short-lived (cancels promptly), but the population of 3,000 represents the steady-state of "currently parked watchers."

Fix: have the mesh's custom type implement either (a) `Value(&cancelCtxKey)` forwarding (to expose the inner cancelCtx), or (b) the `afterFuncer` interface. Either restores the fast path.

### Q25. Design a context implementation that supports **two** independent cancellation reasons — for example, "client closed connection" and "server shedding load" — that can be distinguished by code observing the cancel.

Two approaches:

**Option A**: nest `WithCancelCause` calls. Outer cancel for connection-close, inner cancel for shed-load. `Cause(ctx)` returns the **innermost** cause. The downside: only the innermost matters; both signals may need to be observable.

**Option B**: define a custom Context that holds two `*cancelCtx`s and a derived `done` channel. The custom type's `Done()` returns a channel that closes when either inner cancel fires. `Cause()` returns one of two distinguishable errors based on which fired first.

Implementation sketch for option B:

```go
type DualCancelCtx struct {
    parent context.Context
    done   chan struct{}
    once   sync.Once
    cause  atomic.Value // of error
}

func WithDualCancel(parent context.Context) (*DualCancelCtx, func(reason error), func(reason error)) {
    c := &DualCancelCtx{parent: parent, done: make(chan struct{})}
    cancelA := func(r error) { c.fire(r) }
    cancelB := func(r error) { c.fire(r) }
    go func() {
        select {
        case <-parent.Done():
            c.fire(parent.Err())
        case <-c.done:
        }
    }()
    return c, cancelA, cancelB
}

func (c *DualCancelCtx) fire(reason error) {
    c.once.Do(func() {
        c.cause.Store(reason)
        close(c.done)
    })
}

// implement Deadline, Done (return c.done), Err, Value
```

Discuss: this custom type takes the slow path for any standard context derived from it. For high-QPS use, this is acceptable only if the dual-cancel context is rare and ephemeral.

### Q26. The standard library uses `atomic.Value` for `cancelCtx.err` but a plain `error` field for `cause`. Why the asymmetry?

`Err()` is called on every iteration of hot loops like `for ctx.Err() == nil { … }`. Lock-free atomic reads are essential there.

`Cause(ctx)` is rare — it is a diagnostic call made when logging or classifying an error after the fact. Lock acquisition cost is acceptable.

Storing `cause` atomically would have wider implications: writing it (in `cancel`) would need to be ordered with `err` and `done` updates. The current design centralises that ordering under the mutex.

### Q27. A team proposes a "context pool" where cancelCtxes are recycled between requests via `sync.Pool` to reduce allocation. Critique the design.

Risks:

- A pooled context must be reset to pre-cancel state. The package's `err` field is `atomic.Value` and cannot be set to nil after being non-nil — `atomic.Value`'s API forbids storing nil after a non-nil value. So you cannot reuse a *canceled* cancelCtx via the standard API.
- Reset would need to use `unsafe.Pointer` to forcibly clear the atomic. Fragile and Go-version-dependent.
- The children map persists across reuses. Forgetting to clear it leaks references from one request to the next.
- The done channel is closed after cancel. Reusing it requires a fresh channel allocation anyway, which is half of what you wanted to save.

Verdict: cancelCtx pooling is impractical without forking the package. The cleaner optimisation is to derive fewer contexts per request — see [optimize.md](optimize.md).

### Q28. The Go runtime team is considering exposing `cancelCtx`'s underlying state via a debug API. What invariants must the API preserve?

- Read-only access only; debug should not mutate state.
- Reads must be consistent with the package's documented semantics: returned `Err`, `Done`, `Cause` must agree with what the public API returns at the same moment.
- The children map iteration must be safe — taking a snapshot under the mutex is acceptable; exposing live iteration is not.
- Internal types (`stopCtx`, `afterFuncCtx`) should remain unexported to preserve forward compatibility.

A reasonable API: `runtime.ContextDebugInfo(ctx) DebugInfo` returning a struct with `Type string`, `Canceled bool`, `Cause error`, `NumChildren int`, `Deadline (time.Time, bool)`, `ParentType string`. Snapshot, immutable, suitable for diagnostics.

### Q29. You are designing the cancellation primitive for a new language. What aspects of Go's `context` would you keep and what would you change?

Keep:

- **Tree of derivations.** Hierarchical cancellation is unmatched.
- **Cancel-with-cause distinction.** `Err` answers "what kind of cancel" while `Cause` answers "who cancelled." Two questions, two values.
- **Lazy channel allocation.** A great optimisation for the common case.

Change:

- **Separate values and cancellation.** Putting them on the same type conflates concerns. A separate `Scope` for values would be cleaner.
- **Built-in cancel hooks as first-class.** `AfterFunc` retrofitted what should have been there from day one.
- **Strong-typed key API.** Forcing `any` keys leaves room for type confusion. A generics-based key with compile-time type checking would be safer.
- **Cause as the canonical signal.** Make `Err` always return the cause; remove the asymmetry. New code rarely needs the distinction; old code can use a deprecated `OriginalErr()` accessor.

### Q30. Walk a stack trace beginning with `panic: send on closed channel` arising from inside `runtime.chansend1` and trace it back through a context-cancelled goroutine.

Likely scenario: a goroutine called from a request handler sends on a channel after the request context has been canceled, and the channel was closed by the cancellation cleanup.

Trace:

1. `runtime.chansend1` panics because the channel is closed.
2. Caller is application code that called `ch <- value` without first selecting on `ctx.Done()`.
3. The channel was closed by a deferred function on the cancel path.

The internal `context` involvement is upstream: `cancelCtx.cancel` ran, closed `c.done`, cascaded to children. Application-level cleanup observed the cancel and closed `ch`. Then a stale goroutine (still running because it did not check `ctx.Done()`) tried to send.

Fix is application-side: replace `ch <- v` with `select { case ch <- v: case <-ctx.Done(): }`. The context internals are working correctly; the bug is in the consumer's failure to plumb the signal.

### Q31. Why is `valueCtx` a pointer type (`*valueCtx`) while `withoutCancelCtx` is a value type (`withoutCancelCtx`)?

`valueCtx` is a pointer type because `value()` and `Value()` need pointer-equal identity (for the `case *valueCtx` switch arm) and because the embedded `Context` interface field means a pointer is more efficient to pass than a 48-byte struct.

`withoutCancelCtx` is a value type because it has no method that requires a pointer receiver and it carries only one interface field (16 bytes). Passing by value is fine. The trade-off is that it boxes into an interface slot on each conversion, but that boxing happens once at `WithoutCancel` construction.

Both choices are deliberate ergonomic decisions, not arbitrary.

### Q32. If you had to extend `context` to support **suspending** rather than just canceling — e.g., pausing work that can later resume — how would you structure the addition?

Suspension is fundamentally different from cancellation: cancel is one-way, suspend is bidirectional. The `Context` interface assumes monotonicity (`Err` once non-nil stays non-nil). Suspension breaks this.

Approach: add a separate `Suspendable` interface alongside `Context`.

```go
type Suspendable interface {
    Suspend()
    Resume()
    Suspended() <-chan struct{}  // closes while paused, reopened when resumed
}
```

Implementation challenge: a `<-chan struct{}` cannot be re-opened in Go. The runtime would need a new primitive: a "manual-reset event" akin to Windows's `ResetEvent` or Java's `CountDownLatch.reset()`. Building this on Go's standard sync would require a custom struct with mutex + condition + flag.

Compose with context: derived contexts could pause their cascade when the parent is suspended, resuming when the parent resumes. The cascade rules and children map semantics would need extensive rework.

Conclusion: a clean addition is hard. The simpler answer is "implement suspension at the application layer with `sync.Cond` rather than building it into the context tree."

---

## Behavioural Tier

### Q33. Tell me about a time you debugged a context-related issue in production. What was the root cause?

(Personal anecdote question. Strong answers identify:

- The specific symptom (memory growth, dropped requests, leaked goroutines).
- The diagnostic tools (pprof, runtime/metrics, log correlation).
- The root cause traced to a specific internal mechanism — e.g., "the children map was retaining canceled futures because we discarded the CancelFunc."
- The fix and its measured impact.)

A weak answer reports the surface symptom and not the internal mechanism. A strong answer ends with "and here's the exact source-line that explained why."

### Q34. How would you onboard a junior engineer to the `context` package?

(Demonstrates teaching ability. Strong answer:

- Start with the four-method interface.
- Show the singletons (no allocation, no cancellation).
- Walk through `WithCancel` and the `cancelCtx` struct briefly.
- Highlight the `defer cancel()` rule and *why* it exists (children-map leak).
- Save `propagateCancel` internals and the slow path for senior level.

Weak answer: "I'd have them read the godoc.")

---

## Reflection

The questions above are not about memorising the source. They are about being able to **predict** what the package will do in a novel situation by reasoning from the structures and invariants. Once you can do that, the package stops surprising you.

Next: [tasks.md](tasks.md) — hands-on exercises that build context internals from scratch.
