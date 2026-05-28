# Factorial Time O(n!) -- Find the Bug Exercises

## Table of Contents

1. Bug 1: Missing Base Case in Factorial
2. Bug 2: Wrong Swap Restore in Permutation
3. Bug 3: Heap's Algorithm Even/Odd Mixup
4. Bug 4: Next Permutation Wrong Comparison
5. Bug 5: Missing Copy in Permutation Collection
6. Bug 6: Off-by-One in TSP Brute Force
7. Bug 7: Duplicate Permutations Not Skipped
8. Bug 8: K-th Permutation Indexing Error
9. Bug 9: 2-Opt Reversal Wrong Bounds
10. Bug 10: Branch and Bound Never Prunes
11. Bug 11: Derangement Recurrence Off by One
12. Bug 12: Permutation Rank Overcounting

---

## Bug 1: Missing Base Case in Factorial

### Go -- Find the bug

```go
func factorial(n int) int {
    return n * factorial(n-1)
}
```

### What happens?

Infinite recursion leading to stack overflow. When n reaches 0, it calls factorial(-1),
then factorial(-2), and so on forever.

### Fixed Version

```go
func factorial(n int) int {
    if n <= 1 {
        return 1
    }
    return n * factorial(n-1)
}
```

---

## Bug 2: Wrong Swap Restore in Permutation

### Java -- Find the bug

```java
public void permute(int[] nums, int start, List<List<Integer>> result) {
    if (start == nums.length) {
        List<Integer> perm = new ArrayList<>();
        for (int n : nums) perm.add(n);
        result.add(perm);
        return;
    }
    for (int i = start; i < nums.length; i++) {
        int temp = nums[start];
        nums[start] = nums[i];
        nums[i] = temp;

        permute(nums, start + 1, result);

        // Bug: swapping i with i instead of restoring original positions
        temp = nums[i];
        nums[i] = nums[start];
        nums[start] = temp;
    }
}
```

### What happens?

Actually, this code looks correct at first glance because the swap-back is
`nums[i] <-> nums[start]`, which is the inverse of the original swap. But consider
this version of the bug where the indices are wrong:

```java
// Bug version: swap back uses wrong indices
temp = nums[start];
nums[start] = nums[start + 1];  // Wrong! Should be nums[i]
nums[start + 1] = temp;
```

This would produce incorrect permutations because the array is not properly restored.

### Fixed Version

```java
// Correct: swap back mirrors the original swap
int temp = nums[start];
nums[start] = nums[i];
nums[i] = temp;
```

---

## Bug 3: Heap's Algorithm Even/Odd Mixup

### Python -- Find the bug

```python
def heaps_algorithm(a, size, result):
    if size == 1:
        result.append(a[:])
        return
    for i in range(size):
        heaps_algorithm(a, size - 1, result)
        # Bug: conditions for even and odd are swapped
        if size % 2 == 0:
            a[0], a[size - 1] = a[size - 1], a[0]
        else:
            a[i], a[size - 1] = a[size - 1], a[i]
```

### What happens?

The swap logic is inverted. Heap's algorithm requires:
- When size is **odd**: swap first element (index 0) with last (index size-1)
- When size is **even**: swap element at index i with last (index size-1)

With the conditions swapped, the algorithm generates incorrect permutations and may
produce duplicates or miss some permutations.

### Fixed Version

```python
def heaps_algorithm(a, size, result):
    if size == 1:
        result.append(a[:])
        return
    for i in range(size):
        heaps_algorithm(a, size - 1, result)
        if size % 2 == 1:  # Odd: swap first with last
            a[0], a[size - 1] = a[size - 1], a[0]
        else:               # Even: swap i-th with last
            a[i], a[size - 1] = a[size - 1], a[i]
```

---

## Bug 4: Next Permutation Wrong Comparison

### Go -- Find the bug

```go
func nextPermutation(nums []int) {
    n := len(nums)
    i := n - 2

    // Bug: using > instead of >=
    for i >= 0 && nums[i] > nums[i+1] {
        i--
    }
    if i < 0 {
        reverse(nums, 0, n-1)
        return
    }
    j := n - 1
    for nums[j] <= nums[i] {
        j--
    }
    nums[i], nums[j] = nums[j], nums[i]
    reverse(nums, i+1, n-1)
}
```

### What happens?

When `nums[i] == nums[i+1]`, the condition `nums[i] > nums[i+1]` is false, so the loop
stops too early. This means `i` points to an element equal to its successor, and the
algorithm will find a "next permutation" that may actually be the same permutation or
skip some.

Example: `[1, 5, 1]` -- with `>`, `i` stops at index 1 (since 5 > 1 is true, but it
should also skip equal elements in the decreasing suffix).

Wait -- actually the correct condition needs `>=` to handle duplicates:

### Fixed Version

```go
// Correct: use >= to skip equal elements in the suffix
for i >= 0 && nums[i] >= nums[i+1] {
    i--
}
```

