# sync.Pool — Interview Questions

> A bank of `sync.Pool` interview questions from first-screening to staff-engineer rounds. Each block lists the question, a strong answer, and the follow-ups that typically come from a sharp interviewer. The questions are ordered roughly by level. Late questions presume the early ones.

---

## Junior Level

### Q1. What is `sync.Pool`?

**Answer.** A type from the Go standard library that holds a set of temporary, interchangeable objects so they can be reused instead of allocated on every use. It is designed to reduce GC pressure on hot allocation paths. The API is small: `Get()` to take an object out, `Put(x)` to return one, and an optional `New` function that constructs an object when the pool is empty.

**Follow-ups.**
- Where in the standard library is it used? *(`fmt` for buffer pools, `encoding/json` for encoders, `net/http` for request-line buffers.)*
- Is it goroutine-safe? *(Yes. All methods may be called from any number of goroutines.)*

---

### Q2. What does `Get` return if the pool is empty?

**Answer.** If `New` is set, `Get` calls `New` and returns the result. If `New` is nil, `Get` returns `nil`. The caller's type assertion will panic if it does not handle the `nil` case.

**Follow-ups.**
- Why does `Get` return `any`? *(Pre-generics legacy. The API was finalised in Go 1.3.)*
- How do you make this cleaner with Go 1.18+? *(A generic wrapper that does the type assertion internally.)*

---

### Q3. What happens to objects you `Put` into the pool?

**Answer.** The pool owns them. They live in the pool's internal storage until either another goroutine `Get`s them, or the garbage collector evicts them. The caller has no rights to the object after `Put`; reading or writing it is a data race.

**Follow-ups.**
- When does the GC evict them? *(On every GC cycle the live tier moves to a victim tier; the next GC drops the victim. So at most one GC of grace.)*
- What if I never `Get` them back? *(They get dropped by GC and reclaimed.)*

---

### Q4. Why is `Reset` important when using a pool?

**Answer.** `Get` returns an object in whatever state the previous user left it. If you do not `Reset`, you might see leftover data from another request. The canonical pattern is `Get` -> `Reset` -> `defer Put` -> use.

**Follow-ups.**
- What does `bytes.Buffer.Reset` do? *(Sets the buffer length to zero but keeps the underlying byte slice capacity. O(1).)*
- What is dangerous if `Reset` is incomplete? *(Cross-request data leakage, especially in a multi-tenant context.)*

---

### Q5. What is a real use case for `sync.Pool`?

**Answer.** Pooling `*bytes.Buffer` instances for log line formatting, JSON encoding, or response building. Every request would otherwise allocate a fresh buffer; pooling reduces that to near zero after warm-up.

**Follow-ups.**
- What would the benchmark look like? *(A `BenchmarkX` with `b.ReportAllocs()`; pooled version aims for 0 or 1 `allocs/op`.)*
- Why not just use a global buffer with a mutex? *(Serialises all callers; pool is per-P sharded and lock-free on the fast path.)*

---

## Middle Level

### Q6. When should you *not* use `sync.Pool`?

**Answer.** Several categories:

- **Connections.** Database, HTTP, gRPC. They have stateful, OS-quota-bound resources. Use `database/sql.DB` or a real connection pool.
- **File handles, sockets.** Cannot be reconstructed by `New`.
- **Long-lived caches.** Pool may evict at any GC. Use `sync.Map` or LRU.
- **Singletons.** Pool returns *any* item; use `sync.Once`.
- **Tiny objects.** Pool bookkeeping outweighs allocation savings for objects < 64 B.
- **Variable-size objects.** A 100 MB buffer might be returned where 100 B was expected.

**Follow-ups.**
- What is the right alternative for connection pooling? *(Dedicated library with explicit lifecycle: open, idle, close.)*
- How would you bound pool memory growth? *(Drop oversized items before `Put`; check `Cap()` against a threshold.)*

---

### Q7. Walk me through the canonical `bytes.Buffer` pool pattern.

