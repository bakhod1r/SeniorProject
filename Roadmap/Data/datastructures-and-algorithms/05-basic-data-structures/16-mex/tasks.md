# MEX -- Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Each solution must use the appropriate MEX variant for the constraints.

---

## Beginner Tasks

### Task 1 -- MEX of an Array

Given a non-negative integer array `a`, return its MEX in O(n) time using the bucket method.

**Example:** `[0, 1, 2, 4]` -> `3`; `[]` -> `0`; `[1, 2, 3]` -> `0`.

#### Go

```go
package main

import "fmt"

func MEX(a []int) int {
    n := len(a)
    seen := make([]bool, n+1)
    for _, v := range a {
        if v >= 0 && v <= n {
            seen[v] = true
        }
    }
    for i := 0; i <= n; i++ {
        if !seen[i] {
            return i
        }
    }
    return n + 1
}

func main() {
    fmt.Println(MEX([]int{0, 1, 2, 4})) // 3
    fmt.Println(MEX([]int{}))           // 0
    fmt.Println(MEX([]int{1, 2, 3}))    // 0
}
```

#### Java

```java
public class Task1 {
    public static int mex(int[] a) {
        int n = a.length;
        boolean[] seen = new boolean[n + 1];
        for (int v : a) if (v >= 0 && v <= n) seen[v] = true;
        for (int i = 0; i <= n; i++) if (!seen[i]) return i;
        return n + 1;
    }

    public static void main(String[] args) {
        System.out.println(mex(new int[]{0, 1, 2, 4})); // 3
        System.out.println(mex(new int[]{}));           // 0
        System.out.println(mex(new int[]{1, 2, 3}));    // 0
    }
}
```

#### Python

```python
def mex(a):
    n = len(a)
    seen = [False] * (n + 1)
    for v in a:
        if 0 <= v <= n:
            seen[v] = True
    for i in range(n + 1):
        if not seen[i]:
            return i
    return n + 1


if __name__ == "__main__":
    print(mex([0, 1, 2, 4]))  # 3
    print(mex([]))            # 0
    print(mex([1, 2, 3]))     # 0
```

---

### Task 2 -- MEX with Negative Values Filtered

Same problem but the input may contain arbitrary integers including negatives. Negatives must be ignored (MEX is defined over non-negative integers).

**Example:** `[-3, 0, 1, -1, 2, 4]` -> `3`.

#### Go

```go
func MEXFiltered(a []int) int {
    n := len(a)
    seen := make([]bool, n+1)
    for _, v := range a {
        if v >= 0 && v <= n {
            seen[v] = true
        }
    }
    for i := 0; i <= n; i++ {
        if !seen[i] {
            return i
        }
    }
    return n + 1
}
```

#### Java

```java
public static int mexFiltered(int[] a) {
    int n = a.length;
    boolean[] seen = new boolean[n + 1];
    for (int v : a) if (v >= 0 && v <= n) seen[v] = true;
    for (int i = 0; i <= n; i++) if (!seen[i]) return i;
    return n + 1;
}
```

#### Python

```python
def mex_filtered(a):
    n = len(a)
    seen = [False] * (n + 1)
    for v in a:
        if 0 <= v <= n:
            seen[v] = True
    for i in range(n + 1):
        if not seen[i]:
            return i
    return n + 1
```

The bucket guard `0 <= v <= n` does the filtering automatically -- no extra pass.

---

### Task 3 -- MEX with Huge Value Range (Hash-Set Variant)

Given `n <= 10^5` and individual values up to `10^18`, compute MEX. Bucket of size `10^18` is impossible -- use a hash set scanning upward from 0.

**Example:** `[5, 10**18, 1, 2, 0]` -> `3`.

#### Go

```go
func MEXHash(a []int64) int64 {
    s := map[int64]struct{}{}
    for _, v := range a {
        if v >= 0 {
            s[v] = struct{}{}
        }
    }
    var i int64 = 0
    for {
        if _, ok := s[i]; !ok {
            return i
        }
        i++
    }
}
```

#### Java

```java
import java.util.HashSet;

public static long mexHash(long[] a) {
    HashSet<Long> s = new HashSet<>();
    for (long v : a) if (v >= 0) s.add(v);
    long i = 0;
    while (s.contains(i)) i++;
    return i;
}
```

#### Python

```python
def mex_hash(a):
    s = set(v for v in a if v >= 0)
    i = 0
    while i in s:
        i += 1
    return i
```

