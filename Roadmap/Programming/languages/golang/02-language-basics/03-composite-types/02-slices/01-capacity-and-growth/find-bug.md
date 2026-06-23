# Slice Capacity and Growth — Find the Bug

> **Format:** Each bug includes difficulty, description, buggy code, expected vs actual behavior, a hint, and a full explanation with fix.

---

## Overview

Each exercise contains a buggy Go program related to slice capacity and growth. Identify the bug, understand why it happens, and fix it. Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard.

---

## Bug 1 🟢 — Appending to a `make([]T, n)` Slice

**Title:** Extra zero elements appear in the result

**What it should do:** Build a slice containing `[10, 20, 30]`.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    s := make([]int, 3) // BUG
    s = append(s, 10)
    s = append(s, 20)
    s = append(s, 30)
    fmt.Println(s)
}
```

**Expected Output:** `[10 20 30]`
**Actual Output:** `[0 0 0 10 20 30]`

<details>
<summary>Hint</summary>
`make([]int, 3)` creates a slice with `len=3`, not `len=0`. The three slots are already filled with zeros before you append.
</details>

<details>
<summary>Bug Explanation</summary>
`make([]T, n)` sets both `len` and `cap` to `n`, filling all slots with zero values. `append` always adds elements at position `len`, so the first `append(s, 10)` puts `10` at index 3, not index 0.
</details>

<details>
<summary>Fixed Code</summary>

```go
// Option 1: use make([]T, 0, n) and append
s := make([]int, 0, 3)
s = append(s, 10)
s = append(s, 20)
s = append(s, 30)
fmt.Println(s) // [10 20 30]

// Option 2: literal
s := []int{10, 20, 30}

// Option 3: use make([]T, n) with indexing
s := make([]int, 3)
s[0], s[1], s[2] = 10, 20, 30
```
</details>

---

## Bug 2 🟢 — Re-slicing Does Not Shrink Capacity

**Title:** "Shrinking" a slice doesn't free memory

**What it should do:** After processing a large dataset, release the memory of unused elements.

**Buggy Code:**
```go
package main

import "fmt"

func processAndShrink(data []int) []int {
    // ... process ...
    return data[:10] // BUG: "shrink" to first 10 elements
}

func main() {
    big := make([]int, 1_000_000)
    small := processAndShrink(big)

    fmt.Println(len(small), cap(small))
    // Expected: 10 10 (memory freed)
    // Actual:   10 1000000 (still holds full array!)
}
```

<details>
<summary>Hint</summary>
`data[:10]` sets `len=10` but `cap` remains at `1,000,000`. The full backing array is still referenced by the returned slice.
</details>

<details>
<summary>Bug Explanation</summary>
Re-slicing only changes the visible length — it does not shrink the backing array or free memory. The returned slice still has a pointer into the million-element array, preventing GC of the other 999,990 elements.
</details>

<details>
<summary>Fixed Code</summary>

```go
func processAndShrink(data []int) []int {
    result := make([]int, 10)
    copy(result, data[:10])
    return result
    // cap(result) == 10, original 1M array can now be GC'd
}
```
</details>

---

## Bug 3 🟢 — Capacity Check Allows Over-Allocation

**Title:** Budget check uses `cap` instead of `len`; elements exceed the budget

**What it should do:** Stop adding elements when we reach `budget` elements.

**Buggy Code:**
```go
package main

import (
    "errors"
    "fmt"
)

var ErrOverBudget = errors.New("over budget")

func appendSafe(s []int, v int, budget int) ([]int, error) {
    if cap(s) > budget { // BUG: checks cap, not len
        return s, ErrOverBudget
    }
    return append(s, v), nil
}

