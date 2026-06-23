# Go for Loop (C-style) — Tasks

## Instructions

Each task includes a description, starter code, expected output, and evaluation checklist. Implement the solution using C-style `for` loops unless otherwise specified.

---

## Task 1 — FizzBuzz

**Difficulty**: Beginner
**Topic**: Basic for loop, conditional

**Description**: Print numbers 1 to 100. For multiples of 3, print "Fizz". For multiples of 5, print "Buzz". For multiples of both, print "FizzBuzz".

**Starter Code**:
```go
package main

import "fmt"

func fizzBuzz(n int) {
    // TODO: implement using for loop
}

func main() {
    fizzBuzz(20)
}
```

**Expected Output**:
```
1
2
Fizz
4
Buzz
Fizz
7
8
Fizz
Buzz
11
Fizz
13
14
FizzBuzz
16
17
Fizz
19
Buzz
```

**Evaluation Checklist**:
- [ ] Uses C-style for loop `for i := 1; i <= n; i++`
- [ ] Correct FizzBuzz order (check 15 before 3 and 5)
- [ ] Correct for all n from 1 to 100

---

## Task 2 — Sum of Squares

**Difficulty**: Beginner
**Topic**: Accumulator pattern, mathematical formula

**Description**: Implement `sumOfSquares(n int) int` that returns the sum of squares from 1² to n².

**Starter Code**:
```go
package main

import "fmt"

func sumOfSquares(n int) int {
    // TODO: implement using for loop
    return 0
}

func main() {
    for _, n := range []int{1, 5, 10, 100} {
        fmt.Printf("sumOfSquares(%d) = %d\n", n, sumOfSquares(n))
    }
}
```

**Expected Output**:
```
sumOfSquares(1) = 1
sumOfSquares(5) = 55
sumOfSquares(10) = 385
sumOfSquares(100) = 338350
```

**Evaluation Checklist**:
- [ ] Uses for loop (not formula)
- [ ] Correct for n=0 (returns 0)
- [ ] Correct for all positive n
- [ ] No off-by-one (includes n² in the sum)

---

## Task 3 — Reverse a String

**Difficulty**: Beginner
**Topic**: Two-pointer pattern, string/rune handling

**Description**: Implement `reverseString(s string) string` using a for loop with two pointers.

**Starter Code**:
```go
package main

import "fmt"

func reverseString(s string) string {
    // TODO: implement using for loop with two pointers
    // Hint: convert to []rune for Unicode correctness
    return ""
}

func main() {
    words := []string{"hello", "golang", "racecar", ""}
    for _, w := range words {
        fmt.Printf("reverse(%q) = %q\n", w, reverseString(w))
    }
}
```

**Expected Output**:
```
reverse("hello") = "olleh"
reverse("golang") = "gnalog"
reverse("racecar") = "racecar"
reverse("") = ""
```

**Evaluation Checklist**:
- [ ] Uses two-pointer for loop (`for i, j := 0, n-1; i < j; i, j = i+1, j-1`)
- [ ] Handles empty string
- [ ] Works correctly for palindromes
- [ ] Uses `[]rune` for Unicode correctness

---

## Task 4 — Prime Numbers

**Difficulty**: Beginner-Intermediate
**Topic**: Nested loops, break, early termination

**Description**: Implement `primesUpTo(n int) []int` that returns all prime numbers from 2 to n.

**Starter Code**:
```go
package main

import "fmt"

func primesUpTo(n int) []int {
    // TODO: implement using nested for loops
    // For each candidate, check if it's divisible by any number from 2 to sqrt(candidate)
    return nil
}

func main() {
    fmt.Println(primesUpTo(30))
    fmt.Println(primesUpTo(50))
    fmt.Println(len(primesUpTo(1000)), "primes up to 1000")
}
```

**Expected Output**:
```
[2 3 5 7 11 13 17 19 23 29]
[2 3 5 7 11 13 17 19 23 29 31 37 41 43 47]
168 primes up to 1000
```

**Evaluation Checklist**:
- [ ] Uses nested for loops
- [ ] Uses `break` when a factor is found
- [ ] Checks divisors up to sqrt(n) only
- [ ] Correctly identifies 168 primes up to 1000
- [ ] Returns empty/nil for n < 2

---

## Task 5 — Binary Search

**Difficulty**: Intermediate
**Topic**: Two-pointer convergence, loop invariants

**Description**: Implement `binarySearch(sorted []int, target int) int` returning the index of target, or -1 if not found.

**Starter Code**:
```go
package main

import "fmt"

func binarySearch(sorted []int, target int) int {
    // TODO: implement using for loop with lo and hi pointers
    // Use lo + (hi-lo)/2 to avoid overflow
    return -1
}

func main() {
    s := []int{1, 3, 5, 7, 9, 11, 13, 15, 17, 19}
    tests := []int{1, 7, 15, 19, 4, 20, -1}
    for _, t := range tests {
        fmt.Printf("search(%d) = index %d\n", t, binarySearch(s, t))
    }
}
```

