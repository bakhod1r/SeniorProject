---
layout: default
title: sync.Pool Internals — Interview
parent: sync.Pool Internals
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/03-sync-pool-internals/interview/
---

# sync.Pool Internals — Interview Questions

[← Back](../)

> Practice questions from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is `sync.Pool` for?

**Model answer.** It is a free list of temporary objects, safe for use by multiple goroutines, intended to reduce GC pressure by reusing allocations that would otherwise be thrown away. Typical uses: pooling `bytes.Buffer`, `encoding/json.Encoder`, or any other expensive-to-allocate scratch object that has a clear "in use" and "idle" lifecycle.

**Common wrong answers.**
- "It pools goroutines." (No — that is a worker pool pattern, not `sync.Pool`.)
- "It's for caching results." (No — items may be evicted at any time, so it cannot serve as a cache with hit/miss semantics you care about.)

**Follow-up.** *Why does the standard library use it?* `fmt` keeps a pool of formatting buffers; `encoding/json` reuses encoder state; `net/http` reuses request/response objects. All of these are short-lived per-call objects that would otherwise allocate on every request.

---

### Q2. What does `pool.Get()` return when the pool is empty?

**Model answer.** It calls the `New` function field, if set, and returns its result. If `New` is nil, it returns `nil`. The type is `any`, so you need a type assertion.

**Common wrong answers.**
- "It blocks until something is available." (No — `Get` never blocks.)
- "It always returns nil if there is nothing." (No — `New` is invoked if set.)

---

### Q3. After calling `Put(x)`, can I still use `x`?

**Model answer.** No. Once you have put an object back, you must treat it as if it is gone. The pool may hand it to another goroutine on the next `Get`, or the garbage collector may reclaim it. Continuing to use `x` is a race at best and a use-after-free in spirit.

**Common wrong answers.**
- "Yes, as long as I do it from the same goroutine." (No — the pool may steal it across Ps even before the goroutine finishes.)

---

### Q4. Do I have to reset the object before `Put`?

**Model answer.** Yes. Whatever state the object had at `Put` time is the state the next consumer will see at `Get` time. For `bytes.Buffer`, that means calling `Reset()`. For a slice you have grown, it means `s[:0]` (keeping capacity) before `Put`. Forgetting this is the most common Pool bug.

---

### Q5. What is the `New` field?

**Model answer.** A `func() any` that constructs a fresh object when `Get` finds an empty pool. It is set once at pool creation and not changed afterwards. Without `New`, `Get` returns nil on miss.

---

### Q6. Is `sync.Pool` always faster than `new(T)`?

**Model answer.** No. For small, cheap allocations (a few bytes; primitives), the pool's overhead — the `pin`/`unpin`, the type assertion, the atomic CAS in the dequeue when stealing — can exceed the cost of just calling the allocator. Pools win for objects with measurable construction cost (buffers, encoders, parser state).

---

### Q7. Can two goroutines call `Get` on the same pool concurrently?

**Model answer.** Yes. `sync.Pool` is safe for concurrent use. Internally, each goroutine talks first to a per-P slot (no atomics on the fast path) and only contends with others if it has to steal from another P's queue.

---

### Q8. What happens to the pool at GC time?

**Model answer.** The runtime calls `poolCleanup` once per GC cycle with the world stopped. The cleanup shifts the current local cache into a "victim cache" and discards the previous victim cache. So pooled items survive between one and two GC cycles.

---

### Q9. Why is `sync.Pool` not generic?

**Model answer.** It predates Go generics (1.18). A generic `Pool[T]` proposal exists (issue 47657) but has not landed. The current API uses `any`, so callers must type-assert on `Get`.

---

### Q10. Is the order of items in the pool FIFO or LIFO?

**Model answer.** Neither, externally. The producer's local end is LIFO (it pushes and pops the head). Stealers pop from the tail (FIFO from the producer's view). Across multiple Ps with stealing and victim cache, there is no observable global order.

