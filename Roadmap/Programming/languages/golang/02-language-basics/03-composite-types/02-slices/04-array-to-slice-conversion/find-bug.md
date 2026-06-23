# Array to Slice Conversion — Find the Bug

## Bug 1 🟢 — Modifying Copy Instead of Original

```go
package main

import "fmt"

func clearArray(arr [5]int) {
    s := arr[:]
    for i := range s {
        s[i] = 0
    }
}

func main() {
    arr := [5]int{1, 2, 3, 4, 5}
    clearArray(arr)
    fmt.Println(arr) // expected [0 0 0 0 0], got [1 2 3 4 5]
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Arrays in Go are value types. What happens when you pass `arr` to a function?

</details>

<details>
<summary>Solution</summary>

**Bug:** `clearArray` receives `arr` by value — a complete copy. `arr[:]` creates a slice of the copy, not the original. Modifications through `s` affect only the copy.

**Fix:** Pass a pointer to the array:

```go
func clearArray(arr *[5]int) {
    s := arr[:]
    for i := range s {
        s[i] = 0
    }
}

func main() {
    arr := [5]int{1, 2, 3, 4, 5}
    clearArray(&arr)
    fmt.Println(arr) // [0 0 0 0 0] — correct!
}
```

</details>

---

## Bug 2 🟢 — Append Unexpectedly Modifies Array

```go
package main

import "fmt"

func appendItem(s []int, item int) []int {
    return append(s, item)
}

