# Go for Loop (C-style) — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: How many loop keywords does Go have? How does it replace while and do-while?**

**Answer**: Go has exactly **one** loop keyword: `for`. It replaces all loop types:

```go
// C-style for:
for i := 0; i < n; i++ { }

// While equivalent (condition only):
for condition { }

// Do-while equivalent (infinite + condition at end):
for {
    doWork()
    if shouldStop() { break }
}

// Infinite loop:
for { }
```

Go's designers chose a single keyword to keep the language minimal and consistent.

---

**Q2: What are the three components of a C-style for loop, and are they all required?**

**Answer**: The three components are: `init`, `condition`, and `post`. None are required — all are optional:

```go
for init; condition; post { }  // all three
for ; condition; { }           // condition only (semicolons required)
for condition { }              // condition only (no semicolons)
for { }                        // no components — infinite loop
```

You can omit any combination:
```go
// No init:
i := 0
for ; i < 10; i++ { }

// No post (increment in body):
for i := 0; i < 10; {
    // body
    i++
}
```

---

**Q3: What does `continue` do in a C-style for loop? What executes next?**

**Answer**: `continue` skips the remainder of the loop body and goes to the **post statement** first, then re-evaluates the condition.

```go
for i := 0; i < 5; i++ {
    if i == 2 {
        continue  // goes to: i++, then i < 5 check
    }
    fmt.Println(i)
}
// Output: 0 1 3 4
// Note: i++ still runs for i=2, making i=3 next iteration
```

This is different from Python's `continue`, which goes directly to the next condition check (no post statement in Python's for).

---

**Q4: What does `break` do inside a for loop inside a switch? Does it exit the loop?**

**Answer**: `break` exits the **innermost** enclosing `for`, `switch`, or `select`. If `break` is inside a switch that is inside a for loop, it exits only the switch — the for loop continues.

```go
for i := 0; i < 5; i++ {
    switch i {
    case 3:
        break  // exits the switch, NOT the for loop!
    }
    fmt.Println(i)  // prints 0,1,2,3,4
}

// To exit the for loop from inside the switch, use a label:
loop:
for i := 0; i < 5; i++ {
    switch i {
    case 3:
        break loop  // exits the for loop
    }
    fmt.Println(i)  // prints 0,1,2
}
```

---

**Q5: What is the scope of the loop variable declared in the init statement?**

**Answer**: A variable declared in the init statement (`i := 0`) is scoped to the for loop block — it is not accessible after the loop ends.

```go
for i := 0; i < 5; i++ {
    fmt.Println(i)  // i accessible here
}
fmt.Println(i)  // COMPILE ERROR: undefined: i

// If you need i after the loop, declare it outside:
i := 0
for ; i < 5; i++ { }
fmt.Println(i)  // 5 — accessible here
```

---

**Q6: Write a countdown from 10 to 0 using a for loop.**

**Answer**:
```go
for i := 10; i >= 0; i-- {
    fmt.Printf("%d ", i)
}
// Output: 10 9 8 7 6 5 4 3 2 1 0
```

Key: use `i--` in the post statement and `i >= 0` (not `i > 0`) to include 0.

---

**Q7: How do you use two variables in a single for loop?**

**Answer**:
```go
// Two variables, converging (two-pointer)
for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
    s[i], s[j] = s[j], s[i]  // reverse s
}

// Two counters
for i, j := 0, 0; i < n; i, j = i+1, j+2 {
    // i increments by 1, j by 2
}
```

Note: you use `i, j = ...` in the post statement (assignment), not `:=` (declaration).

---

## Middle Level Questions

**Q8: Explain the goroutine variable capture problem with C-style for loops. How do you fix it?**

**Answer**: When a goroutine is created inside a for loop and references the loop variable via a closure, all goroutines share the same variable. By the time they execute, the loop may have finished and the variable holds its final value.

```go
// BUG: all goroutines may print 5 (final value of i)
for i := 0; i < 5; i++ {
    go func() {
        fmt.Println(i)  // captures &i — NOT the value of i
    }()
}

// FIX 1: pass as function argument
for i := 0; i < 5; i++ {
    go func(i int) {
        fmt.Println(i)  // receives copy of i at call time
    }(i)
}

// FIX 2: shadow the variable
for i := 0; i < 5; i++ {
    i := i  // new variable per iteration
    go func() {
        fmt.Println(i)
    }()
}
```

