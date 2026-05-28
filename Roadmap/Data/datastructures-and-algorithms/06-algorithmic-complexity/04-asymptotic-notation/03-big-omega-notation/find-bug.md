# Big-Omega Notation — Find the Bug

## Overview

These exercises focus on a common and dangerous confusion: **mixing up best-case
analysis with lower bounds**, and related misconceptions about Big-Omega notation.
Each exercise contains a bug — either in code logic, in the complexity analysis
comment, or in the reasoning about lower bounds.

Find and fix each bug.

---

## Exercise 1: "Binary Search Is Omega(log n)"

### Buggy Code (Go)

```go
package main

import "fmt"

// BUG: The comment claims binary search is ALWAYS Omega(log n).
// Binary search on sorted array.
// Time complexity: Omega(log n) — always takes at least log n comparisons.
func binarySearch(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == target {
            return mid  // Found on first try sometimes!
        } else if arr[mid] < target {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return -1
}

func main() {
    arr := []int{1, 3, 5, 7, 9, 11, 13, 15}
    fmt.Println(binarySearch(arr, 7)) // Returns 3 — found in 1 comparison!
}
```

### Bug

The comment says binary search is ALWAYS Omega(log n). This is wrong. The **algorithm**
can find the target in O(1) in the best case (when the target is at the midpoint).

The Omega(log n) bound applies to the **problem** of searching sorted data in the
**worst case**, not to every execution of binary search.

### Fix

```go
// FIXED: Binary search on sorted array.
// Best case: O(1) — target is at the midpoint.
// Worst case: O(log n) — target is not present or at an extreme.
// Problem lower bound: Omega(log n) in the worst case.
```

---

## Exercise 2: "Insertion Sort Violates the Omega(n log n) Bound"

### Buggy Code (Java)

```java
public class BuggySort {
    
    // BUG: The comment claims insertion sort violates the sorting lower bound.
    // Insertion sort runs in O(n) on sorted input.
    // This CONTRADICTS the Omega(n log n) lower bound for sorting!
    // Therefore the lower bound proof must be wrong.
    public static void insertionSort(int[] arr) {
        for (int i = 1; i < arr.length; i++) {
            int key = arr[i];
            int j = i - 1;
            while (j >= 0 && arr[j] > key) {
                arr[j + 1] = arr[j];
                j--;
            }
            arr[j + 1] = key;
        }
    }
    
    public static void main(String[] args) {
        int[] sorted = {1, 2, 3, 4, 5, 6, 7, 8};
        insertionSort(sorted);
        // Ran in O(n) — "violated" Omega(n log n)?
    }
}
```

### Bug

The reasoning confuses **best case of an algorithm** with **lower bound of a problem**.

- The Omega(n log n) bound is about the **worst case** of ANY comparison sort.
- Insertion sort on a sorted array is the **best case** of ONE specific algorithm.
- No contradiction: insertion sort's WORST case is O(n^2), which is >= Omega(n log n).

### Fix

```java
// FIXED:
// Insertion sort runs in O(n) on sorted input (best case).
// This does NOT contradict Omega(n log n) because:
//   - Omega(n log n) applies to the WORST case of any comparison sort.
//   - Insertion sort's WORST case is O(n^2) >= Omega(n log n). No contradiction.
//   - Best case of one input does not violate a worst-case lower bound.
```

---

## Exercise 3: "Every Algorithm Is Omega(n)"

### Buggy Code (Python)

```python
# BUG: Claims every algorithm must be Omega(n) because it reads input.

# Every algorithm must read its entire input, so every algorithm is Omega(n).
# Therefore hash table lookup is Omega(n).
def hash_lookup(table, key):
    return table.get(key, None)

data = {i: i * 10 for i in range(1000)}
result = hash_lookup(data, 42)  # This is O(1), not Omega(n)!
```

### Bug

Not every algorithm reads ALL its input. Hash table lookup accesses only one entry
using the hash function. It does NOT scan the entire input. It is O(1) average case,
and the lower bound for hash lookup is Omega(1).

The claim "every algorithm must read its entire input" is only true for problems
where the answer depends on ALL elements (like finding the maximum). For point
queries, the algorithm can skip most of the data.

### Fix

```python
# FIXED:
# Hash table lookup is O(1) average case and Omega(1).
# NOT every algorithm reads all input. Only problems where the answer
# depends on every element have an Omega(n) lower bound.
# Hash lookup depends only on the queried key, not all keys.
```

---

## Exercise 4: "Counting Sort Disproves Omega(n log n)"

### Buggy Code (Go)

