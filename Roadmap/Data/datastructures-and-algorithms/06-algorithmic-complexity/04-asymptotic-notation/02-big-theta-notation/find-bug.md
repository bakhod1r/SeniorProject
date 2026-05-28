# Big-Theta Notation -- Find the Bug

## Table of Contents

1. Bug 1: Confusing O with Theta
2. Bug 2: Wrong Theta for Conditional Loop
3. Bug 3: Ignoring Best vs Worst Case
4. Bug 4: Incorrect Proof Constants
5. Bug 5: Wrong Theta for Nested Loops
6. Bug 6: Misapplying Master Theorem
7. Bug 7: Theta of Early-Exit Loop
8. Bug 8: Confusing Theta(2^n) and Theta(n^2)
9. Bug 9: Wrong Capacity Prediction
10. Bug 10: Theta of Amortized Operations
11. Bug 11: Incorrect Limit Conclusion
12. Bug 12: Theta Symmetry Mistake

---

## Bug 1: Confusing O with Theta

A developer wrote this analysis comment:

**Go (Buggy):**

```go
package main

import "fmt"

// analyzeData processes an array
// BUG: The comment claims Theta(n^2) but the analysis is wrong
// Time Complexity: Theta(n^2) because the algorithm is O(n^2)
func analyzeData(arr []int) int {
    total := 0
    for _, v := range arr {
        total += v
    }
    return total
}

func main() {
    data := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    fmt.Println("Result:", analyzeData(data))
}
```

**Java (Buggy):**

```java
public class Bug1 {
    /**
     * BUG: Claims Theta(n^2) because the algorithm is O(n^2).
     * Time Complexity: Theta(n^2)
     */
    public static int analyzeData(int[] arr) {
        int total = 0;
        for (int v : arr) {
            total += v;
        }
        return total;
    }

    public static void main(String[] args) {
        int[] data = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
        System.out.println("Result: " + analyzeData(data));
    }
}
```

**Python (Buggy):**

```python
def analyze_data(arr: list[int]) -> int:
    """
    BUG: Claims Theta(n^2) because the algorithm is O(n^2).
    Time Complexity: Theta(n^2)
    """
    total = 0
    for v in arr:
        total += v
    return total


if __name__ == "__main__":
    data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    print("Result:", analyze_data(data))
```

### The Bug

The developer confused O with Theta. The function IS O(n^2) (technically true,
since n <= n^2), but it is NOT Theta(n^2). A single loop visiting each element
once is Theta(n). Being O(n^2) does not imply Theta(n^2).

### Fix

Change the comment to: `Time Complexity: Theta(n) -- single pass through array.`

---

## Bug 2: Wrong Theta for Conditional Loop

**Go (Buggy):**

```go
package main

import "fmt"

// processItems claims Theta(n) but has a conditional inner loop
// BUG: The developer assumed single loop = Theta(n)
// Time Complexity: Theta(n)
func processItems(arr []int) int {
    count := 0
    for i := 0; i < len(arr); i++ {
        if arr[i] > 0 {
            for j := 0; j < len(arr); j++ {
                count++
            }
        }
    }
    return count
}

func main() {
    data := []int{1, -2, 3, -4, 5}
    fmt.Println("Count:", processItems(data))
}
```

**Java (Buggy):**

```java
public class Bug2 {
    // BUG: Claims Theta(n) but inner loop depends on data
    // Time Complexity: Theta(n)
    public static int processItems(int[] arr) {
        int count = 0;
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] > 0) {
                for (int j = 0; j < arr.length; j++) {
                    count++;
                }
            }
        }
        return count;
    }

    public static void main(String[] args) {
        int[] data = {1, -2, 3, -4, 5};
        System.out.println("Count: " + processItems(data));
    }
}
```

**Python (Buggy):**

```python
def process_items(arr: list[int]) -> int:
    """
    BUG: Claims Theta(n) but inner loop depends on data.
    Time Complexity: Theta(n)
    """
    count = 0
    for i in range(len(arr)):
        if arr[i] > 0:
            for j in range(len(arr)):
                count += 1
    return count


if __name__ == "__main__":
    data = [1, -2, 3, -4, 5]
    print("Count:", process_items(data))
```