**Answer.**

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func format(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    fmt.Fprintf(buf, "hello %s", name)
    return buf.String()
}
```

Four steps: `Get` and type-assert, `defer Put`, `Reset`, use, return a copy (`String()` allocates a fresh string).

**Follow-ups.**
- Why `defer Put`? *(So `Put` runs even if the function panics; pool stays correct.)*
- Why `buf.String()` and not `buf.Bytes()`? *(`String()` copies; `Bytes()` returns the pool's internal slice, which a future caller may overwrite.)*

---

### Q8. The pool benchmark says `1 allocs/op`. The naive version says `1 allocs/op`. Is pooling helping?

**Answer.** Probably not. Both versions allocate one thing per call — likely the returned `string` or some unrelated allocation. The pool is not buying you anything. Possible causes:

- Escape analysis kept the un-pooled buffer on the stack.
- Both versions allocate the same final result (the returned string), and that result dominates `-benchmem`.

The right next step is `go build -gcflags="-m"` to confirm what escapes, plus `pprof -alloc_objects` on a longer profile to see where allocations come from.

**Follow-ups.**
- What does `gcflags="-m"` print? *(Escape analysis decisions; lines like `moved to heap: x`.)*
- When does pooling clearly win? *(When the buffer escapes to the heap and is > 64 B.)*

---

### Q9. What does the `New` function need to do?

**Answer.** Construct a fresh, usable, type-correct object. It should be cheap (or moderately cheap), with no side effects beyond allocation. `New` runs in the calling goroutine when the pool is empty, so heavy work in `New` blocks the caller.

**Follow-ups.**
- What if `New` panics? *(The panic propagates to `Get`'s caller.)*
- Can `New` be nil? *(Yes, then `Get` returns nil on empty pool. Rarely useful; always set `New`.)*

---

### Q10. Write a generic pool wrapper.

**Answer.**

```go
type Pool[T any] struct {
    p sync.Pool
}

func NewPool[T any](newFn func() T) *Pool[T] {
    return &Pool[T]{p: sync.Pool{New: func() any { return newFn() }}}
}

