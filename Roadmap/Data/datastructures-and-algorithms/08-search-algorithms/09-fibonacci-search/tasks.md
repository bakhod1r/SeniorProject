# Fibonacci Search — Practice Tasks

> 15 graded practice problems with full Go / Java / Python solutions. Each task starts with a **problem statement**, gives **constraints**, then provides three implementations. Difficulty grows from "first Fibonacci search" to "golden-section in production".

---

## Task 1 — Classic Fibonacci Search

**Problem.** Given a sorted array `arr[]` and a target `t`, return the index of `t`, or `-1` if absent. **Use only addition and subtraction — no division, no multiplication.**

**Constraints.** `0 <= n <= 10^5`, distinct values, `arr` sorted ascending.

**Go:**
```go
func fibSearch(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return -1 }
    fm2, fm1, fm := 0, 1, 1
    for fm < n { fm2, fm1, fm = fm1, fm, fm1+fm }
    offset := -1
    for fm > 1 {
        i := offset + fm2
        if i >= n { i = n - 1 }
        if arr[i] == t { return i }
        if arr[i] < t {
            fm = fm1; fm1 = fm2; fm2 = fm - fm1
            offset = i
        } else {
            newFm1 := fm1 - fm2
            fm = fm2; fm1 = newFm1; fm2 = fm - newFm1
        }
    }
    if fm1 == 1 && offset+1 < n && arr[offset+1] == t { return offset + 1 }
    return -1
}
```

**Java:**
```java
int fibSearch(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return -1;
    int fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) { fm2 = fm1; fm1 = fm; fm = fm2 + fm1; }
    int offset = -1;
    while (fm > 1) {
        int i = Math.min(offset + fm2, n - 1);
        if (arr[i] == t) return i;
        if (arr[i] < t) {
            fm = fm1; fm1 = fm2; fm2 = fm - fm1;
            offset = i;
        } else {
            int newFm1 = fm1 - fm2;
            fm = fm2; fm1 = newFm1; fm2 = fm - newFm1;
        }
    }
    if (fm1 == 1 && offset + 1 < n && arr[offset + 1] == t) return offset + 1;
    return -1;
}
```

**Python:**
```python
def fib_search(arr, t):
    n = len(arr)
    if n == 0: return -1
    fm2, fm1, fm = 0, 1, 1
    while fm < n: fm2, fm1, fm = fm1, fm, fm1 + fm
    offset = -1
    while fm > 1:
        i = min(offset + fm2, n - 1)
        if arr[i] == t: return i
        if arr[i] < t:
            fm, fm1, fm2 = fm1, fm2, fm1 - fm2
            offset = i
        else:
            new_fm1 = fm1 - fm2
            fm, fm1, fm2 = fm2, new_fm1, fm2 - new_fm1
    if fm1 == 1 and offset + 1 < n and arr[offset + 1] == t:
        return offset + 1
    return -1
```

---

## Task 2 — Verbose Fibonacci Search (Logging Each Step)

**Problem.** Log `(Fm, Fm-1, Fm-2, offset, probe, arr[probe])` at each step. Useful as a debugging aid and for understanding the algorithm.

**Go:**
```go
func fibSearchVerbose(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return -1 }
    fm2, fm1, fm := 0, 1, 1
    for fm < n { fm2, fm1, fm = fm1, fm, fm1+fm }
    offset, step := -1, 0
    for fm > 1 {
        step++
        i := offset + fm2
        if i >= n { i = n - 1 }
        fmt.Printf("step %d: Fm=%d Fm1=%d Fm2=%d offset=%d probe=%d arr[%d]=%d\n",
            step, fm, fm1, fm2, offset, i, i, arr[i])
        if arr[i] == t { return i }
        if arr[i] < t {
            fm = fm1; fm1 = fm2; fm2 = fm - fm1
            offset = i
        } else {
            newFm1 := fm1 - fm2
            fm = fm2; fm1 = newFm1; fm2 = fm - newFm1
        }
    }
    if fm1 == 1 && offset+1 < n && arr[offset+1] == t { return offset + 1 }
    return -1
}
```

**Java:**
```java
int fibSearchVerbose(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return -1;
    int fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) { fm2 = fm1; fm1 = fm; fm = fm2 + fm1; }
    int offset = -1, step = 0;
    while (fm > 1) {
        step++;
        int i = Math.min(offset + fm2, n - 1);
        System.out.printf("step %d: Fm=%d Fm1=%d Fm2=%d offset=%d probe=%d arr[%d]=%d%n",
            step, fm, fm1, fm2, offset, i, i, arr[i]);
        if (arr[i] == t) return i;
        if (arr[i] < t) { fm = fm1; fm1 = fm2; fm2 = fm - fm1; offset = i; }
        else { int newFm1 = fm1 - fm2; fm = fm2; fm1 = newFm1; fm2 = fm - newFm1; }
    }
    if (fm1 == 1 && offset + 1 < n && arr[offset + 1] == t) return offset + 1;
    return -1;
}
```

