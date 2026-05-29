# Jump Search — Interview Questions & Coding Challenges

> **Audience:** Anyone preparing for a software engineering interview at companies that ask DSA questions. Includes conceptual questions across levels and 7 coding challenges with full Go / Java / Python solutions.

Jump search is **not** the headline interview algorithm — binary search is. But knowing jump search demonstrates depth: it shows you understand **why** binary search is preferred, when it isn't, and the broader family of `O(√n)` block-based techniques. Interviewers love candidates who can answer "linear or binary?" with "actually, jump search applies here because..." when the context warrants it.

---

## Section A — Conceptual Questions

### Junior level

**Q1. What is jump search and what is its time complexity?**
A search algorithm for **sorted** arrays that proceeds in two phases: jump forward by fixed blocks of size `m = √n` until you overshoot the target, then linear-scan inside the located block. Time complexity is **O(√n)** worst case, O(1) space.

**Q2. Why is the optimal block size `√n` and not anything else?**
The worst-case cost is `n/m + m` (number of jumps + size of one block). By AM-GM, `n/m + m ≥ 2√n` with equality iff `m = √n`. Calculus: `d/dm (n/m + m) = -n/m² + 1 = 0` gives `m = √n`.

**Q3. Can jump search be used on unsorted data?**
No. Like binary search, jump search relies on sortedness to know the target's range after each comparison. Unsorted input gives wrong answers silently.

**Q4. What's the difference between jump search and linear search?**
Linear search compares every element from index 0; cost is O(n). Jump search compares **every m-th element**, then linear-scans the located block; cost is O(√n). Jump is exponentially faster but requires sorted data.

**Q5. What's the difference between jump search and binary search?**
Binary search halves the search space each step (O(log n)). Jump search reduces by a fixed amount (O(√n)). Binary needs random access in both directions; jump only needs forward random access. Binary is always faster on RAM arrays.

**Q6. How does jump search position in the algorithmic hierarchy?**
`linear O(n) ▶ jump O(√n) ▶ binary O(log n) ▶ hash O(1)`. Each step trades structural requirements for speed.

**Q7. When does jump search actually beat binary search?**
When backward seeks are expensive (magnetic tape, append-only logs), when working with singly-linked lists with skip pointers, or when forward sequential access is much cheaper than random access (paged storage). Almost never on in-RAM arrays.

### Middle level

**Q8. Walk through a hybrid jump-then-binary search and its complexity.**
Phase 1 is regular jump search to locate the block (O(√n)). Phase 2 is binary search inside the block (O(log √n) = O((1/2) log n)). Total is `O(√n + log n) = O(√n)` — same asymptotic class, smaller constant on the second phase. Useful when random access within a loaded block is cheap.

**Q9. How would you apply jump search to a singly-linked list?**
Augment the list with a **skip pointer array**: every √n-th node has a direct pointer to the corresponding node. Jump along the skip array (O(√n)), then walk the sublist linearly (O(√n)). Total O(√n). Space O(√n) for the skip pointers. This is the conceptual ancestor of skip lists.

**Q10. What's the relationship between jump search and exponential search?**
Jump search uses **fixed** stride `√n`. Exponential search uses **doubling** stride (1, 2, 4, 8, ...) followed by binary search in the located range. Exponential is **adaptive** — finds a target at position `k` in O(log k), independent of `n`. Use exponential for unbounded streams or front-biased targets; use jump for forward-only access where you need bounded backward seeks.

**Q11. What's sqrt decomposition and how does it relate to jump search?**
Split a mutable array into `√n` blocks, precompute an aggregate (sum, max, ...) per block. Range queries jump-scan full blocks (using the aggregate) and linear-scan partial blocks at the boundaries — total O(√n). Same block structure as jump search; same `√n` optimum from the same AM-GM argument.

**Q12. How does jump search handle duplicates?**
The first phase finds the block containing the target. The linear phase, written as "scan until `arr[i] >= target`", returns the leftmost occurrence — same as `lower_bound`. Combined with an existence check (`arr[i] == target`), it works exactly like `find_first` in binary search.

**Q13. Is jump search adaptive — does it run faster when the target is near index 0?**
**No.** Plain jump search is O(√n) worst case regardless of target position. Even for the target at index 0, you still do at least one comparison. For adaptive behavior, use exponential search.

### Senior level

**Q14. Where do real production systems use jump-search-like patterns?**
- **Cassandra** SSTable partition summary + linear scan inside index page.
- **RocksDB / LevelDB** restart-point index inside each block (binary at outer level, linear at inner).
- **Parquet / ORC** row-group statistics scan + page-level metadata + in-page linear scan with SIMD.
- **Kafka** log segments with sparse offset index (`index.interval.bytes`).
- **Prometheus** chunk metadata scan inside blocks.
- **BAM/BCF** genomic indexes (`.bai` chunks every 16 KB).

