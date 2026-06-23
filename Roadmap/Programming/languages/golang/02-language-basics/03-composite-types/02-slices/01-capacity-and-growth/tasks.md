# Slice Capacity and Growth — Practical Tasks

> **Format:** Each task includes type, goal, starter code with `// TODO`, expected output, and evaluation checklist.

---

## Overview

These tasks deepen your understanding of slice capacity, growth mechanics, and performance optimization. Each task builds a complete, testable solution. Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard.

---

## Junior Tasks

### Task 1 🟢 — Capacity Observer

**Goal:** Write a program that prints capacity changes as elements are appended.

**Requirements:**
- Start with a nil slice of `int`
- Append elements one by one up to 100
- Print a line only when `cap` changes: `"len=N cap=C (grew from PREV_CAP)"`
- At the end, print the total number of reallocation events

**Starter Code:**
```go
package main

import "fmt"

func main() {
    var s []int
    prevCap := 0
    reallocations := 0

    for i := 0; i < 100; i++ {
        // TODO: append i to s
        // TODO: if cap changed, print the message and increment reallocations
    }

    fmt.Printf("Total reallocations: %d\n", reallocations)
}
```

**Expected output (partial):**
```
len=1 cap=1 (grew from 0)
len=2 cap=2 (grew from 1)
len=3 cap=4 (grew from 2)
len=5 cap=8 (grew from 4)
...
Total reallocations: 7
```

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

func main() {
    var s []int
    prevCap := 0
    reallocations := 0

    for i := 0; i < 100; i++ {
        s = append(s, i)
        if cap(s) != prevCap {
            fmt.Printf("len=%d cap=%d (grew from %d)\n", len(s), cap(s), prevCap)
            prevCap = cap(s)
            reallocations++
        }
    }

    fmt.Printf("Total reallocations: %d\n", reallocations)
}
```
</details>

---

### Task 2 🟢 — Pre-allocation Comparison

**Goal:** Demonstrate the performance difference between pre-allocated and non-pre-allocated slices.

**Requirements:**
- Write two functions: `buildSliceNoHint(n int) []int` and `buildSliceWithHint(n int) []int`
- Both fill a slice with squares `[0, 1, 4, 9, ..., (n-1)^2]`
- `NoHint` uses `var s []int`, `WithHint` uses `make([]int, 0, n)`
- Write benchmark functions for both with `b.ReportAllocs()`
- Write a test that verifies both functions produce identical output

```go
package capacity_test

import (
    "testing"
    "reflect"
)

func buildSliceNoHint(n int) []int {
    // TODO
}

func buildSliceWithHint(n int) []int {
    // TODO
}

func TestBothFunctionsMatch(t *testing.T) {
    // TODO: verify buildSliceNoHint(1000) == buildSliceWithHint(1000)
}

func BenchmarkNoHint(b *testing.B) {
    // TODO
}

func BenchmarkWithHint(b *testing.B) {
    // TODO
}
```

<details>
<summary>Solution</summary>

```go
package capacity_test

import (
    "reflect"
    "testing"
)

func buildSliceNoHint(n int) []int {
    var s []int
    for i := 0; i < n; i++ {
        s = append(s, i*i)
    }
    return s
}

func buildSliceWithHint(n int) []int {
    s := make([]int, 0, n)
    for i := 0; i < n; i++ {
        s = append(s, i*i)
    }
    return s
}

func TestBothFunctionsMatch(t *testing.T) {
    a := buildSliceNoHint(1000)
    b := buildSliceWithHint(1000)
    if !reflect.DeepEqual(a, b) {
        t.Error("functions produce different results")
    }
}

func BenchmarkNoHint(b *testing.B) {
    b.ReportAllocs()
    for b.Loop() {
        _ = buildSliceNoHint(10_000)
    }
}

func BenchmarkWithHint(b *testing.B) {
    b.ReportAllocs()
    for b.Loop() {
        _ = buildSliceWithHint(10_000)
    }
}
```
</details>

---

### Task 3 🟢 — Safe Sub-slice Copy

**Goal:** Write a function that returns the last N bytes of a large slice without retaining the large backing array.

**Requirements:**
- Function signature: `func lastN(data []byte, n int) []byte`
- If `n >= len(data)`, return a full independent copy
- If `n < len(data)`, return an independent copy of the last `n` bytes
- The returned slice must NOT share a backing array with the input

```go
package main

import "fmt"

func lastN(data []byte, n int) []byte {
    // TODO: return independent copy of last n bytes
}

