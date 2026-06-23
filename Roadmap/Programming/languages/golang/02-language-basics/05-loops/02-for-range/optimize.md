# for range — Optimization Exercises

Each exercise presents working but suboptimal code. Identify the performance issue and apply the optimization.

---

## Exercise 1 🟢 — Unnecessary String Concatenation in Loop

```go
package main

import "fmt"

func joinWords(words []string) string {
    result := ""
    for _, w := range words {
        result += w + " " // repeated string allocation!
    }
    return result
}

func main() {
    words := []string{"Go", "is", "fast", "and", "fun"}
    fmt.Println(joinWords(words))
}
```

**Problem:** Each `+=` creates a new string object, O(n²) total allocations for n words.

<details>
<summary>Optimized Solution</summary>

```go
import "strings"

func joinWords(words []string) string {
    return strings.Join(words, " ")
}

// Or if custom logic is needed:
func joinWords(words []string) string {
    var sb strings.Builder
    sb.Grow(estimatedSize(words)) // pre-allocate
    for i, w := range words {
        if i > 0 { sb.WriteByte(' ') }
        sb.WriteString(w)
    }
    return sb.String()
}

func estimatedSize(words []string) int {
    n := len(words) - 1 // spaces
    for _, w := range words { n += len(w) }
    return n
}
```

`strings.Builder` amortizes allocations. `strings.Join` is even simpler. Benchmark shows 10-100x improvement for large word lists.
</details>

---

## Exercise 2 🟢 — Missing Pre-allocation

```go
package main

import "fmt"

func doubleAll(nums []int) []int {
    var result []int // starts nil, no capacity
    for _, n := range nums {
        result = append(result, n*2) // grows repeatedly
    }
    return result
}

func main() {
    big := make([]int, 100000)
    for i := range big { big[i] = i }
    fmt.Println(len(doubleAll(big)))
}
```

**Problem:** `append` causes repeated reallocations (doubling capacity each time): 1, 2, 4, 8, ... ~17 reallocations for 100K elements.

<details>
<summary>Optimized Solution</summary>

```go
func doubleAll(nums []int) []int {
    result := make([]int, len(nums)) // exact size — no reallocation
    for i, n := range nums {
        result[i] = n * 2
    }
    return result
}
```

Or if exact count is unknown but a bound is known:
```go
result := make([]int, 0, len(nums)) // capacity hint
for _, n := range nums {
    result = append(result, n*2) // never reallocates
}
```

Benchmark: pre-allocated version is 3-5x faster with 0 allocations vs ~17.
</details>

---

## Exercise 3 🟢 — Copying Large Structs in Range

```go
package main

import "fmt"

type LargeRecord struct {
    ID   int
    Data [512]byte
    Name string
}

func sumIDs(records []LargeRecord) int {
    total := 0
    for _, r := range records { // copies 520+ bytes per iteration!
        total += r.ID
    }
    return total
}

func main() {
    records := make([]LargeRecord, 10000)
    for i := range records { records[i].ID = i }
    fmt.Println(sumIDs(records))
}
```

<details>
<summary>Optimized Solution</summary>

```go
func sumIDs(records []LargeRecord) int {
    total := 0
    for i := range records { // no copy — accesses slice element directly
        total += records[i].ID
    }
    return total
}
```

Using index avoids copying 520+ bytes per iteration. For 10K records: saves 5.2MB of data movement. Benchmark shows 4-8x improvement on large structs.

Alternatively, store pointers or use a separate ID slice for this access pattern (SoA layout).
</details>

---

## Exercise 4 🟡 — Map Lookup in Hot Loop

```go
package main

import "fmt"

var config = map[string]string{
    "host": "localhost",
    "port": "8080",
    "mode": "production",
}

func processRequests(requests []string) []string {
    results := make([]string, len(requests))
    for i, req := range requests {
        host := config["host"] // map lookup every iteration
        port := config["port"]
        results[i] = fmt.Sprintf("%s -> %s:%s", req, host, port)
    }
    return results
}
```