### The Bug

This function cannot be given a single Theta. The inner loop only runs when
arr[i] > 0. Best case (all negative): Theta(n). Worst case (all positive):
Theta(n^2). Since best and worst differ, there is no single Theta.

### Fix

The correct analysis is:
- Best case: Theta(n) -- no positive elements, inner loop never runs
- Worst case: Theta(n^2) -- all positive elements, inner loop runs every time
- We should say: O(n^2), and specify cases separately

---

## Bug 3: Ignoring Best vs Worst Case

**Go (Buggy):**

```go
package main

import "fmt"

// binarySearch claims Theta(log n) overall
// BUG: Binary search is NOT Theta(log n) in all cases
// Time Complexity: Theta(log n)
func binarySearch(arr []int, target int) int {
    low, high := 0, len(arr)-1
    for low <= high {
        mid := (low + high) / 2
        if arr[mid] == target {
            return mid // <-- This can return immediately!
        } else if arr[mid] < target {
            low = mid + 1
        } else {
            high = mid - 1
        }
    }
    return -1
}

func main() {
    arr := []int{1, 3, 5, 7, 9, 11, 13, 15}
    fmt.Println(binarySearch(arr, 7))  // Found immediately near middle
    fmt.Println(binarySearch(arr, 14)) // Not found, full search
}
```

**Java (Buggy):**

```java
public class Bug3 {
    // BUG: Claims Theta(log n) but best case is Theta(1)
    // Time Complexity: Theta(log n)
    public static int binarySearch(int[] arr, int target) {
        int low = 0, high = arr.length - 1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (arr[mid] == target) return mid;
            else if (arr[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        return -1;
    }

    public static void main(String[] args) {
        int[] arr = {1, 3, 5, 7, 9, 11, 13, 15};
        System.out.println(binarySearch(arr, 7));
        System.out.println(binarySearch(arr, 14));
    }
}
```

**Python (Buggy):**

```python
def binary_search(arr: list[int], target: int) -> int:
    """
    BUG: Claims Theta(log n) but best case is Theta(1).
    Time Complexity: Theta(log n)
    """
    low, high = 0, len(arr) - 1
    while low <= high:
        mid = (low + high) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1
```

### The Bug

Binary search best case is Theta(1) (target at middle), worst case is
Theta(log n). Since these differ, we cannot say binary search IS Theta(log n).

### Fix

```
Time Complexity:
  Best case: Theta(1) -- target found at middle
  Worst case: Theta(log n) -- target not present
  Overall: O(log n)
```

---

## Bug 4: Incorrect Proof Constants

**Buggy proof:**

```
Claim: f(n) = 2n + 10 is Theta(n)
Proof: Choose c1 = 2, c2 = 12, n0 = 1

Check: c1*n <= f(n) <= c2*n
       2*1 <= 2*1 + 10 <= 12*1
       2 <= 12 <= 12   ✓

Therefore Theta(n). QED.
```

### The Bug

The proof only checks n = 1. A valid proof must work for ALL n >= n0. Let us
check n = 100: c1*n = 200, f(n) = 210, c2*n = 1200. This works. But the
PROOF is incomplete because it does not show the general case.

Also, c2 = 12 at n = 1 works because 2(1) + 10 = 12 = 12(1). But the correct
approach is to show the algebraic inequality for all n >= n0.

### Fix

```
Proof:
Upper: 2n + 10 <= 2n + 10n = 12n for n >= 1. So c2 = 12, n0 = 1. ✓
Lower: 2n + 10 >= 2n for n >= 1. So c1 = 2, n0 = 1. ✓
For all n >= 1: 2n <= 2n + 10 <= 12n. QED.
```

---

## Bug 5: Wrong Theta for Nested Loops

**Go (Buggy):**

