# Skip List — Interview Preparation

> **Audience:** Engineers preparing for technical interviews covering the skip list — from "what is it" screening questions up to systems-design and probabilistic-analysis depth. Prerequisite: `junior.md` through `professional.md`. Below are 50 tiered questions with model answers, followed by a full coding challenge in Go, Java, and Python.

---

## Table of Contents

1. [Junior Questions (1–16)](#junior)
2. [Middle Questions (17–30)](#middle)
3. [Senior Questions (31–43)](#senior)
4. [Professional Questions (44–50)](#professional)
5. [Coding Challenge — Design Skiplist](#challenge)
6. [Debugging Recap — The Five Bugs Interviewers Probe](#debugging)

---

<a name="junior"></a>
## Junior Questions

**Q1. What is a skip list?**
A sorted, multi-level linked list. The bottom level is an ordinary sorted linked list of all elements; higher levels are sparser "express lanes" that let a search skip over many nodes. It gives expected O(log n) search, insert, and delete without the rotations a balanced tree needs.

**Q2. How does search work?**
Start at the head at the top level. At each level, move right while the next node's key is strictly less than the target. When the next node would be ≥ target (or null), drop down one level and repeat. After the bottom level, take one step in the base list and check whether that node equals the target. Mnemonic: **move right, drop down**.

**Q3. Why is search O(log n)?**
Each higher level contains roughly half (for p=1/2) the nodes of the one below, so there are about log₂ n levels, and you take only a constant number of right-moves per level before dropping. Constant work × logarithmically many levels = O(log n) expected.

**Q4. How is a node's height decided?**
By repeated coin flips at insert time. Start at height 1; while a coin (success prob p) comes up "promote," increase the height. Height k occurs with probability p^{k-1}(1-p) — a geometric distribution. No global rebalancing; each node flips independently.

**Q5. What does the `forward` array hold?**
For a node of height h, `forward[0..h-1]` are its next-pointers, one per level it occupies. `forward[0]` is its successor in the base list; `forward[i]` is its successor in lane i. A height-1 node (half of them, for p=1/2) has only `forward[0]`.

**Q6. What is the head sentinel and why use it?**
A special left-boundary node of maximum level holding `-∞`. Every search starts there. It eliminates edge cases: empty lists, inserting before the first element, and per-lane entry pointers all "just work" because the head is always a valid predecessor.

**Q7. What is the time complexity of insert and delete?**
Both O(log n) expected: the same descent as search to find the position (recording predecessors), then O(height) pointer splicing. No rotations.

**Q8. Is a skip list sorted?**
Yes. Walking `forward[0]` from the head yields all elements in sorted order in O(n). That makes range queries and ordered iteration cheap.

**Q9. What's the worst-case complexity?**
O(n) — if the coin flips were pathologically unlucky (e.g., everything height 1, degenerating to a plain linked list). It is astronomically improbable; in practice the skip list behaves like O(log n).

**Q10. Skip list vs sorted array — when use which?**
Sorted array: static data, search-only, best cache locality, O(1) index access — but O(n) insert/delete. Skip list: frequent inserts/deletes with sorted order, expected O(log n) mutation. Use the array when data rarely changes; the skip list when it changes often.

**Q11. What is the `update` array used for?**
During an insert or delete descent, `update[i]` records the last node at level i before the operation position — the predecessor whose `forward[i]` must be rewired. It is captured in the same single descent used for search.

**Q12. How do you handle duplicates?**
Decide a policy: set (ignore equal keys — detect via `forward[0].value == target`), multiset (allow them), or map (update the payload). The choice must be explicit; silent duplicate insertion is a common bug.

**Q13. What is `maxLevel` and how do you choose it?**
A cap on node height. Choose `maxLevel ≈ log₁/ₚ(expected max n)` — e.g., 16 for ~65k elements at p=1/2, or 32 (Redis) for up to 4³². It bounds per-node memory and prevents runaway towers.

**Q14. Why strictly `<` (not `<=`) in the search loop?**
Moving right only while the next key is strictly less guarantees you stop at the predecessor of the target. With `<=` you would step past the target, breaking the found-check and splicing inserts in the wrong place.

**Q15. Why size a node's `forward` array to its rolled level, not to `maxLevel`?**
A node only participates in the levels it was promoted to. Allocating `maxLevel` pointers for every node wastes memory — most nodes (half, at p=1/2) are height 1 and need exactly one pointer. Size `forward` to the height to keep expected space at ~`n/(1-p)`.

**Q16. Does a skip list store elements more than once?**
No. Each element is stored in exactly one node. A node simply appears in multiple *levels* via its multiple forward pointers — the higher-level lanes are an index over the same nodes, not copies. The base list holds every element once.

---

<a name="middle"></a>
## Middle Questions

**Q17. Derive the expected number of pointers per node.**
Node height is geometric: P(height=k) = p^{k-1}(1-p). Its mean is 1/(1-p). So expected forward pointers per node = 1/(1-p): 2 for p=1/2, 1.33 for p=1/4. Total pointer space ≈ n/(1-p) = O(n).

**Q18. Why does Redis use p = 1/4 instead of 1/2?**
Memory. At p=1/4 each node averages 1.33 pointers vs 2 at p=1/2 — a 33% reduction, significant for sorted sets with tens of millions of members. The cost is slightly more horizontal scanning per level, but those right-moves stay in a cache-resident region, so the net is favorable at scale.

**Q19. What does p control, and does it affect correctness?**
p is the promotion probability — the space–time knob. Higher p → taller nodes → more memory but fewer horizontal steps; lower p → sparser → less memory, more scanning. It affects only constant factors of time and space, **never correctness**. You can change p by editing only `randomLevel`.

**Q20. Explain the intuition behind expected O(log n) search.**
Trace the path backward from the found node to the head. Each backward step is "up" (prob p) or "left" (prob q=1-p). To climb the ≈log₁/ₚ n levels you need that many "up" successes, each taking ~1/p trials, and ~q/p left-moves per level. Total expected steps ≈ (1/p)·log₁/ₚ n = O(log n).

**Q21. Skip list vs balanced BST — trade-offs?**
Same expected O(log n). BST gives a *worst-case* guarantee via rotations/recoloring (complex code). Skip list gives an *expected* guarantee via coin flips (simple code) and is far easier to make concurrent. Choose BST for hard worst-case needs or an existing library map; choose skip list for simplicity and concurrency.

**Q22. Skip list vs treap?**
Both randomized, both abandon worst-case for simplicity, nearly identical expected complexity. Skip list: rotation-free, easier concurrency. Treap: a binary tree with random priorities, supports elegant O(log n) split/merge. Pick the treap for split/merge or sequence operations; the skip list for concurrent ordered maps and LSM memtables.

**Q23. How do you make a skip list answer "k-th element" in O(log n)?**
Add a **span** to each forward pointer = number of base nodes it skips. During descent, accumulate spans; when accumulated rank reaches k you've found the element. This **indexable skip list** is how Redis does `ZRANK`/`ZRANGE`. Insert/delete must maintain spans (splice splits a span; unlink merges two).

**Q24. How do range queries work?**
Descend to the first node ≥ lo (O(log n)), then walk `forward[0]` collecting nodes until you exceed hi (O(k) for k results). Total O(log n + k). This is `ZRANGEBYSCORE` in Redis.

**Q25. How do you get predecessor / reverse iteration efficiently?**
Successor is just `node.forward[0]` (O(1)). Predecessor needs either a fresh O(log n) search or a **backward pointer** at level 0 — making the base list doubly linked. Redis adds exactly this for `ZREVRANGE`.

**Q26. When inserting, the rolled level exceeds the current list level. What must you do?**
Set `update[i] = head` for each new level above the old top, and raise the list's `level`. Otherwise the tall part of the new node is never linked from the top and is invisible to searches that start high.

**Q27. Why must you shrink `level` after deletes?**
If the tallest node is deleted, top lanes become empty but searches still start there, wasting steps. Shrinking `level` while `head.forward[level-1]` is null keeps searches starting at the right height. It's a performance, not correctness, concern.

**Q28. How do you test a skip list?**
Apply the same random sequence of insert/delete/search to the skip list and to a trusted reference (a `TreeSet`/sorted list). After each op, assert identical membership and ordered contents. For an indexable variant, also verify `select(k)` against the sorted reference. Use a fixed RNG seed for reproducibility.

**Q29. What is the geometric distribution's role here?**
It is the distribution of node heights: P(height=k) = p^{k-1}(1-p). It gives mean height 1/(1-p), ≈n·p^i nodes at level i, and ≈log₁/ₚ n levels — the three facts that yield the O(log n) and O(n) results.

**Q30. Could an adversary force worst-case behavior?**
If they can predict your level-assignment RNG (fixed seed, low entropy), they can craft an insertion order forcing tall towers and O(n) operations — a DoS vector. Mitigate with a well-seeded, per-instance RNG that isn't observable to clients.

---

<a name="senior"></a>
## Senior Questions

**Q31. Why do Redis, Java, and LevelDB all use skip lists?**
The shared reason is **local, pointer-only mutations**. Locality enables simple range queries (Redis), CAS-based lock-free concurrency (Java `ConcurrentSkipListMap`), and lock-free reads under a single writer (LevelDB memtable). A balanced tree's rotations propagate toward the root, killing all three benefits.

**Q32. Describe the Redis ZSET internal design.**
A dual index: a **hash dict** (member→score) for O(1) `ZSCORE`, plus a **skip list** (ordered by score, ties by member) for O(log n) ordered/range/rank queries. The skip list has span counters (for rank) and a level-0 backward pointer (for reverse iteration). p=1/4, max level 32. Small sets (≤128 entries) use a flat **listpack** instead.

**Q33. Why is a skip list easier to make concurrent than a balanced tree?**
Mutations touch only a few pointers near one node, so concurrent operations on different regions rarely conflict and conflicts resolve via per-pointer CAS. A balanced tree's rotations can reach the root, serializing concurrent inserts. Lock-free balanced trees are research-hard; lock-free skip lists are shipped (the JDK).

**Q34. How does lock-free deletion work safely?**
Two phases (Harris): first **CAS-mark** the node's forward pointer (logical delete), then **CAS** the predecessor past it (physical unlink). The marking invariant — a marked pointer is immutable — makes any concurrent insert-after-this-node CAS fail, forcing a retry against the live predecessor. Other threads **help** complete the unlink. This prevents linking a new node off a removed one.

**Q35. How does the LevelDB memtable get lock-free reads?**
It is insert-only (deletes are tombstone inserts; real removal happens at compaction) and single-writer/many-reader. The writer publishes a new node by storing `forward[0]` **last with a release barrier**; readers use acquire loads. A reader sees a fully linked node or none at all — never a torn one — so no read locks are needed.

**Q36. What is the memory cost and how do you reduce it?**
≈1/(1-p) pointers per node (2 at p=1/2, 1.33 at p=1/4), so ~n/(1-p) pointers total plus payload. Reduce with lower p (Redis), inline values (avoid extra dereference), arena allocation (LevelDB), or blocked/unrolled nodes (multiple keys per node).

**Q37. What's the skip list's biggest weakness in production?**
**Cache behavior.** Pointer-chasing causes a cache miss per level hop; contiguous structures (sorted array, B+-tree) stream through cache far better. On read-mostly, cache-bound workloads a B+-tree wins. The skip list earns its place on write-heavy or concurrent workloads, not cache-bound read ones.

**Q38. How do you size `maxLevel` for a memtable?**
≈ log₁/ₚ(max entries before flush). LevelDB uses 12 with branching factor 4 (p=1/4), supporting ≈4¹² ≈ 16M entries — well above a typical memtable. Too small and towers pile at the top, degrading search; too large wastes a little memory.

**Q39. Why does Redis fall back to a listpack for small sorted sets?**
For tiny n, the skip list's per-node pointer overhead and allocation cost outweigh its asymptotic benefit. A flat listpack is more memory-efficient and more cache-friendly, and O(n) operations on ≤128 entries are trivially fast. Redis promotes to dict+skiplist once size/element-length thresholds are crossed.

**Q40. What observability would you add around a hot skip list?**
Current list height (should track log₁/ₚ n), p99 search steps (detects degradation), node count and memory (capacity/eviction), and for lock-free versions, CAS-failure and retry rates (contention hot spots). For an LSM memtable, flush frequency and write-stall events.

**Q41. Memory reclamation in a lock-free skip list — what's the catch?**
A physically unlinked node may still be referenced by another in-flight thread, so freeing it immediately risks use-after-free. Production uses epoch-based reclamation, hazard pointers, or a tracing GC (the JVM for `ConcurrentSkipListMap`) to defer freeing until no thread can observe the node.

**Q42. You need a sorted set with O(1) point lookup and O(log n) rank. Sketch it.**
The Redis ZSET dual-index: a hash map (member → score) for O(1) `contains`/`score`, plus a span-annotated skip list (ordered by `(score, member)`) for O(log n) `rank`/`range`/`top-K`. Every write updates both in sync; tie-break equal scores by member for a total order. For tiny sets, a flat array beats both. This is the canonical "best of both worlds" answer.

**Q43. Would you choose a skip list or a B+-tree for a read-mostly on-disk index?**
B+-tree. On-disk and read-mostly means cache/IO locality dominates, and the B+-tree's high fan-out and contiguous pages give far fewer block transfers (`O(log_B n)` vs the skip list's pointer-chasing `O(log n)` misses). The skip list wins for *in-memory*, *write-heavy*, or *concurrent* indexes — not cache-bound disk reads. Naming this trade-off out loud is the senior signal.

---

<a name="professional"></a>
## Professional Questions

**Q44. Prove the expected maximum level is O(log n).**
The expected count at level i is E[Nᵢ]=n·p^i, which is ≤1 when i≥L*=log₁/ₚ n. Pr[Lₘₐₓ > L*+j] ≤ E[N_{L*+j}] = n·p^{L*+j} = p^j (since n·p^{L*}=1). Then E[Lₘₐₓ] ≤ L* + Σ_{j≥0} p^j = L* + 1/(1-p) = O(log n).

**Q45. Give the high-probability bound on list height.**
For c>1, Pr[Lₘₐₓ > c·log₁/ₚ n] ≤ p^{(c-1)log₁/ₚ n} = (1/n)^{c-1} = n^{-(c-1)}. So for c=3 the list exceeds 3·log₁/ₚ n levels with prob ≤ 1/n² — negligible.

**Q46. Outline the expected-O(log n) search proof.**
Reverse the search path. Each backward step is "up" with prob p or "left" with prob 1-p, independently (heights are i.i.d. and independent of position). Climbing L=O(log₁/ₚ n) levels needs ≈L/p steps in expectation (1/p trials per up-move). Total E[cost] = (1/p)·log₁/ₚ n + O(1) = O(log n).

**Q47. Why is correctness independent of the randomness?**
Correctness rests only on invariants I1 (each lane sorted) and I2 (each lane is a subset of the lane below). The search invariant J — current node has key < target and nothing skipped — is maintained by these structural facts regardless of node heights. The heights affect only how many steps the search takes (cost), never which element it returns.

**Q48. Derive the expected space.**
Each node contributes H(v) pointers with E[H(v)]=1/(1-p). By linearity, E[total pointers] = n/(1-p) = Θ(n). Variance is O(n), so by Chebyshev space concentrates tightly around n/(1-p) — Θ(n) with high probability, not just in expectation.

**Q49. Define the linearization points of the concurrent operations.**
search: the atomic read of `forward[0]` yielding the candidate. insert: the successful CAS linking the new node at **level 0** (higher links are just index hints). delete: the successful CAS that **marks** the target's forward pointer (logical delete). The base list L₀ is authoritative; higher levels accelerate but never hold elements L₀ lacks, so these points give a linearizable history.

**Q50. Argue the concurrent skip list is lock-free but not wait-free.**
A CAS fails only when another thread succeeded on the same pointer — so every failure witnesses global progress; the system never stalls (lock-free). But an individual thread can be repeatedly beaten on its CAS and starved indefinitely, so no per-thread step bound exists (not wait-free). No locks are held, so a suspended thread never blocks others.

---

<a name="challenge"></a>
## Coding Challenge — Design Skiplist (LeetCode 1206)

> **Problem.** Implement a `Skiplist` class with three methods, each expected O(log n):
> - `search(target) -> bool`: is `target` in the skip list?
> - `add(num)`: insert `num` (duplicates allowed — this is a multiset).
> - `erase(num) -> bool`: remove one occurrence of `num`; return whether it was present.
>
> Constraints: `0 <= num, target <= 2·10⁴`; up to `5·10⁴` calls. Use randomized levels (do **not** hardcode a balanced structure).

The challenge below uses the classic head-sentinel + `update`-array design. Note the **multiset** semantics: `add` does *not* dedupe, and `erase` removes only one node. The search/insert loop uses strict `<`; for `erase` we then check `forward[0].value == num`.

### Go

```go
package main

import (
    "fmt"
    "math/rand"
)

const (
    skMaxLevel = 16
    skP        = 0.5
)

type skNode struct {
    val     int
    forward []*skNode
}

type Skiplist struct {
    head  *skNode
    level int
}

func Constructor() Skiplist {
    return Skiplist{
        head:  &skNode{val: -1, forward: make([]*skNode, skMaxLevel)},
        level: 1,
    }
}

func skRandomLevel() int {
    lvl := 1
    for rand.Float64() < skP && lvl < skMaxLevel {
        lvl++
    }
    return lvl
}

func (s *Skiplist) Search(target int) bool {
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.forward[i] != nil && x.forward[i].val < target {
            x = x.forward[i]
        }
    }
    x = x.forward[0]
    return x != nil && x.val == target
}

func (s *Skiplist) Add(num int) {
    update := make([]*skNode, skMaxLevel)
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.forward[i] != nil && x.forward[i].val < num {
            x = x.forward[i]
        }
        update[i] = x
    }
    lvl := skRandomLevel()
    if lvl > s.level {
        for i := s.level; i < lvl; i++ {
            update[i] = s.head
        }
        s.level = lvl
    }
    n := &skNode{val: num, forward: make([]*skNode, lvl)}
    for i := 0; i < lvl; i++ {
        n.forward[i] = update[i].forward[i]
        update[i].forward[i] = n
    }
}

func (s *Skiplist) Erase(num int) bool {
    update := make([]*skNode, skMaxLevel)
    x := s.head
    for i := s.level - 1; i >= 0; i-- {
        for x.forward[i] != nil && x.forward[i].val < num {
            x = x.forward[i]
        }
        update[i] = x
    }
    target := x.forward[0]
    if target == nil || target.val != num {
        return false
    }
    for i := 0; i < s.level; i++ {
        if update[i].forward[i] != target {
            break
        }
        update[i].forward[i] = target.forward[i]
    }
    for s.level > 1 && s.head.forward[s.level-1] == nil {
        s.level--
    }
    return true
}

func main() {
    sl := Constructor()
    sl.Add(1)
    sl.Add(2)
    sl.Add(3)
    fmt.Println(sl.Search(0)) // false
    sl.Add(4)
    fmt.Println(sl.Search(1)) // true
    fmt.Println(sl.Erase(0))  // false
    fmt.Println(sl.Erase(1))  // true
    fmt.Println(sl.Search(1)) // false
}
```

### Java

```java
import java.util.Random;

class Skiplist {
    private static final int MAX_LEVEL = 16;
    private static final double P = 0.5;
    private final Random rng = new Random();

    private static final class Node {
        final int val;
        final Node[] forward;
        Node(int val, int height) {
            this.val = val;
            this.forward = new Node[height];
        }
    }

    private final Node head = new Node(-1, MAX_LEVEL);
    private int level = 1;

    public Skiplist() {}

    private int randomLevel() {
        int lvl = 1;
        while (rng.nextDouble() < P && lvl < MAX_LEVEL) lvl++;
        return lvl;
    }

    public boolean search(int target) {
        Node x = head;
        for (int i = level - 1; i >= 0; i--) {
            while (x.forward[i] != null && x.forward[i].val < target) {
                x = x.forward[i];
            }
        }
        x = x.forward[0];
        return x != null && x.val == target;
    }

    public void add(int num) {
        Node[] update = new Node[MAX_LEVEL];
        Node x = head;
        for (int i = level - 1; i >= 0; i--) {
            while (x.forward[i] != null && x.forward[i].val < num) {
                x = x.forward[i];
            }
            update[i] = x;
        }
        int lvl = randomLevel();
        if (lvl > level) {
            for (int i = level; i < lvl; i++) update[i] = head;
            level = lvl;
        }
        Node n = new Node(num, lvl);
        for (int i = 0; i < lvl; i++) {
            n.forward[i] = update[i].forward[i];
            update[i].forward[i] = n;
        }
    }

    public boolean erase(int num) {
        Node[] update = new Node[MAX_LEVEL];
        Node x = head;
        for (int i = level - 1; i >= 0; i--) {
            while (x.forward[i] != null && x.forward[i].val < num) {
                x = x.forward[i];
            }
            update[i] = x;
        }
        Node target = x.forward[0];
        if (target == null || target.val != num) return false;
        for (int i = 0; i < level; i++) {
            if (update[i].forward[i] != target) break;
            update[i].forward[i] = target.forward[i];
        }
        while (level > 1 && head.forward[level - 1] == null) level--;
        return true;
    }
}
```

### Python

```python
import random


class _Node:
    __slots__ = ("val", "forward")

    def __init__(self, val, height):
        self.val = val
        self.forward = [None] * height


class Skiplist:
    MAX_LEVEL = 16
    P = 0.5

    def __init__(self):
        self.head = _Node(-1, self.MAX_LEVEL)
        self.level = 1

    def _random_level(self):
        lvl = 1
        while random.random() < self.P and lvl < self.MAX_LEVEL:
            lvl += 1
        return lvl

    def search(self, target: int) -> bool:
        x = self.head
        for i in range(self.level - 1, -1, -1):
            while x.forward[i] is not None and x.forward[i].val < target:
                x = x.forward[i]
        x = x.forward[0]
        return x is not None and x.val == target

    def add(self, num: int) -> None:
        update = [None] * self.MAX_LEVEL
        x = self.head
        for i in range(self.level - 1, -1, -1):
            while x.forward[i] is not None and x.forward[i].val < num:
                x = x.forward[i]
            update[i] = x
        lvl = self._random_level()
        if lvl > self.level:
            for i in range(self.level, lvl):
                update[i] = self.head
            self.level = lvl
        node = _Node(num, lvl)
        for i in range(lvl):
            node.forward[i] = update[i].forward[i]
            update[i].forward[i] = node

    def erase(self, num: int) -> bool:
        update = [None] * self.MAX_LEVEL
        x = self.head
        for i in range(self.level - 1, -1, -1):
            while x.forward[i] is not None and x.forward[i].val < num:
                x = x.forward[i]
            update[i] = x
        target = x.forward[0]
        if target is None or target.val != num:
            return False
        for i in range(self.level):
            if update[i].forward[i] is not target:
                break
            update[i].forward[i] = target.forward[i]
        while self.level > 1 and self.head.forward[self.level - 1] is None:
            self.level -= 1
        return True


if __name__ == "__main__":
    sl = Skiplist()
    sl.add(1); sl.add(2); sl.add(3)
    print(sl.search(0))  # False
    sl.add(4)
    print(sl.search(1))  # True
    print(sl.erase(0))   # False
    print(sl.erase(1))   # True
    print(sl.search(1))  # False
```

**Follow-up the interviewer may ask:**
1. *"Make `add` a set instead of a multiset."* → add a duplicate check `if next != nil && next.val == num { return }` before rolling the level.
2. *"Support `searchRange(lo, hi)`."* → descend to first node ≥ lo, then walk `forward[0]` to hi: O(log n + k).
3. *"Add `getKth(k)` in O(log n)."* → store spans per forward pointer (indexable skip list); accumulate spans during descent.
4. *"Make it thread-safe."* → coarse RWMutex (simple) or Harris-style lock-free with mark-then-unlink deletion (scalable). Discuss linearization at the level-0 CAS.
5. *"Why randomized levels and not a deterministic skip list?"* → deterministic skip lists (1-2-3 skip list) exist and give worst-case O(log n), but are more complex; randomization buys simplicity at the cost of a high-probability (rather than guaranteed) bound.

---

<a name="debugging"></a>
## Debugging Recap — The Five Bugs Interviewers Probe

When you write a skip list live, interviewers watch for these five classic mistakes. Knowing them lets you self-correct out loud — which scores points.

**Bug 1 — `<=` instead of `<` in the descent.**
*Symptom:* `search` returns false for present keys; inserts land in the wrong spot. *Why:* `<=` steps *past* the target, so `forward[0]` after the descent is the node *after* the target, and the equality check fails. *Fix:* move right only while strictly `<`.

**Bug 2 — not raising `level` when the rolled height exceeds the list level.**
*Symptom:* a freshly inserted tall node is invisible to later searches that start at the top. *Why:* the new top lanes were never wired from the head. *Fix:* for each new level above the old top, set `update[i] = head` and raise `level` before splicing.

**Bug 3 — searching twice instead of recording `update[]`.**
*Symptom:* works, but O(2·log n) and easy to desync if the list changes between passes. *Why:* the candidate forgot that one descent yields both the search result *and* the predecessors. *Fix:* record `update[i]` during the single descent.

**Bug 4 — allocating `forward` of size `maxLevel` per node.**
*Symptom:* memory blows past the expected `~2n`. *Why:* every node carries `maxLevel` pointers regardless of its rolled height. *Fix:* size `forward` to the height.

**Bug 5 — forgetting to shrink `level` after deleting the tallest node.**
*Symptom:* searches keep starting at an empty top lane, slightly slower over time. *Why:* `level` was never decremented when the top lanes emptied. *Fix:* after delete, `while level > 1 and head.forward[level-1] == null: level--`.

| Bug | Class | Caught by |
|---|---|---|
| `<=` vs `<` | correctness | single insert + search test |
| no level raise | correctness | insert that rolls a new max height, then search it |
| double search | efficiency | code review / complexity question |
| oversized `forward` | memory | space measurement |
| no level shrink | performance | delete-all then time a search |

A strong candidate narrates: "I'll record the `update` array on the way down, use strict less-than, size `forward` to the rolled level, and remember to bump the list level if my coin flips exceed it." That sentence alone signals you have written one before.

**One more, frequently asked:** *"How would you test your skip list under time pressure?"* — Apply the same random op stream to your skip list and a language-provided ordered set (`TreeSet`, `sortedcontainers.SortedList`), asserting identical contents after each op. This **differential / model-based test** catches every one of the five bugs above in seconds, and it is the single highest-value thing to write after the implementation. Mention a fixed RNG seed so any failure reproduces. Interviewers love hearing "I'd diff against a reference" — it shows engineering maturity beyond just getting the happy path to compile.

---

**Next step:** [tasks.md](./tasks.md) — 15 graded implementation tasks (5 beginner, 5 intermediate, 5 advanced) plus a cross-language benchmark.
