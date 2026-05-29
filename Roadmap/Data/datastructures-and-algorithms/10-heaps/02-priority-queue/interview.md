# Priority Queue — Interview Preparation

A priority queue (PQ) is an *abstract data type* — not a single implementation. It promises one thing: every `pop` returns the element with the highest priority currently in the collection. The interviewer cares less about whether you know what a PQ *is* and more about whether you can recognize when a problem secretly needs one, and whether you can reason about the trade-offs between the underlying implementations (binary heap, balanced BST, indexed heap, Fibonacci heap, bucket queue).

This document walks through the questions you should expect at four seniority levels, three full coding problems with Go/Java/Python solutions, and the meta-skills interviewers are actually probing.

---

## Quick-Reference Cheat Sheet

### Operation costs by implementation

| Implementation        | push     | pop-min  | peek-min | decrease-key | merge      | remove-arbitrary |
| --------------------- | -------- | -------- | -------- | ------------ | ---------- | ---------------- |
| Unsorted array        | O(1)     | O(n)     | O(n)     | O(1)         | O(1)       | O(n)             |
| Sorted array          | O(n)     | O(1)     | O(1)     | O(n)         | O(n+m)     | O(n)             |
| Binary heap           | O(log n) | O(log n) | O(1)     | O(log n)\*   | O(n+m)     | O(log n)\*       |
| Balanced BST          | O(log n) | O(log n) | O(log n) | O(log n)     | O(n log n) | O(log n)         |
| Binomial heap         | O(log n) | O(log n) | O(log n) | O(log n)     | O(log n)   | O(log n)         |
| Fibonacci heap (amort)| O(1)     | O(log n) | O(1)     | O(1)         | O(1)       | O(log n)         |
| Bucket queue          | O(1)     | O(C)     | O(C)     | O(1)         | O(C)       | O(1)             |
| Pairing heap (amort)  | O(1)     | O(log n) | O(1)     | o(log n)     | O(1)       | O(log n)         |

\*Decrease-key and arbitrary remove on a binary heap require an index map (handle table) — without it both become O(n).

### When to use which

| Situation                                                                | Pick                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| Just need top-k, single-shot                                             | Binary heap (size k)                                |
| Need top-k from a stream                                                 | Binary heap, evict on size > k                      |
| Dijkstra / Prim with dense graph (m close to n^2)                        | Array-based PQ (O(n^2) overall is better)           |
| Dijkstra / Prim with sparse graph                                        | Binary heap or indexed heap                         |
| Heavy decrease-key (e.g., dense graph)                                   | Fibonacci or pairing heap                           |
| Priorities are small bounded integers                                    | Bucket queue / radix heap                           |
| Need ordered iteration *and* PQ semantics                                | Balanced BST (TreeMap / sortedcontainers)           |
| Need fast `merge` (mergeable PQ)                                         | Binomial, Fibonacci, leftist, or pairing heap       |
| Need to *remove arbitrary* element by id                                 | Indexed heap or balanced BST                        |
| Need both min and max access                                             | Two heaps, double-ended heap, or balanced BST       |
| Concurrent multi-producer / multi-consumer                               | Concurrent skip list / lock-free PQ                 |

### Heuristics for spotting a PQ problem

- "Smallest / largest at each step" repeated > 1 time → PQ.
- "K-th largest / K closest / K most frequent" → bounded-size heap.
- "Merge K sorted X" → heap over the head of each list.
- "Schedule jobs by priority / deadline" → PQ keyed on priority/deadline.
- "Shortest path / cheapest cost" on a weighted graph → PQ-backed Dijkstra.
- "Median of a stream" → two heaps (max-heap left, min-heap right).
- "Reorganize / rearrange so no two adjacent X are the same" → max-heap on frequency.

---

## Junior Questions (12 Q&A)

**J1. What is a priority queue?**
A priority queue is an abstract data type that maintains a collection of elements, each with an associated priority, and supports at least two operations: insert an element with a priority, and extract (or peek at) the element with the highest priority. Unlike a FIFO queue, the order of removal is determined by priority, not arrival time. It is an *interface*, not an implementation — the same ADT can be backed by an unsorted array, a sorted list, a heap, or a balanced BST. The two most common variants are min-PQ (smallest priority wins) and max-PQ (largest wins). It is the workhorse of greedy algorithms, shortest-path algorithms, event-driven simulations, and scheduling.

**J2. How is a priority queue different from a regular queue?**
A regular queue is FIFO: the first element pushed is the first one popped, regardless of any payload. A priority queue removes based on a *key*, not insertion order. Two elements pushed in order A then B will pop as B then A if B has higher priority. As a consequence, the underlying data structure cannot be a simple linked list of insertions; it must maintain some form of ordering invariant (heap, tree, sorted list). FIFO behavior is a special case of a PQ where priority equals insertion time and ties go to the earlier element.

**J3. What is the difference between a min-heap and a max-heap?**
In a min-heap, the parent is always less than or equal to its children, so the root is the smallest element and `peek` returns the minimum. In a max-heap the opposite holds: the root is the largest. You convert one to the other either by inverting the comparator or by negating numeric keys. Both are *complete binary trees* stored in arrays so that for index `i`, the children are at `2i+1` and `2i+2`. Almost all standard-library PQs (Java `PriorityQueue`, Go `container/heap`, Python `heapq`) are min-heaps by default.