```go
package main

import "fmt"

// triangleLoop claims Theta(n^2/2)
// BUG: There is no such thing as Theta(n^2/2)
// Time Complexity: Theta(n^2/2) because total ops = n*(n+1)/2
func triangleLoop(n int) int {
    count := 0
    for i := 0; i < n; i++ {
        for j := 0; j <= i; j++ {
            count++
        }
    }
    return count
}

func main() {
    fmt.Println(triangleLoop(100)) // 5050
}
```

**Java (Buggy):**

```java
public class Bug5 {
    // BUG: Theta(n^2/2) is not a valid Theta class
    // Time Complexity: Theta(n^2/2)
    public static int triangleLoop(int n) {
        int count = 0;
        for (int i = 0; i < n; i++) {
            for (int j = 0; j <= i; j++) {
                count++;
            }
        }
        return count;
    }
}
```

**Python (Buggy):**

```python
def triangle_loop(n: int) -> int:
    """
    BUG: Theta(n^2/2) is not a valid Theta class.
    Time Complexity: Theta(n^2/2)
    """
    count = 0
    for i in range(n):
        for j in range(i + 1):
            count += 1
    return count
```

### The Bug

Constants do not matter in Theta notation. Theta(n^2/2) = Theta(n^2). The
1/2 is absorbed into the constant. While n*(n+1)/2 operations is the exact
count, the Theta class is simply Theta(n^2).

### Fix

`Time Complexity: Theta(n^2). Exact count: n*(n+1)/2.`

---

## Bug 6: Misapplying Master Theorem

**Buggy analysis:**

```
Recurrence: T(n) = 2T(n/2) + n^2

Developer's analysis:
  a = 2, b = 2, f(n) = n^2
  c_crit = log_2(2) = 1
  f(n) = n^2, Case 2 because f(n) = Theta(n^c_crit)
  f(n) = n^2 = Theta(n^1)?  Yes! (BUG!)
  Result: Theta(n log n)  (WRONG!)
```

### The Bug

The developer incorrectly claimed n^2 = Theta(n^1). This is false. n^2 is NOT
Theta(n). Since f(n) = n^2 = Omega(n^(1+epsilon)) for epsilon = 1, this is
actually **Case 3** of the Master Theorem.

### Fix

```
a = 2, b = 2, c_crit = log_2(2) = 1
f(n) = n^2 = Omega(n^(1+1)), so Case 3.
Check regularity: 2*f(n/2) = 2*(n/2)^2 = n^2/2 <= (1/2)*n^2. ✓
Result: T(n) = Theta(n^2)
```

---

## Bug 7: Theta of Early-Exit Loop

**Go (Buggy):**

```go
package main

import "fmt"

// findFirst claims Theta(n) because it is a single loop
// BUG: This function has an early exit -- it is NOT always Theta(n)
// Time Complexity: Theta(n)
func findFirst(arr []int, target int) int {
    for i, v := range arr {
        if v == target {
            return i // <-- early exit!
        }
    }
    return -1
}

func main() {
    data := []int{5, 3, 8, 1, 9, 2, 7}
    fmt.Println(findFirst(data, 5)) // Found at index 0 -- Theta(1)!
    fmt.Println(findFirst(data, 7)) // Found at last -- Theta(n)
}
```

**Java (Buggy):**

```java
public class Bug7 {
    // BUG: Claims Theta(n) but has early exit
    public static int findFirst(int[] arr, int target) {
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] == target) return i;
        }
        return -1;
    }
}
```

**Python (Buggy):**

```python
def find_first(arr: list[int], target: int) -> int:
    """BUG: Claims Theta(n) but has early exit."""
    for i, v in enumerate(arr):
        if v == target:
            return i  # early exit!
    return -1
```

### The Bug

The early exit means best case is Theta(1), not Theta(n). Only the worst case
(element not found or at the end) is Theta(n).

### Fix

```
Time Complexity:
  Best case: Theta(1) -- target is the first element
  Worst case: Theta(n) -- target not found
  Cannot give a single Theta for all inputs
```