---

## Middle

### Q11. What is a `P` and why does the pool care about it?

**Model answer.** In the Go runtime scheduler, `P` is a *processor* — a logical execution context that holds the resources a goroutine needs to run on an OS thread (`M`). `GOMAXPROCS` controls the number of Ps. `sync.Pool` keeps a per-P slot so that goroutines on the same P (which cannot run simultaneously by definition) can share without atomics.

**Follow-up.** *What happens if `GOMAXPROCS` changes?* `pinSlow` resizes the per-P local array on the next `Get` after the change.

---

### Q12. Describe the fast path of `Get`.

**Model answer.** 

1. Call `pin()` to disable preemption and get the current P's index.
2. Read the per-P `local.private` field — if non-nil, store nil back and return the value. No atomics needed.
3. Otherwise, try `popHead` on the local shared queue.
4. Otherwise, fall back to `getSlow` which tries stealing from other Ps.
5. After `pin()` returns, the caller is responsible for `runtime_procUnpin()`.

**Follow-up.** *Why is step 2 race-free?* Because preemption is disabled while pinned, no other goroutine can be executing on this P, so `private` is single-threaded.

---

### Q13. What does `getSlow` do?

**Model answer.** It walks the `local` array starting from the next P after the current one, trying `popTail` on each P's shared queue. This is the "steal" path. If all locals are empty, it tries the victim cache the same way. If that is also empty, it returns nil (and the caller invokes `New`).

---

### Q14. Why does `Put` prefer the local private slot?

**Model answer.** Same reason `Get` does — no atomics. If `private` is nil, store the value there; otherwise push to the shared queue head.

---

### Q15. What is the victim cache?

**Model answer.** The previous-generation `local` array. At GC, the runtime moves `local → victim` and clears the old victim. `Get` consults `victim` only if `local` is empty. This means a freshly-GC'd pool still has items available — the victim items — instead of being completely empty.

**Follow-up.** *What bug did this fix?* Before Go 1.13, GC just cleared the pool, causing allocation cliffs immediately after every GC. The victim cache gives one cycle of grace.

---

### Q16. How does `poolDequeue` represent its ring?

**Model answer.** A `[]eface` of power-of-two length, plus an atomic `headTail` `uint64` that packs a 32-bit head and 32-bit tail. The dequeue holds items in `[tail, head)`; full when head == tail+len; empty when head == tail.

---

### Q17. Why pack head and tail in one word?

**Model answer.** So they can be updated together with a single CAS. The producer pushing to head and the stealer popping from tail are both reading and writing the *same* atomic word. Two separate atomics would race against each other and require an extra synchronization step.

---

### Q18. Why is the producer single-threaded but the consumer multi-threaded?

**Model answer.** Because only the owner of the P pushes (in `pushHead`) and only the owner pops from the same end (`popHead`). Other Ps stealing call `popTail` and can race with each other. The producer's exclusive access to the head end lets `pushHead` use a simpler algorithm than the multi-threaded steal end.

---

### Q19. Where does `procPin` come from?

**Model answer.** `runtime_procPin` is a `//go:linkname`-d call into the runtime that increments the current M's `locks` counter, preventing preemption. `procUnpin` decrements it. Pinning does not block GC — it just prevents the scheduler from yielding this goroutine until unpinned.

---

### Q20. What happens if a goroutine is preempted between `Get` and `Put`?

**Model answer.** Nothing wrong. The pool only pins around the actual `Get`/`Put` calls, not during the user's use of the object. Between those calls the goroutine can be preempted, migrated to a different P, or stopped by GC. When it later calls `Put`, the new P's local is used.

---

## Senior

### Q21. Walk through what happens when a goroutine on P3 calls `Get` and the only available object is on P1's shared queue.

**Model answer.**

