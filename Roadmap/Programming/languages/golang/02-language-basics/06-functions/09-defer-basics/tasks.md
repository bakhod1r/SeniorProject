# Go Defer — Tasks

## Instructions

Each task includes a description, starter code, expected behavior, and an evaluation checklist. Use defer idiomatically; capture only what you need; do not place defers in loops.

Difficulty levels: Easy, Medium, Hard, Extra-hard.

---

## Task 1 — File Reader (Easy)

**Topic**: Basic acquire-and-defer pattern

**Description**: Implement `readAll(path string) ([]byte, error)` that opens the file at `path`, reads its full contents, and ensures the file is closed regardless of success or failure.

**Constraints**:
- Use `defer` for the close.
- Handle the case where `os.Open` fails (don't defer on a nil file).
- Return the read error if `io.ReadAll` fails.

**Starter Code**:
```go
package main

import (
    "fmt"
    "io"
    "os"
)

func readAll(path string) ([]byte, error) {
    // TODO
    return nil, nil
}

func main() {
    data, err := readAll("/etc/hostname")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Printf("read %d bytes\n", len(data))
}
```

<details>
<summary>Hint</summary>

The defer must come AFTER the error check on `os.Open`. Otherwise, `f` is nil and `f.Close()` panics.
</details>

<details>
<summary>Reference Solution</summary>

```go
func readAll(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()
    return io.ReadAll(f)
}
```
</details>

**Self-check**: What happens if `os.Open` returns `err != nil` and you defer `f.Close()` before the check?

---

## Task 2 — LIFO Order (Easy)

**Topic**: Defer execution order

**Description**: Write a function `printRange(n int)` that prints numbers from 1 to `n` in **descending** order, using only `defer` statements (no explicit reversal logic).

**Starter Code**:
```go
package main

import "fmt"

func printRange(n int) {
    // TODO
}

func main() {
    printRange(5) // expected: 5 4 3 2 1 (each on its own line)
}
```

<details>
<summary>Hint</summary>

LIFO means the last `defer` runs first. Defer in ascending order; the calls execute in descending order.
</details>

<details>
<summary>Reference Solution</summary>

```go
func printRange(n int) {
    for i := 1; i <= n; i++ {
        defer fmt.Println(i)
    }
}
```

Output:
```
5
4
3
2
1
```

The defer's argument `i` is captured at each iteration. LIFO order produces descending output.
</details>

**Self-check**: What if you replaced `defer fmt.Println(i)` with `defer func() { fmt.Println(i) }()`? (Hint: it depends on Go version.)

---

## Task 3 — Mutex Counter (Easy)

**Topic**: Defer with mutex unlock

**Description**: Implement a thread-safe counter using `sync.Mutex` and `defer mu.Unlock()`.

**Starter Code**:
```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    // TODO: fields
}

func (c *Counter) Incr() {
    // TODO
}

func (c *Counter) Value() int {
    // TODO
    return 0
}

func main() {
    c := &Counter{}
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Incr()
        }()
    }
    wg.Wait()
    fmt.Println(c.Value()) // 1000
}
```

<details>
<summary>Hint</summary>

Lock the mutex at the start of each method; defer the unlock immediately.
</details>

<details>
<summary>Reference Solution</summary>

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Incr() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}

