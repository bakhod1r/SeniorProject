# break Statement — Coding Tasks

## Overview

12 coding tasks to practice and master the `break` statement in Go. Tasks are grouped by level. Each task has a Type, Goal, starter code with `// TODO` markers, expected output, and an evaluation checklist.

---

## Junior Tasks

### Task 1: Linear Search — Find First Match

**Type:** Implementation
**Difficulty:** 🟢 Easy
**Concept:** Basic `break` in `for range`
**Goal:** Find the first occurrence of a target value in a slice. Return its index or -1 if not found.

```go
package main

import "fmt"

// LinearSearch returns the index of the first occurrence of target,
// or -1 if not found. Use break to stop scanning early.
func LinearSearch(s []int, target int) int {
    // TODO: iterate over s with index
    // TODO: if s[i] == target, store index and break
    // TODO: return found index or -1
    return -1
}

func main() {
    fmt.Println(LinearSearch([]int{3, 7, 2, 9, 1}, 9)) // 3
    fmt.Println(LinearSearch([]int{3, 7, 2, 9, 1}, 5)) // -1
    fmt.Println(LinearSearch([]int{5}, 5))              // 0
}
```

**Expected Output:**
```
3
-1
0
```

**Evaluation Checklist:**
- [ ] Uses `break` to stop scanning after first match
- [ ] Returns the correct index (not the value)
- [ ] Returns -1 when not found
- [ ] No panic on empty slice

---

### Task 2: Read Until Sentinel Value

**Type:** Implementation
**Difficulty:** 🟢 Easy
**Concept:** `break` when a sentinel is encountered
**Goal:** Sum values in a slice until a sentinel value (-1) is found. Stop immediately when seen.

```go
package main

import "fmt"

// ProcessUntilSentinel returns the sum of values before the sentinel -1.
func ProcessUntilSentinel(data []int) int {
    sum := 0
    // TODO: range over data
    // TODO: if value == -1, break
    // TODO: otherwise add to sum
    return sum
}

func main() {
    fmt.Println(ProcessUntilSentinel([]int{3, 5, 7, -1, 2, 4})) // 15
    fmt.Println(ProcessUntilSentinel([]int{1, 2, 3}))            // 6
    fmt.Println(ProcessUntilSentinel([]int{-1, 5, 6}))           // 0
}
```

**Expected Output:**
```
15
6
0
```

**Evaluation Checklist:**
- [ ] Values after sentinel are not summed
- [ ] Correct result when no sentinel present
- [ ] Correct result when sentinel is first element
- [ ] No side effects on input slice

---

### Task 3: Fix the break-in-switch Bug

**Type:** Fix + Demonstration
**Difficulty:** 🟢 Easy
**Concept:** `break` in switch exits only the switch, NOT the for loop
**Goal:** The function below is supposed to stop the loop when `i == 3` but does not. Fix it.

```go
package main

import "fmt"

// buggyStopAtThree — break exits switch only, loop continues
func buggyStopAtThree() {
    for i := 0; i < 6; i++ {
        switch i {
        case 3:
            fmt.Println("Stopping at 3")
            break // BUG: exits switch, NOT the for loop
        }
        fmt.Println("i =", i) // still prints i=3 because loop continues
    }
}

// TODO: implement fixedStopAtThree so it truly stops when i == 3
// Expected output: i=0, i=1, i=2, Stopping at 3
func fixedStopAtThree() {
    // TODO: add a label before the for loop
    // TODO: use break <label> inside case 3
    for i := 0; i < 6; i++ {
        switch i {
        case 3:
            fmt.Println("Stopping at 3")
            break // TODO: change this to exit the for loop
        }
        fmt.Println("i =", i)
    }
}

func main() {
    fmt.Println("--- Buggy ---")
    buggyStopAtThree()
    fmt.Println("--- Fixed ---")
    fixedStopAtThree()
}
```

**Expected Output:**
```
--- Buggy ---
i = 0
i = 1
i = 2
Stopping at 3
i = 3
i = 4
i = 5
--- Fixed ---
i = 0
i = 1
i = 2
Stopping at 3
```

**Evaluation Checklist:**
- [ ] `buggyStopAtThree` is unchanged (demonstrates the bug)
- [ ] `fixedStopAtThree` does NOT print `i = 3` or beyond
- [ ] Uses labeled `break` in `fixedStopAtThree`
- [ ] Output matches exactly

