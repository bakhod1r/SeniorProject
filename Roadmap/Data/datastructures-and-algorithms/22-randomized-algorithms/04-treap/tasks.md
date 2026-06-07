# Treap (Tree + Heap) — Practice Tasks

> **Audience:** Self-study. Each task is a self-contained exercise with a precise specification, hints on the intended approach, and (for several) a reference solution in Go, Java, or Python. All tasks must ultimately be solved in **Go**, **Java**, and **Python**. The tasks build on each other; do them in order. By the end you should be able to write a split/merge treap, an order-statistics treap, and an implicit treap from scratch in minutes.

The throughline is the same two-primitive discipline emphasized in `middle.md`: build everything from `split` and `merge`, keep `size` (and any aggregate) consistent via a single `update()`, and verify against a trivial reference structure with a fuzz test.

---

## Beginner Tasks

### Task 1 — Treap node and rotation-based insert

**Spec.** Define a treap `Node` with `key`, random `priority`, and two child pointers. Implement `rotateLeft`, `rotateRight`, and a recursive `insert(root, key)` that attaches the key as a BST leaf and bubbles it up with rotations to restore the max-heap property. Duplicates are ignored.

**Hints.** Use the "return the new subtree root" idiom: `root.left = insert(root.left, key)`, then `if root.left.priority > root.priority { root = rotateRight(root) }`. Set the priority once at creation from a seeded RNG.

**Constraints.** Expected `O(log n)` per insert. Test that inserting `1..1000` in sorted order yields a height near `log₂(1000) ≈ 10`, not `1000`.

**Reference (Python):**
```python
import random

class Node:
    __slots__ = ("key", "priority", "left", "right")
    def __init__(self, key):
        self.key = key
        self.priority = random.random()
        self.left = self.right = None

def rotate_right(p):
    l = p.left; p.left = l.right; l.right = p; return l

def rotate_left(p):
    r = p.right; p.right = r.left; r.left = p; return r

def insert(root, key):
    if root is None:
        return Node(key)
    if key < root.key:
        root.left = insert(root.left, key)
        if root.left.priority > root.priority:
            root = rotate_right(root)
    elif key > root.key:
        root.right = insert(root.right, key)
        if root.right.priority > root.priority:
            root = rotate_left(root)
    return root
```

### Task 2 — Verify the dual invariant

**Spec.** Write `check(root)` that returns `True` iff the tree is simultaneously a valid BST on keys and a valid max-heap on priorities. Use it after every operation in your tests.

**Hints.** One clean approach: do an inorder traversal collecting `(key, priority)` and assert keys are strictly increasing; separately, recursively assert each node's priority `≥` each child's priority. Or fuse both into one recursive check passing `(minKey, maxKey)` bounds and the parent priority.

**Constraints.** `O(n)`. This is your safety net for every later task — make it solid.

### Task 3 — Search and inorder

**Spec.** Implement iterative `search(root, key)` (return the node or null) and recursive `inorder(root)` returning keys in sorted order. Confirm `search` ignores priority entirely.

**Hints.** Search is identical to a plain BST. Inorder of any treap is sorted because it is a BST on keys.

**Constraints.** Search `O(log n)` expected; inorder `O(n)`.

### Task 4 — `merge` two ordered treaps

**Spec.** Implement `merge(l, r)` assuming **every key in `l` < every key in `r`**. The root of the result is whichever input root has the higher priority.

**Hints.** If `l.priority > r.priority`, keep `l` as root and set `l.right = merge(l.right, r)`; else keep `r` and set `r.left = merge(l, r.left)`.

**Constraints.** `O(log n)` expected. Test: build a treap from `1..50`, split off `1..25` and `26..50` by hand (or via Task 5), merge them back, and confirm inorder is `1..50`.

**Reference (Go):**
```go
func merge(l, r *Node) *Node {
	if l == nil {
		return r
	}
	if r == nil {
		return l
	}
	if l.priority > r.priority {
		l.right = merge(l.right, r)
		return l
	}
	r.left = merge(l, r.left)
	return r
}
```

### Task 5 — `split` a treap by key

**Spec.** Implement `split(t, x)` returning `(l, r)` with `l` = keys `< x` and `r` = keys `≥ x`. Then reimplement `insert` and `delete` purely via `split`/`merge` (no rotations).

**Hints.** Insert: `split(t, k) → (l, r)`; `merge(merge(l, Node(k)), r)`. Delete: `split(t, k) → (l, midR)`; `split(midR, k+1) → (_, r)`; `merge(l, r)`. For the cleanest delete, find the node and replace it with `merge(left, right)`.

**Constraints.** `O(log n)` expected. Fuzz-test `insert`/`delete` against a language `set`/`TreeSet` for 5000 random ops.

---

## Intermediate Tasks

### Task 6 — Order statistics: `size`, `kth`, `rank`

