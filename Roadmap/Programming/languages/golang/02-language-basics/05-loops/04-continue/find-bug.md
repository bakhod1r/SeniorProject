# Go `continue` Statement — Find the Bug

Each bug has a difficulty rating:
- 🟢 Easy — visible syntax/logic error
- 🟡 Medium — subtle behavioral bug
- 🔴 Hard — requires deep understanding

---

## Bug 1 🟢 — Infinite Loop from Missing Increment

```go
package main

import "fmt"

func main() {
    i := 0
    for i < 10 {
        if i%2 == 0 {
            continue
        }
        fmt.Println(i)
        i++
    }
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** When `i` is even (which it is from the start, since `i = 0`), `continue` jumps back to the loop condition without ever incrementing `i`. This creates an infinite loop because `i` stays `0` forever.

**Fix:** Increment `i` before `continue`:
```go
i := 0
for i < 10 {
    i++ // always increment first
    if i%2 == 0 {
        continue
    }
    fmt.Println(i)
}
// Prints: 1 3 5 7 9
```

Or use a classic `for` loop with a post statement:
```go
for i := 0; i < 10; i++ { // i++ is the post statement, always runs
    if i%2 == 0 {
        continue
    }
    fmt.Println(i)
}
```

</details>

---

## Bug 2 🟢 — `continue` vs `break` Confusion

```go
package main

import "fmt"

func firstNegative(nums []int) int {
    result := -1
    for _, n := range nums {
        if n < 0 {
            result = n
            continue // programmer wanted to stop here
        }
    }
    return result
}

