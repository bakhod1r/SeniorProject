# Go Defer — Middle Level

## 1. Introduction

At the middle level, `defer` stops being just "remember to close the file" and becomes a **design tool**. You learn when defer is the right answer and when it is not. You design APIs whose cleanup is impossible to skip. You write error-wrapping middleware that works on every return path. You think about cost — when defer is essentially free (Go 1.14 open-coded fast path) and when it shows up in profiles.

This document covers idiomatic middle-level patterns, comparisons with explicit cleanup, integration with the standard library, and "when NOT to use" guidance.

---

## 2. Prerequisites
- Junior-level defer material
- Closures and capture semantics (2.6.5)
- Named return values (2.6.6)
- Goroutines + sync primitives
- Basic understanding of panic / recover

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| open-coded defer | The Go 1.14+ fast path that inlines a small bounded number of defers without a heap record |
| stack-allocated defer | A defer whose record is allocated on the function's stack frame |
| heap-allocated defer | A defer whose record is allocated on the heap (deferred in a loop or unbounded count) |
| deferred closure | A function literal scheduled with `defer`; reads variables at exit |
| return-then-defer | The model: assign to named returns, then run defers, then leave |
| error annotation | Wrapping or augmenting an error in a deferred closure |
| trace pair | The `defer trace("name")()` pattern: outer call now, inner call on exit |
| handle exhaustion | Running out of file descriptors / DB connections by deferring in a loop |

---

## 4. Core Concepts

### 4.1 Defer Tied To Function Scope, Not Block Scope

`defer` is bound to the **enclosing function**, not the surrounding block. The following is a common surprise:

```go
func main() {
    {
        f, _ := os.Open("a")
        defer f.Close()
        // ... use f ...
    }
    // f is still open here — the defer hasn't fired yet.
    longRunningWork()
    // f closes only after main returns.
}
```

If you need block-scoped cleanup, extract the block into a function:

```go
func useFile() error {
    f, err := os.Open("a")
    if err != nil { return err }
    defer f.Close()
    return process(f)
}

func main() {
    if err := useFile(); err != nil { /* ... */ }
    longRunningWork()
}
```

### 4.2 Defer + Named Return = Error-Annotation Middleware

Named return values + a deferred closure is one of Go's most idiomatic patterns:

```go
func loadConfig(path string) (cfg *Config, err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("loadConfig %q: %w", path, err)
        }
    }()

    f, err := os.Open(path)
    if err != nil { return nil, err }
    defer f.Close()

    return parse(f)
}
```

Every error path through the function is wrapped uniformly. There is no risk of a programmer forgetting to wrap — the wrap is centralized.

### 4.3 The `defer trace(name)()` Idiom

A common helper for measuring function durations:

```go
func trace(name string) func() {
    start := time.Now()
    log.Printf("→ %s", name)
    return func() { log.Printf("← %s (%v)", name, time.Since(start)) }
}

func work() {
    defer trace("work")()
    // ...
}
```

