# make() for Slices — Find the Bug

## Bug 1 🟢 — Wrong Length vs Capacity

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)
    s = append(s, 1, 2, 3)
    fmt.Println(s)
    // Expected: [1 2 3]
    // Got: [0 0 0 0 0 1 2 3]
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Think about what `make([]int, 5)` creates. When you append to a slice with length 5, where do new elements go?

</details>

<details>
<summary>Solution</summary>

**Bug:** `make([]int, 5)` creates a slice with length=5 (5 zero elements). When `append` adds 1, 2, 3, they are placed AFTER the existing 5 zeros, resulting in `[0 0 0 0 0 1 2 3]`.

**Fix:** Use `make([]int, 0, 5)` to start with length=0 but capacity=5:

```go
package main

import "fmt"

func main() {
    s := make([]int, 0, 5) // length=0, capacity=5
    s = append(s, 1, 2, 3)
    fmt.Println(s) // [1 2 3]
}
```

</details>

---

## Bug 2 🟢 — Panic on Invalid Arguments

```go
package main

import "fmt"

func createBuffer(size int) []byte {
    return make([]byte, size, size/2) // intended: small length, large capacity
}

func main() {
    buf := createBuffer(10)
    fmt.Println(len(buf), cap(buf))
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What is the relationship requirement between length and capacity?

</details>

<details>
<summary>Solution</summary>

**Bug:** `make([]byte, 10, 10/2)` = `make([]byte, 10, 5)`. Capacity (5) is less than length (10), which panics with `runtime error: makeslice: cap out of range`.

**Fix:** The capacity must be >= length:

```go
func createBuffer(size int) []byte {
    return make([]byte, size/2, size) // length=5, capacity=10 ✓
}
```

Or if the intent was to have full length:

```go
func createBuffer(size int) []byte {
    return make([]byte, size) // length=size, capacity=size ✓
}
```

</details>

---

## Bug 3 🟢 — Nil Slice Not Initialized

```go
package main

import "fmt"

func main() {
    var result []int

    for i := 0; i < 5; i++ {
        result[i] = i * 2 // indexing into nil slice
    }

    fmt.Println(result)
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

You cannot index into a nil slice. What builtin function allocates and initializes a slice?

</details>

<details>
<summary>Solution</summary>

**Bug:** `var result []int` creates a nil slice with no backing array. Indexing with `result[i]` panics with `runtime error: index out of range`.

**Fix 1:** Use `make` to allocate:
```go
result := make([]int, 5)
for i := 0; i < 5; i++ {
    result[i] = i * 2
}
```

**Fix 2:** Use append:
```go
var result []int
for i := 0; i < 5; i++ {
    result = append(result, i*2)
}
```

</details>

---

## Bug 4 🟡 — Shared Backing Array After Sub-slice

```go
package main

import "fmt"

func processData(data []int) []int {
    result := make([]int, len(data))
    copy(result, data)
    return result[:3] // return first 3 elements
}

func main() {
    s := []int{1, 2, 3, 4, 5}
    subset := processData(s)
    subset[0] = 999

    full := processData(s)
    fmt.Println(full) // expected [1 2 3 4 5]
    // Got: depends on GC behavior — might be [999 2 3 4 5]!
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What does `result[:3]` return? Does it share memory with `result`?

</details>

<details>
<summary>Solution</summary>

**Bug:** `result[:3]` is a sub-slice of `result`. It shares the same backing array. When `subset[0] = 999`, it modifies `result[0]`. However, the real danger is that `result` (with cap=5) is retained in memory even though only 3 elements are used.

More critically, if the caller stores `subset` and later receives another result pointing to the same-ish memory (in theory), data can corrupt. The returned slice exposes the backing array's remaining capacity.

**Fix:** Use `make` and `copy` for the returned sub-slice:

```go
func processData(data []int) []int {
    result := make([]int, len(data))
    copy(result, data)

    // Return independent copy of first 3 elements
    out := make([]int, 3)
    copy(out, result[:3])
    return out
}
```

Or use `append`:
```go
return append([]int{}, result[:3]...)
```

</details>

---

## Bug 5 🟡 — `new` Instead of `make`

```go
package main

import "fmt"

func main() {
    s := new([]int)
    *s = append(*s, 1, 2, 3)

    // Later, someone tries to use it directly:
    process(*s)
}

func process(s []int) {
    s2 := new([]int)
    for i, v := range s {
        (*s2)[i] = v * 2 // BUG: s2 is nil slice, no backing array!
    }
    fmt.Println(*s2)
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

`new([]int)` returns a pointer to a nil slice. The nil slice has no backing array. What happens when you index it?

</details>

<details>
<summary>Solution</summary>

**Bug:** `s2 := new([]int)` creates a pointer to a nil slice. `(*s2)[i]` tries to index a nil slice — this panics with `index out of range`.

**Fix:** Use `make` instead of `new`:

```go
func process(s []int) {
    s2 := make([]int, len(s)) // properly initialized!
    for i, v := range s {
        s2[i] = v * 2 // works correctly
    }
    fmt.Println(s2)
}
```

</details>

---

## Bug 6 🟡 — Concurrent `make` Into Shared Map

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    m := make(map[string][]int)
    var wg sync.WaitGroup

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            key := fmt.Sprintf("key%d", id%2) // only 2 keys
            // BUG: concurrent map write without lock!
            m[key] = append(m[key], id)
        }(i)
    }

    wg.Wait()
    fmt.Println(m)
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Go maps are not goroutine-safe for concurrent writes. What happens when multiple goroutines write to the same map simultaneously?

