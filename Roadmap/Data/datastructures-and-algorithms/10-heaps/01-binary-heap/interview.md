# Binary Heap — Interview Preparation

A binary heap is one of the most reliable data structures to bring up in a coding interview: it is small enough to implement on a whiteboard, expressive enough to power priority queues, top-K queries, Dijkstra, Prim, heap-sort and streaming statistics, and it has a few "gotchas" that distinguish a candidate who memorized the API from one who truly understands the structure. This file is a curated bank of questions sorted by seniority, behavioral prompts, and three end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Operation              | Complexity       | Notes                                                 |
|------------------------|------------------|-------------------------------------------------------|
| `peek()`               | O(1)             | Top is always at index 0 (or 1 in 1-indexed form).    |
| `push(x)`              | O(log n)         | Sift up after appending at the end.                   |
| `pop()`                | O(log n)         | Swap root with last, shrink, sift down.               |
| `buildHeap(arr)`       | O(n)             | Heapify from `n/2 - 1` down to `0`.                   |
| `heapSort(arr)`        | O(n log n)       | In-place, not stable.                                 |
| `decreaseKey(i, v)`    | O(log n)         | Requires an index map for arbitrary elements.         |
| `delete(i)`            | O(log n)         | Replace with last, then sift up or down.              |
| `merge(h1, h2)`        | O(n + m)         | Concatenate arrays then heapify.                      |
| Space                  | O(n)             | Contiguous array, excellent cache locality.           |

Index formulas (0-indexed array):

```text
parent(i)      = (i - 1) / 2
leftChild(i)   = 2 * i + 1
rightChild(i)  = 2 * i + 2
lastInternal   = n / 2 - 1
```

Index formulas (1-indexed array, classic CLRS form):

```text
parent(i)      = i / 2
leftChild(i)   = 2 * i
rightChild(i)  = 2 * i + 1
```

Invariants:

- **Shape:** complete binary tree (every level full except possibly the last, which fills left to right).
- **Order:** in a min-heap, `A[parent(i)] <= A[i]` for all valid `i`; max-heap is symmetric.

---

## Junior Questions (12 Q&A)

### J1. What is a binary heap?
A binary heap is a complete binary tree that maintains a heap order between every parent and its children. In a min-heap, every parent is less than or equal to both of its children; in a max-heap, every parent is greater than or equal to its children. Because the tree is complete, it can be stored compactly in an array, where index relationships replace pointers. Heaps are the canonical implementation of a priority queue. They are not sorted: only the path from the root to any leaf is monotonic.

### J2. Why store a heap in an array rather than using nodes?
A complete binary tree has no "holes" except at the rightmost positions of the last level, so its level-order traversal packs perfectly into a contiguous array. That gives O(1) parent and child lookups using arithmetic instead of pointer dereferences, eliminates per-node memory overhead, and gives excellent CPU cache locality. The array representation is also easier to clone, serialize, and rebalance after build-heap. The only cost is occasional resizing when the array grows.

### J3. What is the difference between a min-heap and a max-heap?
A min-heap places the smallest element at the root; a max-heap places the largest. The operations are identical except that comparisons are inverted. You can simulate a max-heap with a min-heap by negating keys (for numbers) or using a reverse comparator (for objects). Most standard libraries default to min-heaps: Python's `heapq`, Java's `PriorityQueue`, and Go's `container/heap` interface.

### J4. What is the time complexity of `push` and `pop`?
Both are O(log n). `push` appends the new element at the end of the array and then "sifts up," swapping with its parent until the heap property holds. `pop` removes the root, moves the last element into its slot, then "sifts down," swapping with the smaller (for a min-heap) of its two children until the property is restored. The height of a complete binary tree of n nodes is ⌊log₂ n⌋, so both operations are bounded by that height.

### J5. How does `peek` work and why is it O(1)?
`peek` returns the root of the heap, which is always stored at index 0 in a 0-indexed array (or index 1 in the textbook 1-indexed form). Reading an array element by index is O(1) and the heap property guarantees the root is the minimum (or maximum). No tree traversal is needed.

### J6. What does the "complete binary tree" requirement actually buy you?
Completeness is what makes the array representation valid. If gaps were allowed in the middle of the tree, you would need a sparse representation or pointers. Completeness also bounds the height at ⌊log₂ n⌋, which is what makes `push`/`pop` logarithmic. It also lets you find the "last" element in O(1) — it is just `array[n - 1]`.

### J7. How do you build a heap from an unsorted array?
Iterate from the last internal node (index `n/2 - 1`) down to index 0 and call sift-down on each. This is called Floyd's algorithm. Naively you might think it is O(n log n), but a tighter analysis based on level heights yields O(n). Building a heap by repeated `push` is O(n log n), so the Floyd construction is strictly faster.

### J8. What is a priority queue and how does a heap implement one?
A priority queue is an abstract data type that supports inserting elements with a priority and removing the element with the highest (or lowest) priority. A binary heap is the most common concrete implementation, giving O(log n) insert and remove with O(1) peek. Other implementations include sorted arrays, unsorted arrays, balanced BSTs, and skip lists, but a binary heap usually offers the best constant factors for typical workloads.