func main() {
    s := make([]int, 0, 10)
    var err error
    for i := 0; i < 15; i++ {
        s, err = appendSafe(s, i, 10)
        if err != nil {
            fmt.Printf("stopped at i=%d\n", i)
            break
        }
    }
    fmt.Println("len:", len(s))
    // Expected: stopped at i=10, len=10
    // Actual: never stops — cap(s) starts at 10 which is NOT > 10
}
```

<details>
<summary>Bug Explanation</summary>
`cap(s) > budget` checks whether the backing array is larger than `budget`, not whether we have more than `budget` elements. Since `cap` starts at 10 (equal to budget, not greater), the check is `10 > 10` which is always false. The function appends past the budget. When `len` exceeds `cap=10`, `append` reallocates to `cap=20`, and now `20 > 10` is true — but by then we've already exceeded the budget.
</details>

<details>
<summary>Fixed Code</summary>

```go
func appendSafe(s []int, v int, budget int) ([]int, error) {
    if len(s) >= budget { // check elements count, not backing array size
        return s, ErrOverBudget
    }
    return append(s, v), nil
}
```
</details>

---

## Bug 4 🟢 — Pre-allocated Buffer Is Never Used

**Title:** Capacity hint from helper function is wasted

**What it should do:** Use the pre-allocated buffer returned by `getBuffer`.

**Buggy Code:**
```go
package main

import "fmt"

func getBuffer(n int) []int {
    return make([]int, 0, n)
}

func main() {
    buf := getBuffer(1000)
    _ = buf // BUG: buf is ignored

    var results []int // starts at zero capacity!
    for i := 0; i < 1000; i++ {
        results = append(results, i)
    }
    fmt.Println(len(results))
}
```

**Expected:** 1 allocation (buf was pre-allocated)
**Actual:** ~10 allocations (buf was wasted, results grows organically)

<details>
<summary>Fixed Code</summary>

```go
func main() {
    results := getBuffer(1000) // USE the pre-allocated buffer
    for i := 0; i < 1000; i++ {
        results = append(results, i)
    }
    fmt.Println(len(results)) // 1000, only 1 allocation
}
```
</details>

---

## Bug 5 🟡 — Sibling Slices Sharing Backing Array

**Title:** Two slices from the same base overwrite each other

**What it should do:** `evens` should be `[0 2 4]` and `odds` should be `[1 3 5]`, independent.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    base := make([]int, 0, 6)

    evens := base // BUG: cap=6 shared
    odds := base  // BUG: cap=6 shared

    evens = append(evens, 0, 2, 4) // writes to base[0..2]
    odds = append(odds, 1, 3, 5)   // overwrites base[0..2]!

    fmt.Println("evens:", evens)
    fmt.Println("odds:", odds)
}
```

**Expected:**
```
evens: [0 2 4]
odds: [1 3 5]
```
**Actual:**
```
evens: [1 3 5]
odds: [1 3 5]
```

<details>
<summary>Hint</summary>
Both `evens` and `odds` are copies of `base`, which has `cap=6`. Both point to the same backing array. Appending 3 elements to `evens` fills positions 0-2. Appending to `odds` also fills positions 0-2 of the same array.
</details>

<details>
<summary>Bug Explanation</summary>
Assigning a slice copies the header (pointer, len, cap). Both `evens` and `odds` point to the same backing array. Appending 3 elements to either fills positions 0, 1, 2 of the same memory. The second `append` overwrites the first.
</details>

<details>
<summary>Fixed Code</summary>

```go
// Option 1: allocate independently
evens := make([]int, 0, 3)
odds := make([]int, 0, 3)

// Option 2: cap the capacity to 0 so first append forces new allocation
evens := base[:0:0]
odds := base[:0:0]

evens = append(evens, 0, 2, 4) // new backing array
odds = append(odds, 1, 3, 5)   // new backing array
```
</details>

---

## Bug 6 🟡 — Three-Index Cap Exceeds Intended Limit

**Title:** Sub-slice can still overwrite parent data despite three-index slicing

