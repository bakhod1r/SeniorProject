# How to Calculate Complexity? -- Find the Bug

## Instructions

Each exercise contains code with a **buggy complexity analysis**. The code itself may be correct, but the stated complexity is wrong. Your job:

1. Read the code and the claimed complexity.
2. Identify what is wrong with the analysis.
3. Provide the correct complexity with justification.

---

## Exercise 1: Hidden Inner Cost

### Go

```go
// CLAIMED: O(n) -- "just one loop over n elements"
func exercise1(arr []int) bool {
    for i := 0; i < len(arr); i++ {
        target := arr[i]
        // Check if target exists elsewhere in the array
        found := false
        for j := 0; j < len(arr); j++ {
            if i != j && arr[j] == target {
                found = true
                break
            }
        }
        if found {
            return true
        }
    }
    return false
}
```

### Java

```java
// CLAIMED: O(n)
public static boolean exercise1(int[] arr) {
    for (int i = 0; i < arr.length; i++) {
        int target = arr[i];
        for (int j = 0; j < arr.length; j++) {
            if (i != j && arr[j] == target) return true;
        }
    }
    return false;
}
```

### Python

```python
# CLAIMED: O(n)
def exercise1(arr):
    for i in range(len(arr)):
        target = arr[i]
        for j in range(len(arr)):
            if i != j and arr[j] == target:
                return True
    return False
```

**Bug**: There is a nested loop. The outer loop runs n times, and for each iteration the inner loop also runs up to n times. **Correct complexity: O(n^2)**.

---

## Exercise 2: Misunderstanding Logarithmic Growth

### Go

```go
// CLAIMED: O(n) -- "loop runs n times"
func exercise2(n int) int {
    count := 0
    i := 1
    for i < n {
        i = i * 2
        count++
    }
    return count
}
```

### Java

```java
// CLAIMED: O(n)
public static int exercise2(int n) {
    int count = 0;
    int i = 1;
    while (i < n) {
        i = i * 2;
        count++;
    }
    return count;
}
```

### Python

```python
# CLAIMED: O(n)
def exercise2(n):
    count = 0
    i = 1
    while i < n:
        i = i * 2
        count += 1
    return count
```

**Bug**: The variable i doubles each iteration (1, 2, 4, 8, ..., n). It does NOT run n times. It reaches n in log2(n) steps. **Correct complexity: O(log n)**.

---

## Exercise 3: Ignoring String Concatenation Cost

### Go

```go
// CLAIMED: O(n) -- "one loop, constant work inside"
func exercise3(n int) string {
    result := ""
    for i := 0; i < n; i++ {
        result += "a"  // string concatenation
    }
    return result
}
```

### Java

```java
// CLAIMED: O(n)
public static String exercise3(int n) {
    String result = "";
    for (int i = 0; i < n; i++) {
        result += "a";  // string concatenation
    }
    return result;
}
```

### Python

```python
# CLAIMED: O(n)
def exercise3(n):
    result = ""
    for i in range(n):
        result += "a"  # string concatenation
    return result
```

**Bug**: In Go and Java, strings are immutable. Each `result += "a"` creates a new string and copies the old one. The copy at iteration i costs O(i). Total: 1 + 2 + 3 + ... + n = n(n+1)/2. **Correct complexity: O(n^2)** for Go and Java. In Python, CPython has an optimization for single-reference string appends that makes it O(n) in practice, but the guaranteed worst case is still O(n^2). Use `strings.Builder` (Go), `StringBuilder` (Java), or `''.join(list)` (Python).

---

## Exercise 4: Wrong Application of Master Theorem

```
// Given recurrence: T(n) = 2T(n/2) + n^2
// CLAIMED: "a=2, b=2, d=2. log_2(2) = 1. Case 2 (d = log_b(a)).
//           Therefore T(n) = O(n^2 log n)."
```

**Bug**: log_2(2) = 1, but d = 2. Since d (2) > log_b(a) (1), this is **Case 3**, not Case 2. **Correct answer: T(n) = O(n^2)**. The non-recursive work dominates.

---

## Exercise 5: Missing the Recursion Depth

### Go

```go
// CLAIMED: O(n) -- "visits each element once"
func exercise5(arr []int, lo, hi int) int {
    if lo >= hi {
        return 0
    }
    mid := lo + (hi-lo)/2

    sum := 0
    for i := lo; i <= hi; i++ {
        sum += arr[i]
    }

    leftSum := exercise5(arr, lo, mid-1)
    rightSum := exercise5(arr, mid+1, hi)
    return sum + leftSum + rightSum
}
```

### Java