---

## Bug 8: Confusing Theta(2^n) and Theta(n^2)

**Buggy capacity planning:**

```
Developer's note:
  "Our algorithm is Theta(n^2). At n=20, it takes 1 second.
   At n=40, it should take about 4 seconds (doubling n squares the time)."

But the algorithm is actually recursive:
  f(n) = f(n-1) + f(n-2) + O(1)    (Fibonacci-style)
  which is Theta(2^n), NOT Theta(n^2)!
```

### The Bug

The developer confused Theta(n^2) with Theta(2^n). The prediction is wildly
wrong:

- Theta(n^2): at n=40, time = 1 * (40/20)^2 = 4 seconds
- Theta(2^n): at n=40, time = 1 * 2^(40-20) = 1,048,576 seconds = ~12 days!

### Fix

Correctly identify the recurrence. Fibonacci-style T(n) = T(n-1) + T(n-2) + O(1)
gives Theta(phi^n) where phi = (1+sqrt(5))/2 ~ 1.618. Even more precisely,
Theta(1.618^n). At n=40: 1 * 1.618^20 ~ 6765 seconds ~ 1.9 hours.

---

## Bug 9: Wrong Capacity Prediction

**Buggy code:**

```python
# BUG: Uses O-based analysis to make tight predictions
def predict_latency(current_n, current_latency, target_n):
    """
    Our sort algorithm is O(n^2).
    Prediction: latency scales as n^2.
    """
    return current_latency * (target_n / current_n) ** 2

# At n=1000, latency = 50ms
# Predict n=2000:
print(predict_latency(1000, 50, 2000))  # Predicts 200ms
```

### The Bug

The code says the algorithm is O(n^2) but uses it as if it were Theta(n^2) for
prediction. If the algorithm is actually merge sort (which is O(n^2) but also
Theta(n log n)), the prediction will be wildly wrong:

- Theta(n^2) prediction at n=2000: 200ms
- Actual Theta(n log n) at n=2000: ~55ms (not 200ms)

Using O for predictions gives upper bounds, not accurate forecasts.

### Fix

```python
import math

def predict_latency(current_n, current_latency, target_n, complexity="n_log_n"):
    """Use Theta (tight bound) for accurate predictions."""
    if complexity == "n_squared":
        return current_latency * (target_n / current_n) ** 2
    elif complexity == "n_log_n":
        factor = (target_n * math.log2(target_n)) / (current_n * math.log2(current_n))
        return current_latency * factor
    elif complexity == "linear":
        return current_latency * (target_n / current_n)
```

---

## Bug 10: Theta of Amortized Operations

**Go (Buggy):**

```go
package main

// DynamicArray with append that occasionally resizes
// BUG: Claims each append is Theta(n) because resize copies n elements
// Time Complexity: Theta(n) per append
type DynamicArray struct {
    data []int
    size int
    cap  int
}

func NewDynamicArray() *DynamicArray {
    return &DynamicArray{data: make([]int, 4), cap: 4}
}

func (d *DynamicArray) Append(val int) {
    if d.size == d.cap {
        // Resize: copy all elements -- O(n) for this one operation
        newCap := d.cap * 2
        newData := make([]int, newCap)
        copy(newData, d.data[:d.size])
        d.data = newData
        d.cap = newCap
    }
    d.data[d.size] = val
    d.size++
}
```

**Java (Buggy):**

```java
public class Bug10 {
    // BUG: Claims Theta(n) per append
    private int[] data;
    private int size, cap;

    public Bug10() {
        cap = 4;
        data = new int[cap];
    }

    // Time: Theta(n) per append  <-- BUG
    public void append(int val) {
        if (size == cap) {
            int[] newData = new int[cap * 2];
            System.arraycopy(data, 0, newData, 0, size);
            data = newData;
            cap *= 2;
        }
        data[size++] = val;
    }
}
```

**Python (Buggy):**

