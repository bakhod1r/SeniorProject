# Priority Queue — Practice Tasks

> All tasks must be solved in Go, Java, and Python.

These exercises focus on the Priority Queue **abstract data type (ADT)**, not just the binary-heap implementation. You will build wrappers, stability layers, bounded variants, indexed PQs, bucket PQs, schedulers, and full algorithms (Dijkstra, A*, K-way merge, streaming median) on top of the PQ contract: `push(item, priority)` and `pop() -> item`.

Each task ships with a starter snippet in all three languages. The key logic is stubbed; you finish the implementation and validate against the evaluation criteria.

---

## Beginner Tasks (5)

### Task 1 — Stdlib PQ Wrapper

**Problem.** Wrap your language's standard heap/priority-queue facility behind a clean ADT surface: `push(item, priority)` and `pop() -> item`. The wrapper must hide the underlying tuple layout, expose `len()` / `size()`, and never leak heap internals.

**I/O spec.** Sequence of operations on stdin (one per line): `PUSH <priority> <item>` or `POP`. For each `POP`, print the item with the lowest priority.

**Constraints.** Up to 10⁵ operations. Priorities are integers in `[-10⁹, 10⁹]`. Items are short ASCII strings.

**Hint.** In Go, `container/heap` requires you to implement the `heap.Interface`. In Java, `PriorityQueue` accepts a `Comparator`. In Python, `heapq` works on raw lists.

```go
package main

import "container/heap"

type item struct {
    priority int
    value    string
}

type minPQ []item

func (h minPQ) Len() int            { return len(h) }
func (h minPQ) Less(i, j int) bool  { return h[i].priority < h[j].priority }
func (h minPQ) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minPQ) Push(x any)         { *h = append(*h, x.(item)) }
func (h *minPQ) Pop() any           { old := *h; n := len(old); v := old[n-1]; *h = old[:n-1]; return v }

type PQ struct{ h *minPQ }

func NewPQ() *PQ { h := &minPQ{}; heap.Init(h); return &PQ{h} }

func (p *PQ) Push(value string, priority int) {
    // TODO: push item{priority, value}
}

func (p *PQ) Pop() (string, bool) {
    // TODO: return "", false on empty; else heap.Pop and unwrap
    return "", false
}
```

```java
import java.util.PriorityQueue;
import java.util.Comparator;

public class StdlibPQ<T> {
    private static class Entry<T> {
        final int priority; final T value;
        Entry(int p, T v) { priority = p; value = v; }
    }

    private final PriorityQueue<Entry<T>> pq =
        new PriorityQueue<>(Comparator.comparingInt(e -> e.priority));

    public void push(T value, int priority) {
        // TODO: offer a new Entry
    }

    public T pop() {
        // TODO: return null on empty; else poll().value
        return null;
    }

    public int size() { return pq.size(); }
}
```

```python
import heapq

class StdlibPQ:
    def __init__(self) -> None:
        self._h: list[tuple[int, object]] = []

    def push(self, item, priority: int) -> None:
        # TODO: heapq.heappush as (priority, item)
        ...

    def pop(self):
        # TODO: return None on empty; else heappop and return the item
        ...

    def __len__(self) -> int:
        return len(self._h)
```

**Evaluation criteria.**
- `pop` returns items in non-decreasing priority order.
- O(log n) per `push` / `pop`.
- No heap internals (indices, swap helpers) leak through the public API.

---

### Task 2 — Stable Priority Queue

**Problem.** Build a STABLE PQ: when two items share a priority, `pop` must return them in insertion order. Use the `(priority, counter, item)` trick where `counter` is a monotonically increasing integer.

**I/O spec.** Same as Task 1. Test specifically with sequences where many items share the same priority.

**Constraints.** Counter must not overflow under 10⁶ pushes. Comparison must never touch the item itself (items may be unhashable / non-comparable).

**Hint.** Python's `heapq` will fall back to comparing items if tuples tie on priority. The counter eliminates that.

```go
package main

type stableEntry struct {
    priority int
    seq      uint64
    value    any
}

type stablePQ struct {
    data []stableEntry
    next uint64
}

func (p *stablePQ) Push(value any, priority int) {
    // TODO: append (priority, p.next, value) and sift up; p.next++
}

func (p *stablePQ) Pop() (any, bool) {
    // TODO: standard min-heap pop; return value
    return nil, false
}

func less(a, b stableEntry) bool {
    if a.priority != b.priority { return a.priority < b.priority }
    return a.seq < b.seq
}
```

```java
import java.util.PriorityQueue;
import java.util.Comparator;

public class StablePQ<T> {
    private static class Entry<T> {
        final int priority; final long seq; final T value;
        Entry(int p, long s, T v) { priority = p; seq = s; value = v; }
    }

    private long counter = 0;
    private final PriorityQueue<Entry<T>> pq = new PriorityQueue<>(
        Comparator.<Entry<T>>comparingInt(e -> e.priority)
                  .thenComparingLong(e -> e.seq)
    );

    public void push(T value, int priority) {
        // TODO: offer new Entry with counter++
    }

    public T pop() {
        // TODO: poll and return value
        return null;
    }
}
```

