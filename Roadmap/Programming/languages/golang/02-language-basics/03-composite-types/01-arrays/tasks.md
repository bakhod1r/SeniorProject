# Arrays — Tasks

## Junior Tasks

### Task 1: Basic Array Operations
- **Type:** Implementation
- **Goal:** Practice declaring, initializing, and iterating over arrays.

**Starter Code:**
```go
package main

import "fmt"

func main() {
    // TODO 1: Declare a [5]int array named "scores"
    // and initialize it to: 85, 92, 78, 96, 88

    // TODO 2: Print the array

    // TODO 3: Calculate and print the sum of all scores

    // TODO 4: Find and print the highest score

    // TODO 5: Count how many scores are >= 90 and print the count
}
```

**Expected Output:**
```
Scores: [85 92 78 96 88]
Sum: 439
Highest: 96
Scores >= 90: 2
```

**Evaluation Criteria:**
- Correct array declaration syntax with values
- Proper use of `range` for iteration
- Correct sum calculation
- Correct maximum finding algorithm
- Correct conditional counting

---

### Task 2: Array as Value Type
- **Type:** Conceptual + Implementation
- **Goal:** Demonstrate understanding of array copy semantics.

**Starter Code:**
```go
package main

import "fmt"

// modifyFirst should NOT affect the original (receives a copy)
func modifyFirst(arr [5]int) {
    // TODO: set arr[0] = 99 and print the arr
}

// modifyFirstByPointer SHOULD affect the original
func modifyFirstByPointer(arr *[5]int) {
    // TODO: set arr[0] = 99 and print the arr
}

func main() {
    original := [5]int{1, 2, 3, 4, 5}

    fmt.Println("Before modifyFirst:", original)
    modifyFirst(original)
    fmt.Println("After modifyFirst:", original) // should be unchanged

    fmt.Println("Before modifyFirstByPointer:", original)
    modifyFirstByPointer(&original)
    fmt.Println("After modifyFirstByPointer:", original) // should be changed
}
```

**Expected Output:**
```
Before modifyFirst: [1 2 3 4 5]
inside modifyFirst: [99 2 3 4 5]
After modifyFirst: [1 2 3 4 5]
Before modifyFirstByPointer: [1 2 3 4 5]
inside modifyFirstByPointer: [99 2 3 4 5]
After modifyFirstByPointer: [99 2 3 4 5]
```

**Evaluation Criteria:**
- Correct function signatures (value vs pointer parameter)
- Understanding that value argument is a copy
- Correct use of pointer dereference when needed

---

### Task 3: Multi-Dimensional Array (Tic-Tac-Toe)
- **Type:** Implementation
- **Goal:** Work with a 2D array to simulate a game board.

**Starter Code:**
```go
package main

import "fmt"

const size = 3

func initBoard(board *[size][size]string) {
    // TODO: fill every cell with "."
}

func printBoard(board [size][size]string) {
    // TODO: print each row, space-separated
}

// checkWin returns true if any row, column, or diagonal is all "X"
func checkWin(board [size][size]string) bool {
    // TODO: implement
    return false
}

func main() {
    var board [size][size]string
    initBoard(&board)
    printBoard(board)

    board[0][0] = "X"
    board[1][1] = "X"
    board[2][2] = "X"

    fmt.Println("\nAfter moves:")
    printBoard(board)
    fmt.Println("X wins:", checkWin(board))
}
```

**Expected Output:**
```
. . .
. . .
. . .

After moves:
X . .
. X .
. . X
X wins: true
```

**Evaluation Criteria:**
- Correct 2D array traversal with nested loops
- Pointer parameter usage for board initialization
- Win detection checks all rows, columns, and both diagonals

---

## Middle Tasks

### Task 4: Fixed-Size Ring Buffer
- **Type:** Data Structure Implementation
- **Goal:** Implement a fixed-capacity ring buffer using an array.

