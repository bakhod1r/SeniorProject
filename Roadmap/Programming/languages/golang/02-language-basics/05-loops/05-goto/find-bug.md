# Go `goto` Statement — Find the Bug

> **Context:** These bugs are introduced by `goto` usage. Some are compile errors caught before running. Most are runtime bugs — deadlocks, data loss, infinite loops, resource leaks — that only manifest under specific conditions. Each bug is followed by the fix, which eliminates `goto` entirely.

Each bug has a difficulty rating:
- 🟢 Easy — visible or immediate error
- 🟡 Medium — subtle behavioral issue
- 🔴 Hard — requires understanding of concurrency, resource management, or compiler behavior

---

## Bug 1 🟢 — Compile Error: Jump Over Variable Declaration

```go
package main

import "fmt"

func process(n int) {
    if n < 0 {
        goto done
    }
    result := n * 2 // BUG: goto jumps over this declaration
    fmt.Println(result)
done:
    fmt.Println("done processing")
}

func main() {
    process(5)
    process(-1)
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** This is a compile error: `goto done jumps over declaration of result`. The Go compiler prevents `goto` from jumping over a variable declaration when that variable's scope includes the label. This prevents the use of an uninitialized variable.

**Error message:**
```
./main.go:8:9: goto done jumps over declaration of result at ./main.go:10:2
```

**Fix:** Use `return` instead of `goto`, and move the declaration inside the conditional:
```go
func process(n int) {
    if n < 0 {
        fmt.Println("done processing")
        return
    }
    result := n * 2
    fmt.Println(result)
    fmt.Println("done processing")
}
```

Or use a helper:
```go
func process(n int) {
    defer fmt.Println("done processing")
    if n < 0 {
        return
    }
    fmt.Println(n * 2)
}
```

</details>

---

## Bug 2 🟢 — Compile Error: Jump Into a Block

```go
package main

import "fmt"

func classifyNumber(n int) string {
    if n >= 0 {
        goto positive // BUG: cannot jump into the if block
    }
    return "negative"
    if true {
positive:
        return "positive"
    }
    return "zero"
}