**What it should do:** Create a sub-slice where `cap == len == 5`, preventing writes to parent.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    base := make([]int, 10)
    for i := range base {
        base[i] = i + 1
    }

    sub := base[0:5:10] // BUG: max=10, not max=5
    fmt.Println(len(sub), cap(sub)) // 5 10 — cap should be 5!

    sub = append(sub, 99) // writes to base[5]!
    fmt.Println(base[5])  // 99 — base corrupted
}
```

<details>
<summary>Bug Explanation</summary>
`base[0:5:10]` creates a sub-slice with `len=5` and `cap=10-0=10`. The programmer intended to limit capacity to 5 (same as len), but used `max=10` instead of `max=5`. With `cap=10`, `append` writes into `base[5]` without allocating a new array.
</details>

<details>
<summary>Fixed Code</summary>

```go
sub := base[0:5:5] // max=5 → cap=5-0=5
fmt.Println(len(sub), cap(sub)) // 5 5

sub = append(sub, 99) // cap exceeded → new backing array allocated
fmt.Println(base[5])  // still 6 — base unchanged
```
</details>

---

## Bug 7 🟡 — sync.Pool Buffer Not Updated After Reallocation

**Title:** Pool stores stale small buffer after growth event; capacity gain is lost

**What it should do:** Return the latest (possibly larger) buffer to the pool after use.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "sync"
)

var pool = sync.Pool{
    New: func() any {
        s := make([]byte, 0, 64)
        return &s
    },
}

func process(data []byte) []byte {
    pBuf := pool.Get().(*[]byte)
    buf := (*pBuf)[:0]

    buf = append(buf, data...)
    result := make([]byte, len(buf))
    copy(result, buf)

    // BUG: pBuf not updated after potential reallocation
    pool.Put(pBuf)
    return result
}

func main() {
    process(make([]byte, 500)) // buf reallocated from 64 to 512+ bytes

    // Pool still holds 64-byte buffer, not the 512-byte one!
    pBuf := pool.Get().(*[]byte)
    fmt.Println("pool buf cap:", cap(*pBuf)) // 64, not 512
}
```

<details>
<summary>Hint</summary>
After `buf = append(buf, data...)`, `buf` may point to a new backing array. But `pBuf` still holds the address of the old slice header (pointing to the old small array). The pool receives the stale pointer.
</details>

<details>
<summary>Bug Explanation</summary>
When `append` reallocates, it returns a new `[]byte` value with a different pointer. The local `buf` is updated, but `*pBuf` is not. `pool.Put(pBuf)` returns the old 64-byte backing array. The new larger array becomes garbage. Future `Get()` calls receive the old small buffer.
</details>

<details>
<summary>Fixed Code</summary>

```go
func process(data []byte) []byte {
    pBuf := pool.Get().(*[]byte)
    buf := (*pBuf)[:0]

    buf = append(buf, data...)
    result := make([]byte, len(buf))
    copy(result, buf)

    *pBuf = buf // CRITICAL: sync pool pointer to latest slice header
    pool.Put(pBuf)
    return result
}
```
</details>

---

## Bug 8 🟡 — Growing Slice Invalidates Stored Pointer

**Title:** Pointer to first element becomes stale after reallocation

