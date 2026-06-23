# break Statement — Find the Bug

## Overview

12 debugging exercises to find and fix bugs related to Go's `break` statement. Each bug has a difficulty marker 🟢 Easy, 🟡 Medium, 🔴 Hard, and a `<details>` section with the fix and explanation.

---

## Bug 1 🟢 — break Inside switch Does Not Exit for Loop

```go
package main

import "fmt"

func stopAtFive() {
    for i := 0; i < 10; i++ {
        switch i {
        case 5:
            fmt.Println("Found 5, stopping")
            break // BUG
        }
        fmt.Println("i =", i)
    }
}

func main() {
    stopAtFive()
}
```

**Expected output:**
```
i = 0
i = 1
i = 2
i = 3
i = 4
Found 5, stopping
```

**Actual output:**
```
i = 0
...
i = 4
Found 5, stopping
i = 5   ← should not appear
i = 6
...
i = 9
```

<details>
<summary>Solution</summary>

**Root cause:** `break` inside a `switch` exits only the `switch`, not the enclosing `for` loop.

**Fix — use a labeled break:**
```go
func stopAtFive() {
Loop:
    for i := 0; i < 10; i++ {
        switch i {
        case 5:
            fmt.Println("Found 5, stopping")
            break Loop // exits the for loop
        }
        fmt.Println("i =", i)
    }
}
```

**Alternative fix — use a flag variable:**
```go
func stopAtFive() {
    done := false
    for i := 0; i < 10; i++ {
        switch i {
        case 5:
            fmt.Println("Found 5, stopping")
            done = true
        }
        if done { break }
        fmt.Println("i =", i)
    }
}
```

**Best practice:** In Go, `break` always exits only the innermost enclosing `for`, `switch`, or `select`. To exit an outer construct, use a labeled break.

</details>

---

## Bug 2 🟢 — Infinite Loop Because break Is Never Reached

```go
package main

import "fmt"

func readPositive(values []int) int {
    sum := 0
    i := 0
    for {
        if i >= len(values) {
            break
        }
        v := values[i]
        if v < 0 {
            fmt.Println("Negative value, stopping")
            // BUG: forgot break here
        }
        sum += v
        i++
    }
    return sum
}

func main() {
    fmt.Println(readPositive([]int{1, 2, -3, 4}))
}
```

**Problem:** The function prints "Negative value, stopping" but continues processing and never terminates correctly because `break` is missing after the negative check.

<details>
<summary>Solution</summary>

**Root cause:** When `v < 0`, the code prints the message but does NOT break out of the loop. It then adds the negative value to `sum` and increments `i`, continuing forever.

**Fix:**
```go
func readPositive(values []int) int {
    sum := 0
    i := 0
    for {
        if i >= len(values) {
            break
        }
        v := values[i]
        if v < 0 {
            fmt.Println("Negative value, stopping")
            break // fix: exit the loop
        }
        sum += v
        i++
    }
    return sum
}
```

**Or more idiomatically with for range:**
```go
func readPositive(values []int) int {
    sum := 0
    for _, v := range values {
        if v < 0 {
            break
        }
        sum += v
    }
    return sum
}
```

</details>

---

## Bug 3 🟢 — break Only Exits Inner Loop

```go
package main

import "fmt"

func findInMatrix(matrix [][]int, target int) {
    for i, row := range matrix {
        for j, v := range row {
            if v == target {
                fmt.Printf("Found at [%d][%d]\n", i, j)
                break // BUG: only exits inner loop
            }
        }
    }
}

func main() {
    m := [][]int{
        {1, 2, 3},
        {4, 5, 6},
        {7, 8, 9},
    }
    findInMatrix(m, 5)
    // Expected: Found at [1][1]
    // Problem: continues searching outer rows after finding 5
}
```

**Problem:** After finding the target, the outer loop continues iterating remaining rows unnecessarily.

<details>
<summary>Solution</summary>

**Root cause:** `break` inside a nested loop exits only the innermost loop. The outer `for i, row` loop keeps iterating.

**Fix 1 — labeled break:**
```go
func findInMatrix(matrix [][]int, target int) {
Outer:
    for i, row := range matrix {
        for j, v := range row {
            if v == target {
                fmt.Printf("Found at [%d][%d]\n", i, j)
                break Outer
            }
        }
    }
}
```