```java
// CLAIMED: O(n)
public static int exercise5(int[] arr, int lo, int hi) {
    if (lo >= hi) return 0;
    int mid = lo + (hi - lo) / 2;

    int sum = 0;
    for (int i = lo; i <= hi; i++) sum += arr[i];

    int leftSum = exercise5(arr, lo, mid - 1);
    int rightSum = exercise5(arr, mid + 1, hi);
    return sum + leftSum + rightSum;
}
```

### Python

```python
# CLAIMED: O(n)
def exercise5(arr, lo, hi):
    if lo >= hi:
        return 0
    mid = lo + (hi - lo) // 2

    total = sum(arr[lo:hi+1])

    left_sum = exercise5(arr, lo, mid - 1)
    right_sum = exercise5(arr, mid + 1, hi)
    return total + left_sum + right_sum
```

**Bug**: The for loop scans from lo to hi, which is O(n) at the top level. The recurrence is T(n) = 2T(n/2) + O(n). By Master Theorem (Case 2): **Correct complexity: O(n log n)**, not O(n).

---

## Exercise 6: Confusing Best Case with Worst Case

### Go

```go
// CLAIMED: O(n log n) -- "quicksort is always n log n"
func exercise6(arr []int, lo, hi int) {
    if lo >= hi {
        return
    }
    pivot := arr[hi]
    i := lo
    for j := lo; j < hi; j++ {
        if arr[j] <= pivot {
            arr[i], arr[j] = arr[j], arr[i]
            i++
        }
    }
    arr[i], arr[hi] = arr[hi], arr[i]
    exercise6(arr, lo, i-1)
    exercise6(arr, i+1, hi)
}
```

### Java

```java
// CLAIMED: O(n log n) -- "quicksort is always n log n"
public static void exercise6(int[] arr, int lo, int hi) {
    if (lo >= hi) return;
    int pivot = arr[hi];
    int i = lo;
    for (int j = lo; j < hi; j++) {
        if (arr[j] <= pivot) {
            int tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            i++;
        }
    }
    int tmp = arr[i]; arr[i] = arr[hi]; arr[hi] = tmp;
    exercise6(arr, lo, i - 1);
    exercise6(arr, i + 1, hi);
}
```

### Python

```python
# CLAIMED: O(n log n) -- "quicksort is always n log n"
def exercise6(arr, lo, hi):
    if lo >= hi:
        return
    pivot = arr[hi]
    i = lo
    for j in range(lo, hi):
        if arr[j] <= pivot:
            arr[i], arr[j] = arr[j], arr[i]
            i += 1
    arr[i], arr[hi] = arr[hi], arr[i]
    exercise6(arr, lo, i - 1)
    exercise6(arr, i + 1, hi)
```

**Bug**: Quicksort is O(n log n) on **average** but O(n^2) in the **worst case** (when the pivot is always the smallest or largest element, e.g., already sorted input with last element as pivot). The claim does not specify which case. **Correct: worst-case O(n^2), average-case O(n log n)**.

---

## Exercise 7: Overlooking Built-in Function Costs

### Go

```go
// CLAIMED: O(n) -- "one loop"
func exercise7(arr []int) []int {
    result := make([]int, 0)
    for i := 0; i < len(arr); i++ {
        // Insert in sorted order
        pos := sort.SearchInts(result, arr[i])  // binary search: O(log n)
        // Insert at position pos
        result = append(result, 0)
        copy(result[pos+1:], result[pos:])
        result[pos] = arr[i]
    }
    return result
}
```

### Java

```java
// CLAIMED: O(n) -- "one loop"
public static List<Integer> exercise7(int[] arr) {
    List<Integer> result = new ArrayList<>();
    for (int val : arr) {
        int pos = Collections.binarySearch(result, val);
        if (pos < 0) pos = -(pos + 1);
        result.add(pos, val);  // ArrayList.add(index, val) shifts elements
    }
    return result;
}
```

### Python

```python
# CLAIMED: O(n) -- "one loop"
import bisect

def exercise7(arr):
    result = []
    for val in arr:
        pos = bisect.bisect_left(result, val)  # O(log n)
        result.insert(pos, val)                  # O(n) shift!
    return result
```

**Bug**: While the binary search is O(log n), the **insertion** into the middle of an array/list requires shifting subsequent elements, which costs O(n). The loop runs n times, each with O(n) insertion. **Correct complexity: O(n^2)**. The binary search O(log n) is dominated by the O(n) shift.

---

## Exercise 8: Wrong Recursion Analysis

### Go

```go
// CLAIMED: O(2^n) -- "two recursive calls means exponential"
func exercise8(n int) int {
    if n <= 0 {
        return 1
    }
    return exercise8(n-1) + exercise8(n-1)
}
```

### Java

