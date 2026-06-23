# Context Tree — Interview Questions

[← Back to index](junior.md)

## How to Read This File

Each question gives a short prompt, a model answer, and (where useful) a follow-up the interviewer might ask. The questions are roughly sorted from junior through staff level. They focus specifically on the tree shape and cascade semantics; questions on the broader context API live in the sibling interview files.

---

## Junior

### Q1. What is a context tree?

**Answer.** Every `context.Context` is a node in a tree. The root is `context.Background()` (or `TODO()`). Each call to a `With...` function adds a child node. The tree is used for cancellation propagation: cancelling a parent cancels every descendant.

### Q2. If I derive `child` from `parent` and cancel `child`, what happens to `parent`?

**Answer.** Nothing. Cancellation only flows from parent to descendants, never upward. `parent.Done()` is unaffected by `child`'s cancellation.

### Q3. What happens to siblings when I cancel one of them?

**Answer.** Siblings are isolated. Cancelling one cancels its own subtree only.

### Q4. Why must I `defer cancel()` after every `WithCancel`?

**Answer.** The `cancel` function is the only mechanism for unregistering the child from the parent's internal `children` map. Forgetting it leaks a tree node and any timer/goroutine bound to it. `go vet -lostcancel` catches the forgotten call.

### Q5. What does `WithValue` do to the cancellation tree?

**Answer.** Nothing. `WithValue` adds a node, but the node has no cancellation state of its own — its `Done()`, `Err()`, and `Deadline()` delegate to the parent. Only `Value(k)` is overridden. From a cancellation viewpoint, `WithValue` nodes are transparent.

### Q6. Can I cancel `context.Background()`?

**Answer.** No. `Background()` returns an `emptyCtx` with no associated cancel function. To get a cancellable root, derive: `ctx, cancel := context.WithCancel(context.Background())`.

---

## Middle

### Q7. Two nested `WithTimeout` calls — the outer 2s, the inner 10s. When does the inner cancel?

**Answer.** At 2 seconds, because of the "first-deadline-wins" rule. The inner deadline of 10 seconds is later than the outer's 2-second deadline, so the runtime does not even start the inner timer. The outer's cancellation cascades to the inner.

### Q8. Can I lengthen a parent's deadline by deriving with a later one?

**Answer.** No. A child can only shorten the effective deadline relative to the parent. To run work past the parent's deadline, derive from `context.Background()` (or use `WithoutCancel`) — that detaches from the parent's cancellation entirely.

### Q9. What is `context.WithoutCancel`?

**Answer.** Introduced in Go 1.21, it derives a child that inherits the parent's *values* but not its cancellation. `Done()` returns `nil`, `Err()` always returns `nil`, `Deadline()` returns no deadline. `Value(k)` still walks up to the parent. Use it for fire-and-forget background tasks that must survive the triggering request.

### Q10. What is `context.AfterFunc`?

**Answer.** Go 1.21+. Registers a callback to run when a context is cancelled. The callback runs in its own goroutine. Returns a `stop` function that deregisters the callback. Replaces the older "goroutine plus `<-ctx.Done()`" pattern for cleanup.

### Q11. What does `context.Cause` return?

**Answer.** Go 1.20+. Returns the error passed to `cancel(err)` if the context was created with `WithCancelCause` (or `WithDeadlineCause`/`WithTimeoutCause`). Otherwise returns `ctx.Err()`. Walks up the tree to find the nearest cancelled ancestor with a cause.

### Q12. Two goroutines both call `cancel()` on the same context. What happens?

**Answer.** The first one cancels the context (sets `err`, closes `done`, cascades). The second is a no-op due to first-write-wins. There is no panic; cancellation is idempotent.

### Q13. Sketch the tree built by:

```go
a, cA := context.WithCancel(context.Background())
b, cB := context.WithTimeout(a, time.Second)
c := context.WithValue(b, "k", "v")
d, cD := context.WithCancel(c)
```

**Answer.**

```
Background
   |
   a (cancelCtx)
   |
   b (timerCtx, 1s)
   |
   c (valueCtx, k=v)
   |
   d (cancelCtx)
```

`d` is a descendant of all of `a`, `b`, `c`. Cancelling `a` (via `cA()`) cascades to `b`, `c`, `d`. `b`'s timer firing cascades to `c`, `d`. Cancelling `d` (via `cD()`) affects only `d`.