**Spec.** Add a `size` field to each node, maintained by `update(n)` called at the end of every `split` and `merge`. Implement `kth(k)` (0-indexed k-th smallest) and `rank(key)` (count of keys `< key`).

**Hints.** `update`: `n.size = 1 + size(n.left) + size(n.right)`. `kth`: compare `k` to `size(left)`. `rank`: accumulate `size(left)+1` each time you step right.

**Constraints.** `O(log n)` each. This is the basis of the leaderboard service in `senior.md`.

**Reference (Java):**
```java
static int sz(Node n) { return n == null ? 0 : n.size; }
static Node update(Node n) {
    if (n != null) n.size = 1 + sz(n.left) + sz(n.right);
    return n;
}
Integer kth(int k) {
    Node n = root;
    while (n != null) {
        int ls = sz(n.left);
        if (k < ls) n = n.left;
        else if (k == ls) return n.key;
        else { k -= ls + 1; n = n.right; }
    }
    return null;
}
```

### Task 7 — Range extraction

**Spec.** Implement `extract(T, lo, hi)` that removes all keys in `[lo, hi]` from `T`, returns them as their own treap `M`, and leaves `T` holding the rest. Provide a `reinsert` that merges `M` back.

**Hints.** `(L, rest) = split(T, lo)`; `(M, R) = split(rest, hi+1)`; `T = merge(L, R)`. To reinsert: `merge(merge(L, M), R)` (you'll need to keep `L` and `R` or re-split).

**Constraints.** `O(log n)`. Verify the union of `M` and the remaining `T` equals the original key set.

### Task 8 — Implicit treap: positional array

**Spec.** Build an **implicit treap** with no key field: a node's logical index is its inorder position, derived from subtree sizes. Implement `insertAt(pos, value)`, `eraseAt(pos)`, and `get(pos)`.

**Hints.** Replace key-based `split` with `split_by_size(t, k)` (first `k` elements go left). `insertAt(pos, v)`: split at `pos`, merge `L + Node(v) + R`. `get(pos)`: descend comparing `pos` to `size(left)`.

**Constraints.** `O(log n)` per op. Test against a Python list / Java `ArrayList` for 3000 random insert/erase/get operations.

**Reference (Python `split_by_size`):**
```python
def split_by_size(t, k):
    """L gets the first k elements; R gets the rest."""
    if t is None:
        return None, None
    left_size = t.left.size if t.left else 0
    if left_size < k:
        l, r = split_by_size(t.right, k - left_size - 1)
        t.right = l
        return update(t), r
    else:
        l, r = split_by_size(t.left, k)
        t.left = r
        return l, update(t)
```

### Task 9 — Range reverse with lazy propagation

**Spec.** Extend the implicit treap with a lazy `reversed` flag and a `push(t)` that materializes a pending flip. Implement `reverse(l, r)` that reverses the subarray `[l, r]` in `O(log n)`.

**Hints.** `push`: if `t.reversed`, swap `t.left`/`t.right`, toggle the flag on both children, clear it on `t`. Call `push` at the start of every `split_by_size` and `merge`. `reverse(l, r)`: split out `[l, r]`, toggle its root's flag, merge back.

**Constraints.** `O(log n)`. Test: reverse random ranges and compare to a Python list with slice reversal.

### Task 10 — Range sum query on the implicit treap

**Spec.** Add a `subtree_sum` aggregate (sum of stored values) maintained in `update()`. Implement `rangeSum(l, r)` returning the sum of values in positions `[l, r]` in `O(log n)`. Combine it with Task 9's reverse to confirm reverse does not change a range's sum.

**Hints.** `update`: `t.subtree_sum = t.value + sum(left) + sum(right)`. `rangeSum`: split out `[l, r]`, read its root's `subtree_sum`, merge back. Remember to `push` before reading children.

**Constraints.** `O(log n)`. Verify against a brute-force `sum(arr[l:r+1])`.

---

## Advanced Tasks

### Task 11 — Persistent (immutable) treap

**Spec.** Make `split` and `merge` **non-mutating**: each allocates a new node where it would have written to an existing one, sharing untouched subtrees. Maintain a list of root versions; implement `getVersion(v)` so old snapshots remain queryable forever.

**Hints.** In `split`/`merge`, construct `Node(t.key, t.priority, newLeft, newRight)` instead of mutating `t`. Each `insert`/`erase` returns a new root; push it onto a versions array. Verify that querying an old version yields the keys present at that version.

**Constraints.** `O(log n)` new nodes per update; old versions immutable. This powers MVCC snapshots and undo/redo (`senior.md` §5).

### Task 12 — Fast set union / intersection / difference

**Spec.** Implement `union(A, B)`, `intersection(A, B)`, and `difference(A, B)` on treaps using recursive split/merge.

**Hints.** `union`: pick the higher-priority root (say `A`'s), `split(B, A.key)` into `(Bl, Br)`, recurse `A.left = union(A.left, Bl)`, `A.right = union(A.right, Br)`, drop the duplicate key. Intersection/difference follow the same split-recurse shape but keep/drop the root based on whether it appears in both.

**Constraints.** Expected `O(m log(n/m + 1))` for `|A| = m ≤ |B| = n`. Verify against language set operations on random inputs.

### Task 13 — Concurrent copy-on-write treap

**Spec.** Wrap a persistent treap (Task 11) in a structure with an atomic root pointer. Writers build a new immutable version off the current root and atomically swap it in (serialize writers with a mutex); readers atomically load the root and traverse lock-free.

**Hints.** Go: `atomic.Pointer[Node]` for the root, `sync.Mutex` guarding writers. Java: `AtomicReference<Node>`. Verify with many concurrent reader goroutines/threads while a single writer mutates — readers must never see a torn or inconsistent tree.

**Constraints.** Lock-free reads, serialized writers. Stress-test for data races (`go test -race`, Java thread sanitizer, or repeated runs).

### Task 14 — `O(n)` build from a sorted array (Cartesian-tree build)

**Spec.** Given a sorted array of keys with assigned random priorities, build the treap in `O(n)` (not `O(n log n)`), using the monotonic-stack Cartesian-tree construction.

**Hints.** Process keys left to right maintaining a stack representing the right spine. For each new node, pop while the stack top has lower priority; the last popped becomes the new node's left child; attach the new node as the right child of the new stack top. This is the Cartesian-tree build — exactly a treap when priorities are random.

**Constraints.** `O(n)` total. Verify the result satisfies the dual invariant (Task 2) and that inorder equals the input order.

### Task 15 — Range-add lazy update + min query

**Spec.** Extend the implicit treap with a second lazy flag: `rangeAdd(l, r, delta)` adds `delta` to every element in `[l, r]` in `O(log n)`, and `rangeMin(l, r)` returns the minimum in `[l, r]`. Both lazy flags (reverse from Task 9 and add) must coexist correctly.

**Hints.** Store `subtree_min` plus a pending `add` per node. `push` applies the pending add to the node's stored value and `subtree_min`, then propagates `add` to children's pending fields. Order matters: apply/clear all lazy flags in `push` before touching children. `update` recomputes `subtree_min` from children plus the node's own (already-applied) value.

**Constraints.** `O(log n)` per op. Verify against a brute-force array with linear range-add and range-min.

---

## Benchmark Task

> Compare treap performance across all 3 languages: build a treap of `n` random keys, then perform `n` random `search` operations, timing each phase.

### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, n := range sizes {
		t := &Treap{} // your split/merge treap with Insert + Contains
		keys := rand.Perm(n)
		start := time.Now()
		for _, k := range keys {
			t.Insert(k)
		}
		buildMs := float64(time.Since(start).Microseconds()) / 1000.0
		start = time.Now()
		for i := 0; i < n; i++ {
			t.Contains(rand.Intn(n))
		}
		searchMs := float64(time.Since(start).Microseconds()) / 1000.0
		fmt.Printf("n=%8d  build=%9.2f ms  search=%9.2f ms\n", n, buildMs, searchMs)
	}
}
```

### Java

```java
import java.util.*;