Note: Go 1.22 fixed this for `for range` but NOT for C-style `for i := 0; i < n; i++`.

---

**Q9: How does labeled break/continue work? Give an example where it's necessary.**

**Answer**: A label on a `for` statement allows `break label` and `continue label` to target that specific loop, bypassing the normal "exit innermost loop" behavior.

```go
// Without label: inner break cannot exit outer loop
for i := 0; i < 3; i++ {
    for j := 0; j < 3; j++ {
        if i+j >= 3 {
            break  // only exits inner loop; outer continues
        }
    }
}

// With label: control outer loop from inner loop
outer:
for i := 0; i < 3; i++ {
    for j := 0; j < 3; j++ {
        if i*j > 2 {
            break outer     // exits outer for loop entirely
        }
        if j == 2 {
            continue outer  // skip rest of inner loop, go to next i
        }
        fmt.Printf("(%d,%d) ", i, j)
    }
}
```

---

**Q10: What is the difference between `for i := 0; i < len(s); i++` and caching the length?**

**Answer**:
```go
// Without caching: len(s) is re-evaluated each iteration
for i := 0; i < len(s); i++ { }

// With caching: len(s) evaluated once
for i, n := 0, len(s); i < n; i++ { }
```

In practice, the Go compiler recognizes that `len(s)` for a simple slice is a read of a struct field (not a function call with side effects) and often optimizes it. However:
- For non-trivial expressions in the condition (function calls, computed values), caching is important.
- Explicit caching documents intent — makes it clear the length won't change.
- If you append to `s` inside the loop, `len(s)` changes each iteration — caching would break the intent!

---

**Q11: How would you implement a retry mechanism with exponential backoff using a for loop?**

**Answer**:
```go
import (
    "math"
    "time"
    "fmt"
)

func withRetry(maxAttempts int, fn func() error) error {
    var lastErr error
    for attempt := 0; attempt < maxAttempts; attempt++ {
        lastErr = fn()
        if lastErr == nil {
            return nil
        }
        if attempt < maxAttempts-1 {
            backoff := time.Duration(math.Pow(2, float64(attempt))) * 100 * time.Millisecond
            if backoff > 30*time.Second {
                backoff = 30 * time.Second
            }
            fmt.Printf("attempt %d failed: %v. Retrying in %v\n", attempt+1, lastErr, backoff)
            time.Sleep(backoff)
        }
    }
    return fmt.Errorf("all %d attempts failed; last error: %w", maxAttempts, lastErr)
}
```

---

**Q12: What happens to `defer` statements inside a for loop?**

**Answer**: Each iteration's `defer` is pushed onto the function's defer stack. They all execute when the function returns (not when the loop body ends), in LIFO order.

```go
func example() {
    for i := 0; i < 3; i++ {
        defer fmt.Println(i)  // captures i by VALUE at time of defer
    }
}
// Output: 2 1 0 (defers execute at function return, LIFO order)

// WARNING: defer in a loop that runs many times → large defer stack
// Use an inner function to scope the defer:
for i := 0; i < n; i++ {
    func() {
        f := openFile(i)
        defer f.Close()  // closes at end of INNER function, not outer
        processFile(f)
    }()
}
```

---

## Senior Level Questions

**Q13: Explain bounds check elimination (BCE) and how to write loops that trigger it.**

**Answer**: The Go compiler eliminates bounds checks (`s[i]` index validation) when it can prove via SSA data flow that the index is always within `[0, len(s))`.

```go
// BCE TRIGGERED: loop bound is len(s), index is i
func sum(s []int) int {
    total := 0
    for i := 0; i < len(s); i++ {
        total += s[i]  // bounds check eliminated
    }
    return total
}

// BCE NOT triggered: index from external source
func sumIndexed(s, indices []int) int {
    total := 0
    for i := 0; i < len(indices); i++ {
        total += s[indices[i]]  // bounds check remains
    }
    return total
}

// BCE triggered via pre-checks:
func sumWithPrecheck(s []int) int {
    if len(s) == 0 { return 0 }
    _ = s[0]         // prove s[0] is valid
    _ = s[len(s)-1]  // prove s[len-1] is valid
    total := 0
    for i := 0; i < len(s); i++ {
        total += s[i]  // BCE triggered
    }
    return total
}
```