func (c *Counter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```

Notice the `defer wg.Done()` inside the goroutine in `main` — also a textbook defer pattern.
</details>

**Self-check**: If you removed `defer` and used explicit `c.mu.Unlock()`, what happens if the critical section panics?

---

## Task 4 — Named Return Error Wrap (Medium)

**Topic**: Defer + named return for error annotation

**Description**: Implement `loadProfile(path string) (*Profile, error)` that reads a JSON profile from a file. Use a deferred closure to wrap any error with a uniform prefix `"loadProfile %q: %v"`.

**Starter Code**:
```go
package main

import (
    "encoding/json"
    "fmt"
    "os"
)

type Profile struct {
    Name string `json:"name"`
    Age  int    `json:"age"`
}

func loadProfile(path string) (*Profile, error) {
    // TODO: use named return + deferred wrap
    return nil, nil
}

func main() {
    p, err := loadProfile("missing.json")
    if err != nil {
        fmt.Println(err)
        return
    }
    fmt.Println(p)
}
```

<details>
<summary>Hint</summary>

Declare named returns: `(p *Profile, err error)`. Defer a closure that checks if `err != nil` and wraps it.
</details>

<details>
<summary>Reference Solution</summary>

```go
func loadProfile(path string) (p *Profile, err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("loadProfile %q: %w", path, err)
        }
    }()

    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()

    p = &Profile{}
    if err = json.NewDecoder(f).Decode(p); err != nil {
        return nil, err
    }
    return p, nil
}
```

Every error path through this function gets wrapped uniformly. The `%w` verb preserves the original error for `errors.Is` and `errors.As`.
</details>

**Self-check**: Why does this require the return value to be **named**?

---

## Task 5 — Tracing Helper (Medium)

**Topic**: The `defer trace(name)()` idiom

**Description**: Implement `trace(name string) func()` that prints `"enter <name>"` immediately and returns a closure that prints `"exit <name> (took <duration>)"` when called.

**Usage**:
```go
func work() {
    defer trace("work")()
    time.Sleep(50 * time.Millisecond)
}
```

Expected console output for `work()`:
```
enter work
exit work (took 50ms)
```

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

func trace(name string) func() {
    // TODO
    return nil
}

func work() {
    defer trace("work")()
    time.Sleep(50 * time.Millisecond)
}

func main() { work() }
```

<details>
<summary>Hint</summary>

Capture `time.Now()` and the name in `trace`. Print the enter message. Return a closure that prints the exit message using captured state.
</details>

<details>
<summary>Reference Solution</summary>

```go
func trace(name string) func() {
    start := time.Now()
    fmt.Println("enter", name)
    return func() {
        fmt.Printf("exit %s (took %v)\n", name, time.Since(start))
    }
}
```

The trick is the doubled `()`: `trace("work")` runs immediately and returns a closure. `defer X()` defers calling that closure on exit.
</details>

**Self-check**: What if you wrote `defer trace("work")` (no second `()`)? What gets deferred?

---

## Task 6 — Recovery Wrapper (Medium)

**Topic**: Defer + recover

**Description**: Implement `safeCall(fn func()) (recovered interface{})` that calls `fn()` and returns the value passed to `panic()` if `fn` panics. If `fn` returns normally, `safeCall` returns `nil`.

**Starter Code**:
```go
package main

import "fmt"

func safeCall(fn func()) (recovered interface{}) {
    // TODO
    return nil
}

func main() {
    r := safeCall(func() { panic("boom") })
    fmt.Println("recovered:", r) // recovered: boom

    r = safeCall(func() { /* nothing */ })
    fmt.Println("recovered:", r) // recovered: <nil>
}
```

<details>
<summary>Hint</summary>

`recover()` only works inside a deferred function. Wrap it in a deferred closure that assigns to a named return.
</details>

<details>
<summary>Reference Solution</summary>

```go
func safeCall(fn func()) (recovered interface{}) {
    defer func() {
        recovered = recover()
    }()
    fn()
    return nil
}
```

The deferred closure runs even if `fn()` panics. `recover()` returns the panic value. The named return `recovered` is set inside the closure.
</details>

**Self-check**: What happens if the deferred closure itself calls a function that calls `recover()`?

---

## Task 7 — Multi-Resource Cleanup (Medium)

**Topic**: Stacking defers for ordered cleanup

**Description**: Implement `copyGzipped(src, dst string) error` that:
1. Opens `src` for reading.
2. Creates `dst` for writing.
3. Wraps the writer in `gzip.NewWriter`.
4. Copies bytes from src to the gzipped writer.
5. Ensures gzip is flushed before the file is closed (LIFO order).
6. Captures any close error if no other error occurred.

**Starter Code**:
```go
package main

import (
    "compress/gzip"
    "io"
    "os"
)

func copyGzipped(src, dst string) error {
    // TODO
    return nil
}
```

<details>
<summary>Hint</summary>

Defer in this order:
1. `defer in.Close()`
2. `defer out.Close()` (with err capture)
3. `defer gz.Close()` (with err capture)

LIFO will run them: gz.Close (flushes), out.Close, in.Close.
</details>

<details>
<summary>Reference Solution</summary>

```go
func copyGzipped(src, dst string) (err error) {
    in, err := os.Open(src)
    if err != nil {
        return err
    }
    defer in.Close()

    out, err := os.Create(dst)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := out.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()

    gz := gzip.NewWriter(out)
    defer func() {
        if cerr := gz.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()

    _, err = io.Copy(gz, in)
    return err
}
```