### J9. Can you search for an arbitrary element in a heap efficiently?
No. The heap property only relates parents and children, not siblings or arbitrary positions. To find a specific value you must scan the array, which is O(n). If you need fast lookup of arbitrary elements (for example, to update a priority), you maintain an auxiliary hash map from value to its current index, updated on every swap.

### J10. Is heap-sort stable?
No. During sift-up and sift-down, equal elements may be swapped with their parents or children, which destroys their original relative order. If stability is required, you either tag each element with its original index and compare on (value, index), or you choose a different stable sort such as merge sort or Timsort.

### J11. What language standard libraries already ship a heap?
- Python: `heapq` (min-heap of arbitrary comparables) and `queue.PriorityQueue` (thread-safe wrapper).
- Java: `java.util.PriorityQueue` (min-heap by default; pass a comparator for max-heap).
- Go: `container/heap` is an interface; you implement `Len`, `Less`, `Swap`, `Push`, `Pop` on your slice type.
- C++: `std::priority_queue` (max-heap by default) and the lower-level `std::make_heap`, `std::push_heap`, `std::pop_heap` on raw vectors.
- JavaScript/TypeScript: no built-in; people usually implement one or pull in a npm package.

### J12 (analysis). Why is `build_heap` O(n) and not O(n log n)?
Sift-down on a node at height `h` costs O(h), not O(log n). In a complete binary tree, roughly half the nodes are leaves (height 0), a quarter have height 1, an eighth have height 2, and so on. Summing `n/2^(h+1) * h` over all heights gives a series bounded by `n * sum(h / 2^h)` which converges to a constant, so the total cost is O(n). Repeated `push` is O(n log n) because each insertion can travel the full height; build-heap is cheaper because most nodes are near the bottom and barely move.

---

## Middle Questions (12 Q&A)

### M1. Walk through `sift_down` carefully.
Given index `i`, compute `l = 2i + 1` and `r = 2i + 2`. Choose `smallest = i`. If `l < n` and `A[l] < A[smallest]`, update `smallest = l`. If `r < n` and `A[r] < A[smallest]`, update `smallest = r`. If `smallest != i`, swap `A[i]` and `A[smallest]` and recurse (or loop) into `smallest`. The loop terminates when no swap occurs or you fall off the array. Always compare against the smaller child so the new parent satisfies the heap property against both children.

### M2. Why does `pop` move the last element to the root before sifting?
The root must be removed, but we must keep the array contiguous and the tree complete. Removing the root and shifting everything would be O(n). Instead, we swap the root with the last element, decrement `size`, and restore order by sifting the new root down. Only one path of length log n is affected, giving O(log n).

### M3. How would you implement a max-heap given a min-heap library like `heapq`?
Three common tricks: negate the keys (works for numeric types), wrap each element in a reverse-ordering type or comparator, or push tuples like `(-priority, value)`. Negation is simplest but loses information on the original sign and is fragile for floats and overflow. A custom comparator is cleaner and recommended for object types. In Java you can construct `new PriorityQueue<>(Comparator.reverseOrder())`.

### M4. How do you find the kth largest element in an array using a heap?
Maintain a min-heap of size k. Iterate over the array: push each element; if the heap size exceeds k, pop the smallest. After the scan, the root of the heap is the kth largest. This is O(n log k) time and O(k) space, which beats sorting (O(n log n)) when k is small. A symmetric approach with a max-heap of size n - k + 1 also works but is rarely preferable.

### M5. How would you merge k sorted streams using a heap?
Push the head of each stream into a min-heap keyed by value. Pop the smallest, emit it, and push the next element from the same stream. Repeat until all streams are exhausted. Total work is O(N log k) where N is the total number of elements and k is the number of streams. This is the heart of external sorting and of `merge k sorted lists` interview problems.

### M6. How does a priority queue support `decrease-key`?
You need to locate the element's current index and run sift-up from there. Locating it is the hard part: a vanilla heap has no map, so a linear scan is O(n). To make `decrease-key` O(log n), maintain a hash map from element identity to index, and update both the map and the array on every swap inside sift-up and sift-down. This is the standard "indexed priority queue" used in efficient Dijkstra and Prim implementations.

### M7. What happens if comparisons are expensive (for example, comparing large records)?
Heap operations make many comparisons per insertion or extraction (up to 2 log n for sift-down). If the comparator is slow, performance suffers. Mitigations include caching computed keys alongside the value (pair-style: `(priority, value)`), pre-hashing, or using d-ary heaps to trade fewer levels for more comparisons per level. Profiling will reveal which dominates in practice.

### M8. How is heap-sort implemented in-place?
Build a max-heap in the input array using Floyd's algorithm. Then for `i` from `n - 1` down to `1`, swap `A[0]` with `A[i]` (the largest element goes to its final position), decrement the logical heap size, and sift-down on index 0 over the reduced range `[0, i)`. After the loop, the array is sorted ascending. No extra memory is needed beyond a few variables.

