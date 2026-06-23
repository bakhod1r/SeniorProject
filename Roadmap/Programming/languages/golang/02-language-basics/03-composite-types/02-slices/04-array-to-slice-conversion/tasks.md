# Array to Slice Conversion — Tasks

## Task 1: Basic Slice Forms
**Type:** Fundamentals | **Level:** Junior

**Goal:** Practice all four slice expression forms on a `[8]int` array and print len/cap for each.

```go
package main

import "fmt"

func main() {
    arr := [8]int{10, 20, 30, 40, 50, 60, 70, 80}

    // TODO: Create s1 = full slice of arr
    // TODO: Create s2 = slice from index 2 to end
    // TODO: Create s3 = slice from start to index 5
    // TODO: Create s4 = slice from index 2 to 5
    // TODO: Create s5 = full slice expression arr[2:5:6]

    // TODO: Print each slice with its len and cap
    // fmt.Printf("s1=%v len=%d cap=%d\n", s1, len(s1), cap(s1))
    _ = fmt.Println
}
```

**Expected Output:**
```
s1=[10 20 30 40 50 60 70 80] len=8 cap=8
s2=[30 40 50 60 70 80] len=6 cap=6
s3=[10 20 30 40 50] len=5 cap=8
s4=[30 40 50] len=3 cap=6
s5=[30 40 50] len=3 cap=4
```

**Evaluation Checklist:**
- [ ] All 5 slices created correctly
- [ ] len computed as `high - low`
- [ ] cap computed as `len(arr) - low` (or `max - low` for full expression)
- [ ] Output matches expected

---

## Task 2: Shared Memory Verification
**Type:** Memory / Debugging | **Level:** Junior

**Goal:** Prove that a slice and its backing array share memory by modifying data through one and observing the change in the other.

```go
package main

import "fmt"

func main() {
    arr := [5]string{"a", "b", "c", "d", "e"}

    // TODO: Create slice s pointing to arr[1:4]
    // TODO: Modify s[0] to "MODIFIED"
    // TODO: Print arr — show that arr[1] changed
    // TODO: Modify arr[2] to "ARRAY_CHANGED"
    // TODO: Print s — show that s[1] changed

    // TODO: Verify with pointer equality
    // fmt.Println("same address:", &arr[1] == &s[0]) // should be true
    _ = fmt.Println
}
```

**Expected Output:**
```
After s[0]="MODIFIED": arr=[a MODIFIED c d e]
After arr[2]="ARRAY_CHANGED": s=[MODIFIED ARRAY_CHANGED d]
same address: true
```

**Evaluation Checklist:**
- [ ] Slice shares memory with array
- [ ] Modification through slice visible in array
- [ ] Modification through array visible in slice
- [ ] Pointer equality verified

---

## Task 3: Stack Buffer I/O Reader
**Type:** Real-World / Performance | **Level:** Junior-Middle

**Goal:** Use a `[64]byte` stack-allocated array as a read buffer for `strings.NewReader`. Count total bytes read across multiple reads.

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

func readAll(r io.Reader) (int, error) {
    // TODO: Declare a [64]byte array (NOT make([]byte, 64))
    // TODO: Loop: read into buf[:], accumulate total bytes, break on io.EOF
    // TODO: Return total bytes read and any non-EOF error
    return 0, nil
}

func main() {
    content := strings.Repeat("Go is great! ", 20) // ~260 bytes
    r := strings.NewReader(content)
    n, err := readAll(r)
    fmt.Printf("Read %d bytes, err=%v\n", n, err)
}
```

**Expected Output:**
```
Read 260 bytes, err=<nil>
```

**Evaluation Checklist:**
- [ ] Uses `[64]byte` array, not `make`
- [ ] Correctly handles `io.EOF`
- [ ] Accumulates total correctly
- [ ] No heap allocation from the buffer itself

---

## Task 4: Full Slice Expression — Preventing Append Mutation
**Type:** Safety / Correctness | **Level:** Middle

**Goal:** Demonstrate the difference between `arr[0:3]` and `arr[0:3:3]` when a caller appends to the returned slice.

```go
package main

