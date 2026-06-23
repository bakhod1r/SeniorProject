# break Statement — Interview Questions & Answers

## Categories
- [Junior Level (Q1–Q7)](#junior-level)
- [Middle Level (Q8–Q14)](#middle-level)
- [Senior Level (Q15–Q21)](#senior-level)
- [Scenario-Based (Q22–Q26)](#scenario-based)
- [FAQ (Q27–Q31)](#faq)

---

## Junior Level

### Q1: What does the `break` statement do in Go?

**A:** `break` immediately exits the innermost `for` loop, `switch` statement, or `select` block. Execution resumes at the statement immediately following the exited construct.

```go
package main

import "fmt"

func main() {
    for i := 0; i < 10; i++ {
        if i == 5 {
            break // exits the for loop
        }
        fmt.Println(i)
    }
    fmt.Println("after loop")
    // Output: 0 1 2 3 4
    //         after loop
}
```

---

### Q2: Does `break` inside a `switch` exit the surrounding `for` loop?

**A:** No. This is one of the most common Go bugs. `break` inside a `switch` exits only the `switch` — the outer `for` loop continues normally.

```go
package main

import "fmt"

func main() {
    for i := 0; i < 5; i++ {
        switch i {
        case 3:
            break // exits switch ONLY — does NOT exit the for loop!
        }
        fmt.Println(i) // still prints 0, 1, 2, 3, 4
    }
}
```

To exit the `for` loop from inside a `switch`, use a labeled `break` or a `return`.

---

### Q3: How do you exit an outer loop from inside a nested loop?

**A:** Use a labeled `break`. The label is placed immediately before the outer loop, and `break Label` jumps past that loop.

```go
package main

import "fmt"

func main() {
outer:
    for i := 0; i < 3; i++ {
        for j := 0; j < 3; j++ {
            if i+j == 3 {
                break outer // exits the outer for loop entirely
            }
            fmt.Printf("i=%d j=%d\n", i, j)
        }
    }
    fmt.Println("done")
}
// Output:
// i=0 j=0
// i=0 j=1
// i=0 j=2
// i=1 j=0
// i=1 j=1
// done
```

---

### Q4: What is the difference between `break` and `continue`?

**A:**
- `break` exits the current loop (or switch/select) entirely.
- `continue` skips the remainder of the current iteration and moves to the next iteration.

```go
package main

import "fmt"

func main() {
    for i := 0; i < 6; i++ {
        if i == 2 {
            continue // skip 2, go to i=3
        }
        if i == 5 {
            break // stop the loop at 5
        }
        fmt.Println(i)
    }
    // Output: 0 1 3 4
}
```

---

### Q5: Can you use `break` in a `for range` loop?

**A:** Yes. `break` works identically in `for range` loops — it exits the range loop immediately, regardless of how many elements remain.

```go
package main

import "fmt"

func main() {
    nums := []int{10, 20, 30, 40, 50}
    for i, v := range nums {
        if v == 30 {
            break
        }
        fmt.Println(i, v)
    }
    // Output:
    // 0 10
    // 1 20
}
```

---

### Q6: Do you need to write `break` at the end of every Go switch case?

**A:** No. Go switch cases do NOT fall through by default — each case implicitly breaks. Write `break` explicitly only when you want to exit a labeled outer construct. Use the `fallthrough` keyword to opt into C-style fall-through behavior.

```go
package main

import "fmt"

func describe(n int) {
    switch n {
    case 1:
        fmt.Println("one") // implicit break here
    case 2:
        fmt.Println("two") // no fallthrough
    case 3:
        fmt.Println("three or four")
        fallthrough // explicit: continues to case 4 body
    case 4:
        fmt.Println("(also four)")
    }
}
```

---

### Q7: What constructs can `break` exit in Go?

**A:** `break` can exit three constructs:
1. `for` loop (including `for range` and `for {}`)
2. `switch` statement
3. `select` statement

It always exits the **innermost** such construct unless a label is used.

```go
// for loop
for i := 0; i < 10; i++ {
    if i == 3 { break }
}

// switch
switch x {
case "stop":
    break // exits switch
}

// select
select {
case <-ch:
    break // exits select
}
```

---

## Middle Level

### Q8: What is a labeled `break` and when should you use it?

**A:** A labeled `break` exits a specific named construct rather than just the innermost one. Attach a label (identifier followed by `:`) immediately before the target construct, then write `break Label` to jump past it.

Use labeled `break` when you need to exit an outer loop or select from inside nested logic, and extracting the inner code to a separate function is not practical.

```go
package main

import "fmt"

func searchMatrix(m [][]int, target int) (int, int, bool) {
    row, col := -1, -1
search:
    for i, rowSlice := range m {
        for j, v := range rowSlice {
            if v == target {
                row, col = i, j
                break search // exits both loops
            }
        }
    }
    return row, col, row >= 0
}

func main() {
    m := [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}
    r, c, ok := searchMatrix(m, 5)
    fmt.Println(r, c, ok) // 1 1 true
}
```

---

### Q9: How do you exit a `for { select { ... } }` event loop when a done channel fires?

**A:** `break` inside `select` exits only the `select` — the `for` continues. Use a labeled `break` targeting the `for` loop, or use `return` if inside a function.

```go
package main

import "fmt"

func run(work <-chan int, done <-chan struct{}) {
loop:
    for {
        select {
        case v := <-work:
            fmt.Println("processing", v)
        case <-done:
            fmt.Println("shutting down")
            break loop // exits the for loop, not just the select
        }
    }
    fmt.Println("run exited cleanly")
}
```

---

### Q10: What happens when you `break` from a `for range` over a channel?

**A:** The range loop exits immediately. However, if the goroutine that sends to the channel is still running and blocked trying to send, it will block forever — this is a goroutine leak.

**Fix:** Signal the sender via a context or done channel so it can stop producing.

```go
package main

import (
    "context"
    "fmt"
)

func producer(ctx context.Context, ch chan<- int) {
    defer close(ch)
    for i := 0; ; i++ {
        select {
        case <-ctx.Done():
            return // producer exits when consumer cancels
        case ch <- i:
        }
    }
}

func consumer(ctx context.Context, ch <-chan int) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel() // signals producer when consumer returns
    for v := range ch {
        if v > 5 {
            break
        }
        fmt.Println(v)
    }
}
```

---

### Q11: What is the idiomatic Go alternative to labeled break for nested loops?

**A:** Extract the inner loop logic into a separate function and use `return`. This is often cleaner, more testable, and avoids the visual noise of labels.

```go
package main

import "fmt"

// With labeled break (acceptable):
func findLabeledBreak(matrix [][]int, target int) bool {
    found := false
outer:
    for _, row := range matrix {
        for _, v := range row {
            if v == target {
                found = true
                break outer
            }
        }
    }
    return found
}

// Idiomatic (preferred): extract to function, use return
func findInMatrix(matrix [][]int, target int) bool {
    for _, row := range matrix {
        for _, v := range row {
            if v == target {
                return true
            }
        }
    }
    return false
}

func main() {
    m := [][]int{{1, 2}, {3, 4}, {5, 6}}
    fmt.Println(findInMatrix(m, 4)) // true
}
```

---

### Q12: How does `break` interact with `defer`?

**A:** `break` does NOT trigger deferred functions. Deferred calls run only when the enclosing function returns or panics. Breaking out of a loop has no effect on the defer stack.

```go
package main

import "fmt"

func example() {
    defer fmt.Println("deferred") // runs when example() returns
    for i := 0; i < 5; i++ {
        if i == 2 {
            break // exits loop; deferred call NOT triggered here
        }
        fmt.Println(i)
    }
    fmt.Println("after loop")
    // Output:
    // 0
    // 1
    // after loop
    // deferred   <- runs when function returns
}

func main() { example() }
```

---

### Q13: Can a labeled `break` target a `switch` or `select`?

**A:** Yes. A labeled `break` can target any labeled `for`, `switch`, or `select`. Breaking out of a labeled `switch` simply exits that switch (same observable effect as plain `break` for switch, but useful when the switch is nested).

```go
package main

import "fmt"

func handle(cmds []string) {
    i := 0
dispatch:
    switch cmds[i] {
    case "stop":
        fmt.Println("stopping")
        break dispatch // explicit, exits the switch
    default:
        fmt.Println("handling:", cmds[i])
    }
    _ = dispatch // suppress "label declared and not used" if needed
    fmt.Println("after switch, i=", i)
}
```

---

### Q14: Does Go have a `for...else` construct like Python?

**A:** No. Go has no `for...else`. Simulate it with a boolean sentinel variable that records whether `break` was used.

```go
package main

import "fmt"

func firstPrime(nums []int) {
    found := false
    for _, n := range nums {
        if isPrime(n) {
            fmt.Println("First prime:", n)
            found = true
            break
        }
    }
    if !found {
        fmt.Println("No prime found") // Python's else block
    }
}

func isPrime(n int) bool {
    if n < 2 { return false }
    for i := 2; i*i <= n; i++ {
        if n%i == 0 { return false }
    }
    return true
}

func main() { firstPrime([]int{4, 6, 8, 9}) }
```

---

## Senior Level

### Q15: How does the Go compiler represent `break` in the SSA IR?

**A:** `break` is parsed as `*ast.BranchStmt{Tok: token.BREAK}`. During type-checking, the target construct is resolved by walking the enclosing statement stack. In SSA (Static Single Assignment) construction, `break` is lowered to an unconditional `Jump` instruction targeting the post-loop block (the block after the loop in the CFG). In machine code, this becomes a `JMP` instruction to the address immediately after the loop body.

---

### Q16: Does a labeled `break` carry any runtime overhead compared to a plain `break`?

**A:** No. Both compile to the same unconditional `JMP` instruction. The label is purely a compile-time construct used to resolve the jump target. There is no runtime cost, no extra instruction, and no branch prediction difference.

```
// Both produce identical machine code:
plain_break:    JMP  loop_exit
labeled_break:  JMP  outer_loop_exit
```

---

### Q17: How does `break` interact with Go 1.22+ range-over-integer and Go 1.23 iterator functions?

**A:**
- **Range-over-integer (Go 1.22):** `break` in `for i := range N` exits the synthetic loop just like any range loop.
- **Iterator functions (Go 1.23):** When a consumer calls `break` inside `for v := range myIter`, the compiler desugars this by making the `yield` function return `false`. The iterator must check `yield`'s return value and stop if it is `false`.

```go
// Go 1.23 iterator that respects break
func Naturals(yield func(int) bool) {
    for i := 0; ; i++ {
        if !yield(i) {
            return // break in consumer made yield return false
        }
    }
}

// Consumer:
for n := range Naturals {
    if n > 5 { break } // causes yield(6) to return false
    fmt.Println(n)
}
```

---

### Q18: What is the CPU branch-prediction impact of `break` in a tight loop?

**A:** Modern CPUs use dynamic branch prediction. When `break` is rarely taken (target found near the end of a large slice), the predictor learns "not break" and is correct nearly every iteration — near-zero misprediction overhead. When `break` is taken frequently or at unpredictable positions, the predictor mispredicts, costing ~15–20 cycles (~5–7 ns at 3 GHz) per mispredict. For extremely hot loops, data layout (e.g., placing the target near the front of sorted data) can improve prediction rates.

---

### Q19: How does `break` differ between Go and C/C++ switch statements?

**A:**
| Feature | Go | C / C++ |
|---|---|---|
| Default case behavior | Implicit break (no fall-through) | Implicit fall-through |
| Explicit fall-through | `fallthrough` keyword | Not needed (default) |
| `break` in switch | Exits switch (rarely needed in Go) | Required to prevent fall-through |
| Labeled break | Yes | No (`goto` used instead) |
| `break` exits outer loop | No (needs label) | No (`goto` used instead) |

---

### Q20: How can you use `break` safely in a `select` inside a worker goroutine without a goroutine leak?

**A:** Always pair `break` (or `return`) with a cancellation mechanism so that any producers or downstream consumers can also stop.

```go
package main

import (
    "context"
    "fmt"
    "sync"
)

func worker(ctx context.Context, jobs <-chan int, wg *sync.WaitGroup) {
    defer wg.Done()
loop:
    for {
        select {
        case <-ctx.Done():
            fmt.Println("worker: context cancelled")
            break loop
        case j, ok := <-jobs:
            if !ok {
                break loop // jobs channel closed
            }
            fmt.Println("worker: processing job", j)
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    jobs := make(chan int, 5)
    var wg sync.WaitGroup

    wg.Add(1)
    go worker(ctx, jobs, &wg)

    jobs <- 1
    jobs <- 2
    cancel()   // signals worker to stop
    wg.Wait()  // waits for clean exit
    fmt.Println("main: done")
}
```

---

### Q21: In a `for { select }` pattern, what is the risk of using `return` instead of a labeled `break`?

**A:** Using `return` exits the enclosing function entirely. This is often exactly what you want in a goroutine function. The risk is that any `defer` calls in the function will execute, which may or may not be desired. A labeled `break` only exits the loop, allowing code after the loop (cleanup or logging) to run before the function returns.

```go
func processLoop(ctx context.Context, ch <-chan int) {
    defer cleanup() // runs whether we return or break+fall-through
loop:
    for {
        select {
        case <-ctx.Done():
            break loop        // exits loop, cleanup runs at function end
            // vs return:     // exits function immediately, cleanup still runs (defer)
        case v := <-ch:
            handle(v)
        }
    }
    postLoopLogging() // only runs with break loop, NOT with return
}
```

---

## Scenario-Based

### Q22: Scenario — Fix the break-in-switch bug

```go
for i := 0; i < 10; i++ {
    switch i {
    case 5:
        fmt.Println("stopping at 5")
        break // intended to stop the for loop
    }
    doWork(i) // called for ALL i including 5 — bug!
}
```

`doWork(5)` still executes. Fix it without restructuring into a function.

**A:** Use a labeled `break`:

```go
package main

import "fmt"

func doWork(i int) { fmt.Println("doing work:", i) }

func main() {
loop:
    for i := 0; i < 10; i++ {
        switch i {
        case 5:
            fmt.Println("stopping at 5")
            break loop // exits the for loop
        }
        doWork(i) // only called for i = 0..4
    }
}
// Output: doing work: 0 ... doing work: 4
//         stopping at 5
```

---

### Q23: Scenario — Goroutine leak from channel break

```go
func consume() {
    ch := produce(1_000_000)
    for v := range ch {
        if v > 5 {
            break // consumer exits; producer goroutine leaks!
        }
        process(v)
    }
}
```

**A:** The `produce` goroutine keeps trying to send to `ch`. Since no one reads after `break`, the producer blocks forever (goroutine leak).

**Fix:** Use context cancellation to stop the producer:

```go
package main

import (
    "context"
    "fmt"
)

func produce(ctx context.Context, n int, ch chan<- int) {
    defer close(ch)
    for i := 0; i < n; i++ {
        select {
        case <-ctx.Done():
            return // producer exits cleanly
        case ch <- i:
        }
    }
}

func consume(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    defer cancel() // always signal producer, even on break
    ch := make(chan int, 64)
    go produce(ctx, 1_000_000, ch)
    for v := range ch {
        if v > 5 {
            break
        }
        fmt.Println(v)
    }
}
```

---

### Q24: Scenario — Design: search a 3D cube

You must search a `[][][]int` cube for a target value and return its (x, y, z) coordinates. How do you structure the break logic?

**A:** Extract to a function and use `return` — cleaner than triple-nested labeled `break`:

```go
package main

import "fmt"

func find3D(cube [][][]int, target int) (x, y, z int, found bool) {
    for i, plane := range cube {
        for j, row := range plane {
            for k, val := range row {
                if val == target {
                    return i, j, k, true
                }
            }
        }
    }
    return -1, -1, -1, false
}

func main() {
    cube := [][][]int{
        {{1, 2}, {3, 4}},
        {{5, 6}, {7, 8}},
    }
    x, y, z, ok := find3D(cube, 6)
    fmt.Println(x, y, z, ok) // 1 0 1 true
}
```

If you must stay in one function (e.g., closure over local state), triple-labeled `break` is valid:

```go
func find3DLabeled(cube [][][]int, target int) (int, int, int, bool) {
    rx, ry, rz := -1, -1, -1
outer:
    for i, plane := range cube {
        for j, row := range plane {
            for k, val := range row {
                if val == target {
                    rx, ry, rz = i, j, k
                    break outer
                }
            }
        }
    }
    return rx, ry, rz, rx >= 0
}
```

---

### Q25: Scenario — `for { select }` that never exits

```go
done := make(chan struct{})
go func() { close(done) }()

for {
    select {
    case <-done:
        fmt.Println("done")
        break // BUG: exits select, not for — loops forever!
    }
}
```

**A:** `break` exits the `select`, and the `for` re-enters `select`. `done` is already closed so `<-done` fires again immediately, creating a busy infinite loop.

**Fix:**

```go
package main

import "fmt"

func main() {
    done := make(chan struct{})
    go func() { close(done) }()

loop:
    for {
        select {
        case <-done:
            fmt.Println("done")
            break loop // exits the for loop
        }
    }
    fmt.Println("exited cleanly")
}
```

---

### Q26: Scenario — Early exit in a pipeline stage

You have a pipeline: `source → filter → sink`. The sink wants to stop after receiving 10 items and signal the filter and source to stop. How do you use `break` and context together?

**A:**

```go
package main

import (
    "context"
    "fmt"
)

func source(ctx context.Context, out chan<- int) {
    defer close(out)
    for i := 0; ; i++ {
        select {
        case <-ctx.Done():
            return
        case out <- i:
        }
    }
}

func filter(ctx context.Context, in <-chan int, out chan<- int) {
    defer close(out)
    for v := range in {
        if ctx.Err() != nil { return }
        if v%2 == 0 { // pass only even numbers
            select {
            case <-ctx.Done(): return
            case out <- v:
            }
        }
    }
}

func sink(ctx context.Context, in <-chan int, max int) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel() // propagates stop upstream when sink exits
    count := 0
    for v := range in {
        fmt.Println("sink received:", v)
        count++
        if count >= max {
            break // cancel() in defer stops source and filter
        }
    }
}

func main() {
    ctx := context.Background()
    ch1 := make(chan int, 16)
    ch2 := make(chan int, 16)
    go source(ctx, ch1)
    go filter(ctx, ch1, ch2)
    sink(ctx, ch2, 5) // stops after 5 items
}
```

---

## FAQ

### Q27: Is `break` in Go the same as in C?

**A:** Similar in loops, but importantly different in switch:
- **Loops:** Both exit the innermost loop.
- **Switch:** C requires `break` to prevent fall-through; Go has implicit break (no fall-through by default).
- **Labels:** Go has labeled `break`; C uses `goto` for the equivalent.
- **select:** Only Go has `select`; C has no equivalent.

---

### Q28: Can `break` stop a goroutine running in another goroutine?

**A:** No. `break` is a local control-flow statement affecting only the current goroutine's execution. To stop another goroutine, use a shared `context.Context`, a done channel, or a `sync/atomic` flag.

```go
// Wrong idea (does not compile):
// go func() { for { ... } }()
// break // this would refer to nothing useful

// Correct pattern:
ctx, cancel := context.WithCancel(context.Background())
go func() {
    for {
        select {
        case <-ctx.Done(): return
        default: doWork()
        }
    }
}()
cancel() // stops the goroutine
```

---

### Q29: Does `break` work inside a `defer`ed function?

**A:** `break` inside a deferred function applies to constructs within that deferred function, not to the calling function's loops. Deferred functions are independent call frames.

```go
package main

import "fmt"

func main() {
    for i := 0; i < 5; i++ {
        defer func(n int) {
            // This break would exit the for inside the defer, not the outer for
            // In this example there is no inner for, so break here would be invalid.
            fmt.Println("deferred:", n)
        }(i)
        if i == 2 {
            break // exits the outer for loop; defers for 0,1,2 are queued
        }
    }
    // Output: deferred: 2, deferred: 1, deferred: 0 (LIFO order)
}
```

---

### Q30: What happens if you use `break` to exit a `select` that contains a `default` case?

**A:** `break` in `select` always exits the `select` immediately — the `default` case has no special interaction with `break`. The `default` case only fires when no other case is ready; once `break` executes inside any case (including `default`), the `select` exits.

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    select {
    case v := <-ch:
        fmt.Println(v)
    default:
        fmt.Println("no message")
        break // exits select, continues after select statement
    }
    fmt.Println("after select") // always reached
}
```

---

### Q31: Why does `for { select { case <-done: break } }` loop forever even after `done` closes?

**A:** After `done` is closed, `<-done` returns the zero value immediately on every receive. Each call to `break` exits only the `select`, and the `for` loop immediately re-enters `select`. Since `done` is still readable (closed channel always returns zero value), the `select` picks `<-done` again — creating a tight infinite loop consuming 100 % CPU.

**Correct fix:**

```go
package main

import "fmt"

func main() {
    done := make(chan struct{})
    close(done)

loop:
    for {
        select {
        case <-done:
            fmt.Println("exiting")
            break loop // exits the for loop, not just the select
        }
    }
    fmt.Println("clean exit")
}
```