public class TreapBenchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        Random rng = new Random();
        for (int n : sizes) {
            TreapChallenge t = new TreapChallenge(); // Insert + contains
            List<Integer> keys = new ArrayList<>();
            for (int i = 0; i < n; i++) keys.add(i);
            Collections.shuffle(keys, rng);
            long s = System.nanoTime();
            for (int k : keys) t.insert(k);
            double buildMs = (System.nanoTime() - s) / 1e6;
            s = System.nanoTime();
            for (int i = 0; i < n; i++) t.contains(rng.nextInt(n));
            double searchMs = (System.nanoTime() - s) / 1e6;
            System.out.printf("n=%8d  build=%9.2f ms  search=%9.2f ms%n", n, buildMs, searchMs);
        }
    }
}
```

### Python

```python
import random, time

def main():
    for n in (1000, 10000, 100000):   # Python: keep n modest (recursion + interpreter)
        t = Treap()                   # your split/merge treap with insert + contains
        keys = list(range(n))
        random.shuffle(keys)
        s = time.perf_counter()
        for k in keys:
            t.insert(k)
        build_ms = (time.perf_counter() - s) * 1000
        s = time.perf_counter()
        for _ in range(n):
            t.contains(random.randrange(n))
        search_ms = (time.perf_counter() - s) * 1000
        print(f"n={n:>8}  build={build_ms:9.2f} ms  search={search_ms:9.2f} ms")

if __name__ == "__main__":
    main()
```

**What to observe.** Build and search times should grow roughly like `n log n` (total) — each operation `O(log n)`. Go and Java will be far faster than Python; Python's recursion depth limit and interpreter overhead make very large `n` impractical (raise the recursion limit or use iterative split/merge for the largest sizes). Plot `time / n` against `log n` to see the per-operation logarithmic factor flatten out.