import "fmt"

// unsafeWindow returns a slice with full backing array capacity
func unsafeWindow(arr *[6]int, n int) []int {
    // TODO: return arr[:n]  (full capacity)
    return nil
}

// safeWindow returns a slice with capacity capped at n
func safeWindow(arr *[6]int, n int) []int {
    // TODO: return arr[:n:n]  (bounded capacity)
    return nil
}

func main() {
    arr1 := [6]int{1, 2, 3, 4, 5, 6}
    s1 := unsafeWindow(&arr1, 3)
    s1 = append(s1, 99)
    fmt.Println("unsafeWindow: arr1 =", arr1) // arr1[3] should be 99

    arr2 := [6]int{1, 2, 3, 4, 5, 6}
    s2 := safeWindow(&arr2, 3)
    s2 = append(s2, 99)
    fmt.Println("safeWindow:   arr2 =", arr2) // arr2 should be unchanged
}
```

**Expected Output:**
```
unsafeWindow: arr1 = [1 2 3 99 5 6]
safeWindow:   arr2 = [1 2 3 4 5 6]
```

**Evaluation Checklist:**
- [ ] `unsafeWindow` returns slice with capacity > n
- [ ] `safeWindow` returns slice with capacity == n
- [ ] `append` mutates original array in unsafe case
- [ ] `append` creates new backing array in safe case

---

## Task 5: Independent Copy vs Shared Slice
**Type:** Memory Safety | **Level:** Junior-Middle

**Goal:** Write two functions: one that returns a shared slice and one that returns an independent copy. Write a test to verify behavior.

```go
package main

import "fmt"

var globalArr = [5]int{1, 2, 3, 4, 5}

// sharedView returns a slice sharing globalArr's memory
func sharedView(low, high int) []int {
    // TODO: implement
    return nil
}

// independentCopy returns a slice that does NOT share globalArr's memory
func independentCopy(low, high int) []int {
    // TODO: use make + copy
    return nil
}

func main() {
    sv := sharedView(1, 4)
    ic := independentCopy(1, 4)

    sv[0] = 99
    fmt.Println("After sv[0]=99:")
    fmt.Println("  globalArr:", globalArr) // globalArr[1] should be 99
    fmt.Println("  ic[0]:", ic[0])         // should still be 2

    globalArr[2] = 88
    fmt.Println("After globalArr[2]=88:")
    fmt.Println("  sv[1]:", sv[1])          // should be 88
    fmt.Println("  ic[1]:", ic[1])          // should still be 3
}
```

**Expected Output:**
```
After sv[0]=99:
  globalArr: [1 99 3 4 5]
  ic[0]: 2
After globalArr[2]=88:
  sv[1]: 88
  ic[1]: 3
```

**Evaluation Checklist:**
- [ ] `sharedView` shares memory with globalArr
- [ ] `independentCopy` does not share memory
- [ ] Modifications through shared view affect globalArr
- [ ] Independent copy is unaffected by globalArr changes

---

## Task 6: Sliding Window Maximum
**Type:** Algorithm | **Level:** Middle

**Goal:** Implement a sliding window maximum over a fixed `[16]int` array using array-to-slice conversion for each window.

```go
package main

import "fmt"

func maxOf(s []int) int {
    // TODO: return max element of s
    return 0
}

func slidingMax(arr *[16]int, windowSize int) []int {
    // TODO: slide a window of windowSize over arr
    // For each position i, compute max of arr[i:i+windowSize:i+windowSize]
    // Return a slice of maximums
    return nil
}

func main() {
    arr := [16]int{3, 1, 2, 5, 4, 6, 8, 7, 9, 2, 1, 4, 3, 5, 7, 6}
    result := slidingMax(&arr, 3)
    fmt.Println("Sliding max (window=3):", result)
}
```

**Expected Output:**
```
Sliding max (window=3): [3 5 5 6 8 8 9 9 9 4 4 5 7 7]
```

**Evaluation Checklist:**
- [ ] Uses `arr[i:i+windowSize:i+windowSize]` (bounded cap)
- [ ] Correct number of windows: len(arr) - windowSize + 1
- [ ] Correct maximum for each window
- [ ] No out-of-bounds access

---

## Task 7: Ring Buffer Implementation
**Type:** Data Structures | **Level:** Middle-Senior

**Goal:** Implement a ring buffer backed by a `[8]int` array (no heap allocation).

```go
package main