**Python:**
```python
def fib_search_verbose(arr, t):
    n = len(arr)
    if n == 0: return -1
    fm2, fm1, fm = 0, 1, 1
    while fm < n: fm2, fm1, fm = fm1, fm, fm1 + fm
    offset, step = -1, 0
    while fm > 1:
        step += 1
        i = min(offset + fm2, n - 1)
        print(f"step {step}: Fm={fm} Fm1={fm1} Fm2={fm2} offset={offset} probe={i} arr[{i}]={arr[i]}")
        if arr[i] == t: return i
        if arr[i] < t:
            fm, fm1, fm2 = fm1, fm2, fm1 - fm2
            offset = i
        else:
            new_fm1 = fm1 - fm2
            fm, fm1, fm2 = fm2, new_fm1, fm2 - new_fm1
    if fm1 == 1 and offset + 1 < n and arr[offset + 1] == t:
        return offset + 1
    return -1
```

---

## Task 3 — Find Smallest Fibonacci ≥ n

**Problem.** Return the triple `(Fm-2, Fm-1, Fm)` such that `Fm` is the smallest Fibonacci ≥ n. Used as a setup helper.

**Go:**
```go
func smallestFibAtLeast(n int) (int, int, int) {
    fm2, fm1, fm := 0, 1, 1
    for fm < n { fm2, fm1, fm = fm1, fm, fm1+fm }
    return fm2, fm1, fm
}
```

**Java:**
```java
int[] smallestFibAtLeast(int n) {
    int fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) { fm2 = fm1; fm1 = fm; fm = fm2 + fm1; }
    return new int[]{fm2, fm1, fm};
}
```

**Python:**
```python
def smallest_fib_at_least(n):
    fm2, fm1, fm = 0, 1, 1
    while fm < n: fm2, fm1, fm = fm1, fm, fm1 + fm
    return fm2, fm1, fm
```

---

## Task 4 — Detect Non-Sorted Input

**Problem.** Add a debug-only sortedness check.

**Go:**
```go
func fibSearchSafe(arr []int, t int) (int, error) {
    for i := 1; i < len(arr); i++ {
        if arr[i] < arr[i-1] {
            return -1, fmt.Errorf("array not sorted at index %d", i)
        }
    }
    return fibSearch(arr, t), nil
}
```

**Java:**
```java
int fibSearchSafe(int[] arr, int t) {
    for (int i = 1; i < arr.length; i++) {
        if (arr[i] < arr[i - 1])
            throw new IllegalArgumentException("array not sorted at " + i);
    }
    return fibSearch(arr, t);
}
```

**Python:**
```python
def fib_search_safe(arr, t):
    for i in range(1, len(arr)):
        if arr[i] < arr[i - 1]:
            raise ValueError(f"array not sorted at index {i}")
    return fib_search(arr, t)
```

---

## Task 5 — Find First Occurrence (Duplicates Allowed)

**Problem.** Sorted array with duplicates. Return the smallest index `i` where `arr[i] == target`.

**Go:**
```go
func fibFindFirst(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return -1 }
    fm2, fm1, fm := 0, 1, 1
    for fm < n { fm2, fm1, fm = fm1, fm, fm1+fm }
    offset, result := -1, -1
    for fm > 1 {
        i := offset + fm2
        if i >= n { i = n - 1 }
        if arr[i] >= t {
            if arr[i] == t { result = i }
            newFm1 := fm1 - fm2
            fm = fm2; fm1 = newFm1; fm2 = fm - newFm1
        } else {
            fm = fm1; fm1 = fm2; fm2 = fm - fm1
            offset = i
        }
    }
    if result == -1 && fm1 == 1 && offset+1 < n && arr[offset+1] == t {
        return offset + 1
    }
    return result
}
```

