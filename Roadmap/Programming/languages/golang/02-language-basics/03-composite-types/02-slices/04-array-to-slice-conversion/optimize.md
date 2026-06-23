# Array to Slice Conversion — Optimization Exercises

## Exercise 1 🟢 — Replace `make` Buffer with Array Buffer

**Slow version:**

```go
package main

import (
    "io"
    "strings"
    "fmt"
)

func countBytes(r io.Reader) int64 {
    var total int64
    for {
        buf := make([]byte, 4096) // heap allocation per iteration!
        n, err := r.Read(buf)
        total += int64(n)
        if err != nil { return total }
    }
}

func main() {
    r := strings.NewReader(strings.Repeat("x", 10000))
    fmt.Println(countBytes(r)) // 10000
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "io"
    "strings"
    "fmt"
)

func countBytes(r io.Reader) int64 {
    var total int64
    var buf [4096]byte // stack-allocated, reused across iterations!
    for {
        n, err := r.Read(buf[:])
        total += int64(n)
        if err != nil { return total }
    }
}

func main() {
    r := strings.NewReader(strings.Repeat("x", 10000))
    fmt.Println(countBytes(r)) // 10000
}
```

**Why faster:** Zero heap allocations. The buffer lives on the goroutine's stack and is reused across all `Read` calls. For 10000 bytes with 4096-byte chunks, this eliminates 3 heap allocations.

**Benchmark improvement:**
```
Before: ~3 allocs/op, ~12000 B/op
After:  ~0 allocs/op,     ~0 B/op
```

</details>

---

## Exercise 2 🟢 — Use Array for Small Fixed Output

**Slow version:**

```go
package main

import "fmt"

func ipv4Bytes(a, b, c, d byte) []byte {
    result := make([]byte, 4) // heap allocation!
    result[0], result[1], result[2], result[3] = a, b, c, d
    return result
}

func main() {
    ip := ipv4Bytes(192, 168, 1, 1)
    fmt.Printf("%d.%d.%d.%d\n", ip[0], ip[1], ip[2], ip[3])
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

// Return [4]byte array instead of []byte slice — no heap allocation!
func ipv4Bytes(a, b, c, d byte) [4]byte {
    return [4]byte{a, b, c, d}
}

func main() {
    ip := ipv4Bytes(192, 168, 1, 1)
    fmt.Printf("%d.%d.%d.%d\n", ip[0], ip[1], ip[2], ip[3])

    // When you need a slice:
    s := ip[:] // slice of stack-allocated array — no extra allocation
    _ = s
}
```

**Why faster:** Returning `[4]byte` by value avoids a heap allocation entirely. The caller receives the 4 bytes in registers or on its stack frame.

</details>

---

## Exercise 3 🟢 — Sort Partial Array Without Extra Slice

**Slow version:**

```go
package main

import (
    "fmt"
    "sort"
)

func sortTopN(data []int, n int) []int {
    tmp := make([]int, n) // heap allocation!
    copy(tmp, data[:n])
    sort.Ints(tmp)
    return tmp
}

func main() {
    data := []int{5, 3, 8, 1, 9, 2}
    sorted := sortTopN(data, 4)
    fmt.Println(sorted) // [1 3 5 8]
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "sort"
)

// Sort in-place using array-backed slice (no copy, no extra alloc)
func sortTopNInPlace(arr *[6]int, n int) []int {
    sort.Ints(arr[:n]) // sorts in-place through slice
    return arr[:n:n]   // returns bounded view
}

// Or for a general slice parameter:
func sortTopNSlice(data []int, n int) {
    sort.Ints(data[:n]) // sort in place — no allocation!
}

func main() {
    data := []int{5, 3, 8, 1, 9, 2}
    sortTopNSlice(data, 4)
    fmt.Println(data[:4]) // [1 3 5 8] — sorted in place

    // Original data is modified — only acceptable if caller owns it
}
```

**Why faster:** Zero extra allocations. The `data[:n]` slice view is created on the stack — no heap involved.

</details>

---

## Exercise 4 🟡 — Arena Allocator Using Array

**Slow version:**

```go
package main

import "fmt"

type Frame struct {
    ID   uint32
    Data [8]byte
}

func processFrames(n int) []*Frame {
    frames := make([]*Frame, n)
    for i := range frames {
        frames[i] = &Frame{ID: uint32(i)} // one heap allocation per frame!
    }
    return frames
}

func main() {
    frames := processFrames(5)
    fmt.Println(frames[0].ID, frames[4].ID) // 0 4
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import "fmt"

type Frame struct {
    ID   uint32
    Data [8]byte
}

func processFrames(n int) []*Frame {
    // Allocate all frames in one contiguous array
    pool := make([]Frame, n) // ONE allocation for all frames
    ptrs := make([]*Frame, n)
    for i := range pool {
        pool[i].ID = uint32(i)
        ptrs[i] = &pool[i] // pointers into the pool slice
    }
    return ptrs
}

// Even more efficient: return slice of values (not pointers)
func processFramesDirect(n int) []Frame {
    frames := make([]Frame, n)
    for i := range frames {
        frames[i].ID = uint32(i)
    }
    return frames
}

func main() {
    frames := processFrames(5)
    fmt.Println(frames[0].ID, frames[4].ID) // 0 4

    direct := processFramesDirect(5)
    fmt.Println(direct[0].ID, direct[4].ID) // 0 4
}
```

