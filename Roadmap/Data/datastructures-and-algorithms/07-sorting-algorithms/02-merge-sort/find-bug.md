# Merge Sort — Find the Bug

> 12 buggy implementations across **Go**, **Java**, **Python**.

---

## Exercise 1: Used `<` instead of `<=` (Loses Stability)

### Python (Buggy)

```python
def merge(l, r):
    out = []
    i = j = 0
    while i < len(l) and j < len(r):
        if l[i] < r[j]:  # BUG
            out.append(l[i]); i += 1
        else:
            out.append(r[j]); j += 1
    out += l[i:]; out += r[j:]
    return out
```

**Bug:** When `l[i] == r[j]`, takes from right first → original order of equals reversed.

### Fix

```python
if l[i] <= r[j]:  # use <=
```

---

## Exercise 2: Forgot Leftover Loops

### Go (Buggy)

```go
func merge(l, r []int) []int {
    out := make([]int, 0, len(l)+len(r))
    i, j := 0, 0
    for i < len(l) && j < len(r) {
        if l[i] <= r[j] { out = append(out, l[i]); i++
        } else { out = append(out, r[j]); j++ }
    }
    return out  // BUG: lost remaining elements
}
```

**Bug:** When one array is exhausted, the other still has elements. Output is missing them.

### Fix

```go
out = append(out, l[i:]...)
out = append(out, r[j:]...)
return out
```

---

## Exercise 3: Integer Overflow in mid

### Java (Buggy)

```java
int mid = (lo + hi) / 2;  // BUG: overflow when lo + hi > Integer.MAX_VALUE
```

**Bug:** For huge arrays (n > 2³¹), `lo + hi` overflows to a negative number → `mid` is wrong → out-of-bounds access.

### Fix

```java
int mid = lo + (hi - lo) / 2;
```

---

## Exercise 4: Wrong Base Case

### Python (Buggy)

```python
def merge_sort(arr):
    if len(arr) == 0:  # BUG: missing single-element case
        return arr
    mid = len(arr) // 2
    return merge(merge_sort(arr[:mid]), merge_sort(arr[mid:]))
```

**Bug:** For `len(arr) == 1`, splits to `[]` and `[x]`, recurses on `[x]` → infinite recursion.

### Fix

```python
if len(arr) <= 1:
```

---

## Exercise 5: Unbalanced Split

### Python (Buggy)

```python
def merge_sort(arr):
    if len(arr) <= 1: return arr
    mid = 1  # BUG: always splits 1 vs n-1
    return merge(merge_sort(arr[:mid]), merge_sort(arr[mid:]))
```

**Bug:** Always splits one element off the front. Recursion depth = n. Time becomes O(n²).

### Fix

```python
mid = len(arr) // 2
```

---

## Exercise 6: Allocates Aux Inside Recursion

### Java (Buggy)

```java
private static void sort(int[] a, int lo, int hi) {
    if (lo >= hi) return;
    int[] aux = new int[hi - lo + 1];  // BUG: allocates per call
    int mid = lo + (hi - lo) / 2;
    sort(a, lo, mid);
    sort(a, mid + 1, hi);
    merge(a, aux, lo, mid, hi);
}
```

**Bug:** O(n log n) memory allocations → severe garbage collection pressure.

### Fix

```java
public static void sort(int[] a) {
    int[] aux = new int[a.length];  // allocate once
    sort(a, aux, 0, a.length - 1);
}
```

---

## Exercise 7: Reused Aux Without Copying

### Go (Buggy)

```go
func merge(arr, aux []int, lo, mid, hi int) {
    // BUG: forgot to copy arr to aux first
    i, j := lo, mid+1
    for k := lo; k <= hi; k++ {
        if i > mid                 { arr[k] = aux[j]; j++
        } else if j > hi           { arr[k] = aux[i]; i++
        } else if aux[i] <= aux[j] { arr[k] = aux[i]; i++
        } else                     { arr[k] = aux[j]; j++ }
    }
}
```

**Bug:** Reads from `aux` without first copying `arr` into `aux`. Result is garbage from previous merge.