1. `pin()` returns P=3.
2. `local[3].private` is nil → fast path miss.
3. `local[3].shared.popHead()` is called → empty → returns false.
4. `getSlow(3)` is invoked. It iterates `local[4], local[5], …, local[0], local[1], local[2]` calling `shared.popTail()` on each.
5. On `local[1].shared.popTail()`, it CAS's the tail forward, reads the eface from that slot, and returns it.
6. The value is returned to the caller and `procUnpin` is called.

The whole operation: one atomic CAS in the steal path. No mutex.

---

### Q22. What is `poolChain` and why is it not just a single `poolDequeue`?

**Model answer.** A `poolChain` is a doubly-linked list of `poolDequeue` ring buffers, each twice the size of its predecessor. When the head dequeue fills, a new one (with twice the capacity) is allocated and linked. This gives:

- **Geometric growth**: the chain can grow without bound, amortizing allocation cost.
- **No catastrophic mid-life resize**: existing dequeues are never rehashed.
- **Cleanup as items drain**: old empty dequeues are unlinked.

A single `poolDequeue` would be fixed-size at creation, forcing a choice between wasting memory and dropping items.

---

### Q23. How does `popTail` on `poolChain` differ from `popTail` on a single `poolDequeue`?

**Model answer.** `poolChain.popTail` walks from the *oldest* dequeue (the tail of the linked list) forward, trying `popTail` on each. When a dequeue drains and is no longer the head, it can be unlinked. The atomic `prev` pointer is set to nil after the last item is taken; the next stealer notices and updates the chain's tail pointer.

---

### Q24. What memory ordering does the headTail CAS imply?

**Model answer.** On Go, `atomic.Uint64.CompareAndSwap` is *sequentially consistent* — strongest possible ordering. On x86 it compiles to `LOCK CMPXCHGQ`, which is a full barrier. On ARM64 it compiles to a load-exclusive / store-exclusive loop with the implicit acquire-release of `LDAXR`/`STLXR`.

The practical implication: a successful `popTail` CAS happens-before the read of `vals[tail&mask]`, ensuring the popping consumer sees the value the producer wrote.

---

### Q25. Why does `poolLocal` have a `pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte`?

**Model answer.** To pad each `poolLocal` to a multiple of 128 bytes. On Intel CPUs, the L2/L3 prefetcher fetches pairs of adjacent 64-byte lines. If two Ps' locals shared adjacent lines, every `Put` on one P would invalidate the other P's prefetched line, causing RFO ping-pong. The pad guarantees each P's local lives entirely within its own 128-byte "natural" footprint.

---

### Q26. What is `pinSlow`?

**Model answer.** The cold path of `pin()`. It runs when the current P's index is out of range of the existing `local` array — typically right after `GOMAXPROCS` changes or on the very first `Get` of a new pool. It allocates a new `local` array of size `runtime.GOMAXPROCS(0)`, registers the pool in `allPools` (if not yet), and stores the new array atomically.

`pin()` itself is inlined and fast; `pinSlow` runs at most a handful of times in a process lifetime.

---

### Q27. Why is `poolCleanup` called with the world stopped?

**Model answer.** Two reasons:

1. It mutates `local` and `victim` pointers that are read concurrently by `pin()` and `getSlow`. Without STW, it would need atomics or locks on every pool access, defeating the design.
2. It must not allocate — running with the world stopped excludes any goroutine that could be holding `mheap.lock` or other internal locks.

---

### Q28. What is the relationship between `sync.Pool` and `runtime.GC`?

**Model answer.** `runtime.GC()` triggers a synchronous GC cycle, which fires the `poolcleanup` hook, which shifts `local → victim → discard`. So calling `runtime.GC()` twice in a row will completely drain every pool in the process — useful in benchmarks for ensuring a cold start.

---

### Q29. How does the pool behave under heavy contention?