**Fix 2 — extract to function (preferred for readability):**
```go
func findInMatrix(matrix [][]int, target int) (int, int, bool) {
    for i, row := range matrix {
        for j, v := range row {
            if v == target {
                return i, j, true
            }
        }
    }
    return -1, -1, false
}

func main() {
    m := [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}
    if row, col, ok := findInMatrix(m, 5); ok {
        fmt.Printf("Found at [%d][%d]\n", row, col)
    }
}
```

</details>

---

## Bug 4 🟡 — break in select Does Not Exit for Loop

```go
package main

import (
    "fmt"
    "time"
)

func listenWithTimeout(ch <-chan int, timeout time.Duration) {
    timer := time.After(timeout)
    for {
        select {
        case v := <-ch:
            fmt.Println("Received:", v)
        case <-timer:
            fmt.Println("Timeout!")
            break // BUG: only exits select, not for
        }
    }
    fmt.Println("Done") // never reached
}

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    close(ch)
    listenWithTimeout(ch, 10*time.Millisecond)
}
```

**Problem:** After the timeout case, the function prints "Timeout!" but then re-enters the `for` loop and the `select`, running forever (or reading zero-values from the closed channel forever).

<details>
<summary>Solution</summary>

**Root cause:** `break` inside `select` exits the `select` statement, not the enclosing `for` loop.

**Fix 1 — labeled break:**
```go
func listenWithTimeout(ch <-chan int, timeout time.Duration) {
    timer := time.After(timeout)
Loop:
    for {
        select {
        case v, ok := <-ch:
            if !ok {
                fmt.Println("Channel closed")
                break Loop
            }
            fmt.Println("Received:", v)
        case <-timer:
            fmt.Println("Timeout!")
            break Loop
        }
    }
    fmt.Println("Done")
}
```

**Fix 2 — return (preferred in goroutines):**
```go
func listenWithTimeout(ch <-chan int, timeout time.Duration) {
    timer := time.After(timeout)
    for {
        select {
        case v, ok := <-ch:
            if !ok { return }
            fmt.Println("Received:", v)
        case <-timer:
            fmt.Println("Timeout!")
            return
        }
    }
}
```

</details>

---

## Bug 5 🟡 — Goroutine Leak After break on Channel

```go
package main

import (
    "fmt"
)

func generate(n int) <-chan int {
    ch := make(chan int) // unbuffered
    go func() {
        for i := 0; i < n; i++ {
            ch <- i // blocks if consumer stopped
        }
        close(ch)
    }()
    return ch
}

func firstFive() []int {
    var result []int
    for v := range generate(1000000) {
        result = append(result, v)
        if len(result) == 5 {
            break // BUG: producer goroutine is now blocked forever
        }
    }
    return result
}

func main() {
    fmt.Println(firstFive())
}
```

**Problem:** After `break`, the goroutine inside `generate` is blocked on `ch <- i` forever — a goroutine leak. The program finishes `main` but the goroutine is never garbage collected.

<details>
<summary>Solution</summary>

**Root cause:** The producer goroutine is blocked trying to send to an unbuffered channel that no longer has a consumer. The channel is never drained or closed from the consumer side, so the goroutine stays alive.

**Fix — use context.Context to signal cancellation:**
```go
package main

import (
    "context"
    "fmt"
)

func generate(ctx context.Context, n int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < n; i++ {
            select {
            case <-ctx.Done():
                return // producer exits when consumer cancels
            case ch <- i:
            }
        }
    }()
    return ch
}

func firstFive() []int {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // cancels producer when firstFive returns

    var result []int
    for v := range generate(ctx, 1000000) {
        result = append(result, v)
        if len(result) == 5 {
            break
        }
    }
    return result
}

func main() {
    fmt.Println(firstFive())
}
```

**Key rule:** Whenever you `break` from a channel range loop, ensure the producer goroutine can detect the cancellation. Always use `context.Context` or a done channel.

</details>

---

## Bug 6 🟡 — Unreachable Code After break

```go
package main

import "fmt"

func processItems(items []string) {
    for _, item := range items {
        if item == "stop" {
            fmt.Println("Stopping")
            break
            fmt.Println("Processing stopped at:", item) // BUG: dead code
        }
        fmt.Println("Processing:", item)
    }
}

func main() {
    processItems([]string{"a", "b", "stop", "c"})
}
```