In all cases: coarse jump/linear at metadata level + one block fetch + scan inside.

**Q15. Why don't databases use jump search at the top level for B-tree node lookups?**
B-tree nodes are designed for cache-line alignment (4–16 KB pages with 100–1000 keys). Within one page, **binary search** is fast because all keys are already in cache. Jump search would add overhead with no benefit since the page is one cache fetch. At the **between-pages** level, B-trees use multiway branching, not jump search — each page choice already prunes by a factor of fanout (100–1000), achieving `log_fanout(n)` depth.

**Q16. What's the lower bound for forward-only sorted search?**
**Ω(√n)** comparisons. Proof via adversary argument: after `q` queries, the search space partitions into `q + 1` gaps; the largest has size ≥ (n - q)/(q + 1). In forward-only access, "passing over a gap" means scanning every element. AM-GM on `q + n/(q+1)` gives the bound. Jump search achieves it.

**Q17. How does jump search relate to van Emde Boas (vEB) and Eytzinger layouts?**
Single-level jump search uses one `√n` partitioning. **Recursive jump** doesn't beat O(√n). The **vEB layout** generalizes jump's `√n` split to be recursive in memory layout, giving cache-oblivious O(log_B n) misses for binary search on the laid-out array. **Eytzinger** is a simpler BFS-order layout that achieves nearly the same cache benefits. Both are "jump search's `√n` idea applied to memory layout instead of search algorithm".

### Professional level

**Q18. Prove jump search correctness.**
Invariants:
- (J1) Before each iteration of the jump phase, `prev ≤ step ≤ prev + m` and `step ≡ 0 (mod m)`.
- (J2) All indices `j < prev` satisfy `arr[j] < target`.

(J2) is maintained because the loop advances only when `arr[step - 1] < target`, and sortedness guarantees `arr[j] ≤ arr[step - 1] < target` for `j ≤ step - 1`. After the loop exits, the target (if present) lies in `[prev, min(step, n))`. The linear phase then finds it by sortedness in O(m) steps. Termination: `step` strictly increases by `m` each iteration, so jump phase has at most `⌈n/m⌉` iterations.

**Q19. Derive the exact comparison count for `m = √n` with `n` a perfect square.**
- Jump phase: at most `√n` comparisons (one per block boundary).
- Linear phase: at most `√n - 1` comparisons.
- Total: `2√n - 1`.

For non-perfect-square `n`: at most `⌈n/√n⌉ + √n ≤ √n + 1 + √n ≈ 2√n + 1`.

**Q20. Why doesn't recursive `√n` block-search improve asymptotic complexity?**
Recursive call: `T(n) = T(√n) + √n`. By substitution, `T(n) = √n + n^(1/4) + n^(1/8) + ... ≈ 2√n`. The first level already costs `√n`; recursion adds geometrically smaller terms that sum to a constant factor. Recursion improves the *cache* layout (vEB) but not the comparison count.

---

## Section B — Coding Challenges

### Challenge 1 — Classic Jump Search

> Given a sorted array of integers and a target, return its index, or `-1` if absent. Use jump search.

**Go:**
```go
import "math"

func jumpSearch(nums []int, target int) int {
    n := len(nums)
    if n == 0 {
        return -1
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < target {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] == target {
            return i
        }
        if nums[i] > target {
            return -1
        }
    }
    return -1
}
```

**Java:**
```java
public int jumpSearch(int[] nums, int target) {
    int n = nums.length;
    if (n == 0) return -1;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < target) {
        prev = step;
        step += m;
    }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) {
        if (nums[i] == target) return i;
        if (nums[i] > target)  return -1;
    }
    return -1;
}
```

**Python:**
```python
import math

def jumpSearch(nums, target):
    n = len(nums)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < target:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] == target:
            return i
        if nums[i] > target:
            return -1
    return -1
```

**Complexity:** O(√n) time, O(1) space.

---

### Challenge 2 — Find First Occurrence with Jump Search

> Sorted array with duplicates. Return the smallest index `i` where `arr[i] == target`, or `-1`.

**Strategy:** jump-search-style `lower_bound`. The linear phase advances while `arr[i] < target`; the first `arr[i] >= target` is checked for equality.

**Go:**
```go
func findFirstJump(nums []int, target int) int {
    n := len(nums)
    if n == 0 {
        return -1
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < target {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] >= target {
            if nums[i] == target {
                return i
            }
            return -1
        }
    }
    return -1
}
```