import "fmt"

type RingBuf struct {
    data [8]int
    head int
    tail int
    size int
}

func (r *RingBuf) Enqueue(v int) bool {
    // TODO: Add v to tail. Return false if full.
    return false
}

func (r *RingBuf) Dequeue() (int, bool) {
    // TODO: Remove and return value from head. Return false if empty.
    return 0, false
}

func (r *RingBuf) Peek() []int {
    // TODO: Return a snapshot of current contents (use make+copy from r.data[:])
    return nil
}

func main() {
    rb := &RingBuf{}
    for i := 1; i <= 8; i++ {
        rb.Enqueue(i)
    }
    fmt.Println("Full buffer:", rb.Peek()) // [1 2 3 4 5 6 7 8]
    rb.Dequeue()
    rb.Dequeue()
    rb.Enqueue(9)
    rb.Enqueue(10)
    fmt.Println("After deq×2, enq(9,10):", rb.Peek()) // [3 4 5 6 7 8 9 10]
}
```

**Expected Output:**
```
Full buffer: [1 2 3 4 5 6 7 8]
After deq×2, enq(9,10): [3 4 5 6 7 8 9 10]
```

**Evaluation Checklist:**
- [ ] Backing array `[8]int` — no `make` for the buffer
- [ ] Enqueue/Dequeue work correctly with wrap-around
- [ ] Peek returns a correct snapshot
- [ ] Full and empty cases handled

---

## Task 8: Escape Analysis Investigation
**Type:** Performance / Tooling | **Level:** Senior

**Goal:** Write two functions — one where the array escapes and one where it stays on the stack — then verify using `go build -gcflags="-m"`.

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

// TODO: Write function readStackBuf that:
// - Declares [256]byte as local variable
// - Reads from r into buf[:]
// - Returns only the count (int) — NOT the slice
// This should NOT cause buf to escape

// TODO: Write function readHeapBuf that:
// - Declares [256]byte as local variable
// - Reads from r into buf[:]
// - Returns buf[:n]  (the slice itself)
// This SHOULD cause buf to escape

func main() {
    r := strings.NewReader("hello world")
    // TODO: call both functions and print their results

    // Verify by running:
    // go build -gcflags="-m" .
    // Look for "buf escapes to heap" in readHeapBuf output
    _ = r
    _ = fmt.Println
    _ = io.EOF
}
```

**Expected build output (gcflags="-m"):**
```
./main.go:XX:6: buf escapes to heap   (in readHeapBuf)
                                       (no such line for readStackBuf)
```

**Evaluation Checklist:**
- [ ] `readStackBuf` does not return or store `buf[:]`
- [ ] `readHeapBuf` returns `buf[:]` causing escape
- [ ] `go build -gcflags="-m"` shows escape for heap version only
- [ ] Both functions compile and produce correct results

---

## Task 9: Cryptographic Buffer Zeroing
**Type:** Security | **Level:** Middle-Senior

**Goal:** Implement a function that uses a `[32]byte` array as a cryptographic key, uses it, and then explicitly zeroes it after use.

```go
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "fmt"
)

// deriveMAC computes HMAC-SHA256 of message using key.
// It must zero the key array after use.
func deriveMAC(key *[32]byte, message []byte) []byte {
    // TODO: compute HMAC using key[:]
    // TODO: use defer to zero key after computation
    // Hint: key = &[32]byte{} does NOT work (can't assign to pointer)
    // Use: *key = [32]byte{}  OR loop through key[:]
    return nil
}

func main() {
    key := [32]byte{}
    copy(key[:], "my-secret-key-that-is-32-bytes!!")
    mac := deriveMAC(&key, []byte("important message"))
    fmt.Printf("MAC: %x\n", mac)
    // After deriveMAC returns, key should be all zeros
    fmt.Println("Key zeroed:", key == [32]byte{})
}
```

