# Slices — Tasks

## Junior Tasks

### Task 1: Slice Operations Fundamentals
- **Type:** Implementation
- **Goal:** Practice creating, slicing, appending, and copying slices.

**Starter Code:**
```go
package main

import "fmt"

func main() {
    // TODO 1: Create []int{10, 20, 30, 40, 50}
    // TODO 2: Print length and capacity
    // TODO 3: Create sub-slice s[1:4]
    // TODO 4: Modify sub[0] = 99, print both slices
    // TODO 5: Make independent copy using copy()
    // TODO 6: Modify copy[0] = 0, print both
    // TODO 7: Append 60, 70, 80 to original
    // TODO 8: Print new length and capacity
}
```

**Expected Output:**
```
Original: [10 20 30 40 50] len=5 cap=5
Sub-slice [1:4]: [20 30 40]
After sub[0]=99: original=[10 99 30 40 50] sub=[99 30 40]
After copy[0]=0: original=[10 99 30 40 50] copy=[0 99 30 40 50]
After append: [10 99 30 40 50 60 70 80] len=8
```

**Evaluation Criteria:**
- Correct slice literal creation
- Correct sub-slice syntax and shared-memory demonstration
- Correct use of `copy()` for independent duplicate
- `append` result assigned back

---

### Task 2: Filter and Transform Pipeline
- **Type:** Functional Programming
- **Goal:** Implement filter and map operations on slices.

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

// filter returns elements where pred returns true
func filter(words []string, pred func(string) bool) []string {
    // TODO: pre-allocate with make([]string, 0, len(words))
    return nil
}

// transform applies f to each element
func transform(words []string, f func(string) string) []string {
    // TODO: use make([]string, len(words)) — size is known
    return nil
}

func main() {
    words := []string{"apple", "banana", "cherry", "apricot", "blueberry"}

    aWords := filter(words, func(w string) bool { return strings.HasPrefix(w, "a") })
    fmt.Println("Starting with 'a':", aWords)

    upper := transform(words, strings.ToUpper)
    fmt.Println("Uppercase:", upper)

    result := transform(filter(words, func(w string) bool {
        return strings.HasPrefix(w, "a")
    }), strings.ToUpper)
    fmt.Println("Uppercase 'a' words:", result)
}
```

**Expected Output:**
```
Starting with 'a': [apple apricot]
Uppercase: [APPLE BANANA CHERRY APRICOT BLUEBERRY]
Uppercase 'a' words: [APPLE APRICOT]
```

**Evaluation Criteria:**
- Pre-allocate in filter (`make([]string, 0, len(words))`)
- No mutation of input slice
- Correct closure usage
- Chain of filter+transform works correctly

---

### Task 3: Stack Implementation
- **Type:** Data Structure
- **Goal:** Build a LIFO stack backed by a slice.

**Starter Code:**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrEmpty = errors.New("stack is empty")

type Stack struct{ data []int }

func (s *Stack) Push(v int) { /* TODO: append v */ }
func (s *Stack) Pop() (int, error) {
    /* TODO: return ErrEmpty if empty; return last element, shrink data */
    return 0, nil
}
func (s *Stack) Peek() (int, error) {
    /* TODO: return top without removing */
    return 0, nil
}
func (s *Stack) Len() int { return len(s.data) }

func main() {
    s := &Stack{}
    s.Push(10); s.Push(20); s.Push(30)
    v, _ := s.Peek()
    fmt.Println("Peek:", v) // 30
    for s.Len() > 0 {
        v, _ := s.Pop()
        fmt.Println("Pop:", v)
    }
    _, err := s.Pop()
    fmt.Println("Empty pop:", err)
}
```

**Expected Output:**
```
Peek: 30
Pop: 30
Pop: 20
Pop: 10
Empty pop: stack is empty
```

**Evaluation Criteria:**
- LIFO ordering correct
- `Pop` shrinks slice with `s.data = s.data[:n-1]`
- `Peek` does not modify slice
- Error returned for empty stack

---

## Middle Tasks

### Task 4: Sliding Window Maximum
- **Type:** Algorithm
- **Goal:** Compute the maximum in each window of size k over a slice.