**Java:**
```java
int fibFindFirst(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return -1;
    int fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) { fm2 = fm1; fm1 = fm; fm = fm2 + fm1; }
    int offset = -1, result = -1;
    while (fm > 1) {
        int i = Math.min(offset + fm2, n - 1);
        if (arr[i] >= t) {
            if (arr[i] == t) result = i;
            int newFm1 = fm1 - fm2;
            fm = fm2; fm1 = newFm1; fm2 = fm - newFm1;
        } else {
            fm = fm1; fm1 = fm2; fm2 = fm - fm1;
            offset = i;
        }
    }
    if (result == -1 && fm1 == 1 && offset + 1 < n && arr[offset + 1] == t)
        return offset + 1;
    return result;
}
```

**Python:**
```python
def fib_find_first(arr, t):
    n = len(arr)
    if n == 0: return -1
    fm2, fm1, fm = 0, 1, 1
    while fm < n: fm2, fm1, fm = fm1, fm, fm1 + fm
    offset, result = -1, -1
    while fm > 1:
        i = min(offset + fm2, n - 1)
        if arr[i] >= t:
            if arr[i] == t: result = i
            new_fm1 = fm1 - fm2
            fm, fm1, fm2 = fm2, new_fm1, fm2 - new_fm1
        else:
            fm, fm1, fm2 = fm1, fm2, fm1 - fm2
            offset = i
    if result == -1 and fm1 == 1 and offset + 1 < n and arr[offset + 1] == t:
        return offset + 1
    return result
```

---

## Task 6 — Lower-Bound Variant (smallest `i` with `arr[i] >= target`)

**Problem.** Return the smallest index `i` such that `arr[i] >= target`, or `len(arr)` if none.

**Go:**
```go
func fibLowerBound(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return 0 }
    fm2, fm1, fm := 0, 1, 1
    for fm < n { fm2, fm1, fm = fm1, fm, fm1+fm }
    offset := -1
    for fm > 1 {
        i := offset + fm2
        if i >= n { i = n - 1 }
        if arr[i] >= t {
            newFm1 := fm1 - fm2
            fm = fm2; fm1 = newFm1; fm2 = fm - newFm1
        } else {
            fm = fm1; fm1 = fm2; fm2 = fm - fm1
            offset = i
        }
    }
    if offset + 1 < n && arr[offset+1] >= t { return offset + 1 }
    return n
}
```

**Java:**
```java
int fibLowerBound(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return 0;
    int fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) { fm2 = fm1; fm1 = fm; fm = fm2 + fm1; }
    int offset = -1;
    while (fm > 1) {
        int i = Math.min(offset + fm2, n - 1);
        if (arr[i] >= t) {
            int newFm1 = fm1 - fm2;
            fm = fm2; fm1 = newFm1; fm2 = fm - newFm1;
        } else {
            fm = fm1; fm1 = fm2; fm2 = fm - fm1;
            offset = i;
        }
    }
    if (offset + 1 < n && arr[offset + 1] >= t) return offset + 1;
    return n;
}
```

**Python:**
```python
def fib_lower_bound(arr, t):
    n = len(arr)
    if n == 0: return 0
    fm2, fm1, fm = 0, 1, 1
    while fm < n: fm2, fm1, fm = fm1, fm, fm1 + fm
    offset = -1
    while fm > 1:
        i = min(offset + fm2, n - 1)
        if arr[i] >= t:
            new_fm1 = fm1 - fm2
            fm, fm1, fm2 = fm2, new_fm1, fm2 - new_fm1
        else:
            fm, fm1, fm2 = fm1, fm2, fm1 - fm2
            offset = i
    if offset + 1 < n and arr[offset + 1] >= t:
        return offset + 1
    return n
```

---

## Task 7 — Fibonacci Search on Tape (Count Seek Distance)

**Problem.** Simulate searching a sorted array on tape: the cost of each probe is `|new_index - prev_index|`. Return `(found_index, total_seek_distance)`.

**Go:**
```go
func fibTapeSearch(arr []int, t int) (int, int) {
    n := len(arr)
    if n == 0 { return -1, 0 }
    fm2, fm1, fm := 0, 1, 1
    for fm < n { fm2, fm1, fm = fm1, fm, fm1+fm }
    offset, prev, cost := -1, 0, 0
    for fm > 1 {
        i := offset + fm2
        if i >= n { i = n - 1 }
        d := i - prev
        if d < 0 { d = -d }
        cost += d
        prev = i
        if arr[i] == t { return i, cost }
        if arr[i] < t {
            fm = fm1; fm1 = fm2; fm2 = fm - fm1
            offset = i
        } else {
            newFm1 := fm1 - fm2
            fm = fm2; fm1 = newFm1; fm2 = fm - newFm1
        }
    }
    if fm1 == 1 && offset+1 < n {
        d := (offset + 1) - prev
        if d < 0 { d = -d }
        cost += d
        if arr[offset+1] == t { return offset + 1, cost }
    }
    return -1, cost
}
```