**Problem:** The `fmt.Println("Processing stopped at:", item)` line after `break` is unreachable dead code. The Go compiler will not warn about this by default, but static analysis tools like `staticcheck` will flag it.

<details>
<summary>Solution</summary>

**Root cause:** Any statement after an unconditional `break` (in the same block) is unreachable. The code was likely written with the intent to log before stopping, but the order is wrong.

**Fix — move the log statement before break:**
```go
func processItems(items []string) {
    for _, item := range items {
        if item == "stop" {
            fmt.Println("Stopping at:", item) // log first
            break                             // then break
        }
        fmt.Println("Processing:", item)
    }
}
```

**Detection:** Run `staticcheck ./...` or `go vet ./...` to catch unreachable code. The `go vet` tool catches some cases; `staticcheck` is more thorough.

</details>

---

## Bug 7 🟡 — Labeled break Targets Wrong Statement

```go
package main

import "fmt"

func search(matrix [][]int, target int) (int, int) {
    row, col := -1, -1
Inner: // BUG: label is on the wrong loop
    for i := range matrix {
        for j, v := range matrix[i] {
            if v == target {
                row, col = i, j
                break Inner // meant to exit outer loop, but Inner labels inner loop!
            }
        }
    }
    return row, col
}

func main() {
    m := [][]int{{1, 2}, {3, 4}, {5, 6}}
    fmt.Println(search(m, 4)) // Should be: 1 1
}
```

**Problem:** The label `Inner` is placed on the outer `for i` loop. When `break Inner` executes, it exits the outer loop (not the inner one as the programmer intended by the name). The naming is misleading and the placement may be incorrect depending on intent.

<details>
<summary>Solution</summary>

**Root cause:** In Go, a label applies to the statement that immediately follows it. `Inner:` is placed before `for i := range matrix`, so `break Inner` exits the outer loop. The label name "Inner" is misleading.

**If the goal is to exit BOTH loops (outer) on found:**
```go
// The label should be on the OUTER loop, named clearly
func search(matrix [][]int, target int) (int, int) {
    row, col := -1, -1
Outer:
    for i := range matrix {
        for j, v := range matrix[i] {
            if v == target {
                row, col = i, j
                break Outer // exits both loops
            }
        }
    }
    return row, col
}
```

**If the goal is to exit only the INNER loop:**
```go
func search(matrix [][]int, target int) (int, int) {
    row, col := -1, -1
    for i := range matrix {
    Inner:
        for j, v := range matrix[i] {
            if v == target {
                row, col = i, j
                break Inner // exits only the inner loop
            }
        }
    }
    return row, col
}
```

**Rule:** Always place the label on the construct you want to exit, and name it to reflect the structure (e.g., `Outer`, `RowLoop`, `Batch`).

</details>

---

## Bug 8 🔴 — break Inside defer (Compile Error)

```go
package main

import "fmt"

func processWithCleanup(items []int) {
    for _, v := range items {
        defer func() {
            if v < 0 {
                break // BUG: compile error — break not in for/switch/select
            }
        }()
        fmt.Println(v)
    }
}

func main() {
    processWithCleanup([]int{1, 2, -3, 4})
}
```

**Problem:** `break` inside a `defer`ed function is a compile error: `break is not in a for, switch, or select`.

<details>
<summary>Solution</summary>

**Root cause:** `break` requires a directly enclosing `for`, `switch`, or `select` in the same function body. A `defer`ed function is a separate closure — the `for` loop in the outer function is not visible to `break` inside the closure.

**Fix 1 — remove the break, use return from defer if needed:**
```go
func processWithCleanup(items []int) {
    for _, v := range items {
        v := v // capture loop variable
        defer func() {
            if v < 0 {
                fmt.Println("Cleanup for negative:", v)
                return // return from defer, not break from for
            }
        }()
        fmt.Println(v)
    }
}
```

**Fix 2 — move the break condition outside defer:**
```go
func processWithCleanup(items []int) {
    for _, v := range items {
        if v < 0 {
            break // break is valid here — directly in for
        }
        fmt.Println(v)
    }
}
```

**Key rule:** `break` (and `continue`) cannot cross function boundaries. A `defer`ed function, an anonymous function, or a goroutine closure cannot `break` or `continue` the outer function's loop.

</details>

---

## Bug 9 🔴 — break After Sending to Closed Channel

