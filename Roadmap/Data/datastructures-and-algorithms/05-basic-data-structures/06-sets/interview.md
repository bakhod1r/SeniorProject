# Set (Set ADT) — Interview Preparation

## Junior Questions

| # | Question | Expected Answer Focus |
|---|---|---|
| 1 | What is a set and how is it different from an array? | Unique elements, no order, membership-focused vs index-focused |
| 2 | What is the time complexity of `contains` on a HashSet? | O(1) average, O(n) worst-case |
| 3 | What is the difference between Set ADT and HashSet? | ADT is contract; HashSet is one implementation among many (TreeSet, BitSet) |
| 4 | How would you remove duplicates from a list? | Iterate and add to set, return list of set; or `dict.fromkeys` to preserve order |
| 5 | What does `union(A, B)` produce? | Set of all elements in A or B (or both), no duplicates |
| 6 | What does `intersection(A, B)` produce? | Set of elements in both A and B |
| 7 | When would you use a TreeSet instead of a HashSet? | Sorted iteration or range queries needed |
| 8 | Can a set contain `null` or `nil`? | Depends on implementation — Java HashSet yes, TreeSet no, Python set yes |
| 9 | Why is iteration order undefined for HashSet? | Internal bucket order depends on hash function and table size |
| 10 | What is a set's `size()` after `add(5); add(5); add(5)`? | 1 — adds are idempotent |
| 11 | Name three real-world uses of a set. | Banned-list, visited tracking in BFS/DFS, tag deduplication |
| 12 | How do you check if two sets are equal? | Same size and every member of one is in the other |
| 13 | What is the empty set written as in math notation? | `∅` or `{}` |
| 14 | Does `[1,2,3]` equal `[3,2,1]` as a set? | Yes — set equality ignores order |
| 15 | What is `A \ B` (difference)? | Members of A that are not in B |
| 16 | What does it mean for an element to be "hashable"? | It has a stable hash function and an equality definition |
| 17 | What is the difference between `==` and `equals` for set membership? | `==` is reference identity in Java; sets use `equals` for content equality |
| 18 | How big is a set after `add(1); add(2); remove(1); add(2); add(3);`? | Size 2 — final members are {2, 3} |
| 19 | What does Python `frozenset` give you that `set` does not? | Immutability — can be a member of another set or a dict key |
| 20 | What is the time complexity of computing the symmetric difference? | O(|A| + |B|) — walk both sets once |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|---|---|
| 1 | Explain the `equals`/`hashCode` contract. | Equal objects must have equal hashes; violation breaks `contains` |
| 2 | Why does inserting into a HashSet sometimes take O(n)? | Resize/rehash triggered by load factor exceeding threshold |
| 3 | What is the iterate-smaller-probe-larger pattern? | Walk smaller set, probe membership in larger — O(min(|A|, |B|)) |
| 4 | Why use a BitSet over a HashSet for dense integer keys? | 1 bit/element vs ~50–100 B/element, plus bit-parallel algebra |
| 5 | What happens if you store mutable objects in a HashSet and then mutate them? | Set becomes corrupted — element hashes to wrong bucket, `contains` fails |
| 6 | How do you choose between LinkedHashSet and HashSet? | LinkedHashSet preserves insertion order at small per-op overhead |
| 7 | Implement intersection of two sorted sets in O(|A| + |B|). | Two-pointer merge-like sweep |
| 8 | Why does `set.add(NaN)` behave strangely? | NaN != NaN; same NaN value may insert twice in some languages |
| 9 | Difference between symmetric difference and union? | Symmetric difference excludes elements in both: (A ∪ B) \ (A ∩ B) |
| 10 | How does Java's HashSet handle null? | Stores at most one null; uses 0 as its hash |
| 11 | What is hash flooding and how do languages defend? | Adversarial collision input; defense is randomized/keyed hash (SipHash) |
| 12 | When is `containsAll(A, B)` cheaper than `B ⊆ A`? | Same problem — both iterate B and probe A, choose smaller iteration side |
| 13 | Explain load factor and why HashSet resizes. | size/capacity; once > 0.75, chain length grows and ops degrade |
| 14 | Why does Go intentionally randomize map iteration order? | Prevent code from depending on accidental ordering across versions |
| 15 | Pre-sizing a HashSet — when and why? | `new HashSet<>(n)` avoids costly rehashes during bulk insertion |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|---|---|
| 1 | Design a distributed banned-IP service for 1B IPs and 10⁶ QPS. | Bloom filter in-process + Redis SET sharded by IP + Postgres source of truth |
| 2 | When would you choose a Bloom filter over an exact set? | Read-heavy, false-positive tolerable, memory bound — first-tier negative filter |
| 3 | Explain consistent hashing for sharding sets. | Hash both keys and nodes onto ring; add/remove node remaps only K/N keys |
| 4 | How does Redis implement SINTER across many sets? | Iterate smallest set, probe membership in all others; complexity O(min · K) |
| 5 | What is an OR-Set CRDT and when is it useful? | Tag adds with unique IDs; remove deletes observed IDs; concurrent add wins |
| 6 | Describe a lock-free HashSet `add` operation. | CAS bucket head; retry on conflict; no global lock |
| 7 | How would you measure the false-positive rate of a deployed Bloom filter? | Sample positive results and verify against source of truth; alert on drift |
| 8 | What metrics do you alert on for a Redis-backed set service? | p99 latency, memory fragmentation, slowlog count, replication lag, hit rate |
| 9 | Sharding by element vs by set key — trade-offs? | By element: cross-set algebra natural; by key: per-set ops local, cross-set fan-out |
| 10 | How does HyperLogLog estimate set cardinality? | Hash elements; track max leading zeros per bucket; harmonic-mean formula |
| 11 | What is a tombstone explosion and how do you mitigate? | CRDT removes accumulate; GC after vector clock stability across replicas |
| 12 | Why does `SMEMBERS` on a large Redis SET stall the server? | Redis is single-threaded; large response blocks the event loop |
| 13 | When would RCU outperform a lock-free HashSet? | Read:write ratio > ~100:1; perfect read scaling vs write copy cost |