For arrays with all distinct elements, `>` works, but `>=` is needed for correctness
with duplicates.

---

## Bug 5: Missing Copy in Permutation Collection

### Python -- Find the bug

```python
def permute(nums):
    result = []
    def backtrack(start=0):
        if start == len(nums):
            result.append(nums)  # Bug: appending reference, not copy
            return
        for i in range(start, len(nums)):
            nums[start], nums[i] = nums[i], nums[start]
            backtrack(start + 1)
            nums[start], nums[i] = nums[i], nums[start]
    backtrack()
    return result

nums = [1, 2, 3]
perms = permute(nums)
print(perms)  # All entries are [1, 2, 3]!
```

### What happens?

`result.append(nums)` appends a **reference** to the same list object. As the algorithm
modifies `nums` in place (via swaps), all entries in `result` point to the same list.
At the end, they all show the final state of `nums` (which is back to the original).

### Fixed Version

```python
result.append(nums[:])  # Append a copy using slice notation
```

Or equivalently:
```python
result.append(list(nums))
```

This is a classic Python bug with mutable objects.

---

## Bug 6: Off-by-One in TSP Brute Force

### Java -- Find the bug

```java
public static double tspBrute(double[][] dist) {
    int n = dist.length;
    int[] cities = new int[n];  // Bug: should be n-1 (excluding start city)
    for (int i = 0; i < n; i++) cities[i] = i;

    double best = Double.MAX_VALUE;
    // This permutes ALL cities including the start (city 0),
    // which counts equivalent rotations multiple times
    // and the return-to-start is computed wrong
    // ...
}
```

### What happens?

By including city 0 in the permutations, the algorithm:
1. Considers n! routes instead of (n-1)!, doing n times more work.
2. Counts each route n times (once for each rotation).
3. May not correctly compute the return-to-start distance.

### Fixed Version

```java
public static double tspBrute(double[][] dist) {
    int n = dist.length;
    int[] cities = new int[n - 1];  // Fix: exclude start city
    for (int i = 0; i < n - 1; i++) cities[i] = i + 1;

    double best = Double.MAX_VALUE;
    // Now permute cities[0..n-2] and always start/end at city 0
    // This correctly considers (n-1)! routes
}
```

---

## Bug 7: Duplicate Permutations Not Skipped

### Go -- Find the bug

```go
func permuteUnique(nums []int) [][]int {
    sort.Ints(nums)
    var result [][]int
    used := make([]bool, len(nums))

    var backtrack func(current []int)
    backtrack = func(current []int) {
        if len(current) == len(nums) {
            perm := make([]int, len(nums))
            copy(perm, current)
            result = append(result, perm)
            return
        }
        for i := 0; i < len(nums); i++ {
            if used[i] {
                continue
            }
            // Bug: missing duplicate skip condition
            used[i] = true
            backtrack(append(current, nums[i]))
            current = current[:len(current)]
            used[i] = false
        }
    }

    backtrack([]int{})
    return result
}
```

### What happens?

Without the duplicate-skipping condition, the algorithm generates all n! permutations
including duplicates. For input [1, 1, 2], it generates 6 permutations instead of 3.

### Fixed Version

```go
for i := 0; i < len(nums); i++ {
    if used[i] {
        continue
    }
    // Fix: skip duplicates
    if i > 0 && nums[i] == nums[i-1] && !used[i-1] {
        continue
    }
    used[i] = true
    backtrack(append(current, nums[i]))
    current = current[:len(current)]
    used[i] = false
}
```

---

## Bug 8: K-th Permutation Indexing Error

### Python -- Find the bug

```python
def get_permutation(n, k):
    factorials = [1] * n
    for i in range(1, n):
        factorials[i] = factorials[i - 1] * i

    numbers = list(range(1, n + 1))
    # Bug: not converting k to 0-indexed
    result = []
    for i in range(n):
        idx = k // factorials[n - 1 - i]
        k %= factorials[n - 1 - i]
        result.append(str(numbers[idx]))
        numbers.pop(idx)
    return "".join(result)

# get_permutation(3, 1) should return "123" but returns "213"
```

### What happens?

The algorithm expects 0-indexed k, but if k=1 (meaning the first permutation), it
computes idx = 1 // 2 = 0 for the first position, which is actually correct for k=1.
But for k=3 (which should be "213"), without decrementing k it computes wrong results.

The issue: if the function uses 1-based k (as LeetCode does), we must subtract 1 first.

### Fixed Version

```python
def get_permutation(n, k):
    factorials = [1] * n
    for i in range(1, n):
        factorials[i] = factorials[i - 1] * i

    numbers = list(range(1, n + 1))
    k -= 1  # Fix: convert to 0-indexed
    result = []
    for i in range(n):
        idx = k // factorials[n - 1 - i]
        k %= factorials[n - 1 - i]
        result.append(str(numbers[idx]))
        numbers.pop(idx)
    return "".join(result)
```

---

## Bug 9: 2-Opt Reversal Wrong Bounds

### Python -- Find the bug