**Expected Output:**
```
MAC: <32 hex bytes>
Key zeroed: true
```

**Evaluation Checklist:**
- [ ] Uses `[32]byte` not `[]byte` for key
- [ ] Key is correctly passed and used for HMAC
- [ ] `defer` zeroes `*key` after use
- [ ] `key == [32]byte{}` confirms zeroing

---

## Task 10: sync.Pool with Fixed Array Buffers
**Type:** Performance | **Level:** Senior

**Goal:** Implement a buffer pool using `sync.Pool` with `*[4096]byte` arrays. Compare allocs/op with and without the pool.

```go
package main

import (
    "fmt"
    "sync"
    "testing"
)

var pool = sync.Pool{
    New: func() any {
        // TODO: return a *[4096]byte
        return nil
    },
}

func processWithPool(data []byte) int {
    // TODO: Get buffer from pool
    // TODO: copy data into buffer[:]
    // TODO: do some work (e.g., count non-zero bytes)
    // TODO: Put buffer back into pool (zero it first)
    // TODO: return result
    return 0
}

func processWithMake(data []byte) int {
    buf := make([]byte, 4096)
    copy(buf, data)
    count := 0
    for _, b := range buf {
        if b != 0 {
            count++
        }
    }
    return count
}

func main() {
    data := make([]byte, 100)
    for i := range data {
        data[i] = byte(i + 1)
    }

    allocsPool := testing.AllocsPerRun(1000, func() {
        _ = processWithPool(data)
    })
    allocsMake := testing.AllocsPerRun(1000, func() {
        _ = processWithMake(data)
    })

    fmt.Printf("With pool: %.1f allocs/op\n", allocsPool)
    fmt.Printf("With make: %.1f allocs/op\n", allocsMake)
}
```

**Expected Output:**
```
With pool: 0.0 allocs/op   (or very close to 0 after warmup)
With make: 1.0 allocs/op
```

**Evaluation Checklist:**
- [ ] Pool uses `*[4096]byte` not `[]byte`
- [ ] Buffers are zeroed before returning to pool
- [ ] Pool version shows fewer allocations
- [ ] Both versions produce correct results

---

## Task 11: Binary Protocol Header Parser
**Type:** Real-World | **Level:** Middle

**Goal:** Parse a fixed-size binary protocol header from a `[16]byte` array using sub-slices.

```go
package main

import (
    "encoding/binary"
    "fmt"
)

// Protocol header layout (16 bytes):
// [0:4]  Magic number (uint32 big-endian)
// [4:6]  Version (uint16 big-endian)
// [6:8]  Flags (uint16 big-endian)
// [8:16] Payload length (uint64 big-endian)

type Header struct {
    Magic         uint32
    Version       uint16
    Flags         uint16
    PayloadLength uint64
}

func parseHeader(raw *[16]byte) Header {
    // TODO: Use raw[0:4], raw[4:6], raw[6:8], raw[8:16] to parse each field
    // Use encoding/binary.BigEndian.Uint32/Uint16/Uint64
    return Header{}
}

func main() {
    raw := [16]byte{
        0xCA, 0xFE, 0xBA, 0xBE, // Magic: 0xCAFEBABE
        0x00, 0x02,              // Version: 2
        0x00, 0x01,              // Flags: 1
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, // PayloadLength: 1024
    }

    h := parseHeader(&raw)
    fmt.Printf("Magic:   0x%X\n", h.Magic)
    fmt.Printf("Version: %d\n", h.Version)
    fmt.Printf("Flags:   %d\n", h.Flags)
    fmt.Printf("Length:  %d\n", h.PayloadLength)
}
```

**Expected Output:**
```
Magic:   0xCAFEBABE
Version: 2
Flags:   1
Length:  1024
```

**Evaluation Checklist:**
- [ ] All 4 fields parsed correctly
- [ ] Sub-slices used for each field region
- [ ] Big-endian byte order applied correctly
- [ ] No out-of-bounds access