<details>
<summary>Optimized Solution</summary>

```go
func processRequests(requests []string) []string {
    // Hoist invariant map lookups outside the loop
    host := config["host"]
    port := config["port"]

    results := make([]string, len(requests))
    for i, req := range requests {
        results[i] = fmt.Sprintf("%s -> %s:%s", req, host, port)
    }
    return results
}
```

Map lookups involve hash computation + potential cache misses. For N=1M requests, saving 2 map lookups per iteration can save 200-500ns × 1M = 200-500ms.
</details>

---

## Exercise 5 🟡 — Interface Type Assertion Per Iteration

```go
package main

import "fmt"

type Sizer interface {
    Size() int
}

type Vec []int

func (v Vec) Size() int { return len(v) }

func totalSize(items []Sizer) int {
    total := 0
    for _, item := range items {
        total += item.Size() // virtual dispatch per call
    }
    return total
}

func main() {
    items := make([]Sizer, 1000)
    for i := range items {
        items[i] = Vec(make([]int, i))
    }
    fmt.Println(totalSize(items))
}
```

<details>
<summary>Optimized Solution</summary>

```go
// If all items are the same concrete type, avoid the interface:
func totalSizeVec(vecs []Vec) int {
    total := 0
    for _, v := range vecs {
        total += len(v) // direct field access, no virtual dispatch
    }
    return total
}

// If you must use interface, and type is known uniform, use type switch once:
func totalSize(items []Sizer) int {
    // Check if all are Vec (one type assertion)
    if len(items) > 0 {
        if _, ok := items[0].(Vec); ok {
            total := 0
            for _, item := range items {
                total += len(item.(Vec)) // still assertion but compiler may optimize
            }
            return total
        }
    }
    // Fallback: generic path
    total := 0
    for _, item := range items {
        total += item.Size()
    }
    return total
}
```

Interface dispatch adds ~5-10ns per call. For 1M iterations: 5-10ms overhead.
</details>

---

## Exercise 6 🟡 — Repeated Length Computation

```go
package main

func process(matrix [][]int) []int {
    result := make([]int, len(matrix[0]))
    for i := range matrix {
        for j := 0; j < len(matrix[i]); j++ { // len() called every j iteration
            result[j] += matrix[i][j]
        }
    }
    return result
}
```

<details>
<summary>Optimized Solution</summary>

```go
func process(matrix [][]int) []int {
    if len(matrix) == 0 { return nil }
    cols := len(matrix[0])
    result := make([]int, cols)
    for _, row := range matrix {
        for j, v := range row { // for range: len computed once
            result[j] += v
        }
    }
    return result
}
```

Using `for range` on the inner slice automatically captures `len(row)` once. The outer loop uses the captured `row` slice, making both loops range-optimal. The compiler can also apply BCE more aggressively.
</details>

---

## Exercise 7 🟡 — Sorting Map Keys Repeatedly

```go
package main

import (
    "fmt"
    "sort"
)

func printMapTen(m map[string]int) {
    for i := 0; i < 10; i++ {
        keys := make([]string, 0, len(m))
        for k := range m { keys = append(keys, k) }
        sort.Strings(keys) // sorts every iteration!
        for _, k := range keys {
            fmt.Printf("%s: %d\n", k, m[k])
        }
    }
}
```

<details>
<summary>Optimized Solution</summary>

```go
func printMapTen(m map[string]int) {
    // Sort once outside the outer loop
    keys := make([]string, 0, len(m))
    for k := range m { keys = append(keys, k) }
    sort.Strings(keys)

    for i := 0; i < 10; i++ {
        for _, k := range keys {
            fmt.Printf("%s: %d\n", k, m[k])
        }
    }
}
```

