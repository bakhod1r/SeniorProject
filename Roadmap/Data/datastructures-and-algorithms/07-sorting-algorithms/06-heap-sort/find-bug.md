# Heap Sort — Find the Bug

> 12 buggy heap implementations across **Go**, **Java**, **Python**.
> For each: spot the bug, explain the failure mode, then read the fix.

## Bug 1: Wrong Parent/Child Index Calculation

```python
# 0-indexed heap
def parent(i):  return i // 2          # BUG: this is for 1-indexed
def left(i):    return 2 * i           # BUG
def right(i):   return 2 * i + 1       # BUG
```

**Symptom:** Root has parent equal to itself; children skip index 0; heap never converges.
**Cause:** Mixing 1-indexed and 0-indexed conventions.
**Fix (0-indexed):**
```python
def parent(i):  return (i - 1) // 2
def left(i):    return 2 * i + 1
def right(i):   return 2 * i + 2
```
> Pick a convention up front. Java's `PriorityQueue` uses 0-indexed; CLRS textbook uses 1-indexed.

---

## Bug 2: siftDown Does Not Propagate

```java
static void siftDown(int[] a, int i, int n) {
    int l = 2*i+1, r = 2*i+2, largest = i;
    if (l < n && a[l] > a[largest]) largest = l;
    if (r < n && a[r] > a[largest]) largest = r;
    if (largest != i) {
        int tmp = a[i]; a[i] = a[largest]; a[largest] = tmp;
        // BUG: missing recursive/iterative continuation
    }
}
```

**Symptom:** Heap property violated below the swap point. Sort produces partially-ordered garbage.
**Cause:** A swap only fixes the parent → swapped-child edge; the new value at `largest` may now violate property with its own children.
**Fix:**
```java
        siftDown(a, largest, n);   // continue down
```

---

## Bug 3: Build-Heap Off-By-One (start at n/2 instead of n/2 - 1)

```go
func buildMaxHeap(a []int) {
    n := len(a)
    for i := n / 2; i >= 0; i-- {   // BUG: should start at n/2 - 1
        siftDown(a, i, n)
    }
}
```

**Symptom:** For odd n, processes a leaf node (no-op); for even n, accesses index `n/2` which has children at `n+1, n+2` → out of bounds (in Go, the bounds check inside siftDown saves you, but you waste work). Worse: with 1-indexed conventions you skip the actual last non-leaf.
**Cause:** Last non-leaf in 0-indexed array is at `(n-2)/2 = n/2 - 1` (when n is even) or `(n-1)/2 = n/2` for n odd. The safe starting index is `n/2 - 1` for both.
**Fix:**
```go
    for i := n/2 - 1; i >= 0; i-- {
```

---

## Bug 4: Always Take Left Child (Skip Right)

```python
def sift_down(a, i, n):
    while 2*i + 1 < n:
        child = 2*i + 1               # BUG: never considers right child
        if a[i] >= a[child]: break
        a[i], a[child] = a[child], a[i]
        i = child
```

**Symptom:** Heap is broken. Right subtree contains values larger than root.
**Fix:** pick the larger of left/right.
```python
        l, r = 2*i + 1, 2*i + 2
        child = l
        if r < n and a[r] > a[l]: child = r
```

---

## Bug 5: Always Take Larger-Index Child

```java
int child = (2*i + 2 < n) ? 2*i + 2 : 2*i + 1;   // BUG: prefers right unconditionally
```

**Symptom:** Even if left is larger, we swap with right. Heap property fails on left subtree.
**Fix:** compare values, not indices.
```java
int child = 2*i + 1;
if (child + 1 < n && a[child + 1] > a[child]) child++;
```

---

## Bug 6: Missing Single-Child Edge Case

```python
def sift_down(a, i, n):
    while True:
        l, r = 2*i+1, 2*i+2
        if r >= n: break              # BUG: drops out when only left exists
        # ...
```

**Symptom:** Last internal node (when n is even) has only a left child but no right. We never sift past it.
**Cause:** The break should only fire when *no* children exist (`l >= n`), not when right is missing.
**Fix:**
```python
        if l >= n: break              # truly no children
        largest = i
        if a[l] > a[largest]: largest = l
        if r < n and a[r] > a[largest]: largest = r
```

---

## Bug 7: Infinite siftUp on Equal Elements

```python
def sift_up(a, i):
    while i > 0:
        p = (i - 1) // 2
        if a[i] >= a[p]:               # BUG: uses >= instead of >
            a[i], a[p] = a[p], a[i]
            i = p
        else:
            break
```

**Symptom:** With duplicates, swaps equal elements forever (infinite loop in CPU; infinite recursion in functional langs).
**Cause:** `>=` keeps swapping when child equals parent — but the swap doesn't change the array, so the loop never terminates.
**Fix:** strict `>` (max-heap).
```python
        if a[i] > a[p]:
```

---

## Bug 8: Wrong Heap Direction for Ascending Sort