**Java:**
```java
int[] fibTapeSearch(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return new int[]{-1, 0};
    int fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) { fm2 = fm1; fm1 = fm; fm = fm2 + fm1; }
    int offset = -1, prev = 0, cost = 0;
    while (fm > 1) {
        int i = Math.min(offset + fm2, n - 1);
        cost += Math.abs(i - prev);
        prev = i;
        if (arr[i] == t) return new int[]{i, cost};
        if (arr[i] < t) { fm = fm1; fm1 = fm2; fm2 = fm - fm1; offset = i; }
        else { int newFm1 = fm1 - fm2; fm = fm2; fm1 = newFm1; fm2 = fm - newFm1; }
    }
    if (fm1 == 1 && offset + 1 < n) {
        cost += Math.abs((offset + 1) - prev);
        if (arr[offset + 1] == t) return new int[]{offset + 1, cost};
    }
    return new int[]{-1, cost};
}
```

**Python:**
```python
def fib_tape_search(arr, t):
    n = len(arr)
    if n == 0: return -1, 0
    fm2, fm1, fm = 0, 1, 1
    while fm < n: fm2, fm1, fm = fm1, fm, fm1 + fm
    offset, prev, cost = -1, 0, 0
    while fm > 1:
        i = min(offset + fm2, n - 1)
        cost += abs(i - prev)
        prev = i
        if arr[i] == t: return i, cost
        if arr[i] < t:
            fm, fm1, fm2 = fm1, fm2, fm1 - fm2
            offset = i
        else:
            new_fm1 = fm1 - fm2
            fm, fm1, fm2 = fm2, new_fm1, fm2 - new_fm1
    if fm1 == 1 and offset + 1 < n:
        cost += abs((offset + 1) - prev)
        if arr[offset + 1] == t: return offset + 1, cost
    return -1, cost
```

---

## Task 8 — Composite Exponential + Fibonacci Search

**Problem.** For a sorted array of unknown length, use exponential probing to bound the range, then Fibonacci search inside. Division-free.

**Python:**
```python
def exp_fib_search(arr, t):
    n = len(arr)
    if n == 0: return -1
    if arr[0] == t: return 0
    prev, curr = 0, 1
    while curr < n and arr[curr] < t:
        prev = curr
        curr += curr      # doubling via addition
    lo, hi = prev, min(curr, n - 1)
    sub = arr[lo:hi + 1]
    idx = fib_search(sub, t)
    return lo + idx if idx != -1 else -1
```

**Go:**
```go
func expFibSearch(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return -1 }
    if arr[0] == t { return 0 }
    prev, curr := 0, 1
    for curr < n && arr[curr] < t {
        prev = curr
        curr += curr
    }
    lo := prev
    hi := curr
    if hi >= n { hi = n - 1 }
    sub := arr[lo : hi+1]
    idx := fibSearch(sub, t)
    if idx == -1 { return -1 }
    return lo + idx
}
```

**Java:**
```java
int expFibSearch(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return -1;
    if (arr[0] == t) return 0;
    int prev = 0, curr = 1;
    while (curr < n && arr[curr] < t) { prev = curr; curr += curr; }
    int lo = prev, hi = Math.min(curr, n - 1);
    int[] sub = java.util.Arrays.copyOfRange(arr, lo, hi + 1);
    int idx = fibSearch(sub, t);
    return idx == -1 ? -1 : lo + idx;
}
```

---

## Task 9 — Fibonacci Search Using a Precomputed Table

**Problem.** Avoid recomputing Fibonacci numbers on every call by using a precomputed table. Useful in embedded firmware.

**Python:**
```python
FIB = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987,
       1597, 2584, 4181, 6765, 10946, 17711, 28657, 46368, 75025, 121393,
       196418, 317811, 514229, 832040, 1346269, 2178309, 3524578]

def fib_search_table(arr, t):
    n = len(arr)
    if n == 0: return -1
    m = 0
    while FIB[m] < n: m += 1
    offset = -1
    while m > 1:
        i = min(offset + FIB[m - 2], n - 1)
        if arr[i] == t: return i
        if arr[i] < t: m -= 1; offset = i
        else: m -= 2
    if m == 1 and offset + 1 < n and arr[offset + 1] == t:
        return offset + 1
    return -1
```

