# 8.17 `container/*` — Tasks

> Ten exercises across `container/heap`, `container/list`, and
> `container/ring`. Difficulty rises from "warm-up" to "production
> shape." Each task lists what to build and what to verify.

## Task 1 — Min-heap of integers (warm-up)

Implement a min-heap of `int` using `container/heap`. Provide a
function `Sort(s []int) []int` that returns `s` sorted ascending by
heap-popping every element.

Requirements:

- The heap implements `heap.Interface`.
- `Sort` calls `heap.Init` once on the input.
- Output slice is a new allocation; do not modify the input
  in-place.

Verify:

- For random inputs of size 10, 1k, 100k, the output is sorted.
- Compare wall time against `slices.Sort` on the same inputs;
  document the ratio. (Spoiler: `slices.Sort` is faster.)

## Task 2 — Generic min-heap wrapper

Build a generic `pq.Heap[T any]` over `container/heap`. The API:

```go
type Heap[T any] struct { /* unexported */ }

func New[T any](less func(a, b T) bool) *Heap[T]
func (h *Heap[T]) Push(v T)
func (h *Heap[T]) Pop() T
func (h *Heap[T]) Peek() T
func (h *Heap[T]) Len() int
```

Requirements:

- No allocation per `Push` for pointer types (verify with
  `testing.AllocsPerRun`).
- The adapter type for `heap.Interface` is unexported.
- The constructor takes a comparator; it does not require `T` to be
  ordered.

Verify:

- Property test: 10k random `Push`/`Pop` interleavings on `int` and
  `*Item` payloads always yield monotonic output.
- Benchmark: `Push`+`Pop` rate. Aim for >5M ops/s on a modern CPU
  for `*Item` payloads.

## Task 3 — Top-K from a stream

Implement `TopK[T any](in <-chan T, k int, less func(a, b T) bool) []T`
that consumes the channel and returns the K *smallest* elements per
`less`, in any order.

Requirements:

- Memory is O(k), not O(n).
- The stream may be very long; never call `Sort` on the full input.
- Returns when the channel is closed.

Verify:

- For a stream of 1M random ints with k=100, the output exactly
  matches `slices.Sorted(input)[:100]` (after sorting both).
- Memory profile shows constant allocation regardless of stream
  length once steady state is reached.

## Task 4 — Priority queue with `Update` and `Cancel`

Build a priority queue of jobs with these public methods:

```go
type Job struct {
    ID       string
    Priority int
}

type PQ struct { /* unexported */ }

func (q *PQ) Push(j *Job)        // O(log n)
func (q *PQ) Pop() *Job          // O(log n)
func (q *PQ) Update(j *Job, p int) // O(log n)
func (q *PQ) Cancel(j *Job)      // O(log n)
func (q *PQ) Len() int           // O(1)
```

Requirements:

- `*Job` carries a hidden `index` field updated by `Swap`.
- After `Pop`, `Cancel(j)` is a safe no-op.
- After `Cancel`, `Update(j, p)` is a safe no-op (or returns an
  error — your choice, document it).

Verify:

- Stress test: 100 goroutines pushing/updating/cancelling. With a
  mutex wrapper, no panics, no heap-invariant violations (check by
  popping all and asserting monotonicity at the end).

## Task 5 — Hashed timer wheel (mini)

Implement a `Scheduler` using a single-heap design and the lazy-cancel
pattern (see professional.md §2):

```go
type Scheduler struct { /* unexported */ }

func New() *Scheduler
func (s *Scheduler) Schedule(d time.Duration, f func()) *Job
func (s *Scheduler) Cancel(j *Job)
func (s *Scheduler) Stop()
```

Requirements:

- Uses `container/heap` keyed by deadline.
- Cancel is O(1) wait-free (sets a flag).
- Stop drains and exits cleanly.
- No goroutine leak after Stop (verify with `runtime.NumGoroutine`).

Verify:

- 10k jobs scheduled across 1 second of wall time, 50% cancelled
  before firing. Measure fire-lateness P50/P99 and Cancel latency
  under concurrent load.

## Task 6 — LRU cache

Implement a generic LRU cache using `container/list` and a map:

