# Pseudo Code — Optimize

> 10+ exercises. Show before/after pseudo code with complexity analysis, then implementations in **Go, Java, Python**.

---

## Exercise 1: Linear Search → Binary Search

### Before — O(n)

```text
FUNCTION find(sortedArray, target)
    FOR i = 0 TO length(sortedArray) - 1 DO
        IF sortedArray[i] == target THEN
            RETURN i
        END IF
    END FOR
    RETURN -1
END FUNCTION
```

### After — O(log n)

```text
FUNCTION find(sortedArray, target)
    SET left = 0
    SET right = length(sortedArray) - 1
    WHILE left <= right DO
        SET mid = left + (right - left) / 2
        IF sortedArray[mid] == target THEN
            RETURN mid
        ELSE IF sortedArray[mid] < target THEN
            SET left = mid + 1
        ELSE
            SET right = mid - 1
        END IF
    END WHILE
    RETURN -1
END FUNCTION
```

| | Time | Space |
|---|------|-------|
| Before | O(n) | O(1) |
| After | O(log n) | O(1) |

**Key insight:** Only works on **sorted** input. If array is unsorted, sorting first costs O(n log n).

---

## Exercise 2: Nested Loop → Hash Map

### Before — O(n^2)

```text
FUNCTION hasDuplicate(array)
    FOR i = 0 TO length(array) - 1 DO
        FOR j = i + 1 TO length(array) - 1 DO
            IF array[i] == array[j] THEN
                RETURN true
            END IF
        END FOR
    END FOR
    RETURN false
END FUNCTION
```

### After — O(n)

```text
FUNCTION hasDuplicate(array)
    SET seen = empty set
    FOR each item IN array DO
        IF item IN seen THEN
            RETURN true
        END IF
        ADD item TO seen
    END FOR
    RETURN false
END FUNCTION
```

| | Time | Space |
|---|------|-------|
| Before | O(n^2) | O(1) |
| After | O(n) | O(n) |

**Tradeoff:** Space for time — classic optimization pattern.

---

## Exercise 3: Recursive Fibonacci → DP

### Before — O(2^n)

```text
FUNCTION fib(n)
    IF n <= 1 THEN RETURN n
    RETURN CALL fib(n-1) + CALL fib(n-2)
END FUNCTION
// fib(5) makes 15 calls, fib(50) makes ~2^50 calls!
```

### After — O(n)

```text
// Bottom-up DP
FUNCTION fib(n)
    IF n <= 1 THEN RETURN n
    SET prev2 = 0
    SET prev1 = 1
    FOR i = 2 TO n DO
        SET current = prev1 + prev2
        SET prev2 = prev1
        SET prev1 = current
    END FOR
    RETURN prev1
END FUNCTION
```

| | Time | Space |
|---|------|-------|
| Before | O(2^n) | O(n) stack |
| After | O(n) | O(1) |

#### Go

```go
func fib(n int) int {
    if n <= 1 { return n }
    prev2, prev1 := 0, 1
    for i := 2; i <= n; i++ {
        prev2, prev1 = prev1, prev2+prev1
    }
    return prev1
}
```

#### Java

```java
public static int fib(int n) {
    if (n <= 1) return n;
    int prev2 = 0, prev1 = 1;
    for (int i = 2; i <= n; i++) {
        int curr = prev1 + prev2;
        prev2 = prev1;
        prev1 = curr;
    }
    return prev1;
}
```

#### Python

```python
def fib(n):
    if n <= 1: return n
    prev2, prev1 = 0, 1
    for _ in range(2, n + 1):
        prev2, prev1 = prev1, prev2 + prev1
    return prev1
```

---

## Exercise 4: Bubble Sort → Merge Sort

### Before — O(n^2)

```text
FUNCTION bubbleSort(array)
    FOR i = 0 TO length(array) - 1 DO
        FOR j = 0 TO length(array) - i - 2 DO
            IF array[j] > array[j+1] THEN
                SWAP array[j] AND array[j+1]
            END IF
        END FOR
    END FOR
END FUNCTION
```

### After — O(n log n)

```text
FUNCTION mergeSort(array)
    IF length(array) <= 1 THEN RETURN array
    SET mid = length(array) / 2
    SET left = CALL mergeSort(array[0..mid-1])
    SET right = CALL mergeSort(array[mid..end])
    RETURN CALL merge(left, right)
END FUNCTION
```

| | Time | Space | Stable? |
|---|------|-------|---------|
| Bubble | O(n^2) | O(1) | Yes |
| Merge | O(n log n) | O(n) | Yes |

---

## Exercise 5: Repeated Computation → Prefix Sum

### Before — O(n*q) for q range sum queries

```text
// For each query (l, r), sum elements from index l to r
FUNCTION rangeSum(array, l, r)
    SET sum = 0
    FOR i = l TO r DO
        SET sum = sum + array[i]
    END FOR
    RETURN sum
END FUNCTION
// q queries × O(n) each = O(n*q) total
```

### After — O(n + q)