The deferred closures use `&err` semantics implicitly (they reference the named `err` return). Only the first error is reported.
</details>

**Self-check**: If `gz.Close()` is the only error and `io.Copy` succeeded, does the function return that error?

---

## Task 8 — Defer In Loop Bug Fix (Medium)

**Topic**: Avoiding defer in loop

**Description**: The function below has a bug. With 5000 paths, it crashes with "too many open files". Identify the bug and fix it without removing the defer.

**Buggy Code**:
```go
func processPaths(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close()
        if err := process(f); err != nil {
            return err
        }
    }
    return nil
}
```

**Constraints**:
- Keep `defer` for the close (no manual `f.Close()` in the loop).
- Handle 100,000 paths without exhausting file descriptors.

<details>
<summary>Hint</summary>

The defer doesn't fire until `processPaths` returns. Each iteration accumulates one open file. Move the per-iteration body into its own function.
</details>

<details>
<summary>Reference Solution</summary>

```go
func processPaths(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            return err
        }
    }
    return nil
}

func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil {
        return err
    }
    defer f.Close()
    return process(f)
}
```

Each call to `processOne` has its own defer scope. The file closes when each call returns, not when `processPaths` returns.
</details>

**Self-check**: How many files are open simultaneously after the fix? After the bug?

---

## Task 9 — Argument Snapshot vs Closure (Hard)

**Topic**: Argument evaluation timing

**Description**: Implement two functions, `snapshot(x int)` and `live(x *int)`, where:
- `snapshot(x)` defers a print that always shows the value passed in (not later changes).
- `live(x)` defers a print that shows the latest value of `*x` at function exit.

**Starter Code**:
```go
package main

import "fmt"

func snapshot(x int) {
    // TODO: defer prints x at defer-time (will show passed-in value)
}

func live(x *int) {
    // TODO: defer prints *x at exit-time
}

func main() {
    n := 1
    snapshot(n)
    n = 99
    fmt.Println("--- snapshot done ---")

    live(&n)
    n = 1000
    fmt.Println("--- live done ---")
}
```

Expected output:
```
1
--- snapshot done ---
1000
--- live done ---
```

<details>
<summary>Hint</summary>

For snapshot: `defer fmt.Println(x)` captures x at defer-time.
For live: defer a closure that dereferences the pointer at call-time.
</details>

<details>
<summary>Reference Solution</summary>

```go
func snapshot(x int) {
    defer fmt.Println(x) // captures x value
}

func live(x *int) {
    defer func() { fmt.Println(*x) }() // reads *x at exit
}
```

`snapshot` shows 1 because `x` (the int parameter) was 1 when the defer ran. The argument is captured immediately.

`live` shows 1000 because the closure reads `*x` when the defer fires. `*x` is whatever `n` is then.
</details>

**Self-check**: If you wrote `defer fmt.Println(*x)` in `live`, what would print?

---

## Task 10 — Transaction Rollback Or Commit (Hard)

**Topic**: Defer + named return for two-phase commit

**Description**: Implement `transfer(db *sql.DB, from, to int, amount int64) error` that performs a transaction. If anything fails, rollback. If everything succeeds, commit. The deferred logic should NOT swallow the original error.

**Starter Code**:
```go
package main

import "database/sql"

func transfer(db *sql.DB, from, to int, amount int64) error {
    // TODO: begin tx, debit from, credit to, commit; rollback on any err
    return nil
}
```

<details>
<summary>Hint</summary>

Use a named `err` return. Defer a closure that calls Rollback if `err != nil`. Call Commit at the end; if Commit fails, the err return reflects that.
</details>

<details>
<summary>Reference Solution</summary>

```go
func transfer(db *sql.DB, from, to int, amount int64) (err error) {
    tx, err := db.Begin()
    if err != nil {
        return err
    }
    defer func() {
        if err != nil {
            _ = tx.Rollback()
        }
    }()

    if _, err = tx.Exec("UPDATE acct SET bal = bal - ? WHERE id = ?", amount, from); err != nil {
        return err
    }
    if _, err = tx.Exec("UPDATE acct SET bal = bal + ? WHERE id = ?", amount, to); err != nil {
        return err
    }
    return tx.Commit()
}
```

