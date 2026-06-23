# for range — Tasks

## Task 1: Sum All Elements (Easy)

Write a function that sums all integers in a slice using `for range`.

```go
package main

import "fmt"

// TODO: implement Sum
func Sum(nums []int) int {
    // your code here
}

func main() {
    fmt.Println(Sum([]int{1, 2, 3, 4, 5}))   // 15
    fmt.Println(Sum([]int{}))                  // 0
    fmt.Println(Sum([]int{-1, 1, -1, 1}))     // 0
}
```

**Requirements:**
- Use `for range`
- Handle empty slice (return 0)
- Do not use any standard library sum function

---

## Task 2: Reverse a Slice (Easy)

Write a function that returns a reversed copy of a slice using `for range`.

```go
package main

import "fmt"

// TODO: implement Reverse
func Reverse(s []int) []int {
    // your code here
    // Hint: create a new slice of same length, fill from the end
}

func main() {
    fmt.Println(Reverse([]int{1, 2, 3, 4, 5})) // [5 4 3 2 1]
    fmt.Println(Reverse([]int{1}))              // [1]
    fmt.Println(Reverse([]int{}))               // []
}
```

**Requirements:**
- Use `for range` to iterate the input slice
- Return a new slice (do not modify the original)

---

## Task 3: Word Frequency Map (Medium)

Count how many times each word appears in a slice.

```go
package main

import "fmt"

// TODO: implement WordFrequency
func WordFrequency(words []string) map[string]int {
    // your code here
}

func main() {
    words := []string{"go", "is", "great", "go", "is", "go"}
    freq := WordFrequency(words)
    // Expected: map[go:3 is:2 great:1]
    fmt.Println(freq["go"])    // 3
    fmt.Println(freq["is"])    // 2
    fmt.Println(freq["great"]) // 1
}
```

**Requirements:**
- Use `for range` over the words slice
- Use a map to count frequencies
- Return the frequency map

---

## Task 4: Filter Function (Medium)

Implement a generic-style filter for `[]int`.

```go
package main

import "fmt"

// TODO: implement Filter
func Filter(s []int, predicate func(int) bool) []int {
    // your code here
}

func main() {
    nums := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    evens := Filter(nums, func(n int) bool { return n%2 == 0 })
    fmt.Println(evens) // [2 4 6 8 10]

    positives := Filter([]int{-3, -1, 0, 2, 5}, func(n int) bool { return n > 0 })
    fmt.Println(positives) // [2 5]
}
```

**Requirements:**
- Use `for range`
- Pre-allocate result slice with `make`
- Do not modify the input slice

---

## Task 5: Matrix Transpose (Medium)

Transpose a 2D slice (rows become columns).

```go
package main

import "fmt"

// TODO: implement Transpose
func Transpose(matrix [][]int) [][]int {
    // your code here
    // Example: [[1,2,3],[4,5,6]] -> [[1,4],[2,5],[3,6]]
}

func main() {
    m := [][]int{
        {1, 2, 3},
        {4, 5, 6},
    }
    t := Transpose(m)
    for _, row := range t {
        fmt.Println(row)
    }
    // [1 4]
    // [2 5]
    // [3 6]
}
```

**Requirements:**
- Use nested `for range`
- Handle non-square matrices
- Return a new matrix

---

## Task 6: Sorted Map Keys (Medium)

Print all key-value pairs of a map in alphabetical order by key.

```go
package main

import (
    "fmt"
    "sort"
)

// TODO: implement PrintSorted
func PrintSorted(m map[string]int) {
    // Collect keys, sort, then print
    // your code here
}

func main() {
    scores := map[string]int{
        "Charlie": 85,
        "Alice":   95,
        "Bob":     72,
        "Dave":    88,
    }
    PrintSorted(scores)
    // Expected output (alphabetical):
    // Alice: 95
    // Bob: 72
    // Charlie: 85
    // Dave: 88
}
```

---

## Task 7: Channel Pipeline with for range (Hard)

Build a pipeline where a generator sends integers to a channel, a worker doubles them, and the main goroutine prints results.

```go
package main

import "fmt"

// TODO: implement generate — sends 1..n to a channel, then closes it
func generate(n int) <-chan int {
    // your code here
}

// TODO: implement double — reads from in, sends doubled values to out
func double(in <-chan int) <-chan int {
    // your code here
}

func main() {
    gen := generate(5)
    doubled := double(gen)
    for v := range doubled {
        fmt.Println(v)
    }
    // Expected: 2 4 6 8 10
}
```

**Requirements:**
- Use `for range` on the channel in `double`
- Close output channels properly
- Use goroutines

---

## Task 8: Count Unicode Characters (Hard)

Count the number of characters (runes) in a string, and also count multi-byte characters separately.