**J4. What's the time complexity of push and pop on a binary heap?**
Both are O(log n). Push appends at the end of the array (O(1)) then *sifts up* by swapping with the parent until the heap property holds — at most height-of-tree swaps, which is floor(log2 n). Pop swaps the root with the last element, decrements size, then *sifts down* — again at most log n swaps. Peek is O(1) because the root is always at index 0. Building a heap from n unsorted elements is O(n), not O(n log n), via Floyd's bottom-up heapify.

**J5. Is `heapq` in Python a max-heap or a min-heap?**
`heapq` is a min-heap. To simulate a max-heap, negate the keys on insert and on extract (`heappush(h, -x)`, `-heappop(h)`), or wrap entries in a class that inverts `__lt__`. Python does not ship a built-in max-heap. For tuple priorities, tie-breaking falls through to the next tuple element, which is why a common idiom is `(priority, counter, item)` to make priorities total and stable.

**J6. What does Java's `PriorityQueue` give you?**
`java.util.PriorityQueue<E>` is an unbounded min-heap backed by an array. It accepts a `Comparator` in the constructor; without one, it uses natural ordering. `offer`/`add` and `poll`/`remove()` are O(log n); `peek` is O(1); `contains` and arbitrary `remove(Object)` are O(n) because there is no internal index map. It is not thread-safe — for concurrent code use `PriorityBlockingQueue`. Iteration order is *not* sorted; the only guarantee is that `poll` returns the head.

**J7. How do you implement a max-heap using Java's `PriorityQueue`?**
Pass a reversed comparator. For boxed integers: `new PriorityQueue<>(Comparator.reverseOrder())`. For custom objects: `new PriorityQueue<>((a, b) -> Integer.compare(b.priority, a.priority))`. Be careful with `Integer.MIN_VALUE` and subtraction-based comparators (`b - a`) — they overflow. Always use `Integer.compare` or `Long.compare` for safety.

**J8. What is heap property and why does it matter?**
The heap property is the invariant that every parent dominates its children — `parent <= child` in a min-heap, `parent >= child` in a max-heap. It guarantees that the extremum lives at the root, giving O(1) peek. It does *not* impose a total order on the array; siblings can be in any relative order. This weaker constraint is exactly why insert and remove are O(log n) instead of O(n) — we only need to restore the property along one root-to-leaf path.

**J9. How do you find the k-th largest element in an array using a priority queue?**
Maintain a min-heap of size k. Iterate the array: push each element; if heap size exceeds k, pop the smallest. After processing all elements, the heap contains the k largest, and its root is the k-th largest. Time is O(n log k), space O(k). This beats O(n log n) sorting when k is much smaller than n. Quickselect is O(n) average but harder to get right under interview pressure.

**J10. What is a stable priority queue?**
A PQ is *stable* if equal-priority elements are returned in FIFO order of insertion. Standard binary heaps are not stable — siblings with equal keys can sift in any order. To make a PQ stable, attach a monotonically increasing counter as a secondary key: `(priority, counter, item)`. The counter breaks ties consistently. Java's `PriorityQueue` is not stable; neither is Python's `heapq` unless you encode the tie-breaker yourself.

**J11. Can you have duplicate priorities in a priority queue?**
Yes. Priorities are not unique keys. Heaps, sorted arrays, and even balanced BST-backed PQs (e.g., a multiset) accept duplicates. The behavior on equal keys depends on stability — see J10. If you specifically need to *count* duplicates or check membership efficiently, pair the PQ with a hash map.

**J12. Why is `peek` O(1) but `pop` O(log n)?**
Peek just reads the root at index 0 of the array — no work to do. Pop removes the root, but to maintain a complete binary tree we move the last element into the root slot and then sift it down to restore the heap property. The sift-down walks at most one root-to-leaf path, whose length in a complete tree is floor(log2 n). So peek is O(1), pop pays the maintenance cost.

---

## Middle Questions (12 Q&A)

**M1. How is a binary heap stored in an array, and how do you compute parent/child indices?**
A binary heap is a complete binary tree, so it fits perfectly into a 0-indexed array with no gaps. For a node at index `i`: left child is `2i+1`, right child is `2i+2`, parent is `(i-1)/2`. With 1-indexed arrays the formulas are `2i`, `2i+1`, `i/2`, which avoid a subtraction and are slightly nicer for handwritten code. The array layout gives excellent cache locality — far better than pointer-linked tree implementations.

**M2. Walk me through `siftUp` and `siftDown`.**
*siftUp* (used on insert) starts at the newly inserted index and repeatedly compares with the parent; if the heap property is violated, swap and move up. Stops at the root or when the parent dominates. *siftDown* (used on extract and during heapify) starts at a node and compares with the *smaller* of its two children (for a min-heap); if the child is smaller, swap and recurse on that child. Stops at a leaf or when both children dominate. Both are O(log n) in the worst case.

**M3. Why is `buildHeap` O(n) and not O(n log n)?**
A naive build inserts n elements one at a time, costing O(n log n). Floyd's algorithm instead starts at the last non-leaf (index n/2 - 1) and sifts each node down. The cost is bounded by the sum of the heights of all nodes. Half of all nodes are leaves with height 0 and do no work; a quarter have height 1; an eighth have height 2; and so on. The series sum(h * n / 2^(h+1)) for h from 0 to log n converges to O(n). This is one of the most-asked complexity-analysis questions in interviews.

**M4. How would you implement `decreaseKey` on a binary heap?**
You need to locate the element first. With only the array you do an O(n) linear scan, then sift up from that index (since the key got smaller in a min-heap). To get the O(log n) decrease-key advertised in algorithm textbooks (e.g., for Dijkstra), you must maintain a parallel *handle table* — a hash map from element id to current heap index — and update it on every swap. This is called an *indexed heap*. Without one, decrease-key on a binary heap is effectively O(n).

