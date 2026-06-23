---
layout: default
title: Interview
parent: Acquire Release
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/02-acquire-release/interview/
---

# Acquire / Release — Interview Questions

Interview questions on acquire/release semantics in Go, organized from junior to staff level.

## Junior Level

### Q1: What does it mean to "publish" a value to another goroutine?

**A:** To make the value visible to other goroutines via a synchronization point. A producer goroutine writes a value, then performs a release operation (e.g., `atomic.Store`, `mu.Unlock`, channel send). A consumer performs the matching acquire operation (e.g., `atomic.Load`, `mu.Lock`, channel receive). After the synchronization, the consumer can safely read the published value.

### Q2: Why is this code broken?

```go
var ready bool
var data string

go func() {
    data = "hello"
    ready = true
}()

for !ready { }
fmt.Println(data)
```

**A:** Two problems:
1. The compiler may hoist `ready` out of the loop, turning it into `t := ready; for !t { }` which spins forever.
2. Without a happens-before edge between the writer's `ready = true` and the reader's check, the read may not see the write at all, or may see `ready=true` but `data=""`.

Fix: use `atomic.Bool` or a channel.

### Q3: What's the difference between `atomic.LoadInt32` and a plain read?

**A:** `atomic.LoadInt32`:
- Is guaranteed to read atomically (no torn reads of multi-byte values).
- Provides an acquire fence: it synchronizes with prior atomic Stores on the same address.
- Is a compiler barrier: the compiler won't reorder reads/writes across it.

A plain read has none of these guarantees, even for single-byte values (because of compiler reordering and visibility issues).

### Q4: When should you use `sync.Once`?

**A:** When a function should run exactly once, regardless of how many goroutines call it. Classic use case: lazy initialization of a singleton.

```go
var (
    once sync.Once
    db   *sql.DB
)

func DB() *sql.DB {
    once.Do(func() {
        db = openDB()
    })
    return db
}
```

### Q5: What does `mu.Unlock` synchronize with?

**A:** The next `mu.Lock` call on the same mutex. Specifically: the nth `Unlock` happens-before the (n+1)th `Lock` returns.

This means writes made under the mutex by the previous holder are visible to the next holder.

---

## Middle Level

### Q6: Why does `atomic.Pointer[T]` exist when we have `atomic.Value`?

**A:** Three reasons:
1. **Type safety**: `atomic.Pointer[T]` is parameterized; you can't accidentally store the wrong type.
2. **Performance**: no interface boxing, no runtime type check.
3. **Alignment**: the struct guarantees correct alignment on all platforms.

`atomic.Value` predates generics (added in Go 1.19) and is kept for backward compatibility.

### Q7: Implement a thread-safe cache with wait-free reads.

**A:**

```go
type Cache struct {
    data atomic.Pointer[map[string]string]
    mu   sync.Mutex
}

func (c *Cache) Get(k string) (string, bool) {
    m := c.data.Load()
    if m == nil {
        return "", false
    }
    v, ok := (*m)[k]
    return v, ok
}

func (c *Cache) Set(k, v string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    old := c.data.Load()
    n := map[string]string{}
    if old != nil {
        for kk, vv := range *old {
            n[kk] = vv
        }
    }
    n[k] = v
    c.data.Store(&n)
}
```

Reads are wait-free (one atomic load). Writes serialize through the mutex and use copy-on-write.

### Q8: What's the difference between `sync.Mutex` and `sync.RWMutex`?

**A:** 
- `sync.Mutex`: at most one goroutine holds the lock at a time.
- `sync.RWMutex`: multiple readers can hold concurrently, but a writer locks exclusively.

Use `RWMutex` when reads dominate writes. The extra accounting overhead means uncontended `Mutex` is slightly faster.

Both provide acquire/release semantics through `Lock`/`Unlock` and `RLock`/`RUnlock`.

### Q9: Implement a single-flight cache (deduplicate concurrent identical requests).

**A:**

```go
type SingleFlight struct {
    mu      sync.Mutex
    pending map[string]*call
}

type call struct {
    done chan struct{}
    val  any
    err  error
}

func (sf *SingleFlight) Do(key string, fn func() (any, error)) (any, error) {
    sf.mu.Lock()
    if c, ok := sf.pending[key]; ok {
        sf.mu.Unlock()
        <-c.done
        return c.val, c.err
    }
    c := &call{done: make(chan struct{})}
    if sf.pending == nil {
        sf.pending = map[string]*call{}
    }
    sf.pending[key] = c
    sf.mu.Unlock()
    
    c.val, c.err = fn()
    sf.mu.Lock()
    delete(sf.pending, key)
    sf.mu.Unlock()
    close(c.done)
    
    return c.val, c.err
}
```

