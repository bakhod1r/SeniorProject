# Go Defer — Junior Level

## 1. Introduction

### What is it?
A **`defer` statement** schedules a function call to run **just before the surrounding function returns** — no matter how it returns (normal return, explicit `return`, or panic). It is Go's primary mechanism for guaranteed cleanup: closing files, unlocking mutexes, decrementing wait groups, releasing handles.

You can think of `defer` as "do this on the way out". Once you write `defer f.Close()` after opening a file, you no longer have to remember to close it on every return path. The runtime does it for you.

### How to use it?
```go
package main

import (
    "fmt"
    "os"
)

func main() {
    f, err := os.Open("data.txt")
    if err != nil {
        fmt.Println(err)
        return
    }
    defer f.Close() // runs when main returns, even on a later panic

    // ... read from f ...
}
```

When `main` returns, the runtime walks the deferred-call stack of the current goroutine and executes them in **last-in-first-out** order.

---

## 2. Prerequisites
- Functions basics (2.6.1)
- Multiple return values (2.6.3)
- Anonymous functions (2.6.4)
- Pointers and method receivers (for `defer m.Unlock()` style)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| defer | A statement that schedules a call to execute when the surrounding function returns |
| deferred call | A call queued by `defer`, waiting to run on function exit |
| LIFO | "Last in, first out" — the order deferred calls execute |
| argument evaluation | The point at which `defer`'s arguments are computed (at `defer`-time, not call-time) |
| panic | An abnormal termination signal; deferred calls still run |
| recover | A built-in that stops a panic; only effective inside a deferred call |
| named return value | A return parameter declared in the signature; deferred calls can modify it |
| open-coded defer | A Go 1.14+ optimization that inlines defers when their count is bounded and small |

---

## 4. Core Concepts

### 4.1 LIFO Execution Order

Deferred calls run in the **reverse** order they were registered. The most recently deferred call runs first.

```go
package main

import "fmt"

func main() {
    defer fmt.Println("1")
    defer fmt.Println("2")
    defer fmt.Println("3")
    fmt.Println("main body")
}
```

Output:
```
main body
3
2
1
```

You can picture a stack of pending calls. Each `defer` pushes onto the stack. On function exit, the runtime pops them off and runs each one.

### 4.2 Arguments Are Evaluated At `defer`-Time

This is the single biggest source of confusion for newcomers. The arguments to a deferred function are computed **immediately** — at the moment the `defer` runs — not at the moment the deferred function eventually executes.

```go
package main

import "fmt"

func main() {
    x := 10
    defer fmt.Println("deferred x =", x) // x evaluated NOW; "10" is captured
    x = 99
    fmt.Println("end of main, x =", x)
}
```

Output:
```
end of main, x = 99
deferred x = 10
```

Even though we mutated `x` to 99 before the function returned, the deferred `fmt.Println` already had `10` baked into its argument list.

If you want the deferred call to see the **latest** value, wrap it in a closure:

```go
x := 10
defer func() { fmt.Println("deferred x =", x) }()
x = 99
// prints: deferred x = 99
```

The closure captures `x` by reference (per Go closure semantics), so it reads `x` at call-time.

### 4.3 Deferred Calls Run On Panic Too

When a goroutine panics, the runtime walks up the call stack and executes deferred calls along the way. This is what makes `defer` safe for cleanup: even if your code later explodes, the file still closes, the lock still unlocks, the cleanup still happens.

```go
package main

import "fmt"

func main() {
    defer fmt.Println("clean up 1")
    defer fmt.Println("clean up 2")
    panic("boom")
}
```

Output (before the runtime prints the panic trace):
```
clean up 2
clean up 1
```

### 4.4 Defer + Named Return Values

A deferred call can **modify** the function's return value when the return values are named. This is a common pattern for wrapping errors or computing results in cleanup code.

```go
package main

import "fmt"

func add(a, b int) (sum int) {
    defer func() {
        sum *= 2 // modifies the named return value AFTER `return` has been evaluated
    }()
    sum = a + b
    return // returns 2 * (a + b)
}

func main() {
    fmt.Println(add(3, 4)) // 14
}
```

The mental model: `return` assigns to the named return values, then deferred calls run, then control leaves the function.

If the return values are unnamed, you cannot reach them from a deferred call.

### 4.5 The Resource Cleanup Pattern

The canonical use of `defer` is right next to the acquisition of a resource:

```go
func readConfig(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()

    return io.ReadAll(f)
}
```