```python
def two_opt(dist, route):
    n = len(route)
    improved = True
    while improved:
        improved = False
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                d1 = dist[route[i-1]][route[i]] + dist[route[j]][route[(j+1) % n]]
                d2 = dist[route[i-1]][route[j]] + dist[route[i]][route[(j+1) % n]]
                if d2 < d1:
                    # Bug: reversing wrong segment
                    route[i:j] = reversed(route[i:j])  # Should be i:j+1
                    improved = True
    return route
```

### What happens?

`route[i:j]` in Python excludes index j. The 2-opt move reverses the segment from i to
j inclusive, so the correct slice is `route[i:j+1]`. With the wrong bounds, the element
at index j is not included in the reversal, leading to incorrect tours that may not even
be valid (edges may cross).

### Fixed Version

```python
route[i:j+1] = reversed(route[i:j+1])  # Fix: include j in reversal
```

---

## Bug 10: Branch and Bound Never Prunes

### Go -- Find the bug

```go
func tspBB(dist [][]float64, visited []bool, path []int, cost float64,
           bestCost *float64, bestPath *[]int, n int) {
    if len(path) == n {
        total := cost + dist[path[n-1]][0]
        if total < *bestCost {
            *bestCost = total
            *bestPath = make([]int, n)
            copy(*bestPath, path)
        }
        return
    }
    for c := 1; c < n; c++ {
        if !visited[c] {
            newCost := cost + dist[path[len(path)-1]][c]
            // Bug: pruning condition checks newCost > bestCost,
            // but bestCost is initialized to 0
            if newCost < *bestCost {
                visited[c] = true
                path = append(path, c)
                tspBB(dist, visited, path, newCost, bestCost, bestPath, n)
                path = path[:len(path)-1]
                visited[c] = false
            }
        }
    }
}

func main() {
    bestCost := 0.0  // Bug: should be math.Inf(1) or math.MaxFloat64
    // ...
}
```

### What happens?

With `bestCost` initialized to 0, the condition `newCost < bestCost` is false for any
positive distance, so **all branches are pruned** and no solution is found. The
function returns cost 0 with an empty route.

### Fixed Version

```go
func main() {
    bestCost := math.Inf(1)  // Fix: initialize to infinity
    // ...
}
```

---

## Bug 11: Derangement Recurrence Off by One

### Java -- Find the bug

```java
public static long countDerangements(int n) {
    if (n == 0) return 1;
    if (n == 1) return 0;
    long[] dp = new long[n + 1];
    dp[0] = 1;
    dp[1] = 0;
    for (int i = 2; i <= n; i++) {
        dp[i] = i * (dp[i - 1] + dp[i - 2]);  // Bug: should be (i-1)
    }
    return dp[n];
}
```

### What happens?

The derangement recurrence is D(n) = **(n-1)** * (D(n-1) + D(n-2)), not
**n** * (D(n-1) + D(n-2)). Using n instead of (n-1) gives wrong values:

- D(2): wrong gives 2*(0+1) = 2, correct is 1*(0+1) = 1
- D(3): wrong gives 3*(2+0) = 6, correct is 2*(1+1) = 2
- The wrong formula gives n! (all permutations), not derangements

### Fixed Version

```java
dp[i] = (i - 1) * (dp[i - 1] + dp[i - 2]);  // Fix: use (i-1)
```

---

## Bug 12: Permutation Rank Overcounting

### Python -- Find the bug

```python
def permutation_rank(perm):
    n = len(perm)
    factorials = [1] * n
    for i in range(1, n):
        factorials[i] = factorials[i - 1] * i

    rank = 0
    for i in range(n):
        # Bug: counting ALL smaller values, not just unused ones
        smaller = sum(1 for j in range(1, perm[i]))
        rank += smaller * factorials[n - 1 - i]
    return rank + 1

# permutation_rank([2, 1, 3]) should be 3, but gives wrong result
```

### What happens?

The code counts all values less than `perm[i]`, including those already placed in
earlier positions. For [2, 1, 3]:
- Position 0: values < 2 are {1} -> smaller = 1 (correct)
- Position 1: values < 1 are {} -> smaller = 0 (correct by accident)
- Position 2: values < 3 are {1, 2} -> smaller = 2 (wrong: both 1 and 2 are used)

For [3, 1, 2]:
- Position 0: smaller = 2 (values < 3: {1,2})
- Position 1: smaller = 0 (values < 1: {})
- Position 2: smaller = 1 (values < 2: {1}) -- but 1 is already used!

### Fixed Version

```python
def permutation_rank(perm):
    n = len(perm)
    factorials = [1] * n
    for i in range(1, n):
        factorials[i] = factorials[i - 1] * i

    used = set()
    rank = 0
    for i in range(n):
        # Fix: only count unused values that are smaller
        smaller = sum(1 for j in range(1, perm[i]) if j not in used)
        rank += smaller * factorials[n - 1 - i]
        used.add(perm[i])
    return rank + 1
```