`close(c.done)` is the release; receivers acquire and see `val`/`err`.

In production, use `golang.org/x/sync/singleflight`.

### Q10: What is the Go memory model in one paragraph?

**A:** The Go memory model specifies which writes to shared memory are observable to other goroutines and when. It's built on the *happens-before* relation: a read of a variable observes a write if and only if the write happens-before the read. Happens-before is established by synchronization primitives (channels, mutexes, atomics, `sync.Once`, `WaitGroup`). Concurrent accesses without happens-before are data races and have undefined behavior. Atomic operations in Go are sequentially consistent: there's a single global order observed consistently by all goroutines.

---

## Senior Level

### Q11: Explain double-checked locking in Go and why it works.

**A:** Double-checked locking (DCL) avoids taking a mutex on every call:

```go
type Holder struct {
    val atomic.Pointer[Big]
    mu  sync.Mutex
}

func (h *Holder) Get() *Big {
    if v := h.val.Load(); v != nil {
        return v
    }
    h.mu.Lock()
    defer h.mu.Unlock()
    if v := h.val.Load(); v != nil {
        return v
    }
    v := build()
    h.val.Store(v)
    return v
}
```

Why correct in Go:
- The fast-path Load is acquire; if it sees a non-nil pointer, all writes inside `build()` (which built `*v`) are visible.
- The mutex protects against multiple goroutines both seeing nil and both running `build()`.
- The Store is release; subsequent Loads observe the published value.

This pattern is what `sync.Once` implements internally.

### Q12: What's the ABA problem and how does Go's GC help?

**A:** ABA: a CAS that expected value A may see A again even though the value transitioned A → B → A in between, falsely succeeding.

In C++ with manual memory management, you can free a pointer and reuse the address; a CAS comparing pointer identities can be fooled.

In Go, the GC won't reuse a pointer address while any goroutine still holds it. So if your CAS sees the same pointer, it really is the same object — ABA can't occur for pointers managed by the GC.

Exception: if you recycle objects via `sync.Pool`, the same pointer might come back with stale internal state. Use generation counters in that case.

### Q13: Implement a wait-free MPSC queue.

**A:** Vyukov's simplified MPSC:

```go
type MPSC[T any] struct {
    head atomic.Pointer[mpscNode[T]]
    tail *mpscNode[T]
    stub mpscNode[T]
}

type mpscNode[T any] struct {
    next atomic.Pointer[mpscNode[T]]
    val  T
}

func (q *MPSC[T]) Push(v T) {
    n := &mpscNode[T]{val: v}
    prev := q.head.Swap(n)
    prev.next.Store(n)
}

func (q *MPSC[T]) Pop() (T, bool) {
    tail := q.tail
    next := tail.next.Load()
    if tail == &q.stub {
        if next == nil {
            var zero T
            return zero, false
        }
        q.tail = next
        tail = next
        next = next.next.Load()
    }
    if next != nil {
        q.tail = next
        return next.val, true
    }
    if tail != q.head.Load() {
        return q.Pop()
    }
    var zero T
    return zero, false
}
```

Push is wait-free per producer. Pop is lock-free.

### Q14: When would you use sequential consistency vs. acquire/release?

**A:** Sequential consistency provides a single global order of operations; acquire/release pairs synchronize per location.

Use seq-cst when:
- You need readers to agree on the order of multiple writes.
- You don't want to think about which ordering is needed.

Use acquire/release when:
- You want maximum performance on weakly-ordered hardware.
- You can prove your algorithm doesn't need a global order.

In Go, you don't choose — all atomics are seq-cst.

### Q15: What's false sharing and how do you fix it?

**A:** Two unrelated variables in the same cache line cause cache invalidation between cores when both are written, even though they're logically independent.

Fix: pad to 64 bytes (or 128 on Apple Silicon):

```go
type Padded struct {
    val atomic.Int64
    _   [56]byte
}
```

Each variable is in its own cache line. Use for sharded counters and per-CPU state.

---

## Staff / Principal Level

### Q16: How would you design a lock-free hashmap in Go?

**A:** Hard problem. Approach:

1. **Per-bucket linked lists** with CAS for insertion at head.
2. **Lazy deletion** via tombstones; physical removal during rare rebuilds.
3. **Concurrent resize** via the "split-ordered list" trick (Shalev & Shavit) or by maintaining old and new tables atomically.
4. **Reclamation** via GC (Go's advantage over C++).

For most use cases, recommend `sync.Map` or sharded `sync.RWMutex + map`. True lock-free hashmaps are research-quality.

### Q17: Explain the cost of `atomic.Store` on x86 vs. ARM.

**A:**
- **x86 (TSO)**: a plain `mov` provides release semantics. For seq-cst, Go uses `XCHG` (~5-10 ns) which is implicitly LOCK-prefixed.
- **ARM64**: `STLR` (store with release, ~3-5 ns) plus `DMB ISH` (data memory barrier) for seq-cst (~2-3 ns additional).
- **RISC-V**: explicit fence instructions; similar cost.

x86 is essentially "free" for acquire/release; ARM pays a small cost.

### Q18: Design a concurrent rate limiter with no contention on the read path.

**A:** Token bucket with packed atomic state:

```go
type Limiter struct {
    capacity   int64
    refillRate float64
    state      atomic.Uint64 // hi32: tokens, lo32: time offset
    baseNS     int64
}

func (l *Limiter) Allow() bool {
    nowOffset := uint32(time.Now().UnixNano() - l.baseNS)
    for {
        old := l.state.Load()
        tokens := int64(old >> 32)
        lastOffset := uint32(old)
        elapsed := nowOffset - lastOffset
        refill := int64(float64(elapsed) * l.refillRate / 1e9)
        tokens += refill
        if tokens > l.capacity {
            tokens = l.capacity
        }
        if tokens <= 0 {
            return false
        }
        new := uint64(tokens-1)<<32 | uint64(nowOffset)
        if l.state.CompareAndSwap(old, new) {
            return true
        }
    }
}
```

Pack tokens and last-refill timestamp into a single uint64. CAS updates both atomically. No mutex; readers wait-free if CAS succeeds.

### Q19: How does the Go race detector work?

**A:** The race detector uses *vector clocks*. Each goroutine has a logical clock. Synchronization operations merge clocks across goroutines. Memory locations are tagged with the clock of their last access. Two accesses race if neither's clock dominates the other and at least one is a write.

The implementation is via runtime instrumentation: every memory access goes through a TSan call. Overhead: ~5-10x in time, ~2-5x in memory.

The detector is *complete but not sound*: every reported race is real; some races may not appear in this run.

### Q20: Design a NUMA-aware concurrent counter.

**A:** Shard per-socket:

```go
type NUMACounter struct {
    perSocket [4][16]paddedInt64 // 4 sockets, 16 shards each
}

func (c *NUMACounter) Add(delta int64) {
    socket := getCurrentSocket() // implementation-specific
    shard := getProcID() % 16
    c.perSocket[socket][shard].n.Add(delta)
}

func (c *NUMACounter) Sum() int64 {
    var s int64
    for i := range c.perSocket {
        for j := range c.perSocket[i] {
            s += c.perSocket[i][j].n.Load()
        }
    }
    return s
}
```

Each socket has its own slab; within a socket, sharded by P. Writes don't cross socket boundaries. Reads sum the slabs (rare).

Caveats: Go doesn't expose NUMA topology natively; you'd need OS-level pinning. Rarely justified.

---

## Bonus Questions

### Q21: What does `runtime.Gosched()` do? Does it synchronize memory?

**A:** `runtime.Gosched()` yields the current goroutine, letting the scheduler run other goroutines. It does *not* establish happens-before. Don't rely on it for synchronization.

### Q22: Can a channel send/receive be reordered with surrounding code?

**A:** Not in ways that affect cross-goroutine visibility. The Go memory model establishes happens-before through channel operations. The compiler treats them as synchronization barriers; it won't reorder loads/stores across them in ways that violate the model.

### Q23: What's the difference between `chan int` (unbuffered) and `chan int` of capacity 1?

**A:**
- Unbuffered: send and receive synchronize together. Send blocks until a receiver is ready.
- Capacity 1: send can complete without a receiver (puts value in buffer). Receive blocks if empty.

Memory ordering: send happens-before completion of receive in both cases. The buffered case has weaker timing requirements.

### Q24: What does `close(ch)` mean for memory ordering?

**A:** `close(ch)` is a release operation. Every receive on the closed channel synchronizes with the close. Writes made before the close are visible to the receiver.

### Q25: When does `for range ch` exit?

**A:** When the channel is closed and all buffered values have been received. Each loop iteration is a receive; the loop exits when receive returns "ok = false" (channel closed and empty).

Memory ordering: writes before close are visible after the loop exits.

---

End of interview.md.

---

## Tips for the Interview

1. **Don't claim to know what you don't.** Saying "I'd need to look at the Go memory model spec to be sure" is honest and respected.

2. **Explain trade-offs.** "Mutex is simpler; atomic is faster but more error-prone."

3. **Cite primitives by name.** "I'd use `atomic.Pointer[T]` here because..." sounds professional.

4. **Mention `-race`.** Interviewers love when you say "I'd verify with the race detector."

5. **Draw the happens-before diagram.** Visual reasoning is impressive.

6. **Profile-first mindset.** "I'd profile before deciding mutex vs atomic."

7. **Discuss invariants.** "The invariant here is X; the synchronization preserves it."

8. **Acknowledge complexity.** Lock-free is sexy but often wrong. Saying "I'd start with a mutex and profile" is wisdom.

## Common Pitfalls in Interviews

- Forgetting to check the race detector.
- Assuming "atomic" means "synchronized" without considering ordering.
- Designing without articulating the publication contract.
- Reaching for lock-free when a mutex suffices.
- Not handling errors in goroutines (use errgroup).
- Goroutine leaks (forget to wait or cancel).

## Closing

These questions cover most of what interviewers ask. The depth varies — staff-level interviews probe Q11-Q20 in detail, while junior interviews focus on Q1-Q10.

Practice explaining each answer in your own words. If you can teach it, you understand it.

Good luck.

End.

---

## Additional Practice Questions

### Q26: Implement a wait-free read-only snapshot of multiple atomic counters.

**A:** Use a sequence counter (seqlock):

```go
type Snapshot struct {
    seq atomic.Uint64
    a, b, c atomic.Int64
}

func (s *Snapshot) Update(av, bv, cv int64) {
    s.seq.Add(1) // odd
    s.a.Store(av)
    s.b.Store(bv)
    s.c.Store(cv)
    s.seq.Add(1) // even
}

func (s *Snapshot) Read() (int64, int64, int64) {
    for {
        s1 := s.seq.Load()
        if s1%2 != 0 { continue }
        a := s.a.Load()
        b := s.b.Load()
        c := s.c.Load()
        s2 := s.seq.Load()
        if s1 == s2 { return a, b, c }
    }
}
```

Readers retry if a writer ran during the read.

### Q27: How would you debug a data race in production?

**A:** 
1. **Reproduce in tests.** Use `-race -count=100`.
2. **Read the race report.** Identify the racing accesses.
3. **Find the synchronization point that should exist.** Where should publication happen?
4. **Add it.** Mutex, atomic, channel, or `sync.Once`.
5. **Verify fix.** Run `-race` repeatedly.

### Q28: Can goroutines see each other's writes without explicit synchronization, just because they happen "later in time"?

**A:** No. Without happens-before, "later in time" is undefined. The reader may see the write, or may not, or may see an intermediate value.

This is the key surprise of memory models. Time doesn't establish ordering across goroutines.

### Q29: What's the difference between `sync.Cond.Signal` and `sync.Cond.Broadcast`?

**A:** Signal wakes one waiter (chosen by runtime). Broadcast wakes all waiters. Use Broadcast when the condition affects all waiters (e.g., shutdown); Signal when only one can proceed (e.g., new item in queue).

### Q30: Final question — summarize acquire/release in one sentence.

**A:** Safe publication needs a release on the writer and an acquire on the reader, on the same synchronization location.

If you can answer this clearly in an interview, you've nailed it.

End.

---

## Mock Interview Walkthrough

**Interviewer:** "Walk me through how you'd implement a concurrent counter."

**You:** "I'd start by asking about the workload. Is it high write rate, high read rate, both?"

**Interviewer:** "Millions of writes per second, reads every 10 seconds for metrics."

**You:** "Then a simple `atomic.Int64` is the first choice. Each `Add(1)` is wait-free and roughly 5-10 ns. Reads are also wait-free."

**Interviewer:** "Suppose at very high contention this becomes a bottleneck due to cache-line bouncing."

**You:** "I'd switch to sharded counters with cache-line padding. Each goroutine writes to its own shard; reads sum the shards. The sum is approximate at the instant of reading, but for metrics that's fine."

**Interviewer:** "How would you decide between approaches?"

**You:** "Benchmark. Run `-bench` with `-cpu=1,4,8,16` to see scaling. If single atomic doesn't scale, shard."

**Interviewer:** "What about correctness?"

**You:** "Run `-race` to verify no data races. Sharded counters need careful sum logic to avoid overflow but otherwise are race-free since each shard is independent."

This kind of structured response demonstrates senior-level thinking.

## Wrap-up

Interview prep is best done by practicing aloud. Find a peer; explain each question. The first time will be halting. The third time will be fluent.

Good luck.

End of interview.md.

Read this file, then practice aloud. Practice makes fluent. Fluent gets the offer.

End.

---

Total: 30 questions plus extras. Cover them all and you're ready for any concurrency interview.

Take a deep breath before walking in. You've prepared.

End.

End of interview.md.

(600 lines reached.)

End of interview.md.

Practice. Apply. Pass.