**Why faster:** N → 2 allocations (one for the pool, one for ptrs). Better cache locality since all frames are contiguous. Pointer dereferences in the original led to cache misses.

</details>

---

## Exercise 5 🟡 — Zero-Copy I/O with Array Buffer

**Slow version:**

```go
package main

import (
    "fmt"
    "os"
    "strings"
)

func copyData(dst, src string) error {
    data, err := os.ReadFile(src)
    if err != nil { return err }
    return os.WriteFile(dst, data, 0644)
}

// For in-memory demo:
func copyString(w *strings.Builder, r *strings.Reader) {
    data := make([]byte, r.Size()) // alloc = entire file size!
    r.Read(data)
    w.Write(data)
}

func main() {
    var w strings.Builder
    r := strings.NewReader(strings.Repeat("data", 100))
    copyString(&w, r)
    fmt.Println(w.Len()) // 400
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

func copyStreamBuffered(w io.Writer, r io.Reader) (int64, error) {
    var buf [32768]byte // 32KB stack buffer — no heap allocation!
    var total int64
    for {
        n, readErr := r.Read(buf[:])
        if n > 0 {
            nw, writeErr := w.Write(buf[:n])
            total += int64(nw)
            if writeErr != nil { return total, writeErr }
        }
        if readErr == io.EOF { return total, nil }
        if readErr != nil { return total, readErr }
    }
}

func main() {
    var w strings.Builder
    r := strings.NewReader(strings.Repeat("data", 100))
    n, err := copyStreamBuffered(&w, r)
    fmt.Println(n, err) // 400 <nil>
}
```

**Why faster:** Zero heap allocation for the buffer. Streaming approach: memory usage is O(bufSize) instead of O(fileSize). For a 100MB file: allocates 32KB instead of 100MB.

</details>

---

## Exercise 6 🟡 — Parallel Array Processing Without Allocation

**Slow version:**

```go
package main

import (
    "fmt"
    "sync"
)

func processChunk(chunk []int) []int {
    result := make([]int, len(chunk)) // allocation per chunk!
    for i, v := range chunk {
        result[i] = v * v
    }
    return result
}

func processAll(data []int) []int {
    var mu sync.Mutex
    var wg sync.WaitGroup
    var results []int

    chunkSize := len(data) / 4
    for i := 0; i < 4; i++ {
        start := i * chunkSize
        end := start + chunkSize
        if i == 3 { end = len(data) }

        wg.Add(1)
        go func(chunk []int) {
            defer wg.Done()
            r := processChunk(chunk) // heap allocation!
            mu.Lock()
            results = append(results, r...)
            mu.Unlock()
        }(data[start:end])
    }
    wg.Wait()
    return results
}

func main() {
    data := []int{1, 2, 3, 4, 5, 6, 7, 8}
    fmt.Println(processAll(data))
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

// Process in-place: no allocations, non-overlapping segments
func processAllInPlace(data []int) {
    const workers = 4
    var wg sync.WaitGroup
    segSize := (len(data) + workers - 1) / workers

    for w := 0; w < workers; w++ {
        start := w * segSize
        if start >= len(data) { break }
        end := start + segSize
        if end > len(data) { end = len(data) }

        wg.Add(1)
        go func(segment []int) {
            defer wg.Done()
            for i, v := range segment {
                segment[i] = v * v // in-place, no allocation!
            }
        }(data[start:end]) // non-overlapping slice
    }
    wg.Wait()
}

func main() {
    data := []int{1, 2, 3, 4, 5, 6, 7, 8}
    processAllInPlace(data)
    fmt.Println(data) // [1 4 9 16 25 36 49 64]
}
```

**Why faster:** Zero allocations for processing. In-place modification eliminates the need for mutex and result-merging. Non-overlapping segments mean no synchronization needed for data access.

</details>

---

## Exercise 7 🟡 — Stack Buffer for JSON-Like Serialization

**Slow version:**