func main() {
    large := make([]byte, 10_000)
    for i := range large {
        large[i] = byte(i % 256)
    }

    tail := lastN(large, 5)
    fmt.Println(tail)

    // Verify independence
    large[9999] = 0xFF
    fmt.Println(tail[4]) // should NOT be 0xFF
}
```

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

func lastN(data []byte, n int) []byte {
    if n >= len(data) {
        result := make([]byte, len(data))
        copy(result, data)
        return result
    }
    result := make([]byte, n)
    copy(result, data[len(data)-n:])
    return result
}

func main() {
    large := make([]byte, 10_000)
    for i := range large {
        large[i] = byte(i % 256)
    }

    tail := lastN(large, 5)
    fmt.Println(tail)

    large[9999] = 0xFF
    fmt.Println(tail[4]) // unchanged — independent copy
}
```
</details>

---

## Middle Tasks

### Task 4 🟡 — Capacity-Aware Filter

**Goal:** Implement an efficient filter function with multiple capacity strategies.

**Requirements:**
- Implement three versions of `filterPositive(nums []int) []int`:
  1. `filterV1`: no capacity hint
  2. `filterV2`: worst-case pre-allocation (`len(input)`)
  3. `filterV3`: two-pass (exact count first, then fill)
- Write benchmarks for all three with `n = 1,000,000` and `~50%` passing rate
- Include a test with empty input, all-fail input, and all-pass input

<details>
<summary>Solution</summary>

```go
package filter_test

import (
    "testing"
)

func filterV1(nums []int) []int {
    var result []int
    for _, n := range nums {
        if n > 0 {
            result = append(result, n)
        }
    }
    return result
}

func filterV2(nums []int) []int {
    result := make([]int, 0, len(nums))
    for _, n := range nums {
        if n > 0 {
            result = append(result, n)
        }
    }
    return result
}

func filterV3(nums []int) []int {
    count := 0
    for _, n := range nums {
        if n > 0 {
            count++
        }
    }
    result := make([]int, 0, count)
    for _, n := range nums {
        if n > 0 {
            result = append(result, n)
        }
    }
    return result
}

func makeTestData(n int) []int {
    data := make([]int, n)
    for i := range data {
        if i%2 == 0 {
            data[i] = i + 1
        } else {
            data[i] = -(i + 1)
        }
    }
    return data
}

func BenchmarkFilterV1(b *testing.B) {
    b.ReportAllocs()
    data := makeTestData(1_000_000)
    for b.Loop() {
        _ = filterV1(data)
    }
}

func BenchmarkFilterV2(b *testing.B) {
    b.ReportAllocs()
    data := makeTestData(1_000_000)
    for b.Loop() {
        _ = filterV2(data)
    }
}

func BenchmarkFilterV3(b *testing.B) {
    b.ReportAllocs()
    data := makeTestData(1_000_000)
    for b.Loop() {
        _ = filterV3(data)
    }
}

func TestEdgeCases(t *testing.T) {
    tests := []struct {
        name  string
        input []int
        want  int
    }{
        {"empty", []int{}, 0},
        {"all fail", []int{-1, -2, -3}, 0},
        {"all pass", []int{1, 2, 3}, 3},
        {"mixed", []int{1, -2, 3, -4, 5}, 3},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            if got := len(filterV3(tt.input)); got != tt.want {
                t.Errorf("got %d, want %d", got, tt.want)
            }
        })
    }
}
```
</details>

---

### Task 5 🟡 — Safe Buffer with Three-Index Slices

**Goal:** Implement a buffer pool that uses three-index slices to prevent caller overwrites.

**Requirements:**
- `BufferPool` type that manages `[]byte` buffers of fixed size (4096 bytes)
- `Get(size int) []byte` returns a slice with `cap` limited to `size` (not 4096)
- Callers should NOT be able to accidentally write beyond their requested size via `append`

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

const poolBufSize = 4096

type PooledBuf struct {
    Slice   []byte
    backing *[]byte
    pool    *BufferPool
}

func (p *PooledBuf) Release() {
    if p.backing != nil {
        *p.backing = (*p.backing)[:0] // reset length
        p.pool.pool.Put(p.backing)
        p.backing = nil
    }
}

type BufferPool struct {
    pool sync.Pool
}

func NewBufferPool() *BufferPool {
    return &BufferPool{
        pool: sync.Pool{
            New: func() any {
                buf := make([]byte, poolBufSize)
                return &buf
            },
        },
    }
}

func (p *BufferPool) Get(size int) *PooledBuf {
    if size > poolBufSize {
        s := make([]byte, size)
        return &PooledBuf{Slice: s}
    }
    pBuf := p.pool.Get().(*[]byte)
    return &PooledBuf{
        Slice:   (*pBuf)[:size:size], // three-index: cap capped at size
        backing: pBuf,
        pool:    p,
    }
}