```python
import heapq
import itertools

class StablePQ:
    def __init__(self) -> None:
        self._h: list[tuple[int, int, object]] = []
        self._counter = itertools.count()

    def push(self, item, priority: int) -> None:
        # TODO: heappush as (priority, next(self._counter), item)
        ...

    def pop(self):
        # TODO: return item portion of heappop tuple
        ...
```

**Evaluation criteria.**
- Two items with equal priority pop in FIFO order.
- The item itself is never compared (works with non-comparable objects).
- No regression in O(log n) complexity.

---

### Task 3 — Max-PQ by Negation

**Problem.** Implement a max-priority queue on top of a min-heap by negating priorities on the way in and on the way out. Write a property-based test that asserts the popped sequence is non-increasing for a random input of 10 000 integers.

**I/O spec.** API: `push(item, priority)`, `pop() -> item`. The first `pop` after a series of pushes must return the maximum-priority item.

**Constraints.** Priorities are int32. Watch out for `INT_MIN` negation overflow.

**Hint.** In Go and Java, use `int64` internally to dodge `INT_MIN` overflow. In Python, integers are unbounded.

```go
package main

type MaxPQ struct {
    inner *PQ // from Task 1
}

func (m *MaxPQ) Push(value string, priority int) {
    // TODO: m.inner.Push(value, -priority)
}

func (m *MaxPQ) Pop() (string, bool) {
    // TODO: delegate to m.inner.Pop()
    return "", false
}
```

```java
public class MaxPQ<T> {
    private final StdlibPQ<T> inner = new StdlibPQ<>();

    public void push(T value, int priority) {
        // TODO: inner.push(value, -priority); guard against Integer.MIN_VALUE
    }

    public T pop() {
        return inner.pop();
    }
}
```

```python
class MaxPQ:
    def __init__(self) -> None:
        self._inner = StdlibPQ()

    def push(self, item, priority: int) -> None:
        # TODO: push with negated priority
        ...

    def pop(self):
        return self._inner.pop()


def property_test():
    import random
    pq = MaxPQ()
    values = [random.randint(-10**6, 10**6) for _ in range(10_000)]
    for v in values:
        pq.push(v, v)
    out = []
    while True:
        x = pq.pop()
        if x is None: break
        out.append(x)
    assert out == sorted(values, reverse=True)
```

**Evaluation criteria.**
- Property test passes on 100 random seeds.
- Boundary case `INT_MIN` does not crash or silently flip sign.
- API mirrors the min-PQ surface from Task 1.

---

### Task 4 — Bounded Priority Queue

**Problem.** Build a PQ with a fixed capacity `k`. On `push`, if the queue is full, evict the **worst** item (highest priority in a min-PQ-of-best-k design). After all pushes, the queue holds the `k` lowest-priority items seen so far.

**I/O spec.** Constructor `BoundedPQ(k)`. Methods `push(item, priority)` and `drain() -> list[item]` in ascending priority order.

**Constraints.** k up to 10⁴. n up to 10⁶ pushes. Must stay O(log k) per push.

**Hint.** Use an internal **max-heap of size k**: push first, then pop the largest if size exceeds k. Final drain reverses to ascending.

```go
package main

type BoundedPQ struct {
    k    int
    maxH *MaxPQ
}

func NewBoundedPQ(k int) *BoundedPQ { return &BoundedPQ{k: k, maxH: &MaxPQ{}} }

func (b *BoundedPQ) Push(value string, priority int) {
    // TODO:
    // 1. maxH.Push(value, priority)
    // 2. if size > k, maxH.Pop()
}

func (b *BoundedPQ) Drain() []string {
    // TODO: pop all into a slice, then reverse
    return nil
}
```

```java
import java.util.*;

public class BoundedPQ<T> {
    private final int k;
    private final PriorityQueue<int[]> maxH; // [priority, index]
    private final List<T> values = new ArrayList<>();

    public BoundedPQ(int k) {
        this.k = k;
        this.maxH = new PriorityQueue<>((a, b) -> b[0] - a[0]);
    }

    public void push(T value, int priority) {
        // TODO: add to values, offer [priority, idx], evict if size > k
    }

    public List<T> drain() {
        // TODO: pop all, reverse, return
        return List.of();
    }
}
```

```python
import heapq

class BoundedPQ:
    def __init__(self, k: int) -> None:
        self._k = k
        self._h: list[tuple[int, int, object]] = []  # max-heap via negation
        self._seq = 0

    def push(self, item, priority: int) -> None:
        # TODO: heappush as (-priority, seq, item); if len > k, heappop
        ...

    def drain(self) -> list:
        # TODO: extract all, sort ascending by original priority
        ...
```