```go
package main

import "fmt"

// BUG: Claims counting sort disproves the Omega(n log n) sorting lower bound.
// Counting sort runs in O(n + k) where k is the range.
// This is O(n) when k = O(n), which is LESS than Omega(n log n).
// Therefore the Omega(n log n) lower bound for sorting is WRONG.
func countingSort(arr []int, maxVal int) []int {
    count := make([]int, maxVal+1)
    for _, v := range arr {
        count[v]++
    }
    result := make([]int, 0, len(arr))
    for i, c := range count {
        for j := 0; j < c; j++ {
            result = append(result, i)
        }
    }
    return result
}

func main() {
    arr := []int{4, 2, 2, 8, 3, 3, 1}
    sorted := countingSort(arr, 8)
    fmt.Println(sorted) // [1 2 2 3 3 4 8] — sorted in O(n)!
}
```

### Bug

The Omega(n log n) bound applies ONLY to **comparison-based** sorting algorithms.
Counting sort is NOT comparison-based — it uses element values as array indices.
The decision tree argument requires that the algorithm only learns about elements
through pairwise comparisons, which counting sort does not follow.

### Fix

```go
// FIXED:
// Counting sort runs in O(n + k) — this does NOT disprove the lower bound.
// The Omega(n log n) bound applies ONLY to COMPARISON-BASED sorts.
// Counting sort is not comparison-based (uses values as indices).
// The lower bound proof (decision tree) assumes only comparisons are used.
```

---

## Exercise 5: "This Search Is Omega(1), So It's Fast"

### Buggy Code (Java)

```java
public class BuggySearch {
    
    // BUG: Confuses lower bound with expected performance.
    // Linear search is Omega(1) — so it's very fast!
    public static int linearSearch(int[] arr, int target) {
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] == target) return i;
        }
        return -1;
    }
    
    public static void main(String[] args) {
        int[] arr = new int[1000000];
        for (int i = 0; i < arr.length; i++) arr[i] = i;
        
        // "Omega(1) means it's fast" — but this takes O(n) worst case!
        System.out.println(linearSearch(arr, 999999)); // Slow!
    }
}
```

### Bug

Saying linear search is Omega(1) only describes the **best case** (target at index 0).
This does not mean the algorithm is "fast." The worst case is O(n), and the
**problem's lower bound** for unsorted search is Omega(n) in the worst case.

A lower bound of Omega(1) is trivially true for every algorithm and says nothing
useful about performance.

### Fix

```java
// FIXED:
// Linear search:
//   Best case: Omega(1) — target is first element.
//   Worst case: O(n) — target is last or absent.
//   Problem lower bound: Omega(n) for unsorted search (worst case).
// Omega(1) is trivially true and does NOT indicate the algorithm is fast.
```

---

## Exercise 6: "If It's O(n^2), the Lower Bound Must Be Omega(n^2)"

### Buggy Code (Python)

```python
# BUG: Assumes O and Omega always match.

# This algorithm is O(n^2), so it must also be Omega(n^2).
def has_duplicate(arr):
    """O(n^2) brute force — therefore Omega(n^2) lower bound for duplicates."""
    n = len(arr)
    for i in range(n):
        for j in range(i + 1, n):
            if arr[i] == arr[j]:
                return True
    return False

# BUG: Concludes the PROBLEM is Omega(n^2).
# "Since our algorithm is O(n^2), finding duplicates must be Omega(n^2)."
```

### Bug

The algorithm being O(n^2) does NOT mean the problem requires Omega(n^2). The lower
bound of a problem is independent of any specific algorithm. We can find duplicates
in O(n) average case using a hash set, or O(n log n) by sorting.

The problem's lower bound is Omega(n) (must read all elements) in any model, and
Omega(n log n) in the comparison-only model.

### Fix

```python
# FIXED:
# This algorithm is O(n^2), but the PROBLEM does not require Omega(n^2).
# Better algorithms exist:
#   - Hash set: O(n) average case
#   - Sort + scan: O(n log n) worst case
# The problem lower bound is Omega(n) (must read all elements).
# An algorithm's complexity != the problem's lower bound.
```

---

## Exercise 7: "Omega Means Minimum Operations Count"

### Buggy Code (Go)

```go
package main

import "fmt"

// BUG: Interprets Omega(n) as meaning "exactly n operations minimum."
// findSum is Omega(n), meaning it takes EXACTLY n additions minimum.
func findSum(arr []int) int {
    sum := 0
    for _, v := range arr {
        sum += v
    }
    return sum
}

func main() {
    arr := []int{1, 2, 3, 4, 5}
    fmt.Println("Sum:", findSum(arr))
    fmt.Printf("Operations: exactly %d (Omega(n) = exactly n)\n", len(arr))
}
```

### Bug