```python
def heap_sort_asc(a):
    # BUG: built a min-heap — but for ascending sort with extract-to-end pattern, you need max-heap
    heapq.heapify(a)
    for end in range(len(a)-1, 0, -1):
        a[0], a[end] = a[end], a[0]
        sift_down_min(a, 0, end)
```

**Symptom:** Output is descending, not ascending.
**Cause:** Min-heap puts the smallest at root; extracting to the end places smallest *at the end*, producing descending order.
**Fix:** Use a max-heap when extracting-to-end. Or use min-heap + extract-to-front (requires shifting, O(n²)).
```python
build_max_heap(a)
# extract pattern is unchanged
```
> Mnemonic: ascending sort → max-heap; descending sort → min-heap.

---

## Bug 9: Priority Queue Ignores Comparator

```java
class Task { int priority; }

PriorityQueue<Task> pq = new PriorityQueue<>();   // BUG: no comparator + Task does not implement Comparable
pq.offer(new Task(5));   // ClassCastException at runtime
```

**Symptom:** `ClassCastException: Task cannot be cast to Comparable` on second offer.
**Cause:** `PriorityQueue` defaults to natural ordering. If `Task` is not `Comparable`, you must pass a comparator.
**Fix:**
```java
PriorityQueue<Task> pq = new PriorityQueue<>(Comparator.comparingInt(t -> t.priority));
```

---

## Bug 10: Modification During Iteration

```python
import heapq
h = [1, 3, 5, 7, 9]
heapq.heapify(h)
for x in h:                  # BUG: iterating heap directly is NOT sorted order
    print(x)                 # prints array order, not heap order
```

**Symptom:** "Why isn't my heap iterating in sorted order?" Because a heap is partially ordered — the array layout reflects tree shape, not sorted order.
**Fix:** Pop items one at a time, or copy and sort:
```python
while h:
    print(heapq.heappop(h))
# Or non-destructive:
for x in sorted(h):
    print(x)
```

> Same gotcha in Java: `for (var x : pq)` does NOT yield priority order.

---

## Bug 11: Capacity Overflow on Resize

```java
class IntHeap {
    int[] data = new int[8];
    int size = 0;
    void push(int x) {
        // BUG: no resize when size == data.length → ArrayIndexOutOfBoundsException
        data[size++] = x;
        siftUp(size - 1);
    }
}
```

**Symptom:** Crashes on the 9th push.
**Fix:**
```java
    void push(int x) {
        if (size == data.length) {
            data = Arrays.copyOf(data, data.length * 2);   // amortized O(1)
        }
        data[size++] = x;
        siftUp(size - 1);
    }
```
> Avoid integer overflow on capacity for very large heaps: `Math.min(data.length * 2L, MAX_ARRAY_SIZE)`.

---

## Bug 12: NaN Pollution

```python
h = []
heapq.heappush(h, 3.14)
heapq.heappush(h, float('nan'))   # NaN compared with anything returns False
heapq.heappush(h, 2.71)
print(heapq.heappop(h))           # returns NaN — heap property silently broken
```

**Symptom:** Heap ordering becomes unpredictable. Subsequent pops may return out-of-order values.
**Cause:** `NaN < x`, `NaN > x`, `NaN == x` are all `False`. The heap can no longer enforce order.
**Fix:** Validate input, or substitute `+inf`/`-inf`:
```python
def safe_push(h, x):
    if x != x:                    # NaN check
        raise ValueError("NaN not allowed in heap")
    heapq.heappush(h, x)
```

---

## Bug 13 (Bonus): Threading Race on Shared Heap

```java
PriorityQueue<Integer> pq = new PriorityQueue<>();
// 4 producer threads
exec.submit(() -> pq.offer(rand.nextInt()));        // BUG: PQ is not thread-safe
exec.submit(() -> pq.offer(rand.nextInt()));
// → silent corruption, NullPointerException in siftDown, missing entries
```

**Symptom:** Intermittent NPE deep in `siftDown`; missing entries; over-counting.
**Cause:** `PriorityQueue` is not synchronized. Concurrent `offer`/`poll` can interleave inside `siftUp`/`siftDown`, shredding the heap invariant.
**Fix:** Use `PriorityBlockingQueue` (lock-based, thread-safe) or external synchronization:
```java
Queue<Integer> pq = new PriorityBlockingQueue<>();
```

---

## Debug Checklist

| Symptom | Likely Bug |
|---------|-----------|
| Output is reverse-sorted | Wrong heap direction (#8) |
| Output partially sorted | siftDown not propagating (#2) |
| `IndexOutOfBounds` mid-sort | Missing single-child case (#6) or capacity (#11) |
| Infinite loop with duplicates | `>=` instead of `>` (#7) |
| `ClassCastException` on offer | No comparator + not Comparable (#9) |
| Iteration prints array order | Confused heap shape vs sorted order (#10) |
| Intermittent NPE | Threading race (#13) |
| Random failures | NaN in input (#12) |
| Last element never sifted | Build-heap off-by-one (#3) |
| Heap broken on right subtree | Always-left bug (#4) or always-right (#5) |