**Evaluation criteria.**
- After 10⁶ pushes with k = 10⁴, memory stays bounded by `O(k)`.
- Per-push cost is O(log k).
- `drain()` output is sorted ascending by priority.

---

### Task 5 — Last-Write-Wins Stream

**Problem.** A stream emits `(key, priority)` pairs. If the same key arrives again with a different priority, the **latest** priority wins. After the stream ends, print all unique keys in priority order.

**I/O spec.** Stdin: `<key> <priority>` per line, EOF terminates. Stdout: keys in ascending priority order, one per line.

**Constraints.** Up to 10⁶ events, up to 10⁵ unique keys.

**Hint.** Use a hash map `key -> latest_priority`. On finalisation, push every `(priority, key)` pair into a min-PQ and drain it. Alternatively use lazy deletion in the PQ as items arrive.

```go
package main

import "fmt"

func lastWriteWins(events []struct {
    Key      string
    Priority int
}) []string {
    latest := map[string]int{}
    for _, e := range events {
        latest[e.Key] = e.Priority
    }
    // TODO: push every (priority, key) into PQ, drain into result
    return nil
}

func main() {
    var k string
    var p int
    var events []struct{ Key string; Priority int }
    for {
        _, err := fmt.Scan(&k, &p)
        if err != nil { break }
        events = append(events, struct{ Key string; Priority int }{k, p})
    }
    for _, k := range lastWriteWins(events) {
        fmt.Println(k)
    }
}
```

```java
import java.util.*;

public class LastWriteWins {
    public static List<String> resolve(List<Map.Entry<String, Integer>> events) {
        Map<String, Integer> latest = new HashMap<>();
        for (var e : events) latest.put(e.getKey(), e.getValue());
        // TODO: dump into a PriorityQueue and drain in order
        return List.of();
    }
}
```

```python
import heapq

def last_write_wins(events: list[tuple[str, int]]) -> list[str]:
    latest: dict[str, int] = {}
    for key, prio in events:
        latest[key] = prio
    # TODO: build heap from latest.items() and drain
    ...
```

**Evaluation criteria.**
- Same key with multiple priorities resolves to the last seen.
- Output is strictly sorted by the final priority.
- O((n + u log u)) time where u is the unique-key count.

---

## Intermediate Tasks (5)

### Task 6 — Deadline-Driven Task Scheduler

**Problem.** Implement a single-threaded scheduler that accepts jobs as `(deadline_unix_ms, fn)`. The runner pops the next-earliest-deadline job, sleeps until that deadline, runs the function, and repeats. Late submissions for already-passed deadlines run immediately.

**I/O spec.** API: `submit(deadline_ms, fn)`, `run_until_empty()`. Log each run as `RAN @<t> (expected <deadline>)`.

**Constraints.** Up to 10⁴ pending jobs. Sleep must be interruptible: a newer earlier deadline must preempt the current sleep.

**Hint.** Use a min-PQ keyed by `deadline_ms`. To support preemption, wrap the sleep in a condition variable / channel that is signalled on every `submit`.

```go
package main

import (
    "container/heap"
    "sync"
    "time"
)

type job struct {
    deadline int64
    fn       func()
}

type jobHeap []job

func (h jobHeap) Len() int            { return len(h) }
func (h jobHeap) Less(i, j int) bool  { return h[i].deadline < h[j].deadline }
func (h jobHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *jobHeap) Push(x any)         { *h = append(*h, x.(job)) }
func (h *jobHeap) Pop() any           { o := *h; v := o[len(o)-1]; *h = o[:len(o)-1]; return v }

type Scheduler struct {
    mu      sync.Mutex
    cond    *sync.Cond
    h       jobHeap
    stopped bool
}

func NewScheduler() *Scheduler {
    s := &Scheduler{}
    s.cond = sync.NewCond(&s.mu)
    return s
}

func (s *Scheduler) Submit(deadlineMs int64, fn func()) {
    // TODO: lock, heap.Push, broadcast
}

func (s *Scheduler) Run() {
    // TODO: loop — wait while empty, peek next deadline, sleep with preemption, run
}

func nowMs() int64 { return time.Now().UnixMilli() }
```

```java
import java.util.*;
import java.util.concurrent.locks.*;

public class Scheduler {
    private final PriorityQueue<long[]> heap =
        new PriorityQueue<>(Comparator.comparingLong(j -> j[0]));
    private final Map<Long, Runnable> fns = new HashMap<>();
    private long seq = 0;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition cond = lock.newCondition();

    public void submit(long deadlineMs, Runnable fn) {
        // TODO: lock, push [deadline, seq++], store fn, signalAll
    }

    public void run() throws InterruptedException {
        // TODO: loop — await while empty, peek, awaitNanos until deadline, run on expiry
    }
}
```

```python
import heapq
import threading
import time

class Scheduler:
    def __init__(self) -> None:
        self._h: list[tuple[float, int, callable]] = []
        self._seq = 0
        self._cv = threading.Condition()

    def submit(self, deadline_ms: float, fn) -> None:
        # TODO: with cv, heappush, cv.notify_all()
        ...

    def run(self) -> None:
        # TODO: loop — with cv: while empty wait; peek; cv.wait(timeout=delay); on expiry pop & run
        ...
```