**Go:**
```go
var FIB = []int{0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610,
    987, 1597, 2584, 4181, 6765, 10946, 17711, 28657, 46368, 75025,
    121393, 196418, 317811, 514229, 832040, 1346269, 2178309, 3524578}

func fibSearchTable(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return -1 }
    m := 0
    for FIB[m] < n { m++ }
    offset := -1
    for m > 1 {
        i := offset + FIB[m-2]
        if i >= n { i = n - 1 }
        if arr[i] == t { return i }
        if arr[i] < t { m--; offset = i } else { m -= 2 }
    }
    if m == 1 && offset+1 < n && arr[offset+1] == t { return offset + 1 }
    return -1
}
```

**Java:**
```java
static final int[] FIB = {0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233,
    377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711, 28657, 46368, 75025};

int fibSearchTable(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return -1;
    int m = 0;
    while (FIB[m] < n) m++;
    int offset = -1;
    while (m > 1) {
        int i = Math.min(offset + FIB[m - 2], n - 1);
        if (arr[i] == t) return i;
        if (arr[i] < t) { m--; offset = i; } else { m -= 2; }
    }
    if (m == 1 && offset + 1 < n && arr[offset + 1] == t) return offset + 1;
    return -1;
}
```

---

## Task 10 — Recursive Fibonacci Search (Not Recommended in Practice)

**Problem.** Write the same algorithm recursively. Compare stack depth to binary search.

**Python:**
```python
def fib_search_rec(arr, t):
    n = len(arr)
    if n == 0: return -1
    fm2, fm1, fm = 0, 1, 1
    while fm < n: fm2, fm1, fm = fm1, fm, fm1 + fm
    def rec(offset, fm, fm1, fm2):
        if fm <= 1:
            if fm1 == 1 and offset + 1 < n and arr[offset + 1] == t:
                return offset + 1
            return -1
        i = min(offset + fm2, n - 1)
        if arr[i] == t: return i
        if arr[i] < t:
            return rec(i, fm1, fm2, fm1 - fm2)
        new_fm1 = fm1 - fm2
        return rec(offset, fm2, new_fm1, fm2 - new_fm1)
    return rec(-1, fm, fm1, fm2)
```

**Go:**
```go
func fibSearchRec(arr []int, t int) int {
    n := len(arr)
    if n == 0 { return -1 }
    fm2, fm1, fm := 0, 1, 1
    for fm < n { fm2, fm1, fm = fm1, fm, fm1+fm }
    var rec func(offset, fm, fm1, fm2 int) int
    rec = func(offset, fm, fm1, fm2 int) int {
        if fm <= 1 {
            if fm1 == 1 && offset+1 < n && arr[offset+1] == t {
                return offset + 1
            }
            return -1
        }
        i := offset + fm2
        if i >= n { i = n - 1 }
        if arr[i] == t { return i }
        if arr[i] < t { return rec(i, fm1, fm2, fm1-fm2) }
        newFm1 := fm1 - fm2
        return rec(offset, fm2, newFm1, fm2-newFm1)
    }
    return rec(-1, fm, fm1, fm2)
}
```

**Java:**
```java
int fibSearchRec(int[] arr, int t) {
    int n = arr.length;
    if (n == 0) return -1;
    int fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) { fm2 = fm1; fm1 = fm; fm = fm2 + fm1; }
    return recHelper(arr, t, -1, fm, fm1, fm2);
}
int recHelper(int[] arr, int t, int offset, int fm, int fm1, int fm2) {
    int n = arr.length;
    if (fm <= 1) {
        if (fm1 == 1 && offset + 1 < n && arr[offset + 1] == t)
            return offset + 1;
        return -1;
    }
    int i = Math.min(offset + fm2, n - 1);
    if (arr[i] == t) return i;
    if (arr[i] < t) return recHelper(arr, t, i, fm1, fm2, fm1 - fm2);
    int newFm1 = fm1 - fm2;
    return recHelper(arr, t, offset, fm2, newFm1, fm2 - newFm1);
}
```

---

## Task 11 — Golden-Section Search for Unimodal Minimization

**Problem.** Find the minimum of a unimodal continuous function `f` on `[a, b]` with precision `eps`. Use one new evaluation per iteration.

**Python:**
```python
import math
PHI = (1 + math.sqrt(5)) / 2
INV_PHI = 1 / PHI
INV_PHI2 = 1 - INV_PHI

def golden_section_min(f, a, b, eps=1e-9):
    if b < a: a, b = b, a
    h = b - a
    if h <= eps:
        x = (a + b) / 2
        return x, f(x)
    n = int(math.ceil(math.log(eps / h) / math.log(INV_PHI)))
    c = a + INV_PHI2 * h
    d = a + INV_PHI * h
    fc, fd = f(c), f(d)
    for _ in range(n - 1):
        if fc < fd:
            b = d; d = c; fd = fc; h *= INV_PHI
            c = a + INV_PHI2 * h; fc = f(c)
        else:
            a = c; c = d; fc = fd; h *= INV_PHI
            d = a + INV_PHI * h; fd = f(d)
    if fc < fd: return (a + d) / 2, fc
    return (c + b) / 2, fd
```