Sorting is O(n log n). Doing it 10 times instead of 1 is 10x wasted work. Hoist the sort outside the repetition loop.
</details>

---

## Exercise 8 🔴 — Serial Processing of Independent Items

```go
package main

import (
    "fmt"
    "time"
)

func fetchData(id int) int {
    time.Sleep(10 * time.Millisecond) // simulates network call
    return id * 100
}

func processAll(ids []int) []int {
    results := make([]int, len(ids))
    for i, id := range ids {
        results[i] = fetchData(id) // serial: 100 * 10ms = 1 second
    }
    return results
}

func main() {
    ids := make([]int, 100)
    for i := range ids { ids[i] = i }
    start := time.Now()
    results := processAll(ids)
    fmt.Printf("Done in %v, results[0]=%d\n", time.Since(start), results[0])
}
```

<details>
<summary>Optimized Solution</summary>

```go
import "sync"

func processAll(ids []int) []int {
    results := make([]int, len(ids))
    var wg sync.WaitGroup

    for i, id := range ids {
        i, id := i, id // capture per-iteration
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = fetchData(id)
        }()
    }
    wg.Wait()
    return results
}
// Runtime: ~10ms instead of 1 second (100x speedup)
```

For I/O-bound operations (network, disk), parallelism with goroutines provides near-linear speedup. CPU-bound: use `runtime.GOMAXPROCS` worth of workers to avoid excessive goroutine overhead.

**With semaphore (limit concurrency):**
```go
func processAll(ids []int, maxConcurrent int) []int {
    results := make([]int, len(ids))
    sem := make(chan struct{}, maxConcurrent)
    var wg sync.WaitGroup

    for i, id := range ids {
        i, id := i, id
        sem <- struct{}{} // acquire
        wg.Add(1)
        go func() {
            defer wg.Done()
            defer func() { <-sem }() // release
            results[i] = fetchData(id)
        }()
    }
    wg.Wait()
    return results
}
```
</details>

---

## Exercise 9 🔴 — Allocating Slice in Every Iteration

```go
package main

import "fmt"

func processChunks(data []byte) [][]byte {
    var chunks [][]byte
    for i := 0; i < len(data); i += 64 {
        end := i + 64
        if end > len(data) { end = len(data) }
        chunk := make([]byte, end-i) // new allocation every chunk!
        copy(chunk, data[i:end])
        chunks = append(chunks, chunk)
    }
    return chunks
}

func main() {
    data := make([]byte, 10000)
    chunks := processChunks(data)
    fmt.Println(len(chunks))
}
```

<details>
<summary>Optimized Solution</summary>

```go
func processChunks(data []byte) [][]byte {
    chunkSize := 64
    n := (len(data) + chunkSize - 1) / chunkSize // ceiling division

    // Option 1: Return sub-slices (zero copy — shares backing array)
    chunks := make([][]byte, 0, n)
    for i := 0; i < len(data); i += chunkSize {
        end := i + chunkSize
        if end > len(data) { end = len(data) }
        chunks = append(chunks, data[i:end]) // no copy, just slice header
    }
    return chunks

    // Option 2: Single large allocation if copy is needed
    buf := make([]byte, len(data)) // one allocation
    copy(buf, data)
    chunks = make([][]byte, 0, n)
    for i := 0; i < len(buf); i += chunkSize {
        end := i + chunkSize
        if end > len(buf) { end = len(buf) }
        chunks = append(chunks, buf[i:end])
    }
    return chunks
}
```

Option 1 eliminates all intermediate allocations. n/64 allocations → 0 (plus 1 for chunks slice). For 10K bytes: reduces from 157 to 1 allocations.
</details>

---

## Exercise 10 🔴 — Rebuilding Map from Scratch Each Call