Check: `go build -gcflags="-d=ssa/check_bce/debug=1" ./...`

---

**Q14: What is the performance impact of cache-unfriendly access in nested for loops?**

**Answer**: Modern CPUs have L1/L2/L3 caches. Sequential access patterns (row-major for Go arrays) hit the cache and cost ~4 cycles. Strided/random access patterns miss the cache and cost ~200 cycles.

```go
// Cache-friendly: row-major (sequential in memory)
for i := 0; i < rows; i++ {
    for j := 0; j < cols; j++ {
        sum += matrix[i][j]  // sequential → L1 cache hit
    }
}

// Cache-unfriendly: column-major (strided)
for j := 0; j < cols; j++ {
    for i := 0; i < rows; i++ {
        sum += matrix[i][j]  // stride = cols → cache miss
    }
}
// For 1000x1000 float64: row-major ~2ms, col-major ~10ms (5x difference)
```

Rule: **outer loop over rows, inner loop over columns** for Go/C arrays.

---

**Q15: How does the Go 1.22 loop variable change affect C-style for loops?**

**Answer**: Go 1.22 changed `for range` so each iteration gets its own loop variable (preventing goroutine capture bugs). This does NOT apply to C-style `for i := 0; i < n; i++`.

```go
// Go 1.22+ — for range: SAFE (new var per iteration)
for i, v := range slice {
    go func() { fmt.Println(v) }()  // safe: v is per-iteration copy
}

// Go 1.22+ — C-style for: STILL UNSAFE (same i shared)
for i := 0; i < n; i++ {
    go func() { fmt.Println(i) }()  // unsafe: all see final i
}

// Fix for C-style still needed:
for i := 0; i < n; i++ {
    i := i  // shadow variable
    go func() { fmt.Println(i) }()
}
```

---

**Q16: Describe a production scenario where a for loop caused a serious bug.**

**Answer**: Common production bugs:

**Scenario 1 — Goroutine leak from infinite for**:
```go
// Goroutine never exits if channel is never closed
for i := 0; i < numWorkers; i++ {
    go func() {
        for {
            work := <-jobQueue  // blocks if closed or empty
            doWork(work)
        }
    }()
}
// After job queue is retired (channel closed but goroutines not notified),
// 10,000 goroutines pile up consuming stack memory.
```

**Scenario 2 — Off-by-one corrupts data**:
```go
// BUG: i <= len(buf) accesses buf[len(buf)] — out of bounds panic
for i := 0; i <= len(buf); i++ {
    process(buf[i])  // panic at i = len(buf)
}
```

**Scenario 3 — O(n²) under load**:
```go
// Acceptable for 100 items, disaster for 100,000
for i := 0; i < len(allUsers); i++ {
    for j := 0; j < len(permissions); j++ {
        if allUsers[i].ID == permissions[j].UserID {
            // assign permission
        }
    }
}
// With 50,000 users × 50,000 permissions = 2.5 billion comparisons
// Fix: build map[int]Permission, O(n) lookup
```

---

## Scenario-Based Questions

**Scenario 1**: Review this code. What are the issues?

```go
var results []string
for i := 0; i < len(items); i++ {
    go func() {
        result := processItem(items[i])
        results = append(results, result)
    }()
}
```

**Answer**: Three bugs:
1. Goroutine captures `i` by reference — all goroutines may use the final value of `i`.
2. Goroutines capture `items` — if `items` is modified, concurrent read is a data race.
3. Concurrent writes to `results` without synchronization — data race.

**Fix**:
```go
var mu sync.Mutex
var wg sync.WaitGroup
results := make([]string, len(items))  // pre-allocate for index-based write

for i := 0; i < len(items); i++ {
    wg.Add(1)
    go func(idx int, item Item) {
        defer wg.Done()
        result := processItem(item)
        results[idx] = result  // write to pre-allocated position — no race
        // (if result ordering matters; otherwise use mutex+append)
    }(i, items[i])  // pass by value
}
wg.Wait()
```

