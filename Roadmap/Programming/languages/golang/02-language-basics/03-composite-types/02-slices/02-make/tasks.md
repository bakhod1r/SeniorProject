# make() for Slices — Tasks

## Task 1: Basic Slice Factory (Junior)

**Description:** Write a function `makeRange(start, end int) []int` that returns a slice containing all integers from `start` to `end` inclusive. Use `make` with the correct length.

**Starter Code:**
```go
package main

import "fmt"

func makeRange(start, end int) []int {
    // TODO: use make to pre-allocate the correct size
    // then fill and return the slice
}

func main() {
    fmt.Println(makeRange(1, 5))   // [1 2 3 4 5]
    fmt.Println(makeRange(0, 0))   // [0]
    fmt.Println(makeRange(-2, 2))  // [-2 -1 0 1 2]
}
```

**Expected Output:**
```
[1 2 3 4 5]
[0]
[-2 -1 0 1 2]
```

**Evaluation Checklist:**
- [ ] Uses `make([]int, end-start+1)` for pre-allocation
- [ ] Fills by index assignment (not append)
- [ ] Handles equal start/end correctly
- [ ] Returns correct slice

---

## Task 2: Filter with Pre-allocated Capacity (Junior-Middle)

**Description:** Implement `filterEven(nums []int) []int` that returns only even numbers. Use `make` with capacity hint to avoid reallocations.

**Starter Code:**
```go
package main

import "fmt"

func filterEven(nums []int) []int {
    // TODO: create result with capacity hint (worst case: all even)
    // Use append to add even numbers
}

func main() {
    input := []int{1, 2, 3, 4, 5, 6, 7, 8}
    fmt.Println(filterEven(input)) // [2 4 6 8]

    empty := []int{1, 3, 5}
    fmt.Println(filterEven(empty)) // []

    allEven := []int{2, 4, 6}
    fmt.Println(filterEven(allEven)) // [2 4 6]
}
```

**Expected Output:**
```
[2 4 6 8]
[]
[2 4 6]
```

**Evaluation Checklist:**
- [ ] Uses `make([]int, 0, len(nums))` for capacity hint
- [ ] Uses `append` to add elements
- [ ] Returns empty (non-nil) slice when no matches
- [ ] Does not reallocate (capacity pre-set)

---

## Task 3: 2D Matrix Initialization (Middle)

**Description:** Write `newMatrix(rows, cols int) [][]float64` using the optimized single-allocation pattern.

**Starter Code:**
```go
package main

import "fmt"

func newMatrix(rows, cols int) [][]float64 {
    // TODO: allocate all data in one contiguous make call
    // then assign row sub-slices
}

func printMatrix(m [][]float64) {
    for _, row := range m {
        fmt.Println(row)
    }
}

func main() {
    m := newMatrix(3, 4)
    m[0][0] = 1.0
    m[1][2] = 5.5
    m[2][3] = 9.9
    printMatrix(m)
    // [1 0 0 0]
    // [0 0 5.5 0]
    // [0 0 0 9.9]
}
```

**Expected Output:**
```
[1 0 0 0]
[0 0 5.5 0]
[0 0 0 9.9]
```

**Evaluation Checklist:**
- [ ] Uses exactly 2 `make` calls (one for data, one for row headers)
- [ ] All data is contiguous in memory
- [ ] Row sub-slices correctly point into data array
- [ ] Modifications to `m[i][j]` work correctly

---

## Task 4: Batch Processor (Middle)

**Description:** Implement `splitIntoBatches[T any](items []T, batchSize int) [][]T` that divides a slice into sub-slices of up to `batchSize` elements.

**Starter Code:**
```go
package main

import "fmt"

func splitIntoBatches[T any](items []T, batchSize int) [][]T {
    // TODO: calculate number of batches, pre-allocate with make
    // then fill batches using sub-slicing
}

func main() {
    nums := []int{1, 2, 3, 4, 5, 6, 7}

    batches := splitIntoBatches(nums, 3)
    for i, b := range batches {
        fmt.Printf("Batch %d: %v\n", i, b)
    }
    // Batch 0: [1 2 3]
    // Batch 1: [4 5 6]
    // Batch 2: [7]

    fmt.Println(splitIntoBatches([]string{"a","b"}, 5))
    // [[a b]]
}
```

**Expected Output:**
```
Batch 0: [1 2 3]
Batch 1: [4 5 6]
Batch 2: [7]
[[a b]]
```