**Go:**
```go
import "math"
var (
    Phi     = (1 + math.Sqrt(5)) / 2
    InvPhi  = 1 / Phi
    InvPhi2 = 1 - InvPhi
)

func goldenSectionMin(f func(float64) float64, a, b, eps float64) (float64, float64) {
    if b < a { a, b = b, a }
    h := b - a
    if h <= eps { x := (a + b) / 2; return x, f(x) }
    n := int(math.Ceil(math.Log(eps/h) / math.Log(InvPhi)))
    c := a + InvPhi2*h
    d := a + InvPhi*h
    fc, fd := f(c), f(d)
    for k := 0; k < n-1; k++ {
        if fc < fd {
            b = d; d = c; fd = fc; h *= InvPhi
            c = a + InvPhi2*h; fc = f(c)
        } else {
            a = c; c = d; fc = fd; h *= InvPhi
            d = a + InvPhi*h; fd = f(d)
        }
    }
    if fc < fd { return (a + d) / 2, fc }
    return (c + b) / 2, fd
}
```

**Java:**
```java
double[] goldenSectionMin(java.util.function.DoubleUnaryOperator f,
                          double a, double b, double eps) {
    double PHI = (1 + Math.sqrt(5)) / 2;
    double INV_PHI = 1 / PHI, INV_PHI2 = 1 - INV_PHI;
    if (b < a) { double t = a; a = b; b = t; }
    double h = b - a;
    if (h <= eps) { double x = (a + b) / 2; return new double[]{x, f.applyAsDouble(x)}; }
    int n = (int) Math.ceil(Math.log(eps / h) / Math.log(INV_PHI));
    double c = a + INV_PHI2 * h, d = a + INV_PHI * h;
    double fc = f.applyAsDouble(c), fd = f.applyAsDouble(d);
    for (int k = 0; k < n - 1; k++) {
        if (fc < fd) {
            b = d; d = c; fd = fc; h *= INV_PHI;
            c = a + INV_PHI2 * h; fc = f.applyAsDouble(c);
        } else {
            a = c; c = d; fc = fd; h *= INV_PHI;
            d = a + INV_PHI * h; fd = f.applyAsDouble(d);
        }
    }
    if (fc < fd) return new double[]{(a + d) / 2, fc};
    return new double[]{(c + b) / 2, fd};
}
```

**Test:** `f(x) = (x - 2.5)^2 + 1`, bracket `[0, 5]` → returns `(~2.5, ~1.0)`.

---

## Task 12 — Discrete Unimodal Maximum (Fibonacci-on-Grid)

**Problem.** Given a strictly increasing-then-decreasing integer array, find the index of the maximum without scanning linearly.

**Python:**
```python
def fib_peak(arr):
    """Find index of peak in strictly unimodal array using Fibonacci-style probing."""
    n = len(arr)
    if n == 0: return -1
    if n == 1: return 0
    fm2, fm1, fm = 0, 1, 1
    while fm < n: fm2, fm1, fm = fm1, fm, fm1 + fm
    lo, hi = 0, n - 1
    while hi - lo > 2:
        # Two probes at golden-ratio positions
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if arr[m1] < arr[m2]:
            lo = m1 + 1
        else:
            hi = m2 - 1
    best = lo
    for i in range(lo + 1, hi + 1):
        if arr[i] > arr[best]: best = i
    return best
```

**Go:**
```go
func fibPeak(arr []int) int {
    n := len(arr)
    if n == 0 { return -1 }
    if n == 1 { return 0 }
    lo, hi := 0, n-1
    for hi-lo > 2 {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if arr[m1] < arr[m2] { lo = m1 + 1 } else { hi = m2 - 1 }
    }
    best := lo
    for i := lo + 1; i <= hi; i++ {
        if arr[i] > arr[best] { best = i }
    }
    return best
}
```