**Expected Output**:
```
search(1) = index 0
search(7) = index 3
search(15) = index 7
search(19) = index 9
search(4) = index -1
search(20) = index -1
search(-1) = index -1
```

**Evaluation Checklist**:
- [ ] Uses `for lo <= hi` form (not `lo < hi`)
- [ ] Uses `lo + (hi-lo)/2` (not `(lo+hi)/2`)
- [ ] Updates `lo = mid+1` and `hi = mid-1` (not `mid`)
- [ ] Returns correct index for first and last elements
- [ ] Returns -1 for absent values
- [ ] Handles empty slice

---

## Task 6 — Matrix Multiplication

**Difficulty**: Intermediate
**Topic**: Triple nested loop, 2D arrays

**Description**: Implement `matMul(a, b [][]int) [][]int` that multiplies two matrices.

**Starter Code**:
```go
package main

import "fmt"

func matMul(a, b [][]int) [][]int {
    // TODO: implement using triple nested for loop
    // rows(result) = rows(a), cols(result) = cols(b)
    // result[i][j] = sum(a[i][k] * b[k][j]) for k in range(cols(a))
    return nil
}

func printMatrix(m [][]int) {
    for _, row := range m {
        fmt.Println(row)
    }
}

func main() {
    a := [][]int{{1, 2}, {3, 4}}
    b := [][]int{{5, 6}, {7, 8}}
    fmt.Println("A x B =")
    printMatrix(matMul(a, b))

    c := [][]int{{1, 2, 3}, {4, 5, 6}}
    d := [][]int{{7, 8}, {9, 10}, {11, 12}}
    fmt.Println("C x D =")
    printMatrix(matMul(c, d))
}
```

**Expected Output**:
```
A x B =
[19 22]
[43 50]
C x D =
[58 64]
[139 154]
```

**Evaluation Checklist**:
- [ ] Uses three nested for loops (i, j, k)
- [ ] Pre-allocates result matrix correctly
- [ ] Handles non-square matrices
- [ ] Correct for 2x2 and 2x3 × 3x2 cases

---

## Task 7 — Sliding Window Maximum

**Difficulty**: Intermediate
**Topic**: Sliding window, two-index for loop

**Description**: Implement `maxSumSubarray(nums []int, k int) (int, int)` returning the maximum sum and its starting index for subarrays of size k.

**Starter Code**:
```go
package main

import "fmt"

func maxSumSubarray(nums []int, k int) (maxSum, startIdx int) {
    // TODO: implement using sliding window
    // First: sum the first window
    // Then: slide by adding next element and removing first element of window
    return 0, -1
}

func main() {
    cases := []struct {
        nums []int
        k    int
    }{
        {[]int{2, 1, 5, 1, 3, 2}, 3},
        {[]int{2, 3, 4, 1, 5}, 2},
        {[]int{-1, -2, -3, -4}, 2},
    }
    for _, c := range cases {
        sum, idx := maxSumSubarray(c.nums, c.k)
        fmt.Printf("maxSum=%d at index %d (subarray %v)\n",
            sum, idx, c.nums[idx:idx+c.k])
    }
}
```

**Expected Output**:
```
maxSum=9 at index 1 (subarray [1 5 1])
maxSum=7 at index 1 (subarray [3 4])
maxSum=-3 at index 0 (subarray [-1 -2])
```

**Evaluation Checklist**:
- [ ] First window computed with initial for loop
- [ ] Sliding step uses `+nums[i] - nums[i-k]`
- [ ] Tracks starting index of maximum window
- [ ] Handles negative numbers correctly
- [ ] Returns -1 start index for k > len(nums)

---

## Task 8 — Concurrent Batch Processor

**Difficulty**: Advanced
**Topic**: Goroutines from for loop, safe variable capture, WaitGroup

**Description**: Implement `processBatch(items []int, workers int, fn func(int) int) []int` that processes items concurrently with bounded parallelism.

**Starter Code**:
```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func processBatch(items []int, workers int, fn func(int) int) []int {
    results := make([]int, len(items))
    // TODO: divide items among `workers` goroutines
    // Each goroutine processes its slice of items
    // Use WaitGroup for synchronization
    // IMPORTANT: capture loop variables correctly!
    return results
}

func main() {
    items := make([]int, 20)
    for i := range items {
        items[i] = i + 1
    }

    slowSquare := func(n int) int {
        time.Sleep(10 * time.Millisecond)  // simulate work
        return n * n
    }

    start := time.Now()
    results := processBatch(items, 4, slowSquare)
    elapsed := time.Since(start)

    fmt.Println("Results:", results[:5], "...")
    fmt.Printf("4 workers finished in %v (sequential would take ~%v)\n",
        elapsed.Round(time.Millisecond),
        time.Duration(len(items))*10*time.Millisecond)
}
```

**Expected Output**:
```
Results: [1 4 9 16 25] ...
4 workers finished in ~50ms (sequential would take ~200ms)
```

**Evaluation Checklist**:
- [ ] Creates exactly `workers` goroutines
- [ ] Each goroutine processes its own slice (no overlap)
- [ ] Loop variables passed correctly (not captured by closure reference)
- [ ] Uses `sync.WaitGroup` correctly
- [ ] Results are in correct order (index-based writes)
- [ ] Runs faster than sequential (at least 3x for 4 workers on 20 items)