Reading top-to-bottom, you immediately see "opened, will close". You don't need to remember to call `Close()` on every return path; one defer covers all of them.

### 4.6 Defer Inside Loops Is A Trap

Defers do not run at the end of each iteration — they run at the end of the **enclosing function**. A loop that defers per iteration accumulates deferred calls, which can leak handles, exhaust file descriptors, or balloon memory.

```go
// BAD: opens many files; none closes until the function returns.
func processAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close() // accumulates one per iter
        // ... use f ...
    }
    return nil
}
```

The fix is to extract the per-iteration work into its own function:

```go
func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil {
        return err
    }
    defer f.Close() // runs at end of processOne, every iter
    // ... use f ...
    return nil
}

func processAll(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            return err
        }
    }
    return nil
}
```

Each `processOne` call has its own defer scope.

---

## 5. Real-World Analogies

**Hotel checkout list**: when you check in, you write down "return key card" on a list. As you do other things in the hotel (check in, eat, sleep), you don't worry about the key. On checkout, the front desk reads the list bottom-up and reminds you of every promise. You always return the key, even if you're rushing out.

**Return paperwork after a meeting**: imagine a meeting with three pieces of paperwork to file as you leave (badge, receipt, security tag). You note them on your way in. You don't have to remember on the way out — the system files them in reverse order.

**Restaurant check at the end of a meal**: regardless of whether you finish the meal, walk out, or get sick mid-meal, the bill closes. The kitchen doesn't have to track every possible exit; closing happens on the way out.

---

## 6. Mental Models

```
           function entry
                │
                ▼
   ┌──────────────────────┐
   │   defer A()          │ ── push A
   │   defer B()          │ ── push B
   │   defer C()          │ ── push C
   │   ... body ...       │
   └──────────────────────┘
                │
                ▼
       (return or panic)
                │
                ▼
   pop & run C(), then B(), then A()
                │
                ▼
        leave function
```

A more concrete picture: each goroutine has a small linked list of pending defers attached to its `g` struct. Each `defer X(args)` allocates (or reuses) a record holding the function pointer and a snapshot of arguments. Function exit walks the list.

---

## 7. Pros & Cons

### Pros
- **Cleanup is local**. The acquire and release sit on adjacent lines.
- **Cannot be skipped accidentally** by an early return.
- **Runs on panic**, so resources are released during failure paths too.
- **Reads top-to-bottom** without scanning every return statement.
- **Works with named return values** to wrap errors or transform results.

### Cons
- **Per-call cost** (~30 ns historically; ~3-7 ns with Go 1.14 open-coded defer in common cases).
- **Does NOT scope to a loop iteration** — each defer is tied to the enclosing function.
- **Argument evaluation timing** is a common gotcha.
- **Stack traces** include the deferred frames, which can clutter panics.
- **Hot paths** sometimes need `unlock(); ...; lock()` instead of `defer unlock()`.

---

## 8. Use Cases

1. **File / connection close**: `defer f.Close()`, `defer conn.Close()`, `defer rows.Close()`.
2. **Mutex unlock**: `mu.Lock(); defer mu.Unlock()`.
3. **Wait-group decrement**: `wg.Add(1); go func() { defer wg.Done(); ... }()`.
4. **Tracing**: `defer trace("operation")()` — measure how long a function ran.
5. **Panic recovery**: `defer func() { if r := recover(); r != nil { ... } }()`.
6. **Error wrapping**: a deferred closure can mutate a named `err` return value.
7. **Counters and metrics**: increment on entry, decrement on exit via defer.
8. **Rolling back transactions**: `defer tx.Rollback()` (commit clears it implicitly via state).

---

## 9. Code Examples

### Example 1 — File Cleanup
```go
package main

import (
    "io"
    "os"
)

func readAll(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()
    return io.ReadAll(f)
}
```

### Example 2 — Mutex Unlock
```go
package main

import "sync"

type SafeCounter struct {
    mu sync.Mutex
    n  int
}

func (c *SafeCounter) Incr() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

### Example 3 — LIFO Demo
```go
package main

import "fmt"

func main() {
    for i := 1; i <= 3; i++ {
        defer fmt.Println("deferred", i)
    }
    fmt.Println("main body")
}
// main body
// deferred 3
// deferred 2
// deferred 1
```

### Example 4 — Argument Evaluation Time
```go
package main

import "fmt"