**Evaluation criteria.**
- A job submitted with an earlier deadline preempts an in-progress sleep.
- Past-due jobs run immediately on submission.
- No busy-waiting: CPU is near-zero between jobs.

---

### Task 7 — K-Way Merge via Min-PQ

**Problem.** Given `k` sorted input streams, produce one merged sorted stream. Use a min-PQ of stream cursors: each cursor holds `(current_value, stream_id)`. Pop the smallest, emit it, then push the next value from that stream.

**I/O spec.** Input: `k` lines, each a space-separated sorted sequence. Output: one space-separated merged sequence.

**Constraints.** k up to 10³, total elements up to 10⁶.

**Hint.** Resist materialising every element into the PQ at once — keep only one cursor per stream. Memory should be O(k), not O(n).

```go
package main

type cursor struct {
    value, stream, idx int
}

func KMerge(streams [][]int) []int {
    // TODO:
    // 1. seed PQ with (streams[i][0], i, 0) for non-empty streams
    // 2. pop smallest; push next from the same stream if any
    return nil
}
```

```java
import java.util.*;

public class KMerge {
    public static int[] merge(int[][] streams) {
        PriorityQueue<int[]> pq =
            new PriorityQueue<>(Comparator.comparingInt(a -> a[0])); // [value, stream, idx]
        // TODO: seed and drain
        return new int[0];
    }
}
```

```python
import heapq

def kmerge(streams: list[list[int]]) -> list[int]:
    pq: list[tuple[int, int, int]] = []
    for i, s in enumerate(streams):
        if s:
            heapq.heappush(pq, (s[0], i, 0))
    out: list[int] = []
    # TODO: while pq, pop (v, i, j); append v; if j+1 < len(streams[i]) push next
    return out
```

**Evaluation criteria.**
- Memory in PQ never exceeds k.
- Output is sorted in non-decreasing order.
- Time complexity is `O(n log k)`.

---

### Task 8 — Top-K Frequent Words

**Problem.** Given a paragraph, find the `k` most frequent words. Use a min-PQ of size `k` keyed by frequency; words less frequent than the heap's minimum are discarded.

**I/O spec.** Input: one paragraph on stdin and an integer `k`. Output: top-k words, most frequent first, ties broken alphabetically.

**Constraints.** Up to 10⁶ tokens, vocabulary up to 10⁵.

**Hint.** Tie-breaking matters: in a min-PQ keyed by `(freq, word)`, alphabetical order is reversed when popping in descending fashion. Push `(freq, -word_order)` if you want alphabetical ties popped last.

```go
package main

import "strings"

func TopK(paragraph string, k int) []string {
    counts := map[string]int{}
    for _, w := range strings.Fields(paragraph) {
        counts[w]++
    }
    // TODO: min-PQ of size k keyed by (freq, word); after fill, drain & reverse
    return nil
}
```

```java
import java.util.*;

public class TopK {
    public static List<String> topK(String paragraph, int k) {
        Map<String, Integer> counts = new HashMap<>();
        for (String w : paragraph.split("\\s+")) {
            counts.merge(w, 1, Integer::sum);
        }
        PriorityQueue<Map.Entry<String, Integer>> pq = new PriorityQueue<>(
            (a, b) -> a.getValue().equals(b.getValue())
                      ? b.getKey().compareTo(a.getKey())
                      : a.getValue() - b.getValue()
        );
        // TODO: maintain heap of size k; drain into reversed result
        return List.of();
    }
}
```

```python
import heapq
from collections import Counter

def top_k(paragraph: str, k: int) -> list[str]:
    counts = Counter(paragraph.split())
    h: list[tuple[int, str]] = []
    for word, freq in counts.items():
        # TODO: push (freq, word); if len > k, heappop
        ...
    # TODO: sort by (-freq, word) and return words
    return []
```

**Evaluation criteria.**
- Heap size stays `<= k` throughout.
- Ties broken alphabetically.
- O(n log k) time, O(k) extra space.

---

### Task 9 — Bucket / Radix Priority Queue

**Problem.** When priorities are bounded integers in `[0, 256)`, a bucket PQ beats a heap. Implement 256 FIFO buckets plus a bitmap of non-empty buckets; `pop` finds the lowest non-empty bucket via bit-scan.

**I/O spec.** API: `push(item, priority)`, `pop() -> item`. All operations must be **O(1) amortised**.

**Constraints.** Priorities in `[0, 256)`. Items can be any type. 10⁶ operations.

**Hint.** Maintain a `uint256` bitmap (in Go/Java: four `uint64`s). Find lowest non-empty bucket with `Long.numberOfTrailingZeros` (Java) / `bits.TrailingZeros64` (Go) / `(b & -b).bit_length() - 1` (Python).