**Constraint:** the answer is still bounded by `len(a)`, so the loop terminates in at most `n + 1` iterations.

---

### Task 4 -- MEX of Every Prefix (Prefix MEX)

Given `a[0..n-1]`, return `m` where `m[i] = MEX(a[0..i])`. Must run in O(n) total time using an incremental MEX pointer.

**Example:** `[2, 0, 1, 3]` -> `[0, 0, 3, 4]`.

#### Go

```go
func PrefixMEX(a []int) []int {
    n := len(a)
    m := make([]int, n)
    seen := make([]bool, n+1)
    mex := 0
    for i, v := range a {
        if v >= 0 && v <= n {
            seen[v] = true
        }
        for mex <= n && seen[mex] {
            mex++
        }
        m[i] = mex
    }
    return m
}
```

#### Java

```java
public static int[] prefixMex(int[] a) {
    int n = a.length;
    int[] m = new int[n];
    boolean[] seen = new boolean[n + 1];
    int mex = 0;
    for (int i = 0; i < n; i++) {
        int v = a[i];
        if (v >= 0 && v <= n) seen[v] = true;
        while (mex <= n && seen[mex]) mex++;
        m[i] = mex;
    }
    return m;
}
```

#### Python

```python
def prefix_mex(a):
    n = len(a)
    m = [0] * n
    seen = [False] * (n + 1)
    mex = 0
    for i, v in enumerate(a):
        if 0 <= v <= n:
            seen[v] = True
        while mex <= n and seen[mex]:
            mex += 1
        m[i] = mex
    return m
```

The amortized work per index is O(1) because the `mex` pointer is monotone non-decreasing.

---

### Task 5 -- First Missing Positive (LeetCode 41)

In-place 1-indexed MEX over positive integers in O(n) time and O(1) extra space.

**Example:** `[3, 4, -1, 1]` -> `2`; `[7, 8, 9, 11]` -> `1`.

#### Go

```go
func FirstMissingPositive(nums []int) int {
    n := len(nums)
    for i := 0; i < n; i++ {
        for nums[i] >= 1 && nums[i] <= n && nums[nums[i]-1] != nums[i] {
            nums[i], nums[nums[i]-1] = nums[nums[i]-1], nums[i]
        }
    }
    for i := 0; i < n; i++ {
        if nums[i] != i+1 {
            return i + 1
        }
    }
    return n + 1
}
```

#### Java

```java
public static int firstMissingPositive(int[] nums) {
    int n = nums.length;
    for (int i = 0; i < n; i++) {
        while (nums[i] >= 1 && nums[i] <= n && nums[nums[i] - 1] != nums[i]) {
            int t = nums[nums[i] - 1];
            nums[nums[i] - 1] = nums[i];
            nums[i] = t;
        }
    }
    for (int i = 0; i < n; i++) {
        if (nums[i] != i + 1) return i + 1;
    }
    return n + 1;
}
```

#### Python

```python
def first_missing_positive(nums):
    n = len(nums)
    for i in range(n):
        while 1 <= nums[i] <= n and nums[nums[i] - 1] != nums[i]:
            j = nums[i] - 1
            nums[i], nums[j] = nums[j], nums[i]
    for i in range(n):
        if nums[i] != i + 1:
            return i + 1
    return n + 1
```

---

## Intermediate Tasks

### Task 6 -- Dynamic MEX with Insert and Delete

Implement a data structure supporting `insert(v)`, `delete(v)`, and `mex()` in O(log n) per operation. Cap is given at construction.

**Example operations:**
```
insert(0); insert(1); insert(2); mex() -> 3
insert(4); mex() -> 3
delete(1); mex() -> 1
```

#### Go