---

**Scenario 2**: This binary search is wrong. Fix it.

```go
func binarySearch(s []int, target int) int {
    lo, hi := 0, len(s)
    for lo < hi {
        mid := (lo + hi) / 2  // potential overflow
        if s[mid] == target {
            return mid
        } else if s[mid] < target {
            lo = mid
        } else {
            hi = mid
        }
    }
    return -1
}
```

**Answer**: Three bugs:
1. `hi := len(s)` should be `len(s) - 1` (or use `lo <= hi` loop form).
2. `(lo + hi) / 2` overflows for large indices — use `lo + (hi-lo)/2`.
3. `lo = mid` can create an infinite loop when `lo == mid`.

**Fix**:
```go
func binarySearch(s []int, target int) int {
    lo, hi := 0, len(s)-1
    for lo <= hi {
        mid := lo + (hi-lo)/2  // safe: no overflow
        if s[mid] == target {
            return mid
        } else if s[mid] < target {
            lo = mid + 1  // not mid: avoids infinite loop
        } else {
            hi = mid - 1
        }
    }
    return -1
}
```

---

**Scenario 3**: Design a concurrent pipeline with bounded parallelism.

```go
// Process a large slice with at most `workers` goroutines at a time
func processBounded(items []Item, maxWorkers int, fn func(Item) Result) []Result {
    results := make([]Result, len(items))
    sem := make(chan struct{}, maxWorkers)
    var wg sync.WaitGroup

    for i := 0; i < len(items); i++ {
        wg.Add(1)
        sem <- struct{}{}
        go func(idx int, item Item) {
            defer func() {
                <-sem
                wg.Done()
            }()
            results[idx] = fn(item)
        }(i, items[i])
    }

    wg.Wait()
    return results
}
```

---

## FAQ

**Q: Should I use `for i := 0; i < len(s); i++` or `for _, v := range s`?**

**A**: Use `for range` for simple sequential iteration where you need the values. Use C-style `for` when:
- You need to skip elements or modify the index
- You need step sizes != 1
- You're doing two-pointer operations
- You need precise control over the iteration

**Q: Is there any performance difference between for-range and C-style for?**

**A**: For simple slice iteration, the compiler generates essentially the same code. The difference is negligible. Benchmark before optimizing.

**Q: Can I use `break` with a value like in Rust?**

**A**: No. Go's `break` exits the loop without a value. To return a result from a loop, use a variable declared before the loop or an inner function with `return`.

**Q: What is the difference between `for { }` and `for ; ; { }`?**

**A**: Identical. Both are infinite loops. `for { }` is idiomatic in Go.

**Q: When should I use a labeled continue vs restructuring the loop?**

**A**: Use labeled `continue` when the logic is genuinely about skipping to the next outer iteration and a restructuring would be more complex. If you find yourself using many labels, it's often a sign the loop should be extracted to a function.

**Q: Does Go have `do-while` loops?**

**A**: No. Simulate with `for { body; if !cond { break } }`.

```go
// do-while equivalent
for {
    doWork()
    if !shouldContinue() {
        break
    }
}
```

**Q: What happens if I return from inside a for loop?**

**A**: The function returns immediately. Any pending defers run before the function exits. Unexecuted loop iterations are skipped.

**Q: Can the loop condition be a function call?**

**A**: Yes, but the function is called every iteration:
```go
for i := 0; i < computeMax(); i++ {  // computeMax() called every iteration!
    // Cache it:
}
// Better:
max := computeMax()
for i := 0; i < max; i++ { }
```

**Q: What is the fastest way to iterate over a slice in Go?**

**A**: For reading values, `for range` and C-style for are equivalent after compilation. For write-heavy operations with BCE, C-style `for i := 0; i < len(s); i++` may have slightly fewer bounds checks.

**Q: Can you have nested labeled loops with multiple levels of break/continue?**

**A**: Yes:
```go
L1:
    for i := 0; i < n; i++ {
L2:
        for j := 0; j < m; j++ {
            for k := 0; k < p; k++ {
                break L1     // exits outermost loop
                continue L2  // continues middle loop
            }
        }
    }
```