func main() {
    x := 1
    defer fmt.Println("at defer-time x =", x) // captures 1
    x = 100
    defer func() { fmt.Println("at exit x =", x) }() // reads at exit
    x = 999
}
// at exit x = 999
// at defer-time x = 1
```

### Example 5 — Panic-Safe Cleanup
```go
package main

import "fmt"

func dangerous() {
    defer fmt.Println("cleanup ran")
    panic("oops")
}

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    dangerous()
}
// cleanup ran
// recovered: oops
```

### Example 6 — Modifying Named Return Value
```go
package main

import "fmt"

func divide(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("divide panicked: %v", r)
        }
    }()
    return a / b, nil
}

func main() {
    fmt.Println(divide(10, 0)) // 0  divide panicked: runtime error: integer divide by zero
}
```

### Example 7 — Trace Helper
```go
package main

import (
    "fmt"
    "time"
)

func trace(name string) func() {
    start := time.Now()
    fmt.Println("enter", name)
    return func() {
        fmt.Println("exit", name, "took", time.Since(start))
    }
}

func work() {
    defer trace("work")()
    time.Sleep(50 * time.Millisecond)
}

func main() { work() }
```

The trick: `trace("work")` runs immediately and returns a closure. `defer ...()` defers calling that returned closure on exit.

---

## 10. Coding Patterns

### Pattern 1 — Acquire/Release
```go
mu.Lock()
defer mu.Unlock()
// critical section
```

### Pattern 2 — Open/Close
```go
f, err := os.Open(path)
if err != nil { return err }
defer f.Close()
```

### Pattern 3 — Two-Phase Commit
```go
tx, err := db.Begin()
if err != nil { return err }
defer func() {
    if err != nil {
        tx.Rollback()
    }
}()
// ... work that may set err ...
return tx.Commit()
```

### Pattern 4 — Error Annotation
```go
func work() (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("work: %w", err)
        }
    }()
    // ... work that may set err ...
    return nil
}
```

### Pattern 5 — Trace
```go
defer trace("name")()
```

---

## 11. Clean Code Guidelines

1. **Defer immediately after acquisition**. `f, _ := os.Open(p); defer f.Close()` belongs on adjacent lines.
2. **Always check the error before deferring `Close`** — otherwise you might `f.Close()` on a `nil` `f`.
3. **Keep deferred calls cheap** — they run on every exit path.
4. **Avoid defers in tight loops** — extract a helper function instead.
5. **Use a closure if you need to read late-bound state**.
6. **Don't mix recover with non-deferred functions** — `recover` only works inside a deferred call.
7. **Prefer `defer mu.Unlock()` over manual unlocks** in non-hot paths.

---

## 12. Common Mistakes (Buggy + Fixed)

### Mistake 1 — Closing an unchecked file
**Buggy:**
```go
f, err := os.Open(path)
defer f.Close()       // ← f might be nil
if err != nil { return err }
```

**Fixed:**
```go
f, err := os.Open(path)
if err != nil { return err }
defer f.Close()
```

Always confirm the resource exists before deferring its release.

### Mistake 2 — Defer inside a loop
**Buggy:**
```go
for _, p := range paths {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close()    // accumulates; doesn't run until function ends
    // ... use f ...
}
```

**Fixed:** extract to a helper.
```go
func handle(p string) error {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close()
    // ... use f ...
    return nil
}
```

### Mistake 3 — Expecting a captured arg to update
**Buggy:**
```go
i := 0
defer fmt.Println("i =", i)  // captures 0
for ; i < 5; i++ {}
// expected "i = 5"; actually prints "i = 0"
```

**Fixed:** wrap in a closure to read late:
```go
i := 0
defer func() { fmt.Println("i =", i) }()
for ; i < 5; i++ {}
// prints "i = 5"
```

### Mistake 4 — `recover` outside a deferred function
**Buggy:**
```go
func safe() {
    if r := recover(); r != nil {
        // never executes
    }
    risky()
}
```

**Fixed:** put `recover` inside a deferred function.
```go
func safe() {
    defer func() {
        if r := recover(); r != nil {
            // handles panic
        }
    }()
    risky()
}
```

### Mistake 5 — Forgetting that `defer` doesn't see updates to non-pointer args
**Buggy:**
```go
func write(b *bytes.Buffer) {
    defer log("buf size", b.Len()) // b.Len() runs NOW; later writes invisible
    b.WriteString("hello")
}
```

**Fixed:**
```go
func write(b *bytes.Buffer) {
    defer func() { log("buf size", b.Len()) }() // evaluated at exit
    b.WriteString("hello")
}
```

---

## 13. Mini Exercises

### Exercise 1 — LIFO Order
What does this print?
```go
func main() {
    defer fmt.Println("A")
    defer fmt.Println("B")
    defer fmt.Println("C")
}
```

<details><summary>Answer</summary>

```
C
B
A
```

LIFO order. The last `defer` runs first.
</details>

### Exercise 2 — Argument Evaluation
What does this print?
```go
func main() {
    x := 1
    defer fmt.Println(x)
    x = 2
}
```

<details><summary>Answer</summary>

```
1
```

`x` is evaluated when `defer` runs, capturing `1`. The later assignment to `2` does not change the captured value.
</details>

### Exercise 3 — Closure vs Argument
Predict the output.
```go
func main() {
    x := 1
    defer func() { fmt.Println("closure:", x) }()
    defer fmt.Println("arg:", x)
    x = 999
}
```

<details><summary>Answer</summary>

```
arg: 1
closure: 999
```

The "arg" form captures `x` at defer-time (value 1). The closure form reads `x` at call-time (value 999). LIFO orders the closure first to register, last to execute — so it runs after `arg`, but I wrote them in the order *closure first, then arg*. Re-check: `defer func()` was registered first; `defer fmt.Println("arg:", x)` was registered second. LIFO: arg runs first, then closure. Final order: `arg: 1` then `closure: 999`.
</details>

### Exercise 4 — File Close
Write a function that opens a file, reads its bytes, and ensures the file is closed regardless of the read result.

<details><summary>Solution</summary>

```go
func read(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()
    return io.ReadAll(f)
}
```
</details>

### Exercise 5 — Named Return Modification
Without changing `main`, make `compute` return 200.
```go
func compute() (n int) {
    // your code
    return 100
}