```python
class DynamicArray:
    """BUG: Claims Theta(n) per append."""

    def __init__(self):
        self._data = [None] * 4
        self._size = 0
        self._cap = 4

    def append(self, val):
        """Time: Theta(n) per append.  <-- BUG"""
        if self._size == self._cap:
            self._cap *= 2
            new_data = [None] * self._cap
            for i in range(self._size):
                new_data[i] = self._data[i]
            self._data = new_data
        self._data[self._size] = val
        self._size += 1
```

### The Bug

The developer confused the worst-case cost of a single operation with the
amortized cost. While a single append CAN cost Theta(n) when resizing occurs,
the **amortized** cost per append is Theta(1).

Over n appends, resizing happens at sizes 4, 8, 16, ..., n. The total copy cost
is 4 + 8 + 16 + ... + n = O(n). Spread across n appends: O(n)/n = O(1) amortized.

### Fix

```
Time Complexity:
  Worst case (single append with resize): Theta(n)
  Amortized (per append over n operations): Theta(1)
```

---

## Bug 11: Incorrect Limit Conclusion

**Buggy analysis:**

```
Claim: n*log(n) = Theta(n^2)
Proof via limits:
  lim n*log(n) / n^2 = lim log(n) / n = 0

  Since the limit exists, n*log(n) = Theta(n^2).  (BUG!)
```

### The Bug

The limit is 0, not a positive constant. When lim f(n)/g(n) = 0, it means
f(n) = o(g(n)) (little-o), which means f grows STRICTLY slower than g.
This means f(n) is NOT Theta(g(n)).

For Theta, the limit must be a POSITIVE FINITE constant (0 < L < infinity).

### Fix

```
lim n*log(n) / n^2 = lim log(n) / n = 0

Since the limit is 0, n*log(n) = o(n^2), meaning n*log(n) grows strictly
slower than n^2. Therefore n*log(n) is NOT Theta(n^2).

Correct: n*log(n) = Theta(n*log(n)).  Verify: lim n*log(n) / (n*log(n)) = 1. ✓
```

---

## Bug 12: Theta Symmetry Mistake

**Buggy reasoning:**

```
"Since n = O(n^2), we know n^2 = O(n) by symmetry."
```

### The Bug

Big-O is NOT symmetric. Only Big-Theta is symmetric.

- n = O(n^2) is TRUE (n grows at most as fast as n^2)
- n^2 = O(n) is FALSE (n^2 grows faster than n)

Symmetry property: if f(n) = Theta(g(n)), then g(n) = Theta(f(n)).
This does NOT apply to Big-O.

### Fix

```
O is not symmetric: n = O(n^2) does NOT imply n^2 = O(n).
O is like <=: a <= b does not imply b <= a.
Only Theta is symmetric: n^2 = Theta(n^2) implies n^2 = Theta(n^2). (trivially)
```

---

## Summary of Common Bugs

| # | Bug Type                          | Key Takeaway                                    |
|---|-----------------------------------|-------------------------------------------------|
| 1 | Confusing O with Theta            | O(n^2) does NOT mean Theta(n^2)                |
| 2 | Data-dependent branches           | Conditional inner loops prevent single Theta    |
| 3 | Ignoring best case                | Specify which case when using Theta             |
| 4 | Incomplete proofs                 | Must work for ALL n >= n0, not just one          |
| 5 | Constants in Theta                | Theta(n^2/2) = Theta(n^2), drop constants       |
| 6 | Master Theorem misapplication     | Check which case CORRECTLY                      |
| 7 | Early exit loops                  | Early returns break Theta(n) assumption         |
| 8 | Exponential vs polynomial         | Theta(2^n) vs Theta(n^2) are very different     |
| 9 | O-based predictions               | Use Theta for accurate capacity predictions     |
| 10| Amortized vs worst case           | Single op cost differs from amortized cost      |
| 11| Limit = 0 means NOT Theta         | Limit must be 0 < L < inf for Theta             |
| 12| O is not symmetric                | Only Theta has symmetry property                |

---

*Next: Continue to [Optimize](optimize.md) for optimization exercises.*