```go
package main

import "fmt"

type DynMEX struct {
    cap   int
    size  int
    tree  []int
    count map[int]int
}

func NewDynMEX(cap int) *DynMEX {
    sz := 1
    for sz <= cap {
        sz *= 2
    }
    m := &DynMEX{cap: cap, size: sz, tree: make([]int, 2*sz), count: map[int]int{}}
    for i := 0; i <= cap; i++ {
        m.tree[sz+i] = 1
    }
    for i := sz - 1; i > 0; i-- {
        m.tree[i] = m.tree[2*i] + m.tree[2*i+1]
    }
    return m
}

func (m *DynMEX) set(i, val int) {
    i += m.size
    m.tree[i] = val
    for i /= 2; i > 0; i /= 2 {
        m.tree[i] = m.tree[2*i] + m.tree[2*i+1]
    }
}

func (m *DynMEX) Insert(v int) {
    if v < 0 || v > m.cap {
        return
    }
    m.count[v]++
    if m.count[v] == 1 {
        m.set(v, 0)
    }
}

func (m *DynMEX) Delete(v int) {
    if v < 0 || v > m.cap || m.count[v] == 0 {
        return
    }
    m.count[v]--
    if m.count[v] == 0 {
        m.set(v, 1)
    }
}

func (m *DynMEX) MEX() int {
    node := 1
    for node < m.size {
        if m.tree[2*node] > 0 {
            node = 2 * node
        } else {
            node = 2*node + 1
        }
    }
    return node - m.size
}

func main() {
    m := NewDynMEX(10)
    for _, v := range []int{0, 1, 2} { m.Insert(v) }
    fmt.Println(m.MEX()) // 3
    m.Insert(4)
    fmt.Println(m.MEX()) // 3
    m.Delete(1)
    fmt.Println(m.MEX()) // 1
}
```

#### Java

```java
import java.util.TreeSet;
import java.util.HashMap;

public class DynamicMEX {
    private final TreeSet<Integer> missing = new TreeSet<>();
    private final HashMap<Integer, Integer> count = new HashMap<>();
    private final int cap;

    public DynamicMEX(int cap) {
        this.cap = cap;
        for (int i = 0; i <= cap; i++) missing.add(i);
    }

    public void insert(int v) {
        if (v < 0 || v > cap) return;
        int c = count.getOrDefault(v, 0);
        if (c == 0) missing.remove(v);
        count.put(v, c + 1);
    }

    public void delete(int v) {
        if (v < 0 || v > cap) return;
        Integer c = count.get(v);
        if (c == null || c == 0) return;
        count.put(v, c - 1);
        if (c - 1 == 0) missing.add(v);
    }

    public int mex() {
        return missing.first();
    }

    public static void main(String[] args) {
        DynamicMEX m = new DynamicMEX(10);
        for (int v : new int[]{0, 1, 2}) m.insert(v);
        System.out.println(m.mex()); // 3
        m.insert(4);
        System.out.println(m.mex()); // 3
        m.delete(1);
        System.out.println(m.mex()); // 1
    }
}
```

#### Python

```python
from sortedcontainers import SortedList
from collections import Counter


class DynamicMEX:
    def __init__(self, cap):
        self.cap = cap
        self.missing = SortedList(range(cap + 1))
        self.count = Counter()

    def insert(self, v):
        if not (0 <= v <= self.cap):
            return
        if self.count[v] == 0:
            self.missing.discard(v)
        self.count[v] += 1

    def delete(self, v):
        if not (0 <= v <= self.cap) or self.count[v] == 0:
            return
        self.count[v] -= 1
        if self.count[v] == 0:
            self.missing.add(v)

    def mex(self):
        return self.missing[0]


if __name__ == "__main__":
    m = DynamicMEX(10)
    for v in (0, 1, 2):
        m.insert(v)
    print(m.mex())  # 3
    m.insert(4)
    print(m.mex())  # 3
    m.delete(1)
    print(m.mex())  # 1
```

---

### Task 7 -- MEX After K Insertions

Given an initial array and a stream of `k` insertions, report MEX after the array plus all `k` insertions. Use the bucket method extended to `n + k + 1`.

**Example:** initial `[0, 2]`, insertions `[1, 4]` -> MEX = 3.

#### Go

```go
func MEXAfterInsertions(initial []int, insertions []int) int {
    total := len(initial) + len(insertions)
    seen := make([]bool, total+1)
    for _, v := range initial {
        if v >= 0 && v <= total {
            seen[v] = true
        }
    }
    for _, v := range insertions {
        if v >= 0 && v <= total {
            seen[v] = true
        }
    }
    for i := 0; i <= total; i++ {
        if !seen[i] {
            return i
        }
    }
    return total + 1
}
```

#### Java

```java
public static int mexAfterInsertions(int[] initial, int[] insertions) {
    int total = initial.length + insertions.length;
    boolean[] seen = new boolean[total + 1];
    for (int v : initial) if (v >= 0 && v <= total) seen[v] = true;
    for (int v : insertions) if (v >= 0 && v <= total) seen[v] = true;
    for (int i = 0; i <= total; i++) if (!seen[i]) return i;
    return total + 1;
}
```