**Starter Code:**
```go
package main

import "fmt"

// slidingWindowMax returns the maximum in each window of size k.
// [3,1,2,5,4,2,3,5] k=3 → [3,5,5,5,4,5]
func slidingWindowMax(nums []int, k int) []int {
    if len(nums) == 0 || k <= 0 || k > len(nums) {
        return []int{}
    }
    // TODO: pre-allocate result := make([]int, 0, len(nums)-k+1)
    // For each window [i:i+k], find the maximum and append it
    return nil
}

func main() {
    fmt.Println(slidingWindowMax([]int{3, 1, 2, 5, 4, 2, 3, 5}, 3)) // [3 5 5 5 4 5]
    fmt.Println(slidingWindowMax([]int{3, 1, 2, 5, 4, 2, 3, 5}, 1)) // [3 1 2 5 4 2 3 5]
    fmt.Println(slidingWindowMax([]int{3, 1, 2, 5, 4, 2, 3, 5}, 8)) // [5]
    fmt.Println(slidingWindowMax([]int{}, 3))                         // []
}
```

**Expected Output:**
```
[3 5 5 5 4 5]
[3 1 2 5 4 2 3 5]
[5]
[]
```

**Evaluation Criteria:**
- Pre-allocation with correct capacity
- Handles edge cases (empty, k=1, k=len)
- Correct maximum per window

---

### Task 5: In-Place Deduplication
- **Type:** Algorithm + Memory Efficiency
- **Goal:** Remove duplicates in-place with zero allocation.

**Starter Code:**
```go
package main

import "fmt"

// dedupSorted removes consecutive duplicates from sorted slice in-place.
// Returns sub-slice of same backing array — zero allocation.
func dedupSorted(s []int) []int {
    // TODO: two-pointer technique
    // write pointer w=1, read pointer r=1
    // if s[r] != s[w-1], copy s[r] to s[w] and increment w
    return s
}

// dedupUnsorted removes all duplicates (any order), may allocate.
func dedupUnsorted(s []int) []int {
    // TODO: use map[int]struct{} for seen tracking
    return nil
}

func main() {
    sorted := []int{1, 1, 2, 3, 3, 3, 4, 4}
    fmt.Println("Sorted dedup:", dedupSorted(sorted)) // [1 2 3 4]

    unsorted := []int{3, 1, 2, 1, 3, 4, 2}
    fmt.Println("Unsorted dedup:", dedupUnsorted(unsorted)) // order may vary
}
```

**Expected Output:**
```
Sorted dedup: [1 2 3 4]
Unsorted dedup: [3 1 2 4]
```

**Evaluation Criteria:**
- `dedupSorted`: O(n) time, O(1) space (two-pointer)
- `dedupUnsorted`: O(n) time, O(n) space (map)
- Verify zero allocs for `dedupSorted` with benchmark

---

### Task 6: Concurrent Chunk Processing
- **Type:** Concurrency + Slices
- **Goal:** Split a slice into chunks and process them concurrently.

**Starter Code:**
```go
package main

import (
    "fmt"
    "sync"
)

// chunk splits s into sub-slices of size chunkSize (shares backing array)
func chunk(s []int, chunkSize int) [][]int {
    // TODO: no copy — return sub-slices
    return nil
}

// concurrentSum sums nums using numWorkers goroutines
func concurrentSum(nums []int, numWorkers int) int {
    // TODO: split into chunks, launch goroutines, collect results via channel
    return 0
}

func main() {
    nums := make([]int, 1000)
    for i := range nums { nums[i] = i + 1 }
    fmt.Println("Sum:", concurrentSum(nums, 4)) // 500500

    chunks := chunk([]int{1, 2, 3, 4, 5, 6, 7}, 3)
    fmt.Println("Chunks:", chunks) // [[1 2 3] [4 5 6] [7]]
}
```

**Expected Output:**
```
Sum: 500500
Chunks: [[1 2 3] [4 5 6] [7]]
```

**Evaluation Criteria:**
- `chunk` returns sub-slices (no data copy)
- Correct goroutine coordination (WaitGroup or channel)
- No data races (`go test -race`)
- Correct sum

---

## Senior Tasks

### Task 7: Pooled Log Buffer
- **Type:** Production System
- **Goal:** Log buffer reusing byte slices from sync.Pool.

