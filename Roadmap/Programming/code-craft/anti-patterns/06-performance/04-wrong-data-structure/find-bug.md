# Wrong Data Structure — Find the Bug

> **Category:** [Performance Anti-Patterns](../README.md) → **Wrong Data Structure** — *a collection whose cost model fights the access pattern.*

---

This is **critical-reading practice**. Each snippet is a plausible chunk of real-world Go, Java, or Python. Read it the way a performance-aware reviewer does and answer:

> **What's the structure/access mismatch? What's its big-O cost? What structure fixes it, and what's the new big-O?**

The "bug" is rarely a crash — it's a latent cost in the *shape*: an O(n) operation done in a loop, a re-sort per query, a list used as a queue. Several would sail through a casual review because each line looks cheap. **One snippet is a trap:** the "naive" slice is the *correct* choice for its small, bounded n — converting it to a map would be slower and noisier. Spot which one.

> **How to use this file:** read each snippet and write your own answer *before* expanding. The skill is noticing the cost model, not recalling a name.

---

## Table of Contents

1. [The allowlist filter](#snippet-1--the-allowlist-filter)
2. [The order enricher](#snippet-2--the-order-enricher)
3. [The next-cheapest picker](#snippet-3--the-next-cheapest-picker)
4. [The event queue](#snippet-4--the-event-queue)
5. [The reconciliation report](#snippet-5--the-reconciliation-report)
6. [The HTTP method check](#snippet-6--the-http-method-check)
7. [The leaderboard top-10](#snippet-7--the-leaderboard-top-10)

---

## Snippet 1 — The allowlist filter

```python
# Python — filter a stream of events down to allowed users
def allowed_events(events, allowlist):     # allowlist: list[int]
    return [e for e in events if e.user_id in allowlist]
```

> What's the mismatch, its big-O, and the fix?

<details>
<summary>Answer</summary>

**Mismatch:** membership test (`e.user_id in allowlist`) against a **list**. `in` on a list is a linear scan — O(n) — and it runs once per event, so the whole thing is **O(n·m)** (n events, m allowlist entries).

**Fix:** the dominant operation is membership, so use a **set**, built once:

```python
def allowed_events(events, allowlist):
    allowed = set(allowlist)               # O(m), once
    return [e for e in events if e.user_id in allowed]  # O(1) per check
```

**New big-O:** O(n + m). The set check is O(1) average instead of O(m). At 100k × 100k that's ~10 billion comparisons down to ~200k.

</details>

---

## Snippet 2 — The order enricher

```go
// Go — attach a product name to each line item
func enrich(items []LineItem, products []Product) {
    for i := range items {
        for _, p := range products {        // scan all products...
            if p.SKU == items[i].SKU {      // ...to find the matching one
                items[i].Name = p.Name
                break
            }
        }
    }
}
```

> What's the mismatch, its big-O, and the fix?

<details>
<summary>Answer</summary>

**Mismatch:** find-by-key implemented as a **linear scan inside a loop** — for each of n items, scan up to m products. **O(n·m)**. This is also a nested-loop join.

**Fix:** index products by SKU into a **map once**, then probe:

```go
func enrich(items []LineItem, products []Product) {
    byID := make(map[string]string, len(products))
    for _, p := range products {            // build once: O(m)
        byID[p.SKU] = p.Name
    }
    for i := range items {                  // O(n)
        if name, ok := byID[items[i].SKU]; ok {   // O(1) average
            items[i].Name = name
        }
    }
}
```

**New big-O:** O(n + m). The build pass is paid once and amortized across all lookups.

</details>

---

## Snippet 3 — The next-cheapest picker

```java
// Java — repeatedly pull the cheapest pending task
class Scheduler {
    private List<Task> pending = new ArrayList<>();

    Task next() {
        pending.sort(Comparator.comparingInt(Task::cost)); // re-sort every call
        return pending.remove(0);                          // take the cheapest
    }
}
```

> What's the mismatch, its big-O, and the fix?

<details>
<summary>Answer</summary>

**Mismatch:** repeated **min extraction** implemented by **re-sorting the whole list every call** — O(n log n) per `next()` — plus `remove(0)` shifting the list, another O(n). Pulling all n tasks is O(n² log n).

**Fix:** the access pattern is "repeatedly remove the minimum" — that's a **heap (priority queue)**:

```java
class Scheduler {
    private final PriorityQueue<Task> pending =
        new PriorityQueue<>(Comparator.comparingInt(Task::cost));

    void add(Task t) { pending.offer(t); }   // O(log n)
    Task next()      { return pending.poll(); }  // O(log n), min at the root
}
```

**New big-O:** O(log n) per `next()` (and per `add`), vs O(n log n). The heap keeps the minimum at the root and never re-sorts. Draining all n is O(n log n) instead of O(n² log n).

</details>

---

## Snippet 4 — The event queue

```python
# Python — process events in FIFO order, fanning out new ones
def run(seed):
    queue = list(seed)
    while queue:
        ev = queue.pop(0)              # take from the front
        for child in handle(ev):
            queue.append(child)        # add to the back
```

> What's the mismatch, its big-O, and the fix?

<details>
<summary>Answer</summary>

**Mismatch:** a **list used as a FIFO queue**. `queue.pop(0)` removes the front, forcing every remaining element to shift down one index — O(n) per pop. Processing N total events is **O(N²)**. (The `append` at the back is fine.)

**Fix:** use `collections.deque`, O(1) at both ends:

```python
from collections import deque

def run(seed):
    queue = deque(seed)
    while queue:
        ev = queue.popleft()           # O(1)
        for child in handle(ev):
            queue.append(child)        # O(1) amortized
```

**New big-O:** O(N) to process N events. (Java: `ArrayList.remove(0)` → `ArrayDeque`. Go: a ring buffer; avoid `q = q[1:]` for long-lived queues — it pins the backing array in memory.)

</details>

---

## Snippet 5 — The reconciliation report

```go
// Go — for every transaction, find duplicates by amount+date
func findDuplicates(txns []Txn) [][2]Txn {
    var dups [][2]Txn
    for i := 0; i < len(txns); i++ {
        for j := i + 1; j < len(txns); j++ {       // compare every pair
            if txns[i].Amount == txns[j].Amount &&
                txns[i].Date == txns[j].Date {
                dups = append(dups, [2]Txn{txns[i], txns[j]})
            }
        }
    }
    return dups
}
```

> What's the mismatch, its big-O, and the fix?

<details>
<summary>Answer</summary>

**Mismatch:** finding matches by an equality key via **all-pairs comparison** — O(n²). The key `(Amount, Date)` is exact-equality, so this is a self-join that a hash can do in one pass.

**Fix:** group by the key into a **map**, then emit pairs within each group:

```go
func findDuplicates(txns []Txn) [][2]Txn {
    type key struct {
        Amount int
        Date   string
    }
    groups := make(map[key][]Txn)
    for _, t := range txns {                    // O(n): one pass to group
        k := key{t.Amount, t.Date}
        groups[k] = append(groups[k], t)
    }
    var dups [][2]Txn
    for _, g := range groups {                  // emit pairs within each group
        for i := 0; i < len(g); i++ {
            for j := i + 1; j < len(g); j++ {
                dups = append(dups, [2]Txn{g[i], g[j]})
            }
        }
    }
    return dups
}
```

**New big-O:** O(n + output). Grouping is O(n); emitting pairs is proportional to the number of duplicates (unavoidable — you must produce them). For data with few duplicates this is effectively linear, vs the original O(n²) that compares every pair even when almost none match.

</details>

---

## Snippet 6 — The HTTP method check

```go
// Go — is this an HTTP method that may carry a body?
func methodHasBody(method string) bool {
    bodyMethods := []string{"POST", "PUT", "PATCH"}
    for _, m := range bodyMethods {       // linear scan of 3 elements
        if m == method {
            return true
        }
    }
    return false
}
```

> What's the mismatch, its big-O, and the fix?

<details>
<summary>Answer — this is the TRAP</summary>

**There is no bug here. The slice is the correct choice.**

It *looks* like the Snippet 1 anti-pattern — a linear membership scan — but the collection is **three fixed, compile-time-constant elements**, far below the small-n crossover (~8–32, see [`tasks.md` Exercise 6](tasks.md#exercise-6--find-the-small-n-crossover)). Scanning three short strings that sit in contiguous, cache-resident memory is *faster* than building/consulting a `map[string]struct{}` (which costs a hash, a bucket lookup, and likely a cache miss), and it's simpler and allocation-free.

**Converting this to a map would be the mistake** — cargo-culting "use a set for membership" onto a case where it loses. The rule is *match the structure to the operation at the actual n*, in both directions: a quadratic on big data is a bug, but a hash table on a 3-element constant set is over-engineering.

*If* this list grew to dozens of methods *and* sat on a hot path, you'd reach for a set (or, better here, a precomputed `map[string]struct{}` built once at package init). At n=3, the scan wins. The minor real nit: the slice is allocated on every call — hoist it to a package-level `var` — but the *structure choice* is right.

```go
// The only worthwhile tweak: build the literal once, not per call.
var bodyMethods = []string{"POST", "PUT", "PATCH"}

func methodHasBody(method string) bool {
    for _, m := range bodyMethods {
        if m == method {
            return true
        }
    }
    return false
}
```

</details>

---

## Snippet 7 — The leaderboard top-10

```python
# Python — top 10 players by score from a 5-million-row table
def top_10(players):                       # players: list of (name, score)
    ranked = sorted(players, key=lambda p: p[1], reverse=True)  # sort all 5M
    return ranked[:10]
```

> What's the mismatch, its big-O, and the fix?

<details>
<summary>Answer</summary>

**Mismatch:** top-k computed by **sorting the entire collection** — O(n log n) time and O(n) memory to surface just 10 rows. The work to order positions 11 through 5,000,000 is wasted.

**Fix:** a **bounded heap of size k** keeps only the 10 best as you stream through once:

```python
import heapq

def top_10(players):
    return heapq.nlargest(10, players, key=lambda p: p[1])  # O(n log k), O(k)
```

**New big-O:** O(n log k) time, O(k) memory (k=10). `log k ≈ 3` vs `log n ≈ 23` for n=5M, and you hold 10 rows instead of 5 million — which also means it works on a stream that doesn't fit in memory, where the full sort can't run at all. `heapq.nlargest` is exactly the bounded-heap algorithm; in Java, a size-k `PriorityQueue`; in Go, `container/heap`.

</details>

---

## Scorecard

| # | Mismatch | Cost | Fix | New cost |
|---|---|---|---|---|
| 1 | membership in a list | O(n·m) | set | O(n + m) |
| 2 | find-by-key scan in a loop | O(n·m) | map (built once) | O(n + m) |
| 3 | re-sort to get the min | O(n² log n) drain | heap | O(n log n) drain |
| 4 | list as a FIFO queue | O(N²) | deque | O(N) |
| 5 | all-pairs match by key | O(n²) | group by key (map) | O(n + output) |
| **6** | **TRAP — slice is correct** | **O(3) ≈ constant** | **keep the slice** | **(hoist the literal)** |
| 7 | full sort for top-k | O(n log n), O(n) mem | bounded heap | O(n log k), O(k) mem |

The trap (Snippet 6) is the whole point: the anti-pattern is a structure that fights the access pattern *at the real n*. Below the crossover, the "naive" linear scan is the right answer — and turning it into a hash structure is itself a wrong-structure choice in the opposite direction.

---

## Related Topics

- [`tasks.md`](tasks.md) — fix these mismatches yourself, with benchmarks (Exercise 6 measures the crossover behind Snippet 6).
- [`optimize.md`](optimize.md) — a full before/after with profiling and numbers, including the crossover caveat.
- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — recognize → pick → choose-in-context → deep trade-offs.
- [Premature Optimization Traps → find-bug](../01-premature-optimization-traps/find-bug.md) — the opposite reviewer reflex: don't "fix" what isn't a measured hotspot.
- The `big-o-analysis`, `hash-table-design`, and `profiling-techniques` skills — the cost model behind every answer here.