**Java:**
```java
public int findFirstJump(int[] nums, int target) {
    int n = nums.length;
    if (n == 0) return -1;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < target) {
        prev = step;
        step += m;
    }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) {
        if (nums[i] >= target) {
            return nums[i] == target ? i : -1;
        }
    }
    return -1;
}
```

**Python:**
```python
import math

def find_first_jump(nums, target):
    n = len(nums)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < target:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] >= target:
            return i if nums[i] == target else -1
    return -1
```

**Complexity:** O(√n) time, O(1) space. The lower-bound semantics work because in the linear phase we stop at the first `arr[i] >= target`.

---

### Challenge 3 — Jump Search Returning Insertion Index

> Given a sorted array and a target, return the index where target would be inserted to keep the array sorted (or its existing index if found).

**Go:**
```go
func jumpInsertIndex(nums []int, target int) int {
    n := len(nums)
    if n == 0 {
        return 0
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < target {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] >= target {
            return i
        }
    }
    return n
}
```

**Java:**
```java
public int jumpInsertIndex(int[] nums, int target) {
    int n = nums.length;
    if (n == 0) return 0;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < target) {
        prev = step;
        step += m;
    }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) {
        if (nums[i] >= target) return i;
    }
    return n;
}
```

**Python:**
```python
import math

def jump_insert_index(nums, target):
    n = len(nums)
    if n == 0:
        return 0
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < target:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] >= target:
            return i
    return n
```

**Complexity:** O(√n) time, O(1) space. Functionally equivalent to `bisect_left` but using jump-style structure.

---

### Challenge 4 — Hybrid Jump + Binary Search

> Implement jump search where the linear phase is replaced by binary search inside the located block.

**Go:**
```go
func jumpBinarySearch(nums []int, target int) int {
    n := len(nums)
    if n == 0 {
        return -1
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < target {
        prev = step
        step += m
    }
    lo, hi := prev, step-1
    if hi >= n {
        hi = n - 1
    }
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if nums[mid] == target {
            return mid
        }
        if nums[mid] < target {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return -1
}
```

**Java:**
```java
public int jumpBinarySearch(int[] nums, int target) {
    int n = nums.length;
    if (n == 0) return -1;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < target) {
        prev = step;
        step += m;
    }
    int lo = prev, hi = Math.min(step, n) - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (nums[mid] == target) return mid;
        if (nums[mid] < target)  lo = mid + 1;
        else                     hi = mid - 1;
    }
    return -1;
}
```

**Python:**
```python
import math

def jump_binary_search(nums, target):
    n = len(nums)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < target:
        prev = step
        step += m
    lo, hi = prev, min(step, n) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

**Complexity:** O(√n + log √n) = O(√n) time. The constant on phase 2 drops dramatically, useful when random access inside the block is free.

---

### Challenge 5 — Jump Search on Singly-Linked List with Skip Pointers

> Given the head of a sorted singly-linked list of size `n` and a target, return the matching node in O(√n) using one auxiliary array of skip pointers.

**Strategy:** build an array of every `√n`-th node, jump across it, then walk forward in the underlying list.

**Python:**
```python
import math

class Node:
    __slots__ = ("val", "next")
    def __init__(self, v):
        self.val = v
        self.next = None

def jump_search_linked_list(head, n, target):
    if n == 0 or head is None:
        return None
    m = max(1, int(math.isqrt(n)))
    skip = []
    cur, i = head, 0
    while cur is not None:
        if i % m == 0:
            skip.append(cur)
        cur = cur.next
        i += 1
    # Jump phase
    block = 0
    while block + 1 < len(skip) and skip[block + 1].val <= target:
        block += 1
    # Linear phase
    walker = skip[block]
    for _ in range(m):
        if walker is None:
            return None
        if walker.val == target:
            return walker
        if walker.val > target:
            return None
        walker = walker.next
    return None
```

**Go:**
```go
type ListNode struct {
    Val  int
    Next *ListNode
}