If any `tx.Exec` fails, the deferred closure sees `err != nil` and rolls back. If both succeed and `tx.Commit()` succeeds, `err` is nil and the deferred closure does nothing. If `tx.Commit()` fails, `err` is set; the deferred closure rolls back, but the rollback is a no-op (already committed/rolled back) — which is harmless.
</details>

**Self-check**: What happens if the function panics between the two `Exec` calls?

---

## Task 11 — Bounded Defer Count (Hard)

**Topic**: Open-coded defer threshold

**Description**: Without using runtime reflection, write two versions of a function `setup10`:
- Version A: registers 10 defers, all in one function.
- Version B: registers 10 defers but groups them into a helper to keep each function ≤ 8 defers.

Verify (mentally or with `go build -gcflags="-m"`) that Version B uses open-coded defer.

**Starter Code**:
```go
package main

import "fmt"

func cleanup(name string) func() {
    return func() { fmt.Println("cleanup", name) }
}

func setup10A() {
    // TODO: 10 defers in one function
}

func setup10B() {
    // TODO: split so each function has ≤ 8 defers
}
```

<details>
<summary>Hint</summary>

For B, create two helpers (each with 5 defers) and call them in sequence.
</details>

<details>
<summary>Reference Solution</summary>

```go
func setup10A() {
    defer cleanup("a1")()
    defer cleanup("a2")()
    defer cleanup("a3")()
    defer cleanup("a4")()
    defer cleanup("a5")()
    defer cleanup("a6")()
    defer cleanup("a7")()
    defer cleanup("a8")()
    defer cleanup("a9")()
    defer cleanup("a10")()
}

func setupFirst5() {
    defer cleanup("b1")()
    defer cleanup("b2")()
    defer cleanup("b3")()
    defer cleanup("b4")()
    defer cleanup("b5")()
}

func setupLast5() {
    defer cleanup("b6")()
    defer cleanup("b7")()
    defer cleanup("b8")()
    defer cleanup("b9")()
    defer cleanup("b10")()
}

func setup10B() {
    setupFirst5()
    setupLast5()
}
```

Verify with:
```bash
go build -gcflags="-m=2" 2>&1 | grep "defer"
```

`setup10A` will use stack-allocated `_defer` records (drops from open-coded). `setupFirst5` and `setupLast5` qualify for open-coded.

Note: in B, the cleanup order isn't strictly LIFO across all 10 calls; setupLast5's defers run first (during setupLast5), then setupFirst5's. If you need strict LIFO, this approach doesn't preserve it.
</details>

**Self-check**: Why is the cleanup order different between A and B?

---

## Task 12 — Tracing Multiple Returns (Hard)

**Topic**: Trace pattern with named returns

**Description**: Implement a generic trace helper that logs the **return values and any error** of any function. The trace should fire on every exit path.

**Starter Code**:
```go
package main

import "fmt"

func traceResult[T any](name string, result *T, err *error) func() {
    return func() {
        if *err != nil {
            fmt.Printf("[%s] ERR: %v\n", name, *err)
        } else {
            fmt.Printf("[%s] OK: %v\n", name, *result)
        }
    }
}

func compute() (result int, err error) {
    defer traceResult("compute", &result, &err)()
    // TODO: set result and err appropriately
    return 42, nil
}
```

<details>
<summary>Hint</summary>

The trace closure captures pointers to the named return values. It reads them at exit-time, so it sees the final values.
</details>

<details>
<summary>Reference Solution</summary>

```go
func compute() (result int, err error) {
    defer traceResult("compute", &result, &err)()
    return 42, nil
}

func main() {
    compute() // [compute] OK: 42
}
```

The trace helper builds a closure that reads `*result` and `*err` at exit-time. Because the function uses named returns, `&result` and `&err` are stable pointers throughout the function's lifetime. The deferred closure observes the final values.
</details>

**Self-check**: What if `result` and `err` are *not* named? Can the trace still see the return value?

---

## Task 13 — Custom Mutex With Tracking (Extra-hard)

**Topic**: Defer + closure + atomics

**Description**: Implement a `TrackedMutex` that records the number of currently-held locks (across all goroutines). Provide `Lock()` and `Unlock()` methods. The unlock should be implemented with `defer`-able semantics (you do not need to literally enforce defer; just make `Unlock` work correctly when invoked via defer).

Add a `Held() int` method that returns the count of currently held locks.

**Constraints**:
- Use `sync.Mutex` internally.
- Use `sync/atomic` for the held counter.
- Provide an example demonstrating usage with `defer`.