```go
package main

import "fmt"

func drain(ch chan int, done chan struct{}) {
    for {
        select {
        case v := <-ch:
            fmt.Println("Received:", v)
            if v == 0 {
                // zero value from closed channel
                break // BUG: exits select, not for — infinite loop receiving 0
            }
        case <-done:
            return
        }
    }
}

func main() {
    ch := make(chan int, 3)
    done := make(chan struct{})
    ch <- 1
    ch <- 2
    close(ch) // after closing, receives return zero value infinitely

    go drain(ch, done)
    // done is never closed, goroutine loops printing 0 forever
    fmt.Println("main done")
}
```

**Problem:** After `ch` is closed, reading from it returns `(0, false)` indefinitely. The `break` exits only the `select`, and `done` is never signaled, so the goroutine loops forever printing `Received: 0`.

<details>
<summary>Solution</summary>

**Root cause:** Two bugs:
1. `break` exits `select` not `for`
2. The code doesn't check the `ok` value from channel receive to detect closure

**Fix — check ok and return on channel close:**
```go
func drain(ch chan int, done chan struct{}) {
    for {
        select {
        case v, ok := <-ch:
            if !ok {
                fmt.Println("Channel closed, stopping")
                return // channel is closed — exit goroutine
            }
            fmt.Println("Received:", v)
        case <-done:
            return
        }
    }
}

func main() {
    ch := make(chan int, 3)
    done := make(chan struct{})
    ch <- 1
    ch <- 2
    close(ch)

    drain(ch, done) // blocks until ch is drained and closed
    fmt.Println("main done")
}
```

**Rule:** When ranging over a channel that may close, always check the `ok` return value: `v, ok := <-ch`. If `!ok`, the channel is closed — `return` or `break` (with label) to exit the loop.

</details>

---

## Bug 10 🔴 — Wrong Label Name (Case Sensitivity)

```go
package main

import "fmt"

func search(data [][]int, target int) bool {
    found := false
outer:
    for _, row := range data {
        for _, v := range row {
            if v == target {
                found = true
                break Outer // BUG: "Outer" != "outer" — compile error
            }
        }
    }
    return found
}

func main() {
    m := [][]int{{1, 2}, {3, 4}}
    fmt.Println(search(m, 3))
}
```

**Problem:** The label is defined as `outer` (lowercase) but referenced as `Outer` (uppercase). Go labels are case-sensitive. This is a compile error: `label Outer not defined`.

<details>
<summary>Solution</summary>

**Root cause:** Go identifiers (including labels) are case-sensitive. `outer` and `Outer` are different labels.

**Fix — use consistent casing:**
```go
func search(data [][]int, target int) bool {
    found := false
Outer:
    for _, row := range data {
        for _, v := range row {
            if v == target {
                found = true
                break Outer // matches the label
            }
        }
    }
    return found
}
```

**Convention:** By Go convention, labels are written in `CamelCase` or `ALLCAPS` for visibility (e.g., `Outer`, `OUTER`, `SearchLoop`). The Go spec does not mandate any style, but consistency is essential.

**Detection:** This is always a compile error — the compiler will say `label Outer not defined`. If you see this error, check for capitalization mismatches.

</details>

---

## Bug 11 🔴 — Non-Deterministic Break Point Due to Map Iteration Order

```go
package main

import "fmt"

func firstNegative(m map[string]int) (string, int, bool) {
    for k, v := range m {
        if v < 0 {
            return k, v, true // BUG: order is random — different key returned each run
        }
    }
    return "", 0, false
}

func main() {
    m := map[string]int{
        "a": 1,
        "b": -2,
        "c": -5,
        "d": 3,
    }
    // May return "b" or "c" non-deterministically across runs
    fmt.Println(firstNegative(m))
}
```

**Problem:** The function intends to find a "first" negative value, but map iteration order in Go is randomized. Each run may return a different key. If the caller expects a consistent result (e.g., for reproducible tests), this is a bug.

<details>
<summary>Solution</summary>

**Root cause:** Go map iteration order is randomized intentionally (since Go 1.0). There is no "first" element in a map. Using `break` or `return` on the first matching element during map range does not guarantee which element is returned.

**Fix — sort keys first if determinism is required:**
```go
import (
    "fmt"
    "sort"
)

func firstNegative(m map[string]int) (string, int, bool) {
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    sort.Strings(keys)

    for _, k := range keys {
        if m[k] < 0 {
            return k, m[k], true // deterministic: first alphabetically
        }
    }
    return "", 0, false
}
```