func (p *Pool[T]) Get() T  { return p.p.Get().(T) }
func (p *Pool[T]) Put(v T) { p.p.Put(v) }
```

**Follow-ups.**
- What does this buy you? *(Type-safe `Get` and `Put`; no `any` in user code.)*
- How would you add a `Reset` callback? *(Add a `reset func(T)` field; invoke after `Get`.)*

---

## Senior Level

### Q11. Explain `sync.Pool`'s per-P design at a high level.

**Answer.** Each P (processor in the Go runtime's GMP model) has its own `poolLocal` with a private slot and a shared queue. `Get` and `Put` operate on the current P's `poolLocal` without locks. If the local pool is empty, `Get` steals from other Ps' shared queues. If those are empty too, it consults the victim cache (added in Go 1.13). Only if all are empty does it call `New`.

This design avoids contention: the fast path is lock-free and per-P, so even with hundreds of goroutines pulling from the pool concurrently, throughput scales linearly with cores.

**Follow-ups.**
- What is the victim cache? *(A second tier of items moved out of the live pool at the last GC. The next GC drops the victim.)*
- Why is the private slot separate from the shared queue? *(Private is the absolute fastest access — no atomics. Shared allows stealing.)*

---

### Q12. What happens during garbage collection?

**Answer.** The runtime calls a registered cleanup function during the STW phase. It walks every active pool and shifts the contents: live becomes victim, victim is dropped. Items in the live tier survive one GC by becoming victim; items in the victim tier are reclaimed by the sweeper.

This means an item lives in the pool for at most one GC cycle. After two GCs, the pool is effectively empty unless `Put` has repopulated it.

**Follow-ups.**
- Does this happen in every GC? *(Yes.)*
- Does it scale with the number of pools? *(Cleanup is linear in number of pools, not items. Hundreds of pools is fine; tens of thousands might add measurable STW.)*

---

### Q13. A teammate added `sync.Pool` for `*http.Request` objects in a middleware. What is the concern?

**Answer.** Several:

- `http.Request` is large and complex. Its fields hold pointers to body readers, contexts, headers, TLS state. `Reset`-ing all of those exhaustively is error-prone.
- If the request is captured by a goroutine started in the handler, that goroutine may still read from the request after the middleware `Put`s it back — race.
- The standard library already does not pool `http.Request` for these reasons.
- Holding onto request memory across requests is a leakage vector if `Reset` is incomplete.

I would push back unless there is profiler evidence that `Request` allocation is a real bottleneck (rarely is — bodies dwarf the struct).

**Follow-ups.**
- What *do* you pool in an HTTP middleware? *(`bytes.Buffer` for response writing, JSON encoders, span/trace context objects with strict `Reset`.)*
- How would you measure the impact? *(`-benchmem` on the middleware in isolation, plus `gctrace` under prod-like load.)*

---

### Q14. The profile shows `sync.(*Pool).getSlow` hot. What does that mean and how do you fix it?

**Answer.** `getSlow` runs when the local P's pool is empty and the pool has to steal from other Ps or fall through to the victim. Hot `getSlow` indicates low hit rate: items are not staying in the pool between `Get` calls. Likely causes:

- GC is firing more often than expected (lower `GOGC`? high allocation rate?). Every GC empties the live tier.
- `Put` rate is lower than `Get` rate (callers forget to `Put` on some paths). Audit code paths.
- Burst traffic: a sudden surge of `Get`s drains the pool faster than `New` can refill, and other Ps' pools have nothing to steal either.
- The pool serves wildly varying object sizes, and the steal path is finding the wrong size.

Fix depends on cause. Audit `Put` paths first. Check `GOGC`. Look at `pprof` to see who is calling `Get`.

**Follow-ups.**
- What is a quick way to see GC frequency? *(`GODEBUG=gctrace=1`.)*
- How would you instrument hit/miss rate? *(Wrap `sync.Pool` with counters; sample to keep overhead low.)*

---

### Q15. Compare `sync.Pool` with a channel-backed pool.

**Answer.**

| | `sync.Pool` | channel pool |
|---|---|---|
| Bound on size | No; GC-driven | Yes; channel capacity |
| Eviction | On every GC | Never |
| Per-op cost | ~5-10 ns | ~50-100 ns |
| Memory predictability | Low | High |
| Concurrency | Lock-free fast path | Channel send/recv |
| Item lifetime | At most one GC | Bounded by channel cap |
| Best for | Anonymous temporaries | Bounded resource pools |

`sync.Pool` is faster and lower-memory at the cost of unpredictability. A channel pool is slower but bounded and stable. The right choice depends on whether you can tolerate eviction.

**Follow-ups.**
- Why is a channel pool more expensive? *(Channel send/recv goes through scheduler-aware machinery; `sync.Pool` is lock-free on its fast path.)*
- Where would you use a channel pool? *(A pool of pre-allocated worker structs that must always be available.)*

---

## Professional / Staff Level

### Q16. Describe the data structure inside `sync.Pool`.

**Answer.** `Pool` holds two arrays (live and victim) indexed by P. Each element is a `poolLocal`: a `private any` and a `shared poolChain`. `poolChain` is a doubly-linked list of `poolDequeue` nodes, each a fixed-size ring with a packed `headTail` atomic uint64 holding head and tail indices.

The local P pushes/pops the head of its `shared` queue (LIFO for cache locality). Foreign Ps pop the tail only (FIFO from the stealer's view). The packing of `headTail` allows lock-free coordination: one CAS updates both head and tail atomically.

Each `poolLocal` is padded to a cache-line multiple to prevent false sharing between Ps.

**Follow-ups.**
- Why LIFO for the local P? *(Most recent items are still hot in cache.)*
- Why the cache-line padding? *(Two adjacent `poolLocal`s on the same cache line would force coherence traffic on every write — false sharing.)*

---

### Q17. Walk through `Pool.Get` step by step.

**Answer.**

1. `p.pin()` pins the goroutine to its current P and returns the corresponding `poolLocal`. The pin prevents the goroutine from being descheduled mid-operation.
2. Read `l.private`; if non-nil, clear it and return.
3. Otherwise call `l.shared.popHead()` — pop from the local shared queue.
4. If still empty, call `p.getSlow(pid)` — walk other Ps' shared queues calling `popTail` on each.
5. If those are all empty, walk the victim cache the same way.
6. Mark victim as empty if everything was empty.
7. Unpin.
8. If still empty and `New` is set, call `New()` (unpinned).

The unpinning before `New` is intentional: `New` may do real work, and keeping the P pinned would prevent other goroutines on that P from running.

**Follow-ups.**
- What happens if a GC fires between unpin and `New`? *(The pool's live tier moves to victim. The result is fine for our caller — they already committed to `New` — but a concurrent caller may suddenly find the pool empty.)*

---

### Q18. The Go memory model says `Put` synchronises with `Get`. What does that mean precisely?

**Answer.** If goroutine A executes `Put(x)` and goroutine B executes `Get()` that returns the same `x`, then all writes to memory reachable from `x` by goroutine A *before* the `Put` are visible to goroutine B *after* the `Get`. This is established by the atomic operations on `poolDequeue.headTail` (release on `pushHead`, acquire on `popTail`/`popHead`).

What is *not* guaranteed: synchronisation between a `Put` and an unrelated `Get` (different object). The pool cannot be used as a generic communication primitive.

**Follow-ups.**
- Is there a happens-before between `Put`s of different objects by the same goroutine? *(Yes, sequenced by program order, but only within that goroutine.)*
- What if the race detector sees `Get` returning a different object than what was just `Put`? *(No race — different objects, different memory.)*

---

### Q19. You inherit a service with 50 `sync.Pool` instances. Many look unused. How do you decide which to keep?

**Answer.** A systematic approach:

1. **Instrument.** Wrap each pool with counters (Gets, Puts, "misses" — `New` calls). Deploy to a staging environment with prod-like traffic.
2. **Classify.** After a representative window (24 h), classify each pool:
   - Hot: > 10K Gets/sec.
   - Warm: 100 – 10K Gets/sec.
   - Cold: < 100 Gets/sec.
3. **Action.**
   - Hot: keep, leave alone.
   - Warm: review for correctness — `Reset` discipline, capacity bound, escape analysis.
   - Cold: remove. Replace with direct allocation. Compare metrics: GC time, p99 latency, memory. If nothing regresses, the pool was dead code.
4. **Document.** For pools that remain, add a comment explaining traffic and rationale.

Plan for removal: pools are easy to add and hard to remove because consumers grow. Migrate consumers off the pool over a release before deleting.

**Follow-ups.**
- What metric proves removal was safe? *(GC pause percentiles, heap-growth rate, p99 unchanged.)*
- What if a pool is hot in one region and cold in another? *(Either accept the variability or split: feature-flag the pool by traffic profile.)*

---

### Q20. You see `Get` returning `nil` in production but `New` is set. What is happening?

**Answer.** `Get` should not return `nil` when `New` is set — unless `New` itself returned `nil`. Investigate:

```go
func() any {
    if someCondition {
        return nil // BUG
    }
    return new(bytes.Buffer)
}
```

A common bug: `New` returns a pointer that the calling code mishandles (e.g., a nil interface containing a nil pointer; the interface is non-nil but the underlying value is nil). The type assertion succeeds but the resulting pointer is nil; later dereference panics.

Other possibilities:

- `New` was changed at runtime to `nil` between `Get` calls — a data race on the `New` field. The race detector would catch this.
- The pool field was zeroed by a copy (a `noCopy` violation that `go vet` should warn about).

**Follow-ups.**
- How do you defensively code against this? *(Test `if buf == nil { ... }` after the type assertion; add `t.Errorf` to a unit test that runs `New` once.)*
- Should `New` ever return nil? *(No. If you want sometimes-empty behaviour, do not set `New` and handle the nil case in your caller.)*

---

### Q21. You are designing a library function `Encode(v any) []byte` that pools buffers internally. What is the API contract you must document?

**Answer.** Several:

1. **Return ownership.** The returned `[]byte` must be owned by the caller, not aliased to the pool. Otherwise the caller's reads race with the next pool consumer. Implementation: allocate a fresh `[]byte` for the return value via `make`+`copy`, not via `buf.Bytes()` directly.
2. **Thread safety.** `Encode` is safe under concurrent calls.
3. **Memory characteristics.** Document that the function uses pooling internally and may evict during GC. Callers do not need to know more.
4. **Error path.** If `Encode` returns an error, what about the buffer? Document that the pool is always returned, regardless of success.
5. **Performance.** Document approximate allocations per call (`-benchmem` numbers).

The user-facing API should expose none of the pool: no `Get`/`Put`, no `New` hooks. The pool is implementation.

**Follow-ups.**
- What if a caller wants to reuse the buffer? *(Provide a second API `EncodeTo(buf *bytes.Buffer, v any) error` that takes a caller-provided buffer. The caller can pool that themselves.)*
- How would you test for accidental aliasing? *(After `Encode`, mutate the returned `[]byte`; ensure subsequent `Encode` calls do not see the mutation. Or use `go test -race` with concurrent encoders.)*

---

### Q22. What is your strongest argument against pooling, in code review?

**Answer.** "Have you measured?" Pooling adds invariants the reader must hold in their head:

- The object you got back must be reset before use.
- The object you put back must be fully released; no captured pointers.
- Any goroutine spawned during the borrow must finish before `Put`.
- `Reset` must clear references that pin user data.

Each invariant is a future bug. Pooling earns its place only when there is benchmark or production-profile evidence that allocation cost is material. Lacking that, the pool is premature optimisation, and complexity that pays no rent.

A good rule: a pull request that adds `sync.Pool` should include both a benchmark showing the win and a docstring explaining the lifecycle. Without those, it gets a "not yet" comment.

**Follow-ups.**
- Have you ever removed a `sync.Pool`? *(Yes. The expected win was 5%; production showed 0.3%. Removed it, simplified two files, reduced cognitive load. Net positive.)*
- What complexity cost is hardest to articulate? *(The mental tax on every reader of the surrounding code — they have to remember the borrow contract every time they edit nearby logic.)*