---

## Coding Challenge (3 Languages)

### Challenge: Intersection of Two Arrays in O(n + m)

> Given two integer arrays `a` and `b`, return the elements present in both, each appearing once. Order does not matter.
>
> Example: `a = [1, 2, 2, 3, 4]`, `b = [2, 3, 3, 5]` → `[2, 3]`.

**Approach**: Build a HashSet from the smaller array. Walk the larger array, adding each member of both into a result set. The result set automatically deduplicates. Time: O(n + m). Space: O(min(n, m)).

#### Go

```go
package main

import "fmt"

func intersection(a, b []int) []int {
    // Choose smaller array as the lookup set.
    small, large := a, b
    if len(b) < len(a) {
        small, large = b, a
    }

    seen := make(map[int]struct{}, len(small))
    for _, x := range small {
        seen[x] = struct{}{}
    }

    result := make(map[int]struct{})
    for _, x := range large {
        if _, ok := seen[x]; ok {
            result[x] = struct{}{}
        }
    }

    out := make([]int, 0, len(result))
    for x := range result {
        out = append(out, x)
    }
    return out
}

func main() {
    a := []int{1, 2, 2, 3, 4}
    b := []int{2, 3, 3, 5}
    fmt.Println(intersection(a, b)) // some order of [2 3]
}
```

#### Java