**Starter Code:**
```go
package main

import (
    "errors"
    "fmt"
)

const bufferSize = 8

type RingBuffer struct {
    data  [bufferSize]int
    head  int  // index of next read
    tail  int  // index of next write
    count int
}

var ErrFull  = errors.New("buffer full")
var ErrEmpty = errors.New("buffer empty")

func (r *RingBuffer) Push(v int) error {
    // TODO: return ErrFull if count == bufferSize
    // TODO: store v at data[tail], advance tail with wrap-around
    return nil
}

func (r *RingBuffer) Pop() (int, error) {
    // TODO: return 0, ErrEmpty if count == 0
    // TODO: read data[head], advance head with wrap-around
    return 0, nil
}

func (r *RingBuffer) Len() int { return r.count }

func main() {
    rb := &RingBuffer{}
    for i := 1; i <= bufferSize; i++ {
        rb.Push(i * 10)
    }
    fmt.Println("Len:", rb.Len()) // 8
    if err := rb.Push(999); err != nil {
        fmt.Println("Expected:", err)
    }
    for i := 0; i < 4; i++ {
        v, _ := rb.Pop()
        fmt.Println("Popped:", v)
    }
    fmt.Println("Len after pops:", rb.Len()) // 4
}
```

**Expected Output:**
```
Len: 8
Expected: buffer full
Popped: 10
Popped: 20
Popped: 30
Popped: 40
Len after pops: 4
```

**Evaluation Criteria:**
- Correct wrap-around with modulo arithmetic
- FIFO ordering preserved
- Correct full/empty detection
- No off-by-one errors

---

### Task 5: Protocol Header Parser
- **Type:** System Programming
- **Goal:** Parse a fixed-size binary protocol header using a typed array.

**Starter Code:**
```go
package main

import (
    "encoding/binary"
    "fmt"
)

// 12-byte header layout:
// [0]   Version       uint8
// [1]   MessageType   uint8
// [2:4] Flags         uint16 big-endian
// [4:8] SequenceNum   uint32 big-endian
// [8:12] PayloadLen   uint32 big-endian
type Header [12]byte

func (h Header) Version() uint8    { return h[0] }
func (h Header) MessageType() uint8 { return h[1] }

// TODO: implement Flags() uint16
// TODO: implement SequenceNum() uint32
// TODO: implement PayloadLen() uint32
// TODO: implement BuildHeader(ver, msgType uint8, flags uint16, seq, payloadLen uint32) Header

func main() {
    h := BuildHeader(1, 5, 0x0003, 42, 256)
    fmt.Printf("Version:     %d\n", h.Version())
    fmt.Printf("MessageType: %d\n", h.MessageType())
    fmt.Printf("Flags:       0x%04X\n", h.Flags())
    fmt.Printf("SequenceNum: %d\n", h.SequenceNum())
    fmt.Printf("PayloadLen:  %d\n", h.PayloadLen())
}
```

**Expected Output:**
```
Version:     1
MessageType: 5
Flags:       0x0003
SequenceNum: 42
PayloadLen:  256
```

**Evaluation Criteria:**
- Correct use of `binary.BigEndian` for multi-byte fields
- Methods have value receivers
- BuildHeader writes all bytes correctly

---

### Task 6: Benchmark Array Pass by Value vs Pointer
- **Type:** Performance Analysis
- **Goal:** Measure and explain the cost difference.

**Starter Code:**
```go
package main_test

import "testing"

func sumByValue(arr [1000]int) int {
    sum := 0
    for _, v := range arr { sum += v }
    return sum
}

func sumByPointer(arr *[1000]int) int {
    sum := 0
    for _, v := range arr { sum += v }
    return sum
}

// TODO: Write BenchmarkByValue using b.ReportAllocs()
// TODO: Write BenchmarkByPointer using b.ReportAllocs()
// TODO: Add a comment analyzing the results
```

**Expected Output (approximate):**
```
BenchmarkByValue-8     500000    2400 ns/op    8192 B/op    1 allocs/op
BenchmarkByPointer-8  2000000     600 ns/op       0 B/op    0 allocs/op
```

**Evaluation Criteria:**
- Correct benchmark signatures
- Use of `b.ResetTimer()` and `b.ReportAllocs()`
- Written comment analyzing the performance difference

---

## Senior Tasks

### Task 7: Cache-Line-Padded Concurrent Histogram
- **Type:** Concurrent Systems
- **Goal:** Implement a high-throughput histogram that scales with core count.

**Starter Code:**
```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "unsafe"
)

const cacheLineSize = 64

// TODO: Define paddedCounter with int64 value + padding to reach 64 bytes

// TODO: Define Histogram struct with [16]paddedCounter

// TODO: Record(bucket int) — atomic increment

// TODO: Total() int64 — sum all buckets

// TODO: BucketCount(bucket int) int64

func main() {
    hist := &Histogram{}
    var wg sync.WaitGroup

    for g := 0; g < 16; g++ {
        wg.Add(1)
        go func(bucket int) {
            defer wg.Done()
            for i := 0; i < 100000; i++ {
                hist.Record(bucket)
            }
        }(g)
    }
    wg.Wait()
    fmt.Println("Total:", hist.Total()) // 1600000
    _ = unsafe.Sizeof(paddedCounter{}) // should be 64
}
```