**Evaluation Checklist:**
- [ ] Correctly calculates `numBatches = (len+batchSize-1)/batchSize`
- [ ] Pre-allocates result with `make([][]T, 0, numBatches)`
- [ ] Last batch may be smaller than `batchSize`
- [ ] Works with generic type T
- [ ] Handles empty input

---

## Task 5: Stack Implementation (Middle)

**Description:** Implement a generic `Stack[T]` using a slice made with `make`. Include `Push`, `Pop`, `Peek`, `Len`, and `IsEmpty` methods.

**Starter Code:**
```go
package main

import (
    "errors"
    "fmt"
)

type Stack[T any] struct {
    // TODO: add a slice field, pre-allocated with make
}

func NewStack[T any](initialCapacity int) *Stack[T] {
    // TODO: initialize with make
}

func (s *Stack[T]) Push(v T) {
    // TODO
}

func (s *Stack[T]) Pop() (T, error) {
    // TODO: return zero value and error if empty
}

func (s *Stack[T]) Peek() (T, error) {
    // TODO: return top without removing
}

func (s *Stack[T]) Len() int { /* TODO */ }
func (s *Stack[T]) IsEmpty() bool { /* TODO */ }

func main() {
    st := NewStack[int](4)
    st.Push(1)
    st.Push(2)
    st.Push(3)

    v, _ := st.Pop()
    fmt.Println(v) // 3

    top, _ := st.Peek()
    fmt.Println(top) // 2
    fmt.Println(st.Len()) // 2

    _, err := errors.New("x"); _ = err
}
```

**Expected Output:**
```
3
2
2
```

**Evaluation Checklist:**
- [ ] Uses `make([]T, 0, initialCapacity)` in `NewStack`
- [ ] `Pop` returns error if empty
- [ ] `Peek` doesn't modify the slice
- [ ] Generic type works for int, string, etc.
- [ ] Capacity grows automatically via append

---

## Task 6: Frequency Counter (Middle)

**Description:** Write `wordFrequency(words []string) map[string]int` using `make` with an appropriate size hint.

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

func wordFrequency(words []string) map[string]int {
    // TODO: use make(map[string]int, estimate) for hint
    // fill the map
}

func main() {
    text := "the cat sat on the mat the cat"
    words := strings.Fields(text)
    freq := wordFrequency(words)

    // Print in order for consistent output
    for _, w := range []string{"the", "cat", "sat", "on", "mat"} {
        fmt.Printf("%s: %d\n", w, freq[w])
    }
}
```

**Expected Output:**
```
the: 3
cat: 2
sat: 1
on: 1
mat: 1
```

**Evaluation Checklist:**
- [ ] Uses `make(map[string]int, len(words))` as size hint
- [ ] Correctly counts all words
- [ ] Handles duplicate words
- [ ] Size hint reduces rehashing

---

## Task 7: Channel Pipeline (Senior)

**Description:** Build a pipeline using `make(chan T, bufSize)` that reads integers, squares them, and sends results. Use buffered channels to avoid blocking.

**Starter Code:**
```go
package main

import (
    "fmt"
    "sync"
)

func generate(nums ...int) <-chan int {
    // TODO: make buffered channel, send nums in goroutine
}

func square(in <-chan int) <-chan int {
    // TODO: make buffered channel, square each value in goroutine
}

func main() {
    c := generate(2, 3, 4)
    out := square(c)

    fmt.Println(<-out) // 4
    fmt.Println(<-out) // 9
    fmt.Println(<-out) // 16
}
```

**Expected Output:**
```
4
9
16
```

**Evaluation Checklist:**
- [ ] `generate` uses `make(chan int, n)` with appropriate buffer
- [ ] `square` uses `make(chan int, n)` with appropriate buffer
- [ ] Each stage runs in a goroutine
- [ ] Channels are closed when done
- [ ] No goroutine leaks (use `sync.WaitGroup` or closing)

---

## Task 8: Memory Pool (Senior)

**Description:** Implement a `BytePool` that uses `sync.Pool` backed by `make([]byte, size)` for efficiently reusing byte slices.

**Starter Code:**
```go
package main

import (
    "fmt"
    "sync"
)

type BytePool struct {
    pool    sync.Pool
    bufSize int
}

func NewBytePool(bufSize int) *BytePool {
    // TODO: initialize pool with New func using make
}

func (p *BytePool) Get() []byte {
    // TODO: get from pool, reset to full capacity
}

func (p *BytePool) Put(buf []byte) {
    // TODO: clear and return to pool (only if correct size)
}