### M9. When would a heap perform worse than a sorted array?
If you need fast access to elements other than the top (for example, the median, the second largest, or arbitrary rank queries), a heap is poor. A sorted array gives O(1) access to any rank but O(n) insertion. Order statistics trees, balanced BSTs, or skip lists are better when you need both insertion and arbitrary rank queries. Heaps win when you only ever pop the extreme.

### M10. What is a d-ary heap and when is it useful?
A d-ary heap is a generalization where each internal node has `d` children instead of 2. The tree is shallower (`log_d n` levels) so sift-up is faster, but sift-down becomes more expensive because each level requires comparing against `d` children. Tuned d-ary heaps (often d = 4) speed up Dijkstra on dense graphs where decrease-key dominates. They also fit cache lines better because more children are contiguous.

### M11. How do you delete an arbitrary element from a heap?
Look up its index (via an index map), replace it with the last element, shrink the heap, then sift-up if the new value is smaller than its parent, otherwise sift-down. Both branches are needed because the replacement could be either smaller or larger than what was there. Without an index map, finding the element is O(n) and dominates the cost.

### M12 (analysis). Why is the amortized cost of `n` pushes followed by `n` pops the same as `build_heap` + `n` pops?
`build_heap` runs in O(n), then `n` pops cost O(n log n), for a total of O(n log n). Doing `n` pushes one by one also costs O(n log n) in the worst case (the height grows logarithmically). So both schedules are O(n log n) overall, but `build_heap` wins by a constant factor on the construction phase. The reason `n` individual pushes cannot be amortized down is that the tree height grows monotonically, so later pushes really do cost log n in the worst case.

---

## Senior Questions (10 Q&A)

### S1. Compare binary, binomial, and Fibonacci heaps.
A binary heap supports O(log n) insert, extract-min, and decrease-key with excellent constants and an array layout. A binomial heap supports O(log n) for the same operations but adds O(log n) `union` (meld), which a binary heap cannot do better than O(n + m). A Fibonacci heap has O(1) amortized insert and decrease-key, with O(log n) amortized extract-min, which is theoretically optimal for Dijkstra and Prim. In practice, Fibonacci heaps lose to binary heaps because the constants and pointer overhead dominate for typical inputs.

### S2. How would you design a priority queue that supports `merge` efficiently?
Use a binomial heap, a leftist tree, a skew heap, or a pairing heap. All four support `merge` in O(log n) amortized or worst case. Pairing heaps are simplest to implement and have excellent practical performance. Binary heaps cannot merge faster than O(n + m) without losing the array layout, which is why frameworks that need fast meld (such as graph algorithms over disjoint subgraphs) pick a different structure.

### S3. How do you implement Dijkstra's algorithm with an indexed priority queue?
Maintain a heap of `(distance, vertex)` pairs and a map from vertex to its index in the heap. When you relax an edge `(u, v)` and find a shorter path to `v`, call `decrease-key` on `v`. Without the index map, you push duplicate entries and rely on a "stale entry" check at pop time; this is simpler but uses O(E) space and O(E log E) time. The indexed version is O((V + E) log V) and is preferred for dense graphs.

### S4. How would you implement a streaming median?
Keep two heaps: a max-heap of the lower half and a min-heap of the upper half. On each insertion, push to one heap, then move the top of one heap to the other if sizes differ by more than one. The median is either the top of the larger heap or the average of the two tops when the heaps are equal in size. Both operations are O(log n) and the median query is O(1). This is the canonical "data stream median" problem.

### S5. How would you implement a priority queue that supports `get-min` AND `get-max` in O(1)?
Use a min-max heap, also known as a double-ended priority queue. It is a single array where levels alternate between min-levels and max-levels. The minimum is the root and the maximum is the larger of the root's children. Insertion and extraction are still O(log n) but require slightly more comparisons. Alternatives include interval heaps (two parallel heaps with order constraints) or two synchronized heaps with cross-pointers.

### S6. How do you parallelize heap operations?
Naive locking around the whole heap serializes everything and kills throughput. Better approaches: lock-free skip-list-based priority queues (using CAS), bucketed priority queues partitioned by priority range, sharded heaps with periodic merges, or relaxed priority queues that occasionally return non-minimum elements. For tight real-time systems, an offline scheduling table can be precomputed. In practice, when concurrent priority queues are needed, frameworks reach for sharded or skip-list designs rather than a literal locked heap.

### S7. How would you serialize and persist a heap?
Because the heap is a contiguous array, you can dump the array directly to disk and load it back into memory without rebuilding. This is one of the underappreciated advantages of the array representation. If the elements are not POD, write a binary or JSON layout per element and rebuild the array on load. No rehashing or rebalancing is required because the array order already encodes the heap structure.

### S8. How do you measure and improve cache performance of a heap?
Cache misses come mostly from sift-down on a tall tree, where the path crosses many cache lines. To improve locality, switch to a d-ary heap with d tuned to one cache line (often d = 4 or 8 for typical x86), pack hot keys together, or store the priority next to the value in a struct-of-arrays layout. Empirical benchmarks on your workload matter more than theoretical complexity: a 4-ary heap can be 20–30% faster than a binary heap for large n.

