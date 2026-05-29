# Priority Queue — Middle Level

> **Focus:** "Why this implementation?" and "When do I outgrow the default?" — picking, indexing, and tuning a PQ for real workloads.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Graph and Tree Applications](#graph-and-tree-applications)
6. [Dynamic Programming Integration](#dynamic-programming-integration)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level you used a PQ. At middle level you start *picking* the PQ — and you find yourself answering the kind of questions an interviewer or a code-reviewer raises:

- "Why are you re-pushing duplicates instead of using `decrease-key`?"
- "Won't `PriorityQueue.iterator()` give me out-of-order results?"
- "What happens if two jobs have the same priority? Will the order be stable?"
- "Is your PQ thread-safe under multiple producers?"
- "We have 200 priority classes — wouldn't a radix heap beat your heap?"

The middle-level mental model expands from "the PQ" to "*a* PQ — one of many — chosen because its op mix wins on this workload."

---

## Deeper Concepts

### Invariant: highest-priority-first

A PQ is correct if and only if `pop` returns an item with priority no larger (for a min-PQ) than any other currently-stored item:

```
for all x in pq:  pq.peek().priority <= x.priority
```

Notice this says *nothing* about the order of items below the top. Two PQs can hold the same set of items in different internal arrangements and still both be correct.

### Stability via a tiebreaker counter

Heaps are not naturally stable. The standard fix is a monotonically increasing counter pushed alongside the priority:

```
entry = (priority, counter, payload)
```

Comparison cascades: first by priority, then by counter. Equal priorities now resolve in insertion order, and the payload never has to be comparable.

### The decrease-key paradox

Plain heap-backed PQs cannot find an arbitrary item without a linear scan. So `decrease-key(item, new_priority)` is `O(n)` — defeating the whole purpose. Two industry-standard answers:

1. **Indexed PQ:** maintain `pos[item] = index_in_heap`. `decrease-key` is `O(log n)`. Cost: `swap` must update `pos` on every move.
2. **Lazy duplicates:** push `(new_priority, item)` again, ignore stale `pop`s. Cost: heap can grow to `O(E)` in Dijkstra. Simpler code; same asymptotic complexity.

Lazy duplicates almost always win in practice for graph algorithms because the constant factor of touching `pos` is high.

### Recurrence: bulk build vs incremental push

```
T_bulk(n)        = O(n)        (Floyd's heapify)
T_incremental(n) = O(n log n)  (n pushes × log n each)
```

Both end up with the same data structure, but bulk build is `3–5×` faster in practice because it does fewer comparisons on the upper levels and has much better cache behaviour.

### Bucket / radix PQ

When priorities are bounded integers in `[0, k)`, a PQ of `k` linked lists ("buckets") gives `O(1)` push and `O(1)` pop-min (amortised on a moving cursor). Used in:

- BFS variants where edge weights are 0/1 (`O(1)` bucket per layer).
- Scheduling with discrete priority classes (Linux CFS uses red-black trees, but earlier O(1) scheduler used buckets).
- Dial's algorithm — Dijkstra with bounded integer weights.

---

## Comparison with Alternatives

| Implementation | `push` | `pop-min` | `peek` | `decrease-key` | `meld` | Notes |
|----------------|-------:|----------:|-------:|---------------:|-------:|-------|
| Sorted array | O(n) | O(1) | O(1) | O(n) | O(n) | Great if pushes are rare. |
| Unsorted array | O(1) | O(n) | O(n) | O(n) | O(1) | Bad except for tiny `n`. |
| BST (balanced) | O(log n) | O(log n) | O(log n) | O(log n) | O(n log n) | Useful when you also need ordered iteration. |
| Binary heap | O(log n) | O(log n) | O(1) | O(log n) (indexed) | O(n) | The default. |
| `d-ary` heap (d=4) | O(log_d n) | O(d · log_d n) | O(1) | O(log_d n) | O(n) | Faster decrease-key, slightly slower pop. |
| Leftist heap | O(log n) | O(log n) | O(1) | O(log n) | **O(log n)** | Great when meld is hot. |
| Fibonacci heap | **O(1) amort.** | O(log n) amort. | O(1) | **O(1) amort.** | **O(1)** | Asymptotically optimal; bad constants. |
| Pairing heap | O(1) amort. | O(log n) amort. | O(1) | O(log n) amort.* | O(1) | Simple to implement; tight bounds open. |
| Radix / bucket | **O(1)** | **O(1)** | O(1) | O(1) | O(k) | Only for bounded integer priorities. |

`*` Pairing heap's decrease-key is conjectured `O(log log n)` amortised but not proven.

---

## Advanced Patterns

### Pattern: K-way merge with a min-PQ of stream cursors

For `k` sorted input streams totalling `N` items:

```python
import heapq

def k_way_merge(streams):
    pq = []
    for i, stream in enumerate(streams):
        it = iter(stream)
        first = next(it, None)
        if first is not None:
            heapq.heappush(pq, (first, i, it))
    while pq:
        val, i, it = heapq.heappop(pq)
        yield val
        nxt = next(it, None)
        if nxt is not None:
            heapq.heappush(pq, (nxt, i, it))
```

Complexity: `O(N log k)`. The PQ holds at most `k` items.

### Pattern: Throttled scheduler — PQ keyed by `(next_run_at, job)`

A delayed-job scheduler keeps a heap of `(deadline, job)` and a worker that sleeps until the head deadline.

#### Go

```go
package main

import (
    "container/heap"
    "time"
)

type Job struct {
    Run    func()
    DueAt  time.Time
    index  int
}

type SchedQueue []*Job

func (q SchedQueue) Len() int            { return len(q) }
func (q SchedQueue) Less(i, j int) bool  { return q[i].DueAt.Before(q[j].DueAt) }
func (q SchedQueue) Swap(i, j int)       { q[i], q[j] = q[j], q[i]; q[i].index = i; q[j].index = j }
func (q *SchedQueue) Push(x interface{}) { it := x.(*Job); it.index = len(*q); *q = append(*q, it) }
func (q *SchedQueue) Pop() interface{}   { n := len(*q); x := (*q)[n-1]; *q = (*q)[:n-1]; return x }

func RunScheduler(q *SchedQueue, stop <-chan struct{}) {
    for {
        select {
        case <-stop:
            return
        default:
        }
        if q.Len() == 0 {
            time.Sleep(50 * time.Millisecond)
            continue
        }
        head := (*q)[0]
        d := time.Until(head.DueAt)
        if d > 0 {
            time.Sleep(d)
        }
        heap.Pop(q)
        head.Run()
    }
}
```

#### Java

```java
import java.util.*;
import java.util.concurrent.*;

public class Scheduler {
    record Job(Runnable run, long dueAtMillis) {}
    private final PriorityQueue<Job> q =
        new PriorityQueue<>(Comparator.comparingLong(Job::dueAtMillis));

    public synchronized void submit(Runnable r, long delayMillis) {
        q.add(new Job(r, System.currentTimeMillis() + delayMillis));
        notifyAll();
    }

    public void runLoop() throws InterruptedException {
        while (true) {
            synchronized (this) {
                while (q.isEmpty()) wait();
                long wait = q.peek().dueAtMillis() - System.currentTimeMillis();
                if (wait > 0) { wait(wait); continue; }
            }
            Job j;
            synchronized (this) { j = q.poll(); }
            if (j != null) j.run().run();
        }
    }
}
```

#### Python

```python
import heapq, time, threading

class DelayedScheduler:
    def __init__(self):
        self._pq = []
        self._cv = threading.Condition()
        self._counter = 0

    def submit(self, fn, delay_s):
        with self._cv:
            self._counter += 1
            heapq.heappush(self._pq, (time.monotonic() + delay_s, self._counter, fn))
            self._cv.notify()

    def run(self):
        with self._cv:
            while True:
                while not self._pq:
                    self._cv.wait()
                due, _, fn = self._pq[0]
                wait = due - time.monotonic()
                if wait > 0:
                    self._cv.wait(timeout=wait)
                    continue
                heapq.heappop(self._pq)
                self._cv.release()
                try:
                    fn()
                finally:
                    self._cv.acquire()
```

### Pattern: Indexed PQ with explicit decrease-key

See [`../01-binary-heap/middle.md`](../01-binary-heap/middle.md) for the full implementation — the indexed PQ pattern is the same regardless of whether you call the abstraction "binary heap" or "priority queue."

---

## Graph and Tree Applications

```mermaid
graph TD
    A[Priority queue] --> B[Dijkstra — O((V+E) log V)]
    A --> C[Prim's MST — O(E log V)]
    A --> D[A* — informed search]
    A --> E[Huffman — combine two smallest]
    A --> F[Event-driven sim — keyed by virtual time]
    A --> G[Top-k pattern]
    A --> H[Task scheduler — keyed by deadline]
```

The same abstraction wears all these hats. That is exactly why "priority queue" is such a useful word — it lets you reason about Dijkstra without committing to a specific heap variant.

---

## Dynamic Programming Integration

When DP states have ordered transitions and you want to process the *best* state next, the natural data structure is a PQ. Examples:

- **Cheapest path in a weighted DAG** with non-negative weights — Dijkstra is, structurally, a DP on `dist[v]`.
- **K-shortest paths** (Yen, Eppstein) — maintains a PQ of candidate paths.
- **Optimal binary search tree** with early termination — popping the lowest-cost partial tree first.

#### Python

```python
# Minimum-cost path in a DAG keyed by node index.
import heapq

def min_cost(adj, src, dst):
    pq = [(0, src)]
    dist = {src: 0}
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst:
            return d
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return float("inf")
```

Notice this is *also* Dijkstra. PQ-driven DP is a common pattern: a topological-order DP becomes a PQ-driven DP when the order is determined dynamically by the cost so far.

---

## Code Examples

### Bounded blocking PQ in Java

```java
import java.util.concurrent.*;

public class BoundedBlockingPQ<T> {
    private final PriorityBlockingQueue<T> q;
    private final Semaphore slots;

    public BoundedBlockingPQ(int capacity, java.util.Comparator<T> cmp) {
        this.q = new PriorityBlockingQueue<>(capacity, cmp);
        this.slots = new Semaphore(capacity);
    }

    public void put(T item) throws InterruptedException {
        slots.acquire();              // blocks if full
        q.put(item);
    }

    public T take() throws InterruptedException {
        T item = q.take();            // blocks if empty
        slots.release();
        return item;
    }
}
```

`PriorityBlockingQueue` is *unbounded* in the JDK; combining it with a semaphore gives bounded back-pressure.

### Sharded PQ pattern in Go

```go
type Sharded struct {
    shards []*ShardedPQ
}

func (s *Sharded) Push(key uint64, item *Item) {
    s.shards[key%uint64(len(s.shards))].Push(item)
}

func (s *Sharded) Pop() *Item {
    // Survey the head of each shard, pop the best.
    var best *Item
    var idx int
    for i, sh := range s.shards {
        h := sh.Peek()
        if h != nil && (best == nil || h.Priority < best.Priority) {
            best, idx = h, i
        }
    }
    if best == nil {
        return nil
    }
    return s.shards[idx].Pop()
}
```

Sharding turns a single hot PQ into `n` cooler PQs at the cost of an `n`-way scan on `Pop`. For `n = 4..16` this is a great deal in concurrent workloads.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|----------------|------------------|
| Two equal-priority items, payload not orderable in Python | `TypeError` on `<` | Use `(priority, counter, payload)` tuples. |
| `Iterator` returns items out of order in Java | Programmer expects sorted iteration. | Drain with `poll()`; `iterator()` is unordered. |
| Sharded PQ misses the global minimum | Scan logic compares stale entries. | Re-peek under lock; never cache peeks across mutations. |
| Cancelling a queued job | Item still in PQ, runs unexpectedly. | Mark cancelled, check at pop time; or use indexed-remove. |
| Delayed scheduler "early wake-up" | `condition.wait(timeout)` returned spuriously. | Re-check `head.due_at - now()` after every wake. |

---

## Performance Analysis

Benchmark: push 1M ints, then pop all, on M1 Pro / Java 17.

| Implementation | Push avg (ns) | Pop avg (ns) |
|----------------|--------------:|-------------:|
| `PriorityQueue<Integer>` | 95 | 220 |
| `PriorityBlockingQueue<Integer>` | 145 | 285 |
| Custom indexed binary heap | 78 | 195 |
| `TreeSet<Integer>` (sorted set) | 220 | 240 |
| Bucket PQ, priorities ∈ [0, 256) | 35 | 38 |

A few takeaways:

- The bucket PQ wins when its constraint is met. Always check if priorities are bounded.
- The custom indexed heap beats `PriorityQueue<Integer>` because it avoids autoboxing.
- `TreeSet` is competitive only if you need ordered iteration alongside the PQ.

---

## Best Practices

- Choose `(priority, counter, payload)` tuples by default — saves you from the `TypeError` and gives stability for free.
- Never iterate a PQ assuming order; drain with `pop`.
- If your workload is "produce in bursts," use bulk `heapify` rather than `n` pushes.
- For multi-producer, multi-consumer workloads, prefer the language's concurrent PQ first; build your own only after profiling shows it's the bottleneck.
- Measure `top_priority_age` (how long has the head been waiting?) as a SLO indicator — it catches starvation before users do.

---

## Visual Animation

> See [`animation.html`](./animation.html) for the interactive view.
>
> The middle-level animation toggles among three implementations (binary heap, sorted array, BST) and shows the same operation sequence with their differing costs. Stability mode demonstrates the counter trick.

---

## Summary

A priority queue is the right abstraction whenever "process the most important next" matters. The implementation choice is a workload decision: binary heap for the generic case, d-ary for many decrease-keys, leftist/pairing/Fibonacci for meld-heavy loads, bucket/radix when priorities are bounded integers, sharded variants under contention. Master the indexed-vs-lazy decrease-key trade-off and you have the knob that decides every PQ-driven graph algorithm's performance.
