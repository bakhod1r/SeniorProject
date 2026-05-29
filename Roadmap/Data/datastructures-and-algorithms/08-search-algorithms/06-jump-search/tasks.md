# Jump Search — Practice Tasks

> 15 graded practice problems with full Go / Java / Python solutions. Each task starts with a **problem statement**, gives **constraints**, then provides three implementations. Difficulty grows from "warmup" to "this is hard".

---

## Task 1 — Classic Jump Search

**Problem.** Given a sorted array `nums[]` and a target `t`, return the index of `t`, or `-1` if absent. Use jump search with block size `⌊√n⌋`.

**Constraints.** `0 <= n <= 10^5`, distinct values.

**Go:**
```go
import "math"

func jumpSearch(nums []int, t int) int {
    n := len(nums)
    if n == 0 {
        return -1
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < t {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] == t {
            return i
        }
        if nums[i] > t {
            return -1
        }
    }
    return -1
}
```

**Java:**
```java
int jumpSearch(int[] nums, int t) {
    int n = nums.length;
    if (n == 0) return -1;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < t) {
        prev = step;
        step += m;
    }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) {
        if (nums[i] == t) return i;
        if (nums[i] > t)  return -1;
    }
    return -1;
}
```

**Python:**
```python
import math

def jump_search(nums, t):
    n = len(nums)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < t:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] == t:
            return i
        if nums[i] > t:
            return -1
    return -1
```

---

## Task 2 — Find First Occurrence with Jump Search

**Problem.** Sorted array with duplicates. Return the smallest index `i` with `arr[i] == t`, or `-1`.

**Go:**
```go
func jumpFindFirst(nums []int, t int) int {
    n := len(nums)
    if n == 0 {
        return -1
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < t {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] == t {
            return i
        }
        if nums[i] > t {
            return -1
        }
    }
    return -1
}
```

**Java:**
```java
int jumpFindFirst(int[] nums, int t) {
    int n = nums.length;
    if (n == 0) return -1;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < t) {
        prev = step;
        step += m;
    }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) {
        if (nums[i] == t) return i;
        if (nums[i] > t)  return -1;
    }
    return -1;
}
```

**Python:**
```python
import math

def jump_find_first(nums, t):
    n = len(nums)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < t:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] == t:
            return i
        if nums[i] > t:
            return -1
    return -1
```

> Note: the strict-less-than jump condition (`< t`) ensures we don't skip past a block ending exactly at `t`. The linear phase then returns the first matching index it sees.

---

## Task 3 — Find Last Occurrence with Jump Search

**Problem.** Return the largest index `i` with `arr[i] == t`, or `-1`.

**Strategy:** the jump phase uses `<= t` (so we skip blocks ending exactly at `t` and land in the block whose right edge is strictly greater). Then linear-scan **backward** from `step - 1` until we find `t`.

**Go:**
```go
func jumpFindLast(nums []int, t int) int {
    n := len(nums)
    if n == 0 {
        return -1
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] <= t {
        prev = step
        step += m
    }
    end := step - 1
    if end > n-1 {
        end = n - 1
    }
    for i := end; i >= prev; i-- {
        if nums[i] == t {
            return i
        }
        if nums[i] < t {
            return -1
        }
    }
    return -1
}
```

**Java:**
```java
int jumpFindLast(int[] nums, int t) {
    int n = nums.length;
    if (n == 0) return -1;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] <= t) {
        prev = step;
        step += m;
    }
    int end = Math.min(step - 1, n - 1);
    for (int i = end; i >= prev; i--) {
        if (nums[i] == t) return i;
        if (nums[i] < t)  return -1;
    }
    return -1;
}
```

**Python:**
```python
import math

def jump_find_last(nums, t):
    n = len(nums)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] <= t:
        prev = step
        step += m
    end = min(step - 1, n - 1)
    for i in range(end, prev - 1, -1):
        if nums[i] == t:
            return i
        if nums[i] < t:
            return -1
    return -1
```

---

## Task 4 — Jump Search Returning Insertion Index

**Problem.** Given a sorted array and a target, return the index where `t` would be inserted to keep the array sorted (lower-bound semantics).

**Go:**
```go
func jumpInsertIndex(nums []int, t int) int {
    n := len(nums)
    if n == 0 {
        return 0
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < t {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] >= t {
            return i
        }
    }
    return n
}
```