```go
package main

import "math/bits"

type BucketPQ struct {
    buckets [256][]any
    mask    [4]uint64 // 256 bits total
    size    int
}

func (b *BucketPQ) Push(item any, priority int) {
    // TODO: append to buckets[priority]; set bit (priority/64, priority%64)
}

func (b *BucketPQ) Pop() (any, bool) {
    // TODO: scan mask for first set bit via bits.TrailingZeros64; pop bucket front; clear bit if bucket empty
    return nil, false
}
```

```java
public class BucketPQ<T> {
    @SuppressWarnings("unchecked")
    private final java.util.ArrayDeque<T>[] buckets = new java.util.ArrayDeque[256];
    private final long[] mask = new long[4];
    private int size = 0;

    public BucketPQ() {
        for (int i = 0; i < 256; i++) buckets[i] = new java.util.ArrayDeque<>();
    }

    public void push(T item, int priority) {
        // TODO: offer to buckets[priority], set bit, size++
    }

    public T pop() {
        // TODO: scan mask; pollFirst; clear bit if bucket empty; size--
        return null;
    }
}
```

```python
class BucketPQ:
    def __init__(self) -> None:
        self._buckets: list[list] = [[] for _ in range(256)]
        self._mask = 0  # Python int → arbitrary precision bitmap
        self._size = 0

    def push(self, item, priority: int) -> None:
        # TODO: append, set bit, size++
        ...

    def pop(self):
        # TODO: find lowest set bit via (mask & -mask).bit_length() - 1; pop list; clear bit if empty
        ...
```

**Evaluation criteria.**
- All operations O(1) amortised.
- FIFO order preserved within the same priority bucket.
- Beats a heap-based PQ by at least 3x for 10⁶ uniform-priority operations.

---

### Task 10 — Streaming Median with Two PQs

**Problem.** Given an integer stream, maintain the running median after each insertion using a max-PQ for the lower half and a min-PQ for the upper half. Print the median after each insertion.

**I/O spec.** Stdin: integers separated by whitespace. Stdout: one median per line (as a float for even sizes).

**Constraints.** Up to 10⁶ integers, in `[-10⁹, 10⁹]`.

**Hint.** Invariants: `|low| - |high| in {0, 1}`. On each insert, choose which heap to push to by comparing with `low.peek()`, then rebalance if sizes differ by more than one.

```go
package main

type MedianStream struct {
    low  *MaxPQ // from Task 3
    high *PQ    // from Task 1
}

func (m *MedianStream) Add(x int) {
    // TODO: route to low/high, then rebalance
}

func (m *MedianStream) Median() float64 {
    // TODO: depending on sizes, return top of low, or average of tops
    return 0
}
```

```java
import java.util.PriorityQueue;
import java.util.Collections;

public class MedianStream {
    private final PriorityQueue<Integer> low  = new PriorityQueue<>(Collections.reverseOrder());
    private final PriorityQueue<Integer> high = new PriorityQueue<>();

    public void add(int x) {
        // TODO: insert into appropriate heap, then rebalance
    }

    public double median() {
        // TODO: if sizes equal, average; else top of larger heap
        return 0.0;
    }
}
```

```python
import heapq

class MedianStream:
    def __init__(self) -> None:
        self._low: list[int]  = []  # max-heap via negation
        self._high: list[int] = []  # min-heap

    def add(self, x: int) -> None:
        # TODO: route + rebalance
        ...

    def median(self) -> float:
        # TODO: return median based on heap sizes
        ...
```

**Evaluation criteria.**
- O(log n) per insertion.
- Correct medians for sequences with odd and even lengths.
- Memory exactly `n` plus heap overhead.

---

## Advanced Tasks (5)

### Task 11 — Indexed Priority Queue with `decrease_key`

**Problem.** Implement an indexed PQ supporting `push(id, priority)`, `pop() -> id`, and `decrease_key(id, new_priority)`. Maintain an external `pos[id] -> heap_index` so `decrease_key` is O(log n) instead of O(n).

**I/O spec.** API surface as above. `id` is an integer in `[0, capacity)`.

**Constraints.** Capacity up to 10⁶. All operations must be O(log n).

**Hint.** On every swap inside sift-up / sift-down, update both `pos[]` entries. Reject `decrease_key` if the new priority is not strictly less than the current.

```go
package main

type IndexedPQ struct {
    heap     []int      // heap[i] = id
    pos      []int      // pos[id] = i, -1 if absent
    priority []int
}

func NewIndexedPQ(cap int) *IndexedPQ {
    p := &IndexedPQ{pos: make([]int, cap), priority: make([]int, cap)}
    for i := range p.pos { p.pos[i] = -1 }
    return p
}

func (p *IndexedPQ) Push(id, priority int) {
    // TODO: append, set pos, set priority, sift up
}

func (p *IndexedPQ) DecreaseKey(id, newPriority int) {
    // TODO: assert newPriority < current; update; sift up from pos[id]
}

func (p *IndexedPQ) Pop() (int, bool) {
    // TODO: swap root with last, shrink, sift down, clear pos
    return 0, false
}

func (p *IndexedPQ) swap(i, j int) {
    p.heap[i], p.heap[j] = p.heap[j], p.heap[i]
    p.pos[p.heap[i]] = i
    p.pos[p.heap[j]] = j
}
```