### S9. What does it mean to say a heap is "stable" and how would you make it so?
A stable priority queue preserves insertion order among elements with equal priority. A vanilla binary heap is not stable because sift operations may swap equal elements. To make it stable, augment each element with a monotonically increasing counter and compare on `(priority, counter)`. The counter breaks ties deterministically in FIFO order. This is essential when scheduling tasks with identical priorities, where fairness matters.

### S10 (analysis). When is heap-sort preferred over quicksort and merge sort?
Heap-sort guarantees O(n log n) worst case and is in-place (O(1) extra memory). Quicksort is faster in practice but has O(n²) worst case unless randomized or median-of-three is used. Merge sort is O(n log n) worst case and stable but needs O(n) extra memory. Heap-sort is therefore preferred when you need worst-case guarantees on memory-constrained systems (embedded, kernel, real-time). Quicksort wins on raw throughput; merge sort wins when stability is mandatory.

---

## Professional Questions (8 Q&A)

### P1. How would you design a distributed priority queue serving millions of tasks per second?
Partition the workload by hash of task ID, with each partition holding a local heap. Producers publish to partitions; consumers pull. Cross-partition global ordering is usually relaxed in exchange for throughput: each consumer pulls the local minimum, and the global "next" is approximated. For strict ordering, use a small coordinator that periodically samples the head of each partition and assigns dispatch order. Persist with WAL plus periodic snapshots of the array.

### P2. How do you tune a binary heap for a real-time system with hard deadlines?
Real-time systems demand bounded worst-case latency, not just amortized. Binary heaps already give O(log n) worst case for push and pop, which is bounded. The challenge is allocation: avoid resizing by pre-allocating maximum capacity, use pool allocators for entries, and pin memory if needed. Avoid Fibonacci heaps because their O(1) amortized insert can take O(n) in the worst case. Verify deterministic latency with WCET analysis tools.

### P3. How would you implement a delay queue (tasks scheduled for a future time)?
Use a min-heap keyed by `scheduled_at`. A single consumer thread peeks at the top, sleeps until its scheduled time (or until a signal arrives if a new task with an earlier time was inserted), then pops and dispatches. Use a condition variable so the sleeper can be woken by inserts. Production systems (Java's `DelayQueue`, Redis' sorted sets, RabbitMQ delayed exchanges) follow this pattern.

### P4. How do you implement a top-K query over a sliding window in a stream?
Maintain a min-heap of size K plus an auxiliary map from value to its count in the current window. On insertion of a new element, increment its count and push it into the heap if it qualifies. On window slide, decrement the count of the departing element. When popping the heap top, verify the count is still positive; otherwise discard ("lazy deletion") and pop again. This keeps the heap roughly bounded while avoiding the cost of arbitrary deletion.