**Starter Code:**
```go
package main

import (
    "fmt"
    "sync"
)

type LogBuffer struct {
    pool    sync.Pool
    mu      sync.Mutex
    entries []string
}

func NewLogBuffer() *LogBuffer {
    lb := &LogBuffer{entries: make([]string, 0)}
    lb.pool.New = func() interface{} {
        b := make([]byte, 0, 4096)
        return &b
    }
    return lb
}

// Log formats a message into a pooled buffer, stores a copy in entries
func (lb *LogBuffer) Log(msg string) {
    // TODO: Get buffer from pool, append msg, copy result, store, put back
}

// Flush returns entries and resets
func (lb *LogBuffer) Flush() []string {
    lb.mu.Lock()
    defer lb.mu.Unlock()
    e := lb.entries
    lb.entries = lb.entries[:0]
    return e
}

func main() {
    lb := NewLogBuffer()
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            lb.Log(fmt.Sprintf("event %d", n))
        }(i)
    }
    wg.Wait()
    entries := lb.Flush()
    fmt.Println("Logged entries:", len(entries)) // 10
}
```

**Expected Output:**
```
Logged entries: 10
```

**Evaluation Criteria:**
- Pool reuses byte slices
- Independent copy stored (not the pooled buffer)
- Thread-safe with mutex
- No data races

---

### Task 8: Benchmark: Pre-allocation vs Dynamic Growth
- **Type:** Performance Analysis
- **Goal:** Quantify allocation cost of growing slices vs pre-allocated.

**Starter Code:**
```go
package slices_bench_test

import "testing"

// appendNoDynamic: no pre-allocation
func appendDynamic(n int) []int {
    var s []int
    for i := 0; i < n; i++ { s = append(s, i) }
    return s
}

// appendPrealloc: pre-allocated capacity
func appendPrealloc(n int) []int {
    s := make([]int, 0, n)
    for i := 0; i < n; i++ { s = append(s, i) }
    return s
}

// TODO: Write BenchmarkDynamic1000 and BenchmarkPrealloc1000
// TODO: Write BenchmarkDynamic100000 and BenchmarkPrealloc100000
// TODO: Add b.ReportAllocs() to all benchmarks
// TODO: Add a comment analyzing how allocation count scales with n
```

**Expected Analysis:**
- Dynamic: O(log n) allocations (growth events)
- Pre-alloc: 1 allocation always
- Memory per alloc: ~2x for dynamic due to doubling

**Evaluation Criteria:**
- Correct benchmark signatures
- `b.ResetTimer()` after setup
- `b.ReportAllocs()` used
- Written analysis of scaling behavior

---

## Questions

**Q1:** What is `len` and `cap` of `s[2:5]` where `s = make([]int, 8)`?
**Answer:** `len=3` (5-2), `cap=6` (8-2).

---

**Q2:** Does `var s []int` or `s := []int{}` produce a nil slice?
**Answer:** `var s []int` is nil. `[]int{}` is non-nil (but empty).

---

**Q3:** What does `s = append(s[:i], s[i+1:]...)` do?
**Answer:** Deletes the element at index `i` while preserving order. The `...` spreads the slice elements as individual arguments to `append`.

---

**Q4:** Why is `for _, v := range s { v++ }` ineffective for incrementing elements?
**Answer:** `v` is a copy of each element. To increment in place, use `for i := range s { s[i]++ }`.

---

**Q5:** What is the capacity of `make([]byte, 3, 10)[2:5]`?
**Answer:** `cap = 10 - 2 = 8`.

---

## Mini Projects

### Mini Project 1: Streaming Word Counter
Process text as a stream of `[]byte` chunks. Handle words that span chunk boundaries. Return top-N frequencies:
```go
type WordCounter struct {}
func (wc *WordCounter) AddChunk(data []byte)
func (wc *WordCounter) TopN(n int) []string
```

### Mini Project 2: Circular Event Log
Fixed-capacity log that overwrites oldest events when full:
```go
type CircularLog struct {}
func NewCircularLog(capacity int) *CircularLog
func (l *CircularLog) Append(event string)
func (l *CircularLog) All() []string         // oldest to newest, no allocation
func (l *CircularLog) Recent(n int) []string // last n events
```

---

## Challenge

### Challenge: Generic Sorted Slice

Build a sorted slice with binary search:
```go
type SortedSlice[T constraints.Ordered] struct{ data []T }

func (s *SortedSlice[T]) Insert(v T)
func (s *SortedSlice[T]) Remove(v T) bool
func (s *SortedSlice[T]) Contains(v T) bool
func (s *SortedSlice[T]) Range(lo, hi T) []T  // sub-slice where possible
func (s *SortedSlice[T]) Merge(other *SortedSlice[T]) *SortedSlice[T]
```

Requirements: sorted invariant always maintained, binary search for all finds, `Range` returns sub-slice without allocation, `Merge` uses two-pointer O(n+m) algorithm, full test coverage including property-based tests.