**M5. How do you merge two binary heaps?**
The clean way: concatenate the two underlying arrays and run `buildHeap` on the result, costing O(n+m). There is no faster merge for plain binary heaps. If merge is a hot operation, switch to a *mergeable heap* — binomial (O(log n) merge), leftist (O(log n)), pairing or Fibonacci (O(1) amortized). The choice between them depends on whether decrease-key matters as well.

**M6. How does Dijkstra's algorithm use a priority queue?**
You maintain a PQ of `(distance-so-far, vertex)` pairs. Pop the vertex with the smallest tentative distance; for each outgoing edge, if the new distance is smaller than what's recorded, push the updated `(new-dist, neighbor)` into the heap. With an indexed heap that supports decrease-key, the total cost is O((V + E) log V). The common lazy variant skips decrease-key by allowing stale entries in the heap and discarding them at pop time; it is O((V + E) log E) but simpler to code — which is why this is what most interviewers expect.

**M7. Why do we use two heaps for the median-of-a-stream problem?**
Split numbers into a lower half (max-heap) and an upper half (min-heap), keeping sizes within 1 of each other. The median is then either the root of the larger heap (for odd count) or the average of the two roots (for even count). Insert: compare with the max-heap's root and push into the appropriate side, then rebalance by moving a root across if size differs by 2. Each insert is O(log n); median lookup is O(1). The two-heap trick is the canonical answer and shows up frequently.

**M8. How do you remove an arbitrary element from a binary heap?**
Find the index (linear scan or via an index map), swap with the last element, decrement size, and then *both* sift up and sift down from that index (only one will move). You can't know in advance whether the replacement is larger or smaller than the original. With an index map this is O(log n); without one, the linear scan dominates at O(n).

**M9. What's the complexity of `heapify` vs sorting?**
Heapify is O(n). Heapsort is `heapify` followed by n extract-max operations, each O(log n), for a total of O(n log n). Heapsort is in-place and worst-case O(n log n), but cache-unfriendly — its random access pattern across the array makes it slower than introsort in practice. PQ-driven sort (also called "selection via PQ") is *also* O(n log n) but with more memory traffic if you allocate a new PQ instead of reusing the input array.

**M10. What is a d-ary heap and when would you choose one?**
A d-ary heap is a generalization where each node has d children instead of 2. Height becomes log_d(n), so siftUp is O(log_d n) — faster than binary. But siftDown costs O(d * log_d n) because at each level you must scan all d children to find the smallest. For Dijkstra on dense graphs the d=4 heap is often empirically optimal because pushes (siftUp) dominate. Cache locality also improves since each node's children are consecutive in memory.

**M11. How would you implement a priority queue with `O(1)` `getMax` and `getMin` simultaneously?**
Options: (a) maintain two heaps with cross-references via an index map; (b) use an interval / double-ended heap (min-max heap) where alternating levels enforce min/max property — supports both in O(1) peek, O(log n) push and pop; (c) use a balanced BST / TreeMap where `first()` and `last()` are both O(log n) (some implementations cache pointers for O(1)). The interval-heap and TreeMap solutions are the most interview-friendly answers.

**M12. How do you handle priority updates in a Dijkstra implementation?**
Two strategies. *Eager* (indexed heap with decrease-key): when you find a shorter path to a vertex, update its key in place. Requires a hash map from vertex to heap index, kept in sync during every swap. *Lazy* (re-push): push a new entry with the better distance; mark visited vertices on pop and skip duplicates. Lazy uses more memory (heap grows to O(E)) but is far simpler to implement and is usually what interviewers expect unless they explicitly ask for decrease-key.

---

## Senior Questions (10 Q&A)

**S1. Compare binary heap, Fibonacci heap, and pairing heap as the underlying PQ for Dijkstra. When does each one actually win?**
A binary heap gives O((V + E) log V) and is the practical baseline — its cache behavior makes it the default winner for most inputs. A Fibonacci heap improves the theoretical bound to O(E + V log V) by making decrease-key O(1) amortized, which matters when E is much larger than V (dense graphs). In practice Fibonacci heaps lose to binary heaps almost everywhere because the constant factors and pointer chasing are brutal. Pairing heaps are the sweet spot: amortized bounds nearly as good as Fibonacci's, but with simple recursive code and far better cache locality. For competition-level Dijkstra, indexed binary heaps still dominate; for production code with heavy decrease-key, pairing heaps are often the right choice.

**S2. How does an *indexed* priority queue work, and why do you need it for graph algorithms?**
An indexed PQ associates each element with a stable external *id* (e.g., a vertex number) and maintains a `pos[id] = heap-index` map alongside the heap array. Every swap during siftUp/siftDown updates `pos` for both swapped entries. This lets you find and modify an element by id in O(log n) rather than O(n), enabling efficient `decreaseKey`, `increaseKey`, and `remove(id)`. Sedgewick's `IndexMinPQ` is the canonical reference. Without one, Dijkstra and Prim degrade to O(VE) in the worst case.

**S3. Walk me through how the JDK's `PriorityQueue.remove(Object)` works, and why it's O(n).**
The implementation calls `indexOf(o)` which linearly scans the backing array, costing O(n). Once found, it does a *removeAt*: swap with the last element, decrement size, then sift down (and if that fails to move, sift up — same trick as in M8). Because there is no index map, the linear scan is unavoidable. If you need fast removal-by-value, wrap the PQ in your own indexed structure or use a `TreeSet` with a custom comparator instead.