func main() {
    pool := NewBufferPool()
    pb := pool.Get(100)
    fmt.Println(len(pb.Slice), cap(pb.Slice)) // 100 100

    // Cannot exceed cap via append without allocating a new array:
    extra := append(pb.Slice, 0)
    fmt.Println(len(extra), cap(extra)) // 101, ~200 (new array)

    pb.Release() // return 4096-byte backing to pool
}
```
</details>

---

### Task 6 🟡 — Adaptive Pre-allocator

**Goal:** Build a type that tracks historical slice sizes and provides increasingly accurate capacity hints.

**Requirements:**
- `SizeEstimator` tracks the last 10 observed sizes using a ring buffer
- `Estimate() int` returns 120% of the rolling average
- `Record(n int)` adds a new observation (evicts oldest when > 10)
- `Reset()` clears all history

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type SizeEstimator struct {
    history [10]int
    count   int
    pos     int
}

func (e *SizeEstimator) Record(n int) {
    e.history[e.pos] = n
    e.pos = (e.pos + 1) % 10
    if e.count < 10 {
        e.count++
    }
}

func (e *SizeEstimator) Estimate() int {
    if e.count == 0 {
        return 64
    }
    sum := 0
    for i := 0; i < e.count; i++ {
        sum += e.history[i]
    }
    avg := sum / e.count
    return avg * 12 / 10 // 120% of average
}

func (e *SizeEstimator) Reset() {
    *e = SizeEstimator{}
}

func main() {
    e := &SizeEstimator{}

    for i := 0; i < 20; i++ {
        size := 950 + i*5
        e.Record(size)
        fmt.Printf("after recording %d: estimate=%d\n", size, e.Estimate())
    }
}
```
</details>

---

## Senior Tasks

### Task 7 🔴 — Zero-Allocation Request Pipeline

**Goal:** Build a request processing pipeline that allocates zero bytes on internal processing after warmup.

**Requirements:**
- `Pipeline` struct with a `sync.Pool` of `[]byte` buffers
- `Process(input []byte) []byte` borrows, fills, copies result, and returns buffer to pool
- Benchmark must show `1 allocs/op` only for the returned copy, 0 for internal processing
- `*pSlice = buf` before returning to pool is required

<details>
<summary>Solution</summary>

```go
package pipeline_test

import (
    "sync"
    "testing"
)

var header = []byte("HEADER:")
var footer = []byte(":FOOTER")

type Pipeline struct {
    pool sync.Pool
}

func NewPipeline() *Pipeline {
    return &Pipeline{
        pool: sync.Pool{
            New: func() any {
                buf := make([]byte, 0, 512)
                return &buf
            },
        },
    }
}

func (p *Pipeline) Process(input []byte) []byte {
    pBuf := p.pool.Get().(*[]byte)
    buf := (*pBuf)[:0]

    buf = append(buf, header...)
    buf = append(buf, input...)
    buf = append(buf, footer...)

    result := make([]byte, len(buf))
    copy(result, buf)

    *pBuf = buf
    p.pool.Put(pBuf)

    return result
}

func BenchmarkPipeline(b *testing.B) {
    p := NewPipeline()
    input := []byte("hello world this is a test payload")

    _ = p.Process(input) // warm up pool

    b.ReportAllocs()
    b.ResetTimer()

    for b.Loop() {
        result := p.Process(input)
        _ = result
    }
}
```
</details>

---

### Task 8 🔴 — Capacity-Bounded Ring Buffer

**Goal:** Implement a fixed-capacity ring buffer using a pre-allocated slice as the backing store.

**Requirements:**
- `RingBuffer[T]` generic type with capacity set at creation
- `Push(v T) error`: return `ErrFull` if at capacity
- `Pop() (T, error)`: return `ErrEmpty` if empty
- Backing slice must NEVER grow beyond initial capacity
- Test wrap-around, full, and empty edge cases

<details>
<summary>Solution</summary>

```go
package ringbuf

import "errors"

var (
    ErrFull  = errors.New("ring buffer is full")
    ErrEmpty = errors.New("ring buffer is empty")
)

type RingBuffer[T any] struct {
    buf   []T
    head  int
    tail  int
    count int
}

func New[T any](capacity int) *RingBuffer[T] {
    return &RingBuffer[T]{
        buf: make([]T, capacity), // allocated once, never grows
    }
}

func (r *RingBuffer[T]) Push(v T) error {
    if r.count == cap(r.buf) {
        return ErrFull
    }
    r.buf[r.tail] = v
    r.tail = (r.tail + 1) % cap(r.buf)
    r.count++
    return nil
}

func (r *RingBuffer[T]) Pop() (T, error) {
    var zero T
    if r.count == 0 {
        return zero, ErrEmpty
    }
    v := r.buf[r.head]
    r.buf[r.head] = zero // clear to avoid pointer retention
    r.head = (r.head + 1) % cap(r.buf)
    r.count--
    return v, nil
}

func (r *RingBuffer[T]) Len() int { return r.count }
func (r *RingBuffer[T]) Cap() int { return cap(r.buf) }
```