```java
public class IndexedPQ {
    private final int[] heap;
    private final int[] pos;
    private final int[] priority;
    private int n = 0;

    public IndexedPQ(int capacity) {
        heap = new int[capacity];
        pos = new int[capacity];
        priority = new int[capacity];
        java.util.Arrays.fill(pos, -1);
    }

    public void push(int id, int p) {
        // TODO: place at end, sift up, maintain pos[]
    }

    public void decreaseKey(int id, int newP) {
        // TODO: validate newP < priority[id]; update; sift up from pos[id]
    }

    public int pop() {
        // TODO: swap root with last, sift down, return root id, mark pos[id]=-1
        return -1;
    }
}
```

```python
class IndexedPQ:
    def __init__(self, capacity: int) -> None:
        self._heap: list[int] = []
        self._pos: list[int] = [-1] * capacity
        self._priority: list[int] = [0] * capacity

    def push(self, id_: int, priority: int) -> None:
        # TODO: append, set pos, sift up
        ...

    def decrease_key(self, id_: int, new_priority: int) -> None:
        # TODO: assert smaller, update priority, sift up from pos[id_]
        ...

    def pop(self) -> int:
        # TODO: swap root and last, sift down, clear pos[id]
        ...
```

**Evaluation criteria.**
- `decrease_key` is O(log n) on average.
- `pos[]` is internally consistent after every operation (assert with a debug pass).
- Rejects invalid `decrease_key` calls (new >= old).

---

### Task 12 — Dijkstra: Lazy vs. Indexed PQ Benchmark

**Problem.** Implement Dijkstra's shortest-path algorithm twice:
- **(a) Lazy duplicates**: push every relaxation, skip stale pops via a visited set.
- **(b) Indexed PQ**: use `decrease_key` from Task 11 — at most one entry per vertex in the PQ.

Benchmark both on a random graph with `V = 10⁴` and `E = 10⁵`. Report wall time and peak PQ size.

**I/O spec.** Function `dijkstra(adj, src) -> dist[]`. Both variants must return identical distance arrays.

**Constraints.** Edge weights are positive integers `[1, 10⁵]`.

**Hint.** On dense random graphs, lazy Dijkstra often wins on wall time despite the larger heap, because `decrease_key` swap chains can be expensive. Measure rather than assume.

```go
package main

func DijkstraLazy(adj [][]struct{ To, W int }, src int) []int {
    // TODO: classic implementation with skip-on-stale-pop
    return nil
}

func DijkstraIndexed(adj [][]struct{ To, W int }, src int, ipq *IndexedPQ) []int {
    // TODO: insert all with INF; decrease_key on relaxation
    return nil
}
```

```java
import java.util.*;

public class Dijkstra {
    public static int[] lazy(List<int[]>[] adj, int src) {
        // TODO: PriorityQueue<int[]>; skip if dist > popped
        return new int[0];
    }

    public static int[] indexed(List<int[]>[] adj, int src) {
        // TODO: use IndexedPQ.decreaseKey on relaxation
        return new int[0];
    }
}
```

```python
import heapq
import math

def dijkstra_lazy(adj: list[list[tuple[int, int]]], src: int) -> list[int]:
    dist = [math.inf] * len(adj)
    dist[src] = 0
    h: list[tuple[int, int]] = [(0, src)]
    # TODO: pop; skip if d > dist[u]; relax neighbors and push
    return dist

def dijkstra_indexed(adj: list[list[tuple[int, int]]], src: int) -> list[int]:
    # TODO: same logic, but use IndexedPQ.decrease_key on relax
    ...
```

**Evaluation criteria.**
- Both variants produce identical distance vectors.
- Benchmark table reports `(impl, ms, peak_pq_size)` for at least 5 graph instances.
- Written analysis explains which won and why on this graph density.

---

### Task 13 — Multi-Tenant Fair PQ via Deficit Round-Robin

**Problem.** N tenants each have a sub-PQ. A scheduler must serve them fairly using **Deficit Round-Robin (DRR)**: every round each tenant gains `quantum` credit; a tenant can serve while it has positive deficit. Items cost their priority value in deficit.

**I/O spec.** API: `submit(tenant, item, cost)`, `next() -> (tenant, item)`. Over a long sequence, throughput per tenant must converge to its quantum share.

**Constraints.** Up to 10³ tenants, up to 10⁵ items per tenant.

**Hint.** Use a round-robin queue of **active** tenants (those with pending items). When you reach a tenant, add `quantum` to its deficit; serve while deficit >= cheapest item's cost. Deactivate if empty.