func main() {
    arr := [5]int{1, 2, 3}
    // arr[3] and arr[4] are zero

    s := arr[:3] // len=3, cap=5

    s2 := appendItem(s, 99)
    fmt.Println(arr) // expected [1 2 3 0 0], but...
    fmt.Println(s2)  // [1 2 3 99]
    // arr[3] is now 99! Unexpected!
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What is the capacity of `arr[:3]`? When `append` stays within capacity, where does it write?

</details>

<details>
<summary>Solution</summary>

**Bug:** `arr[:3]` has `cap=5`. When `append(s, 99)` is called, since `len(s)=3 < cap=5`, the new element is written to `arr[3]` — the array's 4th element — modifying the original array unexpectedly.

**Fix 1:** Use three-index slice to limit capacity:

```go
s := arr[:3:3] // cap=3 — append triggers new allocation

s2 := appendItem(s, 99)
fmt.Println(arr) // [1 2 3 0 0] — unchanged!
```

**Fix 2:** Copy before passing to functions that append:

```go
sCopy := make([]int, 3)
copy(sCopy, arr[:3])
s2 := appendItem(sCopy, 99)
```

</details>

---

## Bug 3 🟢 — Wrong Cap Calculation

```go
package main

import "fmt"

func main() {
    arr := [8]int{0, 1, 2, 3, 4, 5, 6, 7}

    s := arr[3:6]
    fmt.Printf("len=%d cap=%d\n", len(s), cap(s))
    // Developer expects cap=3, but actually cap=5
    // Later code assumes cap==len and breaks!

    if cap(s) != len(s) {
        fmt.Println("BUG: cap != len!")
    }
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What is the formula for `cap` when slicing an array `arr[low:high]`?

</details>

<details>
<summary>Solution</summary>

**Bug:** The developer assumed `cap = high - low = len`. But the capacity of `arr[low:high]` is `len(arr) - low = 8 - 3 = 5`, not `high - low = 3`.

**Fix:** Use three-index form to get `cap == len`:

```go
s := arr[3:6:6] // cap = 6-3 = 3 = len ✓
fmt.Printf("len=%d cap=%d\n", len(s), cap(s)) // len=3 cap=3
```

Or document and handle the larger capacity explicitly.

</details>

---

## Bug 4 🟡 — Memory Retention Through Sub-slice

```go
package main

import (
    "fmt"
    "runtime"
)

func loadConfig() []byte {
    // Simulates loading 1MB config file
    data := make([]byte, 1024*1024)
    for i := range data { data[i] = byte(i % 256) }
    return data
}

func getVersion(config []byte) []byte {
    // BUG: returns sub-slice of 1MB config
    return config[4:8] // "version" is 4 bytes at offset 4
}

func main() {
    config := loadConfig()
    version := getVersion(config)
    config = nil // try to free 1MB
    runtime.GC()

    // version holds 4 bytes, but 1MB is still alive!
    fmt.Println(version)
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What does `config[4:8]` share with `config`? If `version` is alive, can `config`'s backing array be GC'd?

</details>

<details>
<summary>Solution</summary>

**Bug:** `config[4:8]` is a sub-slice pointing into the 1MB backing array. Even after `config = nil`, the `version` variable holds a reference to the same backing array, preventing GC from collecting it. The 1MB stays alive for the lifetime of `version`.

**Fix:** Copy only the needed bytes:

```go
func getVersion(config []byte) []byte {
    result := make([]byte, 4) // 4 bytes only
    copy(result, config[4:8])
    return result // config's 1MB can now be GC'd
}
```

</details>

---

## Bug 5 🟡 — Sorting Beyond Valid Data

```go
package main

import (
    "fmt"
    "sort"
)

func main() {
    var arr [10]int
    n := 5 // only first 5 elements are valid
    arr[0] = 3; arr[1] = 1; arr[2] = 4; arr[3] = 1; arr[4] = 5

    // BUG: sorts all 10 elements including uninitialized zeros!
    sort.Ints(arr[:])

    fmt.Println(arr[:n]) // expected [1 1 3 4 5], got [0 0 0 0 0 1 1 3 4 5][:5]
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

`arr[:]` includes all 10 elements, not just the first 5. What happens when zeros are sorted alongside real data?

</details>

<details>
<summary>Solution</summary>

**Bug:** `sort.Ints(arr[:])` sorts all 10 elements. The 5 uninitialized zeros sort before the valid data, so `arr[:5]` ends up as `[0 0 0 0 0]` instead of `[1 1 3 4 5]`.

**Fix:** Sort only the valid portion:

```go
sort.Ints(arr[:n]) // sort only first n elements
fmt.Println(arr[:n]) // [1 1 3 4 5] — correct!
```

</details>

---

## Bug 6 🟡 — Race Condition on Overlapping Array Segments

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    arr := [10]int{0,1,2,3,4,5,6,7,8,9}
    var wg sync.WaitGroup

    // BUG: goroutines access overlapping segments!
    wg.Add(2)
    go func() {
        defer wg.Done()
        s := arr[0:6] // [0,1,2,3,4,5]
        for i := range s { s[i] *= 2 }
    }()
    go func() {
        defer wg.Done()
        s := arr[4:10] // [4,5,6,7,8,9] — overlaps at [4] and [5]!
        for i := range s { s[i] += 100 }
    }()

    wg.Wait()
    fmt.Println(arr) // non-deterministic due to race!
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Both goroutines access `arr[4]` and `arr[5]`. What is the result of concurrent reads and writes to the same memory?

</details>

<details>
<summary>Solution</summary>

**Bug:** The two slices overlap at indices 4 and 5. Goroutine 1 writes `arr[4] *= 2` and `arr[5] *= 2`. Goroutine 2 writes `arr[4] += 100` and `arr[5] += 100`. Concurrent access to the same memory without synchronization is a data race.

**Fix:** Use non-overlapping segments:

```go
wg.Add(2)
go func() {
    defer wg.Done()
    s := arr[0:5] // [0,1,2,3,4] — non-overlapping
    for i := range s { s[i] *= 2 }
}()
go func() {
    defer wg.Done()
    s := arr[5:10] // [5,6,7,8,9] — non-overlapping
    for i := range s { s[i] += 100 }
}()
```

</details>

---

## Bug 7 🟡 — Double-Free Pattern with Returned Sub-slice

```go
package main

import (
    "fmt"
    "sync"
)

type BufferPool struct {
    pool sync.Pool
}

func (p *BufferPool) Get() []byte {
    arr := p.pool.Get().(*[256]byte)
    return arr[:] // returns slice of pooled array
}

func (p *BufferPool) Put(buf []byte) {
    // BUG: converts buf back to array pointer, but buf might be a sub-slice!
    arr := (*[256]byte)(buf) // panics if len(buf) < 256!
    p.pool.Put(arr)
}

func main() {
    p := &BufferPool{pool: sync.Pool{New: func() interface{} { return new([256]byte) }}}

    buf := p.Get()
    partialBuf := buf[:64] // sub-slice!
    p.Put(partialBuf) // PANIC: len(partialBuf)=64 < 256!
    fmt.Println("Done")
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What is `len(partialBuf)`? What does `(*[256]byte)(partialBuf)` require?

</details>

<details>
<summary>Solution</summary>

**Bug:** `(*[256]byte)(buf)` panics if `len(buf) < 256`. When `partialBuf = buf[:64]`, `len(partialBuf) = 64 < 256` → panic.

**Fix:** Check length before conversion, or always return `buf[:cap(buf)]`:

```go
func (p *BufferPool) Put(buf []byte) {
    // Re-expand to full capacity before returning
    if cap(buf) < 256 {
        return // not our buffer — discard
    }
    buf = buf[:cap(buf)] // might not be 256 if sub-sliced with :k
    if len(buf) != 256 {
        return
    }
    arr := (*[256]byte)(buf)
    p.pool.Put(arr)
}
```

Or better: store the `*[256]byte` directly, not as `[]byte`:

```go
func (p *BufferPool) Get() (*[256]byte, []byte) {
    arr := p.pool.Get().(*[256]byte)
    return arr, arr[:]
}
func (p *BufferPool) Put(arr *[256]byte) {
    p.pool.Put(arr)
}
```

</details>

---

## Bug 8 🔴 — Extend-Then-Corrupt Pattern

```go
package main

import "fmt"

func main() {
    arr := [8]int{1, 2, 3, 4, 5, 6, 7, 8}

    // Consumer gets a "view" of first 4 elements
    view := arr[:4]

    // Somewhere else: function appends within capacity
    view = append(view, 99, 100) // within cap=8! writes to arr[4] and arr[5]

    // Another consumer reads arr[4] expecting 5:
    fmt.Println(arr[4]) // 99 — corrupted! expected 5

    // Worse: two goroutines doing this concurrently is a data race
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

`arr[:4]` has `cap=8`. What happens when `append` adds 2 elements within that capacity?

</details>

<details>
<summary>Solution</summary>

**Bug:** `arr[:4]` with `cap=8` allows `append` to write to `arr[4]` and `arr[5]` without triggering a reallocation. This silently corrupts `arr[4]` and `arr[5]`.

**Root cause**: The "view" was given to a consumer without restricting its capacity, allowing it to extend into unowned territory.

**Fix:** Use three-index slice to limit capacity:

```go
// view can only see 4 elements and cannot extend into arr[4:]
view := arr[:4:4] // cap=4 — append triggers new allocation

view = append(view, 99, 100) // new backing array!
fmt.Println(arr[4]) // 5 — unchanged!
```

**Lesson**: When sharing a sub-slice of an array/slice, always consider whether the receiver should be allowed to append into the parent's memory. If not, use `arr[low:high:high]`.

</details>

---

## Bug 9 🔴 — Goroutine Closure Captures Slice Variable

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    arr := [4]string{"alpha", "beta", "gamma", "delta"}
    var wg sync.WaitGroup

    for i := 0; i < 4; i++ {
        wg.Add(1)
        s := arr[i:i+1] // slice of one element
        go func() {     // BUG: closes over s which changes!
            defer wg.Done()
            fmt.Println(s[0])
        }()
    }

    wg.Wait()
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Actually look carefully: `s` is declared inside the loop with `:=`. Is it the loop variable captured by reference, or a new variable each iteration?

</details>

<details>
<summary>Solution</summary>

**Bug (subtle):** In Go < 1.22, each iteration creates a NEW `s` variable with `:=`, so closures capture different variables. However, the goroutines may not run until after the loop — but since `s` is local to each iteration (different variable each time), they DO capture correctly.

BUT: the real bug is that the goroutines may print in any order (not a data race, just non-deterministic ordering). The output may not be `alpha beta gamma delta` in order.

**A more real bug**: if the developer wrote `var s []string` outside the loop:

```go
var s []string
for i := 0; i < 4; i++ {
    s = arr[i:i+1] // s is reassigned each iteration
    go func() {
        fmt.Println(s[0]) // ALL goroutines capture the SAME s!
        // By the time they run, s points to arr[3:4] = ["delta"]
    }()
}
// All goroutines print "delta"!
```

**Fix:** Pass slice as parameter:

```go
for i := 0; i < 4; i++ {
    wg.Add(1)
    s := arr[i:i+1] // local copy per iteration
    go func(slice []string) {
        defer wg.Done()
        fmt.Println(slice[0])
    }(s) // pass as argument — unambiguous capture
}
```

</details>

---

## Bug 10 🔴 — Incorrect Length after `copy`

```go
package main

import "fmt"

func main() {
    src := [5]int{10, 20, 30, 40, 50}
    dst := make([]int, 3)

    n := copy(dst, src[:]) // copies min(3, 5) = 3 elements
    fmt.Printf("Copied %d elements\n", n)

    // BUG: developer expects full src to be in dst
    for i, v := range dst {
        if v != src[i] {
            fmt.Printf("Mismatch at %d: got %d, want %d\n", i, v, src[i])
        }
    }
    // Developer then iterates to src length 5, causing index-out-of-range on dst!
    for i := 0; i < len(src); i++ {
        fmt.Println(dst[i]) // PANIC when i >= 3!
    }
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What does `copy` return? What does it do when `len(dst) < len(src)`?

</details>

<details>
<summary>Solution</summary>

**Bug:** `copy(dst, src[:])` copies `min(len(dst), len(src)) = min(3, 5) = 3` elements. The developer then iterates up to `len(src)=5`, causing index-out-of-range at `dst[3]`.

**Fix 1:** Make `dst` the same length as `src`:

```go
dst := make([]int, len(src)) // size 5
n := copy(dst, src[:]) // copies all 5
fmt.Println(n) // 5
```

**Fix 2:** Iterate only up to the copied count:

```go
for i := 0; i < n; i++ { // n = 3, not len(src)
    fmt.Println(dst[i])
}
```

**Fix 3:** Check return value of `copy`:

```go
n := copy(dst, src[:])
if n < len(src) {
    fmt.Printf("Warning: only copied %d of %d elements\n", n, len(src))
}
```

</details>

---

## Bug 11 🔴 — Stack Array Escaped, Then Corrupt Pointer

```go
package main

import (
    "fmt"
    "unsafe"
)

// This is intentionally problematic — do NOT do this!
func badGetPointer() *byte {
    var arr [16]byte
    arr[0] = 42
    // Returning &arr[0] — arr escapes to heap (Go handles this safely)
    // BUT: with unsafe, you can trick the compiler...
    ptr := uintptr(unsafe.Pointer(&arr[0]))
    // arr goes out of scope here (in real Go, this is safe due to escape analysis)
    // BUT: if we return the raw uintptr (NOT unsafe.Pointer), GC may collect arr!
    return (*byte)(unsafe.Pointer(ptr)) // DANGEROUS: GC may have moved/collected arr!
}

func main() {
    p := badGetPointer()
    // p may or may not be valid depending on GC
    fmt.Println(*p) // could print 42 or garbage or panic
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What happens when you store a pointer as `uintptr` and then convert back? Does the GC track `uintptr` values?

</details>

<details>
<summary>Solution</summary>

**Bug:** Converting a pointer to `uintptr` and back is unsafe because the GC does not track `uintptr` values as GC roots. Between the conversion to `uintptr` and back to `unsafe.Pointer`, the GC may move or collect the object. This leads to a dangling pointer.

Go's escape analysis normally promotes `arr` to the heap when its address escapes, preventing the immediate issue — but using `uintptr` breaks the GC's tracking.

**Fix:** Never convert a live pointer to `uintptr` and back:

```go
// SAFE: use unsafe.Pointer directly (GC tracks it)
func safeGetPointer() *byte {
    arr := new([16]byte) // heap allocated
    arr[0] = 42
    return &arr[0] // safe: arr is heap-allocated, GC tracks it
}

// Or more naturally:
func safest() []byte {
    arr := make([]byte, 16)
    arr[0] = 42
    return arr // slice, GC-tracked
}
```

</details>

---

## Bug 12 🔴 — Wrong Segment Sizes in Parallel Processing

```go
package main

import (
    "fmt"
    "sync"
)

func processParallel(arr *[12]int) {
    var wg sync.WaitGroup
    workers := 4
    segSize := len(*arr) / workers // 12/4 = 3

    for w := 0; w < workers; w++ {
        start := w * segSize
        end := start + segSize
        wg.Add(1)

        // BUG: last worker may exceed array bounds!
        go func(s []int, id int) {
            defer wg.Done()
            for i := range s {
                s[i] = id * 100
            }
        }((*arr)[start:end], w) // what if arr len isn't divisible?
    }

    wg.Wait()
}

func main() {
    // Works for 12 elements, 4 workers (12/4=3 exactly)
    var arr [12]int
    processParallel(&arr)
    fmt.Println(arr)

    // But what if we had [13]int? Would break (13/4=3, last worker gets 3,
    // missing the 13th element, or if end > len would panic)
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What happens when array length is not evenly divisible by the number of workers? How does the last segment get calculated?

</details>

<details>
<summary>Solution</summary>

**Bug:** When `len(arr)` is not divisible by `workers`, some elements are skipped (if `end` is always `start + segSize`) or the last worker panics (if `end > len(arr)`). The code only works by coincidence for `[12]int` (12/4=3 exactly).

**Fix:** Handle the last segment specially:

```go
func processParallel(arr []int, workers int) {
    var wg sync.WaitGroup
    n := len(arr)
    segSize := (n + workers - 1) / workers // ceiling division

    for w := 0; w < workers; w++ {
        start := w * segSize
        if start >= n { break }
        end := start + segSize
        if end > n { end = n } // clamp last segment

        wg.Add(1)
        go func(s []int, id int) {
            defer wg.Done()
            for i := range s {
                s[i] = id * 100
            }
        }(arr[start:end], w)
    }

    wg.Wait()
}
```

</details>
