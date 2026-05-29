# Multiset / Bag — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing the Right Backend](#choosing-the-right-backend)
3. [Multiset vs. Map vs. Sorted Multiset](#multiset-vs-map-vs-sorted-multiset)
4. [Multiset Algebra](#multiset-algebra)
5. [The Counter Pattern in Algorithms](#the-counter-pattern-in-algorithms)
   - [Anagram Family](#anagram-family)
   - [Top-K Frequent](#top-k-frequent)
   - [Sliding-Window Frequency](#sliding-window-frequency)
6. [Sorted Multisets](#sorted-multisets)
7. [Library Cheat Sheet](#library-cheat-sheet)
8. [Performance Analysis](#performance-analysis)
9. [Memory Considerations](#memory-considerations)
10. [Best Practices](#best-practices)
11. [Summary](#summary)

---

## Introduction

At the junior level you learned that a multiset is `map<element, count>` and saw the bedrock counter pattern. At the middle level the question shifts from "what is it?" to "when do I reach for it instead of a plain map, a set, or a sorted container?" and "how does it compose with sliding windows, DP, and streaming algorithms?"

Three things tend to matter in practice:
1. The **algebra** of multisets (sum, difference, intersection, union) — these turn into one-liners with the right primitives.
2. The **counter pattern** as the engine behind anagrams, frequency-based problems, and most "string with repeated characters" interview problems.
3. The **sorted multiset** as the underrated tool for sliding-window min/max-by-key problems where elements need to be removed mid-window.

---

## Choosing the Right Backend

| Backend | Ordering | add / remove / count | Extra ops | When |
|---------|----------|---------------------|-----------|------|
| Hash multiset (`HashMap<T,int>`) | None | O(1) avg | none | Default; pure frequency. |
| Sorted multiset (`TreeMap<T,int>`, `std::multiset`) | By key | O(log n) | min/max, range queries, `floor/ceiling` | Sliding window with key removal; statistic queries. |
| Dense array `int[K]` | By index | O(1) worst | iteration over alphabet | Small dense key space (ASCII 0..127, digits 0..9). |
| Indexed priority queue | By count | O(log n) | get-max-by-count | Streaming top-k where the same element changes count. |
| Persistent/CRDT (G/PN counter) | -- | O(1) per op | merge | Distributed bags (see senior.md). |

The default is hash. Move to a sorted variant **only when you need ordered queries on the keys** or **need to remove arbitrary elements in O(log n)**. Move to a dense array when the alphabet is small and known — the constant factor crushes any hash.

---

## Multiset vs. Map vs. Sorted Multiset

| Attribute | Multiset (hash) | Plain map `<K, V>` | Sorted Multiset |
|-----------|----------------|-------------------|----------------|
| `add(x)` | increment, idempotent semantics | overwrite, lose history | increment |
| Time (add/remove/count) | O(1) avg | O(1) avg | O(log n) |
| Ordering | none | none | by key |
| Range query | no | no | yes |
| Native iteration | unordered | unordered | sorted |
| Library | `Counter`, `HashMultiset` | `dict`, `HashMap` | `TreeMultiset`, `std::multiset` |

**Choose a multiset when** the **count** is the answer (top-k, anagram, frequency).
**Choose a plain map when** you need an arbitrary value per key, not a count.
**Choose a sorted multiset when** you also need "what is the smallest element left in this window?" — which a hash multiset cannot answer in better than O(distinct).

---

## Multiset Algebra

For multisets `A` and `B` over the same universe, four operations are universally defined element-wise:

| Operation | Formula on counts | Intuition |
|-----------|------------------|-----------|
| Sum (additive union) | `(A + B)(x) = A(x) + B(x)` | Merge two carts. |
| Multiset union | `(A ∪ B)(x) = max(A(x), B(x))` | "Have at least as many as the larger." |
| Intersection | `(A ∩ B)(x) = min(A(x), B(x))` | Common subset with multiplicity. |
| Difference | `(A - B)(x) = max(A(x) - B(x), 0)` | What remains in A after removing B. |

Note that `A + B` and `A ∪ B` are different in multisets — they coincide only for ordinary sets, where counts are 0 or 1. Mixing them up is a classic interview slip.

### Implementing the Algebra

#### Go

```go
package main

import "fmt"

type Multiset map[string]int

func (a Multiset) Sum(b Multiset) Multiset {
	out := Multiset{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] += v
	}
	return out
}

func (a Multiset) Intersect(b Multiset) Multiset {
	out := Multiset{}
	for k, av := range a {
		if bv, ok := b[k]; ok {
			m := av
			if bv < m {
				m = bv
			}
			if m > 0 {
				out[k] = m
			}
		}
	}
	return out
}

func (a Multiset) Diff(b Multiset) Multiset {
	out := Multiset{}
	for k, av := range a {
		d := av - b[k]
		if d > 0 {
			out[k] = d
		}
	}
	return out
}

func main() {
	a := Multiset{"x": 3, "y": 1}
	b := Multiset{"x": 1, "z": 2}
	fmt.Println(a.Sum(b))       // map[x:4 y:1 z:2]
	fmt.Println(a.Intersect(b)) // map[x:1]
	fmt.Println(a.Diff(b))      // map[x:2 y:1]
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class MultisetAlgebra {

    public static Map<String, Integer> sum(Map<String, Integer> a, Map<String, Integer> b) {
        Map<String, Integer> out = new HashMap<>(a);
        b.forEach((k, v) -> out.merge(k, v, Integer::sum));
        return out;
    }

    public static Map<String, Integer> intersect(Map<String, Integer> a, Map<String, Integer> b) {
        Map<String, Integer> out = new HashMap<>();
        a.forEach((k, av) -> {
            Integer bv = b.get(k);
            if (bv != null) {
                int m = Math.min(av, bv);
                if (m > 0) out.put(k, m);
            }
        });
        return out;
    }

    public static Map<String, Integer> diff(Map<String, Integer> a, Map<String, Integer> b) {
        Map<String, Integer> out = new HashMap<>();
        a.forEach((k, av) -> {
            int d = av - b.getOrDefault(k, 0);
            if (d > 0) out.put(k, d);
        });
        return out;
    }

    public static void main(String[] args) {
        Map<String, Integer> a = Map.of("x", 3, "y", 1);
        Map<String, Integer> b = Map.of("x", 1, "z", 2);
        System.out.println(sum(a, b));       // {x=4, y=1, z=2}
        System.out.println(intersect(a, b)); // {x=1}
        System.out.println(diff(a, b));      // {x=2, y=1}
    }
}
```

#### Python

```python
from collections import Counter

a = Counter({"x": 3, "y": 1})
b = Counter({"x": 1, "z": 2})

print(a + b)   # Counter({'x': 4, 'z': 2, 'y': 1})
print(a & b)   # Counter({'x': 1})            -- intersection (min)
print(a - b)   # Counter({'x': 2, 'y': 1})    -- difference, drops <=0
print(a | b)   # Counter({'x': 3, 'z': 2, 'y': 1}) -- max-union
```

> Python's `Counter` is the most ergonomic of the three — the operators are exactly the multiset algebra, and the result automatically discards entries that drop to zero or below.

---

## The Counter Pattern in Algorithms

### Anagram Family

Many interview problems are dressed-up multiset equality tests:

| Problem | Multiset insight |
|---------|------------------|
| "Are these two strings anagrams?" | `Counter(a) == Counter(b)` |
| "Group anagrams together" | Group by `frozenset(Counter(s).items())` or sorted string |
| "Find all anagrams of `p` in `s`" | Sliding window of size `len(p)` over `s` with counter difference |
| "Minimum window substring containing all chars of `p`" | Two counters: `need` and `have`, and a `matched` count |

The "matched count" trick is critical: rather than comparing two full counters on every window slide (O(distinct) per slide), track how many keys currently have `have[k] >= need[k]`. Total runtime drops to O(n).

#### Find All Anagrams — Go

```go
package main

import "fmt"

func findAnagrams(s, p string) []int {
	var result []int
	if len(s) < len(p) {
		return result
	}
	var need, have [26]int
	for i := 0; i < len(p); i++ {
		need[p[i]-'a']++
	}
	required := 0
	for _, c := range need {
		if c > 0 {
			required++
		}
	}
	matched := 0
	for r := 0; r < len(s); r++ {
		c := s[r] - 'a'
		have[c]++
		if have[c] == need[c] {
			matched++
		}
		if r >= len(p) {
			c2 := s[r-len(p)] - 'a'
			if have[c2] == need[c2] {
				matched--
			}
			have[c2]--
		}
		if matched == required {
			result = append(result, r-len(p)+1)
		}
	}
	return result
}

func main() {
	fmt.Println(findAnagrams("cbaebabacd", "abc")) // [0 6]
}
```

#### Find All Anagrams — Java

```java
import java.util.ArrayList;
import java.util.List;

public class FindAnagrams {
    public static List<Integer> findAnagrams(String s, String p) {
        List<Integer> result = new ArrayList<>();
        if (s.length() < p.length()) return result;
        int[] need = new int[26], have = new int[26];
        for (char c : p.toCharArray()) need[c - 'a']++;
        int required = 0;
        for (int c : need) if (c > 0) required++;
        int matched = 0;
        for (int r = 0; r < s.length(); r++) {
            int c = s.charAt(r) - 'a';
            have[c]++;
            if (have[c] == need[c]) matched++;
            if (r >= p.length()) {
                int c2 = s.charAt(r - p.length()) - 'a';
                if (have[c2] == need[c2]) matched--;
                have[c2]--;
            }
            if (matched == required) result.add(r - p.length() + 1);
        }
        return result;
    }

    public static void main(String[] args) {
        System.out.println(findAnagrams("cbaebabacd", "abc")); // [0, 6]
    }
}
```

#### Find All Anagrams — Python

```python
from collections import Counter

def find_anagrams(s: str, p: str) -> list[int]:
    if len(s) < len(p):
        return []
    need = Counter(p)
    have: Counter[str] = Counter()
    required, matched = len(need), 0
    result: list[int] = []
    for r, ch in enumerate(s):
        have[ch] += 1
        if have[ch] == need[ch]:
            matched += 1
        if r >= len(p):
            left = s[r - len(p)]
            if have[left] == need[left]:
                matched -= 1
            have[left] -= 1
        if matched == required:
            result.append(r - len(p) + 1)
    return result

if __name__ == "__main__":
    print(find_anagrams("cbaebabacd", "abc"))  # [0, 6]
```

### Top-K Frequent

Asked everywhere: "Given an array, return the `k` most frequent elements."

Two correct multiset-based approaches:

1. **Counter + min-heap of size k** — O(n log k) time, O(n + k) space. Best for streaming or when k is small.
2. **Counter + bucket sort by frequency** — O(n) time, O(n) space. Best when counts are bounded by `n`.

#### Top-K — Go

```go
package main

import (
	"container/heap"
	"fmt"
)

type item struct {
	value string
	count int
}
type minHeap []item

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i].count < h[j].count }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x interface{}) { *h = append(*h, x.(item)) }
func (h *minHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func topKFrequent(arr []string, k int) []string {
	counts := map[string]int{}
	for _, v := range arr {
		counts[v]++
	}
	h := &minHeap{}
	heap.Init(h)
	for v, c := range counts {
		heap.Push(h, item{v, c})
		if h.Len() > k {
			heap.Pop(h)
		}
	}
	out := make([]string, 0, k)
	for h.Len() > 0 {
		out = append(out, heap.Pop(h).(item).value)
	}
	return out
}

func main() {
	fmt.Println(topKFrequent([]string{"a", "b", "a", "c", "a", "b"}, 2)) // [b a]
}
```

#### Top-K — Java

```java
import java.util.*;

public class TopK {
    public static List<String> topKFrequent(String[] arr, int k) {
        Map<String, Integer> counts = new HashMap<>();
        for (String s : arr) counts.merge(s, 1, Integer::sum);

        PriorityQueue<Map.Entry<String, Integer>> heap =
            new PriorityQueue<>(Comparator.comparingInt(Map.Entry::getValue));

        for (var e : counts.entrySet()) {
            heap.offer(e);
            if (heap.size() > k) heap.poll();
        }

        List<String> out = new ArrayList<>();
        while (!heap.isEmpty()) out.add(heap.poll().getKey());
        Collections.reverse(out);
        return out;
    }

    public static void main(String[] args) {
        System.out.println(topKFrequent(new String[]{"a", "b", "a", "c", "a", "b"}, 2));
    }
}
```

#### Top-K — Python

```python
from collections import Counter

def top_k_frequent(arr: list[str], k: int) -> list[str]:
    return [v for v, _ in Counter(arr).most_common(k)]

if __name__ == "__main__":
    print(top_k_frequent(["a", "b", "a", "c", "a", "b"], 2))  # ['a', 'b']
```

`Counter.most_common(k)` internally uses `heapq.nlargest` — exactly the heap approach above, just packaged.

### Sliding-Window Frequency

The pattern is the same recipe every time:
1. Build a counter for the initial window.
2. Slide: increment incoming, decrement outgoing, **delete the key when count hits 0**.
3. Read off `distinct()` or some derived predicate.

This is the underlying skeleton of "longest substring with at most K distinct characters," "number of nice subarrays," and many "subarray with exactly K something" problems that benefit from at-most-K minus at-most-K-1.

---

## Sorted Multisets

When you need both "decrement an arbitrary element" and "what's the current max?", a sorted multiset wins. Classic uses:

- **Sliding-window median:** maintain two sorted multisets (low, high) where `low` keeps the lower half and `high` the upper. Insert into the right half, rebalance.
- **Find K-th largest in a dynamic stream that supports removals.**
- **"Closest value to x in a stream"** via `floor` / `ceiling` lookups.

In Java this is `TreeMultiset` from Guava or a `TreeMap<T, Integer>` you manage yourself; in C++ it is `std::multiset` directly (one node per occurrence); in Go you must build it (typical: red-black BST or a wrapper around `container/list` + index map). Python has no stdlib sorted multiset — use `sortedcontainers.SortedList` (third-party) which keeps each occurrence as its own entry.

```text
Insert x:           O(log n)
Remove one x:       O(log n)
Min / Max:          O(log n) or O(1) cached
Count of x:         depends on impl — O(log n) or O(1)
Range count [a,b]:  O(log n) with order-statistics augmentation
```

---

## Library Cheat Sheet

### Python — `collections.Counter`

```python
from collections import Counter
c = Counter("mississippi")
c.most_common(2)        # [('i', 4), ('s', 4)]
c.total()               # 11 (Python 3.10+)
c["x"]                  # 0  (no KeyError)
c["a"] += 5
c.subtract("missing")   # decrement counts; can go negative!
c1 + c2 / c1 - c2       # discard non-positive counts
c1 | c2 / c1 & c2       # max-union / min-intersection
```

`Counter.subtract` deliberately permits negative counts so it can be reversed; the arithmetic operators `+ - | &` prune non-positive counts after the operation.

### Java — Guava `Multiset`

```java
import com.google.common.collect.HashMultiset;
import com.google.common.collect.Multisets;

Multiset<String> ms = HashMultiset.create();
ms.add("apple", 3);      // adds 3 occurrences
ms.count("apple");       // 3
ms.remove("apple");      // 2  (decrements by 1)
ms.size();               // total with duplicates
ms.elementSet().size();  // distinct count
ms.entrySet();           // Set<Entry<E>>  where Entry has element and count
Multisets.copyHighestCountFirst(ms);  // sorted by count desc
```

For tree variant: `TreeMultiset.create()` — supports `firstEntry()`, `lastEntry()`, `headMultiset`, `tailMultiset`.

### C++ — `std::multiset`, `std::unordered_multiset`

```text
multiset<int> ms;
ms.insert(5);
ms.count(5);          // O(log n + k) where k = matches
ms.erase(ms.find(5)); // erase ONE occurrence (erase(5) erases all!)
*ms.begin();          // smallest
*ms.rbegin();         // largest
```

Note: `ms.erase(value)` removes **all** occurrences — a famous pitfall. Always erase by iterator if you mean "one."

### Go — `map[T]int`

Go has no stdlib multiset. The canonical pattern is `map[T]int` plus a `total int`. For sorted multisets, reach for a third-party red-black tree (e.g., `github.com/google/btree`).

---

## Performance Analysis

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func benchmarkCounter() {
	sizes := []int{1_000, 10_000, 100_000, 1_000_000}
	for _, n := range sizes {
		data := make([]int, n)
		for i := range data {
			data[i] = rand.Intn(n / 10)
		}
		start := time.Now()
		counts := map[int]int{}
		for _, v := range data {
			counts[v]++
		}
		elapsed := time.Since(start)
		fmt.Printf("n=%9d distinct=%6d: %.3f ms\n", n, len(counts), float64(elapsed.Microseconds())/1000)
	}
}

func main() { benchmarkCounter() }
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

public class CounterBench {
    public static void main(String[] args) {
        int[] sizes = {1_000, 10_000, 100_000, 1_000_000};
        Random r = new Random(0);
        for (int n : sizes) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = r.nextInt(n / 10);
            long start = System.nanoTime();
            Map<Integer, Integer> counts = new HashMap<>();
            for (int v : data) counts.merge(v, 1, Integer::sum);
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%9d distinct=%6d: %.3f ms%n",
                n, counts.size(), elapsed / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import random, timeit
from collections import Counter

random.seed(0)
for n in (1_000, 10_000, 100_000, 1_000_000):
    data = [random.randrange(n // 10) for _ in range(n)]
    t = timeit.timeit(lambda: Counter(data), number=5) / 5
    print(f"n={n:>9} distinct={len(set(data)):>6}: {t*1000:.3f} ms")
```

Expect Counter to beat your hand-rolled loop in Python because its update path is implemented in C. In Go and Java, the hand-rolled `map[T]int` is the standard production approach.

---

## Memory Considerations

A multiset's memory footprint is governed by:
1. **Distinct count `d`** — drives the size of the underlying hash table or tree.
2. **Per-entry overhead** — Java `HashMap` Node ~48 B; Python `dict` ~56 B per entry; Go `map[int]int` ~32 B amortized.
3. **Load factor** of the underlying map — typically 0.75 means roughly 1.33x array slot per entry.

For a 1M distinct counter you are paying ~50 MB in Java/Python just for the structure, before key data. When the alphabet is small (digits, ASCII, byte values), a dense `int[K]` array of counters is **dramatically** more efficient — both in memory and in cache behavior.

Important: **always remove keys whose count reaches 0** in a long-running counter, otherwise you have created a memory leak that looks like a working counter.

---

## Best Practices

- **Always cache `total`** if you call `size()` frequently — recomputing `sum(counts.values())` is O(distinct).
- **Always delete zero-count keys** on `remove` — both for correct equality semantics and to bound memory.
- **Prefer `merge`/`getOrDefault`** in Java; `setdefault` is fine in Python but `Counter` is better; use `m[k]++` in Go (zero-value initialization makes the pattern clean).
- **Pick the dense array** for small fixed alphabets — 4-10x faster than a hash counter.
- **Document the equality contract** of your custom Multiset: two multisets are equal iff their count maps are equal **after pruning zeros**.
- **Reach for the sorted variant only when you actually need ordered queries** — the log factor adds up at the scales where multisets shine (millions of distinct elements).

---

## Summary

At the middle level a multiset is no longer "a map I increment." It is a tool with its own algebra (sum, union, intersection, difference) and its own canonical algorithm pattern (the counter pattern) that powers an enormous slice of real string-processing, frequency-analysis, and sliding-window problems. The choice between hash, tree, and dense-array backends is where the performance lives. The hardest bug is forgetting to remove zero-count keys in long-running counters — make pruning automatic in your wrapper or rely on `Counter`'s built-in `+`/`-` operators that do it for you.

In senior.md we scale this same data structure out: distributed counting via Redis `HINCRBY`, approximate counting via Count-Min Sketch, and streaming top-k via Misra-Gries.