**Test:**
```go
package ringbuf_test

import "testing"

func TestRingBuffer(t *testing.T) {
    rb := New[int](3)

    if _, err := rb.Pop(); err != ErrEmpty {
        t.Error("expected ErrEmpty on empty pop")
    }

    rb.Push(1); rb.Push(2); rb.Push(3)

    if err := rb.Push(4); err != ErrFull {
        t.Error("expected ErrFull when full")
    }

    v, _ := rb.Pop()
    if v != 1 { t.Errorf("got %d want 1", v) }

    rb.Push(4) // wrap-around

    v, _ = rb.Pop()
    if v != 2 { t.Errorf("got %d want 2", v) }

    if rb.Len() != 2 { t.Errorf("len=%d want 2", rb.Len()) }
    if rb.Cap() != 3 { t.Errorf("cap=%d want 3", rb.Cap()) }
}
```
</details>

---

## Comprehension Questions

1. Why does `make([]int, 0, 5)` produce a non-nil slice even though it has zero length?
2. If `s := base[2:5]` and `len(base) == 10`, what is `cap(s)`? What if you use `base[2:5:6]`?
3. A function returns `s[:0]` — in what situation does this cause a memory leak?
4. After `a = append(a, 1, 2, 3)`, is the original `a` modified? How do you verify this in code?
5. When does the Go 1.18+ growth algorithm pick `newCap = newLen` directly instead of applying the smooth curve?

---

## Mini Project 1: Batch Processor with Capacity Telemetry

Build a batch processor that tracks its own capacity utilization:

```go
type BatchProcessor struct {
    results  []Result
    maxCap   int  // maximum capacity ever observed
    reallocN int  // total reallocation events
}

func (p *BatchProcessor) Process(items []Item) []Result {
    // Pre-allocate based on past experience
    // Track capacity growth events
    // Return results
}

func (p *BatchProcessor) Stats() (maxCap, reallocations int) {
    return p.maxCap, p.reallocN
}
```

Requirements:
- Use `cap` tracking to detect reallocation events
- On each call, use the max of `len(items)` and the previous high-water mark for pre-allocation
- Print stats at the end showing reallocation count

---

## Mini Project 2: Memory-Bounded Buffer Pool

Build a pool with a total memory budget:

```go
type BoundedPool struct {
    mu         sync.Mutex
    buffers    []*[]byte
    totalBytes int
    maxBytes   int
}

func NewBoundedPool(maxMB int) *BoundedPool { ... }
func (p *BoundedPool) Get(size int) []byte { ... }
func (p *BoundedPool) Put(buf []byte) { ... }
func (p *BoundedPool) Stats() (count, totalBytes int) { ... }
```

Rules:
- `Put` refuses buffers if adding them would exceed `maxBytes`
- `Get` returns a buffer from pool if available, otherwise allocates fresh
- Track total bytes currently in pool
- Write tests that verify the budget is never exceeded

---

## Challenge: Generic Growing Stack with Shrink Policy

Implement a `Stack[T]` that:
1. Uses a backing slice that grows like `append`
2. Shrinks when occupancy drops below 25% (to avoid hoarding memory)
3. Never shrinks below a minimum capacity of 16
4. Reports allocation/deallocation events via optional callbacks

```go
type Stack[T any] struct {
    data     []T
    minCap   int
    onGrow   func(from, to int)
    onShrink func(from, to int)
}

func NewStack[T any](minCap int) *Stack[T] {
    return &Stack[T]{
        data:   make([]T, 0, minCap),
        minCap: minCap,
    }
}

func (s *Stack[T]) Push(v T) {
    s.data = append(s.data, v)
    if s.onGrow != nil && cap(s.data) > s.minCap {
        // detect growth here
    }
}

func (s *Stack[T]) Pop() (T, bool) {
    if len(s.data) == 0 {
        var zero T
        return zero, false
    }
    v := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    s.maybeShrink()
    return v, true
}

func (s *Stack[T]) maybeShrink() {
    c := cap(s.data)
    l := len(s.data)
    if c > s.minCap && l < c/4 {
        newCap := c / 2
        if newCap < s.minCap {
            newCap = s.minCap
        }
        newData := make([]T, l, newCap)
        copy(newData, s.data)
        if s.onShrink != nil {
            s.onShrink(c, newCap)
        }
        s.data = newData
    }
}
```

Bonus: write a benchmark that pushes 1024 elements then pops all, verify total allocation count is O(log n).