func main() {
    fmt.Println(classifyNumber(5))
    fmt.Println(classifyNumber(-3))
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** Compile error: `goto positive jumps into block`. The `positive:` label is inside an `if true { }` block. `goto` cannot jump into a block because the block's variables (if any) would be uninitialized. This is a spec restriction.

**Error message:**
```
./main.go:7:3: goto positive jumps into block starting at ./main.go:10:12
```

**Fix:** Eliminate `goto` entirely — this is a simple if-else:
```go
func classifyNumber(n int) string {
    if n > 0 {
        return "positive"
    }
    if n < 0 {
        return "negative"
    }
    return "zero"
}
```

</details>

---

## Bug 3 🟢 — Unused Label Compile Error

```go
package main

import "fmt"

func compute(values []int) int {
    total := 0
    for _, v := range values {
        if v < 0 {
            continue
        }
        total += v
    }
    return total

done: // BUG: label defined but never used
    fmt.Println("this never runs")
    return total
}

func main() {
    fmt.Println(compute([]int{1, -2, 3, -4, 5}))
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** Compile error: `label done defined and not used`. In Go, every label must be used by at least one `goto`, `break`, or `continue`. An unused label is a compile error (unlike unused variables in some languages which are warnings).

**Error message:**
```
./main.go:16:1: label done defined and not used
```

**Fix:** Remove the unused label (and the unreachable code below it):
```go
func compute(values []int) int {
    total := 0
    for _, v := range values {
        if v < 0 {
            continue
        }
        total += v
    }
    return total
}
```

</details>

---

## Bug 4 🟡 — `goto` Bypasses Critical Business Logic

```go
package main

import (
    "fmt"
    "time"
)

type Order struct {
    ID     int
    Amount float64
    Status string
}

var orders []Order

func processOrder(o Order) error {
    if o.Amount <= 0 {
        goto done // BUG: skips all processing, including mandatory audit
    }

    // Process the order
    o.Status = "processed"
    orders = append(orders, o)

    // MANDATORY: audit logging (added after goto was written — now bypassed!)
    fmt.Printf("[AUDIT] Order %d processed at %v\n", o.ID, time.Now())

done:
    return nil
}

func main() {
    processOrder(Order{1, 100.0, "pending"})
    processOrder(Order{2, -5.0, "pending"})   // skips audit
    processOrder(Order{3, 0.0, "pending"})    // skips audit

    fmt.Printf("\nProcessed %d orders\n", len(orders))
    // Expected: 1 audit entry, 1 processed order
    // Actual: 1 audit entry (correct for order 1), but orders 2 and 3 have no audit trail
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** The `goto done` skips the audit logging. The audit logging was added AFTER the `goto done` was written, but no one moved the label. Now invalid orders (negative/zero amount) are silently ignored without any audit trail — a compliance violation.

This is the classic "`goto` makes code fragile to future modifications" problem.

**Fix:**
```go
func processOrder(o Order) error {
    if o.Amount <= 0 {
        fmt.Printf("[AUDIT] Order %d rejected (invalid amount %.2f) at %v\n",
            o.ID, o.Amount, time.Now())
        return nil
    }

    o.Status = "processed"
    orders = append(orders, o)
    fmt.Printf("[AUDIT] Order %d processed at %v\n", o.ID, time.Now())
    return nil
}
```

Now ALL orders (valid and invalid) are audited with appropriate messages.

</details>

---

## Bug 5 🟡 — `goto` Creates Infinite Loop (Missing Termination)

```go
package main

import (
    "fmt"
    "time"
)

func retryTask(maxRetries int) error {
    attempt := 0
retry:
    attempt++
    if attempt > maxRetries {
        return fmt.Errorf("exceeded max retries (%d)", maxRetries)
    }

    err := doTask()
    if err != nil {
        fmt.Printf("attempt %d failed: %v\n", attempt, err)
        time.Sleep(100 * time.Millisecond)
        goto retry
    }

    return nil
}

var failCount = 0

func doTask() error {
    failCount++
    if failCount <= 3 {
        return fmt.Errorf("temporary error %d", failCount)
    }
    return nil
}

func main() {
    // BUG: what happens if we call retryTask(2) and doTask always fails?
    // maxRetries = 2, doTask fails 3 times — attempt 3 should fail,
    // but attempt counts up to 3... and the condition is attempt > maxRetries = 2
    // So attempt=3 > 2 = true: return error. Correct.
    //
    // BUT: what if maxRetries is 0?
    err := retryTask(0)
    if err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Println("Success!")
    }
    // BUG: maxRetries=0 → attempt=1 after first increment → 1 > 0 = true → returns error
    // SUBTLE BUG: if maxRetries is 0, we still make 1 attempt (attempt becomes 1)
    // Developer expected 0 retries = no attempts, but gets 1 attempt
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** The logic is `attempt++` before the check, which means:
- `maxRetries = 0` → attempt becomes 1, checks `1 > 0` = true → returns error BUT still called `doTask()` once
- `maxRetries = N` → actually makes N+1 attempts

The semantic is "maxRetries attempts" but behavior is "maxRetries+1 attempts". With `goto`, the increment and check ordering is harder to follow than a `for` loop.

**Fix:**
```go
func retryTask(maxRetries int) error {
    for attempt := 1; attempt <= maxRetries; attempt++ {
        err := doTask()
        if err == nil {
            return nil
        }
        fmt.Printf("attempt %d/%d failed: %v\n", attempt, maxRetries, err)
        time.Sleep(time.Duration(attempt) * 100 * time.Millisecond)
    }
    return fmt.Errorf("all %d attempts failed", maxRetries)
}
```

The `for` loop makes the semantics crystal clear: `maxRetries` iterations, starting from 1.

</details>

---

## Bug 6 🟡 — `goto` Bypasses Mutex Unlock (Deadlock)

```go
package main

import (
    "fmt"
    "sync"
)

type SafeCounter struct {
    mu    sync.Mutex
    count int
}

func (c *SafeCounter) increment(delta int) error {
    c.mu.Lock()

    if delta <= 0 {
        fmt.Println("invalid delta, skipping")
        goto done // BUG: mu is never unlocked for invalid delta!
    }

    c.count += delta
    fmt.Printf("incremented by %d, total: %d\n", delta, c.count)

done:
    c.mu.Unlock() // ONLY reached from the happy path, not from goto done
    // Wait... actually both goto done and the happy path reach here.
    // Is this correct?
    return nil
}

func main() {
    c := &SafeCounter{}
    c.increment(5)
    c.increment(-1) // Will this deadlock?
    c.increment(3)
    fmt.Println("Final count:", c.count)
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Wait — is this actually a bug?** Let's trace:

Path 1 (delta > 0): Lock → check (false) → increment → `done:` → Unlock ✓
Path 2 (delta ≤ 0): Lock → check (true) → `goto done` → `done:` → Unlock ✓

Actually this code is CORRECT — both paths reach `done:` which calls Unlock. But it LOOKS like a bug because the `goto done` jumps over the happy-path code, and reviewers often assume code after `goto` is the "end" and the label is only reachable via `goto`.

**The real bug:** This is a maintenance trap. If a future developer adds code AFTER `done:` that should only run on success (e.g., metrics recording), the `goto done` will cause it to run even for failed increments.

```go
// Future code accidentally added here:
done:
    c.mu.Unlock()
    metrics.Inc("counter.incremented") // BUG: also runs for invalid delta!
    return nil
```

**Fix:** Use `defer` to make the intent unambiguous:
```go
func (c *SafeCounter) increment(delta int) error {
    c.mu.Lock()
    defer c.mu.Unlock()

    if delta <= 0 {
        fmt.Println("invalid delta, skipping")
        return nil // defer runs, mutex is unlocked
    }

    c.count += delta
    fmt.Printf("incremented by %d, total: %d\n", delta, c.count)
    return nil
}
```

</details>

---

## Bug 7 🟡 — `goto` Loop Missing Backoff (Busy Wait)

```go
package main

import (
    "fmt"
    "math/rand"
)

func fetchData() (string, error) {
    if rand.Intn(3) == 0 {
        return "data", nil
    }
    return "", fmt.Errorf("server busy")
}

func getData() string {
fetch:
    data, err := fetchData()
    if err != nil {
        fmt.Println("retrying:", err)
        goto fetch // BUG: no sleep! This is a busy wait / hot loop
    }
    return data
}

func main() {
    rand.Seed(42)
    result := getData()
    fmt.Println("Got:", result)
    // This will work eventually, but hammers the server with rapid retries
    // and potentially runs thousands of iterations per second
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** The `goto fetch` retry loop has no sleep/backoff. This creates a busy-wait loop that:
1. Burns CPU cycles
2. Hammers the remote service with rapid retries (potentially causing DDoS)
3. Does not respect rate limits

With a `for` loop, it is immediately obvious when the sleep is missing because the structure naturally draws attention to the loop body. With `goto`, the loop structure is less obvious.

**Fix:**
```go
func getData(maxRetries int) (string, error) {
    for attempt := 0; attempt < maxRetries; attempt++ {
        data, err := fetchData()
        if err == nil {
            return data, nil
        }
        backoff := time.Duration(1<<attempt) * 100 * time.Millisecond
        if backoff > 5*time.Second { backoff = 5 * time.Second }
        fmt.Printf("attempt %d failed: %v, retrying in %v\n", attempt+1, err, backoff)
        time.Sleep(backoff)
    }
    return "", fmt.Errorf("failed after %d attempts", maxRetries)
}
```

</details>

---

## Bug 8 🔴 — `goto` Skips File Handle Close (Resource Leak)

```go
package main

import (
    "bufio"
    "fmt"
    "os"
    "strings"
)

func countLines(paths []string) (int, error) {
    total := 0
    for _, path := range paths {
        f, err := os.Open(path)
        if err != nil {
            fmt.Printf("cannot open %s: %v, skipping\n", path, err)
            goto nextFile // BUG: f.Close() is never called for error case
                          // Actually f is nil here — that's OK.
                          // BUT: what if there's an error during scanning?
        }

        scanner := bufio.NewScanner(f)
        for scanner.Scan() {
            if strings.TrimSpace(scanner.Text()) != "" {
                total++
            }
            if total > 1000000 {
                goto nextFile // BUG: f is not closed here!
                              // file handle leaks until function returns
            }
        }
        f.Close() // only reached if scan completes normally

nextFile:
    }
    return total, nil
}

func main() {
    count, _ := countLines([]string{"a.txt", "b.txt"})
    fmt.Println("Lines:", count)
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** When `total > 1000000`, `goto nextFile` skips `f.Close()`. The file handle is left open. If processing many large files, this leads to file descriptor exhaustion (`too many open files` error).

The `goto nextFile` in the error case (when `os.Open` fails) is actually safe because `f` is `nil` and `f.Close()` would panic, but we never reach `f.Close()` for that path anyway.

**Fix:** Extract to a function, use `defer`:
```go
func countLines(paths []string) (int, error) {
    total := 0
    for _, path := range paths {
        n, err := countLinesInFile(path, 1000000-total)
        if err != nil {
            fmt.Printf("cannot process %s: %v, skipping\n", path, err)
            continue
        }
        total += n
        if total >= 1000000 {
            break
        }
    }
    return total, nil
}

func countLinesInFile(path string, limit int) (int, error) {
    f, err := os.Open(path)
    if err != nil {
        return 0, err
    }
    defer f.Close() // always closed when this function returns

    count := 0
    scanner := bufio.NewScanner(f)
    for scanner.Scan() {
        if strings.TrimSpace(scanner.Text()) != "" {
            count++
        }
        if count >= limit {
            break
        }
    }
    return count, scanner.Err()
}
```

</details>

---

## Bug 9 🔴 — `goto` in Concurrent Code: Data Race

```go
package main

import (
    "fmt"
    "sync"
)

var (
    mu      sync.Mutex
    results = make(map[string]int)
)

func processItem(key string, value int) {
    if value < 0 {
        goto skip // BUG: skips metric recording after lock is already acquired
    }

    mu.Lock()
    results[key] += value
    mu.Unlock()

    // Metrics recorded OUTSIDE the lock (correct)
    fmt.Printf("processed %s: +%d\n", key, value)
    return

skip:
    // BUG: metrics for skipped items are not recorded under the lock,
    // but the REAL bug is: if goto is placed AFTER mu.Lock(), we leak the lock
    fmt.Printf("skipped %s: %d\n", key, value)
}

// WORSE version that actually causes a deadlock:
func processItemBad(key string, value int) {
    mu.Lock()
    if value < 0 {
        goto skip // BUG: goto skips mu.Unlock()!
    }
    results[key] += value
    mu.Unlock()
    return

skip:
    fmt.Printf("skipped %s: %d\n", key, value) // deadlock on next call!
}

func main() {
    var wg sync.WaitGroup
    items := []struct{ key string; value int }{
        {"a", 1}, {"b", -2}, {"c", 3}, {"d", -4},
    }
    for _, item := range items {
        wg.Add(1)
        go func(k string, v int) {
            defer wg.Done()
            processItemBad(k, v) // Will deadlock after first negative value
        }(item.key, item.value)
    }
    wg.Wait()
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug in `processItemBad`:** `mu.Lock()` is called, then if `value < 0`, `goto skip` jumps to after `mu.Unlock()`. The mutex is locked but never unlocked. The next goroutine that calls `processItemBad` will deadlock at `mu.Lock()`.

This is a classic "goto bypasses unlock" deadlock.

**Fix:**
```go
func processItem(key string, value int) {
    if value < 0 {
        fmt.Printf("skipped %s: %d\n", key, value)
        return
    }

    mu.Lock()
    defer mu.Unlock() // defer prevents forgetting to unlock on any path
    results[key] += value
    fmt.Printf("processed %s: +%d\n", key, value)
}
```

The `defer mu.Unlock()` eliminates the entire class of "forgot to unlock before goto" bugs.

</details>

---

## Bug 10 🔴 — `goto` Creates Non-Reducible Control Flow

```go
package main

import "fmt"

// This creates a non-reducible control flow graph:
// L2 has two entry points (sequential and via goto from L1)
func nonReducible(a, b bool) string {
    if a {
        goto L1
    }
L2:
    if b {
        return "b-only"
    }
    return "neither"

L1:
    if !b {
        goto L2 // Creates a loop: L1 → L2 → L1 (via re-entry)
    }
    return "a-and-b"
}

func main() {
    fmt.Println(nonReducible(false, false)) // neither
    fmt.Println(nonReducible(false, true))  // b-only
    fmt.Println(nonReducible(true, true))   // a-and-b
    fmt.Println(nonReducible(true, false))  // ???
    // Trace: a=true → goto L1 → b is false → goto L2 → b is false → "neither"
    // Output: "neither" — but this required TWO gotos to determine
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** This creates a non-reducible control flow graph — `L2` can be reached both sequentially (when `a` is false) and via `goto L2` from `L1` (when `a` is true and `b` is false). Non-reducible CFGs:

1. Disable certain compiler optimizations (e.g., some loop invariant code motion)
2. Make the function significantly harder to understand
3. Are nearly impossible to unit test completely

The function has 4 possible outputs but requires careful tracing to determine which. Let me trace all paths:
- a=false, b=false → L2 → "neither"
- a=false, b=true → L2 → "b-only"
- a=true, b=true → L1 → "a-and-b"
- a=true, b=false → L1 → `goto L2` → L2 → b=false → "neither"

**Fix:**
```go
func classify(a, b bool) string {
    switch {
    case a && b:  return "a-and-b"
    case !a && b: return "b-only"
    default:      return "neither"
    }
}
```

The `switch` version:
- Is immediately understandable
- Has reducible control flow (all cases are independent)
- Is trivially testable (one test per case)
- Is amenable to all compiler optimizations

</details>

---

## Bug 11 🔴 — `goto` Skips `defer` Setup (Resource Leak in Error Path)

```go
package main

import (
    "fmt"
    "os"
)

func processLogFile(logPath, outputPath string) error {
    logFile, err := os.Open(logPath)
    if err != nil {
        return fmt.Errorf("open log: %w", err)
    }
    // defer logFile.Close() NOT set yet — developer forgot

    outFile, err := os.Create(outputPath)
    if err != nil {
        goto cleanup
    }
    defer outFile.Close()

    // Process files...
    if err := processFiles(logFile, outFile); err != nil {
        goto cleanup
    }

    logFile.Close()
    return nil

cleanup:
    outFile.Close() // might be nil if os.Create failed!
    logFile.Close()
    return err
}

func processFiles(log, out *os.File) error { return nil }

func main() {
    err := processLogFile("/tmp/app.log", "/tmp/output.txt")
    if err != nil {
        fmt.Println("Error:", err)
    }
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Two bugs:**

1. If `os.Create(outputPath)` fails, `outFile` is `nil`. At `cleanup:`, `outFile.Close()` panics with nil pointer dereference.

2. `logFile` is never deferred — it relies on explicit calls in all paths. If a new error path is added that doesn't `goto cleanup`, `logFile` leaks.

**Fix:** Use `defer` for both files:
```go
func processLogFile(logPath, outputPath string) error {
    logFile, err := os.Open(logPath)
    if err != nil {
        return fmt.Errorf("open log: %w", err)
    }
    defer logFile.Close() // always closed

    outFile, err := os.Create(outputPath)
    if err != nil {
        return fmt.Errorf("create output: %w", err)
    }
    defer outFile.Close() // always closed

    if err := processFiles(logFile, outFile); err != nil {
        return fmt.Errorf("process: %w", err)
    }

    return nil
}
```

All error paths are handled by `defer`. Adding new error checks in the future is safe — `defer` handles them all.

</details>

---

## Bug 12 🔴 — `goto` Bypasses Metrics in Distributed Tracing

```go
package main

import (
    "fmt"
    "time"
)

type Span struct {
    name      string
    startTime time.Time
    duration  time.Duration
}

var completedSpans []Span

func startSpan(name string) *Span {
    return &Span{name: name, startTime: time.Now()}
}

func endSpan(s *Span) {
    s.duration = time.Since(s.startTime)
    completedSpans = append(completedSpans, *s)
}

func processRequests(requests []string) {
    for _, req := range requests {
        span := startSpan("process." + req)

        if req == "" {
            fmt.Println("empty request, skipping")
            goto next // BUG: span never ended — memory leak in tracing backend
        }

        if len(req) > 100 {
            fmt.Println("request too long, skipping:", req[:20])
            goto next // BUG: span never ended
        }

        fmt.Println("processing:", req)
        time.Sleep(1 * time.Millisecond) // simulate work
        endSpan(span)

    next:
    }

    fmt.Printf("\nCompleted spans: %d (expected: %d)\n",
        len(completedSpans), len(requests))
}

func main() {
    processRequests([]string{"hello", "", "world", "x"})
}
```

**What is the bug?**

<details>
<summary>Explanation & Fix</summary>

**Bug:** When `goto next` is taken (empty request or too-long request), `endSpan(span)` is never called. This causes:
1. Orphaned spans in the tracing backend (memory leak)
2. Missing latency data for rejected requests
3. The span count (`completedSpans`) is less than the request count, causing misleading metrics

**Fix:** End the span before each `goto` — better: use a closure or extracted function with `defer`:
```go
func processRequests(requests []string) {
    for _, req := range requests {
        processOne(req)
    }
    fmt.Printf("\nCompleted spans: %d\n", len(completedSpans))
}

func processOne(req string) {
    span := startSpan("process." + req)
    defer endSpan(span) // always ends, regardless of return path

    if req == "" {
        fmt.Println("empty request, skipping")
        return // defer runs → span ended
    }

    if len(req) > 100 {
        fmt.Println("request too long, skipping")
        return // defer runs → span ended
    }

    fmt.Println("processing:", req)
    time.Sleep(1 * time.Millisecond)
}
```

</details>