**S4. What invariants must an indexed heap maintain across every operation?**
(1) The heap property on the values array. (2) `pos[heap[i]] == i` for every index `i` in the heap. (3) `heap[pos[id]] == id` for every active id. (4) Inactive ids map to a sentinel (e.g., `-1`). These invariants must hold *between* operations and be restored *during* siftUp/siftDown — a swap of array slots `i` and `j` must also update `pos` for both ids. Forgetting to update `pos` on a single swap path leads to silent corruption that only manifests later when a `decreaseKey` cannot find its element.

**S5. How do you build a thread-safe priority queue?**
Three approaches. (1) Coarse lock — wrap every operation in a single mutex. Simple, correct, but a bottleneck. (2) Lock-free skip list with priority keys (e.g., Lindén & Jonsson 2013) — extracts are O(log n) but contention-free; insertions can be linearizable. (3) Sharded queues — partition by priority range, each shard locked independently, with a coordinating scheduler. JDK's `PriorityBlockingQueue` uses approach (1) with a `ReentrantLock`. For high-throughput schedulers, sharding or specialized lock-free designs are needed; for most code, the coarse lock is fine.

**S6. How would you build a priority queue that supports `bulk insert` of n elements in O(n)?**
Two layers. If you're inserting into an empty heap, just append all n elements and run Floyd's heapify — O(n). If you're inserting into an existing heap of size m, the optimal cost is O(n + m) by concatenating and re-heapifying; doing n individual O(log m) inserts is O(n log m), which is worse when n is large relative to log m. Some systems also use a *deferred buffer*: keep new elements in an unsorted buffer of size up to some threshold, then merge in batch. This amortizes inserts at the cost of slower peeks.

**S7. What is a *soft heap* and where is it used?**
A soft heap is a heap that is allowed to *corrupt* a small fraction (epsilon) of its keys — they appear larger than they really are. In exchange, all operations run in O(1) amortized time except find/delete-min which is O(log(1/eps)). It was invented by Bernard Chazelle to achieve a deterministic O(m alpha(m, n)) minimum spanning tree algorithm. You won't implement one in an interview, but knowing it exists is good signal at senior+ level — it shows you understand that trading exactness for time is a legitimate design dimension.

**S8. How do `monotone` priority queues differ, and when are they applicable?**
A monotone PQ is one where the minimum (or maximum) popped is *non-decreasing* over time — common in algorithms like Dijkstra on non-negative weights and in shortest-paths with bounded edge weights. This property enables specialized structures: bucket queues (O(1) per op when the priority range is small), radix heaps (O(log C) per op where C is the max key), and calendar queues for discrete event simulation. They beat comparison-based heaps when the priority range is bounded or the access pattern is highly monotone.

**S9. How do you design a priority queue that supports `get`-by-id, `decreaseKey`, `peekMin`, and `delete` all in O(log n)?**
The combination is an indexed binary heap with an external hash map. Internally, the heap stores `(priority, id)` pairs in an array. The hash map stores `id -> heap-index`. Every swap during sift updates the map. `get` and `delete` are O(log n): O(1) lookup via the map followed by O(log n) sift. For *exactly* O(log n) on `delete` (not amortized), you cannot use Fibonacci heaps because their amortized bound hides occasional O(log n) worst cases — but for almost all practical purposes the difference is academic.

**S10. What is the relationship between heaps and tournaments / loser trees, and why does it matter for k-way merge?**
A tournament tree (winner tree) is a complete binary tree where each internal node holds the *winner* of its two children — used in k-way merge to find the smallest head-of-stream in O(log k) per output. A *loser tree* stores the loser at each internal node, with the overall winner stored separately at the root; replacement after a pop touches only one root-to-leaf path because the winners are still implicit. Loser trees do exactly the same work as a binary heap but with one comparison per level instead of two, making them measurably faster for k-way merge in external sorting (where comparisons can be expensive — e.g., disk-based string keys).

---

## Professional Questions (8 Q&A)

**P1. You're designing a delayed-message system (millions of pending messages, each with a fire-time). How do you architect the priority queue?**
At small scale a single binary heap by fire-time works. At millions of entries the working set no longer fits a single machine's memory, so you partition. Common designs: (a) Redis sorted sets sharded by hash of message id, with a per-shard worker polling `ZRANGEBYSCORE`; (b) a database table with index on `fire_time` and a worker doing `SELECT ... WHERE fire_time <= NOW() LIMIT N FOR UPDATE SKIP LOCKED`; (c) Kafka with delayed-queue topics tiered by delay bucket (1s, 10s, 1m, ...). Pure in-memory PQs lose to these because you also need durability, replay, and horizontal scaling. The PQ semantics still apply per shard.

**P2. How does the Linux kernel's CFS (Completely Fair Scheduler) use a priority queue?**
CFS keeps runnable tasks in a per-CPU *red-black tree* keyed by `vruntime` (virtual runtime). Picking the next task to run is the leftmost node (smallest vruntime), which is O(log n) — and amortized O(1) because the leftmost pointer is cached. It is not a heap precisely because the kernel also needs efficient removal-by-id and ordered iteration for diagnostics. The RB-tree gives O(log n) for all of insert, remove, and pick-next, plus arbitrary-key updates when a task's priority changes — exactly the API you need for a scheduler.

**P3. How would you implement a `k`-way merge of large sorted files that don't fit in memory?**
Stream from each file with a small buffer. Maintain a min-heap of `(head-of-stream, stream-id)` of size k. Pop the smallest, write it to output, advance its stream, push the new head. This is O(N log k) total comparisons for N output elements. For very large k (thousands of streams), switch to a loser tree (S10) for fewer comparisons per output. For external sort, the merge phase chooses k so that k file handles plus k input buffers fit in RAM, and runs multiple passes if k < total runs.