**Starter Code**:
```go
package main

import (
    "sync"
    "sync/atomic"
)

type TrackedMutex struct {
    mu   sync.Mutex
    held int64 // number of times Lock has been called minus Unlock
}

func (t *TrackedMutex) Lock()   { /* TODO */ }
func (t *TrackedMutex) Unlock() { /* TODO */ }
func (t *TrackedMutex) Held() int64 { /* TODO */; return 0 }

func main() {
    var m TrackedMutex
    func() {
        m.Lock()
        defer m.Unlock()
        if m.Held() != 1 {
            panic("expected 1")
        }
    }()
    if m.Held() != 0 {
        panic("expected 0")
    }
}
```

<details>
<summary>Hint</summary>

Use atomic.AddInt64 to bump `held` in Lock and decrement in Unlock. The mutex enforces ordering so the counter is consistent.
</details>

<details>
<summary>Reference Solution</summary>

```go
type TrackedMutex struct {
    mu   sync.Mutex
    held int64
}

func (t *TrackedMutex) Lock() {
    t.mu.Lock()
    atomic.AddInt64(&t.held, 1)
}

func (t *TrackedMutex) Unlock() {
    atomic.AddInt64(&t.held, -1)
    t.mu.Unlock()
}

func (t *TrackedMutex) Held() int64 {
    return atomic.LoadInt64(&t.held)
}
```

Used with defer:

```go
var m TrackedMutex
m.Lock()
defer m.Unlock()
fmt.Println(m.Held()) // 1
// at exit, defer unlocks; Held() goes back to 0
```

The `held` counter is updated within the critical section. Other goroutines reading `Held()` see the count consistently.
</details>

**Self-check**: Why is it important to update `held` *while holding* the underlying mutex?

---

## Task 14 — Defer Bug Hunt (Extra-hard)

**Topic**: Multi-bug defer code

**Description**: Below is a piece of production-style code with multiple defer-related bugs. Identify all of them, fix the code, and explain each bug.

**Buggy Code**:
```go
package main

import (
    "fmt"
    "os"
    "sync"
)

var mu sync.Mutex

func processPaths(paths []string) error {
    mu.Lock()
    for i, p := range paths {
        f, err := os.Open(p)
        defer f.Close()
        if err != nil {
            return err
        }
        defer func() { fmt.Println("processed:", i, p) }()
        // ... do work with f ...
    }
    mu.Unlock()
    return nil
}

func handlePanic() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
}

func safe() {
    defer handlePanic()
    panic("boom")
}

func main() {
    defer fmt.Println("done")
    safe()
    paths := []string{"/etc/hostname", "/etc/missing"}
    if err := processPaths(paths); err != nil {
        fmt.Println("err:", err)
        os.Exit(1)
    }
}
```

<details>
<summary>Hint</summary>

There are at least 5 bugs. Look for:
1. defer before error check
2. defer in a loop
3. mutex unlock not via defer
4. recover called from non-deferred function
5. os.Exit skipping defers
6. (pre-1.22) loop variable capture in deferred closure
</details>

<details>
<summary>Reference Solution</summary>

**Bugs**:

1. `defer f.Close()` runs before the error check — if `os.Open` failed, `f` is nil, `f.Close()` panics.
2. `defer f.Close()` and `defer func() { ... }()` are inside the loop — they accumulate, leaking handles.
3. `mu.Unlock()` is not via `defer` — if any error path returns, the mutex stays locked. Permanent deadlock.
4. `defer handlePanic()` — `handlePanic` is called via defer, so `recover()` inside it actually does work. Wait, this is correct. (Tricky: if the user expected `handlePanic` to be a *helper* called from another defer, it would NOT work. Here, it IS the deferred function, so it works.)
5. `os.Exit(1)` skips the deferred `fmt.Println("done")`.
6. Pre-Go 1.22: `defer func() { fmt.Println("processed:", i, p) }()` captures loop variables `i` and `p` by reference; all closures see the final values.

