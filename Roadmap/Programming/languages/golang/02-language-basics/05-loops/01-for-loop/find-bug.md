# Go for Loop (C-style) — Find the Bug

## Instructions

Each exercise contains buggy Go code related to `for` loops. Identify the bug, explain why it occurs, and provide the corrected code. Difficulty levels: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Off-by-One: Out of Bounds

```go
package main

import "fmt"

func main() {
    s := []int{10, 20, 30, 40, 50}
    for i := 0; i <= len(s); i++ {
        fmt.Println(s[i])
    }
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What is the valid range of indices for a slice of length 5? What happens when `i == len(s)`?
</details>

<details>
<summary>Solution</summary>

**Bug**: `i <= len(s)` allows `i` to reach `len(s)` (which is 5 for a 5-element slice). Valid indices are `0` to `len(s)-1` = 0 to 4. When `i == 5`, `s[5]` is an out-of-bounds access — **panic: runtime error: index out of range [5] with length 5**.

**Fix**:
```go
for i := 0; i < len(s); i++ {  // < instead of <=
    fmt.Println(s[i])
}
```

**Key lesson**: For a slice of length n, valid indices are `0..n-1`. Use `i < len(s)`, never `i <= len(s)`.
</details>

---

## Bug 2 🟢 — Infinite Loop: Forgotten Post Statement

```go
package main

import "fmt"

func main() {
    sum := 0
    for i := 0; i < 100; {  // BUG: no post statement
        sum += i
    }
    fmt.Println(sum)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What value does `i` have on every iteration? Does the condition `i < 100` ever become false?
</details>

<details>
<summary>Solution</summary>

**Bug**: The for loop has no post statement and `i` is never incremented inside the body either. `i` stays at 0 forever, `0 < 100` is always true, and the loop never terminates.

**Fix**:
```go
sum := 0
for i := 0; i < 100; i++ {  // add i++
    sum += i
}
fmt.Println(sum)

// Or increment in body:
sum = 0
for i := 0; i < 100; {
    sum += i
    i++  // must be inside body
}
```

**Key lesson**: Always verify that the loop condition will eventually become false.
</details>

---

## Bug 3 🟢 — Goroutine Captures Loop Variable by Reference

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i)  // BUG: captures &i
        }()
    }
    wg.Wait()
}
// Expected: 0 1 2 3 4 (in any order)
// Actual: likely 5 5 5 5 5
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does the closure capture — the value of `i` or a reference to `i`? What is the value of `i` when the goroutines actually run?
</details>

<details>
<summary>Solution</summary>

**Bug**: The goroutine closure captures the variable `i` by reference (address). By the time the goroutines run, the main loop has finished and `i` equals 5. All goroutines read the same variable and print 5.

**Fix 1** — Pass `i` as an argument:
```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {  // i is a parameter — new variable per call
        defer wg.Done()
        fmt.Println(i)
    }(i)  // pass current value of i
}
```

**Fix 2** — Shadow with a new variable:
```go
for i := 0; i < 5; i++ {
    i := i  // new variable, scoped to iteration
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println(i)
    }()
}
```

**Key lesson**: Always pass loop variables explicitly to goroutines. Never rely on closure capture in C-style for loops.
</details>

---

## Bug 4 🟢 — break Exits Switch, Not For Loop

```go
package main

import "fmt"

func findTarget(s []int, target int) {
    for i := 0; i < len(s); i++ {
        switch {
        case s[i] == target:
            fmt.Printf("Found %d at index %d\n", target, i)
            break  // intention: stop searching
        case s[i] > target:
            fmt.Println("Passed target")
            break
        }
    }
}

func main() {
    findTarget([]int{1, 3, 5, 7, 9}, 5)
    // Expected: finds at index 2, stops
    // Actual: continues searching after finding
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does `break` exit when it is inside a `switch` that is inside a `for` loop?
</details>

<details>
<summary>Solution</summary>

**Bug**: `break` inside a `switch` exits only the `switch`, not the enclosing `for` loop. The loop continues after the switch, processing all remaining elements.

**Fix** — Use labeled break:
```go
func findTarget(s []int, target int) {
loop:
    for i := 0; i < len(s); i++ {
        switch {
        case s[i] == target:
            fmt.Printf("Found %d at index %d\n", target, i)
            break loop  // exits the for loop
        case s[i] > target:
            fmt.Println("Passed target — not in slice")
            break loop
        }
    }
}
```

**Alternative** — Use `return` if in a function:
```go
func findTarget(s []int, target int) int {
    for i := 0; i < len(s); i++ {
        if s[i] == target {
            fmt.Printf("Found at index %d\n", i)
            return i
        }
    }
    return -1
}
```
</details>

---

## Bug 5 🟡 — Unsigned Integer Underflow in Countdown

```go
package main