```go
type LRU[K comparable, V any] struct { /* unexported */ }

func New[K comparable, V any](cap int) *LRU[K, V]
func (c *LRU[K, V]) Get(k K) (V, bool)
func (c *LRU[K, V]) Put(k K, v V)
func (c *LRU[K, V]) Len() int
func (c *LRU[K, V]) Remove(k K) bool
```

Requirements:

- O(1) `Get`, `Put`, `Remove` (excluding the map cost).
- Eviction is FIFO of least-recently-used.
- Single-threaded; do not add a mutex.

Verify:

- Workload from Wikipedia's LRU example: hit rate matches the
  expected sequence.
- Property test: at all times, `c.Len() <= cap`; the map and list
  are consistent (every map value is in the list, every list value
  is in the map).

## Task 7 — Shareded LRU with per-shard mutex

Wrap Task 6 in a sharded variant that splits the keyspace across N
locks:

```go
type ShardedLRU[K comparable, V any] struct { /* unexported */ }

func NewSharded[K comparable, V any](cap, shards int, hash func(K) uint64) *ShardedLRU[K, V]
```

Requirements:

- Total capacity is `cap`; each shard gets `cap/shards`.
- Reads from one shard never block reads from another.
- Concurrency-safe.

Verify:

- Benchmark `Get` under 1, 8, 64 goroutines. Throughput should scale
  near-linearly to about `shards` goroutines, then flatten.

## Task 8 — Bounded undo stack

Implement an undo/redo stack with bounded history:

```go
type UndoStack[T any] struct { /* unexported */ }

func New[T any](max int) *UndoStack[T]
func (s *UndoStack[T]) Push(action T)
func (s *UndoStack[T]) Undo() (T, bool)
func (s *UndoStack[T]) Redo() (T, bool)
```

Requirements:

- Implementable on either `container/list` or a slice. Implement
  both; benchmark; pick the winner.
- Bounded `max` history (oldest evicted on overflow).
- After `Undo`, a fresh `Push` clears the redo trail.

Verify:

- Sequence test: push 1000 actions with `max=100`; oldest 900 are
  unrecoverable; recent 100 can be undone in order.
- Allocation comparison between list-backed and slice-backed
  variants. Document which wins for max=100, max=10k.

## Task 9 — Round-robin worker pool with `container/ring`

Implement a worker pool where workers are arranged in a ring; each
incoming job is assigned to the next worker via `Move(1)`. Workers
can be added or removed at runtime.

```go
type Pool struct { /* unexported */ }

func New(workers []Worker) *Pool
func (p *Pool) AddWorker(w Worker)
func (p *Pool) RemoveCurrent()
func (p *Pool) Submit(job Job)
```

Requirements:

- Uses `container/ring` for the worker layout.
- `Submit` advances to the next worker before dispatching.
- `RemoveCurrent` removes the worker that handled the last job.

Verify:

- 1000 jobs across 4 workers: distribution is uniform within ±5%.
- Add and remove workers under concurrent submission with a mutex;
  no panics, no skipped jobs.

Now reimplement the same API with a slice and a `head int`. Compare
performance and code length. Justify which is better.

## Task 10 — Slice-backed ring buffer (no `container/ring`)

Implement a generic fixed-size FIFO ring buffer with overwrite
semantics:

```go
type Ring[T any] struct { /* unexported */ }

func New[T any](cap int) *Ring[T]
func (r *Ring[T]) Push(v T)        // overwrites oldest if full
func (r *Ring[T]) Pop() (T, bool)  // ok=false if empty
func (r *Ring[T]) Len() int
func (r *Ring[T]) Cap() int
func (r *Ring[T]) Snapshot() []T   // oldest-to-newest
```

Requirements:

- Backed by a slice of size `cap`; constant memory regardless of
  push/pop count.
- O(1) `Push`, `Pop`, `Len`, `Cap`.
- `Snapshot` is O(n) and allocates a new slice.

Verify:

- Property test: after 1M random `Push`/`Pop` operations with
  `cap=128`, `Snapshot` returns at most 128 elements, oldest first.
- Benchmark: `Push`+`Pop` rate. Aim for >50M ops/s — this should
  beat a `container/ring`-based equivalent by an order of magnitude.

## Bonus — Two-heap running median

Already sketched in middle.md §11. Build it for production use:

```go
type RunningMedian[T constraints.Ordered] struct { /* unexported */ }

func New[T constraints.Ordered]() *RunningMedian[T]
func (m *RunningMedian[T]) Add(v T)
func (m *RunningMedian[T]) Median() T  // returns lower median for even counts
func (m *RunningMedian[T]) Len() int
func (m *RunningMedian[T]) Reset()
```

Requirements:

- `Add` is O(log n), `Median` is O(1).
- Works for any ordered numeric type.
- `Reset` reuses the underlying slices (no re-allocation).

Verify:

- Run on a stream of 100k random ints; compare against a sort-and-
  index reference implementation. Identical results.
- Benchmark vs the reference: with n=100k, the streaming version is
  much faster on `Add`+`Median` mixed workloads.

## Bonus — Lock-free MPMC bounded queue (advanced)

Implement a multi-producer, multi-consumer bounded queue without
mutexes, using `atomic` operations only:

```go
type LockFreeQueue[T any] struct { /* unexported */ }

func New[T any](cap int) *LockFreeQueue[T]
func (q *LockFreeQueue[T]) Enqueue(v T) bool // false if full
func (q *LockFreeQueue[T]) Dequeue() (T, bool) // false if empty
```

This is hard. Not really a `container/*` task — but if you've
finished everything else, comparing your lock-free implementation
against the channel and the mutex-wrapped slice ring buffer is
educational.

Verify:

- Stress: 100 producers + 100 consumers, 10M total enqueues. No data
  races (`-race`), no missed/duplicated values.
- Throughput vs `make(chan T, cap)` and vs the mutex ring buffer.

## Bonus — Indexed PQ with key-based update

Build a generic priority queue indexed by key:

```go
type IndexedPQ[K comparable, V any] struct { /* unexported */ }

func New[K comparable, V any](less func(a, b V) bool) *IndexedPQ[K, V]
func (p *IndexedPQ[K, V]) Push(k K, v V) bool   // false if k already present
func (p *IndexedPQ[K, V]) Update(k K, v V) bool // false if k not present
func (p *IndexedPQ[K, V]) Cancel(k K) bool      // false if k not present
func (p *IndexedPQ[K, V]) Pop() (K, V, bool)
func (p *IndexedPQ[K, V]) Peek() (K, V, bool)
func (p *IndexedPQ[K, V]) Len() int
```

Requirements:

- All mutating operations are O(log n) plus the map lookup.
- The internal `map[K]int` of slice indices stays consistent across
  every `Swap`.
- After `Pop` or `Cancel`, the same key may be re-pushed.

Verify:

- Property test: 100k random `Push`/`Update`/`Cancel`/`Pop` operations
  on `K=string`, `V=int`. After each step, `Peek` returns the
  smallest-`V` key in the queue (compare against a brute-force
  reference).
- Benchmark `Update` against the "push fresh, skip stale" pattern
  used in middle.md §4 Dijkstra. For dense graphs, the indexed
  variant should win on `Update`-heavy workloads.

## Bonus — Hashed timer wheel for high cancellation rates

Reimplement Task 5's `Scheduler` using a hashed timer wheel: a fixed
number of buckets (e.g., 512), each holding a list of timers
scheduled within that wheel-slot's time range. The current slot
advances on each tick.

```go
type WheelScheduler struct { /* unexported */ }

func New(tick time.Duration, slots int) *WheelScheduler
func (s *WheelScheduler) Schedule(d time.Duration, f func()) *Job
func (s *WheelScheduler) Cancel(j *Job)
func (s *WheelScheduler) Stop()
```

Requirements:

- `Schedule` is O(1) average (it appends to a bucket's list).
- `Cancel` is O(1) — keep a `*list.Element` reference inside the
  `Job` for in-place removal.
- The wheel handles deadlines beyond `tick * slots` by storing a
  "rounds remaining" counter that decrements each time the slot is
  visited.

Verify:

- Same workload as Task 5 (10k jobs, 50% cancelled). Compare
  scheduling latency, cancel latency, and fire-lateness P99 against
  the heap-based scheduler.
- Memory: the wheel uses `slots` lists; the heap uses one slice.
  Document the memory crossover point.

## What to read next

- [find-bug.md](find-bug.md) — broken implementations to diagnose.
- [optimize.md](optimize.md) — push the constant factor lower.
- [`../16-sort-slices-maps/`](../16-sort-slices-maps/junior.md) — the modern
  packages your generic wrappers should compose with.