### Q14. What does `defer cancel(nil)` do for `WithCancelCause`?

**Answer.** It calls the cancel function with `nil`, which means "do not override the cause." If the context was already cancelled with a real cause, that cause is preserved. If not, `Err()` becomes `Canceled` and `Cause` falls back to `Canceled`. It is the idiomatic cleanup for `WithCancelCause`.

---

## Senior

### Q15. Walk me through what happens when I call `cancel()` on a node with 5 cancelable children.

**Answer.** The runtime:

1. Acquires the node's mutex.
2. Sets `err = Canceled` and `cause = Canceled` (first-write-wins).
3. Closes the `Done()` channel (or stores the `closedchan` sentinel if Done was never allocated).
4. Iterates the `children` map. For each child, calls `child.cancel(false, Canceled, Canceled)` synchronously. Each child does the same recursion.
5. Sets `children = nil` to free memory.
6. Releases the mutex.
7. Calls `removeChild(parent, c)` to unregister this node from its own parent's map.

The whole cascade is synchronous on the calling goroutine. There is no global lock; each node's mutex is taken in turn.

### Q16. Why does `WithDeadline(parent, t)` sometimes not allocate a timer?

**Answer.** Because of the first-deadline-wins optimisation. If `parent.Deadline()` returns an earlier time than `t`, the parent will cancel first, and any timer on the new node would never fire. The runtime returns a plain `WithCancel` in this case, saving the `time.Timer` allocation.

### Q17. Why is implementing your own `Context` discouraged?

**Answer.** When `propagateCancel` runs and the parent is not a known built-in `cancelCtx` (or `timerCtx` that embeds one), it cannot register the child in the parent's `children` map directly. Instead, it spawns a goroutine that selects on `parent.Done()` and forwards cancellation. Every derived cancelable child of a custom context spawns one goroutine. Under load this is a goroutine leak vector.

### Q18. Does cascade order match insertion order?

**Answer.** No. The runtime iterates a Go map for children, and map iteration order is intentionally randomised. Do not rely on order.

### Q19. What is the `closedchan` sentinel?

**Answer.** A pre-closed `chan struct{}` allocated once at package init and shared across the process. When a node is cancelled but its `Done()` channel was never accessed, the runtime stores `closedchan` instead of allocating a fresh channel. Any subsequent `Done()` call returns `closedchan`, which is already closed and ready to receive. It is an allocation-saving optimisation for the common case where nobody waits on `Done()`.

### Q20. Two goroutines simultaneously: one calls `Done()` for the first time, the other calls `cancel()`. Any race?

**Answer.** No. `Done()` uses an atomic load on the `done` field. `cancel()` takes the mutex, then atomically stores either `closedchan` or closes an existing channel. The atomic load observes either: `nil` (initial — but only if `Done` won the race), the user-allocated channel, or `closedchan`. There is no torn read.

Actually a subtle point: if both run for the first time and `Done` allocates the channel before `cancel` runs, `cancel` will see a non-nil channel and close it. If `cancel` runs first and stores `closedchan`, `Done` will see it. In all interleavings the result is a closed channel that callers can receive from.

### Q21. How does `AfterFunc` avoid spawning a permanent goroutine?

**Answer.** It registers a small `afterFuncCtx` as a child in the parent's children map. The cascade calls this child's `cancel`, which in turn spawns a goroutine to run the user callback. The goroutine exists only between cancellation and callback completion, not before.

### Q22. After `WithoutCancel`, can I still derive a `WithTimeout`?

**Answer.** Yes. `WithoutCancel(parent)` is itself a `Context`; you can derive normally from it. The derived context will have its own cancellation/deadline, independent of `parent`. This is the canonical recipe for "background task with its own budget."

---

## Staff / Principal

### Q23. Describe a production failure mode caused by a wide cancel tree.

**Answer.** Suppose 50,000 worker goroutines each derive `WithCancel(rootCtx)`. The `rootCtx.children` map holds 50,000 entries. When the root cancels (e.g., a graceful shutdown), the cascade iterates all 50,000 children under `rootCtx.mu`. Each iteration locks the child's mu, sets err, closes done. With modest contention from `AfterFunc` callbacks or watcher goroutines being scheduled, the cascade can take 50–500ms. During that time `cancel()` does not return. If the caller is the request handler, tail latency spikes.