**Fixed Code**:
```go
func processPaths(paths []string) (err error) {
    mu.Lock()
    defer mu.Unlock()

    for _, p := range paths {
        if err = processOne(p); err != nil {
            return err
        }
    }
    return nil
}

func processOne(p string) (err error) {
    f, err := os.Open(p)
    if err != nil {
        return err
    }
    defer f.Close()

    p2 := p // shadow for pre-1.22; harmless on 1.22+
    defer func() { fmt.Println("processed:", p2) }()
    // ... do work with f ...
    return nil
}

func main() {
    defer fmt.Println("done")
    safe()
    paths := []string{"/etc/hostname", "/etc/missing"}
    if err := processPaths(paths); err != nil {
        fmt.Println("err:", err)
        return // don't os.Exit
    }
}
```

Changes:
- Defer file close after error check.
- Extract `processOne` to scope per-iter defers.
- `defer mu.Unlock()` (mutex via defer).
- Replace `os.Exit(1)` with plain `return` so the outer defer fires.
- Shadow the loop variable for pre-1.22 safety.
</details>

**Self-check**: Which bug, if any, would not show up in tests but would in production?

---

## Task 15 — Build Your Own Defer (Extra-hard)

**Topic**: Conceptual understanding of defer

**Description**: Without using the `defer` keyword, build a small "defer queue" and demonstrate LIFO cleanup. The goal is to understand what `defer` does under the hood.

**Constraints**:
- No `defer` keyword.
- LIFO order.
- Cleanup must run on normal return AND on panic.

**Starter Code**:
```go
package main

import "fmt"

type DeferQueue struct {
    fns []func()
}

func (q *DeferQueue) Push(fn func()) {
    // TODO
}

func (q *DeferQueue) RunAll() {
    // TODO: LIFO
}

func process() {
    var q DeferQueue
    q.Push(func() { fmt.Println("cleanup A") })
    q.Push(func() { fmt.Println("cleanup B") })
    q.Push(func() { fmt.Println("cleanup C") })

    // ... work that might panic ...

    q.RunAll()
}
```

<details>
<summary>Hint</summary>

Push appends. RunAll iterates in reverse. To handle panics, you'd need to wrap RunAll in a real `defer` — but since the task says no defer, you can rely on Go's normal panic propagation and require the caller to call RunAll manually before any panic.

To handle panics, an actual `defer` would still be needed. So this exercise demonstrates why `defer` is part of the language — you can't fully simulate its panic-safety without it.
</details>

<details>
<summary>Reference Solution</summary>

```go
type DeferQueue struct {
    fns []func()
}

func (q *DeferQueue) Push(fn func()) {
    q.fns = append(q.fns, fn)
}

func (q *DeferQueue) RunAll() {
    for i := len(q.fns) - 1; i >= 0; i-- {
        q.fns[i]()
    }
}

func process() {
    var q DeferQueue
    q.Push(func() { fmt.Println("cleanup A") })
    q.Push(func() { fmt.Println("cleanup B") })
    q.Push(func() { fmt.Println("cleanup C") })

    fmt.Println("body")
    q.RunAll() // manually invoked at exit
}
```

This works for normal exit but fails on panic. To make it panic-safe, you'd need to use Go's actual `defer`:

```go
defer q.RunAll() // back to using defer
```

So this exercise demonstrates: `defer` is fundamentally a language feature that interacts with the runtime's panic/unwind machinery. You cannot fully replicate it in user code.
</details>

**Self-check**: Why is `defer` a language keyword and not a library function?

---

## Summary

These 15 tasks span basic file cleanup through hard runtime-level questions. Working through them systematically should build deep fluency with `defer`:

| Difficulty | Tasks | Focus |
|------------|-------|-------|
| Easy | 1-3 | Basic patterns: file close, LIFO, mutex unlock |
| Medium | 4-7 | Named returns, tracing, recovery, multi-resource cleanup |
| Hard | 8-12 | Loop pitfall, argument timing, transactions, defer threshold, tracing returns |
| Extra-hard | 13-15 | Tracking mutex, multi-bug hunt, build-your-own-defer |

After completing all 15, you should be able to explain to a colleague:
- The defer execution model (LIFO, defer-time evaluation, named-return interaction).
- The panic-safety contract that makes defer essential.
- The cost model and how to avoid the slow path.
- The common bugs and how to spot them in code review.

---

## References

- [Go Spec — Defer statements](https://go.dev/ref/spec#Defer_statements)
- [Effective Go — Defer](https://go.dev/doc/effective_go#defer)
- [Go Blog — Defer, panic, recover](https://go.dev/blog/defer-panic-and-recover)
- See also: `junior.md`, `middle.md`, `senior.md`, `find-bug.md`, `optimize.md`
