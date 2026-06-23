# panic and recover — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Trigger and recover from a basic panic

Write a function `safeRun(fn func()) (recovered any)` that runs `fn` and returns whatever was passed to `panic`, or `nil` if no panic occurred.

**Hints**
- Use `defer` and `recover`.
- Need a named return.

**Solution**
```go
package main

import "fmt"

func safeRun(fn func()) (recovered any) {
    defer func() {
        recovered = recover()
    }()
    fn()
    return nil
}

func main() {
    fmt.Println(safeRun(func() { /* nothing */ })) // <nil>
    fmt.Println(safeRun(func() { panic("boom") })) // boom
}
```

---

## Task 2 (Easy) — Convert panic to error

Write a function `Run(fn func()) (err error)` that runs `fn` and returns an error if it panics. The error message should include the recovered value.

**Hints**
- `(err error)` is named so the deferred recover can write to it.
- Use `fmt.Errorf("recovered: %v", r)`.

**Solution**
```go
func Run(fn func()) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    fn()
    return nil
}

func main() {
    err := Run(func() { panic("oops") })
    fmt.Println(err) // recovered: oops
}
```

---

## Task 3 (Easy) — MustParse helper

Implement `MustAtoi(s string) int` that panics if the input is not a valid integer.

**Hints**
- Use `strconv.Atoi`.
- Panic with a string that includes `s`.

**Solution**
```go
func MustAtoi(s string) int {
    n, err := strconv.Atoi(s)
    if err != nil {
        panic(fmt.Sprintf("MustAtoi(%q): %v", s, err))
    }
    return n
}

func main() {
    fmt.Println(MustAtoi("42")) // 42
    // MustAtoi("abc") would panic
}
```

---

## Task 4 (Easy → Medium) — Inspect the panic value

Write `Classify(fn func()) string` that returns:
- `"no panic"` if `fn` does not panic.
- `"error panic"` if it panics with an `error`.
- `"string panic"` if it panics with a string.
- `"other panic"` otherwise.

**Solution**
```go
func Classify(fn func()) (kind string) {
    kind = "no panic"
    defer func() {
        r := recover()
        if r == nil {
            return
        }
        switch r.(type) {
        case error:
            kind = "error panic"
        case string:
            kind = "string panic"
        default:
            kind = "other panic"
        }
    }()
    fn()
    return
}
```

---

## Task 5 (Medium) — Goroutine-safe wrapper

Implement `goSafe(fn func())` that launches `fn` in a goroutine and recovers any panic, logging it via `log.Printf`. Demonstrate that the main goroutine continues to run.

**Hints**
- Use `defer` inside the goroutine.

**Solution**
```go
func goSafe(fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("goroutine panic: %v", r)
            }
        }()
        fn()
    }()
}

func main() {
    goSafe(func() { panic("worker panic") })
    time.Sleep(100 * time.Millisecond)
    fmt.Println("main still alive") // prints
}
```

---

## Task 6 (Medium) — HTTP middleware that recovers

Write `Recover(next http.Handler) http.Handler` that catches panics in `next.ServeHTTP` and returns 500 to the client. Log the recovered value and stack trace.

**Hints**
- `runtime/debug.Stack()` for the trace.
- `http.Error(w, "internal error", 500)`.

**Solution**
```go
import (
    "net/http"
    "log"
    "runtime/debug"
)

func Recover(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic in handler: %v\n%s", rec, debug.Stack())
                http.Error(w, "internal server error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

---

## Task 7 (Medium) — Stack trace capture

Write `RecoverWithStack(fn func()) (msg string, stack string)` that runs `fn`, returning the recovered message and the captured stack trace. Empty strings if no panic.

**Solution**
```go
import "runtime/debug"

func RecoverWithStack(fn func()) (msg string, stack string) {
    defer func() {
        if r := recover(); r != nil {
            msg = fmt.Sprintf("%v", r)
            stack = string(debug.Stack())
        }
    }()
    fn()
    return "", ""
}
```

---

## Task 8 (Medium) — Re-panic on unknown values

Write a recover that handles a custom panic type `MyPanic` and re-panics any other value. Demonstrate that user code triggers `MyPanic` and gets handled, while a runtime panic (nil deref) propagates further.

**Solution**
```go
type MyPanic struct{ Msg string }