func main() { fmt.Println(compute()) }
```

<details><summary>Solution</summary>

```go
func compute() (n int) {
    defer func() { n *= 2 }()
    return 100
}
```

The deferred closure modifies the named return value `n` after `return 100` has assigned it.
</details>

---

## 14. Cheat Sheet

```go
// Cleanup
f, _ := os.Open(p)
defer f.Close()

// Locking
mu.Lock()
defer mu.Unlock()

// LIFO
defer A()
defer B() // runs first

// Args evaluated NOW
defer fmt.Println(x) // snapshot of x

// Args evaluated LATER (closure)
defer func() { fmt.Println(x) }() // sees latest x

// Modify named return value
func f() (err error) {
    defer func() { err = fmt.Errorf("f: %w", err) }()
    ...
}

// Recover (must be in deferred func)
defer func() {
    if r := recover(); r != nil {
        // handle
    }
}()

// Avoid in loops
for _, p := range paths {
    handle(p)              // handle uses defer internally
}
```

---

## 15. Self-Assessment Checklist

- [ ] I can describe the LIFO execution order
- [ ] I know `defer`'s arguments are evaluated at the `defer` statement, not at call-time
- [ ] I can explain when to use a closure vs a direct call
- [ ] I know deferred calls run on panic
- [ ] I can use `recover` correctly inside a deferred function
- [ ] I know how to modify a named return value from a deferred call
- [ ] I avoid `defer` inside loops by extracting helper functions
- [ ] I always verify the resource exists before deferring its release

---

## 16. Summary

`defer` schedules a function call to run when the surrounding function returns — whether by normal return, explicit `return`, or panic. Deferred calls run in LIFO order. Their arguments are evaluated at `defer`-time, not call-time; wrap in a closure to read late-bound state. Deferred calls can modify named return values, which is the basis of Go's idiomatic error-wrapping pattern. Use `defer` for resource cleanup, mutex unlocking, panic recovery, and tracing. Avoid placing `defer` inside loops; instead, extract per-iteration logic into a helper.

---

## 17. Further Reading

- [Effective Go — Defer](https://go.dev/doc/effective_go#defer)
- [Go Spec — Defer statements](https://go.dev/ref/spec#Defer_statements)
- [Go Blog — Defer, panic, recover](https://go.dev/blog/defer-panic-and-recover)
- [Go 1.14 release notes — Open-coded defer](https://go.dev/doc/go1.14#runtime)

---

## 18. Related Topics

- 2.6.4 Anonymous Functions
- 2.6.5 Closures (capture semantics applied to deferred closures)
- 2.6.6 Named Return Values
- Chapter 7 Concurrency (mutex + defer pattern)
- Panic / Recover (covered alongside defer in many texts)