The fix is structural: cancel at a higher granularity (one cancel per pool, not per worker), or use channels instead of contexts for broadcast among many siblings.

### Q24. How would you debug a context-related goroutine leak?

**Answer.**

1. Take a goroutine profile: `curl http://service/debug/pprof/goroutine?debug=2`.
2. Search for stacks rooted in `context.propagateCancel`. Each such goroutine is a watcher for a custom context derivation.
3. Search for stacks rooted in user code `<-ctx.Done()`. Many of those indicate pre-1.21 cleanup goroutines that should now be `AfterFunc`.
4. Inspect `pprof`'s `heap` profile for unexpected `cancelCtx` allocations. A high count of cancelCtx with no corresponding cancellation suggests `defer cancel()` is missing somewhere.

### Q25. How would you design a context tree for a streaming server handling 1M long-lived connections?

**Answer.** Trade-offs:

- **One root per shard, not one root per process.** Cancelling all 1M at once is slow; bucketing into N shards lets you cancel one shard at a time.
- **`AfterFunc` for connection close.** Cheap cleanup without a permanent goroutine per connection.
- **No `WithValue` per request.** Use a single struct injected once.
- **`WithCancelCause` at the connection level** so disconnection reason (client close, server timeout, protocol error) is attributable.

### Q26. Compare `context.WithoutCancel` to spawning a fresh tree with `context.Background()`.

**Answer.** `WithoutCancel(parent)` preserves the parent's values (request ID, trace ID, user ID). `Background()` does not. For audit logs and metrics that should remain tied to the originating request, `WithoutCancel` is correct. For tasks completely unrelated to the trigger, `Background()` is correct.

Both create roots of new subtrees from a cancellation viewpoint.

### Q27. A bug report says "context.DeadlineExceeded but my code never set a deadline." How do you investigate?

**Answer.** Walk up the tree mentally. The deadline must be on some ancestor. Likely culprits:

- An HTTP server with `ReadTimeout` or `WriteTimeout` set, which exposes deadlines on `req.Context()`.
- A middleware adding `WithTimeout`.
- A gRPC server with default deadlines.

In code, log `ctx.Deadline()` at handler entry to see what budget you have. Use `context.Cause(ctx)` after the cancellation to find out which ancestor's timer fired.

### Q28. How do `WithoutCancel` and `WithCancelCause` compose?

**Answer.** `WithCancelCause(WithoutCancel(parent))` is valid: the new node has its own cancel-with-cause but is decoupled from the parent. Calling `cancel(err)` on this node sets the cause locally; `Cause` returns `err` for any descendant. The parent's cancellation does not affect it.

`WithoutCancel(WithCancelCause(parent))` is also valid but the cause is effectively unreachable through the `WithoutCancel` boundary — descendants of `WithoutCancel` see no cause from the original parent.

### Q29. The cascade is depth-first synchronous under per-node mutexes. Is there a risk of deadlock?

**Answer.** No, because the cascade never acquires a child's mutex while holding a parent's mutex *and* then tries to acquire the parent's mutex again. The lock order is strictly down the tree, with no cycles. `removeChild` reaches up, but only during user-initiated `cancel`, not during cascade. The runtime's design guarantees acyclic locking.

### Q30. If you had to add a method `Children() []Context` to the standard `Context` interface, what would break?

**Answer.** First, it would expose internal state, breaking the encapsulation that allows lazy allocation of `children`. Second, returning a slice is a snapshot; callers could be misled by stale data after concurrent derivations. Third, value contexts hide their children from a cancellation viewpoint; should they appear here too? Fourth, every custom Context implementation would need to be updated.

The cost is high; the benefit is limited (most observability is better served by traces). This is why the standard library does not expose it.

---

## Behavioural

### Q31. Tell me about a time you debugged a context-tree bug.

**Model answer outline.**

- Describe the symptom: latency spike, goroutine leak, unexplained cancellations.
- The investigation: pprof goroutine profile, trace dumps, code reading.
- The root cause: usually a missing `defer cancel()`, a wrong parent, or a custom Context that spawns watchers.
- The fix: structural change to derive correctly, or migrate to `AfterFunc`/`WithoutCancel`.
- The verification: regression test, benchmark, production metrics.

The interviewer is looking for systematic debugging, not the specific bug.