#### Python

```python
def mex_after_insertions(initial, insertions):
    total = len(initial) + len(insertions)
    seen = [False] * (total + 1)
    for v in initial + insertions:
        if 0 <= v <= total:
            seen[v] = True
    for i in range(total + 1):
        if not seen[i]:
            return i
    return total + 1
```

---

### Task 8 -- Grundy Number for the Subtraction Game (1, 3, 4)

Players remove 1, 3, or 4 stones per turn from a single pile of `n`. Last to move wins. Compute Grundy(n).

**Example:** Grundy values for n = 0..10: `[0, 1, 0, 1, 2, 3, 2, 0, 1, 0, 1]`.

#### Go

```go
package main

import "fmt"

var memo = map[int]int{}

func grundy(n int) int {
    if n == 0 {
        return 0
    }
    if g, ok := memo[n]; ok {
        return g
    }
    reach := map[int]bool{}
    for _, m := range []int{1, 3, 4} {
        if n >= m {
            reach[grundy(n-m)] = true
        }
    }
    g := 0
    for reach[g] {
        g++
    }
    memo[n] = g
    return g
}

func main() {
    for i := 0; i <= 10; i++ {
        fmt.Print(grundy(i), " ")
    }
    fmt.Println()
}
```

#### Java

```java
import java.util.HashMap;
import java.util.HashSet;

public class SubtractionGame {
    static HashMap<Integer, Integer> memo = new HashMap<>();

    public static int grundy(int n) {
        if (n == 0) return 0;
        if (memo.containsKey(n)) return memo.get(n);
        HashSet<Integer> reach = new HashSet<>();
        for (int m : new int[]{1, 3, 4}) {
            if (n >= m) reach.add(grundy(n - m));
        }
        int g = 0;
        while (reach.contains(g)) g++;
        memo.put(n, g);
        return g;
    }

    public static void main(String[] args) {
        for (int i = 0; i <= 10; i++) System.out.print(grundy(i) + " ");
        System.out.println();
    }
}
```

#### Python

```python
from functools import lru_cache


@lru_cache(maxsize=None)
def grundy(n):
    if n == 0:
        return 0
    reach = set()
    for m in (1, 3, 4):
        if n >= m:
            reach.add(grundy(n - m))
    g = 0
    while g in reach:
        g += 1
    return g


print([grundy(i) for i in range(11)])
```

---

### Task 9 -- Bitset MEX for Large Arrays

Use a packed bitset (Java BitSet, Go `math/big.Int`, Python `bytearray`) to compute MEX of arrays with `n` up to `10^7`. Should be at least 4x faster than the boolean-slice version.

#### Go

```go
package main

import (
    "fmt"
    "math/bits"
)

func MEXBitset(a []int) int {
    n := len(a)
    words := (n + 64) / 64
    seen := make([]uint64, words)
    for _, v := range a {
        if v >= 0 && v <= n {
            seen[v/64] |= 1 << uint(v%64)
        }
    }
    for w := 0; w < words; w++ {
        if seen[w] != ^uint64(0) {
            b := bits.TrailingZeros64(^seen[w])
            mex := w*64 + b
            if mex > n {
                return n + 1
            }
            return mex
        }
    }
    return n + 1
}

func main() {
    fmt.Println(MEXBitset([]int{0, 1, 2, 4})) // 3
}
```

#### Java

```java
import java.util.BitSet;

public static int mexBitset(int[] a) {
    int n = a.length;
    BitSet seen = new BitSet(n + 1);
    for (int v : a) if (v >= 0 && v <= n) seen.set(v);
    int m = seen.nextClearBit(0);
    return Math.min(m, n + 1);
}
```

#### Python

```python
def mex_bitset(a):
    n = len(a)
    seen = bytearray((n + 8) // 8)
    for v in a:
        if 0 <= v <= n:
            seen[v >> 3] |= 1 << (v & 7)
    for i, b in enumerate(seen):
        if b != 0xFF:
            for bit in range(8):
                if not (b >> bit) & 1:
                    return min(i * 8 + bit, n + 1)
    return n + 1
```

---

### Task 10 -- Concurrent MEX Allocator

Build an ID allocator with `allocate()` returning the smallest unused ID and `release(id)` returning it to the pool. Must be thread-safe.

#### Go