Omega(n) does NOT mean "exactly n operations." It means "at least c*n operations for
some constant c and sufficiently large n." The constant c could be 0.5 or 0.01.
Omega gives an asymptotic lower bound, not an exact count.

### Fix

```go
// FIXED:
// findSum is Omega(n) — meaning it requires AT LEAST c*n operations
// for some constant c > 0, for sufficiently large n.
// It does NOT mean exactly n operations.
// Here: n additions + n loop iterations = Theta(n), not "exactly n."
```

---

## Exercise 8: "Randomized Algorithm Beats the Lower Bound"

### Buggy Code (Java)

```java
import java.util.Random;

public class BuggyRandom {
    
    // BUG: Claims randomization beats Omega(n log n) sorting bound.
    // QuickSort with random pivot has O(n log n) EXPECTED time.
    // Randomization "beats" the Omega(n log n) WORST-CASE bound because
    // expected != worst case. Therefore randomization defeats lower bounds.
    public static void quickSort(int[] arr, int lo, int hi) {
        if (lo >= hi) return;
        int pivot = partition(arr, lo, hi);
        quickSort(arr, lo, pivot - 1);
        quickSort(arr, pivot + 1, hi);
    }
    
    static Random rng = new Random();
    
    public static int partition(int[] arr, int lo, int hi) {
        int randIdx = lo + rng.nextInt(hi - lo + 1);
        int temp = arr[randIdx]; arr[randIdx] = arr[hi]; arr[hi] = temp;
        
        int pivot = arr[hi];
        int i = lo - 1;
        for (int j = lo; j < hi; j++) {
            if (arr[j] <= pivot) {
                i++;
                temp = arr[i]; arr[i] = arr[j]; arr[j] = temp;
            }
        }
        temp = arr[i+1]; arr[i+1] = arr[hi]; arr[hi] = temp;
        return i + 1;
    }
    
    public static void main(String[] args) {
        int[] arr = {5, 3, 8, 1, 9, 2, 7, 4, 6};
        quickSort(arr, 0, arr.length - 1);
    }
}
```

### Bug

Randomized quicksort does NOT beat the lower bound. The Omega(n log n) bound applies
to **expected** comparisons for randomized algorithms as well (via Yao's minimax
principle). Randomized quicksort's expected time is O(n log n) which exactly MATCHES
the lower bound. Its worst case is still O(n^2). Randomization does not defeat
information-theoretic lower bounds.

### Fix

```java
// FIXED:
// Randomized quicksort has O(n log n) EXPECTED time.
// The Omega(n log n) bound applies to randomized algorithms too
// (Yao's minimax principle).
// Randomization does NOT defeat the lower bound — it achieves it in expectation.
// Worst case is still O(n^2) for quicksort.
```

---

## Exercise 9: "Lower Bound Means the Algorithm Is Slow"

### Buggy Code (Python)

```python
# BUG: Interprets a high lower bound as meaning the algorithm is slow.

# Finding the median has a lower bound of Omega(n).
# This means finding the median is SLOW — it takes at least n steps!
# We should avoid median-finding algorithms in performance-critical code.

def find_median_sorted(arr):
    """Avoid this — Omega(n) is too slow!"""
    arr_sorted = sorted(arr)  # O(n log n)
    return arr_sorted[len(arr_sorted) // 2]
```

### Bug

Omega(n) is NOT "slow." It means linear time, which is one of the fastest possible
complexities for any algorithm that reads its entire input. The comment confuses a
high lower bound (like Omega(n^2)) with any lower bound.

Additionally, the implementation uses sorting (O(n log n)), but optimal median finding
can be done in O(n) using the median-of-medians algorithm, which matches the lower bound.

### Fix

```python
# FIXED:
# Finding the median has Omega(n) lower bound — this is FAST, not slow!
# Omega(n) means linear time, which is optimal since we must read all elements.
# The median-of-medians algorithm achieves O(n), matching the lower bound.
# Using sort (O(n log n)) is suboptimal for this problem.
```

---

## Exercise 10: "Best Case Omega Is the Problem's Lower Bound"

### Buggy Code (Go)

```go
package main

import "fmt"

// BUG: Uses best-case Omega of bubble sort as the problem's lower bound.

// Bubble sort best case is Omega(n), therefore:
// "The lower bound for sorting is Omega(n)."
func bubbleSort(arr []int) int {
    n := len(arr)
    comparisons := 0
    for i := 0; i < n-1; i++ {
        swapped := false
        for j := 0; j < n-i-1; j++ {
            comparisons++
            if arr[j] > arr[j+1] {
                arr[j], arr[j+1] = arr[j+1], arr[j]
                swapped = true
            }
        }
        if !swapped {
            break // Already sorted
        }
    }
    return comparisons
}

func main() {
    sorted := []int{1, 2, 3, 4, 5}
    comps := bubbleSort(sorted)
    fmt.Printf("Best case: %d comparisons\n", comps)
    fmt.Println("Therefore sorting lower bound is Omega(n)!")  // WRONG
}
```