**Java:**
```java
int jumpInsertIndex(int[] nums, int t) {
    int n = nums.length;
    if (n == 0) return 0;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < t) {
        prev = step;
        step += m;
    }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) if (nums[i] >= t) return i;
    return n;
}
```

**Python:**
```python
import math

def jump_insert_index(nums, t):
    n = len(nums)
    if n == 0:
        return 0
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < t:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] >= t:
            return i
    return n
```

---

## Task 5 — Hybrid Jump + Binary Search

**Problem.** Replace the linear phase of jump search with binary search inside the located block.

**Go:**
```go
func jumpBinarySearch(nums []int, t int) int {
    n := len(nums)
    if n == 0 {
        return -1
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < t {
        prev = step
        step += m
    }
    lo, hi := prev, step-1
    if hi >= n {
        hi = n - 1
    }
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if nums[mid] == t {
            return mid
        }
        if nums[mid] < t {
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
int jumpBinarySearch(int[] nums, int t) {
    int n = nums.length;
    if (n == 0) return -1;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < t) {
        prev = step;
        step += m;
    }
    int lo = prev, hi = Math.min(step, n) - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (nums[mid] == t) return mid;
        if (nums[mid] < t)  lo = mid + 1;
        else                hi = mid - 1;
    }
    return -1;
}
```

**Python:**
```python
import math

def jump_binary_search(nums, t):
    n = len(nums)
    if n == 0:
        return -1
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < t:
        prev = step
        step += m
    lo, hi = prev, min(step, n) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == t:
            return mid
        if nums[mid] < t:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

---

## Task 6 — Count Occurrences of Target via Jump Search

**Problem.** Sorted array with duplicates. Return the count of times `t` appears.

**Strategy:** `count = jump_upper(t) - jump_lower(t)`.

**Python:**
```python
import math

def jump_lower(nums, t):
    n = len(nums)
    if n == 0:
        return 0
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] < t:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] >= t:
            return i
    return n

def jump_upper(nums, t):
    n = len(nums)
    if n == 0:
        return 0
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and nums[step - 1] <= t:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if nums[i] > t:
            return i
    return n

def count_occurrences(nums, t):
    return jump_upper(nums, t) - jump_lower(nums, t)
```

**Go:**
```go
func jumpLower(nums []int, t int) int {
    n := len(nums)
    if n == 0 {
        return 0
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] < t {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] >= t {
            return i
        }
    }
    return n
}

func jumpUpper(nums []int, t int) int {
    n := len(nums)
    if n == 0 {
        return 0
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && nums[step-1] <= t {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if nums[i] > t {
            return i
        }
    }
    return n
}

func countOccurrences(nums []int, t int) int {
    return jumpUpper(nums, t) - jumpLower(nums, t)
}
```

**Java:**
```java
int jumpLower(int[] nums, int t) {
    int n = nums.length;
    if (n == 0) return 0;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] < t) { prev = step; step += m; }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) if (nums[i] >= t) return i;
    return n;
}
int jumpUpper(int[] nums, int t) {
    int n = nums.length;
    if (n == 0) return 0;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && nums[step - 1] <= t) { prev = step; step += m; }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) if (nums[i] > t) return i;
    return n;
}
int countOccurrences(int[] nums, int t) {
    return jumpUpper(nums, t) - jumpLower(nums, t);
}
```

---

## Task 7 — Jump Search on Singly-Linked List with Skip Pointers

**Problem.** Given the head of a sorted singly-linked list of size `n` and a target, return the matching node (or `null`) in O(√n) using an auxiliary skip array.

**Python:**
```python
import math

class Node:
    __slots__ = ("val", "next")
    def __init__(self, v):
        self.val = v
        self.next = None

def jump_search_linked(head, n, t):
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
    block = 0
    while block + 1 < len(skip) and skip[block + 1].val <= t:
        block += 1
    walker = skip[block]
    for _ in range(m):
        if walker is None:
            return None
        if walker.val == t:
            return walker
        if walker.val > t:
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