import "fmt"

func countdown(n uint) {
    for i := n; i >= 0; i-- {
        fmt.Println(i)
    }
}

func main() {
    countdown(5)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What happens to an unsigned integer when you subtract 1 from 0? Can `uint` ever be negative?
</details>

<details>
<summary>Solution</summary>

**Bug**: `uint` is an unsigned integer — it can never be negative. When `i == 0` and `i--` runs, `i` wraps around to the maximum `uint` value (~1.8×10¹⁹ on 64-bit). The condition `i >= 0` is always true for unsigned integers. This creates an infinite loop.

**Fix 1** — Use `int`:
```go
func countdown(n int) {
    for i := n; i >= 0; i-- {
        fmt.Println(i)
    }
}
```

**Fix 2** — Restructure to avoid the underflow:
```go
func countdown(n uint) {
    for i := n + 1; i > 0; i-- {
        fmt.Println(i - 1)  // print i-1 to show 0
    }
}

// Or use a different loop form:
func countdown(n uint) {
    i := n
    for {
        fmt.Println(i)
        if i == 0 { break }
        i--
    }
}
```

**Key lesson**: Never use unsigned integers for loop counters that count down to 0. Use `int`.
</details>

---

## Bug 6 🟡 — Modifying Slice Length While Iterating

```go
package main

import "fmt"

func removeNegatives(s []int) []int {
    for i := 0; i < len(s); i++ {
        if s[i] < 0 {
            s = append(s[:i], s[i+1:]...)
        }
    }
    return s
}

func main() {
    result := removeNegatives([]int{1, -2, -3, 4, -5, 6})
    fmt.Println(result)
    // Expected: [1 4 6]
    // Actual: [1 -3 4 6] — misses some negatives
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
When you remove element at index `i`, what happens to the elements at indices `i+1`, `i+2`, etc.? Where does the next unchecked element land?
</details>

<details>
<summary>Solution</summary>

**Bug**: When `s[i]` is removed (e.g., `s[1] = -2`), all elements shift left by one. The element that was at `s[i+1]` (e.g., `-3`) is now at `s[i]`. But then `i++` runs, and we skip `s[i]` (which is now `-3`). Result: consecutive negative numbers are missed.

**Trace**:
- i=1: s[1]=-2, remove → s=[1,-3,4,-5,6], i becomes 2
- i=2: s[2]=4 (skipped -3!), continue
- i=3: s[3]=-5, remove → s=[1,-3,4,6], i becomes 4
- i=4: out of bounds, stop
- Result: [1,-3,4,6] — missed -3

**Fix** — Don't increment `i` after removal:
```go
func removeNegatives(s []int) []int {
    for i := 0; i < len(s); {
        if s[i] < 0 {
            s = append(s[:i], s[i+1:]...)
            // Don't increment i — next element shifted to position i
        } else {
            i++
        }
    }
    return s
}
```

**Better fix** — Two-pointer in-place:
```go
func removeNegatives(s []int) []int {
    j := 0
    for i := 0; i < len(s); i++ {
        if s[i] >= 0 {
            s[j] = s[i]
            j++
        }
    }
    return s[:j]
}
```
</details>

---

## Bug 7 🟡 — Wrong Binary Search Causes Infinite Loop

```go
package main

import "fmt"

func binarySearch(s []int, target int) int {
    lo, hi := 0, len(s)-1
    for lo <= hi {
        mid := (lo + hi) / 2
        if s[mid] == target {
            return mid
        } else if s[mid] < target {
            lo = mid  // BUG: should be mid+1
        } else {
            hi = mid  // BUG: should be mid-1
        }
    }
    return -1
}

func main() {
    s := []int{1, 3, 5, 7, 9}
    fmt.Println(binarySearch(s, 6))  // hangs!
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What happens when `lo == hi == mid` and the target is not found? Do `lo` or `hi` change?
</details>

<details>
<summary>Solution</summary>

**Bug**: When `lo = mid` (not `mid+1`) and `hi = mid` (not `mid-1`), the search can get stuck in an infinite loop. For example, with `lo=2, hi=2`: `mid=2`, `s[2] < target`, so `lo = mid = 2` — nothing changes! The loop runs forever.

**Also**: `(lo+hi)/2` can overflow for large indices. Use `lo + (hi-lo)/2`.

**Fix**:
```go
func binarySearch(s []int, target int) int {
    lo, hi := 0, len(s)-1
    for lo <= hi {
        mid := lo + (hi-lo)/2  // no overflow
        if s[mid] == target {
            return mid
        } else if s[mid] < target {
            lo = mid + 1  // +1 to make progress
        } else {
            hi = mid - 1  // -1 to make progress
        }
    }
    return -1
}
```

**Key lesson**: In binary search, always use `mid+1` and `mid-1` to guarantee progress.
</details>

---

## Bug 8 🟡 — defer Inside Loop with Resource Leak

```go
package main

import (
    "fmt"
    "os"
)

func processFiles(paths []string) error {
    for i := 0; i < len(paths); i++ {
        f, err := os.Open(paths[i])
        if err != nil {
            return err
        }
        defer f.Close()  // BUG: defers accumulate until function returns

        // Process file
        data := make([]byte, 1024)
        _, err = f.Read(data)
        if err != nil {
            return err
        }
        fmt.Printf("Processed %s\n", paths[i])
    }
    return nil
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
When do `defer`ed calls execute? What happens if you open 1000 files but the deferred closes only run at the end of the function?
</details>

<details>
<summary>Solution</summary>

**Bug**: `defer f.Close()` in a loop causes all close calls to accumulate until `processFiles` returns. If `len(paths)` is large, you'll have many file descriptors open simultaneously — potentially exceeding the OS limit (typically 1024 or 4096 open files).

**Fix** — Use an inner function to scope the defer:
```go
func processFiles(paths []string) error {
    for i := 0; i < len(paths); i++ {
        err := processFile(paths[i])
        if err != nil {
            return fmt.Errorf("processing %s: %w", paths[i], err)
        }
    }
    return nil
}

func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()  // now deferred to processFile's return — file closed after each iteration

    data := make([]byte, 1024)
    if _, err = f.Read(data); err != nil {
        return err
    }
    fmt.Printf("Processed %s\n", path)
    return nil
}
```

**Alternative** — Explicit close:
```go
for i := 0; i < len(paths); i++ {
    f, err := os.Open(paths[i])
    if err != nil {
        return err
    }
    // process...
    f.Close()  // explicit close each iteration — no defer needed
}
```

**Key lesson**: Never use `defer` inside a loop for resource cleanup. Use an inner function or explicit cleanup.
</details>

---

## Bug 9 🔴 — Integer Overflow in Loop Bound

```go
package main

import (
    "fmt"
    "math"
)

func countOperations(n int32) int64 {
    var count int64
    limit := n * n  // BUG: int32 multiplication can overflow!
    for i := int32(0); i < limit; i++ {
        count++
    }
    return count
}

func main() {
    fmt.Println(countOperations(50000))
    // Expected: 2,500,000,000
    // Actual: wrong result or panic due to overflow
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What is the maximum value of `int32`? What is 50000 × 50000?
</details>

<details>
<summary>Solution</summary>

**Bug**: `n * n` where `n = int32(50000)`. `50000 × 50000 = 2,500,000,000`. The maximum `int32` value is ~2,147,483,647 (~2.1 billion). `2.5 billion > 2.1 billion` — **integer overflow**! The result wraps to a negative number, and the loop runs zero times (or a wrong number of times).

```
50000 * 50000 = 2,500,000,000
int32 max     = 2,147,483,647
overflow!     = 2,500,000,000 - 2^32 = 205,032,704 (wraps)
```

**Fix** — Use `int64` for all intermediate computations:
```go
func countOperations(n int64) int64 {
    var count int64
    limit := n * n  // int64 can hold 50000*50000 = 2.5 billion
    for i := int64(0); i < limit; i++ {
        count++
    }
    return count
}

// Or with overflow check:
func countOperations(n int32) (int64, error) {
    if n > math.Sqrt(math.MaxInt32) {
        return 0, fmt.Errorf("n=%d would overflow int32 when squared", n)
    }
    var count int64
    limit := int64(n) * int64(n)  // widen before multiply
    for i := int64(0); i < limit; i++ {
        count++
    }
    return count, nil
}
```

**Key lesson**: Always use `int` (platform-native) or `int64` for loop bounds. Never use `int32` for values that may be squared or multiplied.
</details>

---

## Bug 10 🔴 — Race Condition in Concurrent Loop

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var mu sync.Mutex
    results := make([]int, 0)
    var wg sync.WaitGroup

    data := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

    for i := 0; i < len(data); i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            result := data[i] * data[i]  // compute
            mu.Lock()
            results = append(results, result)
            mu.Unlock()
        }(i)
    }

    wg.Wait()
    // BUG: sorting issue — results are in random order
    // More subtle BUG: data[i] read while loop continues changing i
    fmt.Println(results)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Is `data[i]` safe to read inside the goroutine? Is `i` captured correctly? What about `results`?