### P5. How do you handle priority inversion in a heap-based scheduler?
Priority inversion occurs when a low-priority task holds a resource needed by a high-priority task, blocking it indirectly. Standard mitigations are priority inheritance (the blocker temporarily inherits the waiter's priority) and priority ceiling (resources are tagged with a ceiling priority). These are scheduler-level concerns, not heap-level, but the heap must support `decrease-key` to bump a task's priority dynamically. This is why indexed heaps matter in real-time scheduling.

### P6. How would you design a heap that supports persistence (immutable updates)?
Use a persistent functional heap such as a leftist heap, skew heap, or pairing heap implemented with persistent trees. Each update returns a new heap sharing structure with the old one. Operations remain O(log n) but with higher constants. Binary heaps in array form do not naturally support persistence; you would need a persistent array (often a balanced tree under the hood), which defeats the locality advantage. For functional-language interviews, leftist heap is the canonical answer.

### P7. How would you debug a "heap property violated" production incident?
First, add an invariant check that walks the array and verifies `A[parent(i)] <= A[i]` for every `i`. Log the offending index, value, and the path to the root. Then look for: a comparator that is not transitive (the most common bug), mutation of stored objects after insertion (changing their priority externally), or concurrent access without synchronization. Reproduce with a deterministic test using the captured sequence of operations. Add invariant checks behind a feature flag for ongoing observability.

### P8 (analysis). Why does Fibonacci heap's theoretical edge rarely show up in practice?
Fibonacci heaps achieve O(1) amortized insert and decrease-key by deferring work into a complex node structure with marks and consolidation. The constants are large: each node has multiple pointers (parent, child, prev sibling, next sibling, mark bit), and operations chase pointers across non-contiguous memory, causing cache misses. For typical problem sizes (a few million elements), a binary or 4-ary heap finishes faster despite worse asymptotic bounds. Empirical studies (Cherkassky, Goldberg, Radzik 1996) confirm this for Dijkstra on real graphs.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose a heap over another data structure. What were the trade-offs?
Look for a structured story: the problem (for example, top-K events per minute), the alternatives considered (sorting the whole stream, balanced BST, sketch algorithms), the criteria (memory, latency, accuracy), and why a bounded min-heap of size K won. Mention what you measured and what surprised you. Strong answers cite numbers and show that you understood the trade-offs, not that you defaulted to the structure you knew.

### B2. Design a notification scheduler that delivers reminders at a precise time.
Heap-based delay queue is the standard answer. Discuss persistence (so notifications survive restarts), failover (so the heap is not a single point of failure), and time-zone handling (store UTC, render in user's zone). Discuss what happens when the system is overloaded: do you drop, delay, or batch? How do you handle clock skew between nodes? Strong candidates draw the architecture and call out trade-offs.

### B3. Design a leaderboard with top-K leaders.
A heap of size K maintains the top-K efficiently, but the leaderboard usually also needs the full ranking and updates by player ID. Real systems use a sorted set (Redis ZSET, which is a skip list internally) rather than a heap, because ZSET supports both `O(log n)` rank queries and `O(log n)` updates by key. Explain why a heap is insufficient here and why ZSET is the production choice. Then describe sharding, caching, and consistency.

### B4. A junior engineer asks: "Why not always use a heap as my default data structure?" How do you respond?
Heaps are excellent for one specific access pattern: repeatedly removing the extreme element. They are mediocre or bad for almost everything else: random access by key, range queries, ordered iteration, lookup of arbitrary elements. Recommend choosing the data structure by access pattern, not by which one is trendy. Use this as a teaching moment about premature optimization and about reading the access pattern carefully before picking.

### B5. Your team's heap-based scheduler has a memory leak. How do you investigate?
Start by checking that elements are actually removed and not just marked stale. Lazy deletion is a common source of unbounded heap growth: stale entries pile up. Add metrics for heap size, push rate, pop rate, and stale-entry rate. Compare push minus pop to actual size to detect leaks. Walk the code paths where elements are inserted but never popped (cancellation, timeout, error paths). Heap dumps in JVM languages or runtime profiles in Go usually point at the leak quickly.

---

## Coding Challenges

### Challenge 1: Kth Largest Element in a Stream

**Problem.** Design a class `KthLargest` that finds the kth largest element in a stream of numbers. The class has a constructor that takes an integer `k` and an initial array `nums`, and a method `add(val)` that inserts `val` into the stream and returns the kth largest element seen so far. Note: "kth largest" means the kth largest in sorted order, not the kth distinct value.

**Example.**

```text
KthLargest(3, [4, 5, 8, 2])
add(3) -> 4    // stream: [2, 3, 4, 5, 8], 3rd largest is 4
add(5) -> 5    // stream: [2, 3, 4, 5, 5, 8], 3rd largest is 5
add(10) -> 5   // stream: [2, 3, 4, 5, 5, 8, 10], 3rd largest is 5
add(9) -> 8    // stream: [2, 3, 4, 5, 5, 8, 9, 10], 3rd largest is 8
add(4) -> 8
```

**Constraints.** `1 <= k <= 10^4`, `0 <= len(nums) <= 10^4`, values fit in 32-bit signed integers, at most `10^4` calls to `add`.

**Brute force.** On each `add`, sort the buffer and read the kth largest. Each call is O(n log n), and across `m` calls the total cost is O(m * n log n). Memory is O(n).

**Optimal.** Keep a min-heap of size exactly `k`. The root is the kth largest element seen so far. On each `add`, push the new value; if the heap exceeds size `k`, pop the smallest. Each call is O(log k); total is O(m log k) with O(k) memory.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type IntMinHeap []int

func (h IntMinHeap) Len() int            { return len(h) }
func (h IntMinHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h IntMinHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntMinHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *IntMinHeap) Pop() interface{} {
	old := *h
	n := len(old)
	v := old[n-1]
	*h = old[:n-1]
	return v
}

type KthLargest struct {
	k    int
	heap *IntMinHeap
}

func Constructor(k int, nums []int) KthLargest {
	h := &IntMinHeap{}
	heap.Init(h)
	kl := KthLargest{k: k, heap: h}
	for _, n := range nums {
		kl.Add(n)
	}
	return kl
}

func (kl *KthLargest) Add(val int) int {
	heap.Push(kl.heap, val)
	if kl.heap.Len() > kl.k {
		heap.Pop(kl.heap)
	}
	return (*kl.heap)[0]
}

func main() {
	kl := Constructor(3, []int{4, 5, 8, 2})
	for _, v := range []int{3, 5, 10, 9, 4} {
		fmt.Println(kl.Add(v))
	}
}
```

**Java.**

```java
import java.util.PriorityQueue;

class KthLargest {
    private final PriorityQueue<Integer> heap;
    private final int k;

    public KthLargest(int k, int[] nums) {
        this.k = k;
        this.heap = new PriorityQueue<>(k);
        for (int n : nums) add(n);
    }

    public int add(int val) {
        heap.offer(val);
        if (heap.size() > k) heap.poll();
        return heap.peek();
    }

    public static void main(String[] args) {
        KthLargest kl = new KthLargest(3, new int[]{4, 5, 8, 2});
        for (int v : new int[]{3, 5, 10, 9, 4}) {
            System.out.println(kl.add(v));
        }
    }
}
```

**Python.**

```python
import heapq


class KthLargest:
    def __init__(self, k: int, nums: list[int]):
        self.k = k
        self.heap: list[int] = []
        for n in nums:
            self.add(n)

    def add(self, val: int) -> int:
        heapq.heappush(self.heap, val)
        if len(self.heap) > self.k:
            heapq.heappop(self.heap)
        return self.heap[0]


if __name__ == "__main__":
    kl = KthLargest(3, [4, 5, 8, 2])
    for v in [3, 5, 10, 9, 4]:
        print(kl.add(v))
```

**Follow-up.** What if elements can also be removed from the stream (deletion by value)? You can no longer rely on a fixed-size heap because the kth largest may shift downward arbitrarily. One approach is to maintain two multisets (treap, balanced BST, or `SortedList`) split at the kth boundary and rebalance after each operation. Another is a heap with a deletion map and lazy popping at the top. Be ready to discuss the trade-offs.

---

### Challenge 2: Merge k Sorted Linked Lists

**Problem.** You are given an array of `k` linked lists, each sorted in ascending order. Merge them into one sorted linked list and return its head.

**Example.**

```text
Input:
  [1 -> 4 -> 5,
   1 -> 3 -> 4,
   2 -> 6]

Output: 1 -> 1 -> 2 -> 3 -> 4 -> 4 -> 5 -> 6
```

**Constraints.** `k <= 10^4`, total nodes `<= 10^4`, values fit in 32-bit signed integers, each list is sorted ascending.

**Brute force.** Collect all values into one array, sort it, build a new list. Time O(N log N), space O(N), where `N` is the total number of nodes. This works but ignores the existing per-list sortedness.

**Optimal.** Min-heap of size at most `k`, keyed by node value. Push the head of each list. Pop the smallest, attach it to the output, and push its `next` (if any). Repeat until the heap is empty. Time O(N log k), space O(k). This is strictly better when k is small relative to N.

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type ListNode struct {
	Val  int
	Next *ListNode
}

type NodeHeap []*ListNode

func (h NodeHeap) Len() int            { return len(h) }
func (h NodeHeap) Less(i, j int) bool  { return h[i].Val < h[j].Val }
func (h NodeHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *NodeHeap) Push(x interface{}) { *h = append(*h, x.(*ListNode)) }
func (h *NodeHeap) Pop() interface{} {
	old := *h
	n := len(old)
	v := old[n-1]
	*h = old[:n-1]
	return v
}

func mergeKLists(lists []*ListNode) *ListNode {
	h := &NodeHeap{}
	heap.Init(h)
	for _, head := range lists {
		if head != nil {
			heap.Push(h, head)
		}
	}
	dummy := &ListNode{}
	tail := dummy
	for h.Len() > 0 {
		node := heap.Pop(h).(*ListNode)
		tail.Next = node
		tail = node
		if node.Next != nil {
			heap.Push(h, node.Next)
		}
	}
	return dummy.Next
}

func build(vals []int) *ListNode {
	dummy := &ListNode{}
	tail := dummy
	for _, v := range vals {
		tail.Next = &ListNode{Val: v}
		tail = tail.Next
	}
	return dummy.Next
}

func main() {
	lists := []*ListNode{
		build([]int{1, 4, 5}),
		build([]int{1, 3, 4}),
		build([]int{2, 6}),
	}
	cur := mergeKLists(lists)
	for cur != nil {
		fmt.Printf("%d ", cur.Val)
		cur = cur.Next
	}
	fmt.Println()
}
```

**Java.**

```java
import java.util.PriorityQueue;

public class MergeKLists {
    public static class ListNode {
        int val;
        ListNode next;
        ListNode(int v) { val = v; }
    }

    public ListNode mergeKLists(ListNode[] lists) {
        PriorityQueue<ListNode> pq = new PriorityQueue<>((a, b) -> a.val - b.val);
        for (ListNode head : lists) {
            if (head != null) pq.offer(head);
        }
        ListNode dummy = new ListNode(0);
        ListNode tail = dummy;
        while (!pq.isEmpty()) {
            ListNode node = pq.poll();
            tail.next = node;
            tail = node;
            if (node.next != null) pq.offer(node.next);
        }
        return dummy.next;
    }

    private static ListNode build(int[] vals) {
        ListNode dummy = new ListNode(0);
        ListNode tail = dummy;
        for (int v : vals) {
            tail.next = new ListNode(v);
            tail = tail.next;
        }
        return dummy.next;
    }

    public static void main(String[] args) {
        ListNode[] lists = {
            build(new int[]{1, 4, 5}),
            build(new int[]{1, 3, 4}),
            build(new int[]{2, 6})
        };
        ListNode head = new MergeKLists().mergeKLists(lists);
        while (head != null) {
            System.out.print(head.val + " ");
            head = head.next;
        }
        System.out.println();
    }
}
```

**Python.**

```python
import heapq
from dataclasses import dataclass
from typing import Optional


@dataclass
class ListNode:
    val: int
    next: Optional["ListNode"] = None


def merge_k_lists(lists: list[Optional[ListNode]]) -> Optional[ListNode]:
    heap: list[tuple[int, int, ListNode]] = []
    counter = 0
    for head in lists:
        if head is not None:
            heapq.heappush(heap, (head.val, counter, head))
            counter += 1
    dummy = ListNode(0)
    tail = dummy
    while heap:
        _, _, node = heapq.heappop(heap)
        tail.next = node
        tail = node
        if node.next is not None:
            heapq.heappush(heap, (node.next.val, counter, node.next))
            counter += 1
    return dummy.next


def build(vals: list[int]) -> Optional[ListNode]:
    dummy = ListNode(0)
    tail = dummy
    for v in vals:
        tail.next = ListNode(v)
        tail = tail.next
    return dummy.next


if __name__ == "__main__":
    lists = [build([1, 4, 5]), build([1, 3, 4]), build([2, 6])]
    head = merge_k_lists(lists)
    while head is not None:
        print(head.val, end=" ")
        head = head.next
    print()
```

Notice that Python needs the counter as a tiebreaker because `ListNode` instances are not directly comparable; the counter ensures total order even when two values are equal.

**Follow-up.** What if k is huge (millions of streams) and individual lists are short? The heap dominates memory. Consider a tournament tree (loser tree), pairwise merging in log k rounds, or external sort with sequential merge passes. For truly massive k, divide and conquer with O(log k) rounds of pairwise merging uses O(1) extra memory beyond the lists themselves.

---

### Challenge 3: Find the Median from a Data Stream

**Problem.** Design a class `MedianFinder` that supports two methods: `addNum(num)` to add an integer to the stream and `findMedian()` to return the median of all elements so far. If the stream has an even number of elements, return the average of the two middle elements.

**Example.**

```text
addNum(1)
addNum(2)
findMedian() -> 1.5
addNum(3)
findMedian() -> 2.0
```

**Constraints.** `-10^5 <= num <= 10^5`, up to `5 * 10^4` calls, expected O(log n) per `addNum` and O(1) per `findMedian`.

**Brute force.** Keep a sorted list; `addNum` does binary search insert (O(n) for the shift), `findMedian` is O(1). Across `n` operations the total cost is O(n²).

**Optimal.** Two heaps: a max-heap `low` holding the smaller half and a min-heap `high` holding the larger half. Maintain `|low| - |high| ∈ {0, 1}`. On `addNum`:

1. If `low` is empty or `num <= low.top()`, push into `low`; else push into `high`.
2. Rebalance: if `len(low) > len(high) + 1`, move the top of `low` into `high`. If `len(high) > len(low)`, move the top of `high` into `low`.

On `findMedian`: if `len(low) > len(high)`, return `low.top()`; otherwise return the average of `low.top()` and `high.top()`. Both operations are O(log n); query is O(1).

**Go.**

```go
package main

import (
	"container/heap"
	"fmt"
)

type MinHeap []int

func (h MinHeap) Len() int            { return len(h) }
func (h MinHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h MinHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *MinHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *MinHeap) Pop() interface{} {
	old := *h
	n := len(old)
	v := old[n-1]
	*h = old[:n-1]
	return v
}

type MaxHeap []int

func (h MaxHeap) Len() int            { return len(h) }
func (h MaxHeap) Less(i, j int) bool  { return h[i] > h[j] }
func (h MaxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *MaxHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *MaxHeap) Pop() interface{} {
	old := *h
	n := len(old)
	v := old[n-1]
	*h = old[:n-1]
	return v
}

type MedianFinder struct {
	low  *MaxHeap
	high *MinHeap
}

func ConstructorMF() MedianFinder {
	return MedianFinder{low: &MaxHeap{}, high: &MinHeap{}}
}

func (m *MedianFinder) AddNum(num int) {
	if m.low.Len() == 0 || num <= (*m.low)[0] {
		heap.Push(m.low, num)
	} else {
		heap.Push(m.high, num)
	}
	if m.low.Len() > m.high.Len()+1 {
		heap.Push(m.high, heap.Pop(m.low))
	} else if m.high.Len() > m.low.Len() {
		heap.Push(m.low, heap.Pop(m.high))
	}
}

func (m *MedianFinder) FindMedian() float64 {
	if m.low.Len() > m.high.Len() {
		return float64((*m.low)[0])
	}
	return (float64((*m.low)[0]) + float64((*m.high)[0])) / 2.0
}

func main() {
	mf := ConstructorMF()
	mf.AddNum(1)
	mf.AddNum(2)
	fmt.Println(mf.FindMedian())
	mf.AddNum(3)
	fmt.Println(mf.FindMedian())
}
```

**Java.**

```java
import java.util.Collections;
import java.util.PriorityQueue;

class MedianFinder {
    private final PriorityQueue<Integer> low;
    private final PriorityQueue<Integer> high;

    public MedianFinder() {
        low = new PriorityQueue<>(Collections.reverseOrder());
        high = new PriorityQueue<>();
    }

    public void addNum(int num) {
        if (low.isEmpty() || num <= low.peek()) {
            low.offer(num);
        } else {
            high.offer(num);
        }
        if (low.size() > high.size() + 1) {
            high.offer(low.poll());
        } else if (high.size() > low.size()) {
            low.offer(high.poll());
        }
    }

    public double findMedian() {
        if (low.size() > high.size()) {
            return low.peek();
        }
        return (low.peek() + high.peek()) / 2.0;
    }

    public static void main(String[] args) {
        MedianFinder mf = new MedianFinder();
        mf.addNum(1);
        mf.addNum(2);
        System.out.println(mf.findMedian());
        mf.addNum(3);
        System.out.println(mf.findMedian());
    }
}
```

**Python.**

```python
import heapq


class MedianFinder:
    def __init__(self):
        self.low: list[int] = []   # max-heap via negation
        self.high: list[int] = []  # min-heap

    def add_num(self, num: int) -> None:
        if not self.low or num <= -self.low[0]:
            heapq.heappush(self.low, -num)
        else:
            heapq.heappush(self.high, num)
        if len(self.low) > len(self.high) + 1:
            heapq.heappush(self.high, -heapq.heappop(self.low))
        elif len(self.high) > len(self.low):
            heapq.heappush(self.low, -heapq.heappop(self.high))

    def find_median(self) -> float:
        if len(self.low) > len(self.high):
            return float(-self.low[0])
        return (-self.low[0] + self.high[0]) / 2.0


if __name__ == "__main__":
    mf = MedianFinder()
    mf.add_num(1)
    mf.add_num(2)
    print(mf.find_median())
    mf.add_num(3)
    print(mf.find_median())
```

**Follow-up.** What if 99% of values fall into a known small range, say `[0, 100]`? Use a bucket array of size 101 plus two counters for "below" and "above" the range. Each `addNum` is O(1) and `findMedian` is O(range) which is O(1) for fixed range. This beats the two-heap approach for skewed distributions. Discuss the trade-off: bucket loses precision if the range assumption breaks.

---

## Common Pitfalls in Interviews

- **Confusing min-heap and max-heap.** Always restate which one you need before writing code. Mistakes here lead to silent bugs because the structure still "works," just for the wrong extreme.
- **Off-by-one in index formulas.** Decide upfront whether you are using 0-indexed or 1-indexed. Mixing them inside one function is the single most common source of bugs.
- **Forgetting to rebalance.** In the median-finder pattern, missing the rebalance step means the median query is wrong after a streak of insertions on one side.
- **Comparator that is not transitive.** A comparator like `a.priority - b.priority` overflows for large integers; use explicit comparisons. Non-transitive comparators corrupt the heap silently and only fail under specific input patterns.
- **Mutating elements after insertion.** If you change the priority of an object that is already in the heap, the heap invariant breaks. Either remove and reinsert, or use an indexed heap with `decrease-key`.
- **Stale lazy-deleted entries piling up.** When using lazy deletion, you must drain stale entries at the top before reading the answer, and you should occasionally rebuild the heap if the stale ratio grows too large.
- **Building a heap by repeated push when you have the whole array.** This is O(n log n); Floyd's build-heap is O(n). The interviewer is checking whether you know this.
- **Searching the heap for an arbitrary element.** Heaps do not support O(log n) arbitrary search. If you need it, mention an index map or a different data structure rather than scanning.
- **Forgetting Python `heapq` is min-only.** Negate values, wrap in a custom comparable, or use tuples. Don't pretend `heapq` has a `max` mode.
- **Returning the wrong heap top after pop in Go.** `container/heap` requires you to call `heap.Pop(h)` (not `h.Pop()`); the package-level function does the sift-down. Calling the receiver method directly skips the heap invariant maintenance.

---

## What Interviewers Are Really Testing

When an interviewer asks a heap question, they are rarely checking whether you can recite the API. They are checking three deeper things. First, can you choose the right data structure for an access pattern you have not seen before? Heap is a strong default for "repeatedly remove extreme," but only for that. The ability to recognize this pattern in a disguised problem statement is what separates strong candidates. Second, can you reason about complexity carefully? Build-heap O(n) versus repeated-push O(n log n) is a classic litmus test. Top-K with a bounded heap (O(n log k) instead of O(n log n)) is another. These distinctions matter at scale. Third, can you handle the corners? Stability, concurrent access, decrease-key, lazy deletion, persistence, cache locality — these are the topics that distinguish a senior from a mid-level candidate. You do not need to solve every one on the spot, but you should know they exist, name the right tool (indexed heap, Fibonacci heap, persistent leftist tree, sorted set), and explain the trade-off. The best answers also reflect on production realities: how would I monitor this in a live system, how would I detect a bug, how would I fail over gracefully. A heap question is a small enough scope that you can demonstrate all of these dimensions in a single conversation.