func handleMine(fn func()) (handled bool) {
    defer func() {
        if r := recover(); r != nil {
            if mp, ok := r.(MyPanic); ok {
                log.Printf("handled mine: %s", mp.Msg)
                handled = true
                return
            }
            panic(r) // re-panic unknown
        }
    }()
    fn()
    return false
}
```

If `fn` calls `panic(MyPanic{"x"})`, `handleMine` catches it. If `fn` does `var p *int; *p = 1`, the runtime panic re-panics out.

---

## Task 9 (Medium → Hard) — Multi-error from panicking workers

Spawn N goroutines each calling a function that may panic. Collect all panic values into a slice and return them as a single combined error using `errors.Join`.

**Hints**
- Each goroutine recovers its own panic.
- A mutex-protected slice or a channel collects results.

**Solution**
```go
import (
    "errors"
    "fmt"
    "sync"
)

func RunAll(workers []func()) error {
    var (
        mu   sync.Mutex
        errs []error
        wg   sync.WaitGroup
    )
    for i, w := range workers {
        i, w := i, w
        wg.Add(1)
        go func() {
            defer wg.Done()
            defer func() {
                if r := recover(); r != nil {
                    mu.Lock()
                    errs = append(errs, fmt.Errorf("worker %d: %v", i, r))
                    mu.Unlock()
                }
            }()
            w()
        }()
    }
    wg.Wait()
    return errors.Join(errs...)
}
```

---

## Task 10 (Hard) — Detect runtime.Error vs user panic

Write `Categorize(fn func()) string` that returns:
- `"runtime"` if the panic value implements `runtime.Error`.
- `"user"` for any other non-nil panic.
- `"none"` if no panic.

**Hints**
- `runtime.Error` interface.
- Use type assertion.

**Solution**
```go
import "runtime"

func Categorize(fn func()) (kind string) {
    kind = "none"
    defer func() {
        r := recover()
        if r == nil {
            return
        }
        if _, ok := r.(runtime.Error); ok {
            kind = "runtime"
            return
        }
        kind = "user"
    }()
    fn()
    return
}
```

---

## Task 11 (Hard) — Bounded retry with panic recovery

Write `RetryWithRecover(attempts int, fn func() error) error` that:
- Runs `fn` up to `attempts` times.
- Treats both returned errors and recovered panics as retryable failures.
- Returns nil on first success.
- Returns the last failure (as an error) after all attempts.

**Solution**
```go
func RetryWithRecover(attempts int, fn func() error) error {
    var lastErr error
    for i := 0; i < attempts; i++ {
        func() {
            defer func() {
                if r := recover(); r != nil {
                    lastErr = fmt.Errorf("panic on attempt %d: %v", i+1, r)
                }
            }()
            if err := fn(); err != nil {
                lastErr = fmt.Errorf("attempt %d: %w", i+1, err)
                return
            }
            lastErr = nil
        }()
        if lastErr == nil {
            return nil
        }
    }
    return fmt.Errorf("after %d attempts: %w", attempts, lastErr)
}
```

---

## Task 12 (Hard) — Defer ordering with panic

Write a function that registers three defers, then panics. Show via prints that:
- All three defers run.
- They run in LIFO order.
- The panic value is the same in each defer if you call `recover` only in the outermost.

**Solution**
```go
func F() {
    defer fmt.Println("defer 1 (registered first)")
    defer fmt.Println("defer 2")
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("defer 3 recovered:", r)
        }
    }()
    panic("boom")
}

func main() {
    F()
    fmt.Println("after F")
}

// Output:
// defer 3 recovered: boom
// defer 2
// defer 1 (registered first)
// after F
```

---

## Task 13 (Hard) — Test that a function panics with a specific value

Write a test helper `AssertPanics(t *testing.T, fn func(), wantContains string)` that fails the test if:
- `fn` does not panic.
- The panic value's string representation does not contain `wantContains`.

**Solution**
```go
import (
    "fmt"
    "strings"
    "testing"
)

