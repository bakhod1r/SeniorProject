# Logarithmic Time O(log n) — Find the Bug

## Table of Contents

- [Exercise 1: Classic Binary Search — Infinite Loop](#exercise-1-classic-binary-search-infinite-loop)
- [Exercise 2: Binary Search — Off-by-One](#exercise-2-binary-search-off-by-one)
- [Exercise 3: Integer Overflow in Midpoint](#exercise-3-integer-overflow-in-midpoint)
- [Exercise 4: Lower Bound — Wrong Boundary Update](#exercise-4-lower-bound-wrong-boundary-update)
- [Exercise 5: BST Search — Missing Base Case](#exercise-5-bst-search-missing-base-case)
- [Exercise 6: BST Insert — Lost Subtrees](#exercise-6-bst-insert-lost-subtrees)
- [Exercise 7: Exponentiation — Wrong Order of Operations](#exercise-7-exponentiation-wrong-order-of-operations)
- [Exercise 8: Search in Rotated Array — Wrong Comparison](#exercise-8-search-in-rotated-array-wrong-comparison)
- [Exercise 9: Find Minimum in Rotated Array — Off-by-One](#exercise-9-find-minimum-in-rotated-array-off-by-one)
- [Exercise 10: Binary Search on Floating Point](#exercise-10-binary-search-on-floating-point)
- [Exercise 11: Upper Bound — Incorrect Operator](#exercise-11-upper-bound-incorrect-operator)
- [Exercise 12: Power Mod — Missing Modulo](#exercise-12-power-mod-missing-modulo)

---

## Exercise 1: Classic Binary Search — Infinite Loop

### Buggy Code (Go)

```go
func binarySearch(arr []int, target int) int {
    left, right := 0, len(arr)-1

    for left <= right {
        mid := left + (right-left)/2

        if arr[mid] == target {
            return mid
        } else if arr[mid] < target {
            left = mid     // BUG
        } else {
            right = mid    // BUG
        }
    }

    return -1
}
```

### What Goes Wrong?

When `arr[mid] < target`, setting `left = mid` (instead of `mid + 1`) means left never advances
past mid. When `left == mid` (which happens when `right - left <= 1`), the loop repeats forever
with the same values.

### Fixed Code (Go)

```go
func binarySearch(arr []int, target int) int {
    left, right := 0, len(arr)-1

    for left <= right {
        mid := left + (right-left)/2

        if arr[mid] == target {
            return mid
        } else if arr[mid] < target {
            left = mid + 1     // FIXED: skip mid
        } else {
            right = mid - 1    // FIXED: skip mid
        }
    }

    return -1
}
```

---

## Exercise 2: Binary Search — Off-by-One

### Buggy Code (Java)

```java
public static int binarySearch(int[] arr, int target) {
    int left = 0;
    int right = arr.length;  // BUG: should be arr.length - 1

    while (left <= right) {
        int mid = left + (right - left) / 2;

        if (arr[mid] == target) {  // BUG: arr[mid] can be out of bounds
            return mid;
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return -1;
}
```

### What Goes Wrong?

Setting `right = arr.length` means when `left == arr.length`, `mid == arr.length`, and
`arr[mid]` throws `ArrayIndexOutOfBoundsException`.

### Fixed Code (Java)

```java
public static int binarySearch(int[] arr, int target) {
    int left = 0;
    int right = arr.length - 1;  // FIXED

    while (left <= right) {
        int mid = left + (right - left) / 2;

        if (arr[mid] == target) {
            return mid;
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return -1;
}
```

**Note:** Using `right = arr.length` is valid for the `left < right` loop pattern (used in
lower/upper bound). The bug is using it with the `left <= right` pattern.

---

## Exercise 3: Integer Overflow in Midpoint

### Buggy Code (Java)

```java
public static int binarySearch(int[] arr, int target) {
    int left = 0;
    int right = arr.length - 1;

    while (left <= right) {
        int mid = (left + right) / 2;  // BUG: overflow when left + right > Integer.MAX_VALUE

        if (arr[mid] == target) {
            return mid;
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return -1;
}
```

### What Goes Wrong?

When `left` and `right` are both close to `Integer.MAX_VALUE` (2,147,483,647), their sum
overflows to a negative number, making `mid` negative. This causes an `ArrayIndexOutOfBoundsException`.

This bug was present in java.util.Arrays.binarySearch for 9 years (1997-2006).

### Fixed Code (Java)

```java
int mid = left + (right - left) / 2;  // FIXED: no overflow
// Alternative: int mid = (left + right) >>> 1;  // unsigned right shift
```

---

## Exercise 4: Lower Bound — Wrong Boundary Update

### Buggy Code (Python)

```python
def lower_bound(arr: list[int], target: int) -> int:
    """Find the first index where arr[i] >= target."""
    left, right = 0, len(arr)

    while left < right:
        mid = left + (right - left) // 2

        if arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1  # BUG: should be right = mid

    return left
```

### What Goes Wrong?

Setting `right = mid - 1` when `arr[mid] >= target` skips the possibility that `mid` itself is
the answer. For example, in `[1, 2, 3, 4, 5]` searching for 3:

- left=0, right=5, mid=2, arr[2]=3 >= 3 → right = 1 (WRONG, skipped index 2)
- Returns wrong index.

### Fixed Code (Python)

```python
def lower_bound(arr: list[int], target: int) -> int:
    left, right = 0, len(arr)

    while left < right:
        mid = left + (right - left) // 2

        if arr[mid] < target:
            left = mid + 1
        else:
            right = mid  # FIXED: mid could be the answer

    return left
```

---

## Exercise 5: BST Search — Missing Base Case

### Buggy Code (Go)

```go
func search(root *Node, target int) bool {
    if target == root.Value {       // BUG: no nil check
        return true
    } else if target < root.Value {
        return search(root.Left, target)
    } else {
        return search(root.Right, target)
    }
}
```

### What Goes Wrong?

When the target is not in the tree, the recursion eventually reaches a `nil` node, and
`root.Value` causes a nil pointer dereference (panic in Go, NullPointerException in Java).

### Fixed Code (Go)

```go
func search(root *Node, target int) bool {
    if root == nil {                // FIXED: check nil first
        return false
    }
    if target == root.Value {
        return true
    } else if target < root.Value {
        return search(root.Left, target)
    } else {
        return search(root.Right, target)
    }
}
```

---

## Exercise 6: BST Insert — Lost Subtrees

### Buggy Code (Java)

```java
static Node insert(Node root, int value) {
    if (root == null) {
        return new Node(value);
    }

    if (value < root.value) {
        root.left = new Node(value);   // BUG: overwrites entire left subtree
    } else if (value > root.value) {
        root.right = new Node(value);  // BUG: overwrites entire right subtree
    }

    return root;
}
```

### What Goes Wrong?

Instead of recursing down to find the correct insertion point, this code replaces the entire left
or right child with a new single node, destroying all nodes below.

### Fixed Code (Java)

```java
static Node insert(Node root, int value) {
    if (root == null) {
        return new Node(value);
    }

    if (value < root.value) {
        root.left = insert(root.left, value);    // FIXED: recurse
    } else if (value > root.value) {
        root.right = insert(root.right, value);  // FIXED: recurse
    }

    return root;
}
```

---

## Exercise 7: Exponentiation — Wrong Order of Operations

### Buggy Code (Python)

```python
def power(base: int, exp: int) -> int:
    result = 1

    while exp > 0:
        if exp % 2 == 1:
            result *= base
        exp //= 2
        base *= base  # BUG: squaring happens AFTER halving exp

    return result
```

### What Goes Wrong?

Wait — this is actually a subtle question. Let us trace `power(2, 5)`:

| Step | exp | base | result | Action                    |
|------|-----|------|--------|---------------------------|
| 1    | 5   | 2    | 2      | odd → result=2, exp=2, base=4 |
| 2    | 2   | 4    | 2      | even, exp=1, base=16      |
| 3    | 1   | 16   | 32     | odd → result=32, exp=0, base=256 |

Result: 32 = 2^5. Correct! The order of `exp //= 2` and `base *= base` does not matter because
both happen unconditionally each iteration. **This is a trick exercise — the code is correct.**

However, the following version IS buggy:

```python
def power_buggy(base: int, exp: int) -> int:
    result = 1

    while exp > 0:
        base *= base    # BUG: squaring BEFORE the odd check
        if exp % 2 == 1:
            result *= base
        exp //= 2

    return result
```

Trace `power_buggy(2, 3)`: base becomes 4 before we multiply, giving result = 4 * 16 = 64
instead of 8.

### Fixed Code (Python)

```python
def power(base: int, exp: int) -> int:
    result = 1

    while exp > 0:
        if exp % 2 == 1:
            result *= base   # Multiply BEFORE squaring
        base *= base
        exp //= 2

    return result
```

---

## Exercise 8: Search in Rotated Array — Wrong Comparison

### Buggy Code (Go)

```go
func searchRotated(arr []int, target int) int {
    left, right := 0, len(arr)-1

    for left <= right {
        mid := left + (right-left)/2
        if arr[mid] == target {
            return mid
        }

        if arr[left] < arr[mid] {  // BUG: should be <= to handle left == mid
            if arr[left] <= target && target < arr[mid] {
                right = mid - 1
            } else {
                left = mid + 1
            }
        } else {
            if arr[mid] < target && target <= arr[right] {
                left = mid + 1
            } else {
                right = mid - 1
            }
        }
    }
    return -1
}
```

### What Goes Wrong?

When `left == mid` (array segment of size 2), `arr[left] == arr[mid]`. With `<` instead of `<=`,
the code enters the else branch, which assumes the right half is sorted. But if the left half is
the sorted side (e.g., `[3, 1]` searching for 3), it searches the wrong half.

### Fixed Code (Go)

```go
if arr[left] <= arr[mid] {  // FIXED: <= handles left == mid
```

---

## Exercise 9: Find Minimum in Rotated Array — Off-by-One

### Buggy Code (Java)

```java
public static int findMin(int[] arr) {
    int left = 0, right = arr.length - 1;

    while (left < right) {
        int mid = left + (right - left) / 2;

        if (arr[mid] > arr[right]) {
            left = mid;    // BUG: should be mid + 1
        } else {
            right = mid;
        }
    }

    return arr[left];
}
```

### What Goes Wrong?

When `arr[mid] > arr[right]`, we know `arr[mid]` is NOT the minimum (something smaller exists to
its right). Setting `left = mid` instead of `left = mid + 1` means when `right - left == 1` and
`arr[left] > arr[right]`, mid = left, left stays at mid, and we loop forever.

### Fixed Code (Java)

```java
if (arr[mid] > arr[right]) {
    left = mid + 1;   // FIXED: mid is definitely not the minimum
}
```

---

## Exercise 10: Binary Search on Floating Point

### Buggy Code (Python)

```python
def sqrt_binary_search(x: float) -> float:
    """Find square root of x using binary search."""
    if x < 0:
        raise ValueError("Negative input")

    left, right = 0.0, x

    while left < right:           # BUG: floating point equality never converges
        mid = (left + right) / 2
        if mid * mid < x:
            left = mid
        else:
            right = mid

    return left
```

### What Goes Wrong?

For floating-point binary search, `left < right` may never become false due to floating-point
precision. The loop runs indefinitely as left and right get closer but never equal.

### Fixed Code (Python)

```python
def sqrt_binary_search(x: float, epsilon: float = 1e-10) -> float:
    if x < 0:
        raise ValueError("Negative input")

    left, right = 0.0, max(1.0, x)  # FIXED: handle x < 1

    while right - left > epsilon:    # FIXED: use epsilon for convergence
        mid = (left + right) / 2
        if mid * mid < x:
            left = mid
        else:
            right = mid

    return (left + right) / 2

# Alternative: use a fixed number of iterations (e.g., 100)
```

**Additional fix:** For `x < 1` (e.g., `sqrt(0.25) = 0.5`), the sqrt is larger than x. The
initial `right = x` would be wrong. Setting `right = max(1.0, x)` handles this.

---

## Exercise 11: Upper Bound — Incorrect Operator

### Buggy Code (Go)

```go
func upperBound(arr []int, target int) int {
    left, right := 0, len(arr)

    for left < right {
        mid := left + (right-left)/2

        if arr[mid] < target {    // BUG: should be <=
            left = mid + 1
        } else {
            right = mid
        }
    }

    return left
}
```

### What Goes Wrong?

This finds the **lower bound** (first element >= target), not the upper bound (first element >
target). The difference is a single character: `<` vs `<=`.

### Fixed Code (Go)

```go
func upperBound(arr []int, target int) int {
    left, right := 0, len(arr)

    for left < right {
        mid := left + (right-left)/2

        if arr[mid] <= target {   // FIXED: <= makes this upper bound
            left = mid + 1
        } else {
            right = mid
        }
    }

    return left
}
```

---

## Exercise 12: Power Mod — Missing Modulo

### Buggy Code (Java)

```java
public static long powerMod(long base, long exp, long mod) {
    long result = 1;
    base %= mod;

    while (exp > 0) {
        if (exp % 2 == 1) {
            result = result * base % mod;
        }
        base = base * base;   // BUG: missing % mod
        exp /= 2;
    }

    return result;
}
```

### What Goes Wrong?

Without `% mod` on the `base = base * base` line, `base` grows exponentially and overflows
`long`. Even before overflow, the intermediate values are incorrect because we need all
arithmetic to be done modulo `mod`.

### Fixed Code (Java)

```java
public static long powerMod(long base, long exp, long mod) {
    long result = 1;
    base %= mod;

    while (exp > 0) {
        if (exp % 2 == 1) {
            result = result * base % mod;
        }
        base = base * base % mod;  // FIXED: apply mod after squaring
        exp /= 2;
    }

    return result;
}
```
