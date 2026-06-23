# Wrong Data Structure — Exercises

> **Category:** [Performance Anti-Patterns](../README.md) → **Wrong Data Structure** — *hands-on practice swapping the collection to fit the access pattern.*

---

These are **fix-it** exercises, not recognition quizzes ([`find-bug.md`](find-bug.md) does recognition). For each you get a problem, starting code (Go, Java, or Python — the language varies on purpose), acceptance criteria, and a collapsible solution with the **big-O before/after** and, where it matters, a **benchmark**. The point is to make the change *and* state the cost-model reason it's faster.

> **How to use this file.** Read the problem, do it in your editor *before* opening the solution, and write down the before/after big-O yourself. Refer back to [`middle.md`](middle.md) for the cost-table cheat sheet and the canonical fixes.

---

## Table of Contents

| # | Exercise | Wrong → Right | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Replace the membership scan](#exercise-1--replace-the-membership-scan) | list → set | Python | ★ easy |
| 2 | [Replace find-by-key scans](#exercise-2--replace-find-by-key-scans) | list scan → map | Go | ★★ medium |
| 3 | [Top-k without sorting the world](#exercise-3--top-k-without-sorting-the-world) | full sort → heap | Java | ★★ medium |
| 4 | [Fix the O(n) pop-front queue](#exercise-4--fix-the-on-pop-front-queue) | list → deque | Python | ★ easy |
| 5 | [Turn a nested-loop join into a hash join](#exercise-5--turn-a-nested-loop-join-into-a-hash-join) | nested loop → hash join | Go | ★★ medium |
| 6 | [Find the small-n crossover](#exercise-6--find-the-small-n-crossover) | benchmark slice vs map | Go | ★★★ hard |

---

## Exercise 1 — Replace the membership scan

**Wrong → Right:** list → set · **Language:** Python · **Difficulty:** ★ easy

`tag_new` flags log lines whose request id hasn't been seen in an allowlist. It crawls on large inputs.

```python
def tag_new(lines, allowed_ids):       # allowed_ids is a list
    out = []
    for line in lines:
        rid = line.request_id
        out.append((line, rid in allowed_ids))   # O(n) scan per line
    return out
```

**Acceptance:** identical output; the per-line check must be O(1) average; the whole function O(n + m).

<details>
<summary>Solution</summary>

The dominant operation is **membership** (`rid in allowed_ids`), so the right structure is a **set**, built once.

```python
def tag_new(lines, allowed_ids):
    allowed = set(allowed_ids)                    # O(m), built once
    return [(line, line.request_id in allowed)    # O(1) average per line
            for line in lines]
```

**Big-O:** O(n·m) → **O(n + m)**. For 100k lines × 100k allowed ids that's ~10 billion comparisons down to ~200k.

**Benchmark** (`pyperf`, 100k × 100k, illustrative): list ≈ 19 s, set ≈ 11 ms — three orders of magnitude.

**The cost-model reason:** `in` on a list is a linear scan (O(m)); on a set it's a hash + bucket check (O(1) average). Build the set **once**, outside the loop — building it per line would re-pay O(m) and keep the quadratic.

</details>

---

## Exercise 2 — Replace find-by-key scans

**Wrong → Right:** list scan → map · **Language:** Go · **Difficulty:** ★★ medium

`enrich` attaches a customer name to each order by scanning the customer slice per order.

```go
func findCustomer(custs []Customer, id int) (Customer, bool) {
    for _, c := range custs {       // O(n) scan
        if c.ID == id {
            return c, true
        }
    }
    return Customer{}, false
}

func enrich(orders []Order, custs []Customer) {
    for i := range orders {
        if c, ok := findCustomer(custs, orders[i].CustomerID); ok {  // O(n) each
            orders[i].CustomerName = c.Name
        }
    }
}
```

**Acceptance:** same result; lookups O(1) average; whole function O(n + q). Handle the build-once requirement explicitly.

<details>
<summary>Solution</summary>

The dominant operation is **lookup by key** (CustomerID). Index the customers into a **map once**, then probe.

```go
func indexByID(custs []Customer) map[int]Customer {
    idx := make(map[int]Customer, len(custs))   // pre-sized: avoids rehash spikes
    for _, c := range custs {
        idx[c.ID] = c
    }
    return idx
}

func enrich(orders []Order, custs []Customer) {
    idx := indexByID(custs)                       // O(n), once — hoisted out of the loop
    for i := range orders {
        if c, ok := idx[orders[i].CustomerID]; ok {  // O(1) average
            orders[i].CustomerName = c.Name
        }
    }
}
```

**Big-O:** O(n·q) → **O(n + q)** (n customers, q orders).

**Benchmark** (`testing.B`, 10k customers × 10k orders, illustrative): scan-per-lookup ≈ 41 ms, map-index ≈ 1.0 ms — ~40×, and the gap widens with size (the signature of fixing a quadratic).

**The cost-model reason:** the O(n) index build is paid **once** and amortized across all q lookups. Pre-sizing the map (`make(..., len(custs))`) avoids the O(n) rehash spikes during the build. If `custs` mutated between calls you'd keep the index in sync on writes rather than rebuild per call.

</details>

---

## Exercise 3 — Top-k without sorting the world

**Wrong → Right:** full sort → heap · **Language:** Java · **Difficulty:** ★★ medium

`topScores` returns the k highest scores from a large stream by sorting everything.

```java
List<Integer> topScores(List<Integer> scores, int k) {
    List<Integer> copy = new ArrayList<>(scores);
    copy.sort(Collections.reverseOrder());   // O(n log n), O(n) memory
    return copy.subList(0, Math.min(k, copy.size()));
}
```

**Acceptance:** same top-k (order within the result may differ if you document it); O(n log k) time, O(k) memory; must not sort the whole input.

<details>
<summary>Solution</summary>

Keep a **bounded min-heap of size k**: the root is the smallest of the current best k, so a new score only enters if it beats the root.

```java
List<Integer> topScores(List<Integer> scores, int k) {
    if (k <= 0) return List.of();
    PriorityQueue<Integer> heap = new PriorityQueue<>(k);  // min-heap
    for (int s : scores) {
        if (heap.size() < k) {
            heap.offer(s);
        } else if (s > heap.peek()) {        // s beats the current k-th best
            heap.poll();                      // drop the smallest
            heap.offer(s);                    // O(log k)
        }
    }
    List<Integer> out = new ArrayList<>(heap);
    out.sort(Collections.reverseOrder());     // sort only the k results
    return out;
}
```

**Big-O:** O(n log n), O(n) memory → **O(n log k) time, O(k) memory**.

For n=10,000,000 and k=10: `log k ≈ 3` vs `log n ≈ 23`, and you hold 10 ints instead of 10 million. For unbounded streams the memory bound is the decisive win — the full sort can't run at all if the data doesn't fit.

**The cost-model reason:** you never materialize or sort the whole input; only the k-element heap is maintained, each admission costing O(log k). Sorting just the k results at the end is O(k log k), negligible. (Library shortcut: this is what a size-k selection algorithm or `Stream`-based bounded priority queue does.)

</details>

---

## Exercise 4 — Fix the O(n) pop-front queue

**Wrong → Right:** list → deque · **Language:** Python · **Difficulty:** ★ easy

A breadth-first worker uses a list as a FIFO queue.

```python
def drain(initial):
    queue = list(initial)
    processed = []
    while queue:
        item = queue.pop(0)          # O(n) — shifts the whole list each time
        processed.append(item)
        queue.extend(children(item)) # appends are fine; pop(0) is the problem
    return processed
```

**Acceptance:** identical processing order; front-removal must be O(1); draining O(total items).

<details>
<summary>Solution</summary>

The access pattern is **FIFO** (append at the back, remove from the front). The right structure is `collections.deque`.

```python
from collections import deque

def drain(initial):
    queue = deque(initial)
    processed = []
    while queue:
        item = queue.popleft()       # O(1)
        processed.append(item)
        queue.extend(children(item)) # O(1) amortized per child at the back
    return processed
```

**Big-O:** draining O(n²) → **O(n)** (n total items processed).

**Benchmark** (50,000 items, illustrative): list `pop(0)` ≈ 1.2 s, `deque.popleft()` ≈ 6 ms.

**The cost-model reason:** `list.pop(0)` removes index 0, forcing every remaining element to shift down one slot — O(n) per pop, O(n²) to drain. A deque is a doubly-linked block structure with O(1) operations at both ends. (Java equivalent: `ArrayList.remove(0)` → `ArrayDeque`. Go: a ring buffer or head index, *not* `q = q[1:]` for long-lived queues, which leaks the backing array.)

</details>

---

## Exercise 5 — Turn a nested-loop join into a hash join

**Wrong → Right:** nested loop → hash join · **Language:** Go · **Difficulty:** ★★ medium

`reconcile` pairs payments with invoices by matching invoice id, with a nested loop.

```go
func reconcile(payments []Payment, invoices []Invoice) []Match {
    var out []Match
    for _, p := range payments {            // n
        for _, inv := range invoices {      // × m
            if inv.ID == p.InvoiceID {
                out = append(out, Match{p, inv})
                break
            }
        }
    }
    return out
}
```

**Acceptance:** same matches; O(n + m); hash the smaller collection.

<details>
<summary>Solution</summary>

A nested loop matching by key is a **hash join** in disguise. Build a hash index of the smaller side once, probe with the larger.

```go
func reconcile(payments []Payment, invoices []Invoice) []Match {
    // Build phase: index the (assumed smaller) invoices by ID. O(m).
    byID := make(map[int]Invoice, len(invoices))
    for _, inv := range invoices {
        byID[inv.ID] = inv
    }
    // Probe phase: scan payments once, O(1) lookup each. O(n).
    out := make([]Match, 0, len(payments))
    for _, p := range payments {
        if inv, ok := byID[p.InvoiceID]; ok {
            out = append(out, Match{p, inv})
        }
    }
    return out
}
```

**Big-O:** O(n·m) → **O(n + m)**.

**Benchmark** (`testing.B`, 20k × 20k, illustrative): nested loop ≈ 160 ms, hash join ≈ 1.5 ms — ~100×.

**The cost-model reason:** the nested loop re-scans all m invoices for every payment. Hashing the invoices once turns each inner scan into an O(1) lookup. **Hash the smaller side** so the table is smaller and more cache-resident — exactly the choice a query planner makes between a hash join and a nested-loop join. (If a payment can match many invoices, store `map[int][]Invoice` and iterate the slice.)

</details>

---

## Exercise 6 — Find the small-n crossover

**Wrong → Right:** measure, don't assume · **Language:** Go · **Difficulty:** ★★★ hard

"Always use a map for membership" is wrong for small n: a slice scan over a few cache-resident ints beats a hash lookup. Write a benchmark that **finds the crossover** — the n below which the slice scan wins.

**Acceptance:** a benchmark sweeping n that reports slice-scan vs map-lookup times per size, with the worst case for the scan (target = last element). State the crossover you observe and why it exists.

<details>
<summary>Solution</summary>

```go
package bench

import (
    "fmt"
    "testing"
)

func makeSlice(n int) []int {
    s := make([]int, n)
    for i := range s {
        s[i] = i
    }
    return s
}

func makeMap(n int) map[int]struct{} {
    m := make(map[int]struct{}, n)
    for i := 0; i < n; i++ {
        m[i] = struct{}{}
    }
    return m
}

func sliceContains(s []int, x int) bool {
    for _, v := range s {
        if v == x {
            return true
        }
    }
    return false
}

var sink bool // package-level: defeats dead-code elimination

func BenchmarkCrossover(b *testing.B) {
    for _, n := range []int{4, 8, 16, 32, 64, 128, 256} {
        s := makeSlice(n)
        m := makeMap(n)
        target := n - 1 // worst case for the scan: the last element

        b.Run(fmt.Sprintf("slice/n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                sink = sliceContains(s, target)
            }
        })
        b.Run(fmt.Sprintf("map/n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                _, sink = m[target]
            }
        })
    }
}
```

Run with `go test -bench=Crossover -benchmem` and compare per size.

**Illustrative result** (small int keys, x86):

| n | slice scan ns/op | map lookup ns/op | winner |
|---|---|---|---|
| 4 | 2.1 | 11 | **slice** |
| 8 | 3.6 | 11 | **slice** |
| 16 | 6.4 | 12 | **slice** |
| 32 | 12 | 12 | ~tie (**crossover**) |
| 64 | 23 | 12 | map |
| 256 | 90 | 13 | map |

**The crossover here is ~n=32.** Below it the slice wins; above it the map's roughly-flat cost takes over.

**Why it exists:** the map lookup is a near-constant ~11–13 ns (hash the int, mask to a bucket, compare — with a likely cache miss). The slice scan is ~`0.35·n` ns because the ints are contiguous and cache-resident, so each comparison is nearly free. They cross where the scan's linear cost overtakes the map's fixed cost. **Caveats:** the crossover moves with key type (hashing a string costs more, pushing the crossover higher), comparison cost, and hardware — so *measure for your case*. The lesson: don't cargo-cult a map onto a tiny, bounded collection; below the crossover the slice is both faster and simpler.

</details>

---

## Wrap-Up

| Exercise | Wrong structure | Right structure | Big-O fix |
|---|---|---|---|
| 1 | list membership | set | O(n·m) → O(n + m) |
| 2 | list find-by-key | map (built once) | O(n·q) → O(n + q) |
| 3 | full sort for top-k | bounded heap | O(n log n) → O(n log k), O(k) mem |
| 4 | list as queue | deque | O(n²) → O(n) |
| 5 | nested-loop join | hash join | O(n·m) → O(n + m) |
| 6 | (measure) | slice below crossover | — find where simple wins |

The throughline: **name the hot operation, pick the structure that makes it cheap, preprocess into it once — and for anything performance-critical, benchmark it** (Exercise 6 shows why the table isn't always the final word).

---

## Related Topics

- [`find-bug.md`](find-bug.md) — the spotting counterpart: identify the mismatch in a snippet.
- [`optimize.md`](optimize.md) — a full before/after with profiling and benchmark numbers, including the crossover caveat.
- [`middle.md`](middle.md) — the cost-table cheat sheet and the canonical fixes practiced here.
- [N+1 in Code → tasks](../02-n-plus-one-in-code/tasks.md) — the same "preprocess once, not per item" discipline for I/O.
- The `big-o-analysis`, `hash-table-design`, and `profiling-techniques` skills — cost analysis, set/map internals, and the benchmarking discipline.