**Fix — use a slice of pairs if ordering by insertion matters:**
```go
type Pair struct{ Key string; Val int }

func firstNegative(pairs []Pair) (string, int, bool) {
    for _, p := range pairs {
        if p.Val < 0 {
            return p.Key, p.Val, true
        }
    }
    return "", 0, false
}
```

**Rule:** Never rely on map iteration order. If you need to break at a specific element position, use a sorted slice or a slice of ordered pairs.

</details>

---

## Bug 12 🔴 — Stale Label After Code Refactoring

```go
package main

import "fmt"

func processAll(matrix [][]int) {
    total := 0
Outer:
    for _, row := range matrix {
        for _, v := range row {
            if v < 0 {
                fmt.Println("Negative found, skipping row")
                continue Outer
            }
            total += v
        }
    }

    // Later, someone refactored to add early termination:
    result := 0
Batch: // new label added
    for _, row := range matrix {
        for _, v := range row {
            if v > 100 {
                break Batch
            }
            result += v
        }
    }

    // Now a developer tries to add another early exit using Outer:
    sum := 0
    for _, row := range matrix {
        for _, v := range row {
            if v == 0 {
                break Outer // BUG: Outer is defined in a different scope above — compile error
            }
            sum += v
        }
    }
    fmt.Println(total, result, sum)
}

func main() {
    processAll([][]int{{1, 2, 3}, {4, 0, 6}})
}
```

**Problem:** `break Outer` in the third loop tries to reference `Outer`, which was defined in the scope of the first loop. Labels in Go have function scope but can only target statements in the same block where they appear as a direct label. The third loop has no `Outer` label, so this is a compile error: `label Outer not defined`.

<details>
<summary>Solution</summary>

**Root cause:** Go labels are defined per statement, not globally. A label defined on one `for` loop cannot be reused by another `for` loop — each labeled statement is independent.

**Fix — define a new label for the third loop:**
```go
func processAll(matrix [][]int) {
    total := 0
OuterA:
    for _, row := range matrix {
        for _, v := range row {
            if v < 0 {
                fmt.Println("Negative found, skipping row")
                continue OuterA
            }
            total += v
        }
    }

    result := 0
OuterB:
    for _, row := range matrix {
        for _, v := range row {
            if v > 100 {
                break OuterB
            }
            result += v
        }
    }

    sum := 0
OuterC:
    for _, row := range matrix {
        for _, v := range row {
            if v == 0 {
                break OuterC
            }
            sum += v
        }
    }
    fmt.Println(total, result, sum)
}
```

**Best practice:** Use descriptive, unique label names when multiple loops exist in the same function (e.g., `ScanRows`, `FilterBatch`, `SumLoop`). Avoid generic names like `Outer` that can cause confusion after refactoring.

**Detection:** The Go compiler will report `label Outer not defined` if a label is referenced but not directly enclosing the statement. Always ensure each `break Label` or `continue Label` has a matching label on the immediately enclosing loop.

</details>

---

## Summary Table

| # | Difficulty | Pattern | Fix Strategy |
|---|---|---|---|
| 1 | 🟢 | `break` in `switch` exits switch only | Labeled `break` targeting `for` |
| 2 | 🟢 | Missing `break` causes unintended continuation | Add `break` after condition |
| 3 | 🟢 | `break` exits only inner loop | Labeled `break` or extract to function |
| 4 | 🟡 | `break` in `select` exits select only | Labeled `break` or `return` |
| 5 | 🟡 | Goroutine leak after `break` on channel | Use `context.Context` + `cancel()` |
| 6 | 🟡 | Unreachable code after `break` | Move log before `break` |
| 7 | 🟡 | Label on wrong loop | Move label to correct construct |
| 8 | 🔴 | `break` inside `defer` (compile error) | Use `return` in defer, `break` outside |
| 9 | 🔴 | `break` exits `select`, closed channel loops | Check `ok` from receive, use `return` |
| 10 | 🔴 | Label case sensitivity mismatch | Match label name exactly |
| 11 | 🔴 | Non-deterministic break on map range | Sort keys first for determinism |
| 12 | 🔴 | Reusing label from different loop scope | Use unique label names per loop |