</details>

<details>
<summary>Solution</summary>

**Bug:** Concurrent writes to a Go map cause a fatal panic: `concurrent map writes`. The Go race detector (`-race` flag) would catch this.

**Fix:** Protect map access with a mutex:

```go
func main() {
    m := make(map[string][]int)
    var mu sync.Mutex
    var wg sync.WaitGroup

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            key := fmt.Sprintf("key%d", id%2)
            mu.Lock()
            m[key] = append(m[key], id)
            mu.Unlock()
        }(i)
    }

    wg.Wait()
    fmt.Println(m)
}
```

Or use `sync.Map` for concurrent-safe maps.

</details>

---

## Bug 7 🟡 — Memory Leak: Retained Large Slice

```go
package main

import (
    "fmt"
    "runtime"
)

func loadLargeData() []byte {
    // Simulates loading 10MB of data
    data := make([]byte, 10*1024*1024)
    for i := range data {
        data[i] = byte(i)
    }
    return data
}

func extractHeader(data []byte) []byte {
    return data[:64] // "only need first 64 bytes"
}

func main() {
    data := loadLargeData()
    header := extractHeader(data)
    data = nil // try to free data

    runtime.GC()

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("HeapAlloc: %d MB\n", m.HeapAlloc/1024/1024)
    // Still shows ~10MB! header retains the 10MB backing array
    fmt.Println(header[:4])
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Sub-slicing doesn't copy data. What does `header` reference regarding the original backing array?

</details>

<details>
<summary>Solution</summary>

**Bug:** `data[:64]` creates a slice that points INTO the 10MB backing array. Setting `data = nil` only removes the header variable's reference; `header` still holds a reference to the same backing array. The GC cannot collect the 10MB because `header` holds a live reference.

**Fix:** Copy only what you need:

```go
func extractHeader(data []byte) []byte {
    header := make([]byte, 64) // new, independent backing array
    copy(header, data[:64])
    return header // data's 10MB can now be GC'd
}
```

</details>

---

## Bug 8 🔴 — Off-by-One in Batch Size

```go
package main

import "fmt"

func batch(items []int, size int) [][]int {
    n := len(items) / size // integer division — BUG!
    batches := make([][]int, 0, n)

    for i := 0; i < len(items); i += size {
        end := i + size
        if end > len(items) {
            end = len(items)
        }
        batches = append(batches, items[i:end])
    }
    return batches
}

func main() {
    items := []int{1, 2, 3, 4, 5, 6, 7} // 7 items, size 3
    batches := batch(items, 3)

    // Expected 3 batches: [1,2,3] [4,5,6] [7]
    for i, b := range batches {
        fmt.Printf("Batch %d: %v\n", i, b)
    }
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

When `len=7` and `size=3`, what does `7/3` equal in integer division? How many batches are actually produced?

</details>

<details>
<summary>Solution</summary>

**Bug:** `n := len(items) / size` = `7/3` = `2` (integer division truncates). But there are actually 3 batches. The `make([][]int, 0, n)` pre-allocates for only 2 batches, causing a reallocation for the third. Not a crash, but a missed optimization — and if the code depended on exact capacity, it could be a logic error.

**Fix:** Use ceiling division:

```go
func batch(items []int, size int) [][]int {
    n := (len(items) + size - 1) / size // ceiling division
    batches := make([][]int, 0, n)

    for i := 0; i < len(items); i += size {
        end := i + size
        if end > len(items) {
            end = len(items)
        }
        batches = append(batches, items[i:end])
    }
    return batches
}
```

</details>

---

## Bug 9 🔴 — Goroutine Closure Captures Wrong Variable

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    results := make([]int, 5)
    var wg sync.WaitGroup

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() { // BUG: closure captures i by reference
            defer wg.Done()
            results[i] = i * 2
        }()
    }

    wg.Wait()
    fmt.Println(results)
    // Expected: [0 2 4 6 8]
    // Likely got: [10 10 10 10 10] or panic: index out of range [5]
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Go closures capture variables by reference. By the time the goroutine runs, what value does `i` have?

</details>

<details>
<summary>Solution</summary>

**Bug:** The closure captures the variable `i` by reference, not by value. By the time goroutines run, the loop may have finished and `i` equals 5. Accessing `results[5]` panics (out of range), or all goroutines write to the same index.

**Fix 1:** Pass `i` as a parameter:

```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(idx int) {
        defer wg.Done()
        results[idx] = idx * 2
    }(i) // pass current i as argument
}
```