```go
package main

import (
    "fmt"
    "sync"
)

type MEXAllocator struct {
    mu     sync.Mutex
    used   map[int]bool
    nextHi int
}

func NewMEXAllocator() *MEXAllocator {
    return &MEXAllocator{used: map[int]bool{}}
}

func (a *MEXAllocator) Allocate() int {
    a.mu.Lock()
    defer a.mu.Unlock()
    for i := 0; ; i++ {
        if !a.used[i] {
            a.used[i] = true
            if i >= a.nextHi {
                a.nextHi = i + 1
            }
            return i
        }
    }
}

func (a *MEXAllocator) Release(id int) {
    a.mu.Lock()
    defer a.mu.Unlock()
    delete(a.used, id)
}

func main() {
    a := NewMEXAllocator()
    fmt.Println(a.Allocate(), a.Allocate(), a.Allocate()) // 0 1 2
    a.Release(1)
    fmt.Println(a.Allocate()) // 1
}
```

The scan-from-zero is O(n) per allocate in the worst case. For better performance use a TreeSet of free IDs as in `senior.md`.

#### Java

```java
import java.util.TreeSet;

public class MEXAllocator {
    private final TreeSet<Integer> free = new TreeSet<>();
    private int highWater = 0;

    public synchronized int allocate() {
        if (!free.isEmpty()) return free.pollFirst();
        return highWater++;
    }

    public synchronized void release(int id) {
        free.add(id);
    }

    public static void main(String[] args) {
        MEXAllocator a = new MEXAllocator();
        System.out.println(a.allocate() + " " + a.allocate() + " " + a.allocate());
        a.release(1);
        System.out.println(a.allocate());
    }
}
```

#### Python

```python
import threading
from sortedcontainers import SortedList


class MEXAllocator:
    def __init__(self):
        self.free = SortedList()
        self.high = 0
        self.lock = threading.Lock()

    def allocate(self):
        with self.lock:
            if self.free:
                return self.free.pop(0)
            v = self.high
            self.high += 1
            return v

    def release(self, v):
        with self.lock:
            self.free.add(v)
```

---

## Advanced Tasks

### Task 11 -- Range MEX with Persistent Segment Tree

Given a static array and `q` online queries `(l, r)`, return MEX(a[l..r]) per query in O(log n).

#### Python (sketch with arrays)

```python
import sys
sys.setrecursionlimit(1 << 25)


class PersistentMEX:
    """
    Each version captures a prefix a[0..i]. Leaves store last-occurrence
    index per value. Internal nodes store min of children. Query: descend
    preferring left when left's min < l.
    """
    def __init__(self, a):
        self.n = len(a)
        self.V = self.n + 1
        self.left = [0]
        self.right = [0]
        self.min_idx = [-1]  # node 0 is the all-(-1) base
        self.roots = [0]

        def build(lo, hi):
            node = len(self.min_idx)
            self.left.append(0)
            self.right.append(0)
            self.min_idx.append(-1)
            if lo == hi:
                return node
            mid = (lo + hi) // 2
            self.left[node] = build(lo, mid)
            self.right[node] = build(mid + 1, hi)
            return node

        root = build(0, self.V - 1)
        self.roots[0] = root
        for i, v in enumerate(a):
            new_root = self.update(self.roots[-1], 0, self.V - 1, v if 0 <= v <= self.n else self.n, i)
            self.roots.append(new_root)

    def update(self, prev, lo, hi, pos, val):
        node = len(self.min_idx)
        self.left.append(self.left[prev])
        self.right.append(self.right[prev])
        self.min_idx.append(self.min_idx[prev])
        if lo == hi:
            self.min_idx[node] = val
            return node
        mid = (lo + hi) // 2
        if pos <= mid:
            self.left[node] = self.update(self.left[prev], lo, mid, pos, val)
        else:
            self.right[node] = self.update(self.right[prev], mid + 1, hi, pos, val)
        self.min_idx[node] = min(self.min_idx[self.left[node]], self.min_idx[self.right[node]])
        return node

    def query(self, l, r):
        node = self.roots[r + 1]
        lo, hi = 0, self.V - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if self.min_idx[self.left[node]] < l:
                node = self.left[node]
                hi = mid
            else:
                node = self.right[node]
                lo = mid + 1
        return lo


a = [1, 0, 2, 0, 3]
p = PersistentMEX(a)
print(p.query(0, 2))  # MEX([1,0,2]) = 3
print(p.query(2, 4))  # MEX([2,0,3]) = 1
```