**P4. How would you design a rate limiter on top of a priority queue?**
A token-bucket rate limiter doesn't intrinsically need a PQ — you just track tokens. But a *deadline-aware* scheduler does: each request arrives with a deadline, and you want to serve the most urgent next, subject to the global rate. The PQ is keyed on deadline, ordered min-first. A leaky-bucket worker pops at the configured rate. To bound memory, attach a max queue size and reject (or fail-fast) on overflow. For multi-tenant fairness, use weighted fair queueing — one PQ per tenant, dispatched in proportion to their weight.

**P5. What are the trade-offs of using a database-backed priority queue versus an in-memory one for a job system?**
DB-backed (Postgres `SKIP LOCKED`, MySQL with row locks) gives you durability, observability, easy cross-process consumption, and trivial admin tools. The cost is throughput — a few hundred to a few thousand pops per second per partition, dominated by disk IOPS and lock contention. In-memory PQs (Redis sorted sets, custom Go/Java heaps behind RPC) deliver tens to hundreds of thousands of pops per second but you must engineer durability (AOF, snapshots, replication) and visibility yourself. The right answer is usually a hybrid: an in-memory hot PQ in front, with a cold store for overflow and crash recovery.

**P6. How do you observe and debug a priority queue in production?**
Emit metrics: queue depth, distribution of priorities, age of head element, push/pop latency percentiles, evictions and overflows. Log every priority inversion (a pop returning a priority lower than the previous one in a monotone PQ implies a bug). For load-shed scenarios, expose the priority at which the system started rejecting work. For multi-tenant queues, track per-tenant queue depth and pop-rate. The most common production bugs in PQs are stale entries (lazy decrease-key), priority math overflow (signed-int subtraction), and unstable tie-breaking causing starvation.

**P7. How would you handle priority inversion in a real-time scheduler?**
Priority inversion happens when a high-priority task blocks on a resource held by a low-priority task that itself is preempted by a medium-priority task — the high-priority task ends up waiting for the medium one. The classic fixes: (1) *priority inheritance* — the low-priority lock holder temporarily inherits the highest waiting priority; (2) *priority ceiling* — every lock has a static ceiling priority and any task that acquires it runs at that priority. Both are inside the locking subsystem but interact with the PQ: priority changes must reflect into the scheduler's queue, which means your PQ needs efficient priority updates (indexed heap or RB-tree).

**P8. What changes when you need a distributed priority queue across many nodes?**
You lose strict global ordering — at best you get eventually-consistent "near-priority" pops. Designs: (1) *partitioned* — shard by hash of the message; each partition has a local PQ; consumers pull from any partition; ordering holds only within a partition. (2) *coordinator-based* — a leader merges heads of all shards; bottleneck at the coordinator. (3) *gossip-based* — peers exchange heads periodically; no strict ordering but high throughput. In all designs, *exactly-once pop* needs a distributed lock or a CAS-style claim mechanism. SQS FIFO queues, Kafka with key-partitioning, and Redis Streams are all pragmatic implementations of (1).

---

## Behavioral / System-Design Questions

**B1. Tell me about a time you chose the wrong data structure and had to refactor.**
Look for: honest self-assessment of the cost of the wrong choice (latency? memory? code complexity?), a description of how you noticed the problem (profiling, an incident, a code review), and what you learned about how to evaluate trade-offs earlier next time. A good signal is the candidate describing a *measurable* improvement after refactoring, not just "it felt cleaner."

**B2. Design a notification scheduler that fires millions of reminders at scheduled times.**
Expected dimensions: storage (DB versus Redis ZSET versus tiered), scheduling resolution (per second versus per minute), idempotency (retries on worker crash), back-pressure, observability, sharding by user id or fire-time, and graceful shutdown. A strong candidate sketches at least two architectures and discusses when each one fits. They should mention that the PQ semantics are emergent from the index on fire-time, not a literal in-memory heap.

**B3. Design a job system where some jobs are "priority 1" and must preempt running "priority 5" jobs.**
Now you need cancellable execution, which transforms the design. Workers must check for higher-priority work periodically and yield. Discuss: cooperative preemption (workers poll) versus forced (kill running task), state checkpointing, fairness (do priority-5 jobs ever run if priority-1 always arrives?), and starvation prevention (e.g., aging the priority). The PQ here is the *easy* part; the hard part is preemption and starvation.

**B4. Describe how you would test a custom priority-queue implementation.**
Property-based tests are the right answer: for any random sequence of push/pop, the pop order must equal the sorted order of pushed elements. Test edge cases: empty heap, single element, duplicates, large n (for performance regression), and `decreaseKey` updates if the API exposes them. Use a reference implementation (`heapq`, JDK `PriorityQueue`) as the oracle. For indexed heaps, an additional invariant check after every operation catches `pos` map desync immediately.

**B5. How would you explain a priority queue to a non-technical PM?**
Try: "It's like a queue at an ER — patients aren't seen in arrival order, they're seen by severity. When new patients arrive, the queue reorders itself behind the scenes so the most urgent is always next. The cost is that picking the next patient is slightly slower than a normal queue, but reordering is fast enough that we don't notice it." This communicates both the semantic (priority wins over arrival) and the trade-off (slightly slower than FIFO).

---

## Coding Challenges

### Challenge 1 — Task Scheduler with Cooldown

