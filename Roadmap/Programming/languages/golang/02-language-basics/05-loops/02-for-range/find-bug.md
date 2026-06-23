# for range — Find the Bug

Each section contains buggy Go code. Try to identify the bug before opening the solution.

---

## Bug 1 🟢 — Modifying the Value Variable

```go
package main

import "fmt"

func double(s []int) {
    for _, v := range s {
        v *= 2
    }
}

func main() {
    nums := []int{1, 2, 3}
    double(nums)
    fmt.Println(nums) // expected [2 4 6]
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

`v` is a copy of each element. Modifying `v` does not affect the original slice.

**Fix:**
```go
func double(s []int) {
    for i := range s {
        s[i] *= 2
    }
}
```

Output is now `[2 4 6]`.
</details>

---

## Bug 2 🟢 — Map Iteration Order Assumed

```go
package main

import "fmt"

func main() {
    m := map[string]int{"c": 3, "a": 1, "b": 2}
    result := []string{}
    for k := range m {
        result = append(result, k)
    }
    fmt.Println(result) // expected ["a", "b", "c"]
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

Map iteration in Go is deliberately randomized. The output may be `[c a b]`, `[b c a]`, or any permutation.

**Fix (if sorted order is needed):**
```go
import "sort"

for k := range m {
    result = append(result, k)
}
sort.Strings(result)
fmt.Println(result) // always ["a", "b", "c"]
```
</details>

---

## Bug 3 🟢 — Range over Array (Copies Entire Array)

```go
package main

import "fmt"

func sumArray(arr [1000000]int) int {
    sum := 0
    for _, v := range arr {
        sum += v
    }
    return sum
}

func main() {
    var big [1000000]int
    for i := range big { big[i] = i }
    fmt.Println(sumArray(big))
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

The array `arr` is passed **by value** to `sumArray`, which copies 8MB on the stack/heap. Then `for range arr` copies it AGAIN (range expression captures the array).

**Fix:** Pass a slice (or pointer to array):
```go
func sumArray(arr []int) int { // accepts a slice
    sum := 0
    for _, v := range arr {
        sum += v
    }
    return sum
}
// Call: sumArray(big[:])
```
</details>

---

## Bug 4 🟡 — Closure Capture in Goroutines

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    results := make([]int, 5)

    for i, v := range []int{1, 2, 3, 4, 5} {
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = v * 2
        }()
    }
    wg.Wait()
    fmt.Println(results)
}
```

**What is wrong?** (Pre-Go 1.22)

<details>
<summary>Solution</summary>

Both `i` and `v` are captured by reference in the goroutine closure. By the time goroutines execute, the loop may have finished, so `i` and `v` hold the last iteration's values (4 and 5). All goroutines write to `results[4] = 10`.

**Fix:**
```go
for i, v := range []int{1, 2, 3, 4, 5} {
    i, v := i, v // per-iteration copies
    wg.Add(1)
    go func() {
        defer wg.Done()
        results[i] = v * 2
    }()
}
// In Go 1.22+: bug is automatically fixed by per-iteration variable semantics
```
</details>

---

## Bug 5 🟡 — Defer in Loop

```go
package main

import (
    "fmt"
    "os"
)

func processAll(filenames []string) error {
    for _, name := range filenames {
        f, err := os.Open(name)
        if err != nil {
            return err
        }
        defer f.Close() // intended to close after each file
        data := make([]byte, 1024)
        f.Read(data)
        fmt.Println(string(data))
    }
    return nil
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

`defer f.Close()` does NOT run at the end of each loop iteration. All defers run when `processAll` returns. If `filenames` is large, you'll have many open file descriptors, potentially exhausting the OS limit.

**Fix:**
```go
func processAll(filenames []string) error {
    for _, name := range filenames {
        if err := processFile(name); err != nil {
            return err
        }
    }
    return nil
}

func processFile(name string) error {
    f, err := os.Open(name)
    if err != nil {
        return err
    }
    defer f.Close() // runs when processFile returns — correct!
    data := make([]byte, 1024)
    f.Read(data)
    fmt.Println(string(data))
    return nil
}
```
</details>

---

## Bug 6 🟡 — String Index vs Rune Index

```go
package main

import "fmt"

func getNthChar(s string, n int) string {
    return string(s[n]) // get the nth character
}

func main() {
    s := "Hello, 世界"
    fmt.Println(getNthChar(s, 7)) // expected: 世
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

`s[7]` returns the **byte** at position 7, not the 7th character. For the string `"Hello, 世界"`, byte 7 is the second byte of `世` (0xb8), not a valid character boundary.

**Fix:**
```go
func getNthChar(s string, n int) string {
    runes := []rune(s)
    if n >= len(runes) { return "" }
    return string(runes[n])
}
// getNthChar("Hello, 世界", 7) returns "世"
```
</details>

---

## Bug 7 🟡 — Concurrent Map Write During Range

```go
package main

import (
    "fmt"
    "sync"
)

var cache = map[string]int{}

func readCache(wg *sync.WaitGroup) {
    defer wg.Done()
    for k, v := range cache {
        fmt.Println(k, v)
    }
}

func writeCache(wg *sync.WaitGroup, key string, val int) {
    defer wg.Done()
    cache[key] = val
}

func main() {
    var wg sync.WaitGroup
    cache["a"] = 1
    cache["b"] = 2

    wg.Add(2)
    go readCache(&wg)
    go writeCache(&wg, "c", 3)
    wg.Wait()
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

Concurrent map read (range) and write causes a fatal runtime panic: `concurrent map iteration and map write`. Go's map is not goroutine-safe.

**Fix:**
```go
var mu sync.RWMutex
var cache = map[string]int{}

func readCache(wg *sync.WaitGroup) {
    defer wg.Done()
    mu.RLock()
    defer mu.RUnlock()
    for k, v := range cache {
        fmt.Println(k, v)
    }
}

func writeCache(wg *sync.WaitGroup, key string, val int) {
    defer wg.Done()
    mu.Lock()
    defer mu.Unlock()
    cache[key] = val
}
```
</details>

---

## Bug 8 🔴 — Pointer to Range Variable

```go
package main

import "fmt"

func getPtrs(s []int) []*int {
    ptrs := make([]*int, len(s))
    for i, v := range s {
        ptrs[i] = &v // store pointer to range variable
    }
    return ptrs
}

func main() {
    ptrs := getPtrs([]int{10, 20, 30})
    for _, p := range ptrs {
        fmt.Println(*p) // expected: 10, 20, 30
    }
}
```

**What is wrong?** (Pre-Go 1.22)

<details>
<summary>Solution</summary>

In pre-Go 1.22, `v` is a single variable reused each iteration. All `ptrs[i]` point to the SAME variable `v`, which holds `30` (the last value) after the loop ends. Output: `30 30 30`.

**Fix:**
```go
func getPtrs(s []int) []*int {
    ptrs := make([]*int, len(s))
    for i, v := range s {
        v := v // create new variable per iteration
        ptrs[i] = &v
    }
    return ptrs
}
// Or store address of original elements:
func getPtrs(s []int) []*int {
    ptrs := make([]*int, len(s))
    for i := range s {
        ptrs[i] = &s[i] // address of actual slice element
    }
    return ptrs
}
```

In Go 1.22+, `&v` automatically captures a per-iteration copy, so the original code works.
</details>

---

## Bug 9 🔴 — Modifying Map During Range (Adding Keys)

```go
package main

import "fmt"

func expandMap(m map[int]int) {
    for k, v := range m {
        m[k*10] = v * 10 // add derived keys
    }
}

func main() {
    m := map[int]int{1: 1, 2: 2, 3: 3}
    expandMap(m)
    fmt.Println(m) // expected: {1:1, 2:2, 3:3, 10:10, 20:20, 30:30}
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

When you add keys to a map during range iteration, the Go spec says the new keys may or may not be iterated. The function is also likely to iterate the newly added keys (like 10, 20, 30) and add 100, 200, 300, causing an unbounded expansion or at least unpredictable behavior.

**Fix:** Collect new entries first, then add them:
```go
func expandMap(m map[int]int) {
    toAdd := map[int]int{}
    for k, v := range m {
        toAdd[k*10] = v * 10
    }
    for k, v := range toAdd {
        m[k] = v
    }
}
```
</details>

---

## Bug 10 🔴 — Channel Range Without Close

```go
package main

import "fmt"

func producer(ch chan<- int, n int) {
    for i := 0; i < n; i++ {
        ch <- i
    }
    // forgot to close(ch)
}

func main() {
    ch := make(chan int, 10)
    go producer(ch, 5)

    for v := range ch { // blocks forever after receiving 5 values
        fmt.Println(v)
    }
    fmt.Println("done") // never reached
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

`for range` over a channel exits ONLY when the channel is closed. Without `close(ch)`, the range loop blocks forever after receiving all 5 values, causing a goroutine leak (or deadlock if the receiver is main).

**Fix:**
```go
func producer(ch chan<- int, n int) {
    for i := 0; i < n; i++ {
        ch <- i
    }
    close(ch) // MUST close to signal completion to range
}
```
</details>

---

## Bug 11 🔴 — Range Over Interface Slice with Type Mutation

```go
package main

import "fmt"

type Counter struct {
    Count int
}

func incrementAll(items []interface{}) {
    for _, item := range items {
        if c, ok := item.(*Counter); ok {
            c.Count++
        }
    }
}

func main() {
    c1 := Counter{Count: 1}
    c2 := Counter{Count: 2}
    items := []interface{}{c1, c2} // storing VALUES, not pointers

    incrementAll(items)
    fmt.Println(c1.Count) // expected 2, but prints 1
    fmt.Println(c2.Count) // expected 3, but prints 2
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

`items` stores `Counter` values (not pointers). When stored as `interface{}`, the type assertion `item.(*Counter)` fails because the interface holds a `Counter` value, not `*Counter`. The `ok` check is false, nothing is incremented.

**Fix:** Store pointers:
```go
items := []interface{}{&c1, &c2} // store pointers

// Now item.(*Counter) succeeds and c.Count++ modifies c1/c2
```
</details>

---

## Bug 12 🔴 — Rune Index vs Byte Index in Slice Operation

```go
package main

import "fmt"

func firstN(s string, n int) string {
    count := 0
    for i := range s {
        if count == n {
            return s[:i] // take bytes up to byte position i
        }
        count++
    }
    return s
}

func main() {
    fmt.Println(firstN("Hello, 世界", 7)) // expected first 7 runes: "Hello, "
}
```

**What is wrong?**

<details>
<summary>Solution</summary>

The logic is actually almost correct here but consider: when `count == n`, `i` is the **byte index** of the n-th rune. `s[:i]` correctly returns the first n characters as bytes. However, the off-by-one: when count reaches n, the loop has already advanced `i` to the start of the (n+1)-th rune, so `s[:i]` is correct.

But there IS a subtle bug: if `n >= len([]rune(s))`, the function returns `s` (full string) without checking. More critically:

```go
firstN("Hello, 世界", 7) // "Hello, " — this works
firstN("Hello, 世界", 8) // "Hello, 世" — this works
firstN("Hello, 世界", 9) // returns s (full) instead of "Hello, 世界" — correct
```

Actually the real bug is that this function incorrectly skips rune count — the `count` variable increments AFTER checking, so when `count == n`, we are at the byte start of the (n+1)-th rune. This is **correct behavior by accident** for this logic. A cleaner and safer approach:

```go
func firstN(s string, n int) string {
    runes := []rune(s)
    if n > len(runes) { n = len(runes) }
    return string(runes[:n])
}
```
</details>