func jumpSearchLinked(head *ListNode, n, target int) *ListNode {
    if n == 0 || head == nil {
        return nil
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    skip := make([]*ListNode, 0, (n+m-1)/m)
    cur := head
    i := 0
    for cur != nil {
        if i%m == 0 {
            skip = append(skip, cur)
        }
        cur = cur.Next
        i++
    }
    block := 0
    for block+1 < len(skip) && skip[block+1].Val <= target {
        block++
    }
    walker := skip[block]
    for k := 0; k < m && walker != nil; k++ {
        if walker.Val == target {
            return walker
        }
        if walker.Val > target {
            return nil
        }
        walker = walker.Next
    }
    return nil
}
```

**Java:**
```java
class ListNode {
    int val;
    ListNode next;
    ListNode(int v) { this.val = v; }
}

public ListNode jumpSearchLinked(ListNode head, int n, int target) {
    if (n == 0 || head == null) return null;
    int m = Math.max(1, (int) Math.sqrt(n));
    java.util.List<ListNode> skip = new java.util.ArrayList<>();
    ListNode cur = head;
    int i = 0;
    while (cur != null) {
        if (i % m == 0) skip.add(cur);
        cur = cur.next;
        i++;
    }
    int block = 0;
    while (block + 1 < skip.size() && skip.get(block + 1).val <= target) {
        block++;
    }
    ListNode walker = skip.get(block);
    for (int k = 0; k < m && walker != null; k++) {
        if (walker.val == target) return walker;
        if (walker.val > target)  return null;
        walker = walker.next;
    }
    return null;
}
```

**Complexity:** O(√n) lookup, O(√n) space (skip array), O(n) one-time build. Classic interview question for "search on linked list better than linear".

---

### Challenge 6 — Find Number of Occurrences with Jump Search

> Given a sorted array with duplicates, return the count of `target` occurrences. Use jump search to locate the first and last occurrence.

**Strategy:** two jump-search-style `lower_bound` calls. `count = upper_bound(target) - lower_bound(target)`.

**Python:**
```python
import math

def jump_lower(nums, target):
    n = len(nums)
    if n == 0:
        return 0
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < target:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] >= target:
            return i
    return n

def jump_upper(nums, target):
    n = len(nums)
    if n == 0:
        return 0
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] <= target:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] > target:
            return i
    return n

def count_occurrences_jump(nums, target):
    return jump_upper(nums, target) - jump_lower(nums, target)
```

**Go:**
```go
func jumpLower(nums []int, target int) int {
    n := len(nums)
    if n == 0 {
        return 0
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < target {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] >= target {
            return i
        }
    }
    return n
}

func jumpUpper(nums []int, target int) int {
    n := len(nums)
    if n == 0 {
        return 0
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] <= target {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] > target {
            return i
        }
    }
    return n
}

func countOccurrencesJump(nums []int, target int) int {
    return jumpUpper(nums, target) - jumpLower(nums, target)
}
```

**Java:**
```java
int jumpLower(int[] nums, int target) {
    int n = nums.length;
    if (n == 0) return 0;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < target) { prev = step; step += m; }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) if (nums[i] >= target) return i;
    return n;
}
int jumpUpper(int[] nums, int target) {
    int n = nums.length;
    if (n == 0) return 0;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] <= target) { prev = step; step += m; }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) if (nums[i] > target) return i;
    return n;
}
int countOccurrencesJump(int[] nums, int target) {
    return jumpUpper(nums, target) - jumpLower(nums, target);
}
```

**Complexity:** O(√n) time, O(1) space.

---

### Challenge 7 — Find the Square Root of an Integer via Jump Search

> Given a non-negative integer `x`, return `⌊√x⌋` using jump search over a virtual sorted array `[0, 1, 4, 9, 16, ...]` of squares.

**Strategy:** the array `arr[i] = i * i` is sorted. Use jump search to find the largest `i` with `i * i ≤ x`. Block size `m = ⌊x^(1/4)⌋` keeps the search √n where `n = x^(1/2)`.

**Python:**
```python
import math

def isqrt_jump(x):
    if x < 2:
        return x
    # Virtual array A[i] = i*i, i in [0, x+1)
    # We want the largest i with i*i <= x.
    m = max(1, int(math.isqrt(int(math.isqrt(x)) + 1)))  # ~x^(1/4)
    prev, step = 0, m
    while step * step <= x:
        prev = step
        step += m
    # Linear scan in [prev, step)
    i = prev
    while (i + 1) * (i + 1) <= x:
        i += 1
    return i