**Model answer.** The local-private fast path has no atomics; the local-shared head also has no contention (single producer). Contention only arises when stealers fight on `popTail`. Even then, the dequeue uses a single CAS — much cheaper than a mutex. In practice, well-distributed Get/Put traffic spreads across Ps and contention is minimal.

If contention dominates, it usually means the pool is too small relative to in-flight objects — typically because the workload calls `New` more than `Put`.

---

### Q30. Compare `sync.Pool` to a `chan T` of buffers.

**Model answer.**

| Aspect | `sync.Pool` | `chan T` of size N |
|--------|-------------|--------------------|
| Concurrent fast path | Per-P, no atomics | One atomic per send/recv |
| Backpressure | None (always allocates on miss) | Producer blocks when full |
| Size bound | Unbounded (modulo GC) | Fixed at creation |
| GC interaction | Drained automatically | Held forever |
| FIFO order | Not guaranteed | Guaranteed |

The pool wins on raw throughput and GC pressure for opaque scratch objects. The channel wins when you need bounded resource control or specific ordering.

---

## Staff

### Q31. You profile a server and see 30% CPU in `sync.(*Pool).getSlow`. What does that tell you?

**Model answer.** It means the fast path is missing — the per-P local is consistently empty when `Get` runs. Common causes:

- The workload `Get`s more often than it `Put`s back. Look for missing `defer pool.Put(x)`.
- The objects are very short-lived and the GC keeps draining the local before reuse.
- `GOMAXPROCS` is high and items are spread thin across Ps; goroutines steal cross-P constantly.

Mitigation depends on the cause: fix missing `Put`s; size up the workload so each P has more in-flight; for small objects, consider eliminating the pool entirely (the GC may be cheaper).

---

### Q32. Design a per-CPU LRU using the same per-P primitives `sync.Pool` uses.

**Model answer.** Use `runtime_procPin`/`runtime_procUnpin` (via `//go:linkname` from internal/runtime/atomic) to access a per-P array of LRU shards. The shard structure can be a hand-rolled hash-with-list. The challenge is GC: you cannot register a `poolCleanup`-style hook in user code without `linkname` hackery. The accepted production pattern is to use `sync.Pool` for transient cache entries that you can tolerate losing on GC.

---

### Q33. The Go GC runs every 2 seconds in your workload, and your `sync.Pool` hit rate is 40%. How would you improve it?

**Model answer.**

1. Measure: instrument with a counter on `New` vs `Get` to confirm the 40% figure. Subtract victim hits from the missing 60% to know how many *true* allocations you are doing.
2. Possible interventions:
   - **Increase pool warmth**: pre-populate at startup with `pool.Put(make(...))` for the expected concurrency level.
   - **Reduce GC frequency**: bump `GOGC` (e.g., from 100 to 200) if heap budget allows; this halves the cleanup rate.
   - **Lower allocation rate elsewhere**: a slower GC frequency from reducing heap churn benefits the pool too.
   - **Switch to a non-GC-cooperating pool**: for very long-lived, very expensive objects, consider `bytebufferpool` or a hand-rolled MPMC channel-of-buffers that GC does not touch.

---

### Q34. Why doesn't `sync.Pool` have a `Len()` or `Cap()` method?

**Model answer.** Because the size is not a stable observable. The pool drains across GC cycles and grows across pushes; there is no atomic moment where "size" is meaningful. Exposing such a method would invite users to make decisions on a value that has no causal relationship with their next call. The omission is intentional.

---

### Q35. Could you implement `sync.Pool` without the runtime hook?

**Model answer.** Yes, with major caveats. You could use `runtime.SetFinalizer` on a sentinel object to detect GC, then clear the local from the finalizer. This was considered and rejected because:

- Finalizers run on a separate goroutine, so the clear race-windows with concurrent `Get`/`Put`.
- Finalizers can be delayed indefinitely.
- The world-stopped guarantee is impossible to replicate without a runtime hook.

The current design depends on cooperation between `sync` and `runtime`; the `//go:linkname` is the seam.