</details>

<details>
<summary>Solution</summary>

**Bug 1**: `data[i]` inside the goroutine — `i` is passed correctly as a function argument, so `data[i]` uses the correct index. This is actually OK.

**Bug 2**: The results are written in non-deterministic order. If the caller expects `results[j]` to correspond to `data[j]^2`, this is wrong because goroutines append in arbitrary order.

**Bug 3**: If `data` is a large shared slice being written by other goroutines, `data[i]` is a data race. Even with just reads, if anything writes to `data` concurrently, this is a race.

**Fix** — Pre-allocate and use index-based writes:
```go
func main() {
    data := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    results := make([]int, len(data))  // pre-allocate with known size
    var wg sync.WaitGroup

    for i := 0; i < len(data); i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            results[idx] = data[idx] * data[idx]  // write to own index — no race
        }(i)
    }

    wg.Wait()
    fmt.Println(results)  // ordered: [1 4 9 16 25 36 49 64 81 100]
}
```

**Key insight**: For parallel processing where order matters, pre-allocate the result slice and write to `results[idx]` rather than using `append`. Each goroutine writes to a unique index — no mutex needed.
</details>

---

## Bug 11 🔴 — Stack Overflow from Deep Recursive-Style Loop

```go
package main

import "fmt"

// Intended: process a deeply nested tree iteratively
type Node struct {
    Val      int
    Children []*Node
}

func processTree(root *Node) []int {
    result := []int{}
    stack := []*Node{root}

    for len(stack) > 0 {
        node := stack[len(stack)-1]
        stack = stack[:len(stack)-1]

        result = append(result, node.Val)

        // BUG: adds children in wrong order for DFS
        for i := 0; i < len(node.Children); i++ {
            stack = append(stack, node.Children[i])
        }
    }
    return result
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
If you want depth-first pre-order traversal, in what order should children be pushed onto the stack? Which child should be popped first?
</details>

<details>
<summary>Solution</summary>

**Bug**: Children are pushed left-to-right, so the last child is on top of the stack and processed first. This gives reverse-order DFS (right subtree before left), not standard left-to-right pre-order DFS.

For a tree:
```
    A
   /|\
  B  C  D
