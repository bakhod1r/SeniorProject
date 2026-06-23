# Lock-Free vs Wait-Free — Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Junior Tasks](#junior-tasks)
3. [Middle Tasks](#middle-tasks)
4. [Senior Tasks](#senior-tasks)
5. [Professional Tasks](#professional-tasks)
6. [Capstone Projects](#capstone-projects)
7. [Acceptance Criteria](#acceptance-criteria)

---

## How to Use This File

Each task in this file is a self-contained programming exercise. Work through them in order: junior tasks build the foundation, middle and senior tasks push into algorithmic design, professional tasks tackle the kinds of decisions you would defend in a design review. Capstone projects integrate multiple skills.

For each task, the structure is:

- *Goal.* One-paragraph statement of what you are building.
- *Specification.* The API you must expose and the behaviour required.
- *Progress class.* The progress guarantee you are claiming.
- *Tests.* How to verify correctness and the claimed progress.
- *Acceptance.* What "done" looks like.

Compile every solution, run every test, and document the progress class in a comment at the top of each file. The point of this folder is to distinguish the rungs of the hierarchy with confidence; the tasks force you to do so on paper as well as in code.

---

## Junior Tasks

### Task J1 — Classify the standard library

*Goal.* Read the `sync` package documentation and the source of `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Once`, `sync.Map`, and `sync.Pool`. For each *method* on each type, decide whether it is blocking, lock-free, or wait-free, and on which path.

*Specification.* Produce a single Markdown table. Columns: type, method, progress class, justifying mechanism.

*Acceptance.* The table has at least 25 rows. Each entry cites the function name in the Go source where the relevant atomic operation or mutex acquisition happens.

### Task J2 — Reproduce the canonical examples

*Goal.* Write three counter implementations: mutex, CAS-loop, and `atomic.Add`. Add a header comment to each file naming the progress class and the justifying mechanism.

*Specification.* Three files: `mutex_counter.go`, `cas_counter.go`, `atomic_counter.go`. Each exposes `Add(delta int64)` and `Load() int64`.

*Tests.* Spawn 1000 goroutines, each calling `Add(1)`, and verify the final count is 1000.

*Acceptance.* All three programs compile, run, and produce the correct count.

### Task J3 — Naming game

*Goal.* For each of the following snippets, name the progress class and justify it in one sentence:

```go
// A
counter.Add(1)

// B
for {
    old := counter.Load()
    if counter.CompareAndSwap(old, old+1) {
        break
    }
}

// C
mu.Lock()
counter++
mu.Unlock()

// D
ch <- 1 // ch is buffered with room

// E
<-ch // ch is unbuffered, no sender pending

// F
once.Do(func() { ... }) // first caller

// G
once.Do(func() { ... }) // after the first call completed
```

*Acceptance.* All seven answers correct. Cite the Go source path that justifies each.

### Task J4 — The starvation demo

*Goal.* Build a program that demonstrates starvation in a CAS-loop counter. Use one "slow" goroutine (with extra work inside the loop) and several "fast" goroutines (with empty loops). Measure per-goroutine completion counts over a fixed wall-clock duration.

*Specification.* Print the count for each goroutine. The slow one should complete dramatically fewer operations.

*Acceptance.* The slow goroutine's count is less than 10% of the fast goroutines' average. Write a short paragraph explaining why this is what "lock-free permits starvation" means in practice.

---

## Middle Tasks

### Task M1 — Treiber stack

*Goal.* Implement a generic lock-free Treiber stack in Go using `atomic.Pointer`. Document the progress class in a header comment.

*Specification.*

```go
type Stack[T any] struct { ... }
func (s *Stack[T]) Push(v T)
func (s *Stack[T]) Pop() (T, bool)
```

*Progress class.* Lock-free, not wait-free. Both operations use a CAS loop on the head pointer.

*Tests.*
- 100 goroutines each pushing 1000 items, then 100 goroutines each popping 1000 items. Verify the total count is conserved.
- Stress test with concurrent push and pop for 1 second; verify no panics, no data corruption.
- A test that measures per-goroutine completion counts under contention.

*Acceptance.* Code compiles. Tests pass. Header comment correctly cites the progress class.

### Task M2 — Michael-Scott queue

*Goal.* Implement the Michael-Scott lock-free MPMC queue.

*Specification.*

```go
type Queue[T any] struct { ... }
func New[T any]() *Queue[T]
func (q *Queue[T]) Enqueue(v T)
func (q *Queue[T]) Dequeue() (T, bool)
```

*Progress class.* Lock-free, not wait-free.

*Tests.*
- Producer-consumer test: 10 producers, 10 consumers, 100k items each. Verify all items delivered, in FIFO order *within* each producer (cross-producer order is not guaranteed).
- Stress test with concurrent enqueue and dequeue.
- A "help advance tail" test that pauses one enqueuer between its two CAS operations (via injected `runtime.Gosched`) and verifies the next enqueuer completes the lagging tail.

*Acceptance.* Code compiles. Tests pass. The "help advance tail" test confirms the lock-free progress argument.

### Task M3 — Benchmark harness

*Goal.* Build a benchmark harness that compares mutex, CAS-loop, and `atomic.Add` counters across `GOMAXPROCS` values 1, 2, 4, 8, 16.

*Specification.* Use `testing.B.RunParallel`. Report ops/sec and a log-bucketed tail-latency histogram (p50, p99, p99.9, max).

*Acceptance.* Output table shows the expected pattern: `atomic.Add` wins or ties at all contention levels; CAS-loop close behind; mutex falls off at high contention. Write a paragraph interpreting the tail latencies.

### Task M4 — Identify the rung from code

*Goal.* For each of the following Go snippets, identify the progress class and explain whether the claim in the comment is correct or incorrect.

```go
// (a) Wait-free buffered channel send
func PushFast(ch chan int, v int) {
    select {
    case ch <- v:
    default:
    }
}

// (b) Lock-free map
type LFMap struct {
    m   map[string]int
    mu  sync.RWMutex
}
func (m *LFMap) Get(k string) int {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return m.m[k]
}

// (c) Wait-free flag
var flag atomic.Bool
func TrySet() bool { return flag.CompareAndSwap(false, true) }

// (d) Lock-free counter with backoff
var n atomic.Int64
func Add() {
    for {
        old := n.Load()
        if n.CompareAndSwap(old, old+1) {
            return
        }
        runtime.Gosched()
    }
}
```

*Acceptance.*

- (a) The `select` with `default` is non-blocking (bounded), but it can spuriously drop messages. Calling it "wait-free" is technically correct *per call* (one attempt, one outcome) but misleading because the send may fail. Better: "wait-free per call with a `default` fallback."
- (b) Calling this lock-free is wrong. `sync.RWMutex` is blocking. The comment misleads the reader.
- (c) Correct. A single `CompareAndSwap` call is wait-free.
- (d) Lock-free. The `Gosched` does not change the progress class; it just makes contention less wasteful in practice.

### Task M5 — Tail latency under bias

*Goal.* Build a stress harness that biases the scheduler against one goroutine to surface starvation. Run it against a Treiber stack push under heavy contention and against `atomic.Add` under the same contention. Compare per-goroutine throughput and the per-goroutine tail latency.

*Specification.* Use 8 goroutines. Inject a 50-iteration busy loop into one of them between its load and its CAS. Measure for 5 seconds. Report per-goroutine ops and a tail-latency histogram.

*Acceptance.* The biased goroutine in the Treiber test shows materially lower throughput and worse tail. The biased goroutine in the `atomic.Add` test is essentially identical to the others. Write a paragraph explaining why.

---

## Senior Tasks

### Task S1 — A wait-free SPSC ring

*Goal.* Implement a wait-free single-producer single-consumer ring buffer.

*Specification.*

```go
type SPSCRing[T any] struct { ... }
func New[T any](sizePow2 int) *SPSCRing[T]
func (r *SPSCRing[T]) Push(v T) bool
func (r *SPSCRing[T]) Pop() (T, bool)
```

*Progress class.* Wait-free per call. `Push` returns false if the ring is full; `Pop` returns false if empty. Both complete in `O(1)` instructions.

*Tests.* Producer-consumer test verifying ordering and completeness for 1M items. A benchmark that compares against a mutex-protected ring and a channel of equivalent capacity.

*Acceptance.* The SPSC ring beats both alternatives on throughput at single-producer single-consumer. The progress class is correctly documented.

### Task S2 — Bounded lock-free counter

*Goal.* Implement a CAS-loop counter with a configurable retry cap and an `errContended` error return.

*Specification.*

```go
type BoundedCounter struct { ... }
func New(maxRetries int) *BoundedCounter
func (c *BoundedCounter) Add(delta int64) (int64, error)
```

*Progress class.* Bounded but not wait-free. Document this distinction prominently.

*Tests.* Under high contention, verify that some calls return `errContended` and that overall throughput remains high. Compare against unbounded CAS loop.

*Acceptance.* The bounded version's p99 latency is materially lower than the unbounded version's under high contention. Document the trade-off.

### Task S3 — Wait-free counter with helping (toy version)

*Goal.* Implement a wait-free counter using announcement and helping, for at most 16 threads. The goal is to internalise the helping pattern; the implementation is not expected to outperform `atomic.Add`.

*Specification.*

```go
type WFCounter struct { ... }
func (c *WFCounter) Add(threadID int, delta int64) int64
```

*Progress class.* Wait-free with bound `O(N)` per call.

*Tests.* Correctness test with 16 goroutines, each calling `Add` 100k times. Verify the final value equals 16 * 100k. Compare throughput to `atomic.Add` (expect the helping version to be 10-50x slower).

*Acceptance.* The helping version is correct. Document the bound `B = N = 16` in the header comment. Reflect in a paragraph on why nobody would use this in production.

### Task S4 — Sequence lock

*Goal.* Implement a sequence lock with a wait-free read path (formally lock-free under continuous writer contention) and a blocking write path.

*Specification.*

```go
type Seqlock[T any] struct { ... }
func (s *Seqlock[T]) Read() T
func (s *Seqlock[T]) Write(v T)
```

*Tests.* Correctness under one writer and ten readers. Verify no torn reads.

*Acceptance.* Documentation correctly classifies `Read` as lock-free (under writer contention) and `Write` as blocking. Note the Go memory model subtlety: a direct read of `s.value` in user code is a data race; in practice, the value field should be wrapped in an atomic or copied via `unsafe`.

### Task S5 — Verify a paper claim

*Goal.* Pick a published "wait-free" data structure (Kogan-Petrank queue, Yang-Mellor-Crummey queue, wait-free hash table). Read the paper, write a short critique of the wait-free claim.

*Specification.* Address: (1) What is the per-operation step bound `B`? (2) What is the helping mechanism? (3) What is the memory-reclamation discipline? (4) What are the empirical performance numbers? (5) Would you ship this in Go production?

*Acceptance.* A two-page critique addressing all five questions, with citations.

### Task S6 — `sync.Once` deep dive

*Goal.* Read `src/sync/once.go`. Annotate every atomic operation with the progress class. Identify the wait-free fast path and the blocking slow path. Write a short essay explaining why the design is correct and how it avoids the "double-checked locking" bug.

*Acceptance.* Annotated source plus a one-page explanation.

### Task S7 — `sync.Map` deep dive

*Goal.* Read `src/sync/map.go`. Identify which paths are wait-free, which are lock-free, and which are blocking. Explain the read-only / dirty map promotion logic.

*Acceptance.* A table of methods × paths × progress classes, with citations to specific lines in the source.

---

## Professional Tasks

### Task P1 — Audio ring with cgo

*Goal.* Build a wait-free SPSC ring buffer that can be shared between a Go goroutine and a C audio thread via cgo. The Go side writes events; the C side reads them.

*Specification.* The ring's atomic operations must be compatible across the cgo boundary (use `_Atomic` types in C, `atomic.Uint64` in Go, ensure layout compatibility).

*Acceptance.* A small demo program that proves the C side reads events the Go side writes, with no glitches under high write rate.

### Task P2 — Pacemaker-style control loop simulation

*Goal.* Simulate a control loop that must process a tick every 1ms. Build the IPC between a "sensor" goroutine and a "controller" goroutine using:
- A mutex-protected variable.
- A buffered channel of capacity 1.
- A wait-free SPSC ring.

Measure the worst-case latency from sensor write to controller read in each design.

*Acceptance.* The wait-free SPSC ring has the lowest tail latency. Document the GC pause's effect on each design — even the wait-free one may suffer if GC pauses exceed 1ms.

### Task P3 — Lock-free vs mutex under microservice load

*Goal.* Build a small HTTP server that increments a per-endpoint counter on every request. Compare implementations: `atomic.Add`, mutex, sharded `atomic.Add` (per-CPU).

*Specification.* Load-test at 10k req/s, 100k req/s, 1M req/s. Measure tail latency.

*Acceptance.* At 10k and 100k req/s, all three are indistinguishable. At 1M req/s, the sharded counter wins materially. The single `atomic.Add` saturates the cache line; the mutex saturates the wait queue.

### Task P4 — Production design review

*Goal.* Review the following hypothetical design and recommend changes:

```
"For our trading order matching engine, we'll use a wait-free queue (Kogan-Petrank)
for the inbound order stream. Reads are wait-free. Writes are wait-free. 
We expect 50,000 messages/sec at peak."
```

*Acceptance.* A written review covering: whether wait-free is justified at 50k msg/s; whether a Michael-Scott queue would suffice; whether the Go runtime's GC pauses undermine the wait-free claim; whether the implementation should be in Go or in a different language.

### Task P5 — Signal handler IPC

*Goal.* Investigate how the Go runtime handles signals. Identify the wait-free or async-signal-safe code paths. Write a one-page summary of the design.

*Acceptance.* The summary explains why user code does not need to write async-signal-safe code in Go, and identifies the runtime's wait-free entry points.

---

## Capstone Projects

### Capstone C1 — Concurrent in-memory KV store

*Goal.* Build a thread-safe in-memory key-value store. Reads must be wait-free for hot keys; writes can be blocking. The store must support `Get`, `Put`, `Delete`, and `Snapshot`.

*Specification.*

- Use `atomic.Pointer[map[string]V]` for the hot read map.
- Use a mutex for the dirty map and the promotion logic.
- Document the progress class per operation.
- Benchmark against `sync.Map` and `map + sync.RWMutex`.

*Acceptance.* The KV store passes correctness tests. Read benchmarks beat both alternatives on hot-key workloads. The progress class is correctly documented in code and in the README.

### Capstone C2 — Metric system with sharded counters

*Goal.* Build a metric collection system with per-endpoint counters. The hot path (increment) must be wait-free and scale linearly with cores. The cold path (snapshot) can be `O(N)`.

*Specification.*

- Per-CPU counter shards.
- A snapshot routine that sums shards.
- A reset routine that atomically resets all shards.

*Acceptance.* Throughput scales linearly with cores up to `GOMAXPROCS`. Snapshot reads see consistent counts. Reset is documented as eventually consistent — a snapshot taken during reset may see partial values.

### Capstone C3 — Real-time game tick loop

*Goal.* Build a game tick loop that runs at 60Hz. Render thread reads game state; physics thread writes it. The communication between threads must not cause visible stutter (per-frame latency budget: 16ms minus rendering cost).

*Specification.*

- Use `atomic.Pointer[GameState]` for state hand-off.
- Render thread does a wait-free `Load`.
- Physics thread builds the next state, swaps the pointer atomically.

*Acceptance.* The loop runs steady at 60Hz with no GC-induced stutter under reasonable allocation patterns. Document why this is wait-free *per swap* even though GC may occasionally pause the world.

### Capstone C4 — Disruptor-style SPMC ring

*Goal.* Implement a Disruptor-style wait-free SPMC ring buffer. The single producer writes; multiple consumers read in their own order (each consumer's read cursor is independent).

*Specification.*

- Pre-allocated ring buffer of fixed size.
- Producer maintains a publish cursor; each consumer maintains its own consume cursor.
- Producer writes a slot, then atomically advances the publish cursor.
- Consumers spin (or yield) until the publish cursor advances past their consume cursor.

*Progress class.* Producer is wait-free. Each consumer is wait-free when data is available. Both are bounded in steps per published item.

*Tests.* One producer, four consumers. Verify all consumers see every item in order. Measure per-consumer tail latency.

*Acceptance.* Code compiles. All tests pass. The wait-free property is documented and defended. Compare against a channel fan-out (multiple consumers each with their own channel) and explain the trade-offs.

---

## Acceptance Criteria

For each task, your submission must:

1. **Compile cleanly.** No build errors, no `vet` warnings, no `go test -race` failures.
2. **Document the progress class.** A comment at the top of each file names the class for every exported method.
3. **Test under contention.** A single-threaded test does not validate a progress claim. Use `b.RunParallel` or explicit goroutine launches.
4. **Measure tail latency where applicable.** Progress classes are most visible in the tail. A throughput-only benchmark hides them.
5. **Cite Herlihy 1991.** Any claim of "wait-free" must reference the foundational definition.
6. **Be honest.** If your design is bounded but not formally wait-free, say so. If your design is lock-free with a backoff, say so. Over-claiming is a fast way to lose credibility.

If a task asks you to compare progress classes, your write-up should distinguish:

- *Throughput*: ops/sec under varying contention.
- *Latency p50, p99, p99.9, max*: where the progress class actually shows.
- *Per-goroutine spread*: starvation only shows in the per-thread distribution.
- *Adversarial behaviour*: what the design does when one thread is deliberately slowed.

The whole point of this folder is to make progress classes tangible. The tasks are the mechanism. Compile, run, measure, document.