```go
package main

import "fmt"

// TODO: implement CharacterStats
func CharacterStats(s string) (totalChars int, multiByteChars int) {
    // Use for range over string
    // r is a rune — check its byte size
    // Hint: import "unicode/utf8" and use utf8.RuneLen(r)
}

func main() {
    total, multi := CharacterStats("Hello, 世界!")
    fmt.Println("Total chars:", total)       // 10
    fmt.Println("Multi-byte:", multi)        // 2
}
```

---

## Task 9: Group By (Hard)

Group a slice of items by a key function.

```go
package main

import "fmt"

// TODO: implement GroupBy
func GroupBy(items []string, keyFn func(string) string) map[string][]string {
    // your code here
    // Group items by the result of keyFn(item)
}

func main() {
    words := []string{"apple", "ant", "banana", "bear", "cherry", "cat"}
    grouped := GroupBy(words, func(s string) string {
        return string(s[0]) // group by first letter
    })

    // Print in some order
    for k, v := range grouped {
        fmt.Printf("%s: %v\n", k, v)
    }
    // a: [apple ant]
    // b: [banana bear]
    // c: [cherry cat]
}
```

---

## Task 10: Flatten Nested Map (Hard)

Flatten a `map[string]map[string]int` into a `map[string]int` with dot-separated keys.

```go
package main

import "fmt"

// TODO: implement Flatten
func Flatten(nested map[string]map[string]int) map[string]int {
    // Example: {"user": {"age": 30, "score": 95}}
    // -> {"user.age": 30, "user.score": 95}
}

func main() {
    nested := map[string]map[string]int{
        "user":    {"age": 30, "score": 95},
        "metrics": {"hits": 1000, "misses": 50},
    }
    flat := Flatten(nested)
    fmt.Println(flat["user.age"])     // 30
    fmt.Println(flat["metrics.hits"]) // 1000
}
```

---

## Task 11: Sliding Window Maximum (Expert)

Find the maximum value in every window of size `k` in a slice.

```go
package main

import "fmt"

// TODO: implement SlidingWindowMax
func SlidingWindowMax(nums []int, k int) []int {
    // For each window of size k, find the max
    // Use for range for the outer iteration
    // result[i] = max(nums[i], nums[i+1], ..., nums[i+k-1])
}

func main() {
    fmt.Println(SlidingWindowMax([]int{1, 3, -1, -3, 5, 3, 6, 7}, 3))
    // [3 3 5 5 6 7]
    fmt.Println(SlidingWindowMax([]int{1, 2, 3}, 1))
    // [1 2 3]
}
```

---

## Task 12: Concurrent Map Population (Expert)

Populate a map concurrently from multiple goroutines safely.

```go
package main

import (
    "fmt"
    "sync"
)

// TODO: implement populateConcurrently
// Launch n goroutines, each computing workerFn(i) and storing result in map[i]
func populateConcurrently(n int, workerFn func(int) int) map[int]int {
    // your code here
    // Use for range over n (Go 1.22+) or a slice
    // Protect map access with sync.Mutex
    // Wait for all goroutines with sync.WaitGroup
}

func main() {
    result := populateConcurrently(5, func(i int) int { return i * i })
    for i := range 5 {
        fmt.Printf("%d^2 = %d\n", i, result[i])
    }
    // 0^2 = 0
    // 1^2 = 1
    // 2^2 = 4
    // 3^2 = 9
    // 4^2 = 16
}
```

---

## Bonus Task 13: Range-Based Reduce

Implement a `Reduce` function that folds a slice to a single value.

```go
package main

import "fmt"

// TODO: implement Reduce
func Reduce(s []int, initial int, fn func(acc, val int) int) int {
    // your code here
}

func main() {
    nums := []int{1, 2, 3, 4, 5}
    sum := Reduce(nums, 0, func(acc, val int) int { return acc + val })
    fmt.Println("Sum:", sum) // 15

    product := Reduce(nums, 1, func(acc, val int) int { return acc * val })
    fmt.Println("Product:", product) // 120

    max := Reduce(nums, nums[0], func(acc, val int) int {
        if val > acc { return val }
        return acc
    })
    fmt.Println("Max:", max) // 5
}
```

---

## Solutions Reference

All tasks should be solvable using `for range` as the primary looping construct. Key patterns covered:

| Task | Key Pattern |
|---|---|
| 1 | Basic value accumulation |
| 2 | Index-based fill from end |
| 3 | Map building from range |
| 4 | Conditional append |
| 5 | Nested range for 2D |
| 6 | Collect keys, sort, range |
| 7 | Channel pipeline with range |
| 8 | String range (rune analysis) |
| 9 | Map building with grouping |
| 10 | Nested map range |
| 11 | Nested range with window |
| 12 | Concurrent range with sync |
| 13 | Functional reduce pattern |