```java
// CLAIMED: O(n) -- "each call does O(1) work"
// Wait, this is the OPPOSITE wrong claim. Let us see:
public static int exercise8(int n) {
    if (n <= 0) return 1;
    int left = exercise8(n - 1);  // both calls are the SAME subproblem
    return left + left;           // but we call it twice
}
```

### Python

```python
# CLAIMED: O(n) -- "we can just cache the result"
def exercise8(n):
    if n <= 0:
        return 1
    return exercise8(n - 1) + exercise8(n - 1)
```

**Bug (Go version)**: The claim of O(2^n) is actually **correct** here. T(n) = 2T(n-1) + O(1) => T(n) = O(2^n). However, the Java version calls exercise8(n-1) twice but stores the first result. If the code were `int left = exercise8(n-1); return left + left;` then we only make ONE recursive call and the complexity would be O(n). But the original code with `exercise8(n-1) + exercise8(n-1)` makes TWO calls and IS O(2^n). The real bug is that someone might incorrectly claim it can be "cached" to O(n) without actually implementing caching.

---

## Exercise 9: Off-by-One in Summation

```
// CODE: nested loops where inner runs from 0 to i
// for i in 0..n:
//     for j in 0..i:
//         work()
//
// CLAIMED: O(n) -- "inner loop averages n/2, so it is O(n/2 * n) wait no,
//           the average is n/2 so total is O(n * n/2) = O(n) ... right?"
```

**Bug**: The total is sum from i=0 to n-1 of i = 0 + 1 + 2 + ... + (n-1) = n(n-1)/2. This is **O(n^2)**, not O(n). The person correctly computed n(n-1)/2 but then incorrectly simplified it to O(n) instead of O(n^2). Dividing by 2 removes a constant, and n(n-1) = n^2 - n = O(n^2).

---

## Exercise 10: Misidentifying Loop Variable Growth

### Go

```go
// CLAIMED: O(sqrt(n)) -- "i grows like sqrt(n)"
func exercise10(n int) int {
    count := 0
    for i := 1; i*i*i <= n; i++ {
        count++
    }
    return count
}
```

### Java

```java
// CLAIMED: O(sqrt(n))
public static int exercise10(int n) {
    int count = 0;
    for (int i = 1; i * i * i <= n; i++) {
        count++;
    }
    return count;
}
```

### Python

```python
# CLAIMED: O(sqrt(n))
def exercise10(n):
    count = 0
    i = 1
    while i * i * i <= n:
        count += 1
        i += 1
    return count
```

**Bug**: The loop continues while i^3 <= n, so it stops when i > n^(1/3). The loop runs n^(1/3) times, which is the cube root of n, not the square root. **Correct complexity: O(n^(1/3))**, also written as O(cbrt(n)).

---

## Exercise 11: Forgetting Slice Copy Cost

### Go

```go
// CLAIMED: O(n) -- "one loop, append is O(1) amortized"
func exercise11(arr []int) [][]int {
    result := make([][]int, 0)
    for i := 0; i < len(arr); i++ {
        snapshot := make([]int, len(arr))
        copy(snapshot, arr)          // copies entire array!
        result = append(result, snapshot)
    }
    return result
}
```

### Java

```java
// CLAIMED: O(n)
public static List<int[]> exercise11(int[] arr) {
    List<int[]> result = new ArrayList<>();
    for (int i = 0; i < arr.length; i++) {
        result.add(arr.clone());  // clone copies entire array!
    }
    return result;
}
```

### Python

```python
# CLAIMED: O(n)
def exercise11(arr):
    result = []
    for i in range(len(arr)):
        result.append(arr[:])  # slice copy, O(n)!
    return result
```

**Bug**: Inside the loop, a full copy of the array is made each iteration. Copy costs O(n), and the loop runs n times. **Correct complexity: O(n^2)**. Also, space complexity is O(n^2) for storing n copies of an n-element array.

---

## Exercise 12: Recursive Complexity Miscounted

### Go

```go
// CLAIMED: O(n) -- "it just counts down from n"
func exercise12(n int) int {
    if n <= 1 {
        return 1
    }
    result := 0
    for i := 0; i < n; i++ {
        result += i
    }
    return result + exercise12(n-1)
}
```

### Java

```java
// CLAIMED: O(n)
public static int exercise12(int n) {
    if (n <= 1) return 1;
    int result = 0;
    for (int i = 0; i < n; i++) result += i;
    return result + exercise12(n - 1);
}
```

### Python

```python
# CLAIMED: O(n)
def exercise12(n):
    if n <= 1:
        return 1
    result = sum(range(n))  # O(n) work
    return result + exercise12(n - 1)
```

**Bug**: Each call does O(n) work (the for loop), but then recurses with n-1. Total work: n + (n-1) + (n-2) + ... + 1 = n(n+1)/2. **Correct complexity: O(n^2)**.
