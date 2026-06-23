# Lock-Free Data Structures — Hands-On Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Junior Tasks](#junior-tasks)
3. [Middle Tasks](#middle-tasks)
4. [Senior Tasks](#senior-tasks)
5. [Professional Tasks](#professional-tasks)
6. [Capstone Project](#capstone-project)

---

## How to Use This File

Each task has:

- A **statement** of the problem.
- A list of **constraints** (what you must use, what you must avoid).
- An **acceptance test** (a runnable Go test that should pass).
- A **solution sketch** (one workable answer; not the only answer).
- A list of **what to learn** from completing it.

Do each task without looking at the sketch first. The point is exercising the patterns. The sketch is for after you have written your own.

Hardware target: any modern x86 or ARM machine. Use `go test -race` for every solution.

---

## Junior Tasks

### Task J1. Implement a Treiber stack with generics.

**Statement.** Write a generic lock-free stack `Stack[V any]` with `Push(v V)`, `Pop() (V, bool)`, and `Len() int` (approximate is fine).

**Constraints.**
- Use only `sync/atomic`. No mutex, no channel.
- Must compile with `go vet`.
- Must pass `go test -race`.

**Acceptance test.**
```go
func TestTreiberConcurrent(t *testing.T) {
    s := &Stack[int]{}
    const N = 1000
    var wg sync.WaitGroup
    for g := 0; g < 8; g++ {
        wg.Add(1)
        go func(start int) {
            defer wg.Done()
            for i := 0; i < N; i++ {
                s.Push(start*N + i)
            }
        }(g)
    }
    wg.Wait()
    seen := make(map[int]bool)
    for {
        v, ok := s.Pop()
        if !ok {
            break
        }
        if seen[v] {
            t.Fatalf("dup %d", v)
        }
        seen[v] = true
    }
    if len(seen) != 8*N {
        t.Fatalf("got %d want %d", len(seen), 8*N)
    }
}
```

**Solution sketch.**
```go
type node[V any] struct {
    val  V
    next *node[V]
}

type Stack[V any] struct {
    head atomic.Pointer[node[V]]
    n    atomic.Int64
}

func (s *Stack[V]) Push(v V) {
    n := &node[V]{val: v}
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            s.n.Add(1)
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
            s.n.Add(-1)
            return top.val, true
        }
    }
}

func (s *Stack[V]) Len() int { return int(s.n.Load()) }
```

**What to learn.** The CAS loop pattern. That `Len()` is approximate even with an atomic counter. Why Go's GC means you do not need a hazard pointer here.

---

### Task J2. Implement Michael-Scott queue.

**Statement.** Write a lock-free FIFO queue with `Enqueue(v V)` and `Dequeue() (V, bool)`.

**Constraints.**
- Use the dummy-node pattern.
- Help advance the tail.
- Use only `sync/atomic`.

**Acceptance test.**
```go
func TestMSQueueFIFO(t *testing.T) {
    q := NewQueue[int]()
    const N = 10000
    var wg sync.WaitGroup
    for g := 0; g < 4; g++ {
        wg.Add(1)
        go func(start int) {
            defer wg.Done()
            for i := 0; i < N; i++ {
                q.Enqueue(start*N + i)
            }
        }(g)
    }
    wg.Wait()
    seen := map[int]bool{}
    for i := 0; i < 4*N; i++ {
        v, ok := q.Dequeue()
        if !ok {
            t.Fatalf("unexpectedly empty at %d", i)
        }
        seen[v] = true
    }
    if len(seen) != 4*N {
        t.Fatalf("missing items")
    }
}
```

**Solution sketch.**
```go
type qnode[V any] struct {
    val  V
    next atomic.Pointer[qnode[V]]
}

type Queue[V any] struct {
    head atomic.Pointer[qnode[V]]
    tail atomic.Pointer[qnode[V]]
}

func NewQueue[V any]() *Queue[V] {
    dummy := &qnode[V]{}
    q := &Queue[V]{}
    q.head.Store(dummy)
    q.tail.Store(dummy)
    return q
}

func (q *Queue[V]) Enqueue(v V) {
    n := &qnode[V]{val: v}
    for {
        tail := q.tail.Load()
        next := tail.next.Load()
        if tail != q.tail.Load() {
            continue
        }
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

func (q *Queue[V]) Dequeue() (V, bool) {
    var zero V
    for {
        head := q.head.Load()
        tail := q.tail.Load()
        next := head.next.Load()
        if head != q.head.Load() {
            continue
        }
        if next == nil {
            return zero, false
        }
        if head == tail {
            q.tail.CompareAndSwap(tail, next)
            continue
        }
        if q.head.CompareAndSwap(head, next) {
            return next.val, true
        }
    }
}
```

**What to learn.** The two-CAS enqueue. The dummy node trick. The helping pattern for lagging tail. Why both head and tail need re-reads to detect a stale snapshot.

---

### Task J3. Sharded atomic counter.

**Statement.** Implement `type Counter struct { ... }` with `Add(int64)` and `Sum() int64`. Must scale linearly to at least 8 cores.

**Constraints.** Use sharding, not a single hot atomic. Pad shards to avoid false sharing.

**Acceptance test.**
```go
func TestCounter(t *testing.T) {
    c := NewCounter()
    var wg sync.WaitGroup
    const G = 16
    const N = 100000
    for g := 0; g < G; g++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < N; i++ {
                c.Add(1)
            }
        }()
    }
    wg.Wait()
    if got := c.Sum(); got != G*N {
        t.Fatalf("got %d want %d", got, G*N)
    }
}

func BenchmarkCounterAdd(b *testing.B) {
    c := NewCounter()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            c.Add(1)
        }
    })
}
```

**Solution sketch.**
```go
type paddedI64 struct {
    n atomic.Int64
    _ [56]byte
}

type Counter struct {
    shards []paddedI64
}

func NewCounter() *Counter {
    return &Counter{shards: make([]paddedI64, runtime.GOMAXPROCS(0))}
}

func (c *Counter) Add(delta int64) {
    i := uint64(uintptr(unsafe.Pointer(&delta))) % uint64(len(c.shards))
    c.shards[i].n.Add(delta)
}

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].n.Load()
    }
    return s
}
```

**What to learn.** Sharding pattern. Padding for false-sharing avoidance. That goroutine identity is hard to get cleanly in Go; here we hash a stack address as a cheap shard index.

---

## Middle Tasks

### Task M1. SPSC ring buffer.

**Statement.** Implement `SPSC[V any]` with `Push(v V) bool` (returns false on full) and `Pop() (V, bool)` (returns false on empty). Must be wait-free for both producer and consumer.

**Constraints.**
- Backing array of power-of-two size.
- No CAS, only `Load` and `Store`.
- Pad head and tail to avoid false sharing.

**Acceptance test.**
```go
func TestSPSC(t *testing.T) {
    q := NewSPSC[int](1024)
    const N = 100000
    done := make(chan struct{})
    go func() {
        for i := 0; i < N; i++ {
            for !q.Push(i) {
                runtime.Gosched()
            }
        }
        close(done)
    }()
    for i := 0; i < N; i++ {
        for {
            v, ok := q.Pop()
            if ok {
                if v != i {
                    t.Fatalf("order: got %d want %d", v, i)
                }
                break
            }
            runtime.Gosched()
        }
    }
    <-done
}
```

**Solution sketch.** See middle.md SPSC section. The pattern is plain atomics with padding.

**What to learn.** The wait-free SPSC pattern. Why Go's seq-cst atomics make this clean. The cost of false sharing without padding.

---

### Task M2. MPSC intrusive queue (Vyukov).

**Statement.** Implement Vyukov's intrusive MPSC queue. Multiple producers, single consumer. Producers must be wait-free.

**Constraints.**
- Use the stub-node pattern.
- Single atomic Swap on tail per Push.

**Acceptance test.**
```go
func TestMPSC(t *testing.T) {
    q := NewMPSC[int]()
    const G = 8
    const N = 10000
    var wg sync.WaitGroup
    for g := 0; g < G; g++ {
        wg.Add(1)
        go func(start int) {
            defer wg.Done()
            for i := 0; i < N; i++ {
                q.Push(start*N + i)
            }
        }(g)
    }
    seen := map[int]bool{}
    go func() { wg.Wait() }()
    for len(seen) < G*N {
        v, ok := q.Pop()
        if ok {
            seen[v] = true
        } else {
            runtime.Gosched()
        }
    }
    if len(seen) != G*N {
        t.Fatalf("got %d", len(seen))
    }
}
```

**Solution sketch.** See middle.md MPSC section.

**What to learn.** Producer wait-freedom via `Swap`. The "consumer may briefly see no link yet" subtlety. Why this is not strictly lock-free on the consumer side.

---

### Task M3. Harris lock-free linked list.

**Statement.** Implement an ordered concurrent set: `Insert(key uint64)`, `Delete(key uint64) bool`, `Contains(key uint64) bool`. Use Harris's logical-delete pattern.

**Constraints.**
- Use a `nextRef` wrapper struct with pointer and `deleted` bool. CAS on the wrapper.
- Implement the search-and-help routine that physically unlinks logically-deleted nodes.

**Acceptance test.**
```go
func TestHarrisSet(t *testing.T) {
    l := NewList()
    const N = 1000
    var wg sync.WaitGroup
    for g := 0; g < 4; g++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < N; i++ {
                l.Insert(uint64(i))
            }
        }()
    }
    wg.Wait()
    for i := 0; i < N; i++ {
        if !l.Contains(uint64(i)) {
            t.Fatalf("missing %d", i)
        }
    }
    for i := 0; i < N; i++ {
        if !l.Delete(uint64(i)) {
            t.Fatalf("could not delete %d", i)
        }
    }
    for i := 0; i < N; i++ {
        if l.Contains(uint64(i)) {
            t.Fatalf("still has %d", i)
        }
    }
}
```

**Solution sketch.** Build on middle.md's outline. Full implementation runs ~200 lines.

**What to learn.** The mark-bit protocol. Why physical unlink is bookkeeping, not correctness-critical. The cost of allocating a `nextRef` on every CAS.

---

### Task M4. Backoff-on-contention.

**Statement.** Modify the Treiber stack from J1 to add exponential backoff after each failed CAS. Benchmark with and without backoff at 1, 2, 4, 8, 16 cores. Report when backoff helps and when it hurts.

**Constraints.** Use `runtime.Gosched()` for backoff. Cap backoff at 1024 iterations.

**Solution sketch.**
```go
func (s *Stack[V]) Push(v V) {
    n := &node[V]{val: v}
    delay := 1
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) {
            return
        }
        for i := 0; i < delay; i++ {
            runtime.Gosched()
        }
        if delay < 1024 {
            delay *= 2
        }
    }
}
```

**Expected finding.** Backoff hurts at 1-2 cores (extra branches), helps at 8+ cores under heavy contention. The crossover is workload-dependent.

**What to learn.** That backoff is a tunable, not a default. That measurement is mandatory.

---

## Senior Tasks

### Task S1. Vyukov bounded MPMC queue.

**Statement.** Implement Vyukov's bounded MPMC queue from senior.md. Pass concurrent producer-consumer stress tests at 16x16 goroutines.

**Constraints.**
- Sequence numbers per cell.
- Position counters padded to separate cache lines.
- Power-of-two capacity.

**Acceptance test.**
```go
func TestVyukovMPMC(t *testing.T) {
    q := NewQueue[int](1024)
    const G = 16
    const N = 100000
    var wg sync.WaitGroup
    produced := atomic.Int64{}
    consumed := atomic.Int64{}
    for g := 0; g < G; g++ {
        wg.Add(2)
        go func(start int) {
            defer wg.Done()
            for i := 0; i < N; i++ {
                for !q.Enqueue(start*N + i) {
                    runtime.Gosched()
                }
                produced.Add(1)
            }
        }(g)
        go func() {
            defer wg.Done()
            for {
                if produced.Load() >= int64(G*N) && consumed.Load() >= int64(G*N) {
                    return
                }
                if _, ok := q.Dequeue(); ok {
                    consumed.Add(1)
                } else {
                    runtime.Gosched()
                }
            }
        }()
    }
    wg.Wait()
    if produced.Load() != int64(G*N) || consumed.Load() != int64(G*N) {
        t.Fatalf("p=%d c=%d", produced.Load(), consumed.Load())
    }
}
```

**Solution sketch.** Senior.md has the full code.

**What to learn.** The sequence-number state machine. Why this design is ABA-free without version counters. The role of padding.

---

### Task S2. Sharded lock-free set.

**Statement.** Build a concurrent set with hashed sharding. Each shard is a Harris list from M3 or a `sync.Map` if preferred.

**Constraints.**
- N shards, where N is a power of two.
- Shard chosen by `hash(key) & (N-1)`.
- Operations: `Add(k)`, `Remove(k)`, `Has(k)`.

**Acceptance test.**
```go
func TestShardedSet(t *testing.T) {
    s := NewShardedSet(64)
    const G = 8
    const N = 10000
    var wg sync.WaitGroup
    for g := 0; g < G; g++ {
        wg.Add(1)
        go func(off int) {
            defer wg.Done()
            for i := 0; i < N; i++ {
                s.Add(uint64(off*N + i))
            }
        }(g)
    }
    wg.Wait()
    for i := 0; i < G*N; i++ {
        if !s.Has(uint64(i)) {
            t.Fatalf("missing %d", i)
        }
    }
}
```

**What to learn.** Sharding turns lock-free correctness into engineering. Most production "lock-free maps" are sharded under the hood.

---

### Task S3. Hazard-pointer Treiber stack.

**Statement.** Implement a Treiber stack that uses hazard pointers for safe reclamation, simulating a non-GC environment. Even though Go's GC makes this unnecessary, the exercise teaches the protocol.

**Constraints.**
- Each goroutine claims a hazard slot from a registry on entry.
- Pop publishes the popped pointer in the hazard slot before dereferencing it.
- Free-via-retire-list with periodic scans.

**Acceptance test.** Same as J1, plus a stress test that runs for 10 seconds and asserts the retire list size stays bounded.

**Solution sketch.** See senior.md hazard-pointer section for the protocol.

**What to learn.** The two-step protocol: publish, re-read, dereference. Why hazard pointers bound memory regardless of thread behaviour.

---

### Task S4. Lock-free vs mutex benchmark suite.

**Statement.** Write a benchmark suite comparing:

- Lock-free Treiber stack (from J1).
- Mutex-protected slice.
- Buffered channel (capacity 1024).

Across 1, 2, 4, 8, 16 cores with workloads: pure push, pure pop, 50/50, 90/10.

**Constraints.** Use `b.RunParallel` and `b.SetParallelism`. Report ns/op, allocs/op, and bytes/op.

**Solution sketch.** Standard `testing.B` table-driven benchmark.

**Expected findings.**
- At 1-2 cores: mutex ties or wins on uncontended pushes.
- At 4-8 cores: lock-free pulls ahead on pure push.
- Channel wins on mixed workloads if buffer holds most of the burst.
- Lock-free's allocs/op > 0; mutex slice can be zero with preallocation.

**What to learn.** Honest benchmarking. The wins of lock-free are real but narrow.

---

## Professional Tasks

### Task P1. SPSC ring buffer with batched draining.

**Statement.** Modify the SPSC from M1: the consumer's `Pop` should return a slice of up to N elements (batch dequeue), reducing per-op overhead.

**Constraints.**
- `PopBatch(out []V) int` returns the count copied.
- Producer-side unchanged.

**Solution sketch.**
```go
func (q *SPSC[V]) PopBatch(out []V) int {
    head := q.head.Load()
    tail := q.tail.Load()
    avail := tail - head
    if avail == 0 {
        return 0
    }
    if avail > uint64(len(out)) {
        avail = uint64(len(out))
    }
    for i := uint64(0); i < avail; i++ {
        out[i] = q.buf[(head+i)&q.mask]
    }
    q.head.Store(head + avail)
    return int(avail)
}
```

**Expected speedup.** 3-5x over per-element Pop in tight loops.

**What to learn.** Amortising fixed per-call overhead is one of the highest-leverage optimisations on hot paths.

---

### Task P2. Disruptor-style ring buffer with consumer DAG.

**Statement.** Implement a single-producer ring buffer with two consumers, where consumer B reads only after consumer A has finished with each slot.

**Constraints.**
- Producer claims via atomic counter.
- Consumer A maintains its own sequence; consumer B waits for A's sequence to advance.
- Producer waits for B's sequence to not lap the buffer.

**Acceptance test.** Two consumers that increment shared counters in lockstep.

**What to learn.** The Disruptor's dependency graph: one structure, many sequences. How to compose consumers.

---

### Task P3. False-sharing diagnosis.

**Statement.** Take this struct:

```go
type Counters struct {
    a atomic.Int64
    b atomic.Int64
}
```

Two goroutines run a loop, one incrementing `a`, the other `b`. Measure throughput. Then add padding between `a` and `b`. Measure again. Report the speedup.

**Expected finding.** 3-10x speedup with padding on modern x86.

**What to learn.** False sharing is invisible to algorithm-level reasoning but devastating to throughput. Always pad in production.

---

### Task P4. Stress test with `pgregory.net/rapid`.

**Statement.** Use property-based testing to validate a Treiber stack against a sequential model.

**Constraints.**
- Generate random sequences of Push and Pop.
- Run them concurrently against the lock-free stack and sequentially against a `[]int`.
- Assert that the sorted multiset of popped values matches.

**What to learn.** Linearizability checking. The limits of `-race`. Property-based testing for concurrent code.

---

## Capstone Project

### High-throughput log aggregator.

**Statement.** Build a logging library with the following architecture:

- Per-P log buffers, written via lock-free MPSC.
- Single writer goroutine that drains all per-P buffers and writes to a file.
- Backpressure: producers block (or drop, configurable) when buffers are full.
- Periodic flush every N milliseconds or when total buffered bytes exceeds M.

**Constraints.**
- Producer-side: no mutex, no channel allocation per log line, wait-free for producers.
- Consumer-side: single goroutine, MPSC per P.
- Output: ndjson-formatted log entries to a file.

**Acceptance tests.**
- 16 producer goroutines, 100K log lines each. All 1.6M lines must appear in the output file.
- Throughput at >5M lines/sec on an 8-core machine.
- No allocations per log line after warm-up (verify with `-benchmem`).
- Pass `go test -race`.

**Solution outline.**

1. A `ProducerBuffer` per P: a Vyukov MPSC.
2. A `Logger` with `Log(msg string, fields ...Field)` that:
   - Pins the goroutine to a P (procPin).
   - Builds the log entry in a sync.Pool-backed byte buffer.
   - Pushes the buffer to the local P's MPSC.
   - Unpins.
3. A drain goroutine that round-robins the MPSCs, draining each into a batched write to the file.
4. Buffer recycling via sync.Pool to avoid per-log allocation.

**What to learn.** End-to-end lock-free engineering. The interplay of MPSC, sync.Pool, and procPin. The honest verdict on whether the complexity is worth it (often yes, for logging libraries).

This capstone is approximately how `uber-go/zap`'s production logger is structured, minus features like sampling and structured field handling.

---

## Closing Notes

Lock-free programming is a craft. Each task here builds a piece of that craft: the CAS loop, the helping pattern, the mark bit, the sequence number, the shard, the pad. Internalise each piece and the harder structures fall out as compositions.

The non-obvious lesson, repeated through every task: measure. Lock-free wins are narrow. The benchmarks you write while solving these tasks teach you when to ship the lock-free design and when to keep your `sync.Mutex`.

---

## Related Topics

- [01-cas-algorithms](../01-cas-algorithms/) — CAS, the universal primitive
- [02-aba-problem](../02-aba-problem/) — ABA scenarios
- [04-memory-fences](../04-memory-fences/) — Memory ordering
- [05-lock-free-vs-wait-free](../05-lock-free-vs-wait-free/) — Progress hierarchy