**Problem.** You are given a list of tasks represented by characters and an integer `n` representing the cooldown period: the same task cannot be executed twice within `n` time units. Each task takes 1 time unit. Return the *least* number of time units the CPU will take to finish all the given tasks.

**Examples.**
```text
tasks = ["A","A","A","B","B","B"], n = 2 -> 8     (A B _ A B _ A B)
tasks = ["A","C","A","B","D","B"], n = 1 -> 6     (A C A B D B)
tasks = ["A","A","A","B","B","B"], n = 0 -> 6     (A A A B B B)
```

**Constraints.** `1 <= tasks.length <= 10^4`. `tasks[i]` is an uppercase letter. `0 <= n <= 100`.

**Brute force.** Greedy simulation: at each time step, pick the available task with the highest remaining count, otherwise idle. Implemented naively with a linear scan of 26 letters per step, the time complexity is O(T * 26) where T is the answer — still feasible but inelegant.

**Optimal.** Two readings of the same idea exist:
1. *Greedy with a max-heap and a cooldown queue.* Push all task counts into a max-heap. At each tick, pop the most-frequent task that is *off cooldown*, decrement its count, and place it in a cooldown buffer for `n` ticks. This runs in O(T log 26) which is effectively O(T).
2. *Math formula.* Let `f` be the maximum frequency and `k` the number of tasks tying for that maximum. The answer is `max(len(tasks), (f-1) * (n+1) + k)`. The first term covers no-idle cases, the second counts the slot grid forced by the cooldown.

The heap solution is more general (extends to per-task cooldowns) and is what interviewers typically want to see.

```go
package main

import (
    "container/heap"
)

type maxHeap []int

func (h maxHeap) Len() int            { return len(h) }
func (h maxHeap) Less(i, j int) bool  { return h[i] > h[j] }
func (h maxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *maxHeap) Pop() interface{} {
    old := *h
    n := len(old)
    v := old[n-1]
    *h = old[:n-1]
    return v
}

func leastInterval(tasks []byte, n int) int {
    counts := make(map[byte]int)
    for _, t := range tasks {
        counts[t]++
    }
    h := &maxHeap{}
    heap.Init(h)
    for _, c := range counts {
        heap.Push(h, c)
    }
    type pending struct {
        remaining int
        readyAt   int
    }
    queue := []pending{}
    time := 0
    for h.Len() > 0 || len(queue) > 0 {
        time++
        if h.Len() > 0 {
            r := heap.Pop(h).(int) - 1
            if r > 0 {
                queue = append(queue, pending{r, time + n})
            }
        }
        if len(queue) > 0 && queue[0].readyAt == time {
            heap.Push(h, queue[0].remaining)
            queue = queue[1:]
        }
    }
    return time
}
```

```java
import java.util.*;

class Solution {
    public int leastInterval(char[] tasks, int n) {
        int[] counts = new int[26];
        for (char t : tasks) counts[t - 'A']++;
        PriorityQueue<Integer> heap = new PriorityQueue<>(Comparator.reverseOrder());
        for (int c : counts) if (c > 0) heap.offer(c);

        Deque<int[]> cooldown = new ArrayDeque<>(); // [remaining, readyAt]
        int time = 0;
        while (!heap.isEmpty() || !cooldown.isEmpty()) {
            time++;
            if (!heap.isEmpty()) {
                int r = heap.poll() - 1;
                if (r > 0) cooldown.offer(new int[]{r, time + n});
            }
            if (!cooldown.isEmpty() && cooldown.peek()[1] == time) {
                heap.offer(cooldown.poll()[0]);
            }
        }
        return time;
    }
}
```

```python
import heapq
from collections import Counter, deque

def leastInterval(tasks: list[str], n: int) -> int:
    heap = [-c for c in Counter(tasks).values()]
    heapq.heapify(heap)
    cooldown: deque[tuple[int, int]] = deque()  # (remaining_negative, ready_at)
    time = 0
    while heap or cooldown:
        time += 1
        if heap:
            r = heapq.heappop(heap) + 1  # less negative -> closer to 0
            if r < 0:
                cooldown.append((r, time + n))
        if cooldown and cooldown[0][1] == time:
            heapq.heappush(heap, cooldown.popleft()[0])
    return time
```

**Follow-up.** What if each task type has its own cooldown `n_i`? The math formula collapses; you must use the heap-plus-cooldown-queue simulation, with the cooldown queue keyed by `ready_at` and itself a min-heap because tasks may come off cooldown out of insertion order.

---

### Challenge 2 — Find K Pairs with Smallest Sums

**Problem.** You are given two sorted arrays `nums1` and `nums2` and an integer `k`. Define a pair `(u, v)` as one element from each array. Return the `k` pairs with the smallest sums.

**Examples.**
```text
nums1 = [1,7,11], nums2 = [2,4,6], k = 3 -> [[1,2],[1,4],[1,6]]
nums1 = [1,1,2], nums2 = [1,2,3], k = 2  -> [[1,1],[1,1]]
nums1 = [1,2], nums2 = [3], k = 3        -> [[1,3],[2,3]]
```

**Constraints.** `1 <= nums1.length, nums2.length <= 10^5`. `nums1` and `nums2` are sorted in non-decreasing order. `1 <= k <= 10^4`. Values fit in `int32`.

**Brute force.** Enumerate all O(n*m) pairs, push each into a min-heap, pop k. Time O(n*m log(n*m)), space O(n*m). Fails for the upper limits.