```go
package main

type DRRScheduler struct {
    tenants  map[string]*PQ // sub-PQs
    deficit  map[string]int
    active   []string
    quantum  int
}

func (d *DRRScheduler) Submit(tenant, item string, cost int) {
    // TODO: ensure tenant exists, push (item, cost), enqueue tenant if inactive
}

func (d *DRRScheduler) Next() (string, string, bool) {
    // TODO: pop front of active; add quantum; while top.cost <= deficit, serve & return; else move to back
    return "", "", false
}
```

```java
import java.util.*;

public class DRRScheduler<T> {
    private final Map<String, PriorityQueue<int[]>> subs = new HashMap<>();
    private final Map<String, Integer> deficit = new HashMap<>();
    private final Deque<String> active = new ArrayDeque<>();
    private final int quantum;

    public DRRScheduler(int quantum) { this.quantum = quantum; }

    public void submit(String tenant, T item, int cost) {
        // TODO: lazy-init sub-PQ; add to active if inactive
    }

    public T next() {
        // TODO: DRR loop
        return null;
    }
}
```

```python
import heapq
from collections import deque

class DRRScheduler:
    def __init__(self, quantum: int) -> None:
        self._subs: dict[str, list] = {}
        self._deficit: dict[str, int] = {}
        self._active: deque[str] = deque()
        self._quantum = quantum

    def submit(self, tenant: str, item, cost: int) -> None:
        # TODO: setdefault sub, heappush, enqueue tenant if inactive
        ...

    def next(self):
        # TODO: DRR cycle; return (tenant, item)
        ...
```

**Evaluation criteria.**
- Over 10⁵ items with three tenants and equal quantum, throughput per tenant is within 5% of equal.
- A tenant that goes idle and returns is not starved nor advantaged.
- O(1) amortised per served item (PQ ops aside).

---

### Task 14 — Persistent PQ on Redis ZSET

**Problem.** Build a PQ on top of Redis sorted sets: `ZADD key score member` to push and `ZPOPMIN key` to pop. The PQ survives process restarts. Optionally tag items with a stable id so producers can update priorities.

**I/O spec.** API: `push(member, score)`, `pop() -> (member, score) | None`, `update(member, new_score)`.

**Constraints.** Redis 5+. Single-PQ throughput up to 10⁴ ops/sec.

**Hint.** `ZPOPMIN` is atomic. For batch consumers use `ZPOPMIN key N`. For race-free updates use `ZADD XX CH` to refuse inserts of unknown members.

```go
package main

import "github.com/redis/go-redis/v9"

type RedisPQ struct {
    client *redis.Client
    key    string
}

func (r *RedisPQ) Push(ctx context.Context, member string, score float64) error {
    // TODO: r.client.ZAdd(ctx, r.key, redis.Z{Score: score, Member: member}).Err()
    return nil
}

func (r *RedisPQ) Pop(ctx context.Context) (string, float64, error) {
    // TODO: r.client.ZPopMin(ctx, r.key, 1) and unwrap
    return "", 0, nil
}

func (r *RedisPQ) Update(ctx context.Context, member string, newScore float64) error {
    // TODO: ZAdd with XX flag (refuse insert of unknown members)
    return nil
}
```

```java
import redis.clients.jedis.Jedis;
import redis.clients.jedis.params.ZAddParams;

public class RedisPQ {
    private final Jedis jedis;
    private final String key;

    public RedisPQ(Jedis jedis, String key) {
        this.jedis = jedis; this.key = key;
    }

    public void push(String member, double score) {
        // TODO: jedis.zadd(key, score, member)
    }

    public java.util.Map.Entry<String, Double> pop() {
        // TODO: jedis.zpopmin(key) and unwrap
        return null;
    }

    public void update(String member, double newScore) {
        // TODO: jedis.zadd(key, newScore, member, ZAddParams.zAddParams().xx())
    }
}
```

```python
import redis

class RedisPQ:
    def __init__(self, client: redis.Redis, key: str) -> None:
        self._r = client
        self._key = key

    def push(self, member: str, score: float) -> None:
        # TODO: self._r.zadd(self._key, {member: score})
        ...

    def pop(self) -> tuple[str, float] | None:
        # TODO: self._r.zpopmin(self._key, 1); return None if empty
        ...

    def update(self, member: str, new_score: float) -> None:
        # TODO: self._r.zadd(self._key, {member: new_score}, xx=True)
        ...
```

**Evaluation criteria.**
- Survives a process restart with no item loss.
- `update` does not insert new members.
- Throughput >= 5 000 ops/sec on a local Redis with pipelining.

---

### Task 15 — A* Search on a 2D Grid

**Problem.** Implement A* on a 2D grid with walls, using your PQ from Task 1 (or indexed PQ from Task 11). Use Manhattan distance as the heuristic. Print the visited frontier as ASCII (`.` unvisited, `o` visited, `*` on the final path, `#` walls).

**I/O spec.** Input: grid as lines of `.` / `#`, start, goal. Output: the visited grid as described.