**What it should do:** Keep a stable reference to `s[0]` while the slice grows.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    s := make([]int, 1, 4)
    s[0] = 100

    firstPtr := &s[0] // pointer to backing array address

    for i := 0; i < 10; i++ {
        s = append(s, i) // reallocates when len exceeds 4
    }

    // After reallocation, s[0] is at a NEW address
    // firstPtr points to the OLD address (old backing array)
    fmt.Println("via ptr:", *firstPtr) // reads old backing array — may be stale
    fmt.Println("via idx:", s[0])      // reads new backing array — correct
}
```

<details>
<summary>Bug Explanation</summary>
`&s[0]` captures the memory address of the first element in the current backing array. When `append` reallocates (after 4 elements), a new backing array is created and elements are copied. `s[0]` now lives at a new address. `firstPtr` still points to the old backing array. In Go, the GC will NOT collect memory while a pointer exists, so reading `*firstPtr` is safe (not undefined behavior), but it reads from the OLD backing array — the value may differ from `s[0]` if the element was modified after reallocation.
</details>

<details>
<summary>Fixed Code</summary>

```go
func main() {
    s := make([]int, 1, 4)
    s[0] = 100

    // Store the INDEX, not a pointer — safe across reallocations
    firstIdx := 0

    for i := 0; i < 10; i++ {
        s = append(s, i)
    }

    fmt.Println("via idx:", s[firstIdx]) // always correct: 100
}
```
</details>

---

## Bug 9 🔴 — Concurrent Append on Pre-allocated Slice

**Title:** Parallel appends lose writes even with sufficient capacity

**What it should do:** Fill 100-element slice from 4 goroutines; final slice has exactly 100 elements.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "sync"
)

func parallelFill(n int) []int {
    result := make([]int, 0, n) // cap=n but len=0!
    var wg sync.WaitGroup
    chunkSize := n / 4

    for g := 0; g < 4; g++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for i := id * chunkSize; i < (id+1)*chunkSize; i++ {
                result = append(result, i) // BUG: data race on result header!
            }
        }(g)
    }
    wg.Wait()
    return result
}

func main() {
    r := parallelFill(100)
    fmt.Println("len:", len(r)) // expected 100, gets less
}
```

<details>
<summary>Bug Explanation</summary>
`append` is a multi-step operation: (1) read `len`, (2) write element at `result[len]`, (3) update `len`. These steps are not atomic. Multiple goroutines reading the same `len=0`, all writing to index 0, all setting `len=1`. Even though `cap=n` prevents backing array reallocation, the writes step on each other.
</details>

<details>
<summary>Fixed Code</summary>

```go
// Use make([]int, n) with distinct index ranges — safe because indices don't overlap
func parallelFill(n int) []int {
    result := make([]int, n) // len=n, pre-zeroed
    var wg sync.WaitGroup
    chunkSize := n / 4

    for g := 0; g < 4; g++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for i := id * chunkSize; i < (id+1)*chunkSize; i++ {
                result[i] = i // safe: each goroutine owns its range
            }
        }(g)
    }
    wg.Wait()
    return result
}
```
</details>

---

## Bug 10 🔴 — Reset Causes Unbounded Memory Growth After Spike

**Title:** Service memory never decreases after a traffic spike

**What it should do:** After each batch, reset the pipeline buffer without permanently retaining spike allocations.

**Buggy Code:**
```go
package main

import "fmt"

type Pipeline struct {
    buf []byte
}

func (p *Pipeline) Process(data []byte) {
    p.buf = append(p.buf[:0], data...)
}

func (p *Pipeline) Reset() {
    p.buf = p.buf[:0] // BUG: keeps backing array regardless of size
}

func simulateSpike(p *Pipeline) {
    // Normal operation: 1KB batches
    for i := 0; i < 100; i++ {
        p.Process(make([]byte, 1024))
        p.Reset()
    }
    fmt.Printf("After normal: cap=%d\n", cap(p.buf))

    // One spike: 100MB batch
    p.Process(make([]byte, 100*1024*1024))
    p.Reset()

    // Back to normal: but 100MB is still retained!
    for i := 0; i < 100; i++ {
        p.Process(make([]byte, 1024))
        p.Reset()
    }
    fmt.Printf("After spike+normal: cap=%d\n", cap(p.buf)) // still 100MB!
}

func main() {
    p := &Pipeline{}
    simulateSpike(p)
}
```

<details>
<summary>Bug Explanation</summary>
`p.buf = p.buf[:0]` sets `len=0` but `cap` remains at whatever it grew to. After the 100MB spike, `cap(p.buf) == 104,857,600`. Every subsequent `Reset()` keeps that 100MB backing array alive in the heap, even though normal batches only need 1KB. This is a permanent memory retention bug.
</details>