The pattern relies on two facts:
1. `trace(name)` evaluates immediately (it's the argument to `defer`).
2. The returned closure is what gets deferred.

This is also a teaching example for "argument evaluation at defer-time".

### 4.4 Defer For Two-Phase Commit / Rollback

Common in `database/sql`:

```go
func transfer(db *sql.DB, from, to int, amt int64) (err error) {
    tx, err := db.Begin()
    if err != nil { return err }
    defer func() {
        if err != nil {
            _ = tx.Rollback()
        }
    }()

    if _, err = tx.Exec("UPDATE acct SET bal = bal - ? WHERE id = ?", amt, from); err != nil {
        return err
    }
    if _, err = tx.Exec("UPDATE acct SET bal = bal + ? WHERE id = ?", amt, to); err != nil {
        return err
    }
    return tx.Commit()
}
```

Notice we defer **before** any operation that could panic or err. If we panic, the deferred rollback still runs.

A subtle point: after `tx.Commit()` succeeds, calling `tx.Rollback()` returns an error but is harmless — the transaction is already finished. Safer libraries gate the rollback on `err != nil` so you don't log a useless "rollback after commit" error.

### 4.5 Stacking Defers For Multi-Resource Cleanup

```go
func process(in, out string) (err error) {
    inF, err := os.Open(in)
    if err != nil { return err }
    defer inF.Close()

    outF, err := os.Create(out)
    if err != nil { return err }
    defer outF.Close()

    bw := bufio.NewWriter(outF)
    defer func() {
        if flushErr := bw.Flush(); flushErr != nil && err == nil {
            err = flushErr
        }
    }()

    _, err = io.Copy(bw, inF)
    return err
}
```

Order matters here: the bufio writer's Flush must run **before** outF.Close. We achieve that by deferring Flush after Close — LIFO means Flush runs first.

The "if err == nil, capture flushErr" idiom in the Flush defer is a common pattern: don't overwrite an existing error with a cleanup-time error.

### 4.6 Defer In A Goroutine For wg.Done

```go
var wg sync.WaitGroup
for _, w := range workers {
    wg.Add(1)
    go func(w Worker) {
        defer wg.Done()
        w.Run()
    }(w)
}
wg.Wait()
```

The defer guarantees the wait group counter decrements even if `w.Run()` panics. Without the defer, a panic would leave the waitgroup hanging, deadlocking `wg.Wait()`.

### 4.7 Defer + Recover For Boundary Functions

```go
func safeHandler(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic: %v", rec)
                http.Error(w, "internal error", 500)
            }
        }()
        h.ServeHTTP(w, r)
    })
}
```

Almost every HTTP framework wraps handlers in a recovery middleware exactly like this. The deferred recover converts a panic into a 500 response and a log line, preventing one buggy handler from crashing the whole server.

`recover()` only works **inside a function called by `defer`** — calling it outside a deferred call returns `nil` and does nothing.

### 4.8 Multiple Defers + Multiple Sources Of Error

```go
func step() (err error) {
    defer wrap("step", &err)

    if err = openConn(); err != nil { return err }
    defer closeConn()

    if err = beginTx(); err != nil { return err }
    defer endTx(&err) // commits on success, rollbacks on failure

    if err = doWork(); err != nil { return err }

    return nil
}

func wrap(prefix string, err *error) {
    if *err != nil {
        *err = fmt.Errorf("%s: %w", prefix, *err)
    }
}

func endTx(err *error) {
    if *err != nil {
        rollback()
    } else {
        commit()
    }
}
```

`wrap` and `endTx` take `*error` so they can read and modify the current error state.

---

## 5. Defer vs Explicit Cleanup

| Aspect | `defer` | Explicit cleanup |
|--------|---------|------------------|
| Cleanup on every return path | Automatic | You must remember |
| Cleanup on panic | Yes | No — you skip it |
| Reads top-to-bottom | Yes | No (cleanup at bottom or duplicated) |
| Order | LIFO | You choose |
| Cost | ~3-7 ns (open-coded), ~30 ns (heap) | ~1-3 ns |
| Best for | I/O, locks, transactions | Hot inner loops, predictable single exit |

For 99% of code, defer is correct. Reach for explicit cleanup only when:
- The function has exactly one exit path AND no possibility of panic.
- You're in a microbenchmarked hot loop where defer's cost matters.
- You have a complex order requirement that LIFO doesn't suit.

---

## 6. Defer vs Return

`defer` happens between the assignment of return values and the actual control transfer back to the caller:

```
return EXPR
    │
    ▼
1. Evaluate EXPR
2. Assign to (named) return values
3. Run defers (LIFO; can mutate named returns)
4. Transfer control to caller
```

For unnamed returns, step 3 runs but cannot affect the value already saved in step 2. For named returns, defers in step 3 can modify them.

```go
func a() int {
    x := 1
    defer func() { x = 99 }() // doesn't affect return value
    return x
}
// returns 1

func b() (x int) {
    defer func() { x = 99 }() // does affect named return
    return 1
}
// returns 99
```

---

## 7. Real-World Patterns From The Standard Library

### 7.1 `net/http` — Body Close
```go
resp, err := http.Get(url)
if err != nil { return err }
defer resp.Body.Close()
```

You **must** close the response body to allow connection reuse. The Go documentation explicitly states this. `defer` is the idiomatic way.

### 7.2 `database/sql` — Rows Close
```go
rows, err := db.Query("SELECT id, name FROM users")
if err != nil { return err }
defer rows.Close()

for rows.Next() {
    // ...
}
return rows.Err()
```

`rows.Close()` releases the connection back to the pool. Forgetting it is a top source of "connection pool exhausted" outages.

### 7.3 `sync.Mutex` — Unlock
```go
mu.Lock()
defer mu.Unlock()
// critical section
```

This is so common it's a cultural fingerprint of Go code.

### 7.4 `context` — Cancel
```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()

resp, err := client.Do(req.WithContext(ctx))
```

The `cancel` function must be called to release resources, even if the timeout already fired. `defer` makes this automatic.

### 7.5 `os.File` — Close With Error Check
The simplest form ignores the close error:

```go
defer f.Close()
```

For files you write to, the close error matters (it can indicate failed flush). The right pattern uses a named return:

```go
func write(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()

    _, err = f.Write(data)
    return err
}
```

---

## 8. When NOT To Use Defer

### 8.1 Tight Hot Loops
```go
// BAD if called millions of times per second
for _, x := range items {
    func() {
        defer cleanup()
        doWork(x)
    }()
}
```

Even with open-coded defer, the cost (~3-7 ns) accumulates. If `doWork` is 50 ns and `cleanup` is 5 ns, defer is 10% of the iteration. Inline the cleanup at every exit path of `doWork`.

### 8.2 Loops That Acquire Resources
```go
// BAD
for _, p := range paths {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close() // accumulates one defer per iter
}
```

Extract a helper. You'll exhaust the OS file descriptor table before you finish 1024 paths.

### 8.3 When Cleanup Order Is Non-LIFO
If A must close before B, and you registered them as `defer A; defer B`, B runs first. Re-order or use explicit cleanup.

### 8.4 When Cleanup Must Run Before The Function Returns
A defer runs at function return. If you need cleanup partway through and want to continue executing afterwards, do not use defer.

### 8.5 In Goroutines That Live Forever
A goroutine that runs for the lifetime of the process never returns, so the defers never fire. Often this is fine (the process is dying anyway), but tools like leak detectors will report them as outstanding.

### 8.6 In `init()` Functions With Side Effects You Want Released Before `main()`
`init()` is a regular function and its defers fire when it returns — *before* main runs. If you want resource cleanup tied to program shutdown, use `signal.Notify` + a graceful-shutdown channel, not defer in `init`.

---

## 9. Worked Examples

### Example 1 — Robust File Copy
```go
func copyFile(src, dst string) (err error) {
    in, err := os.Open(src)
    if err != nil {
        return fmt.Errorf("open %q: %w", src, err)
    }
    defer in.Close()

    out, err := os.Create(dst)
    if err != nil {
        return fmt.Errorf("create %q: %w", dst, err)
    }
    defer func() {
        if cerr := out.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()

    _, err = io.Copy(out, in)
    return err
}
```

Key points:
- Two defers, one per file.
- Named return so the close error can be propagated.
- `io.Copy` errors win over close errors.

### Example 2 — Timed Operation With Tracing
```go
func dbQuery(ctx context.Context, q string) (rows *sql.Rows, err error) {
    start := time.Now()
    defer func() {
        elapsed := time.Since(start)
        if err != nil {
            metrics.Observe("db.query.failure", elapsed)
        } else {
            metrics.Observe("db.query.success", elapsed)
        }
    }()

    return db.QueryContext(ctx, q)
}
```

The deferred closure reads both `err` and elapsed time. Different metrics for success vs failure.

### Example 3 — Batch Iteration With Bounded Defers
```go
func processFiles(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            return err
        }
    }
    return nil
}

func processOne(p string) (err error) {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close()

    return process(f)
}
```

`processOne` has exactly one defer, which runs once per file. Compare to `defer f.Close()` inside the loop, which would accumulate.

### Example 4 — Recovery In An RPC Server
```go
func (s *Server) Call(ctx context.Context, req *Request) (resp *Response, err error) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("RPC panic: %v\n%s", r, debug.Stack())
            err = status.Errorf(codes.Internal, "internal error")
        }
    }()

    return s.handler.Handle(ctx, req)
}
```

If `handler.Handle` panics, the defer translates it to a clean error. The server keeps running.

### Example 5 — Mutex With A Bounded Critical Section
```go
type Cache struct {
    mu   sync.Mutex
    data map[string]string
}

func (c *Cache) Get(key string) string {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.data[key]
}

func (c *Cache) Set(key, value string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[key] = value
}
```

A textbook example. If the critical section panics, the mutex is still released.

---

## 10. Benchmarks At The Call Site

Here is a self-contained benchmark you can run:

```go
package defertest

import (
    "sync"
    "testing"
)

var mu sync.Mutex

func withDefer() {
    mu.Lock()
    defer mu.Unlock()
}

func withoutDefer() {
    mu.Lock()
    mu.Unlock()
}

func BenchmarkWithDefer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        withDefer()
    }
}

func BenchmarkWithoutDefer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        withoutDefer()
    }
}
```

Typical results on Go 1.22, amd64, M1, single-threaded:

```
BenchmarkWithDefer-8        100000000   12.5 ns/op
BenchmarkWithoutDefer-8     150000000    8.0 ns/op
```

The difference (~4 ns) is the open-coded defer fast path. Pre-Go 1.14, `withDefer` was ~30 ns slower. For 99.9% of code, this is well below noise.

---

## 11. Integration With The Standard Library

### `net/http`
- `defer resp.Body.Close()` after `http.Get`
- `defer r.Body.Close()` in handlers when you read a body
- `defer ts.Close()` after `httptest.NewServer(...)`

### `database/sql`
- `defer rows.Close()` after `db.Query`
- `defer stmt.Close()` after `db.Prepare`

### `sync`
- `defer mu.Unlock()` after `mu.Lock()`
- `defer rw.RUnlock()` after `rw.RLock()`
- `defer wg.Done()` inside the goroutine

### `context`
- `defer cancel()` after `context.WithCancel/WithTimeout/WithDeadline`

### `os/exec`
- `defer cmd.Wait()` (when starting and waiting separately)

### `bufio`
- `defer w.Flush()` for bufio.Writer (often paired with the underlying close)

### `runtime/pprof`
- `defer pprof.StopCPUProfile()` after `pprof.StartCPUProfile(f)`

---

## 12. Edge Cases

### 12.1 `os.Exit` Skips Defers
```go
func main() {
    defer fmt.Println("cleanup")
    os.Exit(1) // cleanup does NOT run
}
```

`os.Exit` terminates the process immediately. Defers do not fire. Prefer returning from main with an error and letting the caller decide.

### 12.2 `runtime.Goexit` Runs Defers
```go
go func() {
    defer fmt.Println("cleanup")
    runtime.Goexit() // prints "cleanup", then ends the goroutine
}()
```

Unlike `os.Exit`, `runtime.Goexit` runs all deferred calls in the goroutine before terminating it.

### 12.3 Defer With A Method Value
```go
type C struct{ name string }
func (c *C) Close() { fmt.Println("closing", c.name) }

a := &C{name: "A"}
defer a.Close()         // captures a NOW; method value
a = &C{name: "B"}
// On exit: prints "closing A"
```

`a.Close` is a method value bound to the original `a`. Reassigning `a` doesn't change which receiver the deferred call uses.

### 12.4 Defer And Goroutine Boundaries
A defer registered in a function only runs when **that function** returns. Goroutines spawned inside the function are not waited on by the defer:

```go
func f() {
    defer fmt.Println("f exited")
    go func() {
        time.Sleep(time.Second)
        fmt.Println("goroutine done")
    }()
    // returns immediately; defer prints "f exited"
}
// Output:
// f exited
// (goroutine done — maybe; depends on whether main is still alive)
```

### 12.5 Variadic Args In Deferred Calls
The variadic slice is **also** evaluated at defer-time:

```go
xs := []int{1, 2, 3}
defer fmt.Println(xs...) // prints "1 2 3"
xs = []int{99}
// closure variant prints "99"
defer func() { fmt.Println(xs...) }()
```

---

## 13. Testing Defer

You can test defer behavior with regular table-driven tests; the deferred call's effect is observable through return values or side effects:

```go
func TestDeferAnnotatesError(t *testing.T) {
    err := loadConfig("nonexistent.yaml")
    if err == nil {
        t.Fatal("expected error")
    }
    if !strings.Contains(err.Error(), "loadConfig") {
        t.Errorf("expected wrapped error, got %v", err)
    }
}
```

For panic recovery, you can use `defer recover()` inside the test or rely on `t.Run` isolation:

```go
func TestRecover(t *testing.T) {
    defer func() {
        if r := recover(); r == nil {
            t.Fatal("expected panic, got none")
        }
    }()
    funcThatShouldPanic()
}
```

---

## 14. Performance Tips

1. **Open-coded defer fast path** kicks in when:
   - The function has at most 8 defer statements.
   - None of those defers is inside a loop.
   - The function isn't compiled with `-N` (no optimizations).
2. **Defers in loops always go through the slow path** (heap-allocated record).
3. **Unrolling / hoisting** a defer out of a loop into a helper function lets the helper hit the fast path.
4. **Hot-path locks** sometimes use explicit `mu.Unlock()` instead of `defer mu.Unlock()`. Measure first.
5. **`defer` cost on a pure function call (no closure capture)** is ~3-7 ns. Defer through a closure is slightly higher.

---

## 15. Common Misconceptions

**Misconception 1**: "Defer runs at the end of its block (the `}`)."
**Truth**: It runs at the end of the **enclosing function**.

**Misconception 2**: "Defer args evaluate when the deferred call runs."
**Truth**: They evaluate at the `defer` statement.

**Misconception 3**: "`recover` works anywhere."
**Truth**: It only works when called from a function that was called via `defer`.

**Misconception 4**: "Defer can't change the return value."
**Truth**: It can, but only if the return value is named.

**Misconception 5**: "Defer always allocates."
**Truth**: Open-coded defer (Go 1.14+) avoids allocation for bounded defer counts.

**Misconception 6**: "Multiple defers run in registration order."
**Truth**: They run in reverse (LIFO) order.

---

## 16. Tricky Points

1. `defer f()` evaluates `f` at defer-time, but the **body** runs at exit-time. Closures capture by reference, function values resolve at defer-time.
2. The trace pattern `defer trace("name")()` calls `trace` immediately and defers its returned function.
3. `runtime.Goexit` runs defers; `os.Exit` does not.
4. Method values bind their receiver at defer-time, like arguments.
5. A panic mid-defer interrupts that defer but the next defer still runs.

---

## 17. Test Yourself

```go
package main

import "fmt"

func A() (n int) {
    defer func() { n++ }()
    return 10
}

func B() int {
    n := 10
    defer func() { n++ }()
    return n
}

func C() (n int) {
    defer func() { n++ }()
    n = 10
    return
}

func main() {
    fmt.Println(A(), B(), C())
}
```

What's the output?

<details><summary>Answer</summary>

`11 10 11`

- A: named return; defer increments after `return 10` assigns 10 to `n`. Returns 11.
- B: unnamed return; the value 10 has already been captured before defer runs. Defer increments a local `n` that no one reads. Returns 10.
- C: named return; `n = 10`, `return` triggers, defer increments to 11. Returns 11.
</details>

---

## 18. Summary

At the middle level, defer is a design tool. Use it for cleanup that must always run, error annotation via named return values, panic recovery in boundary functions, and tracing. Stack defers in LIFO order matching your cleanup ordering. Avoid defers in loops and tight hot paths. Combine with closures when you need late-binding. The cost is small enough to ignore in 99% of code, but worth understanding when you write a hot inner loop.

---

## 19. Further Reading

- [Effective Go — Defer](https://go.dev/doc/effective_go#defer)
- [Go Blog — Defer, panic, recover](https://go.dev/blog/defer-panic-and-recover)
- [Go 1.14 release notes](https://go.dev/doc/go1.14)
- Dave Cheney, "Go's defer is slow" (Pre-1.14 analysis)
- [Go runtime/panic.go source](https://github.com/golang/go/blob/master/src/runtime/panic.go)

---

## 20. Related Topics

- 2.6.5 Closures — capture semantics inside deferred closures
- 2.6.6 Named Return Values — needed for error wrapping pattern
- Panic / Recover — companion concepts to defer
- 7.x Concurrency — defer + mutex / waitgroup patterns
