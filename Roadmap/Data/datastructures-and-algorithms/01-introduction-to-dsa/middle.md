# Introduction to Data Structures & Algorithms — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Why DSA Matters Beyond Performance](#why-dsa-matters-beyond-performance)
3. [The Engineer's Decision Framework](#the-engineers-decision-framework)
4. [Reading the Access Pattern](#reading-the-access-pattern)
5. [Trade-Off Axes Every Structure Sits On](#trade-off-axes-every-structure-sits-on)
6. [How Algorithmic Strategies Map to Problems](#how-algorithmic-strategies-map-to-problems)
7. [Asymptotic vs Real-World Cost](#asymptotic-vs-real-world-cost)
8. [Choosing a Structure — Worked Examples](#choosing-a-structure--worked-examples)
9. [Composing Data Structures](#composing-data-structures)
10. [When DSA Goes Wrong in Production](#when-dsa-goes-wrong-in-production)
11. [Standard Library vs Hand-Rolled](#standard-library-vs-hand-rolled)
12. [Code Examples — Same Problem, Stronger Solutions](#code-examples--same-problem-stronger-solutions)
13. [How to Practice at the Middle Level](#how-to-practice-at-the-middle-level)
14. [Summary](#summary)

---

## Introduction

> Focus: "Why does the choice matter?" and "When do I reach for which tool?"

The junior file answered *what is DSA*. The middle level is about **judgement**: given a vague requirement and a real codebase, how do you pick the right data structure and algorithm, justify the choice, and recognize the trade-offs you accepted? Middle engineers do not memorize structures — they read access patterns and **derive** the structure.

This document covers the decision framework, the axes you trade along, the gap between asymptotic and wall-clock performance, common composite structures, and the production failure modes that come from a wrong choice.

---

## Why DSA Matters Beyond Performance

Performance is the obvious reason. But once you are past the junior stage, three more reasons start to dominate:

### 1. Data structure choice constrains future evolution

Once a hot path uses a particular structure, **everything around it inherits that structure's assumptions**. Choose a list when you need a set, and every caller has to defensively deduplicate forever. Choose a synchronous queue when you needed a pub/sub, and every new feature has to bolt on filtering. The right structure pays you back for years; the wrong one taxes every future change.

### 2. The structure encodes the invariant

A set "cannot contain duplicates" is a guarantee enforced by the structure itself — no caller can violate it. A min-heap "always returns the smallest pending item" is enforced by the structure. Picking the right structure means **the invariant is unbreakable**, instead of being a comment that some future commit will silently invalidate.

### 3. Communication and design vocabulary

"This is a write-behind cache with LRU eviction on top of an LSM-tree-backed store" is unambiguous and takes five seconds to say. The same sentence in code-level terms ("a buffer that flushes asynchronously...") takes a paragraph and is ambiguous. DSA is the shared dialect of system design.

---

## The Engineer's Decision Framework

A middle engineer applies the same checklist on every non-trivial design:

1. **Characterize the data.**
   - Size (10? 10⁶? 10¹²?)
   - Mutability (read-only? frequent updates?)
   - Distribution (uniform? skewed? streaming?)
   - Domain (integers in a small range? arbitrary strings?)

2. **Characterize the operations.**
   - What is the ratio of reads to writes?
   - Which operations must be O(1) or O(log n)?
   - Which can be amortized? Which can be batched?
   - Are queries point queries, range queries, or aggregates?
   - Do you need stable ordering, or is "some order" acceptable?

3. **Characterize the constraints.**
   - Memory budget — RAM, cache, disk?
   - Latency SLA — p50, p99, p99.9?
   - Concurrency — readers/writers, single-threaded, distributed?
   - Persistence — in-memory only, write-through, write-back?
   - Failure model — must we survive crash mid-update?

4. **Match the structure to the answers.** This is mechanical once steps 1–3 are honest.

5. **Estimate the resulting Big-O and back-of-envelope cost.** Verify the operation budget fits the latency SLA before writing code.

The mistake of a junior engineer is to skip directly to step 4. The mistake of a senior who skipped this discipline is to skip steps 1–3 and pick the structure they used last week.

---

## Reading the Access Pattern

The "access pattern" is the most useful concept at the middle level. It is the answer to: *"Across all operations my code will perform, what are the dominant ones, and what shape do they have?"*

### Common access patterns

| Pattern | Description | Default structure |
|---|---|---|
| **Random-access by index** | "Give me the i-th element" | Array |
| **Insertion / removal at known position** | Cursor-based edits, log replay | Linked list, gap buffer |
| **LIFO** | Last-in is first-out | Stack |
| **FIFO** | First-in is first-out | Queue / deque |
| **Membership** | "Is X present?" — order irrelevant | Hash set |
| **Key → value lookup** | "Get the record for ID 42" | Hash map |
| **Ordered iteration / range scan** | "All entries between A and Z" | Tree map / sorted array |
| **Top-K / priority** | "Give me the smallest/largest pending item" | Heap |
| **Prefix search** | "All words starting with `cat`" | Trie |
| **Graph traversal** | "Reach all nodes connected to X" | Adjacency list + BFS/DFS |
| **Range query / aggregate** | "Sum/min/max over an interval" | Prefix sums, segment tree |
| **Sliding window** | A moving range over a sequence | Deque, monotonic queue |
| **Streaming / unbounded** | Data arrives forever, cannot store all | Bloom filter, reservoir sample, sketch |

A single application usually has more than one access pattern, which is why structures are routinely **composed** (see [Composing Data Structures](#composing-data-structures)).

---

## Trade-Off Axes Every Structure Sits On

Every data structure can be described as a point on a small number of axes. There is no free lunch: gaining on one axis costs on another.

| Axis | Two ends | Example |
|---|---|---|
| **Time vs space** | Fewer ops vs less memory | Hash table (more space, faster ops) vs sorted array (less space, slower inserts) |
| **Read vs write** | Fast reads vs fast writes | B+ tree (fast read, slow write) vs LSM tree (slow read, fast write) |
| **Worst case vs average case** | Predictable vs fast-on-average | Balanced BST (O(log n) worst) vs hash table (O(1) avg, O(n) worst) |
| **Mutable vs immutable** | In-place edits vs persistent | Array vs persistent tree |
| **Ordered vs unordered** | Iteration order matters or not | Tree map vs hash map |
| **Stable vs unstable** | Equal keys keep original order | Merge sort (stable) vs quicksort (unstable) |
| **Cache-friendly vs pointer-chasing** | Contiguous vs scattered | Array vs linked list |
| **Single-thread vs concurrent** | Lock-free / locked / mutex-free | Plain hash map vs `sync.Map` / `ConcurrentHashMap` |
| **Approximate vs exact** | Saves space at the cost of error | Bloom filter, HyperLogLog vs hash set |

A middle engineer can articulate **which axis they prioritized and which they sacrificed** for any design choice.

---

## How Algorithmic Strategies Map to Problems

Algorithms group into a small number of families. Each family has a question that selects it.

| Family | The question it answers | Typical signal |
|---|---|---|
| **Brute force** | "Can I just try everything?" | Tiny input, prototype |
| **Two pointers** | "Can I traverse from both ends?" | Sorted array, pair-finding |
| **Sliding window** | "Can I incrementally update a range as it moves?" | Contiguous subarray, substring with property |
| **Binary search** | "Can I halve the search space each step?" | Sorted / monotonic property |
| **Greedy** | "Does the local best lead to the global best?" | Activity selection, Huffman, Dijkstra |
| **Divide and conquer** | "Can I split, solve, merge?" | Mergesort, FFT, closest pair |
| **Dynamic programming** | "Do subproblems overlap?" | Counting paths, edit distance, knapsack |
| **Backtracking** | "Can I prune dead branches early?" | N-queens, Sudoku, generation |
| **BFS / DFS** | "Am I exploring a graph?" | Reachability, shortest hops |
| **Topological sort** | "Are there dependencies?" | Build order, course schedule |
| **Union-Find** | "Am I merging components incrementally?" | Connected components, Kruskal |
| **Hashing** | "Can I trade space for O(1) lookup?" | Membership, frequency, dedup |
| **Randomization** | "Will an expected bound suffice?" | Quickselect, randomized quicksort, MinHash |
| **Approximation** | "Can I sacrifice exactness for speed/space?" | Bloom filter, HyperLogLog, LSH |

Middle-level practice is partly about training your pattern recognition so that the right family **announces itself** when you read the problem.

---

## Asymptotic vs Real-World Cost

Big-O is necessary, but it is not sufficient. At the middle level you start caring about the **constants**.

### 1. Cache locality matters more than asymptotics for small n

For arrays of fewer than ~10⁴ elements, a linear scan over a contiguous slice **beats** a binary tree lookup, because the array fits in L1/L2 cache and the tree does not.

> Hardware reality: a single L1 cache hit is ~1 ns; an L3 miss to RAM is ~100 ns; an SSD read is ~100 µs. A "fast" algorithm that pointer-chases through RAM is 100× slower than an "asymptotically worse" one that walks contiguous memory.

### 2. Hidden constants in language libraries

| Operation | Big-O | Realistic constant |
|---|---|---|
| Go `map[K]V` lookup | O(1) | ~30 ns (hashing + bucket walk) |
| Java `HashMap` lookup | O(1) | ~30–50 ns |
| Python `dict` lookup | O(1) | ~50 ns |
| Slice `append` (Go, amortized) | O(1) amortized | spikes to O(n) on grow |
| Python `list.insert(0, x)` | O(n) | a hidden O(n) on the "fast" language's list |

The middle engineer asks: *"What is the actual cost, not the textbook cost?"*

### 3. Worst case vs typical case

A hash table is O(1) average but O(n) worst case under adversarial input. For an internal cache that does not see attacker-controlled keys, the average case is what you ship. For a public API that accepts user-controlled keys, you must consider the worst case — which is why many languages (Python, Go, Java) randomize hash seeds at startup.

### 4. Amortized cost

A dynamic array's `push` is O(1) amortized but each individual `push` may be O(n) when it grows the backing buffer. For batch work this is fine. For a real-time system with strict per-operation latency, "amortized O(1)" can still violate the SLA on a single bad operation. The right tool there is a structure with **worst-case** bounds, e.g. a deque with fixed-size chunks.

---

## Choosing a Structure — Worked Examples

### Example 1: Rate limiter — last 60 seconds of request timestamps

Operations:

- `record(now)`: append a timestamp.
- `count()`: how many timestamps are within the last 60 s?

Access pattern: append-on-one-end + expire-from-the-other-end + count. This is a sliding window.

Wrong: a plain list (O(n) to drop stale entries).
Right: a **deque**. Append on the right; pop from the left while the left entry is older than `now - 60`. Then `len(deque)` is the answer. Each operation is O(1) amortized.

### Example 2: Spell checker

Operations:

- `is_word(s)`: is `s` in the dictionary?
- `suggestions(prefix)`: list all words starting with `prefix`.

Access pattern: membership + prefix lookup.

Wrong: a hash set (no prefix support).
Right: a **trie**. Membership is O(|s|). Prefix lookup walks down the trie to the prefix node and DFS-collects the subtree.

### Example 3: Job scheduler

Operations:

- `submit(job, priority)`.
- `nextJob()`: returns the highest-priority pending job.

Access pattern: insert anywhere + extract maximum.

Wrong: a sorted list (O(n) insert).
Right: a **max-heap**. Both ops are O(log n).

### Example 4: Online median (data arrives one at a time, query median anytime)

Wrong: re-sort the whole list every time you want the median (O(n log n) per query).
Right: **two heaps** — a max-heap for the lower half, a min-heap for the upper half, kept balanced. Insert O(log n), query O(1).

### Example 5: Detect duplicate URLs in a 100 GB log on a 16 GB machine

Constraint: the full set cannot fit in RAM.

Wrong: a hash set (will OOM).
Right: a **Bloom filter** for the membership check, accepting some false positives, with a slower exact check on the suspicious subset. If you must be exact, an external-memory hash or sort-merge dedup.

These five examples illustrate the entire middle-level skill: read the access pattern, list the constraints, pick the structure whose strengths match.

---

## Composing Data Structures

Real systems almost never use one structure in isolation. The middle level introduces **composite** structures.

### LRU cache = hash map + doubly linked list

- Hash map gives O(1) key lookup.
- Doubly linked list gives O(1) move-to-front and evict-from-back.
- Together: O(1) `get` and `put`, with bounded size and least-recently-used eviction.

### Median data stream = max-heap + min-heap

Already shown above. Two heaps cover two access patterns the language's standard heap cannot do alone.

### Index on a database = B+ tree + bloom filter (often)

- B+ tree provides ordered, paged on-disk access.
- An optional Bloom filter per page short-circuits the "definitely not here" case without a disk read.

### Inverted index = hash map + posting list

- Hash map: term → posting list of document IDs.
- Posting list: usually a sorted array, sometimes compressed (variable-byte, Roaring bitmaps).
- Together: full-text search.

### Counter with top-K = hash map + heap

- Hash map for counts.
- Heap (size K) for the running top-K.

The lesson: when no single structure satisfies all your access patterns, **layer** them.

---

## When DSA Goes Wrong in Production

Middle engineers learn DSA partly from the literature and partly from the production incidents listed here. These failures recur.

| Failure | Root cause | Fix |
|---|---|---|
| Quadratic blow-up on adversarial input | Naïve nested loop on user-supplied data | Hashing, sort + sweep, or input cap |
| Hash table degenerates to O(n) under attack | Predictable hash seed enables collision attack | Randomized hash seed; treap; capped chain length |
| Memory exhaustion in long-running process | Unbounded cache | TTL, LRU/LFU, max-size eviction |
| Recursion stack overflow | Deep recursion on user data (e.g. JSON nesting) | Iterative version with explicit stack |
| Thundering herd | Many threads recompute the same expired cache entry | Probabilistic early expiration; single-flight |
| Lock contention on a popular map | Single-mutex map under concurrency | Striped locks; `sync.Map` / `ConcurrentHashMap` |
| Slow `O(n²)` join on growing tables | A pair-wise loop instead of a hash join | Hash the smaller side; sort-merge join |
| Latency spike from amortized resize | Dynamic-array growth at a bad moment | Pre-size; or use a worst-case bounded deque |
| GC pressure from short-lived nodes | Linked-list of tiny objects | Switch to slice/array; pool objects |
| False sharing on a per-CPU counter | Adjacent atomic counters on the same cache line | Pad to cache-line size |

Each is a DSA problem in disguise.

---

## Standard Library vs Hand-Rolled

A general rule for middle engineers:

> **Use the standard library by default. Hand-roll a structure only when (a) the standard library does not provide it, (b) you have measured and the standard library version is the bottleneck, or (c) the educational value is the point.**

### Library choices by language

| Need | Go | Java | Python |
|---|---|---|---|
| Dynamic array | `[]T` (slice) | `ArrayList<T>` | `list` |
| Linked list | `container/list` | `LinkedList<T>` | `collections.deque` |
| Stack | slice with `append` / `pop` | `Deque<T>` (`ArrayDeque`) | `list` or `deque` |
| Queue | `chan T` or slice | `Queue<T>` (`ArrayDeque`) | `collections.deque` |
| Deque | slice or `container/list` | `ArrayDeque<T>` | `collections.deque` |
| Hash map | `map[K]V` | `HashMap<K, V>` | `dict` |
| Hash set | `map[K]struct{}` | `HashSet<T>` | `set` |
| Sorted map | (none — use sorted slice + `sort.Search` or third-party tree) | `TreeMap<K, V>` | `sortedcontainers.SortedDict` |
| Priority queue / heap | `container/heap` | `PriorityQueue<T>` | `heapq` |
| LRU cache | third-party (e.g. `hashicorp/golang-lru`) | `LinkedHashMap` with `removeEldestEntry` | `functools.lru_cache` / `collections.OrderedDict` |

Knowing **what your standard library provides** is itself a DSA skill.

---

## Code Examples — Same Problem, Stronger Solutions

A classic middle-level problem: **longest substring without repeating characters**. Three solutions illustrate the progression of thinking.

### Naïve — try every substring (O(n³))

#### Go

```go
package main

import "fmt"

func longestUnique(s string) int {
    best := 0
    for i := 0; i < len(s); i++ {
        for j := i + 1; j <= len(s); j++ {
            seen := map[byte]bool{}
            ok := true
            for k := i; k < j; k++ {
                if seen[s[k]] {
                    ok = false
                    break
                }
                seen[s[k]] = true
            }
            if ok && j-i > best {
                best = j - i
            }
        }
    }
    return best
}

func main() { fmt.Println(longestUnique("abcabcbb")) }
```

#### Java

```java
public class LongestUniqueNaive {
    public static int longestUnique(String s) {
        int best = 0;
        for (int i = 0; i < s.length(); i++) {
            for (int j = i + 1; j <= s.length(); j++) {
                boolean[] seen = new boolean[128];
                boolean ok = true;
                for (int k = i; k < j; k++) {
                    if (seen[s.charAt(k)]) { ok = false; break; }
                    seen[s.charAt(k)] = true;
                }
                if (ok) best = Math.max(best, j - i);
            }
        }
        return best;
    }
    public static void main(String[] args) {
        System.out.println(longestUnique("abcabcbb"));
    }
}
```

#### Python

```python
def longest_unique_naive(s):
    best = 0
    for i in range(len(s)):
        for j in range(i + 1, len(s) + 1):
            if len(set(s[i:j])) == j - i:
                best = max(best, j - i)
    return best

if __name__ == "__main__":
    print(longest_unique_naive("abcabcbb"))
```

### Better — sliding window with a hash set (O(n))

#### Go

```go
package main

import "fmt"

func longestUniqueWindow(s string) int {
    seen := map[byte]bool{}
    left, best := 0, 0
    for right := 0; right < len(s); right++ {
        for seen[s[right]] {
            delete(seen, s[left])
            left++
        }
        seen[s[right]] = true
        if right-left+1 > best {
            best = right - left + 1
        }
    }
    return best
}

func main() { fmt.Println(longestUniqueWindow("abcabcbb")) }
```

#### Java

```java
import java.util.HashSet;

public class LongestUniqueWindow {
    public static int longestUnique(String s) {
        HashSet<Character> seen = new HashSet<>();
        int left = 0, best = 0;
        for (int right = 0; right < s.length(); right++) {
            while (seen.contains(s.charAt(right))) {
                seen.remove(s.charAt(left++));
            }
            seen.add(s.charAt(right));
            best = Math.max(best, right - left + 1);
        }
        return best;
    }
    public static void main(String[] args) {
        System.out.println(longestUnique("abcabcbb"));
    }
}
```

#### Python

```python
def longest_unique_window(s):
    seen = set()
    left = best = 0
    for right, ch in enumerate(s):
        while ch in seen:
            seen.remove(s[left])
            left += 1
        seen.add(ch)
        best = max(best, right - left + 1)
    return best

if __name__ == "__main__":
    print(longest_unique_window("abcabcbb"))
```

### Strongest — sliding window with a `lastSeen` map (still O(n), fewer rewinds)

#### Go

```go
package main

import "fmt"

func longestUniqueFast(s string) int {
    last := make(map[byte]int)
    left, best := 0, 0
    for right := 0; right < len(s); right++ {
        if idx, ok := last[s[right]]; ok && idx >= left {
            left = idx + 1
        }
        last[s[right]] = right
        if right-left+1 > best {
            best = right - left + 1
        }
    }
    return best
}

func main() { fmt.Println(longestUniqueFast("abcabcbb")) }
```

#### Java

```java
import java.util.HashMap;

public class LongestUniqueFast {
    public static int longestUnique(String s) {
        HashMap<Character, Integer> last = new HashMap<>();
        int left = 0, best = 0;
        for (int right = 0; right < s.length(); right++) {
            char c = s.charAt(right);
            if (last.containsKey(c) && last.get(c) >= left) {
                left = last.get(c) + 1;
            }
            last.put(c, right);
            best = Math.max(best, right - left + 1);
        }
        return best;
    }
    public static void main(String[] args) {
        System.out.println(longestUnique("abcabcbb"));
    }
}
```

#### Python

```python
def longest_unique_fast(s):
    last = {}
    left = best = 0
    for right, ch in enumerate(s):
        if ch in last and last[ch] >= left:
            left = last[ch] + 1
        last[ch] = right
        best = max(best, right - left + 1)
    return best

if __name__ == "__main__":
    print(longest_unique_fast("abcabcbb"))
```

| Version | Time | Space | Pattern used |
|---|---|---|---|
| Naïve | O(n³) | O(n) | None |
| Sliding window + set | O(n) | O(n) | Two pointers + hash set |
| Sliding window + map | O(n) (fewer rewinds) | O(n) | Two pointers + last-seen map |

The improvement from version 2 to version 3 is a *middle-level* move: same Big-O, smaller constant, achieved by storing more useful information.

---

## How to Practice at the Middle Level

The junior file said *"implement, do not just read"*. The middle file extends that:

1. **Implement, then optimize.** Solve a problem with the obvious approach; **then** re-solve it asking "where is the wasted work?". The second pass is where you learn pattern recognition.

2. **State invariants before writing code.** What property of the data structure must always hold? If you cannot state it, your loop conditions will be wrong.

3. **Practice naming the access pattern.** Before solving any problem, write one sentence describing its access pattern. *"This is a range-sum problem with point updates."* If the sentence is sharp, the structure follows.

4. **Read production source code.** The Java `HashMap`, Go `runtime/map.go`, Python `dictobject.c`, Redis `dict.c` — each one is a master class in DSA in the wild. Reading these teaches you what *real* hash tables look like, not the textbook diagram.

5. **Time your solutions.** Add a microbenchmark to every non-trivial implementation. The gap between your model of "fast" and the measured truth is where you learn the most.

6. **Reproduce failures.** When a colleague reports "the cache is slow", write the smallest reproduction. Half the time the bug is a DSA mistake (unbounded growth, accidental quadratic, lock contention).

7. **Vary the inputs.** Every solution should be tested on: empty, single element, all-duplicates, already-sorted, reverse-sorted, large random, adversarially-crafted. This is what hardens your code beyond toy examples.

---

## Summary

At the middle level, DSA is no longer about memorizing structures — it is about reading the **access pattern** of a problem and **deriving** the structure from it. You learn to articulate trade-offs (read vs write, time vs space, worst vs average, exact vs approximate), to spot when a single structure does not suffice and structures must be composed (LRU cache, median-of-stream), and to recognize the production failure modes that come from a wrong choice.

Asymptotic complexity is necessary but not sufficient: at this level you also reason about cache locality, hidden constants, amortized vs worst-case bounds, and adversarial inputs. The standard library is your default — hand-rolling is reserved for the rare case where it is justified.

The next file, `senior.md`, takes the same problems and embeds them in distributed systems, concurrency, and observability. The level after that, `professional.md`, proves the bounds formally.