**Expected Output:**
```
Total: 1600000
```

**Evaluation Criteria:**
- `sizeof(paddedCounter)` == 64
- Atomic operations, no mutex on hot path
- No data races (`go test -race`)
- Scales with GOMAXPROCS

---

### Task 8: Zero-Allocation Hash-Keyed Cache
- **Type:** System Design + Performance
- **Goal:** Cache with `[32]byte` keys and zero per-lookup allocation.

**Starter Code:**
```go
package main

import (
    "crypto/sha256"
    "fmt"
    "sync"
)

type Cache struct {
    mu      sync.RWMutex
    entries map[[32]byte][]byte
}

func NewCache() *Cache {
    return &Cache{entries: make(map[[32]byte][]byte)}
}

// TODO: Get(input []byte) ([]byte, bool)
// - sha256.Sum256 result is used directly as map key (no string alloc)

// TODO: Set(input []byte, value []byte)

func main() {
    c := NewCache()
    c.Set([]byte("hello"), []byte("world"))
    c.Set([]byte("foo"), []byte("bar"))

    v, ok := c.Get([]byte("hello"))
    fmt.Println(ok, string(v)) // true world

    v, ok = c.Get([]byte("missing"))
    fmt.Println(ok, v) // false []
}
```

**Expected Output:**
```
true world
false []
```

**Evaluation Criteria:**
- `sha256.Sum256` result used as map key without string conversion
- Correct mutex usage (RLock for Get, Lock for Set)
- No data races

---

## Questions

**Q1:** What is printed by:
```go
a := [3]int{1, 2, 3}
s := a[:]
s[0] = 99
fmt.Println(a[0])
```
**Answer:** `99` — the slice `s` shares the underlying array with `a`.

---

**Q2:** Which causes a compile error?
```go
var a [3]int
var b [4]int
fmt.Println(a == b)
```
**Answer:** Compile error — `[3]int` and `[4]int` are different types and cannot be compared.

---

**Q3:** What is `unsafe.Sizeof([0]int{})`?
**Answer:** `0` — zero-size arrays take zero bytes.

---

**Q4:** Why is `for _, v := range arr { v = 99 }` ineffective?
**Answer:** `v` is a copy of each element. Use `for i := range arr { arr[i] = 99 }` instead.

---

**Q5:** How do you pass `arr [5]int` to a function expecting `[]int`?
**Answer:** `f(arr[:])` — the slice expression `arr[:]` creates a slice view over the array.

---

## Mini Projects

### Mini Project 1: 8x8 RGBA Pixel Buffer
Build a simple 8x8 image as `[8][8][4]uint8` (R, G, B, A channels). Implement:
- `NewImage()` — blank white image
- `SetPixel(x, y int, r, g, b, a uint8)`
- `GetPixel(x, y int) (r, g, b, a uint8)`
- `DrawBorder(r, g, b uint8)` — set all edge pixels to given color
- `Print()` — ASCII representation using W (white) and . (dark)

---

### Mini Project 2: SHA256 File Deduplicator
Build a tool that:
1. Accepts a list of file paths as `[]string`
2. Computes `sha256.Sum256` for each file
3. Groups files by hash using `map[[32]byte][]string`
4. Reports which files are duplicates

```go
func findDuplicates(paths []string) (map[[32]byte][]string, error)
```

---

## Challenge

### Challenge: Generic Fixed-Size Stack with Benchmarks

Implement a generic stack backed by a fixed-size array:

```go
type Stack[T any] struct {
    data [16]T
    top  int
}

func (s *Stack[T]) Push(v T) bool   // false if full
func (s *Stack[T]) Pop() (T, bool)  // false if empty
func (s *Stack[T]) Peek() (T, bool) // false if empty
func (s *Stack[T]) Len() int
func (s *Stack[T]) IsFull() bool
func (s *Stack[T]) IsEmpty() bool
```

Requirements:
1. LIFO ordering verified by tests
2. No heap allocation per Push/Pop (use `-benchmem` to verify)
3. Thread-safe wrapper using `sync.Mutex`
4. Benchmark comparing locked vs lockless versions
5. 100% test coverage (empty pop, full push, interleaved ops)
