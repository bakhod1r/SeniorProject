# Array -- Find the Bug Exercises

Each exercise contains buggy code. Find the bug, explain what goes wrong, and fix it.

## Table of Contents

- [Bug 1: Off-by-One in Loop (Go)](#bug-1-off-by-one-in-loop-go)
- [Bug 2: Index Out of Bounds (Java)](#bug-2-index-out-of-bounds-java)
- [Bug 3: Wrong Resize Logic (Python)](#bug-3-wrong-resize-logic-python)
- [Bug 4: Slice Mutation Side Effect (Go)](#bug-4-slice-mutation-side-effect-go)
- [Bug 5: Integer Overflow in Two Sum (Java)](#bug-5-integer-overflow-in-two-sum-java)
- [Bug 6: Modifying List During Iteration (Python)](#bug-6-modifying-list-during-iteration-python)
- [Bug 7: Wrong Direction in Shift (Go)](#bug-7-wrong-direction-in-shift-go)
- [Bug 8: Comparing Arrays with == (Java)](#bug-8-comparing-arrays-with-java)
- [Bug 9: Forgot to Handle Empty Array (Python)](#bug-9-forgot-to-handle-empty-array-python)
- [Bug 10: Off-by-One in Binary Search (Go)](#bug-10-off-by-one-in-binary-search-go)
- [Bug 11: Wrong Append After Delete (Java)](#bug-11-wrong-append-after-delete-java)
- [Bug 12: Shallow Copy Trap (Python)](#bug-12-shallow-copy-trap-python)
- [Bug 13: Ring Buffer Wraparound (Go)](#bug-13-ring-buffer-wraparound-go)

---

## Bug 1: Off-by-One in Loop (Go)

### Buggy Code

```go
package main

import "fmt"

func sumArray(arr []int) int {
    sum := 0
    for i := 0; i <= len(arr); i++ {
        sum += arr[i]
    }
    return sum
}

func main() {
    data := []int{1, 2, 3, 4, 5}
    fmt.Println(sumArray(data))
}
```

### What Goes Wrong

The loop condition is `i <= len(arr)` which means when `i = len(arr) = 5`, the code tries to access `arr[5]`. Valid indices are 0 to 4. This causes a **panic: runtime error: index out of range [5] with length 5**.

### Fixed Code

```go
func sumArray(arr []int) int {
    sum := 0
    for i := 0; i < len(arr); i++ { // Changed <= to <
        sum += arr[i]
    }
    return sum
}
```

---

## Bug 2: Index Out of Bounds (Java)

### Buggy Code

```java
public class Bug2 {
    public static int secondLargest(int[] arr) {
        int first = Integer.MIN_VALUE;
        int second = Integer.MIN_VALUE;
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] > first) {
                second = first;
                first = arr[i];
            } else if (arr[i] > second) {
                second = arr[i];
            }
        }
        return second;
    }

    public static void main(String[] args) {
        int[] arr = {};  // empty array!
        System.out.println(secondLargest(arr));
    }
}
```

### What Goes Wrong

The function does not check if the array has at least 2 elements. For an empty array, it returns `Integer.MIN_VALUE`, which is misleading rather than reporting an error. For a single-element array, `second` remains `Integer.MIN_VALUE`. For arrays where all elements are equal, `second` is never updated correctly.

### Fixed Code

```java
public static int secondLargest(int[] arr) {
    if (arr.length < 2) {
        throw new IllegalArgumentException("Array must have at least 2 elements");
    }
    int first = Integer.MIN_VALUE;
    int second = Integer.MIN_VALUE;
    for (int val : arr) {
        if (val > first) {
            second = first;
            first = val;
        } else if (val > second && val != first) {
            second = val;
        }
    }
    if (second == Integer.MIN_VALUE) {
        throw new IllegalArgumentException("No distinct second largest element");
    }
    return second;
}
```

---

## Bug 3: Wrong Resize Logic (Python)

### Buggy Code

```python
class DynArray:
    def __init__(self):
        self.capacity = 4
        self.size = 0
        self.data = [None] * self.capacity

    def append(self, val):
        if self.size == self.capacity:
            self.capacity = self.capacity + 1  # BUG: grows by 1
            new_data = [None] * self.capacity
            for i in range(self.size):
                new_data[i] = self.data[i]
            self.data = new_data
        self.data[self.size] = val
        self.size += 1
```

### What Goes Wrong

The capacity grows by 1 each time instead of doubling. This means **every single append after the array is full triggers a resize**, making append O(n) instead of amortized O(1). Appending n elements costs O(n^2) total.

### Fixed Code

```python
def append(self, val):
    if self.size == self.capacity:
        self.capacity *= 2  # Double the capacity
        new_data = [None] * self.capacity
        for i in range(self.size):
            new_data[i] = self.data[i]
        self.data = new_data
    self.data[self.size] = val
    self.size += 1
```

---

## Bug 4: Slice Mutation Side Effect (Go)

### Buggy Code

```go
package main

import "fmt"

func removeFirst(s []int) []int {
    return s[1:]
}

func main() {
    original := []int{10, 20, 30, 40, 50}
    shortened := removeFirst(original)

    shortened[0] = 999 // Intending to modify only 'shortened'

    fmt.Println("original:", original)
    // Expected: [10, 20, 30, 40, 50]
    // Actual:   [10, 999, 30, 40, 50]  -- original is also modified!
}
```

### What Goes Wrong

In Go, slicing (`s[1:]`) creates a new slice header but shares the **same underlying array**. Modifying `shortened[0]` actually modifies `original[1]` because they point to the same memory.

### Fixed Code

```go
func removeFirst(s []int) []int {
    result := make([]int, len(s)-1)
    copy(result, s[1:])  // Copy to a new, independent array
    return result
}
```

---

## Bug 5: Integer Overflow in Two Sum (Java)

### Buggy Code

```java
public class Bug5 {
    public static int[] twoSumSorted(int[] arr, int target) {
        int left = 0, right = arr.length - 1;
        while (left < right) {
            int sum = arr[left] + arr[right]; // BUG: can overflow for large ints
            if (sum == target) return new int[]{left, right};
            else if (sum < target) left++;
            else right--;
        }
        return new int[]{-1, -1};
    }

    public static void main(String[] args) {
        int[] arr = {Integer.MIN_VALUE, -1, 0, 1, Integer.MAX_VALUE};
        int target = Integer.MAX_VALUE - 1;
        System.out.println(java.util.Arrays.toString(twoSumSorted(arr, target)));
    }
}
```

### What Goes Wrong

When `arr[left]` and `arr[right]` are both large (or both very negative), their sum can overflow a 32-bit `int`, wrapping around to a wrong value. For example, `Integer.MAX_VALUE + 1 = Integer.MIN_VALUE` in Java.

### Fixed Code

```java
public static int[] twoSumSorted(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    while (left < right) {
        long sum = (long) arr[left] + arr[right]; // Use long to avoid overflow
        if (sum == target) return new int[]{left, right};
        else if (sum < target) left++;
        else right--;
    }
    return new int[]{-1, -1};
}
```

---

## Bug 6: Modifying List During Iteration (Python)

### Buggy Code

```python
def remove_evens(arr):
    for i in range(len(arr)):
        if arr[i] % 2 == 0:
            arr.pop(i)
    return arr

data = [1, 2, 3, 4, 5, 6]
print(remove_evens(data))
# Expected: [1, 3, 5]
# Actual: IndexError (or skips elements)
```

### What Goes Wrong

When you `pop(i)`, the array shrinks and all subsequent indices shift left. The loop counter `i` still advances, so elements are skipped. When `i` reaches the original length, it is now out of bounds.

Example trace:
- i=0: arr=[1,2,3,4,5,6], arr[0]=1 (odd, skip)
- i=1: arr=[1,2,3,4,5,6], arr[1]=2 (even, pop) -> arr=[1,3,4,5,6]
- i=2: arr=[1,3,4,5,6], arr[2]=4 (even, pop) -> arr=[1,3,5,6] -- skipped 3!
- i=3: arr=[1,3,5,6], arr[3]=6 (even, pop) -> arr=[1,3,5]
- i=4: IndexError! len(arr) is 3

### Fixed Code

```python
# Option 1: Build a new list (preferred)
def remove_evens(arr):
    return [x for x in arr if x % 2 != 0]

# Option 2: Iterate in reverse
def remove_evens(arr):
    for i in range(len(arr) - 1, -1, -1):
        if arr[i] % 2 == 0:
            arr.pop(i)
    return arr
```

---

## Bug 7: Wrong Direction in Shift (Go)

### Buggy Code

```go
func insertAt(arr []int, index, value int) []int {
    arr = append(arr, 0) // make room
    // Shift elements right to make space at index
    for i := index; i < len(arr)-1; i++ {
        arr[i+1] = arr[i] // BUG: overwrites before reading
    }
    arr[index] = value
    return arr
}
```

### What Goes Wrong

The loop shifts from left to right starting at `index`. This means `arr[index]` is copied to `arr[index+1]`, then `arr[index+1]` (now the same value) is copied to `arr[index+2]`, etc. All positions from `index` onward end up with the same value.

### Fixed Code

```go
func insertAt(arr []int, index, value int) []int {
    arr = append(arr, 0)
    // Shift right-to-left to preserve values
    for i := len(arr) - 1; i > index; i-- {
        arr[i] = arr[i-1]
    }
    arr[index] = value
    return arr
}

// Or use Go's built-in copy:
func insertAt(arr []int, index, value int) []int {
    arr = append(arr, 0)
    copy(arr[index+1:], arr[index:])
    arr[index] = value
    return arr
}
```

---

## Bug 8: Comparing Arrays with == (Java)

### Buggy Code

```java
public class Bug8 {
    public static void main(String[] args) {
        int[] a = {1, 2, 3};
        int[] b = {1, 2, 3};

        if (a == b) {
            System.out.println("Arrays are equal");
        } else {
            System.out.println("Arrays are NOT equal"); // This prints!
        }
    }
}
```

### What Goes Wrong

In Java, `==` compares **references** (memory addresses), not array contents. `a` and `b` are different objects in memory, so `a == b` is `false` even though they contain the same elements.

### Fixed Code

```java
import java.util.Arrays;

if (Arrays.equals(a, b)) {
    System.out.println("Arrays are equal"); // Now prints correctly
}

// For 2D arrays:
// Arrays.deepEquals(a2d, b2d);
```

---

## Bug 9: Forgot to Handle Empty Array (Python)

### Buggy Code

```python
def find_max(arr):
    max_val = arr[0]  # BUG: crashes on empty list
    for v in arr[1:]:
        if v > max_val:
            max_val = v
    return max_val

print(find_max([]))  # IndexError: list index out of range
```

### What Goes Wrong

Accessing `arr[0]` on an empty list raises `IndexError`. The function assumes the array has at least one element without checking.

### Fixed Code

```python
def find_max(arr):
    if not arr:
        raise ValueError("Cannot find max of empty array")
    max_val = arr[0]
    for v in arr[1:]:
        if v > max_val:
            max_val = v
    return max_val

# Or use built-in:
# max(arr)  -- also raises ValueError on empty
```

---

## Bug 10: Off-by-One in Binary Search (Go)

### Buggy Code

```go
func binarySearch(arr []int, target int) int {
    low, high := 0, len(arr) // BUG: high should be len(arr)-1
    for low <= high {
        mid := (low + high) / 2
        if arr[mid] == target { // BUG: arr[len(arr)] panics
            return mid
        } else if arr[mid] < target {
            low = mid + 1
        } else {
            high = mid - 1
        }
    }
    return -1
}
```

### What Goes Wrong

`high` is initialized to `len(arr)` instead of `len(arr)-1`. When `low = high = len(arr)`, accessing `arr[mid]` causes an index-out-of-range panic.

Additionally, `(low + high) / 2` can overflow for large arrays in languages with fixed-size integers (though Go's int is 64-bit, it is still a bad habit).

### Fixed Code

```go
func binarySearch(arr []int, target int) int {
    low, high := 0, len(arr)-1              // Fix: len(arr)-1
    for low <= high {
        mid := low + (high-low)/2            // Fix: avoids overflow
        if arr[mid] == target {
            return mid
        } else if arr[mid] < target {
            low = mid + 1
        } else {
            high = mid - 1
        }
    }
    return -1
}
```

---

## Bug 11: Wrong Append After Delete (Java)

### Buggy Code

```java
import java.util.ArrayList;

public class Bug11 {
    public static void main(String[] args) {
        ArrayList<Integer> list = new ArrayList<>();
        list.add(10);
        list.add(20);
        list.add(30);

        // Remove element with value 20
        list.remove(20); // BUG: removes element at INDEX 20, not value 20!
    }
}
```

### What Goes Wrong

`ArrayList.remove(int)` removes the element at the given **index**. `ArrayList.remove(Object)` removes the first occurrence of the given **value**. Since `20` is an `int` literal, Java calls `remove(int index)`, attempting to remove the element at index 20, which throws `IndexOutOfBoundsException`.

### Fixed Code

```java
// Option 1: Cast to Object to use remove-by-value
list.remove(Integer.valueOf(20));

// Option 2: Find index first
int idx = list.indexOf(20);
if (idx != -1) list.remove(idx);
```

---

## Bug 12: Shallow Copy Trap (Python)

### Buggy Code

```python
# Create a 3x3 grid initialized to 0
grid = [[0] * 3] * 3
grid[0][0] = 1

print(grid)
# Expected: [[1, 0, 0], [0, 0, 0], [0, 0, 0]]
# Actual:   [[1, 0, 0], [1, 0, 0], [1, 0, 0]]
```

### What Goes Wrong

`[[0] * 3] * 3` creates 3 references to the **same** inner list. Modifying one row modifies all rows because they are the same object.

### Fixed Code

```python
# Each row is an independent list
grid = [[0] * 3 for _ in range(3)]
grid[0][0] = 1
print(grid)  # [[1, 0, 0], [0, 0, 0], [0, 0, 0]]
```

---

## Bug 13: Ring Buffer Wraparound (Go)

### Buggy Code

```go
type RingBuffer struct {
    data     []int
    head     int
    tail     int
    capacity int
}

func (rb *RingBuffer) Enqueue(val int) {
    rb.data[rb.tail] = val
    rb.tail = rb.tail + 1 // BUG: no wraparound!
}

func (rb *RingBuffer) Dequeue() int {
    val := rb.data[rb.head]
    rb.head = rb.head + 1 // BUG: no wraparound!
    return val
}
```

### What Goes Wrong

Without modular arithmetic, `tail` and `head` grow beyond the array bounds. After `capacity` enqueues, `rb.tail = capacity` and the next write causes a panic. The buffer never reuses space freed by dequeues.

### Fixed Code

```go
func (rb *RingBuffer) Enqueue(val int) {
    rb.data[rb.tail] = val
    rb.tail = (rb.tail + 1) % rb.capacity // Wrap around
}

func (rb *RingBuffer) Dequeue() int {
    val := rb.data[rb.head]
    rb.head = (rb.head + 1) % rb.capacity // Wrap around
    return val
}
```