func main() {
    nums := []int{1, 2, -3, 4, -5, 6}
    fmt.Println(firstNegative(nums)) // expected: -3, got: -5
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** The function is supposed to return the **first** negative number, but it uses `continue` instead of `break`. `continue` just skips to the next iteration, so the loop keeps running and overwrites `result` with later negative values. The function ends up returning the **last** negative number (`-5`), not the first (`-3`).

**Fix:** Use `break` to stop the loop after finding the first negative:
```go
func firstNegative(nums []int) int {
    for _, n := range nums {
        if n < 0 {
            return n // even better: return immediately
        }
    }
    return -1 // sentinel: no negative found
}
```

Or with break:
```go
func firstNegative(nums []int) int {
    result := -1
    for _, n := range nums {
        if n < 0 {
            result = n
            break // stop after first negative
        }
    }
    return result
}
```

</details>

---

## Bug 3 🟢 — Useless `continue` at End of Loop Body

```go
package main

import "fmt"

func printAll(nums []int) {
    for _, n := range nums {
        fmt.Println(n)
        continue // this does nothing
    }
}

func main() {
    printAll([]int{1, 2, 3, 4, 5})
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** Not a logic bug (the code works correctly), but a code smell. A `continue` at the very end of a loop body is completely useless — the loop would naturally continue to the next iteration anyway. This is a linting issue that `staticcheck` or `revive` would flag.

**Fix:** Remove the pointless `continue`:
```go
func printAll(nums []int) {
    for _, n := range nums {
        fmt.Println(n)
        // continue is not needed here
    }
}
```

</details>

---

## Bug 4 🟡 — `defer` Inside Loop with `continue`

```go
package main

import (
    "fmt"
    "os"
)

func processFiles(paths []string) error {
    for _, path := range paths {
        f, err := os.Open(path)
        if err != nil {
            fmt.Println("cannot open:", path)
            continue
        }
        defer f.Close() // Bug: defers accumulate until function returns
        data := make([]byte, 1024)
        n, _ := f.Read(data)
        fmt.Printf("%s: %d bytes\n", path, n)
    }
    return nil
}

func main() {
    processFiles([]string{"a.txt", "b.txt", "c.txt"})
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** `defer f.Close()` inside a loop does NOT close the file at the end of each iteration. All defers accumulate and run only when `processFiles` returns. With 1000 files, you'd hold 1000 open file handles simultaneously, causing file descriptor exhaustion.

**Fix:** Extract the per-file logic to a separate function where `defer` runs per-call:
```go
func processFiles(paths []string) error {
    for _, path := range paths {
        if err := processOne(path); err != nil {
            fmt.Println("error:", path, err)
            continue
        }
    }
    return nil
}

func processOne(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close() // runs when processOne returns — correct
    data := make([]byte, 1024)
    n, err := f.Read(data)
    if err != nil {
        return err
    }
    fmt.Printf("%s: %d bytes\n", path, n)
    return nil
}
```

</details>

---

## Bug 5 🟡 — Wrong Label Target

```go
package main

import "fmt"

func main() {
    data := [][]int{
        {1, 2, 3},
        {4, 5, 6},
        {7, 8, 9},
    }

Rows:
    for _, row := range data {
        for _, val := range row {
            if val%2 == 0 {
                continue Rows // programmer wants to skip even values
                // BUG: this skips the ENTIRE ROW, not just the even value
            }
            fmt.Println(val)
        }
    }
}
// Expected: 1 3 5 7 9
// Actual:   1 3 7
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** `continue Rows` skips to the next row (outer loop iteration) whenever an even number is found. So for row `{1, 2, 3}`: prints `1`, sees `2` → `continue Rows` (skips `3`), moves to next row. For row `{4, 5, 6}`: sees `4` immediately → `continue Rows`, skips `5` and `6`. For row `{7, 8, 9}`: prints `7`, sees `8` → skips `9`.

The programmer wanted to skip the even value and continue checking the rest of the row, so they should use an unlabeled `continue`.

**Fix:**
```go
for _, row := range data {
    for _, val := range row {
        if val%2 == 0 {
            continue // no label: skip to next val in inner loop
        }
        fmt.Println(val)
    }
}
// Output: 1 3 5 7 9
```

</details>

---

## Bug 6 🟡 — `continue` Inside `switch` Inside `for`

```go
package main

import "fmt"

func processCommands(cmds []string) {
    for _, cmd := range cmds {
        switch cmd {
        case "quit":
            fmt.Println("Quitting...")
            break // programmer thinks this exits the for loop
        case "skip":
            fmt.Println("Skipping...")
            continue // programmer thinks this continues the switch
        default:
            fmt.Println("Executing:", cmd)
        }
        fmt.Println("--- after switch ---") // runs even after "quit"!
    }
}

func main() {
    processCommands([]string{"run", "skip", "build", "quit", "deploy"})
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Two bugs:**

1. `break` inside `switch` only exits the `switch`, NOT the `for` loop. After "quit", execution continues to `fmt.Println("--- after switch ---")` and then to the next iteration.

2. `continue` inside `switch` that is inside a `for` DOES continue the `for` loop (this is actually correct behavior). The comment "programmer thinks this continues the switch" is the misconception — `continue` correctly skips to the next command.

**Fix for bug 1:**
```go
func processCommands(cmds []string) {
    for _, cmd := range cmds {
        switch cmd {
        case "quit":
            fmt.Println("Quitting...")
            return // or use a labeled break
        case "skip":
            fmt.Println("Skipping...")
            continue // this is correct: continues the for loop
        default:
            fmt.Println("Executing:", cmd)
        }
        fmt.Println("--- after switch ---")
    }
}
```

Or with labeled break:
```go
loop:
    for _, cmd := range cmds {
        switch cmd {
        case "quit":
            fmt.Println("Quitting...")
            break loop // breaks the FOR loop, not the switch
        // ...
        }
    }
```

</details>

---

## Bug 7 🟡 — `continue` Counter Not Reflecting Skips

```go
package main

import "fmt"

func countProcessed(items []int) (processed, skipped int) {
    for _, item := range items {
        if item < 0 {
            continue // bug: skipped is not incremented
        }
        processed++
    }
    return
}

func main() {
    p, s := countProcessed([]int{1, -2, 3, -4, 5})
    fmt.Printf("Processed: %d, Skipped: %d\n", p, s)
    // Expected: Processed: 3, Skipped: 2
    // Actual:   Processed: 3, Skipped: 0
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** When `continue` is taken for negative items, the `skipped` counter is never incremented. The programmer forgot to increment `skipped` before `continue`.

**Fix:**
```go
func countProcessed(items []int) (processed, skipped int) {
    for _, item := range items {
        if item < 0 {
            skipped++ // increment BEFORE continue
            continue
        }
        processed++
    }
    return
}
// Output: Processed: 3, Skipped: 2
```

</details>

---

## Bug 8 🔴 — Goroutine Loop Variable Capture with `continue`

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    items := []int{1, 2, 3, 4, 5}
    var wg sync.WaitGroup

    for _, item := range items {
        if item%2 == 0 {
            continue
        }
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(item) // BUG: captures 'item' by reference (pre-Go 1.22)
        }()
    }

    wg.Wait()
}
// In Go < 1.22: might print 5 5 5 (or any repeated value)
// Expected: 1 3 5 (in some order)
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug (Go < 1.22):** The goroutine closure captures the loop variable `item` by reference. All goroutines share the same `item` variable. By the time goroutines execute, the loop may have advanced, and `item` may be `5` (or any later value). The `continue` for even items makes this harder to spot because it creates non-obvious gaps in which goroutines are launched.

**Note:** In Go 1.22+, loop variables are re-scoped per iteration, so this bug is automatically fixed.

**Fix for Go < 1.22:**
```go
for _, item := range items {
    if item%2 == 0 {
        continue
    }
    item := item // shadow the variable — creates a new variable per iteration
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println(item) // captures the shadowed, per-iteration variable
    }()
}
```

Or pass as a function argument:
```go
go func(v int) {
    defer wg.Done()
    fmt.Println(v)
}(item)
```

</details>

---

## Bug 9 🔴 — `continue` Bypasses OpenTelemetry Span End

```go
package main

import (
    "context"
    "fmt"
)

type Span struct{ name string }
func (s *Span) End() { fmt.Println("span ended:", s.name) }

var tracer = &MockTracer{}
type MockTracer struct{}
func (t *MockTracer) Start(ctx context.Context, name string) (*Span, context.Context) {
    return &Span{name: name}, ctx
}

func processItems(ctx context.Context, items []string) {
    for _, item := range items {
        span, ctx := tracer.Start(ctx, "process."+item)

        if len(item) == 0 {
            fmt.Println("skipping empty item")
            continue // BUG: span.End() is never called for empty items!
        }

        fmt.Println("processing:", item)
        span.End()
        _ = ctx
    }
}

func main() {
    processItems(context.Background(), []string{"a", "", "b", "", "c"})
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** For empty items, the code starts a tracing span and then immediately `continue`s, skipping `span.End()`. This causes span leaks — the tracing backend never receives the end signal for empty items, leading to orphaned spans, incorrect latency metrics, and potential memory leaks in the tracing SDK.

**Fix 1:** Call `span.End()` before `continue`:
```go
for _, item := range items {
    span, ctx := tracer.Start(ctx, "process."+item)

    if len(item) == 0 {
        fmt.Println("skipping empty item")
        span.End() // end span before continue
        continue
    }

    fmt.Println("processing:", item)
    span.End()
    _ = ctx
}
```

**Fix 2 (preferred):** Use defer inside a closure or extracted function:
```go
for _, item := range items {
    func() {
        span, ctx := tracer.Start(ctx, "process."+item)
        defer span.End() // always ends, even on continue/return
        _ = ctx

        if len(item) == 0 {
            fmt.Println("skipping empty item")
            return // return from closure, defer runs
        }

        fmt.Println("processing:", item)
    }()
}
```

</details>

---

## Bug 10 🔴 — `continue` in a Closure Inside a Loop

```go
package main

import "fmt"

func makeFilters() []func(int) bool {
    conditions := []int{2, 3, 5}
    filters := make([]func(int) bool, len(conditions))

    for i, c := range conditions {
        filters[i] = func(n int) bool {
            return n%c == 0 // BUG: captures c by reference (pre-Go 1.22)
        }
    }
    return filters
}

func applyFilters(nums []int, filters []func(int) bool) []int {
    var result []int
    for _, n := range nums {
        skip := false
        for _, f := range filters {
            if f(n) {
                skip = true
                break
            }
        }
        if skip {
            continue
        }
        result = append(result, n)
    }
    return result
}

func main() {
    filters := makeFilters()
    nums := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    result := applyFilters(nums, filters)
    fmt.Println(result)
    // Expected (skip multiples of 2, 3, or 5): [1 7]
    // Actual (pre-Go 1.22): all filters use c=5 (last value), so only skips multiples of 5
    // Result: [1 2 3 4 6 7 8 9]
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** In Go < 1.22, the closure `func(n int) bool { return n%c == 0 }` captures `c` by reference. After the loop finishes, `c` is `5` (the last value). All three filters use `c=5`, so only multiples of 5 are skipped. The `continue` in `applyFilters` is correct, but the filters it's using are broken due to the capture bug in `makeFilters`.

**Fix:**
```go
func makeFilters() []func(int) bool {
    conditions := []int{2, 3, 5}
    filters := make([]func(int) bool, len(conditions))

    for i, c := range conditions {
        c := c // shadow to create per-iteration copy (Go < 1.22)
        filters[i] = func(n int) bool {
            return n%c == 0
        }
    }
    return filters
}
```

Or pass as argument:
```go
for i, c := range conditions {
    filters[i] = func(c int) func(int) bool {
        return func(n int) bool { return n%c == 0 }
    }(c)
}
```

</details>

---

## Bug 11 🔴 — `continue` Skips Metric Recording in a Loop

```go
package main

import "fmt"

type Metrics struct {
    total   int
    success int
    failure int
}

func processWithMetrics(items []int, m *Metrics) {
    for _, item := range items {
        m.total++

        if item < 0 {
            m.failure++
            continue
        }

        result, err := compute(item)
        if err != nil {
            m.failure++
            continue // BUG: m.success is never recorded for this path
        }

        if result > 1000 {
            fmt.Println("result too large, skipping:", result)
            continue // BUG: neither success nor failure is recorded
        }

        m.success++
        fmt.Println("ok:", result)
    }
}

func compute(n int) (int, error) {
    return n * 10, nil
}

func main() {
    m := &Metrics{}
    processWithMetrics([]int{1, -2, 3, -4, 200}, m)
    fmt.Printf("Total: %d, Success: %d, Failure: %d\n", m.total, m.success, m.failure)
    // Expected: Total: 5, Success: 2, Failure: 2, Skipped: 1
    // Bug: skipped case is not counted
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** When `result > 1000`, the code prints "result too large" and continues, but does NOT increment either `m.success` or `m.failure`. This "skipped" category is invisible in the metrics — `m.total` will be 5 but `m.success + m.failure` will only be 4. Monitoring dashboards will show discrepancies.

**Fix:** Add a `skipped` counter and record it:
```go
type Metrics struct {
    total   int
    success int
    failure int
    skipped int // add this field
}

func processWithMetrics(items []int, m *Metrics) {
    for _, item := range items {
        m.total++

        if item < 0 {
            m.failure++
            continue
        }

        result, err := compute(item)
        if err != nil {
            m.failure++
            continue
        }

        if result > 1000 {
            m.skipped++ // record the skip
            fmt.Println("result too large, skipping:", result)
            continue
        }

        m.success++
        fmt.Println("ok:", result)
    }
}
```

</details>

---

## Bug 12 🔴 — Mutex Not Released Before `continue`

```go
package main

import (
    "fmt"
    "sync"
)

type Cache struct {
    mu   sync.Mutex
    data map[string]int
}

func (c *Cache) processItems(keys []string) {
    for _, key := range keys {
        c.mu.Lock()

        val, ok := c.data[key]
        if !ok {
            fmt.Println("key not found:", key)
            continue // BUG: mutex is never unlocked! Deadlock.
        }

        if val < 0 {
            fmt.Println("negative value, skipping:", key)
            continue // BUG: mutex is never unlocked!
        }

        fmt.Printf("processing %s = %d\n", key, val)
        c.mu.Unlock()
    }
}

func main() {
    c := &Cache{
        data: map[string]int{"a": 1, "b": -2, "c": 3},
    }
    c.processItems([]string{"a", "b", "c", "d"})
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** `c.mu.Lock()` is called at the start of each iteration, but `c.mu.Unlock()` is only called on the happy path. When `continue` is taken (key not found, or negative value), the mutex is never unlocked. On the next iteration, `Lock()` will block forever, causing a deadlock.

**Fix 1:** Unlock before each `continue`:
```go
for _, key := range keys {
    c.mu.Lock()

    val, ok := c.data[key]
    if !ok {
        c.mu.Unlock() // unlock before continue
        fmt.Println("key not found:", key)
        continue
    }

    if val < 0 {
        c.mu.Unlock() // unlock before continue
        fmt.Println("negative value, skipping:", key)
        continue
    }

    fmt.Printf("processing %s = %d\n", key, val)
    c.mu.Unlock()
}
```

**Fix 2 (preferred):** Extract to a function and use `defer`:
```go
func (c *Cache) processOne(key string) {
    c.mu.Lock()
    defer c.mu.Unlock() // always unlocks, regardless of return path

    val, ok := c.data[key]
    if !ok {
        fmt.Println("key not found:", key)
        return
    }
    if val < 0 {
        fmt.Println("negative value, skipping:", key)
        return
    }
    fmt.Printf("processing %s = %d\n", key, val)
}

func (c *Cache) processItems(keys []string) {
    for _, key := range keys {
        c.processOne(key)
    }
}
```

</details>