```text
// Precompute prefix sums once: O(n)
FUNCTION buildPrefixSum(array)
    SET prefix = array of length(array) + 1, all zeros
    FOR i = 0 TO length(array) - 1 DO
        SET prefix[i+1] = prefix[i] + array[i]
    END FOR
    RETURN prefix
END FUNCTION

// Each query in O(1)
FUNCTION rangeSum(prefix, l, r)
    RETURN prefix[r+1] - prefix[l]
END FUNCTION
// Total: O(n) build + O(1) × q queries = O(n + q)
```

| | Time | Space |
|---|------|-------|
| Before | O(n*q) | O(1) |
| After | O(n + q) | O(n) |

---

## Exercise 6: Multiple Passes → Single Pass

### Before — O(2n)

```text
FUNCTION findMaxAndMin(array)
    // Pass 1: find max
    SET max = array[0]
    FOR each item IN array DO
        IF item > max THEN SET max = item
    END FOR
    // Pass 2: find min
    SET min = array[0]
    FOR each item IN array DO
        IF item < min THEN SET min = item
    END FOR
    RETURN max, min
END FUNCTION
```

### After — O(n)

```text
FUNCTION findMaxAndMin(array)
    SET max = array[0]
    SET min = array[0]
    FOR each item IN array DO
        IF item > max THEN SET max = item
        IF item < min THEN SET min = item
    END FOR
    RETURN max, min
END FUNCTION
```

---

## Exercise 7: String Building → Efficient Concatenation

### Before — O(n^2)

```text
FUNCTION buildString(n)
    SET s = ""
    FOR i = 0 TO n-1 DO
        SET s = s + "x"    // creates new string each time
    END FOR
    RETURN s
END FUNCTION
```

### After — O(n)

```text
FUNCTION buildString(n)
    SET parts = empty list
    FOR i = 0 TO n-1 DO
        APPEND "x" TO parts
    END FOR
    RETURN JOIN parts with ""
END FUNCTION
```

---

## Exercise 8: Redundant Sorting → Partial Sort

### Before — O(n log n)

```text
// Find k-th smallest element
FUNCTION kthSmallest(array, k)
    SORT array                    // O(n log n) — sorts ALL elements
    RETURN array[k-1]
END FUNCTION
```

### After — O(n) average with quickselect

```text
FUNCTION kthSmallest(array, k)
    RETURN CALL quickselect(array, 0, length(array)-1, k-1)
END FUNCTION

FUNCTION quickselect(array, left, right, k)
    SET pivotIndex = CALL partition(array, left, right)
    IF pivotIndex == k THEN
        RETURN array[k]
    ELSE IF pivotIndex < k THEN
        RETURN CALL quickselect(array, pivotIndex+1, right, k)
    ELSE
        RETURN CALL quickselect(array, left, pivotIndex-1, k)
    END IF
END FUNCTION
```

| | Time | Space |
|---|------|-------|
| Sort first | O(n log n) | O(n) or O(log n) |
| Quickselect | O(n) avg, O(n^2) worst | O(1) |

---

## Exercise 9: Check All → Early Exit

### Before

```text
FUNCTION allPositive(array)
    SET result = true
    FOR each item IN array DO
        IF item <= 0 THEN
            SET result = false      // continues checking even after finding negative!
        END IF
    END FOR
    RETURN result
END FUNCTION
```

### After

```text
FUNCTION allPositive(array)
    FOR each item IN array DO
        IF item <= 0 THEN
            RETURN false           // exit immediately
        END IF
    END FOR
    RETURN true
END FUNCTION
```

---

## Exercise 10: Recomputing → Caching/Memoization

### Before

```text
FUNCTION climbStairs(n)
    IF n <= 2 THEN RETURN n
    RETURN CALL climbStairs(n-1) + CALL climbStairs(n-2)
END FUNCTION
// Same subproblems computed exponentially many times
```

### After

```text
FUNCTION climbStairs(n, memo)
    IF n IN memo THEN RETURN memo[n]
    IF n <= 2 THEN RETURN n
    SET memo[n] = CALL climbStairs(n-1, memo) + CALL climbStairs(n-2, memo)
    RETURN memo[n]
END FUNCTION
```

---

## Optimization Summary

| # | Before | After | Strategy |
|---|--------|-------|----------|
| 1 | O(n) linear search | O(log n) binary search | Exploit sorted order |
| 2 | O(n^2) nested loop | O(n) hash set | Trade space for time |
| 3 | O(2^n) recursion | O(n) DP | Avoid recomputation |
| 4 | O(n^2) bubble sort | O(n log n) merge sort | Divide and conquer |
| 5 | O(n*q) range queries | O(n+q) prefix sum | Precomputation |
| 6 | O(2n) two passes | O(n) single pass | Combine operations |
| 7 | O(n^2) string concat | O(n) builder/join | Batch appends |
| 8 | O(n log n) full sort | O(n) quickselect | Partial sort |
| 9 | No early exit | Early exit | Short-circuit |
| 10 | Exponential recursion | Memoization | Cache results |