**Java:**
```java
int fibPeak(int[] arr) {
    int n = arr.length;
    if (n == 0) return -1;
    if (n == 1) return 0;
    int lo = 0, hi = n - 1;
    while (hi - lo > 2) {
        int m1 = lo + (hi - lo) / 3;
        int m2 = hi - (hi - lo) / 3;
        if (arr[m1] < arr[m2]) lo = m1 + 1;
        else hi = m2 - 1;
    }
    int best = lo;
    for (int i = lo + 1; i <= hi; i++) if (arr[i] > arr[best]) best = i;
    return best;
}
```

**Test:** `[1, 3, 5, 7, 9, 6, 2]` → returns 4 (index of 9).

---

## Task 13 — Benchmark Fibonacci vs Binary Search

**Problem.** Compare wall-clock for `n ∈ {100, 10_000, 1_000_000}` and 100,000 lookups each.

**Go:**
```go
func benchmarkFibVsBinary() {
    sizes := []int{100, 10_000, 1_000_000}
    for _, n := range sizes {
        arr := make([]int, n)
        for i := range arr { arr[i] = i * 2 }
        start := time.Now()
        for k := 0; k < 100_000; k++ { _ = fibSearch(arr, n) }
        ft := time.Since(start)
        start = time.Now()
        for k := 0; k < 100_000; k++ { _ = sort.SearchInts(arr, n) }
        bt := time.Since(start)
        fmt.Printf("n=%9d fib=%6.2fms bin=%6.2fms ratio=%.2f\n",
            n, float64(ft.Milliseconds()), float64(bt.Milliseconds()),
            float64(ft)/float64(bt))
    }
}
```

**Java:**
```java
void benchmarkFibVsBinary() {
    int[] sizes = {100, 10_000, 1_000_000};
    for (int n : sizes) {
        int[] arr = new int[n];
        for (int i = 0; i < n; i++) arr[i] = i * 2;
        long start = System.nanoTime();
        for (int k = 0; k < 100_000; k++) fibSearch(arr, n);
        double ft = (System.nanoTime() - start) / 1e6;
        start = System.nanoTime();
        for (int k = 0; k < 100_000; k++) java.util.Arrays.binarySearch(arr, n);
        double bt = (System.nanoTime() - start) / 1e6;
        System.out.printf("n=%9d fib=%6.2fms bin=%6.2fms ratio=%.2f%n",
                          n, ft, bt, ft / bt);
    }
}
```

**Python:**
```python
import timeit
from bisect import bisect_left

def benchmark_fib_vs_binary():
    for n in [100, 10_000, 1_000_000]:
        arr = list(range(0, n * 2, 2))
        ft = timeit.timeit(lambda: fib_search(arr, n), number=100_000)
        bt = timeit.timeit(lambda: bisect_left(arr, n), number=100_000)
        print(f"n={n:>9} fib={ft*1000:6.2f}ms bin={bt*1000:6.2f}ms ratio={ft/bt:.2f}")
```

**Expected:** Fibonacci ~1.3–1.7× slower than binary on x86-64. The gap narrows on cache-bound large `n`.

---

## Task 14 — Property-Based Testing

**Problem.** Generate random sorted arrays and random targets; assert that `fib_search` agrees with binary search on 100,000 cases.

**Python (using `hypothesis`):**
```python
from hypothesis import given, strategies as st
from bisect import bisect_left

@given(st.lists(st.integers(-1000, 1000)), st.integers(-1000, 1000))
def test_fib_matches_binary(arr, target):
    arr.sort()
    fib_idx = fib_search(arr, target)
    if fib_idx == -1:
        assert target not in arr
    else:
        assert arr[fib_idx] == target
```

**Go (using `gopter`):**
```go
import (
    "github.com/leanovate/gopter"
    "github.com/leanovate/gopter/gen"
    "github.com/leanovate/gopter/prop"
    "sort"
    "testing"
)
func TestFibVsBinary(t *testing.T) {
    p := gopter.NewProperties(nil)
    p.Property("fib agrees with binary", prop.ForAll(
        func(xs []int, target int) bool {
            sort.Ints(xs)
            i := fibSearch(xs, target)
            if i == -1 { return sort.SearchInts(xs, target) == len(xs) ||
                                xs[sort.SearchInts(xs, target)] != target }
            return xs[i] == target
        },
        gen.SliceOf(gen.IntRange(-1000, 1000)),
        gen.IntRange(-1000, 1000),
    ))
    p.TestingRun(t)
}
```

**Java (using `jqwik`):**
```java
import net.jqwik.api.*;
import java.util.Arrays;

class FibSearchPropertyTest {
    @Property
    boolean fibAgreesWithBinary(@ForAll int[] xs, @ForAll int target) {
        Arrays.sort(xs);
        int i = fibSearch(xs, target);
        if (i == -1) {
            int j = Arrays.binarySearch(xs, target);
            return j < 0;
        }
        return xs[i] == target;
    }
}
```