---

## Task 9 — Sieve of Eratosthenes

**Difficulty**: Advanced
**Topic**: Multi-loop algorithm, in-place marking

**Description**: Implement `sieve(n int) []int` using the Sieve of Eratosthenes algorithm.

**Starter Code**:
```go
package main

import "fmt"

func sieve(n int) []int {
    // TODO: implement Sieve of Eratosthenes
    // 1. Create a boolean slice of size n+1, all true
    // 2. For each prime p starting from 2:
    //    Mark all multiples of p (starting from p*p) as false
    // 3. Collect all indices that remain true
    return nil
}

func main() {
    primes := sieve(50)
    fmt.Println("Primes up to 50:", primes)
    fmt.Println("Count up to 100:", len(sieve(100)))
    fmt.Println("Count up to 1000:", len(sieve(1000)))
}
```

**Expected Output**:
```
Primes up to 50: [2 3 5 7 11 13 17 19 23 29 31 37 41 43 47]
Count up to 100: 25
Count up to 1000: 168
```

**Evaluation Checklist**:
- [ ] Outer loop runs from 2 to sqrt(n)
- [ ] Inner loop marks multiples starting from `p*p`
- [ ] Inner loop step is `p` (not 1)
- [ ] Correctly counts 25 primes up to 100
- [ ] Correctly counts 168 primes up to 1000
- [ ] Handles edge cases: n < 2 returns empty

---

## Task 10 — LRU Cache with for Loop Eviction

**Difficulty**: Advanced
**Topic**: Data structure, index-based loop for eviction

**Description**: Implement a simple LRU cache using a slice and a for loop for eviction (no fancy data structures required).

**Starter Code**:
```go
package main

import "fmt"

type LRUCache struct {
    capacity int
    keys     []string
    values   []int
}

func NewLRU(capacity int) *LRUCache {
    return &LRUCache{
        capacity: capacity,
        keys:     make([]string, 0, capacity),
        values:   make([]int, 0, capacity),
    }
}

func (c *LRUCache) Get(key string) (int, bool) {
    // TODO: find key using for loop
    // If found: move to front (most recently used), return value
    return 0, false
}

func (c *LRUCache) Put(key string, value int) {
    // TODO: check if key exists (update + move to front)
    // If not exists: add to front
    // If at capacity: evict last element (least recently used)
}

func (c *LRUCache) Keys() []string { return c.keys }

func main() {
    cache := NewLRU(3)
    cache.Put("a", 1)
    cache.Put("b", 2)
    cache.Put("c", 3)
    fmt.Println("Keys:", cache.Keys())  // [c b a]

    val, ok := cache.Get("a")
    fmt.Printf("Get(a)=%d ok=%v, Keys: %v\n", val, ok, cache.Keys())  // a moved to front

    cache.Put("d", 4)  // evicts least recently used
    fmt.Println("After adding d:", cache.Keys())  // b evicted

    _, ok = cache.Get("b")
    fmt.Println("b still exists:", ok)  // false
}
```

**Expected Output**:
```
Keys: [c b a]
Get(a)=1 ok=true, Keys: [a c b]
After adding d: [d a c]
b still exists: false
```

**Evaluation Checklist**:
- [ ] `Get` uses for loop to find key by index
- [ ] `Get` moves found key to front (most recently used)
- [ ] `Put` checks for existing key first
- [ ] `Put` evicts last element when at capacity
- [ ] LRU ordering is maintained correctly
- [ ] Handles empty cache get

---

## Task 11 — Spiral Matrix Traversal

**Difficulty**: Expert
**Topic**: Multi-variable for loop, boundary tracking

**Description**: Implement `spiralOrder(matrix [][]int) []int` that returns all elements in spiral order.

**Starter Code**:
```go
package main

import "fmt"

func spiralOrder(matrix [][]int) []int {
    // TODO: traverse matrix in spiral order
    // Use 4 boundary variables: top, bottom, left, right
    // Four for loops per layer:
    // 1. left to right along top row, then top++
    // 2. top to bottom along right column, then right--
    // 3. right to left along bottom row, then bottom--
    // 4. bottom to top along left column, then left++
    return nil
}

func main() {
    m1 := [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}
    fmt.Println(spiralOrder(m1))

    m2 := [][]int{{1, 2, 3, 4}, {5, 6, 7, 8}, {9, 10, 11, 12}}
    fmt.Println(spiralOrder(m2))
}
```

**Expected Output**:
```
[1 2 3 6 9 8 7 4 5]
[1 2 3 4 8 12 11 10 9 5 6 7]
```

**Evaluation Checklist**:
- [ ] Uses 4 boundary variables (top, bottom, left, right)
- [ ] Four directional for loops per spiral layer
- [ ] Boundary conditions updated correctly after each direction
- [ ] Handles non-square matrices
- [ ] Correct for 3x3 and 3x4 matrices
- [ ] Handles single row and single column edge cases