<details>
<summary>Fixed Code</summary>

```go
const maxReusableCap = 10 * 1024 * 1024 // 10MB threshold

func (p *Pipeline) Reset() {
    if cap(p.buf) > maxReusableCap {
        p.buf = nil // release oversized backing array
    } else {
        p.buf = p.buf[:0] // reuse normal-sized backing array
    }
}
```

This pattern: reuse small backing arrays (performance) but release large spike allocations (memory safety). The threshold is application-specific.
</details>

---

## Bug 11 🔴 — Accessing Beyond `len` via Capacity Re-slice

**Title:** Test code reads uninitialized memory by re-slicing to `cap`

**What it should do:** Verify that a filter function produces clean output.

**Buggy Code:**
```go
package main

import "fmt"

func filterOdd(nums []int) []int {
    result := make([]int, 0, len(nums))
    for _, n := range nums {
        if n%2 != 0 {
            result = append(result, n)
        }
    }
    return result
}

func isClean(result []int) bool {
    // BUG: re-slice to cap to check for "garbage"
    extended := result[:cap(result)]
    for _, v := range extended {
        if v != 0 {
            return false
        }
    }
    return true
}

func main() {
    filtered := filterOdd([]int{1, 2, 3, 4, 5})
    fmt.Println(filtered)                  // [1 3 5]
    fmt.Println("clean:", isClean(filtered)) // false — reads into backing array positions 3,4
}
```

<details>
<summary>Bug Explanation</summary>
`result[:cap(result)]` extends the slice to its full backing array. Positions 3 and 4 contain the values `4` and `2` from the original `make` (wait — actually `make` zeros memory, so they are 0). But if the backing array were reused from a pool, those positions could contain arbitrary data. More importantly, accessing beyond `len` violates the slice contract — those elements are not "part of" the slice. This creates hard-to-debug failures when combined with pooling.

The values 1, 3, 5 appear at indices 0, 1, 2 of the backing array — so `isClean` returns `false` because it finds non-zero values at those positions.
</details>

<details>
<summary>Fixed Code</summary>

```go
func isClean(result []int) bool {
    // CORRECT: only inspect visible elements (within len, not cap)
    for i, v := range result {
        if v <= 0 || v%2 == 0 {
            return false // check actual logic, not backing array
        }
        _ = i
    }
    return true
}
// Never re-slice to cap — only work within len
```
</details>

---

## Bug 12 🔴 — Estimating Capacity From Wrong Variable

**Title:** Pre-allocation uses the wrong size and grows anyway

**What it should do:** Pre-allocate `results` based on the number of input items, not a constant.

**Buggy Code:**
```go
package main

import "fmt"

func transform(items []string) []int {
    const defaultCap = 10 // BUG: constant cap, not len(items)
    results := make([]int, 0, defaultCap)

    for _, s := range items {
        results = append(results, len(s)) // store string length
    }
    return results
}

func main() {
    items := make([]string, 1000)
    for i := range items {
        items[i] = fmt.Sprintf("item-%d", i)
    }

    r := transform(items)
    fmt.Println(len(r), cap(r))
    // Expected: 1000 elements, 1 allocation
    // Actual: 1000 elements, ~8 allocations (defaultCap=10 is too small)
}
```

<details>
<summary>Bug Explanation</summary>
`defaultCap = 10` is always 10, regardless of input size. For 1000 items, the slice starts at cap=10 and grows ~8 times: 10→20→40→80→160→320→640→1280. Each growth event allocates memory and copies elements. The fix is to use `len(items)` as the capacity hint.
</details>

<details>
<summary>Fixed Code</summary>

```go
func transform(items []string) []int {
    results := make([]int, 0, len(items)) // dynamic, based on actual input size
    for _, s := range items {
        results = append(results, len(s))
    }
    return results
}
```
</details>
