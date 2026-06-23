# Lock-Free Data Structures — Interview Questions

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Staff and Principal Questions](#staff-and-principal-questions)
5. [Design Discussion Questions](#design-discussion-questions)
6. [Tricky Trap Questions](#tricky-trap-questions)
7. [What to Bring Up Unprompted](#what-to-bring-up-unprompted)

---

## Junior Questions

### Q1. What does "lock-free" mean?

A data structure is lock-free if at least one thread always makes progress, even when other threads are paused. No thread holds a mutex. Operations are implemented with atomic primitives — typically `CompareAndSwap`.

The phrase does not mean "no synchronisation" — there is synchronisation, via atomics. It does not mean "faster than locks" — that depends on the workload. It means *robust against thread suspension*.

### Q2. Write the Treiber stack push and pop.

```go
type Node[V any] struct {
    val  V
    next *Node[V]
}

type Stack[V any] struct {
    head atomic.Pointer[Node[V]]
}

func (s *Stack[V]) Push(v V) {
    n := &Node[V]{val: v}
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}

func (s *Stack[V]) Pop() (V, bool) {
    var zero V
    for {
        top := s.head.Load()
        if top == nil {
            return zero, false
        }
        if s.head.CompareAndSwap(top, top.next) {
            return top.val, true
        }
    }
}
```

### Q3. Why is this Pop safe from ABA in Go but not in C?

In C, after the popper reads `top`, another thread can `free(top)` and the allocator can return the same address from a fresh `malloc`. The popper's CAS then sees the same pointer value but the stack state is completely different — ABA.

In Go, the popper's local variable `top` holds a reference. The GC will not free the underlying node while any reference is live. So no other thread can re-push a node at the same address; ABA on pointers is impossible.

This protection is specific to GC'd languages and to `*T` (not `unsafe.Pointer` or integer indices).

### Q4. What is the linearization point of Treiber Push?

The successful `CompareAndSwap(head, old, n)`. Before the CAS, `n` is invisible to other threads. After the CAS, `head` points to `n` and any subsequent reader observes the new state. The CAS is a single atomic instant.

### Q5. Why does the Michael-Scott queue use two CASes per enqueue?

The enqueue must update two atomic words: the previous-tail's `next` pointer and the queue's `tail` pointer. CAS works on a single word. So two CASes minimum — unless the hardware exposes double-word CAS (which Go does not expose via `sync/atomic`).

The first CAS links the new node. The second advances `tail`. Between them, `tail` lags by one node, which other operations handle via the "help advance tail" pattern.

---

## Middle Questions

### Q6. What is the helping pattern in MS-Queue?

When enqueue is between its two CASes, `tail` lags the actual end of the list by one node. Other threads observing this state cannot wait — that would defeat lock-freedom. Instead, any thread that sees a lagging tail performs the second CAS itself ("helping"), advancing tail past the new node.

The pattern preserves lock-freedom: even if the original enqueuer is descheduled forever, other threads keep the queue moving.

### Q7. Why does Harris's list use a mark bit on the next pointer?

A naive delete swings `pred.next` past the doomed node. A concurrent insert that intended to insert *after* the doomed node would silently lose its new node.

The mark bit makes delete a two-step operation: first mark the doomed node's `next` (logical delete), then physically unlink. After marking, no insert can CAS through the doomed node because the doomed node's `next` is now marked. The CAS observes the mark and retries.

The mark bit is the synchronisation point that prevents the lost-insert race.

### Q8. Why pad atomic counters?

Adjacent atomic counters on the same cache line cause **false sharing**: writes to one invalidate the cache line for cores reading the other, even though the values are logically independent. The cost can be 5-10x throughput loss.

Padding to 64 bytes (or 128 on Apple ARM) puts each counter on its own cache line. The penalty disappears.

In Go, use explicit byte padding: `_pad [56]byte` between two `atomic.Uint64`s.

### Q9. When should I use Vyukov's MPSC queue instead of a channel?

A buffered channel is already MPSC and is usually fast enough. Reach for Vyukov's MPSC when:

- The channel is profile-proven to be the bottleneck.
- The consumer is a tight loop with no `select` or `range` semantics.
- Throughput requirements exceed ~20M ops/sec, which is roughly where a channel saturates.

For most application code, a channel is the right answer.

### Q10. What is the SPSC ring buffer's progress guarantee?

Both producer and consumer are wait-free *in isolation*: each op consists of a bounded number of atomic loads and one atomic store, with no retries. The structure is the fastest non-blocking queue possible because there is no CAS on the fast path.

The wait-freedom relies on the SPSC restriction: exactly one producer, exactly one consumer. With more producers or consumers, the structure breaks.

---

## Senior Questions

### Q11. How does Vyukov's bounded MPMC queue work?

Each cell of a fixed-size array has a sequence number. The protocol:

- Cell `i` starts with `seq = i`.
- Producer at logical position `pos`: wait until `cell[pos].seq == pos`, write the value, set `seq = pos + 1`.
- Consumer at logical position `pos`: wait until `cell[pos].seq == pos + 1`, read the value, set `seq = pos + capacity`.

Atomic `enqPos` and `deqPos` advance via CAS. The sequence number distinguishes ready/not-ready/full/empty cases without needing version counters or pointer comparisons.

ABA-immune by construction: the sequence number cycles by `capacity` per slot, not by value.

### Q12. What is the difference between hazard pointers and EBR?

Both protect against use-after-free in lock-free structures without a GC.

**Hazard pointers (Michael, 2002):** each reader publishes the pointers it is about to dereference. Writers scan all readers' published pointers before freeing. Per-pointer protection, bounded memory growth.

**Epoch-based reclamation (Fraser, 2004):** there is a global epoch. Readers pin themselves to the current epoch during a critical section. Writers retire nodes per-epoch and free them once all readers have advanced past the retire epoch. Cheaper fast path; memory unbounded if a reader is stalled.

Choose hazard pointers when critical sections may block. Choose EBR when critical sections are short and throughput matters.

### Q13. Why does the Click hash map use a "primed" value during resize?

Resize is incremental: writers help move entries from old table to new. While in transit, a slot's value is marked "primed" to signal "this entry has moved to the new table; readers should redirect." A reader encountering a primed value re-runs its lookup in the new table.

The primed state is a third value in the slot's state machine alongside present-and-tombstone. It enables concurrent resize without locks or stop-the-world.

### Q14. Why is lock-free harder in Go than in C++?

Counterintuitive, because Go's GC and seq-cst atomics simplify some reasoning. But:

- Go does not expose tagged pointers cleanly. You wrap pointers in structs and pay an extra indirection.
- Go does not expose DWCAS. Two-word atomic updates need workarounds.
- Go does not expose memory ordering relaxation. Every atomic is seq-cst, which is conservative for performance.
- Go does not expose thread IDs. Per-thread state needs `procPin`/`procUnpin` via linkname, which is unstable.
- Go's `sync/atomic` types do not support generic value types directly; you allocate.

In return, you avoid manual memory management. For application code, the trade is good. For systems code, C++ or Rust gives you more knobs.

### Q15. When does lock-free actually lose to a mutex?

Several cases:

- **Low contention.** Uncontended `sync.Mutex` Lock/Unlock is ~20 ns. A CAS loop with one iteration is ~10 ns but adds branch mispredictions and cache line moves. At 1-2 cores, the mutex often wins on real workloads.
- **Highly-variable work between ops.** If each op is followed by 1 microsecond of work, the lock is held briefly and contention is rare. The mutex wins because its uncontended path is cheap.
- **Complex data structures.** A lock-free B-tree is a research problem. A locking B-tree is a library. The complexity gap dominates.
- **Memory pressure.** Lock-free structures often allocate per op (one node per push). A locking structure can reuse storage in place. The GC cost can erase the lock-free win.

Profile first. Lock-free without a profile is premature optimisation in a hard-to-debug form.

---

## Staff and Principal Questions

### Q16. Walk me through designing a lock-free LRU cache.

Honest answer: do not. A lock-free LRU is one of the genuinely hard concurrent data structures. The LRU eviction policy requires a serialised view of access order, which conflicts with the parallelism a lock-free design buys.

The production answer is segmented LRUs: shard the cache into N independent LRUs, each protected by its own mutex. Per-shard contention is low; each shard's LRU is sequential and simple. Ristretto-style admission policies (TinyLFU, sampling) further reduce the need for strict LRU.

If pressed: the closest lock-free design is concurrent linked hash maps with batched ordering updates. References: Ben-David et al. *Concurrent Lock-Free Skip List*, 2018; the BP-Wrapper paper for batched ordering. But the engineering effort is huge, and shard-of-LRU is usually within 20% on throughput.

### Q17. How do you test a lock-free data structure?

Layers:

1. **Unit tests with serial semantics.** Push 1000 items, pop 1000, confirm order/content.
2. **Race detector.** `go test -race -count=1000`. Catches data races on non-atomic accesses.
3. **Stress tests.** N goroutines pushing, M popping, for some time T. At quiescence, count of pushed = count of popped + items remaining. Run with various N and M.
4. **Property-based tests.** Use `testing/quick` or `pgregory.net/rapid` to generate random op sequences and check linearizability against a sequential model.
5. **Memory tests.** Allocations under sustained load. Heap profiles to detect unbounded growth.
6. **Performance regression tests.** Baseline benchmarks, compare on every change.

For real production code: also run `go test -msan` if you have CGO, and consider TLA+ modelling for the critical paths.

### Q18. How do you decide reclamation strategy in Go?

Default: rely on the GC. Most lock-free Go code does this.

Escalate to EBR-with-procPin if:

- Heap profile shows the structure as a major allocation source.
- GC pause times threaten latency SLA.
- The structure churns nodes faster than the GC can free them.

Escalate to hazard pointers if:

- Critical sections can block (syscalls, channel ops).
- You need bounded memory regardless of thread behaviour.
- You are interoperating with C lock-free libraries.

Move back to a mutex if:

- The structure is not a hot path.
- Maintenance cost outweighs throughput gain.

### Q19. How would you debug a lock-free queue that occasionally loses an element?

The diagnosis path:

1. **Reproduce under `-race`.** A data race on a non-atomic field is the most common cause. Sometimes the race detector finds it instantly; sometimes the bug is rare and you need `-count=10000`.
2. **Add invariant checks.** Track total pushed and total popped via atomic counters. At quiescence, assert the difference equals `Len()`. Run stress tests with the invariants checked every iteration.
3. **Inspect the linearization point.** Identify the CAS that must succeed for each op. Confirm that the CAS observed value matches the value the algorithm requires.
4. **Check memory model.** Are non-atomic fields written before the publishing CAS? In Go this is usually fine, but a misplaced field in a non-atomic struct can race.
5. **Check ABA.** If the structure uses `unsafe.Pointer` or integer indices, suspect ABA. Add a version counter and rerun.
6. **Check helping.** If the structure has a help-advance pattern (MS-queue), confirm the helper CAS uses the correct from-value.

If none of these find it, simplify the test until the bug disappears, then reintroduce complexity to bisect.

### Q20. When you see a lock-free design in a code review, what do you ask?

A standard checklist:

- Where is the linearization point of each operation? Document each.
- What is the ABA story? GC, version counter, sequence number?
- What is the reclamation story? GC, EBR, hazard pointers?
- Is contention realistic? Has the workload been profiled?
- Are there benchmarks at 1, 2, 4, 8, 16 cores against a mutex baseline?
- Is there padding to prevent false sharing? Is it asserted in tests?
- Are there stress tests under `-race`?
- Is the design documented with a paper citation?
- Could a `sync.Mutex` + standard collection do this?

The last question is the most important. The answer "yes, but slower" needs a profile to justify the complexity.

---

## Design Discussion Questions

### Q21. Design a high-throughput logging library.

Architecture sketch:

- **Per-goroutine local buffers.** Goroutines write log entries to thread-local-ish buffers (using `procPin` to anchor to a P).
- **MPSC queue per P** feeding a single writer goroutine. Vyukov's intrusive MPSC fits.
- **Single writer** drains all P-queues and writes to disk or network.
- **Backpressure** via bounded buffers and a drop-or-block policy at the producer side.

The lock-free wins live in the producer side (zero contention on the writer side, MPSC is wait-free for producers). The disk-write side is single-threaded and naturally serial.

This is approximately how Uber's `zap` and Cloudflare's logging stacks are structured.

### Q22. Design a concurrent counter for Prometheus metrics.

Sharded `atomic.Int64`. One shard per P. Increment uses `procPin` to pick a shard and `Add(delta)`. Read sums across shards.

For histograms: array of counters, one per bucket. Same sharding. Bucket assignment via pre-computed boundaries and binary search, or a bit-trick on float64 exponent for power-of-2 buckets.

Why not a mutex? Counter increments are frequent and the work per op is tiny (one ADD instruction equivalent). Mutex overhead dominates.

Why not a single `atomic.Int64`? Cache-line contention on many-core machines. Sharding spreads it.

### Q23. Design a work-stealing scheduler.

Each worker has a local deque. Owners push and pop from the bottom (LIFO); thieves steal from the top (FIFO).

The local deque is the Chase-Lev work-stealing deque (2005): lock-free for the owner, lock-free for thieves, supports single-owner-multi-thief access. Both ends use atomics with careful ordering.

Go's runtime scheduler uses a variant. Read `runtime/proc.go` for the production implementation.

### Q24. Design a rate limiter for an API gateway.

Token bucket per key. Two designs:

- **Per-key mutex + counter.** Simple. Scales to ~10K keys per CPU before contention.
- **Lock-free sharded.** Shard keys by hash. Each shard is a `sync.Map[string, *atomic.Int64]`. Tokens are atomic counts. Refill is a background goroutine doing batched `Add` per shard.

For most workloads the mutex version is fine. The lock-free version earns its keep when keys are concentrated on a few hot endpoints and the mutex contention becomes the gateway's bottleneck.

---

## Tricky Trap Questions

### Q25. Is `atomic.Pointer[T]` ABA-safe in Go?

For comparison (CAS), pointer values are compared. In Go, if a `*T` is in a CAS that succeeds, the pointer is bit-identical to what was loaded earlier. The GC guarantees the underlying allocation has not been reused as a different `*T`. So CAS on `atomic.Pointer[T]` is ABA-safe in Go for normal pointer flows.

Trap: this protection breaks if you use `unsafe.Pointer` to alias the same address as different types, or if you store integers cast to pointers. Stay within type-safe Go and ABA on pointer CAS is impossible.

### Q26. Can I make a lock-free queue with `chan` internally?

No, because `chan` operations are not lock-free. A blocked `<-ch` parks the goroutine, which is the opposite of lock-free.

You can build a lock-free queue using `atomic.Pointer` and `atomic.Uint64` only. Channels are a separate abstraction with different progress properties.

### Q27. What is wrong with this Pop?

```go
func (s *Stack) Pop() (int, bool) {
    top := s.head.Load()
    if top == nil {
        return 0, false
    }
    next := top.next
    s.head.Store(next)
    return top.val, true
}
```

The `Store` is unconditional. Two concurrent Pops can both read the same `top`, both compute `next`, and both `Store(next)`. The stack loses an element.

Fix: replace `Store` with `CompareAndSwap` and loop on failure.

### Q28. What is wrong with this Enqueue?

```go
func (q *MSQueue) Enqueue(v int) {
    n := &Node{val: v}
    for {
        tail := q.tail.Load()
        next := tail.next.Load()
        if next != nil {
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        if tail.next.CompareAndSwap(nil, n) {
            q.tail.CompareAndSwap(tail, n)
            return
        }
    }
}
```

This is mostly correct. The subtle issue: between `q.tail.Load()` and `tail.next.Load()`, another thread could have dequeued and freed... no, in Go the GC pins. So this is actually fine in Go.

In C++ without hazard pointers, this races: `tail` could have been freed. In Go, no.

The trap: the question tests whether you spot the false alarm. The answer is "this is correct in Go; in C++ it needs reclamation."

### Q29. Why doesn't the SPSC ring buffer need CAS?

Because there is exactly one producer and one consumer. The producer is the only writer of `tail`; the consumer is the only writer of `head`. Each can use plain `Store` to publish, plain `Load` to observe. No two threads compete for the same write, so CAS — which exists to resolve such competition — is unnecessary.

Lose the SPSC restriction (add a second producer) and you immediately need CAS on `tail`.

### Q30. The lock-free hash map is "wait-free for reads." What does that mean?

Reads consist of a fixed-bounded sequence of probes through the table. No retries, no waiting. Every read completes in `O(probe_length)` time regardless of concurrent writers.

Writes can retry on CAS failure, so writes are lock-free but not wait-free.

The asymmetric guarantee — wait-free reads, lock-free writes — is the reason Click-style maps shine in read-heavy workloads.

---

## What to Bring Up Unprompted

When asked an open-ended question about lock-free data structures, mentioning these without prompting signals senior-level grasp:

- **The GC's role.** Go's GC eliminates a large class of ABA bugs but adds GC pressure under high node churn.
- **False sharing.** It is the most common reason a textbook-correct lock-free design underperforms.
- **Linearization points.** Naming them is the first step in any correctness argument.
- **The honest trade-off.** Lock-free wins narrowly; mutex wins broadly. Profile before choosing.
- **Memory reclamation alternatives.** Hazard pointers and EBR; their trade-offs.
- **The standard library.** `sync.Map`, `sync.Pool` are already lock-free-ish and are usually the right answer.
- **The Go runtime.** It is the largest body of production lock-free Go code; reading it is the best apprenticeship.

What to avoid:

- Claiming lock-free is universally faster.
- Skipping over memory reclamation as "Go handles it."
- Presenting Treiber/MS as solved without mentioning the helping pattern.
- Promoting custom lock-free over the standard library without a profile.

---

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — CAS, the universal primitive
- [02-aba-problem](../02-aba-problem/) — ABA in depth
- [04-memory-fences](../04-memory-fences/) — Memory ordering
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress hierarchy