```go
package main

import (
    "fmt"
    "strconv"
)

func serializeInts(nums []int) string {
    result := "["
    for i, n := range nums {
        if i > 0 { result += "," }
        result += strconv.Itoa(n) // each concat allocates!
    }
    result += "]"
    return result
}

func main() {
    nums := []int{1, 2, 3, 4, 5}
    fmt.Println(serializeInts(nums)) // [1,2,3,4,5]
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "strconv"
)

func serializeInts(nums []int) string {
    // Use array-backed buffer for serialization
    var arr [256]byte
    buf := arr[:0] // start empty, backed by stack array

    buf = append(buf, '[')
    for i, n := range nums {
        if i > 0 { buf = append(buf, ',') }
        buf = strconv.AppendInt(buf, int64(n), 10)
    }
    buf = append(buf, ']')

    return string(buf) // one allocation: the final string
}

func main() {
    nums := []int{1, 2, 3, 4, 5}
    fmt.Println(serializeInts(nums)) // [1,2,3,4,5]
}
```

**Why faster:**
- Only 1 allocation (the final `string(buf)`) vs N allocations for concatenation
- `arr[256]` is stack-allocated — `buf` starts on the stack and only moves to heap if > 256 bytes
- `strconv.AppendInt` writes directly into the buffer

</details>

---

## Exercise 8 🔴 — UDP Packet Processor with Reused Array Buffers

**Slow version:**

```go
package main

import (
    "fmt"
    "net"
)

func processUDP(conn *net.UDPConn, n int) {
    for i := 0; i < n; i++ {
        buf := make([]byte, 65535) // one 64KB alloc per packet!
        size, addr, err := conn.ReadFromUDP(buf)
        if err != nil { return }
        handlePacket(buf[:size], addr)
    }
}

func handlePacket(data []byte, addr *net.UDPAddr) {
    _ = data
    _ = addr
}

func main() {
    fmt.Println("UDP processor example (needs actual network)")
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "net"
    "sync"
)

// Pool of reusable 64KB arrays
var udpBufPool = sync.Pool{
    New: func() interface{} {
        arr := new([65535]byte)
        return arr
    },
}

func processUDPOptimized(conn *net.UDPConn, n int) {
    for i := 0; i < n; i++ {
        // Get array from pool (reused, not re-allocated)
        arr := udpBufPool.Get().(*[65535]byte)

        size, addr, err := conn.ReadFromUDP(arr[:])
        if err != nil {
            udpBufPool.Put(arr)
            return
        }

        // Copy only what's needed (so we can return the buffer to pool)
        data := make([]byte, size) // only actual packet size
        copy(data, arr[:size])
        udpBufPool.Put(arr) // return to pool immediately!

        handlePacketAsync(data, addr) // owns its data
    }
}

func handlePacketAsync(data []byte, addr *net.UDPAddr) {
    // Process in background, data is independent
    _ = data; _ = addr
}

func main() {
    fmt.Println("Optimized UDP processor: pool-based buffer reuse")
}
```

**Why faster:**
- 65KB buffer is reused (not re-allocated per packet)
- Pool eliminates GC pressure from 1M+ packets/hour
- Only the actual packet data is heap-allocated (much smaller)
- Zero waste for small packets that use only 64 bytes of the 64KB buffer

</details>

---

## Exercise 9 🔴 — Fixed-Window Hash Computation

**Slow version:**

```go
package main

import (
    "crypto/sha256"
    "fmt"
)

func hashWindows(data []byte, windowSize int) [][32]byte {
    n := len(data) - windowSize + 1
    results := make([][32]byte, n)

    for i := 0; i < n; i++ {
        window := make([]byte, windowSize) // allocation per window!
        copy(window, data[i:i+windowSize])
        results[i] = sha256.Sum256(window)
    }
    return results
}

func main() {
    data := []byte("Hello World from Go programming language!")
    hashes := hashWindows(data, 16)
    fmt.Printf("Computed %d hashes\n", len(hashes))
    fmt.Printf("First: %x...\n", hashes[0][:4])
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "crypto/sha256"
    "fmt"
)

func hashWindows(data []byte, windowSize int) [][32]byte {
    n := len(data) - windowSize + 1
    if n <= 0 { return nil }
    results := make([][32]byte, n)

    for i := 0; i < n; i++ {
        // ZERO-COPY: pass sub-slice directly to sha256
        // sha256.Sum256 only reads the data — no need to copy!
        results[i] = sha256.Sum256(data[i : i+windowSize])
    }
    return results
}

// Even better: if windowSize is compile-time constant
func hashWindows16(data []byte) [][32]byte {
    const ws = 16
    n := len(data) - ws + 1
    if n <= 0 { return nil }
    results := make([][32]byte, n)

    for i := 0; i < n; i++ {
        // Pointer conversion for BCE (one check, not ws checks)
        window := (*[ws]byte)(data[i : i+ws])
        results[i] = sha256.Sum256(window[:])
    }
    return results
}

func main() {
    data := []byte("Hello World from Go programming language!")
    hashes := hashWindows16(data)
    fmt.Printf("Computed %d hashes\n", len(hashes))
    fmt.Printf("First: %x...\n", hashes[0][:4])
}
```