```

**Go:**
```go
func isqrtJump(x int) int {
    if x < 2 {
        return x
    }
    sqx := int(math.Sqrt(float64(x))) + 1
    m := int(math.Sqrt(float64(sqx)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step*step <= x {
        prev = step
        step += m
    }
    i := prev
    for (i+1)*(i+1) <= x {
        i++
    }
    return i
}
```

**Java:**
```java
int isqrtJump(int x) {
    if (x < 2) return x;
    int sqx = (int) Math.sqrt(x) + 1;
    int m = Math.max(1, (int) Math.sqrt(sqx));
    int prev = 0, step = m;
    while ((long) step * step <= x) {
        prev = step;
        step += m;
    }
    int i = prev;
    while ((long)(i + 1) * (i + 1) <= x) i++;
    return i;
}
```

**Complexity:** O(x^(1/4)) time, O(1) space. Pedagogically interesting — demonstrates jump search on a "virtual" sorted array generated on-the-fly. In practice, binary search on `[0, x]` gives O(log x), which is better.

---

## Section C — Common Interview Pitfalls

### Pitfall 1 — Using `int(math.sqrt(n))` without rounding adjustment
For `n` near a perfect square, float rounding can produce `m - 1` instead of `m`. Prefer `math.isqrt(n)` in Python 3.8+, or check `m * m <= n` and adjust.

### Pitfall 2 — Forgetting to clamp `m ≥ 1`
For `n = 0` or `n = 1`, `int(sqrt(n))` may equal 0, causing an infinite loop or division error. Always `m = max(1, isqrt(n))`.

### Pitfall 3 — Off-by-one between `step` and `step - 1`
The classical loop checks `arr[step - 1] < target` (the **right edge** of the current block of size `m` starting at `prev = step - m`). Other conventions check `arr[step]` directly with different bounds. Pick one and don't mix.

### Pitfall 4 — Linear phase that reads past the array end
When the jump phase exits because `step >= n`, the block boundary is `n - 1`, not `step - 1`. Always clamp the linear loop with `min(step, n)`.

### Pitfall 5 — Returning -1 too eagerly in the jump phase
The jump phase should keep going forward until overshoot, **not** return -1 on the first comparison that exceeds the target. Returning early misses the target if it lies in the previous block.

### Pitfall 6 — Thinking jump search is adaptive
Asked "what's jump search's cost when the target is at index 1?" — many candidates say "O(1)" or "fast". **Wrong.** Jump search is O(√n) regardless of target position. For adaptivity, use exponential search.

### Pitfall 7 — Claiming jump search is "always worse than binary"
**Not always.** On singly-linked lists with skip pointers, on forward-only streams, on tape, and on bandwidth-bound network paged data, jump search beats (or replaces) binary search. The right answer involves access cost asymmetry, not asymptotic comparison count.

### Pitfall 8 — Confusing jump search with exponential search
Both have a "jump phase" and a "narrow-down phase", but:
- Jump: **fixed** stride `√n`, then **linear scan** of block. O(√n).
- Exponential: **doubling** stride, then **binary search** of range. O(log k) where k is target position.

They solve different problems. Naming is unfortunately confusing.

### Pitfall 9 — Assuming jump search needs random access
Jump search **does** need to read `arr[step - 1]` directly, but those reads can be sequential (every `m`-th element with intervening data prefetched). On true streaming sources, you read sequentially and inspect every `m`-th value — but you cannot rewind, so you must buffer the last block in memory. Doable but adds complexity.

### Pitfall 10 — Forgetting jump search needs sorted input
Same as binary search. Silent wrong answers on unsorted data. State this precondition explicitly.

---

## Section D — Mock Interview Drill (15 minutes)

A typical 45-minute interview focused on search algorithms might combine:

1. **Easy warmup** (5 min): "Implement binary search."
2. **Variation** (10 min): "Now implement jump search. Why is `√n` the optimal block size?"
3. **Trade-off question** (10 min): "When would you use jump search instead of binary search in production?"
4. **Coding** (15 min): one of Challenges 1–7 above, with extension questions.
5. **Discussion** (5 min): "Have you seen jump-search-style structures in databases or file formats?"

**Drill questions to practice aloud:**

- *"Walk me through jump search step by step on `[1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25]` searching for 17."*
  (Block size m = 3. Jump: 3 → 7 → 11 → 15 → 19. Overshoot at 19. Linear scan from 15: 17, 19. Wait, linear from index 9 (val=19)... let me restart. n=13, m=⌊√13⌋=3. Boundaries: 3, 6, 9, 12. arr[3]=7 < 17, arr[6]=13 < 17, arr[9]=19 >= 17, stop. Block [6, 9). Linear: arr[6]=13, arr[7]=15, arr[8]=17 ✓. Found at index 8 with 3 jumps + 3 linear = 6 comparisons.)

- *"Derive `m = √n`. Why not n/2 or log n?"*

- *"How would you do jump search on a sorted linked list?"*

- *"Why does Cassandra use jump-style sparse indexes instead of binary search?"*

- *"What's the lower bound for forward-only sorted search?"*

Memorize: the AM-GM derivation, the two-phase structure, the access-asymmetry use cases (tape, append-only, skip-pointer lists), and the relationship to exponential search and sqrt decomposition. With those four mental anchors, jump search questions become natural.