```
Expected pre-order: A, B, C, D
Actual output: A, D, C, B (reversed)

**Fix** — Push children in reverse order so left child is processed first:
```go
func processTree(root *Node) []int {
    result := []int{}
    stack := []*Node{root}

    for len(stack) > 0 {
        node := stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        result = append(result, node.Val)

        // Push children in REVERSE order so first child is processed first
        for i := len(node.Children) - 1; i >= 0; i-- {
            stack = append(stack, node.Children[i])
        }
    }
    return result
}
```

**Key insight**: Stack-based iterative DFS requires pushing children in reverse order to maintain the expected left-to-right traversal.
</details>

---

## Bug 12 🔴 — Memory Leak from Growing Slice in Long-Running Loop

```go
package main

import (
    "fmt"
    "time"
)

func processEvents() {
    var log []string  // accumulates ALL events forever
    for {
        event := waitForEvent()
        log = append(log, event)  // MEMORY LEAK: log grows unboundedly

        if len(log)%100 == 0 {
            fmt.Printf("Processed %d events\n", len(log))
        }
    }
}

func waitForEvent() string {
    time.Sleep(time.Millisecond)
    return fmt.Sprintf("event-%d", time.Now().UnixNano())
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What happens to the `log` slice over time? Is all historical event data needed?
</details>

<details>
<summary>Solution</summary>

**Bug**: `log` grows without bound. In a long-running process, this will eventually exhaust memory.

**Fix 1** — Fixed-size circular buffer (keep only last N events):
```go
func processEvents() {
    const maxLog = 1000
    log := make([]string, 0, maxLog)
    for {
        event := waitForEvent()
        if len(log) >= maxLog {
            // Remove oldest (shift left) — or use a ring buffer
            copy(log, log[1:])
            log = log[:len(log)-1]
        }
        log = append(log, event)
    }
}
```

**Fix 2** — Process and discard (streaming, no accumulation):
```go
func processEvents() {
    count := 0
    for {
        event := waitForEvent()
        processEvent(event)  // handle immediately, don't store
        count++
        if count%100 == 0 {
            fmt.Printf("Processed %d events\n", count)
        }
    }
}
```

**Fix 3** — Use a ring buffer (production-quality):
```go
type RingBuffer struct {
    data []string
    head int
    size int
    cap  int
}

func NewRingBuffer(capacity int) *RingBuffer {
    return &RingBuffer{data: make([]string, capacity), cap: capacity}
}

func (r *RingBuffer) Add(s string) {
    r.data[r.head] = s
    r.head = (r.head + 1) % r.cap
    if r.size < r.cap { r.size++ }
}
```

**Key lesson**: Any slice that grows in a long-running loop must have a bound. Use circular buffers, discard-after-process, or explicit max-size enforcement.
</details>