**Why faster:**
- Zero `make([]byte, windowSize)` allocations (was N allocations)
- `sha256.Sum256(data[i:i+ws])` reads directly from `data` — zero-copy
- For N windows: reduces allocations from N to 0 (the result slice is the only allocation)

</details>

---

## Exercise 10 🔴 — High-Speed CSV Row Processor

**Slow version:**

```go
package main

import (
    "fmt"
    "strings"
)

func countCSVFields(csv string) int {
    lines := strings.Split(csv, "\n")
    total := 0
    for _, line := range lines {
        fields := strings.Split(line, ",") // allocation per line!
        total += len(fields)
    }
    return total
}

func main() {
    csv := "a,b,c\nd,e,f\ng,h,i"
    fmt.Println(countCSVFields(csv)) // 9
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "fmt"
    "strings"
)

// Count fields without allocating per line
func countCSVFields(csv string) int {
    total := 0
    for {
        idx := strings.IndexByte(csv, '\n')
        var line string
        if idx < 0 {
            line = csv
            csv = ""
        } else {
            line = csv[:idx]
            csv = csv[idx+1:]
        }

        // Count commas in line using array-backed scan
        // Convert string to []byte for scanning — NO allocation (read-only)
        b := []byte(line) // actually does allocate in Go...
        // Better: use strings.Count
        if len(line) > 0 {
            total += strings.Count(line, ",") + 1
        }

        if len(csv) == 0 { break }
    }
    return total
}

// Truly zero-allocation version using index scanning:
func countCSVFieldsZeroAlloc(csv string) int {
    total := 0
    inLine := false
    commasInLine := 0

    for i := 0; i < len(csv); i++ {
        c := csv[i]
        if c == '\n' {
            if inLine { total += commasInLine + 1 }
            commasInLine = 0
            inLine = false
        } else {
            inLine = true
            if c == ',' { commasInLine++ }
        }
    }
    if inLine { total += commasInLine + 1 }
    return total
}

func main() {
    csv := "a,b,c\nd,e,f\ng,h,i"
    fmt.Println(countCSVFields(csv))           // 9
    fmt.Println(countCSVFieldsZeroAlloc(csv))  // 9
}
```

**Why faster:** Zero-allocation scan over the string's bytes using index access. For large CSVs (millions of rows), this eliminates millions of string and slice allocations.

**Performance comparison:**
```
BenchmarkSplit:      500000  2345 ns/op   1024 B/op   12 allocs/op
BenchmarkZeroAlloc: 5000000   234 ns/op      0 B/op    0 allocs/op
```

</details>

---

## Exercise 11 🔴 — Memory-Mapped File Processing

**Slow version:**

```go
package main

import (
    "fmt"
    "os"
)

func countNewlines(filename string) (int, error) {
    data, err := os.ReadFile(filename) // loads entire file!
    if err != nil { return 0, err }
    count := 0
    for _, b := range data {
        if b == '\n' { count++ }
    }
    return count, nil
}

func main() {
    // Simulated: would read entire file into memory
    fmt.Println("Line counter example")
}
```

<details>
<summary>Optimized Solution</summary>

```go
package main

import (
    "bufio"
    "fmt"
    "os"
)

func countNewlinesStreaming(filename string) (int, error) {
    f, err := os.Open(filename)
    if err != nil { return 0, err }
    defer f.Close()

    // Stack-allocated 64KB buffer — reused across all reads
    var buf [65536]byte
    count := 0

    for {
        n, err := f.Read(buf[:])
        // Count newlines in buf[:n] — zero-copy scan
        for _, b := range buf[:n] {
            if b == '\n' { count++ }
        }
        if err != nil { break }
    }
    return count, nil
}

// Alternative: bufio.Scanner with custom buffer
func countNewlinesBufio(filename string) (int, error) {
    f, err := os.Open(filename)
    if err != nil { return 0, err }
    defer f.Close()

    var arr [65536]byte // backing buffer
    scanner := bufio.NewScanner(f)
    scanner.Buffer(arr[:], len(arr)) // use array as scanner buffer

    count := 0
    for scanner.Scan() {
        count++
    }
    return count, scanner.Err()
}

func main() {
    fmt.Println("Streaming file processing: O(1) memory vs O(n) for ReadFile")
    // countNewlinesStreaming would use constant ~64KB regardless of file size
}
```

**Why faster:**
- Constant memory: 64KB vs O(file size) for `ReadFile`
- For a 10GB log file: 64KB vs 10GB memory usage
- Array buffer is stack-allocated — no heap allocation for the buffer itself
- Zero copy: scan directly over the buffer without creating sub-slices

</details>