func AssertPanics(t *testing.T, fn func(), wantContains string) {
    t.Helper()
    defer func() {
        r := recover()
        if r == nil {
            t.Fatalf("expected panic containing %q, got none", wantContains)
        }
        s := fmt.Sprintf("%v", r)
        if !strings.Contains(s, wantContains) {
            t.Fatalf("panic %q does not contain %q", s, wantContains)
        }
    }()
    fn()
}

func TestSomething(t *testing.T) {
    AssertPanics(t, func() { panic("nil pointer dereference") }, "nil pointer")
}
```

---

## Task 14 (Hard) — Recovery middleware with structured logging

Build a middleware that integrates with `log/slog` and records:
- Request ID (from header or generated).
- Method, path.
- Panic value.
- Stack trace.

**Solution sketch**
```go
import (
    "log/slog"
    "net/http"
    "runtime/debug"
)

func Recover(logger *slog.Logger, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        reqID := r.Header.Get("X-Request-ID")
        defer func() {
            if rec := recover(); rec != nil {
                logger.Error("panic in handler",
                    "request_id", reqID,
                    "method", r.Method,
                    "path", r.URL.Path,
                    "panic", fmt.Sprint(rec),
                    "stack", string(debug.Stack()),
                )
                http.Error(w, "internal server error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

---

## Task 15 (Hard) — Supervisor with backoff

Implement `Supervise(name string, fn func() error)` that:
- Runs `fn` in a loop.
- If `fn` returns an error, log and restart with exponential backoff (1s, 2s, 4s, ..., capped at 60s).
- If `fn` panics, recover, log with stack, treat as a returned error and restart.
- Resets backoff to 1s after a successful run that lasts at least one minute.

**Solution sketch**
```go
func Supervise(name string, fn func() error) {
    backoff := time.Second
    for {
        start := time.Now()
        err := safeCall(name, fn)
        elapsed := time.Since(start)
        if elapsed > time.Minute {
            backoff = time.Second // reset
        }
        log.Printf("supervisor %s: %v; restarting in %v", name, err, backoff)
        time.Sleep(backoff)
        if backoff < time.Minute {
            backoff *= 2
        }
    }
}

func safeCall(name string, fn func() error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("%s panicked: %v\n%s", name, r, debug.Stack())
        }
    }()
    return fn()
}
```

---

## Task 16 (Boss-level) — Build a "fault domain" abstraction

Create a `FaultDomain` type whose `Run` method:
- Executes a task with recover.
- Counts panics in a metric.
- Returns errors as errors.
- Returns panics as `*PanicError` (a custom error type wrapping the recovered value plus stack).
- Provides a `Stats()` method that returns count of panics per "kind" (string for non-error, error type for errors).

**Solution sketch**
```go
type PanicError struct {
    Value any
    Stack string
}

func (p *PanicError) Error() string {
    return fmt.Sprintf("panic: %v", p.Value)
}

type FaultDomain struct {
    mu    sync.Mutex
    stats map[string]int
}

func (f *FaultDomain) Run(name string, fn func() error) error {
    var pe *PanicError
    err := func() (err error) {
        defer func() {
            if r := recover(); r != nil {
                pe = &PanicError{Value: r, Stack: string(debug.Stack())}
                err = pe
            }
        }()
        return fn()
    }()
    if pe != nil {
        f.recordPanic(name, pe.Value)
    }
    return err
}

func (f *FaultDomain) recordPanic(name string, v any) {
    f.mu.Lock()
    defer f.mu.Unlock()
    if f.stats == nil { f.stats = map[string]int{} }
    kind := fmt.Sprintf("%T", v)
    f.stats[kind]++
}

func (f *FaultDomain) Stats() map[string]int {
    f.mu.Lock()
    defer f.mu.Unlock()
    out := make(map[string]int, len(f.stats))
    for k, v := range f.stats {
        out[k] = v
    }
    return out
}
```

This is the kind of building block used in production frameworks (e.g., temporal workers, message queue consumers) to track and react to panic patterns over time.