(Go and Java implementations follow the same shape; both languages benefit from explicit struct arrays rather than per-node allocation.)

---

### Task 12 -- Range MEX with Mo's Algorithm

Offline range MEX with `n, q <= 10^5`. Sort queries by Mo's block ordering; maintain a frequency array and a missing-set heap or sqrt-decomposed structure.

#### Python (sqrt-decomp missing pointer)

```python
import math


def range_mex_mo(a, queries):
    n = len(a)
    block = max(1, int(math.sqrt(n)))
    indexed = list(enumerate(queries))
    indexed.sort(key=lambda x: (x[1][0] // block, x[1][1]))

    freq = [0] * (n + 2)
    missing = [True] * (n + 2)
    answers = [0] * len(queries)
    cur_l, cur_r = 0, -1

    def add(v):
        if 0 <= v <= n:
            freq[v] += 1
            if freq[v] == 1:
                missing[v] = False

    def remove(v):
        if 0 <= v <= n:
            freq[v] -= 1
            if freq[v] == 0:
                missing[v] = True

    for idx, (l, r) in indexed:
        while cur_r < r:
            cur_r += 1
            add(a[cur_r])
        while cur_l > l:
            cur_l -= 1
            add(a[cur_l])
        while cur_r > r:
            remove(a[cur_r])
            cur_r -= 1
        while cur_l < l:
            remove(a[cur_l])
            cur_l += 1
        # Scan missing from 0 -- this is the slow part
        mex = 0
        while mex <= n and not missing[mex]:
            mex += 1
        answers[idx] = mex
    return answers


print(range_mex_mo([1, 0, 2, 0, 3], [(0, 2), (2, 4), (0, 4)]))
```

Total complexity: O((n + q) * sqrt(n) * cost-of-mex-scan). With a proper sqrt-decomposed missing structure (each operation O(sqrt(n))), the bound is `O((n + q) sqrt(n))` matching the lower bound for natural models.

---

### Task 13 -- Distributed MEX Coordinator

Implement the distributed-MEX protocol: each "shard" exposes a presence bitset capped at a threshold T; the coordinator OR-merges and returns the global MEX. Provide a simple in-process simulation.

#### Go

```go
package main

import (
    "fmt"
    "math/bits"
)

type Shard struct {
    values []int
}

func (s *Shard) LocalBitset(T int) []uint64 {
    words := (T + 63) / 64
    bs := make([]uint64, words)
    for _, v := range s.values {
        if v >= 0 && v < T {
            bs[v/64] |= 1 << uint(v%64)
        }
    }
    return bs
}

func DistributedMEX(shards []*Shard, T int) int {
    words := (T + 63) / 64
    merged := make([]uint64, words)
    for _, s := range shards {
        bs := s.LocalBitset(T)
        for i := range merged {
            merged[i] |= bs[i]
        }
    }
    for w, x := range merged {
        if x != ^uint64(0) {
            return w*64 + bits.TrailingZeros64(^x)
        }
    }
    return T
}

func main() {
    s1 := &Shard{values: []int{0, 2, 4}}
    s2 := &Shard{values: []int{1, 3}}
    s3 := &Shard{values: []int{6}}
    fmt.Println(DistributedMEX([]*Shard{s1, s2, s3}, 64)) // 5
}
```

#### Java

```java
import java.util.BitSet;
import java.util.List;

public class DistributedMEX {
    static class Shard {
        int[] values;
        Shard(int[] v) { values = v; }
        BitSet localBitset(int T) {
            BitSet bs = new BitSet(T);
            for (int v : values) if (v >= 0 && v < T) bs.set(v);
            return bs;
        }
    }

    public static int compute(List<Shard> shards, int T) {
        BitSet merged = new BitSet(T);
        for (Shard s : shards) merged.or(s.localBitset(T));
        int m = merged.nextClearBit(0);
        return Math.min(m, T);
    }

    public static void main(String[] args) {
        System.out.println(compute(List.of(
            new Shard(new int[]{0, 2, 4}),
            new Shard(new int[]{1, 3}),
            new Shard(new int[]{6})
        ), 64)); // 5
    }
}
```

#### Python