```go
package main

import (
    "fmt"
    "strings"
)

func countWords(texts []string) map[string]int {
    // Called frequently — rebuilds from scratch each time
    freq := map[string]int{}
    for _, text := range texts {
        for _, word := range strings.Fields(text) {
            freq[strings.ToLower(word)]++
        }
    }
    return freq
}

func main() {
    corpus := []string{
        "Go is a great language",
        "Go is used for systems programming",
        "Go has excellent concurrency",
    }
    for i := 0; i < 1000; i++ {
        _ = countWords(corpus) // called 1000x, rebuilds map each time!
    }
    fmt.Println("done")
}
```

<details>
<summary>Optimized Solution</summary>

```go
import "sync"

// Cached version with sync.Once (if corpus doesn't change)
var (
    cachedFreq map[string]int
    once       sync.Once
)

func countWordsOnce(texts []string) map[string]int {
    once.Do(func() {
        freq := make(map[string]int, 100) // estimated capacity
        for _, text := range texts {
            for _, word := range strings.Fields(text) {
                freq[strings.ToLower(word)]++
            }
        }
        cachedFreq = freq
    })
    return cachedFreq
}

// If corpus changes: use a cache key (hash of texts)
type wordCounter struct {
    mu    sync.RWMutex
    cache map[uint64]map[string]int
}

func (wc *wordCounter) Count(texts []string) map[string]int {
    key := hashTexts(texts)
    wc.mu.RLock()
    if v, ok := wc.cache[key]; ok {
        wc.mu.RUnlock()
        return v
    }
    wc.mu.RUnlock()

    freq := buildFreq(texts)
    wc.mu.Lock()
    wc.cache[key] = freq
    wc.mu.Unlock()
    return freq
}
```
</details>

---

## Exercise 11 🔴 — String Conversion in Range on Every Iteration

```go
package main

import "fmt"

func countByte(s string, target byte) int {
    count := 0
    bytes := []byte(s) // one allocation
    for _, b := range bytes {
        if b == target {
            count++
        }
    }
    return count
}

// But this is called a million times:
func main() {
    n := 0
    for i := 0; i < 1_000_000; i++ {
        n += countByte("Hello World", 'l')
    }
    fmt.Println(n)
}
```

<details>
<summary>Optimized Solution</summary>

```go
import "strings"

// Option 1: Don't convert to []byte — iterate string directly
func countByte(s string, target byte) int {
    count := 0
    for i := 0; i < len(s); i++ {
        if s[i] == target {
            count++
        }
    }
    return count
    // No allocation! s[i] on a string is valid and returns a byte.
}

// Option 2: Use standard library (optimized with SIMD)
func countByte(s string, target byte) int {
    return strings.Count(s, string(target))
}

// Option 3: bytes.Count (works on string via unsafe conversion)
import "bytes"
func countByte(s string, target byte) int {
    return bytes.Count([]byte(s), []byte{target})
    // Still allocates — not ideal for hot paths
}
```

Eliminating the `[]byte(s)` conversion: 0 allocations per call. For 1M calls: saves 1M small allocations and GC pressure.
</details>

---

## Optimization Summary Table

| Exercise | Problem | Fix | Speedup |
|---|---|---|---|
| 1 | String += in loop | strings.Builder / strings.Join | 10-100x |
| 2 | No pre-allocation | make with length/capacity | 3-5x |
| 3 | Large struct copy | Use index, not value | 4-8x |
| 4 | Map lookup in loop | Hoist outside loop | 2-5x |
| 5 | Interface dispatch | Concrete type / type switch | 2-3x |
| 6 | len() per iteration | for range (auto-captures len) | 1.5-2x |
| 7 | Sort inside loop | Sort once outside | N× (N = repetitions) |
| 8 | Serial I/O | Goroutine parallelism | Up to N× |
| 9 | Alloc per chunk | Sub-slices (zero copy) | 100x less GC |
| 10 | Rebuild map | Cache with sync.Once / RWMutex | 1000x |
| 11 | []byte conversion | Direct string byte access | 3x, 0 allocs |