### Bug

The best case of bubble sort (Omega(n) on sorted input) is NOT the problem's lower
bound. The problem's lower bound for comparison sorting is Omega(n log n) in the
worst case. You cannot derive a problem's lower bound from one algorithm's best case.

### Fix

```go
// FIXED:
// Bubble sort best case: O(n) on sorted input.
// This is the best case of ONE algorithm on ONE type of input.
// The PROBLEM'S lower bound for comparison sorting is Omega(n log n)
// in the worst case (decision tree argument).
// Best case of an algorithm != lower bound of the problem.
```

---

## Exercise 11: "Parallel Algorithm Breaks the Lower Bound"

### Buggy Code (Python)

```python
# BUG: Claims parallelism breaks the Omega(n) lower bound for finding max.

import multiprocessing

# Finding max is Omega(n), but with p processors we can do it in O(n/p).
# With n processors, that's O(1) — we "broke" the Omega(n) lower bound!
def parallel_max(arr):
    # Divide among "processors"
    chunk_size = max(1, len(arr) // 4)
    chunks = [arr[i:i+chunk_size] for i in range(0, len(arr), chunk_size)]
    
    local_maxes = [max(c) for c in chunks]
    return max(local_maxes)

data = list(range(1000))
print(f"Max: {parallel_max(data)}")
print("Broke Omega(n) with parallelism!")  # WRONG
```

### Bug

Parallelism reduces **wall-clock time** but not **total work**. The Omega(n) lower bound
is about the total number of operations (comparisons). With p processors, the total
work is still Omega(n) — each element must still be examined at least once. The
**time** is O(n/p), but the **work** is still Omega(n). Lower bounds typically refer
to total work, not parallel time.

### Fix

```python
# FIXED:
# Parallelism reduces wall-clock time to O(n/p) but total WORK is still Omega(n).
# The Omega(n) lower bound refers to total operations, not parallel time.
# Every element must be examined at least once — that's n operations total
# regardless of how many processors you use.
# With n processors: O(n) total work, O(log n) parallel time (reduction tree).
```

---

## Exercise 12: "Amortized O(1) Means No Lower Bound"

### Buggy Code (Java)

```java
import java.util.ArrayList;

public class BuggyAmortized {
    
    // BUG: Claims amortized O(1) means there is no meaningful lower bound.
    // ArrayList.add() is amortized O(1).
    // Since it's O(1), appending n elements has no lower bound beyond O(n).
    // "The lower bound doesn't apply because amortization makes it constant."
    public static void main(String[] args) {
        ArrayList<Integer> list = new ArrayList<>();
        
        for (int i = 0; i < 1000000; i++) {
            list.add(i);  // Amortized O(1), so "no lower bound per operation"
        }
        // "Total: O(n) amortized, and no Omega bound applies."
    }
}
```

### Bug

Amortized O(1) does NOT mean the lower bound disappears. Appending n elements is
Omega(n) total — you must perform at least n insertions. The amortized analysis says
the average cost per operation is O(1), making the total O(n). The lower bound Omega(n)
still applies (you must insert each element at least once). Amortized analysis
describes the upper bound averaged over a sequence, not the absence of a lower bound.

### Fix

```java
// FIXED:
// ArrayList.add() is amortized O(1) per operation.
// Total for n operations: O(n) amortized.
// Lower bound: Omega(n) — must insert each of the n elements at least once.
// Amortized O(1) matches Omega(1) amortized — the algorithm is optimal!
// Amortization does not remove lower bounds; it describes average cost.
```

---

## Summary of Common Confusions

| Bug Pattern                              | Correct Understanding                              |
|------------------------------------------|----------------------------------------------------|
| Best case = lower bound                  | Best case is for one algorithm; lower bound is for all algorithms |
| O(f) implies Omega(f)                    | O and Omega can differ                             |
| Algorithm is O(n^2) so problem is Omega(n^2) | Algorithm complexity != problem lower bound    |
| Non-comparison sort disproves Omega(n log n) | Bound applies only to comparison sorts         |
| Omega(n) means "slow"                    | Omega(n) is linear — often optimal                 |
| Parallelism breaks lower bounds          | Total work is unchanged; time != work              |
| Randomization beats lower bounds         | Expected complexity still respects information-theoretic bounds |
| Amortized O(1) means no lower bound      | Amortized bounds and lower bounds coexist          |