```python
def distributed_mex(shards, T):
    merged = bytearray((T + 7) // 8)
    for shard in shards:
        local = bytearray((T + 7) // 8)
        for v in shard:
            if 0 <= v < T:
                local[v >> 3] |= 1 << (v & 7)
        for i in range(len(merged)):
            merged[i] |= local[i]
    for i, b in enumerate(merged):
        if b != 0xFF:
            for bit in range(8):
                if not (b >> bit) & 1:
                    return min(i * 8 + bit, T)
    return T


print(distributed_mex([[0, 2, 4], [1, 3], [6]], 64))  # 5
```

---

### Task 14 -- Sprague-Grundy XOR for Multi-Pile Game

Given multiple piles, each playing under different rules, compute the XOR of Grundy values and decide the winner.

#### Python (general framework)

```python
from functools import lru_cache


def make_grundy(moves):
    @lru_cache(maxsize=None)
    def g(n):
        if n == 0:
            return 0
        reach = set()
        for m in moves:
            if n >= m:
                reach.add(g(n - m))
        gv = 0
        while gv in reach:
            gv += 1
        return gv
    return g


def multi_pile_winner(piles_and_rules):
    """piles_and_rules: list of (pile_size, moves_tuple)."""
    xor = 0
    for size, moves in piles_and_rules:
        xor ^= make_grundy(moves)(size)
    return "first" if xor else "second"


print(multi_pile_winner([(7, (1, 3, 4)), (5, (1, 2)), (3, (2, 3))]))
```

(Go and Java follow the same shape with HashMap memoization.)

---

### Task 15 -- Online Incremental MEX with Concurrent Inserts

Build a structure supporting concurrent `insert(v)` and `mex()`. Inserts are batched per thread; MEX is read by a single observer thread. Use atomic ops where possible.

#### Go (atomic bitset)

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type ConcurrentMEX struct {
    bits []uint64
    mex  atomic.Int64
}

func NewConcurrentMEX(cap int) *ConcurrentMEX {
    return &ConcurrentMEX{bits: make([]uint64, (cap+64)/64)}
}

func (c *ConcurrentMEX) Insert(v int) {
    if v < 0 || v >= len(c.bits)*64 {
        return
    }
    for {
        old := atomic.LoadUint64(&c.bits[v/64])
        newVal := old | (1 << uint(v%64))
        if atomic.CompareAndSwapUint64(&c.bits[v/64], old, newVal) {
            return
        }
    }
}

func (c *ConcurrentMEX) MEX() int {
    m := c.mex.Load()
    for m < int64(len(c.bits)*64) {
        bit := (atomic.LoadUint64(&c.bits[m/64]) >> uint(m%64)) & 1
        if bit == 0 {
            break
        }
        m++
    }
    c.mex.Store(m)
    return int(m)
}

func main() {
    c := NewConcurrentMEX(1024)
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(v int) {
            defer wg.Done()
            c.Insert(v)
        }(i)
    }
    wg.Wait()
    fmt.Println(c.MEX()) // 100
}
```

The MEX pointer is advanced lazily on read. Inserts use CAS on the relevant word; collisions are rare in practice.

#### Java (AtomicLongArray-backed bitset)

```java
import java.util.concurrent.atomic.AtomicLongArray;

public class ConcurrentMEXBits {
    private final AtomicLongArray bits;
    private volatile int mexHint = 0;

    public ConcurrentMEXBits(int cap) {
        bits = new AtomicLongArray((cap + 64) / 64);
    }

    public void insert(int v) {
        if (v < 0 || v >= bits.length() * 64) return;
        int w = v / 64;
        long mask = 1L << (v % 64);
        long old;
        do {
            old = bits.get(w);
            if ((old & mask) != 0) return;
        } while (!bits.compareAndSet(w, old, old | mask));
    }

    public synchronized int mex() {
        int m = mexHint;
        while (m < bits.length() * 64) {
            long word = bits.get(m / 64);
            if (((word >> (m % 64)) & 1L) == 0) break;
            m++;
        }
        mexHint = m;
        return m;
    }
}
```

#### Python (asyncio + lock)

```python
import asyncio