**Fix 2** (Go 1.22+): Loop variable semantics changed; each iteration has its own `i`.

```go
// In Go 1.22+, the for loop variable is per-iteration
// but for clarity, always use the parameter form
```

</details>

---

## Bug 10 🔴 — `make` in Hot Path Causes GC Storm

```go
package main

import (
    "fmt"
    "net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
    // BUG: allocates a new 64KB buffer for EVERY request!
    buf := make([]byte, 64*1024)
    n, _ := r.Body.Read(buf)
    w.Write(buf[:n])
}

func main() {
    http.HandleFunc("/", handler)
    fmt.Println("Server starting...")
    // At 10000 RPS: 10000 * 64KB = 640MB/s allocation rate!
    // GC cannot keep up → service degradation
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What happens to GC when you allocate 640MB/s of short-lived buffers? What pattern reuses allocated memory?

</details>

<details>
<summary>Solution</summary>

**Bug:** Every HTTP request allocates a fresh 64KB buffer. At high request rates, this creates extreme GC pressure. GC runs continuously, causing stop-the-world pauses and latency spikes.

**Fix:** Use `sync.Pool` to reuse buffers:

```go
package main

import (
    "fmt"
    "net/http"
    "sync"
)

var bufPool = sync.Pool{
    New: func() interface{} {
        buf := make([]byte, 64*1024)
        return &buf
    },
}

func handler(w http.ResponseWriter, r *http.Request) {
    bufPtr := bufPool.Get().(*[]byte)
    buf := *bufPtr
    defer func() {
        buf = buf[:cap(buf)] // reset length
        *bufPtr = buf
        bufPool.Put(bufPtr)
    }()

    n, _ := r.Body.Read(buf)
    w.Write(buf[:n])
}

func main() {
    http.HandleFunc("/", handler)
    fmt.Println("Server starting...")
}
```

This reduces allocation rate from 640MB/s to near-zero (buffers are reused).

</details>

---

## Bug 11 🔴 — Incorrect 2D Slice Init Shares Rows

```go
package main

import "fmt"

func makeMatrix(rows, cols int) [][]int {
    // BUG: all rows point to the same underlying array!
    matrix := make([][]int, rows)
    row := make([]int, cols)
    for i := range matrix {
        matrix[i] = row // all rows share the same slice!
    }
    return matrix
}

func main() {
    m := makeMatrix(3, 3)
    m[0][0] = 1
    m[1][1] = 2
    m[2][2] = 3

    for _, row := range m {
        fmt.Println(row)
    }
    // Expected:
    // [1 0 0]
    // [0 2 0]
    // [0 0 3]
    // Actual (all rows same!):
    // [1 2 3]
    // [1 2 3]
    // [1 2 3]
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Slices are reference types. When you assign the same slice to multiple rows, what do all rows point to?

</details>

<details>
<summary>Solution</summary>

**Bug:** `row := make([]int, cols)` creates ONE backing array. Assigning `matrix[i] = row` makes ALL rows point to the same backing array. Writing `m[0][0] = 1` modifies the shared array, so all rows see the change.

**Fix:** Create a separate slice for each row:

```go
func makeMatrix(rows, cols int) [][]int {
    matrix := make([][]int, rows)
    for i := range matrix {
        matrix[i] = make([]int, cols) // new slice per row!
    }
    return matrix
}
```

Or use the contiguous allocation pattern:

```go
func makeMatrix(rows, cols int) [][]int {
    data := make([]int, rows*cols)
    matrix := make([][]int, rows)
    for i := range matrix {
        matrix[i] = data[i*cols : (i+1)*cols]
    }
    return matrix
}
```

</details>

---

## Bug 12 🔴 — Channel Deadlock from Wrong Buffer Size

```go
package main

import "fmt"

func main() {
    items := []int{1, 2, 3, 4, 5}

    // BUG: unbuffered channel, no goroutine to receive!
    ch := make(chan int) // should be buffered

    for _, item := range items {
        ch <- item // DEADLOCK: blocks on first send
    }

    for i := 0; i < len(items); i++ {
        fmt.Println(<-ch)
    }
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

An unbuffered channel requires both sender and receiver to be ready simultaneously. Without a goroutine receiving, what happens when you try to send?

</details>

<details>
<summary>Solution</summary>

**Bug:** `make(chan int)` creates an unbuffered channel. `ch <- item` blocks until someone receives. Since the receive loop is AFTER the send loop, both are in the same goroutine — deadlock!

**Fix 1:** Use a buffered channel large enough for all sends:

```go
ch := make(chan int, len(items)) // buffered for all items

for _, item := range items {
    ch <- item // won't block
}
close(ch)

for v := range ch {
    fmt.Println(v)
}
```

**Fix 2:** Use a goroutine for the sender:

```go
ch := make(chan int)

go func() {
    for _, item := range items {
        ch <- item
    }
    close(ch)
}()

for v := range ch {
    fmt.Println(v)
}
```

</details>