---

## Task 15 — Asymmetric-Cost Comparison

**Problem.** Given a sorted array and a per-position cost function `cost(i)`, simulate binary and Fibonacci searches. Return total cost for each.

**Python:**
```python
def cost_comparison(arr, t, cost_fn):
    binary_cost = 0
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        binary_cost += cost_fn(mid)
        if arr[mid] == t: break
        if arr[mid] < t: lo = mid + 1
        else: hi = mid - 1

    fib_cost = 0
    n = len(arr)
    if n == 0: return binary_cost, 0
    fm2, fm1, fm = 0, 1, 1
    while fm < n: fm2, fm1, fm = fm1, fm, fm1 + fm
    offset = -1
    while fm > 1:
        i = min(offset + fm2, n - 1)
        fib_cost += cost_fn(i)
        if arr[i] == t: break
        if arr[i] < t:
            fm, fm1, fm2 = fm1, fm2, fm1 - fm2
            offset = i
        else:
            new_fm1 = fm1 - fm2
            fm, fm1, fm2 = fm2, new_fm1, fm2 - new_fm1
    return binary_cost, fib_cost

# Try: cost_fn = lambda i: 1 if i < n // 4 else 10
# Fibonacci's left-biased probes win on this cost shape.
```

**Go:**
```go
func costComparison(arr []int, t int, costFn func(int) int) (int, int) {
    binaryCost := 0
    lo, hi := 0, len(arr)-1
    for lo <= hi {
        mid := (lo + hi) / 2
        binaryCost += costFn(mid)
        if arr[mid] == t { break }
        if arr[mid] < t { lo = mid + 1 } else { hi = mid - 1 }
    }
    fibCost, n := 0, len(arr)
    if n == 0 { return binaryCost, 0 }
    fm2, fm1, fm := 0, 1, 1
    for fm < n { fm2, fm1, fm = fm1, fm, fm1+fm }
    offset := -1
    for fm > 1 {
        i := offset + fm2
        if i >= n { i = n - 1 }
        fibCost += costFn(i)
        if arr[i] == t { break }
        if arr[i] < t {
            fm = fm1; fm1 = fm2; fm2 = fm - fm1
            offset = i
        } else {
            newFm1 := fm1 - fm2
            fm = fm2; fm1 = newFm1; fm2 = fm - newFm1
        }
    }
    return binaryCost, fibCost
}
```

**Java:**
```java
int[] costComparison(int[] arr, int t, java.util.function.IntUnaryOperator costFn) {
    int binaryCost = 0;
    int lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        binaryCost += costFn.applyAsInt(mid);
        if (arr[mid] == t) break;
        if (arr[mid] < t) lo = mid + 1;
        else hi = mid - 1;
    }
    int fibCost = 0, n = arr.length;
    if (n == 0) return new int[]{binaryCost, 0};
    int fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) { fm2 = fm1; fm1 = fm; fm = fm2 + fm1; }
    int offset = -1;
    while (fm > 1) {
        int i = Math.min(offset + fm2, n - 1);
        fibCost += costFn.applyAsInt(i);
        if (arr[i] == t) break;
        if (arr[i] < t) { fm = fm1; fm1 = fm2; fm2 = fm - fm1; offset = i; }
        else { int newFm1 = fm1 - fm2; fm = fm2; fm1 = newFm1; fm2 = fm - newFm1; }
    }
    return new int[]{binaryCost, fibCost};
}
```

---

## Self-Check

After completing these tasks, you should be able to:

- [ ] Write classic Fibonacci search from memory in any of Go / Java / Python.
- [ ] Explain why the probe sits at `offset + Fm-2` (~38% of window) and not at the midpoint.
- [ ] Compute the smallest Fibonacci ≥ `n` using only addition.
- [ ] Implement `fib_lower_bound` and explain how it differs from `fib_search`.
- [ ] Combine exponential and Fibonacci search for an unbounded sorted stream.
- [ ] Implement golden-section search and explain its reuse property.
- [ ] Predict the wall-clock ratio of Fibonacci vs binary search on x86 (~1.3-1.7× slower).
- [ ] Recognize the asymmetric-cost memory model where Fibonacci search wins.
- [ ] Identify when Fibonacci search is the wrong tool (modern x86 RAM, linked lists, unsorted data).

If any feel uncertain, revisit `junior.md` and `middle.md` and redo the task without looking at the solution.