func main() {
    pool := NewBytePool(1024)

    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            buf := pool.Get()
            copy(buf, fmt.Sprintf("goroutine %d", id))
            pool.Put(buf)
        }(i)
    }
    wg.Wait()
    fmt.Println("All goroutines done")
}
```

**Expected Output:**
```
All goroutines done
```

**Evaluation Checklist:**
- [ ] `New` function uses `make([]byte, bufSize)`
- [ ] `Get` resets slice to full capacity before returning
- [ ] `Put` only returns slices of the correct size
- [ ] Thread-safe (sync.Pool handles this)
- [ ] No data races

---

## Task 9: Zero-Copy Reader (Senior)

**Description:** Implement a `ChunkedReader` that reads data in chunks using a pre-allocated `make([]byte, chunkSize)` buffer.

**Starter Code:**
```go
package main

import (
    "fmt"
    "io"
    "strings"
)

type ChunkedReader struct {
    r         io.Reader
    buf       []byte
    totalRead int
}

func NewChunkedReader(r io.Reader, chunkSize int) *ChunkedReader {
    // TODO: initialize with make([]byte, chunkSize)
}

func (cr *ChunkedReader) ReadAll() ([]byte, error) {
    // TODO: pre-allocate result slice, read chunks, append
}

func main() {
    data := strings.Repeat("hello world ", 10)
    cr := NewChunkedReader(strings.NewReader(data), 16)
    result, err := cr.ReadAll()
    if err != nil {
        panic(err)
    }
    fmt.Println(len(result), string(result[:11]))
    // 120 hello world
}
```

**Expected Output:**
```
120 hello world
```

**Evaluation Checklist:**
- [ ] Buffer allocated once with `make([]byte, chunkSize)`
- [ ] Buffer reused across reads (not re-allocated each iteration)
- [ ] Result accumulated correctly
- [ ] Handles `io.EOF` correctly
- [ ] `totalRead` tracks bytes read

---

## Task 10: Sliding Window Maximum (Senior)

**Description:** Implement `slidingWindowMax(nums []int, k int) []int` using a deque backed by `make([]int, 0, k)`.

**Starter Code:**
```go
package main

import "fmt"

func slidingWindowMax(nums []int, k int) []int {
    if len(nums) == 0 || k == 0 {
        return nil
    }

    // TODO:
    // result: make([]int, 0, len(nums)-k+1)
    // deque: make([]int, 0, k) — stores indices
    // For each element, maintain deque as monotonic decreasing
}

func main() {
    fmt.Println(slidingWindowMax([]int{1,3,-1,-3,5,3,6,7}, 3))
    // [3 3 5 5 6 7]

    fmt.Println(slidingWindowMax([]int{1}, 1))
    // [1]
}
```

**Expected Output:**
```
[3 3 5 5 6 7]
[1]
```

**Evaluation Checklist:**
- [ ] `result` pre-allocated with correct capacity
- [ ] `deque` pre-allocated with `make([]int, 0, k)`
- [ ] Deque maintains monotonic decreasing property
- [ ] Window boundary checks correct
- [ ] Output length = `len(nums) - k + 1`

---

## Task 11: Concurrent Safe Counter Map (Senior)

**Description:** Build a thread-safe counter map using `make(map[string]int, hint)` protected by `sync.RWMutex`.

**Starter Code:**
```go
package main

import (
    "fmt"
    "sync"
)

type CounterMap struct {
    mu   sync.RWMutex
    data map[string]int
}

func NewCounterMap(sizeHint int) *CounterMap {
    // TODO: use make with size hint
}

func (cm *CounterMap) Inc(key string) {
    // TODO: write lock, increment
}

func (cm *CounterMap) Get(key string) int {
    // TODO: read lock, return value
}

func (cm *CounterMap) TopN(n int) []string {
    // TODO: collect all entries, sort by count desc, return top n keys
}

func main() {
    cm := NewCounterMap(100)
    var wg sync.WaitGroup

    words := []string{"go", "is", "fast", "go", "is", "go"}
    for _, w := range words {
        wg.Add(1)
        go func(word string) {
            defer wg.Done()
            cm.Inc(word)
        }(w)
    }
    wg.Wait()

    fmt.Println(cm.Get("go"))   // 3
    fmt.Println(cm.Get("is"))   // 2
    fmt.Println(cm.TopN(2))     // [go is]
}
```

**Expected Output:**
```
3
2
[go is]
```

**Evaluation Checklist:**
- [ ] `NewCounterMap` uses `make(map[string]int, sizeHint)`
- [ ] `Inc` uses write lock correctly
- [ ] `Get` uses read lock (allows concurrent reads)
- [ ] `TopN` returns correct top-n entries
- [ ] No data races (run with `-race` flag)