**Optimal.** Min-heap walking a grid frontier. Push the candidate pair `(nums1[0], nums2[0])` (with indices `(0,0)`) into a min-heap keyed by sum. Pop the smallest, record it, then push its two neighbors `(i+1, j)` and `(i, j+1)` — but use a visited set or push only `(i+1, j)` when `j == 0` to avoid duplicates. Stop after k pops. Time O(k log k), space O(k).

```go
package main

import "container/heap"

type pair struct {
    sum, i, j int
}
type pairHeap []pair

func (h pairHeap) Len() int            { return len(h) }
func (h pairHeap) Less(i, j int) bool  { return h[i].sum < h[j].sum }
func (h pairHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *pairHeap) Push(x interface{}) { *h = append(*h, x.(pair)) }
func (h *pairHeap) Pop() interface{} {
    old := *h
    n := len(old)
    v := old[n-1]
    *h = old[:n-1]
    return v
}

func kSmallestPairs(nums1, nums2 []int, k int) [][]int {
    res := [][]int{}
    if len(nums1) == 0 || len(nums2) == 0 || k == 0 {
        return res
    }
    h := &pairHeap{}
    heap.Init(h)
    limit := len(nums1)
    if limit > k {
        limit = k
    }
    for i := 0; i < limit; i++ {
        heap.Push(h, pair{nums1[i] + nums2[0], i, 0})
    }
    for h.Len() > 0 && len(res) < k {
        p := heap.Pop(h).(pair)
        res = append(res, []int{nums1[p.i], nums2[p.j]})
        if p.j+1 < len(nums2) {
            heap.Push(h, pair{nums1[p.i] + nums2[p.j+1], p.i, p.j + 1})
        }
    }
    return res
}
```

```java
import java.util.*;

class Solution {
    public List<List<Integer>> kSmallestPairs(int[] nums1, int[] nums2, int k) {
        List<List<Integer>> res = new ArrayList<>();
        if (nums1.length == 0 || nums2.length == 0 || k == 0) return res;
        PriorityQueue<int[]> heap = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
        int limit = Math.min(nums1.length, k);
        for (int i = 0; i < limit; i++) {
            heap.offer(new int[]{nums1[i] + nums2[0], i, 0});
        }
        while (!heap.isEmpty() && res.size() < k) {
            int[] top = heap.poll();
            int i = top[1], j = top[2];
            res.add(Arrays.asList(nums1[i], nums2[j]));
            if (j + 1 < nums2.length) {
                heap.offer(new int[]{nums1[i] + nums2[j + 1], i, j + 1});
            }
        }
        return res;
    }
}
```

```python
import heapq

def kSmallestPairs(nums1: list[int], nums2: list[int], k: int) -> list[list[int]]:
    if not nums1 or not nums2 or k == 0:
        return []
    heap: list[tuple[int, int, int]] = []
    for i in range(min(len(nums1), k)):
        heapq.heappush(heap, (nums1[i] + nums2[0], i, 0))
    res: list[list[int]] = []
    while heap and len(res) < k:
        _, i, j = heapq.heappop(heap)
        res.append([nums1[i], nums2[j]])
        if j + 1 < len(nums2):
            heapq.heappush(heap, (nums1[i] + nums2[j + 1], i, j + 1))
    return res
```

**Follow-up.** Generalize to K *arrays* instead of two — the smallest K *tuples* problem. The frontier becomes a hyper-rectangle; you push the all-zero index initially, pop the smallest, then push each of the K neighbors that differ by `+1` in exactly one coordinate. To avoid duplicates, use a hash set of visited index tuples.

---

### Challenge 3 — Reorganize String

**Problem.** Given a string `s`, rearrange the characters so that no two adjacent characters are the same. Return any valid arrangement. If it is not possible, return an empty string.

**Examples.**
```text
s = "aab"    -> "aba"
s = "aaab"   -> ""
s = "vvvlo"  -> "vlvov"
```

**Constraints.** `1 <= s.length <= 500`. `s` consists of lowercase English letters.

**Brute force.** Try all permutations and check; factorial. Not viable.

**Optimal.** Max-heap on frequency. At each step, pop the two most-frequent remaining characters, append one of each to the output, decrement counts, push back if still positive. If ever only one character remains and its count > 1, the answer is impossible.

Feasibility check: if any character appears more than `ceil(n/2)` times, no valid arrangement exists — return empty.

Complexity: O(n log 26) ≈ O(n) for the heap operations, since the alphabet is constant-sized.

```go
package main

import (
    "container/heap"
    "strings"
)

type freq struct {
    count int
    ch    byte
}
type freqHeap []freq

func (h freqHeap) Len() int           { return len(h) }
func (h freqHeap) Less(i, j int) bool { return h[i].count > h[j].count }
func (h freqHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *freqHeap) Push(x interface{}) { *h = append(*h, x.(freq)) }
func (h *freqHeap) Pop() interface{} {
    old := *h
    n := len(old)
    v := old[n-1]
    *h = old[:n-1]
    return v
}

func reorganizeString(s string) string {
    counts := make(map[byte]int)
    for i := 0; i < len(s); i++ {
        counts[s[i]]++
    }
    h := &freqHeap{}
    heap.Init(h)
    for ch, c := range counts {
        if c > (len(s)+1)/2 {
            return ""
        }
        heap.Push(h, freq{c, ch})
    }
    var b strings.Builder
    for h.Len() >= 2 {
        a := heap.Pop(h).(freq)
        c := heap.Pop(h).(freq)
        b.WriteByte(a.ch)
        b.WriteByte(c.ch)
        a.count--
        c.count--
        if a.count > 0 {
            heap.Push(h, a)
        }
        if c.count > 0 {
            heap.Push(h, c)
        }
    }
    if h.Len() == 1 {
        last := heap.Pop(h).(freq)
        if last.count > 1 {
            return ""
        }
        b.WriteByte(last.ch)
    }
    return b.String()
}
```