---

### Task 4: Find First Adult with Flag Pattern

**Type:** Implementation
**Difficulty:** 🟢 Easy
**Concept:** `break` with a boolean flag (Go's for-else equivalent)
**Goal:** Find the first user with `Age >= 18`. Use a found flag so you can check whether break was used.

```go
package main

import "fmt"

type User struct {
    Name string
    Age  int
}

// findFirstAdult returns the first adult and true, or zero User and false.
func findFirstAdult(users []User) (User, bool) {
    // TODO: iterate over users
    // TODO: if user.Age >= 18, return user and true (use break and a flag, or direct return)
    return User{}, false
}

func main() {
    users := []User{{"Alice", 15}, {"Bob", 17}, {"Carol", 22}, {"Dave", 30}}
    if u, ok := findFirstAdult(users); ok {
        fmt.Printf("First adult: %s (age %d)\n", u.Name, u.Age)
    }

    minors := []User{{"Eve", 10}, {"Frank", 14}}
    if _, ok := findFirstAdult(minors); !ok {
        fmt.Println("No adult found")
    }
}
```

**Expected Output:**
```
First adult: Carol (age 22)
No adult found
```

**Evaluation Checklist:**
- [ ] Stops at Carol; does not scan Dave
- [ ] Returns the correct `User` struct
- [ ] Returns `User{}, false` for all-minors slice
- [ ] Handles empty slice

---

## Middle Tasks

### Task 5: Labeled Break — 2D Matrix Search

**Type:** Implementation
**Difficulty:** 🟡 Medium
**Concept:** Labeled `break` exits both nested loops simultaneously
**Goal:** Find a target in a `[][]int` matrix. When found, record position and break out of BOTH loops using a labeled `break`.

```go
package main

import "fmt"

type Position struct{ Row, Col int }

// FindInMatrix returns the position of target and true,
// or Position{-1,-1} and false if not found.
// Must use a labeled break (not return) to exit both loops.
func FindInMatrix(matrix [][]int, target int) (Position, bool) {
    pos := Position{-1, -1}
    found := false
    // TODO: label the outer for loop (e.g., "search:")
    // TODO: when target is found: set pos, set found=true, break search
    return pos, found
}

func main() {
    m := [][]int{
        {1, 2, 3},
        {4, 5, 6},
        {7, 8, 9},
    }
    fmt.Println(FindInMatrix(m, 5)) // {1 1} true
    fmt.Println(FindInMatrix(m, 0)) // {-1 -1} false
}
```

**Expected Output:**
```
{1 1} true
{-1 -1} false
```

**Evaluation Checklist:**
- [ ] Labeled `break` used (not `return`)
- [ ] Both loops exit when target is found
- [ ] Does not scan rows/cols after the match
- [ ] Correct position returned
- [ ] Handles value not in matrix

---

### Task 6: Break in Select — Timeout-Bounded Channel Reader

**Type:** Implementation
**Difficulty:** 🟡 Medium
**Concept:** Labeled `break` in `for { select { ... } }`
**Goal:** Read from a channel, stopping after collecting `max` items OR when a timer fires. Return collected items.

```go
package main

import (
    "fmt"
    "time"
)

// CollectWithTimeout reads from src until max items collected or timeout fires.
func CollectWithTimeout(src <-chan int, timeout time.Duration, max int) []int {
    result := make([]int, 0, max)
    timer := time.NewTimer(timeout)
    defer timer.Stop()

    // TODO: label a for loop as "collect:"
    // TODO: use select:
    //   case v := <-src: append v; if len(result) >= max, break collect
    //   case <-timer.C: break collect
    return result
}

func main() {
    ch := make(chan int, 10)
    for i := 1; i <= 10; i++ {
        ch <- i
    }

    items := CollectWithTimeout(ch, 50*time.Millisecond, 5)
    fmt.Println("collected:", items) // [1 2 3 4 5]
}
```

**Expected Output:**
```
collected: [1 2 3 4 5]
```

**Evaluation Checklist:**
- [ ] Labeled `break` used to exit `for` from inside `select`
- [ ] Stops at exactly `max` items when channel has more
- [ ] Stops on timeout when fewer items are available
- [ ] `timer.Stop()` called (no resource leak)
- [ ] Returns correct slice

---

### Task 7: Multiple Break Conditions — Log Parser

**Type:** Implementation
**Difficulty:** 🟡 Medium
**Concept:** Multiple distinct `break` points, each recording a stop reason
**Goal:** Validate log lines. Stop processing on: empty line, line starting with "ERROR", or after `maxLines`. Return count of valid lines and the stop reason.

```go
package main

import (
    "fmt"
    "strings"
)

type StopReason string

const (
    ReasonComplete StopReason = "complete"
    ReasonEmpty    StopReason = "empty_line"
    ReasonError    StopReason = "error_line"
    ReasonMax      StopReason = "max_lines"
)

func ParseLogs(lines []string, maxLines int) (int, StopReason) {
    valid := 0
    reason := ReasonComplete
    // TODO: iterate over lines
    // TODO: if valid >= maxLines: reason=ReasonMax, break
    // TODO: if line == "": reason=ReasonEmpty, break
    // TODO: if strings.HasPrefix(line, "ERROR"): reason=ReasonError, break
    // TODO: otherwise: valid++
    return valid, reason
}

func main() {
    logs1 := []string{
        "INFO: started",
        "INFO: connected",
        "ERROR: disk full",
        "INFO: ignored",
    }
    n, r := ParseLogs(logs1, 10)
    fmt.Printf("valid=%d reason=%s\n", n, r)

    logs2 := []string{"line1", "line2", "line3", "line4"}
    n2, r2 := ParseLogs(logs2, 2)
    fmt.Printf("valid=%d reason=%s\n", n2, r2)
}
```

**Expected Output:**
```
valid=2 reason=error_line
valid=2 reason=max_lines
```

**Evaluation Checklist:**
- [ ] Correct stop reason returned for all scenarios
- [ ] Lines AFTER the stop trigger are not counted
- [ ] `maxLines` limit respected
- [ ] "ERROR" line itself is not counted as valid
- [ ] Handles empty input

---

### Task 8: Retry with Break on Success

**Type:** Implementation
**Difficulty:** 🟡 Medium
**Concept:** `break` on success in a fixed-iteration loop
**Goal:** Retry a function up to `maxAttempts` times. Break immediately on success (nil error). Return the final error or nil.

```go
package main

import "fmt"

// Retry calls fn up to maxAttempts times.
// It breaks immediately when fn returns nil.
// Returns nil if any attempt succeeded, or the last error.
func Retry(maxAttempts int, fn func() error) error {
    var lastErr error
    // TODO: for i := 0; i < maxAttempts; i++
    // TODO: call fn(); store result in lastErr
    // TODO: if lastErr == nil: break (success!)
    return lastErr
}

func main() {
    attempts := 0
    err := Retry(5, func() error {
        attempts++
        if attempts >= 3 {
            return nil // succeed on 3rd attempt
        }
        return fmt.Errorf("attempt %d failed", attempts)
    })
    fmt.Printf("err=%v attempts=%d\n", err, attempts)
    // err=<nil> attempts=3
}
```

**Expected Output:**
```
err=<nil> attempts=3
```

**Evaluation Checklist:**
- [ ] `break` stops retrying immediately on success
- [ ] Function is called exactly 3 times (not 5)
- [ ] Returns `nil` on success
- [ ] Returns the last error if all attempts fail
- [ ] Handles `maxAttempts=0` gracefully

---

## Senior Tasks

### Task 9: Pipeline with Early Termination on Error

**Type:** Implementation
**Difficulty:** 🔴 Hard
**Concept:** `break` to stop a processing pipeline on first error
**Goal:** Process each item in a slice through a `transform` function. Stop immediately on the first error. Return all results up to and including the error.

```go
package main

import "fmt"

type Result struct {
    Input  int
    Output int
    Err    error
}

// ProcessPipeline applies transform to each item.
// Stops on first error (including that error result in the output).
func ProcessPipeline(items []int, transform func(int) (int, error)) []Result {
    results := make([]Result, 0, len(items))
    // TODO: range over items
    // TODO: call transform(item)
    // TODO: append Result{item, out, err}
    // TODO: if err != nil: break (stop pipeline)
    return results
}

func main() {
    res := ProcessPipeline(
        []int{1, 2, 3, -4, 5},
        func(n int) (int, error) {
            if n < 0 {
                return 0, fmt.Errorf("negative input: %d", n)
            }
            return n * 2, nil
        },
    )
    for _, r := range res {
        fmt.Printf("in=%d out=%d err=%v\n", r.Input, r.Output, r.Err)
    }
}
```

**Expected Output:**
```
in=1 out=2 err=<nil>
in=2 out=4 err=<nil>
in=3 out=6 err=<nil>
in=-4 out=0 err=negative input: -4
```

**Evaluation Checklist:**
- [ ] Item 5 is NOT processed
- [ ] Error result IS included in output
- [ ] Returns exactly 4 results
- [ ] `transform` called exactly 4 times
- [ ] Handles all-success input (no break needed)

---

### Task 10: Break from Channel Range with Context

**Type:** Concurrency
**Difficulty:** 🔴 Hard
**Concept:** Labeled `break` in `for { select }` for graceful shutdown
**Goal:** Read from a channel until: channel closes, `maxItems` reached, or context cancelled. Use labeled `break` for all exit conditions.

```go
package main

import (
    "context"
    "fmt"
)

// ReadUntil collects at most maxItems from ch, stopping if ctx is cancelled.
func ReadUntil(ctx context.Context, ch <-chan int, maxItems int) []int {
    items := make([]int, 0, maxItems)
    // TODO: label a for loop as "read:"
    // TODO: select:
    //   case <-ctx.Done(): break read
    //   case v, ok := <-ch:
    //     if !ok: break read
    //     items = append(items, v)
    //     if len(items) >= maxItems: break read
    return items
}

func main() {
    ch := make(chan int, 10)
    for i := 1; i <= 8; i++ {
        ch <- i
    }
    close(ch)

    items := ReadUntil(context.Background(), ch, 5)
    fmt.Println(items) // [1 2 3 4 5]

    ch2 := make(chan int, 10)
    for i := 1; i <= 3; i++ {
        ch2 <- i
    }
    close(ch2)
    items2 := ReadUntil(context.Background(), ch2, 10)
    fmt.Println(items2) // [1 2 3]
}
```

**Expected Output:**
```
[1 2 3 4 5]
[1 2 3]
```

**Evaluation Checklist:**
- [ ] Labeled `break` used for all three exit conditions
- [ ] Stops at `maxItems` when channel has more
- [ ] Stops when channel closes (fewer items than max)
- [ ] Stops when context is cancelled
- [ ] No goroutine leak

---

### Task 11: Break in 3D Slice Search

**Type:** Implementation
**Difficulty:** 🔴 Hard
**Concept:** Labeled `break` across three levels of nesting
**Goal:** Search a `[][][]int` for a target value. Must use labeled `break` (not `return`) to exit all three loops.

```go
package main

import "fmt"

// Search3D finds target in cube using labeled break (not return).
// Returns (x, y, z, true) if found, or (-1, -1, -1, false) otherwise.
func Search3D(cube [][][]int, target int) (x, y, z int, found bool) {
    x, y, z = -1, -1, -1
    // TODO: label the outermost for loop (e.g., "outer:")
    // TODO: iterate i over cube
    // TODO:   iterate j over cube[i]
    // TODO:     iterate k over cube[i][j]
    // TODO:       if cube[i][j][k] == target:
    //               set x,y,z = i,j,k; set found=true; break outer
    return
}

func main() {
    cube := [][][]int{
        {{1, 2}, {3, 4}},
        {{5, 6}, {7, 8}},
        {{9, 10}, {11, 12}},
    }
    fmt.Println(Search3D(cube, 7))  // 1 1 0 true
    fmt.Println(Search3D(cube, 99)) // -1 -1 -1 false
}
```

**Expected Output:**
```
1 1 0 true
-1 -1 -1 false
```

**Evaluation Checklist:**
- [ ] Uses labeled `break` on outermost loop (not `return`)
- [ ] All three loops exit when target found
- [ ] Correct (x, y, z) coordinates returned
- [ ] `found=false` when target absent
- [ ] Does not scan beyond the found position

---

### Task 12: Mini Project — Event Loop with Multiple Break Conditions

**Type:** Mini Project
**Difficulty:** 🔴 Hard
**Concept:** Labeled `break` in a production-style event loop
**Goal:** Implement an event loop that processes events from a channel. Exit on: "shutdown" event, `maxEvents` processed, or context cancelled. Return event count and stop reason.

```go
package main

import (
    "context"
    "fmt"
    "time"
)

type Event struct {
    Type    string
    Payload interface{}
}

// EventLoop processes events until shutdown, maxEvents, or ctx cancellation.
// Returns count of processed events and reason string.
func EventLoop(ctx context.Context, events <-chan Event, maxEvents int) (int, string) {
    count := 0
    reason := "unknown"
    // TODO: label a for loop as "loop:"
    // TODO: select:
    //   case <-ctx.Done(): reason = "cancelled"; break loop
    //   case ev, ok := <-events:
    //     if !ok: reason = "channel_closed"; break loop
    //     if ev.Type == "shutdown": reason = "shutdown"; break loop
    //     count++
    //     if count >= maxEvents: reason = "max_events"; break loop
    return count, reason
}

func main() {
    ctx := context.Background()
    ch := make(chan Event, 10)

    go func() {
        for i := 0; i < 5; i++ {
            ch <- Event{Type: "data", Payload: i}
        }
        ch <- Event{Type: "shutdown", Payload: nil}
        ch <- Event{Type: "data", Payload: 999} // should never be processed
    }()

    time.Sleep(5 * time.Millisecond) // let goroutine fill the buffer
    n, reason := EventLoop(ctx, ch, 10)
    fmt.Printf("processed=%d reason=%s\n", n, reason)
    // processed=5 reason=shutdown

    // Test maxEvents
    ch2 := make(chan Event, 10)
    for i := 0; i < 10; i++ {
        ch2 <- Event{Type: "data", Payload: i}
    }
    n2, reason2 := EventLoop(ctx, ch2, 3)
    fmt.Printf("processed=%d reason=%s\n", n2, reason2)
    // processed=3 reason=max_events
}
```

**Expected Output:**
```
processed=5 reason=shutdown
processed=3 reason=max_events
```

**Evaluation Checklist:**
- [ ] Labeled `break` used for all exit conditions
- [ ] "shutdown" event is NOT counted in processed events
- [ ] Data event after "shutdown" is never processed
- [ ] `maxEvents` respected
- [ ] Context cancellation handled
- [ ] Correct reason returned for each scenario

---

## Questions

### Q1: Why does `break` inside a `switch` not exit the surrounding `for` loop?

`break` always exits the innermost construct. In Go, `switch` is a distinct construct from `for`, so `break` inside `switch` exits the `switch`. The `for` loop sees `break` as not applicable to itself and continues. Use a labeled `break` to target the `for` specifically.

### Q2: When should you prefer `return` over a labeled `break`?

Prefer `return` when:
- The nested loops are inside a function and you want to return a value immediately.
- There is no code to run after the loop in the calling function.
- Extracting to a function makes the code more testable.

Use labeled `break` when:
- You need to run post-loop cleanup code in the same function.
- You are inside a closure and cannot return from the outer function.
- The logic is too tightly coupled to extract cleanly.

### Q3: What is the difference between labeled `break` and `goto`?

Labeled `break` exits a specific construct (loop, switch, select) and continues at the statement after it — always forward movement in code. `goto` jumps to any labeled statement in the same function, including backward jumps that could create arbitrary loops. Go permits `goto` but discourages it; labeled `break` is the idiomatic tool for nested-loop exits.

---

## Summary Table

| Task | Difficulty | Key Concept |
|------|------------|-------------|
| 1 — Linear Search | 🟢 | Plain `break` in range loop |
| 2 — Sentinel Value | 🟢 | `break` on sentinel |
| 3 — Switch Bug Fix | 🟢 | `break` in switch exits switch only |
| 4 — First Adult | 🟢 | Flag + `break` (for-else pattern) |
| 5 — Matrix Search | 🟡 | Labeled `break` (2 nested loops) |
| 6 — Timeout Reader | 🟡 | Labeled `break` in `for { select }` |
| 7 — Log Parser | 🟡 | Multiple `break` conditions |
| 8 — Retry | 🟡 | `break` on success |
| 9 — Pipeline | 🔴 | `break` on first error |
| 10 — Channel Read | 🔴 | Labeled `break` + context |
| 11 — 3D Search | 🔴 | Labeled `break` (3 nested loops) |
| 12 — Event Loop | 🔴 | Production event loop `break` |
