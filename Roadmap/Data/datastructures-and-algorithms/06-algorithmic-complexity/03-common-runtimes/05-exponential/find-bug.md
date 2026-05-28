# Exponential Time O(2^n) — Find the Bug

## Table of Contents

- [Exercise 1: Fibonacci Off-by-One](#exercise-1-fibonacci-off-by-one)
- [Exercise 2: Power Set Missing Empty Set](#exercise-2-power-set-missing-empty-set)
- [Exercise 3: Subset Sum Wrong Bitmask](#exercise-3-subset-sum-wrong-bitmask)
- [Exercise 4: Tower of Hanoi Wrong Base Case](#exercise-4-tower-of-hanoi-wrong-base-case)
- [Exercise 5: N-Queens Missing Diagonal Check](#exercise-5-n-queens-missing-diagonal-check)
- [Exercise 6: Memoization Key Collision](#exercise-6-memoization-key-collision)
- [Exercise 7: Backtracking Without Undo](#exercise-7-backtracking-without-undo)
- [Exercise 8: Meet-in-the-Middle Off-by-One](#exercise-8-meet-in-the-middle-off-by-one)
- [Exercise 9: Combination Sum Infinite Loop](#exercise-9-combination-sum-infinite-loop)
- [Exercise 10: Subset Generation Stack Overflow](#exercise-10-subset-generation-stack-overflow)
- [Exercise 11: Permutation Duplicate Bug](#exercise-11-permutation-duplicate-bug)
- [Exercise 12: Target Sum Missing Path](#exercise-12-target-sum-missing-path)

---

## Exercise 1: Fibonacci Off-by-One

**Find the bug in this recursive Fibonacci implementation.**

**Go (Buggy):**

```go
package main

import "fmt"

func fib(n int) int {
    if n == 0 {
        return 0
    }
    if n == 1 {
        return 0  // BUG IS HERE
    }
    return fib(n-1) + fib(n-2)
}

func main() {
    for i := 0; i <= 10; i++ {
        fmt.Printf("fib(%d) = %d\n", i, fib(i))
    }
    // Expected: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55
    // Actual:   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
}
```

**Bug:** The base case for `n == 1` returns 0 instead of 1. Since `fib(1) = 0` and `fib(0) = 0`, every recursive call produces 0.

**Fix:**

```go
if n == 1 {
    return 1  // FIXED: fib(1) = 1
}
```

---

## Exercise 2: Power Set Missing Empty Set

**Find the bug in this power set generator.**

**Java (Buggy):**

```java
import java.util.*;

public class PowerSetBug {
    public static List<List<Integer>> powerSet(int[] nums) {
        List<List<Integer>> result = new ArrayList<>();
        // BUG: missing result.add(new ArrayList<>()) — no empty set
        for (int num : nums) {
            int size = result.size();
            for (int i = 0; i < size; i++) {
                List<Integer> newSubset = new ArrayList<>(result.get(i));
                newSubset.add(num);
                result.add(newSubset);
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[] nums = {1, 2, 3};
        System.out.println(powerSet(nums));
        // Expected: 8 subsets (2^3)
        // Actual: 0 subsets — result starts empty, so the loop never runs
    }
}
```

**Bug:** The result list is never seeded with the empty set. The iterative doubling approach needs `result.add(new ArrayList<>())` before the loop. Without it, `size` is always 0 and no subsets are ever generated.

**Fix:**

```java
List<List<Integer>> result = new ArrayList<>();
result.add(new ArrayList<>());  // FIXED: seed with empty set
```

---

## Exercise 3: Subset Sum Wrong Bitmask

**Find the bug in this subset sum implementation.**

**Python (Buggy):**

```python
def subset_sum(nums, target):
    n = len(nums)
    for mask in range(1 << n):
        total = 0
        for i in range(n):
            if mask & (1 << n):  # BUG IS HERE
                total += nums[i]
        if total == target:
            return True
    return False

# Test
print(subset_sum([1, 2, 3], 5))  # Expected: True, Actual: depends
```

**Bug:** The inner loop checks `mask & (1 << n)` instead of `mask & (1 << i)`. The variable `n` is the length (a constant), not the loop variable `i`. This means either all elements are included or none — it never selects individual elements.

**Fix:**

```python
if mask & (1 << i):  # FIXED: use i, not n
    total += nums[i]
```

---

## Exercise 4: Tower of Hanoi Wrong Base Case

**Find the bug in this Tower of Hanoi solution.**

**Go (Buggy):**

```go
package main

import "fmt"

func hanoi(n int, from, to, aux string) {
    if n == 1 {
        fmt.Printf("Move disk 1 from %s to %s\n", from, to)
        return
    }
    hanoi(n-1, from, to, aux)   // BUG IS HERE
    fmt.Printf("Move disk %d from %s to %s\n", n, from, to)
    hanoi(n-1, aux, to, from)
}

func main() {
    hanoi(3, "A", "C", "B")
}
```

**Bug:** The first recursive call uses wrong peg arguments. It should move n-1 disks from `from` to `aux` (using `to` as auxiliary), but the code moves them from `from` to `to` (using `aux` as auxiliary). This places disks in the wrong location before moving the largest disk.

**Fix:**

```go
hanoi(n-1, from, aux, to)   // FIXED: move to aux, not to destination
```

---

## Exercise 5: N-Queens Missing Diagonal Check

**Find the bug in this N-Queens validator.**

**Java (Buggy):**

```java
public class NQueensBug {
    static boolean isValid(int[] queens, int row, int col) {
        for (int r = 0; r < row; r++) {
            int c = queens[r];
            // Check same column
            if (c == col) return false;
            // Check diagonal
            if (c - r == col - row) return false;  // Same diagonal \
            // BUG: Missing anti-diagonal check
        }
        return true;
    }

    static int solve(int[] queens, int row, int n) {
        if (row == n) return 1;
        int count = 0;
        for (int col = 0; col < n; col++) {
            if (isValid(queens, row, col)) {
                queens[row] = col;
                count += solve(queens, row + 1, n);
            }
        }
        return count;
    }

    public static void main(String[] args) {
        int n = 8;
        int[] queens = new int[n];
        System.out.printf("%d-Queens: %d solutions%n", n, solve(queens, 0, n));
        // Expected: 92 for 8-Queens
        // Actual: Too many solutions — queens on anti-diagonals not detected
    }
}
```

**Bug:** The anti-diagonal check (`c + r == col + row`) is missing. Only one diagonal direction is checked. Queens threatening each other on the `/` diagonal will not be detected.

**Fix:**

```java
if (c - r == col - row) return false;  // Check \ diagonal
if (c + r == col + row) return false;  // FIXED: Check / diagonal
```

---

## Exercise 6: Memoization Key Collision

**Find the bug in this memoized subset sum.**

**Python (Buggy):**

```python
def subset_sum_memo(nums, target):
    memo = {}

    def helper(index, remaining):
        if remaining == 0:
            return True
        if remaining < 0 or index >= len(nums):
            return False

        # BUG: Only using remaining as key, not (index, remaining)
        if remaining in memo:
            return memo[remaining]

        result = (helper(index + 1, remaining - nums[index]) or
                  helper(index + 1, remaining))

        memo[remaining] = result
        return result

    return helper(0, target)

# Test
print(subset_sum_memo([3, 3, 3, 3], 6))
# May give wrong answer because different indices with same remaining
# are treated as the same subproblem
```

**Bug:** The memoization key is just `remaining`, ignoring `index`. Different subproblems with the same remaining sum but different starting indices are incorrectly treated as identical. Two calls like `helper(1, 6)` and `helper(3, 6)` have different available elements but share a cache entry.

**Fix:**

```python
key = (index, remaining)
if key in memo:
    return memo[key]
# ...
memo[key] = result
```

---

## Exercise 7: Backtracking Without Undo

**Find the bug in this subset generator using backtracking.**

**Go (Buggy):**

```go
package main

import "fmt"

func subsets(nums []int) [][]int {
    var result [][]int
    var current []int

    var backtrack func(start int)
    backtrack = func(start int) {
        // Store current subset
        snapshot := make([]int, len(current))
        copy(snapshot, current)
        result = append(result, snapshot)

        for i := start; i < len(nums); i++ {
            current = append(current, nums[i])
            backtrack(i + 1)
            // BUG: missing current = current[:len(current)-1]
        }
    }

    backtrack(0)
    return result
}

func main() {
    result := subsets([]int{1, 2, 3})
    fmt.Println(result)
    // Expected: [[] [1] [1,2] [1,2,3] [1,3] [2] [2,3] [3]]
    // Actual: [[] [1] [1,2] [1,2,3] [1,2,3,3] [1,2,3] [1,2,3,3] [1,2,3]]
    // Elements accumulate and are never removed
}
```

**Bug:** After the recursive call, the last element is not removed from `current`. Backtracking requires undoing the "include" decision. Without `current = current[:len(current)-1]`, elements accumulate incorrectly.

**Fix:**

```go
current = append(current, nums[i])
backtrack(i + 1)
current = current[:len(current)-1]  // FIXED: undo the append
```

---

## Exercise 8: Meet-in-the-Middle Off-by-One

**Find the bug in this meet-in-the-middle implementation.**

**Python (Buggy):**

```python
from bisect import bisect_left

def mitm_subset_sum(nums, target):
    n = len(nums)
    mid = n // 2

    def all_sums(arr):
        sums = []
        for mask in range(1 << len(arr)):
            s = sum(arr[i] for i in range(len(arr)) if mask & (1 << i))
            sums.append(s)
        return sums

    left_sums = sorted(all_sums(nums[:mid]))
    right_sums = all_sums(nums[mid:])

    for rs in right_sums:
        need = target - rs
        idx = bisect_left(left_sums, need)
        if left_sums[idx] == need:  # BUG IS HERE
            return True
    return False

# Test
print(mitm_subset_sum([1, 2, 3, 4], 100))
# Crashes with IndexError when idx == len(left_sums)
```

**Bug:** After `bisect_left`, `idx` could equal `len(left_sums)` if `need` is larger than all elements. Accessing `left_sums[idx]` without a bounds check causes an `IndexError`.

**Fix:**

```python
if idx < len(left_sums) and left_sums[idx] == need:  # FIXED: bounds check
    return True
```

---

## Exercise 9: Combination Sum Infinite Loop

**Find the bug that causes infinite recursion.**

**Java (Buggy):**

```java
import java.util.*;

public class CombSumBug {
    public static List<List<Integer>> combinationSum(int[] candidates, int target) {
        List<List<Integer>> result = new ArrayList<>();
        backtrack(candidates, 0, target, new ArrayList<>(), result);
        return result;
    }

    static void backtrack(int[] cands, int start, int remaining,
                          List<Integer> current, List<List<Integer>> result) {
        if (remaining == 0) {
            result.add(new ArrayList<>(current));
            return;
        }
        if (remaining < 0) return;

        for (int i = start; i < cands.length; i++) {
            current.add(cands[i]);
            backtrack(cands, i, remaining, current, result);  // BUG IS HERE
            current.remove(current.size() - 1);
        }
    }

    public static void main(String[] args) {
        System.out.println(combinationSum(new int[]{2, 3, 7}, 7));
        // Infinite recursion / StackOverflowError
    }
}
```

**Bug:** The recursive call passes `remaining` instead of `remaining - cands[i]`. The remaining target never decreases, so the recursion never terminates (until stack overflow).

**Fix:**

```java
backtrack(cands, i, remaining - cands[i], current, result);  // FIXED: subtract
```

---

## Exercise 10: Subset Generation Stack Overflow

**Find the bug that causes stack overflow for large n.**

**Python (Buggy):**

```python
import sys

def generate_subsets(nums):
    """Generate all subsets recursively."""
    def helper(index):
        if index == len(nums):
            return [[]]

        # Get all subsets without current element
        without = helper(index + 1)

        # Get all subsets with current element
        with_current = helper(index + 1)  # BUG: computing same thing twice
        with_current = [s + [nums[index]] for s in with_current]

        return without + with_current

    return helper(0)

# Works for small n but is O(4^n) due to double recursive call
print(len(generate_subsets(list(range(15)))))
# Much slower than necessary, may run out of memory
```

**Bug:** `helper(index + 1)` is called twice per level, and without memoization the recursion tree becomes O(4^n) instead of O(2^n). Each call generates the full power set of the remaining elements twice.

**Fix:**

```python
def helper(index):
    if index == len(nums):
        return [[]]
    rest = helper(index + 1)  # FIXED: call once, reuse
    with_current = [s + [nums[index]] for s in rest]
    return rest + with_current
```

---

## Exercise 11: Permutation Duplicate Bug

**Find why this produces duplicate permutations.**

**Go (Buggy):**

```go
package main

import "fmt"

func permute(nums []int) [][]int {
    var result [][]int
    var backtrack func(start int)
    backtrack = func(start int) {
        if start == len(nums) {
            perm := make([]int, len(nums))
            copy(perm, nums)
            result = append(result, perm)
            return
        }
        for i := start; i < len(nums); i++ {
            nums[start], nums[i] = nums[i], nums[start]
            backtrack(start + 1)
            // BUG: not swapping back
        }
    }
    backtrack(0)
    return result
}

func main() {
    result := permute([]int{1, 2, 3})
    fmt.Printf("Count: %d (expected: 6)\n", len(result))
    for _, p := range result {
        fmt.Println(p)
    }
}
```

**Bug:** After the recursive call, the swap is not undone. The array state is corrupted for subsequent iterations, leading to duplicate and missing permutations.

**Fix:**

```go
nums[start], nums[i] = nums[i], nums[start]
backtrack(start + 1)
nums[start], nums[i] = nums[i], nums[start]  // FIXED: swap back
```

---

## Exercise 12: Target Sum Missing Path

**Find why this target sum counter gives wrong results.**

**Python (Buggy):**

```python
def find_target_sum_ways(nums, target):
    count = 0

    def backtrack(index, current_sum):
        if index == len(nums):
            if current_sum == target:
                count += 1  # BUG IS HERE
            return
        backtrack(index + 1, current_sum + nums[index])
        backtrack(index + 1, current_sum - nums[index])

    backtrack(0, 0)
    return count

print(find_target_sum_ways([1, 1, 1, 1, 1], 3))
# UnboundLocalError: cannot access local variable 'count'
```

**Bug:** The nested function tries to modify `count` (an integer in the enclosing scope) with `+=`, but Python treats it as a local variable assignment without `nonlocal`. This raises `UnboundLocalError`.

**Fix:**

```python
def find_target_sum_ways(nums, target):
    count = 0

    def backtrack(index, current_sum):
        nonlocal count  # FIXED: declare nonlocal
        if index == len(nums):
            if current_sum == target:
                count += 1
            return
        backtrack(index + 1, current_sum + nums[index])
        backtrack(index + 1, current_sum - nums[index])

    backtrack(0, 0)
    return count
```

Alternative fix (without `nonlocal`): use a mutable container like `counter = [0]` and `counter[0] += 1`.
