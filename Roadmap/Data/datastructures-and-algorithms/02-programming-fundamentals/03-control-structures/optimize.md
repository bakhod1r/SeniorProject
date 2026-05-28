# Control Structures — Optimize

> 10+ exercises. Show before/after in **all 3 languages** with complexity comparison.

---

## Exercise 1: Deep Nesting → Guard Clauses

### Before

```go
func process(arr []int) int {
    if arr != nil {
        if len(arr) > 0 {
            if arr[0] > 0 {
                result := 0
                for _, v := range arr {
                    result += v
                }
                return result
            }
        }
    }
    return -1
}
```

### After

```go
func process(arr []int) int {
    if arr == nil || len(arr) == 0 || arr[0] <= 0 {
        return -1
    }
    result := 0
    for _, v := range arr {
        result += v
    }
    return result
}
```

**Impact:** Same complexity, but much more readable. Cyclomatic complexity drops.

---

## Exercise 2: Nested Loop → Single Loop with Hash

### Before — O(n^2)

#### Go

```go
func twoSum(arr []int, target int) (int, int) {
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i]+arr[j] == target {
                return i, j
            }
        }
    }
    return -1, -1
}
```

### After — O(n)

#### Go

```go
func twoSum(arr []int, target int) (int, int) {
    seen := make(map[int]int)
    for i, v := range arr {
        if j, ok := seen[target-v]; ok {
            return j, i
        }
        seen[v] = i
    }
    return -1, -1
}
```

#### Java

```java
public static int[] twoSum(int[] arr, int target) {
    var seen = new HashMap<Integer, Integer>();
    for (int i = 0; i < arr.length; i++) {
        if (seen.containsKey(target - arr[i]))
            return new int[]{seen.get(target - arr[i]), i};
        seen.put(arr[i], i);
    }
    return new int[]{-1, -1};
}
```

#### Python

```python
def two_sum(arr, target):
    seen = {}
    for i, v in enumerate(arr):
        if target - v in seen:
            return (seen[target - v], i)
        seen[v] = i
    return (-1, -1)
```

| | Time | Space |
|---|------|-------|
| Before | O(n^2) | O(1) |
| After | O(n) | O(n) |

---

## Exercise 3: Multiple if → switch/map Table

### Before

```go
func getDiscount(tier string) float64 {
    if tier == "bronze" { return 0.05 }
    if tier == "silver" { return 0.10 }
    if tier == "gold"   { return 0.15 }
    if tier == "platinum" { return 0.20 }
    return 0.0
}
```

### After

```go
var discounts = map[string]float64{
    "bronze": 0.05, "silver": 0.10,
    "gold": 0.15, "platinum": 0.20,
}

func getDiscount(tier string) float64 {
    return discounts[tier]  // O(1) hash lookup, zero branching
}
```

---

## Exercise 4: Repeated Array Scan → Single Pass

### Before — O(3n) = O(n) but 3 passes

```python
def stats(arr):
    min_val = min(arr)      # pass 1
    max_val = max(arr)      # pass 2
    total = sum(arr)        # pass 3
    return min_val, max_val, total
```

### After — O(n) single pass

```python
def stats(arr):
    min_val = max_val = arr[0]
    total = 0
    for v in arr:
        if v < min_val: min_val = v
        if v > max_val: max_val = v
        total += v
    return min_val, max_val, total
```

---

## Exercise 5: O(n^2) Substring Search → O(n) with Break

### Before

```go
func containsAll(arr []string, targets []string) bool {
    for _, t := range targets {
        found := false
        for _, s := range arr {
            if s == t { found = true }  // BUG: doesn't break after finding
        }
        if !found { return false }
    }
    return true
}
```

### After

```go
func containsAll(arr []string, targets []string) bool {
    set := make(map[string]bool, len(arr))
    for _, s := range arr { set[s] = true }
    for _, t := range targets {
        if !set[t] { return false }
    }
    return true
}
```

| | Time | Space |
|---|------|-------|
| Before | O(n*m) | O(1) |
| After | O(n+m) | O(n) |

---

## Exercise 6: While Loop → For-Each

### Before

```java
int i = 0;
while (i < arr.length) {
    process(arr[i]);
    i++;
}
```

### After

```java
for (int v : arr) {
    process(v);
}
```

**Impact:** Same performance, but cleaner, fewer bugs (no off-by-one risk).

---

## Exercise 7: Recursive → Iterative (Avoid Stack Overflow)

### Before — O(n) stack space

```python
def factorial(n):
    if n <= 1: return 1
    return n * factorial(n - 1)
# factorial(10000) → RecursionError
```

### After — O(1) space

```python
def factorial(n):
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result
# factorial(10000) → works fine
```

---

## Exercise 8: Branchless Optimization

### Before — Branch-heavy

```go
func abs(x int) int {
    if x < 0 {
        return -x
    }
    return x
}
```

### After — Branchless (for performance-critical code)

```go
func abs(x int) int {
    mask := x >> 63         // all 1s if negative, all 0s if positive
    return (x ^ mask) - mask
}
```

**Note:** Only worth it in extremely hot loops. Compilers often do this automatically.

---

## Exercise 9: Early Exit in Validation

### Before — Checks everything

```go
func validate(items []Item) []error {
    var errs []error
    for _, item := range items {
        if item.Name == "" {
            errs = append(errs, errors.New("empty name"))
        }
        if item.Price < 0 {
            errs = append(errs, errors.New("negative price"))
        }
        if item.Qty == 0 {
            errs = append(errs, errors.New("zero quantity"))
        }
    }
    return errs
}
```

### After — Fail fast (if you only need first error)

```go
func validate(items []Item) error {
    for _, item := range items {
        if item.Name == "" { return errors.New("empty name") }
        if item.Price < 0  { return errors.New("negative price") }
        if item.Qty == 0   { return errors.New("zero quantity") }
    }
    return nil
}
```

---

## Exercise 10: Sorting Check → Single Pass

### Before — O(n log n)

```python
def is_sorted(arr):
    return arr == sorted(arr)  # creates new sorted array
```

### After — O(n), O(1) space

```python
def is_sorted(arr):
    for i in range(1, len(arr)):
        if arr[i] < arr[i-1]:
            return False
    return True
```

---

## Optimization Summary

| # | Before | After | Strategy |
|---|--------|-------|----------|
| 1 | Deep nesting | Guard clauses | Early return |
| 2 | O(n^2) nested loop | O(n) hash map | Trade space for time |
| 3 | if-else chain | Map/switch table | O(1) lookup |
| 4 | 3 passes | 1 pass | Combine operations |
| 5 | O(n*m) search | O(n+m) with set | Hash set |
| 6 | while + index | for-each | Eliminate index management |
| 7 | Recursion (stack) | Iteration (loop) | Avoid stack overflow |
| 8 | Branch | Branchless | Bit manipulation |
| 9 | Collect all errors | Fail fast | Early exit |
| 10 | Sort then compare | Single pass check | Avoid unnecessary sort |