class ConcurrentMEX:
    def __init__(self, cap):
        self.bits = bytearray((cap + 8) // 8)
        self.mex = 0
        self.lock = asyncio.Lock()

    async def insert(self, v):
        async with self.lock:
            self.bits[v >> 3] |= 1 << (v & 7)

    async def query_mex(self):
        async with self.lock:
            while self.mex < len(self.bits) * 8:
                if not (self.bits[self.mex >> 3] >> (self.mex & 7)) & 1:
                    break
                self.mex += 1
            return self.mex
```

---

## Benchmark Task

> Compare bucket, hash-set, and bitset MEX on arrays of size 10^3 through 10^7.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func benchBucket(a []int) int {
    n := len(a)
    seen := make([]bool, n+1)
    for _, v := range a {
        if v >= 0 && v <= n {
            seen[v] = true
        }
    }
    for i := 0; i <= n; i++ {
        if !seen[i] {
            return i
        }
    }
    return n + 1
}

func benchHash(a []int) int {
    s := map[int]struct{}{}
    for _, v := range a {
        if v >= 0 {
            s[v] = struct{}{}
        }
    }
    i := 0
    for {
        if _, ok := s[i]; !ok {
            return i
        }
        i++
    }
}

func main() {
    sizes := []int{1000, 10000, 100000, 1000000, 10000000}
    for _, n := range sizes {
        a := make([]int, n)
        for i := range a {
            a[i] = rand.Intn(2 * n)
        }
        t0 := time.Now()
        benchBucket(a)
        bucket := time.Since(t0)
        t0 = time.Now()
        benchHash(a)
        hash := time.Since(t0)
        fmt.Printf("n=%8d bucket=%v hash=%v\n", n, bucket, hash)
    }
}
```

#### Java

```java
import java.util.HashSet;
import java.util.Random;

public class MEXBenchmark {
    static int bucket(int[] a) {
        int n = a.length;
        boolean[] seen = new boolean[n + 1];
        for (int v : a) if (v >= 0 && v <= n) seen[v] = true;
        for (int i = 0; i <= n; i++) if (!seen[i]) return i;
        return n + 1;
    }

    static int hash(int[] a) {
        HashSet<Integer> s = new HashSet<>();
        for (int v : a) if (v >= 0) s.add(v);
        int i = 0;
        while (s.contains(i)) i++;
        return i;
    }

    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000, 10000000};
        Random r = new Random(42);
        for (int n : sizes) {
            int[] a = new int[n];
            for (int i = 0; i < n; i++) a[i] = r.nextInt(2 * n);
            long t0 = System.nanoTime();
            bucket(a);
            long bucketNs = System.nanoTime() - t0;
            t0 = System.nanoTime();
            hash(a);
            long hashNs = System.nanoTime() - t0;
            System.out.printf("n=%8d bucket=%.2fms hash=%.2fms%n",
                n, bucketNs / 1e6, hashNs / 1e6);
        }
    }
}
```

#### Python

```python
import random
import timeit


def bucket(a):
    n = len(a)
    seen = [False] * (n + 1)
    for v in a:
        if 0 <= v <= n:
            seen[v] = True
    for i in range(n + 1):
        if not seen[i]:
            return i
    return n + 1


def hash_mex(a):
    s = set(v for v in a if v >= 0)
    i = 0
    while i in s:
        i += 1
    return i


for n in (1_000, 10_000, 100_000, 1_000_000):
    a = [random.randint(0, 2 * n) for _ in range(n)]
    t_bucket = timeit.timeit(lambda: bucket(a), number=3) / 3
    t_hash = timeit.timeit(lambda: hash_mex(a), number=3) / 3
    print(f"n={n:>7} bucket={t_bucket*1000:.2f}ms hash={t_hash*1000:.2f}ms")
```

**Expected pattern:** bucket is consistently 2-5x faster than hash for moderate n; bitset is faster still on large n thanks to hardware-accelerated `nextClearBit` / `TrailingZeros64`. Hash gains ground when the value range is much larger than `n`, where bucket would fail entirely.

---

## Evaluation Criteria

| Tier | Pass / Fail |
|------|-------------|
| Beginner | All 5 tasks pass on the example inputs and handle empty / single / duplicate / negative inputs correctly |
| Intermediate | Tasks 6-10 maintain correct MEX under random insert/delete sequences; benchmarks show expected O(log n) or O(1) amortized scaling |
| Advanced | Tasks 11-15 handle 10^5+ scale within time limits; concurrent variants pass stress tests with race detectors enabled |
| Benchmark | bucket beats hash by 2-5x on uniform input; bitset variant beats bucket by 4-8x on large `n` |

The goal of these tasks is to internalize the structural invariant `MEX <= n`, the bucket trick, the amortized incremental pattern, and the structural variants needed for dynamic, range, and distributed settings.