**Constraints.** Grid up to 1 000 × 1 000.

**Hint.** Push `(f = g + h, node)`. Keep `gScore[node]`. Only accept a popped node if the popped `g` matches the best known `g`. When goal is popped, reconstruct via a `cameFrom` map.

```go
package main

import "container/heap"

type astarNode struct {
    f, g, x, y int
}

func AStar(grid [][]byte, sx, sy, gx, gy int) ([][2]int, [][]byte) {
    // TODO:
    // 1. min-PQ of astarNode by f
    // 2. gScore map; cameFrom map
    // 3. loop: pop; if goal, reconstruct; else relax 4 neighbours
    return nil, nil
}
```

```java
import java.util.*;

public class AStar {
    public static List<int[]> search(char[][] grid, int sx, int sy, int gx, int gy) {
        PriorityQueue<int[]> open =
            new PriorityQueue<>(Comparator.comparingInt(a -> a[0])); // [f, g, x, y]
        // TODO: standard A* loop with gScore, cameFrom, manhattan heuristic
        return List.of();
    }
}
```

```python
import heapq

def astar(grid: list[str], start: tuple[int, int], goal: tuple[int, int]):
    def h(p): return abs(p[0] - goal[0]) + abs(p[1] - goal[1])
    open_pq: list[tuple[int, int, tuple[int, int]]] = [(h(start), 0, start)]
    g_score = {start: 0}
    came_from: dict[tuple[int, int], tuple[int, int]] = {}
    visited: set[tuple[int, int]] = set()
    # TODO: classic A* loop; on goal, reconstruct path via came_from
    return [], visited
```

**Evaluation criteria.**
- Finds an optimal path on any solvable grid.
- Visited frontier shape resembles a teardrop pointing toward the goal (heuristic working).
- Handles a grid with no path by returning an empty result, not by hanging.

---

## Benchmark Task

### Task B1 — Cross-Language PQ Benchmark

**Problem.** Build a small benchmark harness that compares three PQ implementations across three languages:

| Implementation       | Description                                  |
| -------------------- | -------------------------------------------- |
| (a) Stdlib PQ        | Task 1 — wrapper around `heapq`/`PriorityQueue`/`container/heap` |
| (b) Custom Indexed PQ| Task 11                                      |
| (c) Bucket PQ        | Task 9 — only for priorities in `[0, 256)`   |

**Workload.** For each `n in {10⁴, 10⁵, 10⁶}`:
1. Push `n` items with random priorities (use `priority mod 256` for the bucket PQ run).
2. Pop until empty, asserting non-decreasing pop order.
3. Mix workload: alternate `push` and `pop` for `n` rounds.

**Measure.** Wall-clock time and (where the runtime allows) peak resident memory.

**Output format.** A markdown table per language, plus a final summary table:

```text
| Lang   | n      | impl     | push_ms | pop_ms | mixed_ms |
| ------ | ------ | -------- | ------- | ------ | -------- |
| go     | 10000  | stdlib   |   ...   |  ...   |   ...    |
| go     | 10000  | indexed  |   ...   |  ...   |   ...    |
| go     | 10000  | bucket   |   ...   |  ...   |   ...    |
| ...    | ...    | ...      |   ...   |  ...   |   ...    |
```

**Discussion.** Write a short paragraph (5–8 sentences) addressing:
- For which `n` does the bucket PQ dominate, and why does the lead shrink as `n` grows?
- How does Go's `container/heap` compare to Java's `PriorityQueue` and Python's `heapq` on identical input?
- When does indexed-PQ overhead outweigh its `decrease_key` win?
- Which language wins outright? Which language is the most predictable across `n`?

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func benchPush(pq interface{ Push(string, int) }, n int) time.Duration {
    rng := rand.New(rand.NewSource(42))
    t0 := time.Now()
    for i := 0; i < n; i++ {
        pq.Push("x", rng.Intn(1<<30))
    }
    return time.Since(t0)
}

func main() {
    for _, n := range []int{10_000, 100_000, 1_000_000} {
        // TODO: instantiate three PQs and time push / pop / mixed
        fmt.Println(n)
    }
}
```

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {10_000, 100_000, 1_000_000};
        for (int n : sizes) {
            // TODO: bench (a), (b), (c) and emit markdown row
        }
    }
}
```

```python
import random
import time

def bench_push(pq, n: int) -> float:
    rnd = random.Random(42)
    t0 = time.perf_counter()
    for _ in range(n):
        pq.push("x", rnd.randint(0, 1 << 30))
    return (time.perf_counter() - t0) * 1000

def main() -> None:
    for n in (10_000, 100_000, 1_000_000):
        # TODO: instantiate three PQs and bench push / pop / mixed
        ...

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- All three languages produce a consistent table format that can be diffed.
- Bucket PQ measurably beats stdlib for n = 10⁶ on small-priority workloads.
- Discussion paragraph references actual numbers, not guesses.
- Benchmarks are repeatable (fixed seed) and isolate one variable per row.