```java
import java.util.*;

public class Intersection {
    public static int[] intersection(int[] a, int[] b) {
        int[] small = a, large = b;
        if (b.length < a.length) { small = b; large = a; }

        Set<Integer> seen = new HashSet<>(small.length);
        for (int x : small) seen.add(x);

        Set<Integer> result = new HashSet<>();
        for (int x : large) {
            if (seen.contains(x)) result.add(x);
        }

        int[] out = new int[result.size()];
        int i = 0;
        for (int x : result) out[i++] = x;
        return out;
    }

    public static void main(String[] args) {
        int[] a = {1, 2, 2, 3, 4};
        int[] b = {2, 3, 3, 5};
        System.out.println(Arrays.toString(intersection(a, b)));
    }
}
```

#### Python

```python
def intersection(a: list[int], b: list[int]) -> list[int]:
    small, large = (a, b) if len(a) <= len(b) else (b, a)
    seen = set(small)
    return list({x for x in large if x in seen})


if __name__ == "__main__":
    print(intersection([1, 2, 2, 3, 4], [2, 3, 3, 5]))  # e.g. [2, 3]
```

### Variations to Discuss

- **Preserve order**: walk the larger array and emit each new match into an order-preserving structure.
- **Sorted inputs**: switch to two-pointer merge for O(n + m) time and O(1) extra space.
- **Streaming**: build the set from the bounded side and probe the stream — O(min(n, m)) memory.
- **Approximate**: replace the seen-set with a Bloom filter for huge inputs; accept rare false-positive matches.
- **Multiset semantics** (count duplicates): use frequency maps instead of sets.

A senior interviewer often pushes from the base problem into these variations — be ready to switch strategies when the input shape changes.

---

## Behavioral and Whiteboard Tips

| Tip | Why it matters |
|---|---|
| Always state the ADT before the implementation | Shows you separate contract from representation |
| Ask about the universe size | A bounded integer universe unlocks BitSet — far better than HashSet |
| Ask about duplicates in input | If duplicates count, you need a multiset, not a set |
| Ask about ordering requirements | TreeSet vs HashSet vs LinkedHashSet hinges on this |
| Mention the iterate-smaller-probe-larger trick | One of the most common follow-up questions |
| State `equals`/`hashCode` invariant unprompted | Signals senior-level awareness |
| Pre-size your set when input size is known | Free O(1) optimization; small but appreciated |
| Mention thread-safety briefly even if not asked | Shows you think about real systems |

---

## Common Wrong Answers (and Why They Fail)

| Wrong answer | Reason it fails |
|---|---|
| "HashSet `contains` is always O(1)" | It's amortized expected; worst case is O(n) with bad hash or adversarial input |
| "Two equal objects always have equal hashes by default" | Only if you override `hashCode` consistently with `equals` |
| "Python `set` preserves insertion order" | Python `dict` does (since 3.7); `set` does not promise any order |
| "Use `List.contains` for membership" | O(n) per call vs O(1) for a HashSet — disastrous in a loop |
| "Convert to set for any deduplication" | Loses original order; loses duplicates that may matter (multiset) |
| "Just iterate both sets to intersect" | O(|A| · |B|) when O(min(|A|, |B|)) is achievable |
| "Bloom filter replaces a HashSet" | Bloom filter cannot enumerate members or guarantee zero false positives |
| "TreeSet is slower than HashSet, so never use it" | Range queries and sorted iteration are O(log n) on TreeSet, O(n log n) via HashSet |

---

## Quick-Recall Set Identities (Often Asked)

```text
|A ∪ B|  =  |A| + |B| - |A ∩ B|                          (inclusion-exclusion)
|A △ B|  =  |A ∪ B| - |A ∩ B|  =  |A| + |B| - 2|A ∩ B|
A \ B    =  A ∩ B^c                                       (de Morgan)
(A ∪ B)^c =  A^c ∩ B^c                                    (de Morgan)
A ⊆ B    ↔  A ∩ B = A   ↔   A ∪ B = B
A and B disjoint ↔  A ∩ B = ∅   ↔   |A ∪ B| = |A| + |B|
```

These show up in subtle whiteboard problems — "count elements seen exactly once across two streams" reduces to `|A △ B|`, which can be computed in one pass with a single counter using inclusion-exclusion.