### Fix

```go
for k := lo; k <= hi; k++ { aux[k] = arr[k] }  // copy first
```

---

## Exercise 8: Slow/Fast Pointer Wrong (Linked List)

### Python (Buggy)

```python
def find_mid(head):
    slow = head
    fast = head  # BUG: should start at head.next
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
    return slow
```

**Bug:** For `[1, 2]`, returns the second node (should return the first to allow proper split). Infinite recursion: every recursion has the same first half.

### Fix

```python
slow = head
fast = head.next  # start one ahead
```

---

## Exercise 9: Forgot to Disconnect List Halves

### Python (Buggy)

```python
def sort_list(head):
    if not head or not head.next: return head
    mid = find_mid(head)
    # BUG: didn't set mid.next-prev to None
    left  = sort_list(head)
    right = sort_list(mid.next)
    return merge_lists(left, right)
```

**Bug:** Left half includes ALL nodes (not split). Sort recurses on the whole list → infinite recursion.

### Fix

```python
mid = find_mid(head)
right_head = mid.next
mid.next = None  # disconnect!
left  = sort_list(head)
right = sort_list(right_head)
```

---

## Exercise 10: Comparator Subtraction Overflow

### Java (Buggy)

```java
Arrays.sort(intsArr, (a, b) -> a - b);  // BUG: overflow for extreme values
```

**Bug:** `Integer.MIN_VALUE - Integer.MAX_VALUE` overflows to a positive number → wrong order.

### Fix

```java
Arrays.sort(intsArr, Integer::compare);
```

---

## Exercise 11: Modifying Slice via Aliasing

### Go (Buggy)

```go
func MergeSort(arr []int) []int {
    if len(arr) <= 1 { return arr }
    mid := len(arr) / 2
    left  := MergeSort(arr[:mid])  // BUG: shares underlying array
    right := MergeSort(arr[mid:])
    return merge(left, right)
}
```

**Bug:** `arr[:mid]` and `arr[mid:]` share the same underlying array. When recursive calls mutate, they trample each other.

### Fix

```go
left  := MergeSort(append([]int{}, arr[:mid]...))   // copy
right := MergeSort(append([]int{}, arr[mid:]...))
```

Or better: use index-based recursion, not slicing.

---

## Exercise 12: K-Way Merge Without Tracking Stream Index

### Python (Buggy)

```python
import heapq

def k_way_merge(streams):
    heap = []
    iters = [iter(s) for s in streams]
    for it in iters:
        try:
            heapq.heappush(heap, next(it))  # BUG: lost track of which stream
        except StopIteration: pass
    while heap:
        val = heapq.heappop(heap)
        yield val
        # BUG: don't know which stream to refill from
```

**Bug:** Pushing only the value loses the stream index. Can't pull next from the right stream.

### Fix

```python
for i, it in enumerate(iters):
    try:
        heapq.heappush(heap, (next(it), i))  # (value, stream_index)
    except StopIteration: pass
while heap:
    val, i = heapq.heappop(heap)
    yield val
    try:
        heapq.heappush(heap, (next(iters[i]), i))
    except StopIteration: pass
```

---

## Summary

| # | Bug | Severity |
|---|-----|----------|
| 1 | `<` instead of `<=` | Stability |
| 2 | Missing leftover loops | Correctness (lost data) |
| 3 | mid overflow | Crash on huge n |
| 4 | Wrong base case | Infinite recursion |
| 5 | Unbalanced split | O(n²) |
| 6 | Aux allocated per call | Performance/GC |
| 7 | Forgot to copy aux | Wrong output |
| 8 | Slow/fast wrong start | Linked-list infinite recursion |
| 9 | Forgot to disconnect halves | Linked-list infinite recursion |
| 10 | Subtraction comparator | Edge-case wrong order |
| 11 | Aliased slices in Go | Data corruption |
| 12 | k-way merge no index tracking | Wrong output |

**Lessons:** Use `<=`, copy slices/aux properly, balance splits, allocate aux once, watch comparator overflow, disconnect linked-list halves.