func jumpSearchLinked(head *ListNode, n, t int) *ListNode {
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
    for block+1 < len(skip) && skip[block+1].Val <= t {
        block++
    }
    walker := skip[block]
    for k := 0; k < m && walker != nil; k++ {
        if walker.Val == t {
            return walker
        }
        if walker.Val > t {
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

ListNode jumpSearchLinked(ListNode head, int n, int t) {
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
    while (block + 1 < skip.size() && skip.get(block + 1).val <= t) block++;
    ListNode walker = skip.get(block);
    for (int k = 0; k < m && walker != null; k++) {
        if (walker.val == t) return walker;
        if (walker.val > t)  return null;
        walker = walker.next;
    }
    return null;
}
```

---

## Task 8 — Integer Square Root via Jump Search

**Problem.** Given a non-negative integer `x`, return `⌊√x⌋` using jump search.

**Python:**
```python
import math

def isqrt_jump(x):
    if x < 2:
        return x
    upper = int(math.isqrt(x)) + 1
    m = max(1, int(math.isqrt(upper)))
    prev, step = 0, m
    while step * step <= x:
        prev = step
        step += m
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
    upper := int(math.Sqrt(float64(x))) + 1
    m := int(math.Sqrt(float64(upper)))
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
    int upper = (int) Math.sqrt(x) + 1;
    int m = Math.max(1, (int) Math.sqrt(upper));
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

---

## Task 9 — Smallest Letter Greater Than Target via Jump (LeetCode 744 style)

**Problem.** Given a sorted array of lowercase letters `letters[]` and a target letter, return the smallest letter strictly greater than the target. If none, return `letters[0]` (wraparound).

**Python:**
```python
import math

def next_greatest_letter(letters, target):
    n = len(letters)
    if n == 0:
        return ''
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    while step < n and letters[step - 1] <= target:
        prev = step
        step += m
    for i in range(prev, min(step, n)):
        if letters[i] > target:
            return letters[i]
    return letters[0]
```

**Go:**
```go
func nextGreatestLetter(letters []byte, target byte) byte {
    n := len(letters)
    if n == 0 {
        return 0
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step < n && letters[step-1] <= target {
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        if letters[i] > target {
            return letters[i]
        }
    }
    return letters[0]
}
```

**Java:**
```java
char nextGreatestLetter(char[] letters, char target) {
    int n = letters.length;
    if (n == 0) return 0;
    int m = Math.max(1, (int) Math.sqrt(n));
    int prev = 0, step = m;
    while (step < n && letters[step - 1] <= target) {
        prev = step;
        step += m;
    }
    int end = Math.min(step, n);
    for (int i = prev; i < end; i++) {
        if (letters[i] > target) return letters[i];
    }
    return letters[0];
}
```

---

## Task 10 — Find Range `[first, last]` of Target via Jump Search

**Problem.** LeetCode 34 with jump search. Sorted array with possible duplicates; return `[first, last]` of `target` or `[-1, -1]`.

**Python:**
```python
import math

def search_range_jump(nums, t):
    first = jump_lower(nums, t)
    if first == len(nums) or nums[first] != t:
        return [-1, -1]
    last = jump_upper(nums, t) - 1
    return [first, last]
```
(Uses `jump_lower` and `jump_upper` from Task 6.)

**Go:**
```go
func searchRangeJump(nums []int, t int) [2]int {
    first := jumpLower(nums, t)
    if first == len(nums) || nums[first] != t {
        return [2]int{-1, -1}
    }
    last := jumpUpper(nums, t) - 1
    return [2]int{first, last}
}
```

**Java:**
```java
int[] searchRangeJump(int[] nums, int t) {
    int first = jumpLower(nums, t);
    if (first == nums.length || nums[first] != t) return new int[]{-1, -1};
    int last = jumpUpper(nums, t) - 1;
    return new int[]{first, last};
}
```

---

## Task 11 — Jump Search on a 2D Sorted Matrix (LeetCode 74 style)

**Problem.** Matrix where each row is sorted left-to-right and each row's first value > previous row's last value. Find target using jump search on the flat view.

**Python:**
```python
import math

def search_matrix_jump(mat, t):
    if not mat or not mat[0]:
        return False
    m_rows, n_cols = len(mat), len(mat[0])
    total = m_rows * n_cols
    block = max(1, int(math.isqrt(total)))
    def val(i): return mat[i // n_cols][i % n_cols]
    prev, step = 0, block
    while step < total and val(step - 1) < t:
        prev = step
        step += block
    for i in range(prev, min(step, total)):
        if val(i) == t:
            return True
        if val(i) > t:
            return False
    return False
```

**Go:**
```go
func searchMatrixJump(mat [][]int, t int) bool {
    if len(mat) == 0 || len(mat[0]) == 0 {
        return false
    }
    mRows, nCols := len(mat), len(mat[0])
    total := mRows * nCols
    block := int(math.Sqrt(float64(total)))
    if block < 1 {
        block = 1
    }
    val := func(i int) int { return mat[i/nCols][i%nCols] }
    prev, step := 0, block
    for step < total && val(step-1) < t {
        prev = step
        step += block
    }
    end := step
    if end > total {
        end = total
    }
    for i := prev; i < end; i++ {
        if val(i) == t {
            return true
        }
        if val(i) > t {
            return false
        }
    }
    return false
}
```

**Java:**
```java
boolean searchMatrixJump(int[][] mat, int t) {
    if (mat.length == 0 || mat[0].length == 0) return false;
    int mRows = mat.length, nCols = mat[0].length;
    int total = mRows * nCols;
    int block = Math.max(1, (int) Math.sqrt(total));
    int prev = 0, step = block;
    while (step < total && mat[(step - 1) / nCols][(step - 1) % nCols] < t) {
        prev = step;
        step += block;
    }
    int end = Math.min(step, total);
    for (int i = prev; i < end; i++) {
        int v = mat[i / nCols][i % nCols];
        if (v == t) return true;
        if (v > t)  return false;
    }
    return false;
}
```

---

## Task 12 — Sqrt Decomposition: Range Sum Query on Mutable Array

**Problem.** Given an array supporting two ops: `update(i, val)` and `range_sum(l, r)`. Both should run in O(√n).

**Strategy:** split into `√n` blocks; maintain a per-block sum. Range queries jump through full blocks and linear-scan partial blocks at the boundaries — exactly the jump search structure.

**Python:**
```python
import math

class SqrtArray:
    def __init__(self, arr):
        self.n = len(arr)
        self.arr = arr[:]
        self.m = max(1, int(math.isqrt(self.n)))
        self.block_sum = []
        for start in range(0, self.n, self.m):
            self.block_sum.append(sum(self.arr[start:start + self.m]))

    def update(self, i, val):
        b = i // self.m
        self.block_sum[b] += val - self.arr[i]
        self.arr[i] = val

    def range_sum(self, l, r):
        s = 0
        while l <= r and l % self.m != 0:
            s += self.arr[l]
            l += 1
        while l + self.m - 1 <= r:
            s += self.block_sum[l // self.m]
            l += self.m
        while l <= r:
            s += self.arr[l]
            l += 1
        return s
```

**Go:**
```go
type SqrtArray struct {
    n        int
    arr      []int
    m        int
    blockSum []int
}

func NewSqrtArray(arr []int) *SqrtArray {
    n := len(arr)
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    a := append([]int(nil), arr...)
    bs := make([]int, (n+m-1)/m)
    for i, x := range a {
        bs[i/m] += x
    }
    return &SqrtArray{n: n, arr: a, m: m, blockSum: bs}
}

func (s *SqrtArray) Update(i, val int) {
    b := i / s.m
    s.blockSum[b] += val - s.arr[i]
    s.arr[i] = val
}

func (s *SqrtArray) RangeSum(l, r int) int {
    sum := 0
    for l <= r && l%s.m != 0 {
        sum += s.arr[l]
        l++
    }
    for l+s.m-1 <= r {
        sum += s.blockSum[l/s.m]
        l += s.m
    }
    for l <= r {
        sum += s.arr[l]
        l++
    }
    return sum
}
```

**Java:**
```java
class SqrtArray {
    int n, m;
    int[] arr, blockSum;
    SqrtArray(int[] a) {
        n = a.length;
        m = Math.max(1, (int) Math.sqrt(n));
        arr = a.clone();
        blockSum = new int[(n + m - 1) / m];
        for (int i = 0; i < n; i++) blockSum[i / m] += a[i];
    }
    void update(int i, int val) {
        blockSum[i / m] += val - arr[i];
        arr[i] = val;
    }
    int rangeSum(int l, int r) {
        int s = 0;
        while (l <= r && l % m != 0) { s += arr[l++]; }
        while (l + m - 1 <= r) { s += blockSum[l / m]; l += m; }
        while (l <= r) { s += arr[l++]; }
        return s;
    }
}
```

**Complexity:** O(√n) per query and per update.

---

## Task 13 — Exponential Search vs Jump Search (Adaptive Comparison)

**Problem.** Implement exponential search (doubling stride). Compare it with jump search by counting comparisons when the target is at index 5 in a 1,000,000-element array.

**Python:**
```python
def exponential_search(arr, t):
    n = len(arr)
    if n == 0:
        return -1
    if arr[0] == t:
        return 0
    bound = 1
    while bound < n and arr[bound] < t:
        bound *= 2
    lo = bound // 2
    hi = min(bound, n - 1)
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == t:
            return mid
        if arr[mid] < t:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

**Go:**
```go
func exponentialSearch(arr []int, t int) int {
    n := len(arr)
    if n == 0 {
        return -1
    }
    if arr[0] == t {
        return 0
    }
    bound := 1
    for bound < n && arr[bound] < t {
        bound *= 2
    }
    lo := bound / 2
    hi := bound
    if hi >= n {
        hi = n - 1
    }
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == t {
            return mid
        }
        if arr[mid] < t {
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
int exponentialSearch(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return -1;
    if (arr[0] == t) return 0;
    int bound = 1;
    while (bound < n && arr[bound] < t) bound *= 2;
    int lo = bound / 2, hi = Math.min(bound, n - 1);
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == t) return mid;
        if (arr[mid] < t)  lo = mid + 1;
        else               hi = mid - 1;
    }
    return -1;
}
```

**Comparison for n=10⁶, target at index 5:**
- Jump search: ~1000 jump steps + ~1000 linear = ~2000 comparisons.
- Exponential: ~log₂(10) ≈ 4 doublings + ~log₂(8) ≈ 3 binary = ~7 comparisons.

**Exponential wins by ~285×** when target is near the front. Jump search is **not adaptive**.

---

## Task 14 — Smallest `i` such that `i² ≥ x` via Jump on Virtual Array

**Problem.** Given `x ≥ 0`, return the smallest non-negative integer `i` such that `i * i >= x`. Use jump search on the (virtual) sorted array of squares.

**Python:**
```python
import math

def smallest_i_squared_ge(x):
    if x <= 0:
        return 0
    upper = int(math.isqrt(x)) + 1
    m = max(1, int(math.isqrt(upper)))
    prev, step = 0, m
    while step * step < x:
        prev = step
        step += m
    i = prev
    while i * i < x:
        i += 1
    return i
```

**Go:**
```go
func smallestSquareGE(x int) int {
    if x <= 0 {
        return 0
    }
    upper := int(math.Sqrt(float64(x))) + 1
    m := int(math.Sqrt(float64(upper)))
    if m < 1 {
        m = 1
    }
    prev, step := 0, m
    for step*step < x {
        prev = step
        step += m
    }
    i := prev
    for i*i < x {
        i++
    }
    return i
}
```

**Java:**
```java
int smallestSquareGE(int x) {
    if (x <= 0) return 0;
    int upper = (int) Math.sqrt(x) + 1;
    int m = Math.max(1, (int) Math.sqrt(upper));
    int prev = 0, step = m;
    while ((long) step * step < x) {
        prev = step;
        step += m;
    }
    int i = prev;
    while ((long) i * i < x) i++;
    return i;
}
```

---

## Task 15 — Disk-Backed Sorted File Jump Search

**Problem.** Implement a jump search that operates on a sorted file of fixed-width records. Each record is 16 bytes: 8-byte key + 8-byte value. Locate the value for a given key without loading the file into memory.

**Python:**
```python
import math
import os
import struct

RECORD_SIZE = 16

def jump_search_file(path, target_key):
    file_size = os.path.getsize(path)
    n = file_size // RECORD_SIZE
    if n == 0:
        return None
    m = max(1, int(math.isqrt(n)))
    prev, step = 0, m
    with open(path, 'rb') as f:
        # Jump phase: read every m-th record.
        while step < n:
            f.seek((step - 1) * RECORD_SIZE)
            data = f.read(RECORD_SIZE)
            key, _ = struct.unpack('>QQ', data)
            if key >= target_key:
                break
            prev = step
            step += m
        end = min(step, n)
        # Linear phase: read consecutive records in the block.
        f.seek(prev * RECORD_SIZE)
        block = f.read((end - prev) * RECORD_SIZE)
        for i in range(end - prev):
            offset = i * RECORD_SIZE
            key, val = struct.unpack_from('>QQ', block, offset)
            if key == target_key:
                return val
            if key > target_key:
                return None
    return None
```

**Go:**
```go
package main

import (
    "encoding/binary"
    "math"
    "os"
)

const RecordSize = 16

func jumpSearchFile(path string, targetKey uint64) (uint64, bool, error) {
    info, err := os.Stat(path)
    if err != nil {
        return 0, false, err
    }
    n := int(info.Size() / RecordSize)
    if n == 0 {
        return 0, false, nil
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    f, err := os.Open(path)
    if err != nil {
        return 0, false, err
    }
    defer f.Close()

    prev, step := 0, m
    buf := make([]byte, RecordSize)
    for step < n {
        if _, err := f.Seek(int64((step-1)*RecordSize), 0); err != nil {
            return 0, false, err
        }
        if _, err := f.Read(buf); err != nil {
            return 0, false, err
        }
        key := binary.BigEndian.Uint64(buf[:8])
        if key >= targetKey {
            break
        }
        prev = step
        step += m
    }
    end := step
    if end > n {
        end = n
    }

    block := make([]byte, (end-prev)*RecordSize)
    if _, err := f.Seek(int64(prev*RecordSize), 0); err != nil {
        return 0, false, err
    }
    if _, err := f.Read(block); err != nil {
        return 0, false, err
    }
    for i := 0; i < end-prev; i++ {
        off := i * RecordSize
        key := binary.BigEndian.Uint64(block[off : off+8])
        val := binary.BigEndian.Uint64(block[off+8 : off+16])
        if key == targetKey {
            return val, true, nil
        }
        if key > targetKey {
            return 0, false, nil
        }
    }
    return 0, false, nil
}
```

**Java:**
```java
import java.io.IOException;
import java.io.RandomAccessFile;

public class JumpFile {
    private static final int RECORD_SIZE = 16;

    public static Long jumpSearchFile(String path, long targetKey) throws IOException {
        try (RandomAccessFile f = new RandomAccessFile(path, "r")) {
            long fileSize = f.length();
            int n = (int) (fileSize / RECORD_SIZE);
            if (n == 0) return null;
            int m = Math.max(1, (int) Math.sqrt(n));
            int prev = 0, step = m;
            byte[] buf = new byte[RECORD_SIZE];
            while (step < n) {
                f.seek((long)(step - 1) * RECORD_SIZE);
                f.readFully(buf);
                long key = bytesToLong(buf, 0);
                if (key >= targetKey) break;
                prev = step;
                step += m;
            }
            int end = Math.min(step, n);
            byte[] block = new byte[(end - prev) * RECORD_SIZE];
            f.seek((long) prev * RECORD_SIZE);
            f.readFully(block);
            for (int i = 0; i < end - prev; i++) {
                int off = i * RECORD_SIZE;
                long key = bytesToLong(block, off);
                long val = bytesToLong(block, off + 8);
                if (key == targetKey) return val;
                if (key > targetKey)  return null;
            }
            return null;
        }
    }

    private static long bytesToLong(byte[] b, int off) {
        long v = 0;
        for (int i = 0; i < 8; i++) v = (v << 8) | (b[off + i] & 0xFFL);
        return v;
    }
}
```

**Complexity:** O(√n) I/O operations, each ~16 bytes for the jump phase and one larger read for the block. On HDD with 10 ms per seek, this is roughly `√n × 10 ms`. For `n = 10⁶`, ~10 seconds. The binary-search alternative would do ~20 random reads (~200 ms) — much faster for SSD, but on rotational HDD with directional asymmetry the gap shrinks substantially.

---

## Benchmark Task — Comparisons vs Binary Search across Growing `n`

**Goal.** Empirically measure the comparison count of Jump Search vs Binary Search on randomly generated sorted arrays of sizes `n = [10, 100, 1_000, 10_000, 100_000, 1_000_000]`. For each `n`, average over 1000 random targets (mixed hits and misses). Print a table with columns: `n`, `√n`, `2√n` (theoretical jump bound), `log₂(n+1)` (theoretical binary bound), `jump_avg`, `binary_avg`. Verify the empirical values stay close to their theoretical bounds.

This task closes the loop on the AM-GM analysis: you should see jump search's comparison count tracking `≈ 2√n` and binary search's tracking `≈ log₂(n)`, with binary winning at every `n ≥ 4`.

#### Go

```go
package main

import (
    "fmt"
    "math"
    "math/rand"
    "sort"
)

func jumpSearchCount(arr []int, target int) int {
    n := len(arr)
    if n == 0 {
        return 0
    }
    m := int(math.Sqrt(float64(n)))
    if m < 1 {
        m = 1
    }
    comps := 0
    prev, step := 0, m
    for step < n && arr[step-1] < target {
        comps++
        prev = step
        step += m
    }
    if step < n {
        comps++
    }
    end := step
    if end > n {
        end = n
    }
    for i := prev; i < end; i++ {
        comps++
        if arr[i] == target {
            return comps
        }
        if arr[i] > target {
            return comps
        }
    }
    return comps
}

func binarySearchCount(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    comps := 0
    for lo <= hi {
        comps++
        mid := lo + (hi-lo)/2
        if arr[mid] == target {
            return comps
        }
        if arr[mid] < target {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return comps
}

func main() {
    rand.Seed(42)
    sizes := []int{10, 100, 1000, 10000, 100000, 1000000}
    trials := 1000

    fmt.Printf("%-10s %-10s %-10s %-10s %-12s %-12s\n",
        "n", "sqrt(n)", "2*sqrt(n)", "log2(n+1)", "jump_avg", "binary_avg")
    for _, n := range sizes {
        arr := make([]int, n)
        for i := range arr {
            arr[i] = rand.Intn(10 * n)
        }
        sort.Ints(arr)
        jumpSum, binSum := 0, 0
        for t := 0; t < trials; t++ {
            var target int
            if rand.Float64() < 0.5 {
                target = arr[rand.Intn(n)] // hit
            } else {
                target = rand.Intn(10 * n) // possibly miss
            }
            jumpSum += jumpSearchCount(arr, target)
            binSum += binarySearchCount(arr, target)
        }
        sqrtN := math.Sqrt(float64(n))
        log2N := math.Log2(float64(n + 1))
        fmt.Printf("%-10d %-10.1f %-10.1f %-10.1f %-12.2f %-12.2f\n",
            n, sqrtN, 2*sqrtN, log2N,
            float64(jumpSum)/float64(trials),
            float64(binSum)/float64(trials))
    }
}
```

#### Java

```java
import java.util.Arrays;
import java.util.Random;

public class JumpVsBinaryBenchmark {

    static int jumpSearchCount(int[] arr, int target) {
        int n = arr.length;
        if (n == 0) return 0;
        int m = Math.max(1, (int) Math.sqrt(n));
        int comps = 0;
        int prev = 0, step = m;
        while (step < n && arr[step - 1] < target) {
            comps++;
            prev = step;
            step += m;
        }
        if (step < n) comps++;
        int end = Math.min(step, n);
        for (int i = prev; i < end; i++) {
            comps++;
            if (arr[i] == target) return comps;
            if (arr[i] > target) return comps;
        }
        return comps;
    }

    static int binarySearchCount(int[] arr, int target) {
        int lo = 0, hi = arr.length - 1, comps = 0;
        while (lo <= hi) {
            comps++;
            int mid = lo + (hi - lo) / 2;
            if (arr[mid] == target) return comps;
            if (arr[mid] < target) lo = mid + 1;
            else hi = mid - 1;
        }
        return comps;
    }

    public static void main(String[] args) {
        int[] sizes = {10, 100, 1000, 10000, 100000, 1000000};
        int trials = 1000;
        Random rand = new Random(42);

        System.out.printf("%-10s %-10s %-10s %-10s %-12s %-12s%n",
                "n", "sqrt(n)", "2*sqrt(n)", "log2(n+1)", "jump_avg", "binary_avg");
        for (int n : sizes) {
            int[] arr = new int[n];
            for (int i = 0; i < n; i++) arr[i] = rand.nextInt(10 * n);
            Arrays.sort(arr);
            long jumpSum = 0, binSum = 0;
            for (int t = 0; t < trials; t++) {
                int target = rand.nextDouble() < 0.5
                        ? arr[rand.nextInt(n)]
                        : rand.nextInt(10 * n);
                jumpSum += jumpSearchCount(arr, target);
                binSum  += binarySearchCount(arr, target);
            }
            double sqrtN = Math.sqrt(n);
            double log2N = Math.log(n + 1) / Math.log(2);
            System.out.printf("%-10d %-10.1f %-10.1f %-10.1f %-12.2f %-12.2f%n",
                    n, sqrtN, 2 * sqrtN, log2N,
                    jumpSum / (double) trials,
                    binSum  / (double) trials);
        }
    }
}
```

#### Python

```python
import math
import random


def jump_search_count(arr, target):
    n = len(arr)
    if n == 0:
        return 0
    m = max(1, int(math.isqrt(n)))
    comps = 0
    prev, step = 0, m
    while step < n and arr[step - 1] < target:
        comps += 1
        prev = step
        step += m
    if step < n:
        comps += 1
    for i in range(prev, min(step, n)):
        comps += 1
        if arr[i] == target:
            return comps
        if arr[i] > target:
            return comps
    return comps


def binary_search_count(arr, target):
    lo, hi, comps = 0, len(arr) - 1, 0
    while lo <= hi:
        comps += 1
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return comps
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return comps


if __name__ == "__main__":
    random.seed(42)
    sizes = [10, 100, 1_000, 10_000, 100_000, 1_000_000]
    trials = 1000

    print(f"{'n':<10} {'sqrt(n)':<10} {'2*sqrt(n)':<10} {'log2(n+1)':<10} {'jump_avg':<12} {'binary_avg':<12}")
    for n in sizes:
        arr = sorted(random.randint(0, 10 * n) for _ in range(n))
        jump_sum = bin_sum = 0
        for _ in range(trials):
            target = random.choice(arr) if random.random() < 0.5 else random.randint(0, 10 * n)
            jump_sum += jump_search_count(arr, target)
            bin_sum  += binary_search_count(arr, target)
        sqrt_n = math.sqrt(n)
        log2_n = math.log2(n + 1)
        print(f"{n:<10} {sqrt_n:<10.1f} {2*sqrt_n:<10.1f} {log2_n:<10.1f} "
              f"{jump_sum / trials:<12.2f} {bin_sum / trials:<12.2f}")
```

**Expected observation:**

```
n          sqrt(n)    2*sqrt(n)  log2(n+1)  jump_avg     binary_avg
10         3.2        6.3        3.5        ~4.5         ~3.0
100        10.0       20.0       6.7        ~13.5        ~5.8
1000       31.6       63.2       10.0       ~42.0        ~8.9
10000      100.0      200.0      13.3       ~133.0       ~12.3
100000     316.2      632.5      16.6       ~420.0       ~15.6
1000000    1000.0     2000.0     20.0       ~1330.0      ~18.9
```

- Jump search comparisons grow as `Θ(√n)`, hovering around `(4/3)√n` for the mixed hit/miss workload (early termination on hits keeps the constant under the worst-case `2√n` bound).
- Binary search comparisons grow as `Θ(log₂ n)`, almost exactly tracking the theoretical bound.
- At `n = 10⁶`, binary is ~70× faster in comparisons. This is why **binary search wins on in-RAM arrays** regardless of how large `n` gets.
- The crossover where jump beats linear search is around `n ≈ 50`; jump never beats binary on comparison count.

**Extension:** add a third column for *wall-clock* time (using `time.perf_counter` / `System.nanoTime` / `time.Now`) and observe that cache effects narrow the gap somewhat at small `n` but binary remains faster at every size.

---

## Self-Check

After completing these tasks, you should be able to:

- [ ] Write classic jump search from memory in Go, Java, or Python.
- [ ] Explain why `m = √n` is optimal (AM-GM, calculus).
- [ ] Implement first/last occurrence and insertion-index variants.
- [ ] Combine jump search with binary search inside the block.
- [ ] Apply jump search to a singly-linked list using skip pointers.
- [ ] Implement sqrt decomposition for range queries.
- [ ] Distinguish jump search from exponential search and choose correctly.
- [ ] Implement jump search on a disk-backed sorted file.
- [ ] Identify when jump search is the wrong tool (in-RAM array, adaptive needs, unsorted data).
- [ ] State the lower bound for forward-only sorted search (Ω(√n)).
- [ ] Run the benchmark task and verify jump search tracks `≈ 2√n` and binary search tracks `≈ log₂(n)` across `n = 10 ... 10⁶`.

If any of these feel uncertain, revisit the relevant section of `junior.md` or `middle.md` and redo the task without looking at the solution.