```java
import java.util.*;

class Solution {
    public String reorganizeString(String s) {
        int[] counts = new int[26];
        for (char c : s.toCharArray()) counts[c - 'a']++;
        PriorityQueue<int[]> heap = new PriorityQueue<>((a, b) -> b[0] - a[0]);
        int half = (s.length() + 1) / 2;
        for (int i = 0; i < 26; i++) {
            if (counts[i] > half) return "";
            if (counts[i] > 0) heap.offer(new int[]{counts[i], i});
        }
        StringBuilder sb = new StringBuilder();
        while (heap.size() >= 2) {
            int[] a = heap.poll();
            int[] b = heap.poll();
            sb.append((char) ('a' + a[1]));
            sb.append((char) ('a' + b[1]));
            if (--a[0] > 0) heap.offer(a);
            if (--b[0] > 0) heap.offer(b);
        }
        if (!heap.isEmpty()) {
            int[] last = heap.poll();
            if (last[0] > 1) return "";
            sb.append((char) ('a' + last[1]));
        }
        return sb.toString();
    }
}
```

```python
import heapq
from collections import Counter

def reorganizeString(s: str) -> str:
    counts = Counter(s)
    n = len(s)
    if max(counts.values()) > (n + 1) // 2:
        return ""
    heap: list[tuple[int, str]] = [(-c, ch) for ch, c in counts.items()]
    heapq.heapify(heap)
    out: list[str] = []
    while len(heap) >= 2:
        c1, ch1 = heapq.heappop(heap)
        c2, ch2 = heapq.heappop(heap)
        out.append(ch1)
        out.append(ch2)
        if c1 + 1 < 0:
            heapq.heappush(heap, (c1 + 1, ch1))
        if c2 + 1 < 0:
            heapq.heappush(heap, (c2 + 1, ch2))
    if heap:
        c, ch = heap[0]
        if -c > 1:
            return ""
        out.append(ch)
    return "".join(out)
```

**Follow-up.** Generalize to "no two characters within distance `k` of each other are equal" (LeetCode 358 — Rearrange String k Distance Apart). The two-pop trick no longer suffices because you must avoid `k` previous characters, not just 1. The fix is a max-heap plus a fixed-size cooldown FIFO of length `k`: pop the largest, append, place into the cooldown queue with its decremented count, and only return to the heap once the queue exceeds size `k`.

---

## Common Pitfalls in Interviews

- **Confusing min-heap and max-heap defaults.** Java's `PriorityQueue` is a min-heap; Python's `heapq` is a min-heap; C++ `priority_queue` is a max-heap by default. Saying the wrong one in front of an interviewer is a credibility hit.
- **Subtraction comparators.** `(a, b) -> a - b` overflows when `a` and `b` are large or one is `Integer.MIN_VALUE`. Always use `Integer.compare` / `Long.compare`.
- **Forgetting that contains and remove are O(n) on the JDK PQ.** Mentioning O(log n) `remove` without qualification is wrong.
- **Lazy deletion bugs.** When implementing Dijkstra with re-push instead of decrease-key, forgetting to skip already-finalized vertices on pop leads to wrong answers (re-processing) or excessive work.
- **Tie-breaking that triggers comparator exceptions.** In Python `(priority, item)` works only if `item` is comparable. The fix is `(priority, counter, item)` with a monotonic counter.
- **Heap "sort order" assumption.** Iterating a PQ does *not* yield sorted order. Many candidates write `for x in heap: ...` and assume sortedness. Only repeated `pop` gives sorted order.
- **Mutating priorities in place.** Mutating the key of an element already in the heap without re-heapifying breaks the heap invariant silently. Always remove-and-reinsert, or use a structure with explicit `decreaseKey`.
- **Forgetting to handle empty / single-element edge cases.** `peek` on empty heap, `pop` when only one element remains, off-by-one in `(n-1)/2` parent index.

---

## What Interviewers Are Really Testing

When an interviewer reaches for a PQ problem, the surface task is "code a heap-based solution," but the underlying signal they want is finer-grained:

- **Pattern recognition.** Can you *spot* that a problem needs a PQ from cues like "k smallest", "merge k sorted", "at each step pick the best"? Junior candidates often write nested loops; mid-level candidates reach for the heap immediately.
- **Choice of comparator.** Did you pick min-heap or max-heap correctly on the first try? Did you handle ties intentionally?
- **Complexity articulation.** Can you state O(n log k) versus O(n log n) and explain *why* it's better? Can you derive Floyd's O(n) heapify on demand?
- **API trade-offs.** Do you know that standard library PQs lack `decreaseKey`, and can you discuss when that matters (Dijkstra, A*) and what you do about it (re-push + lazy skip, or an indexed heap)?
- **Operational thinking (senior+).** For system-design adjacent questions, can you talk about durability, sharding, observability, and back-pressure — not just "use a heap"?
- **Code hygiene.** Stable comparators, no integer-overflow subtraction, clean handling of empty / single-element heaps, and consistent use of the heap API (`heappush` not `append`-then-heapify).

The interviewer is hiring for someone who will read a system's requirements, see "we need to schedule jobs by priority", and instantly reason about whether an in-memory heap, a Redis sorted set, a database with `SKIP LOCKED`, or a queue service is appropriate — not just default to the first one they remember.
