# Stack Traces & Debugging — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Print a stack trace

Write a program that calls `runtime/debug.PrintStack()` from inside a function and observe the output.

**Hints**
- The output goes to `os.Stderr`.
- Compare to `fmt.Println(string(debug.Stack()))`, which goes to stdout.

**Solution**
```go
package main

import (
    "runtime/debug"
)

func inner() {
    debug.PrintStack()
}

func outer() {
    inner()
}

func main() {
    outer()
}
```

---

## Task 2 (Easy) — Find your caller

Write a function `whoCalledMe()` that prints the file and line number of *its caller*.

**Hints**
- `runtime.Caller(1)` — `1` skips `whoCalledMe` itself.

**Solution**
```go
package main

import (
    "fmt"
    "runtime"
)

func whoCalledMe() {
    pc, file, line, ok := runtime.Caller(1)
    if !ok {
        fmt.Println("could not get caller")
        return
    }
    fn := runtime.FuncForPC(pc)
    fmt.Printf("called from %s at %s:%d\n", fn.Name(), file, line)
}

func realCaller() {
    whoCalledMe()
}

func main() {
    realCaller()
}
```

---

## Task 3 (Easy) — Capture frames into a slice

Use `runtime.Callers` and `runtime.CallersFrames` to print the function name and line of every active frame in the current goroutine.

**Hints**
- Allocate a `[]uintptr` of, say, 32 entries.
- Pass `2` as `skip` to omit `runtime.Callers` and your printer function.

**Solution**
```go
package main

import (
    "fmt"
    "runtime"
)

func dumpStack() {
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    frames := runtime.CallersFrames(pcs[:n])
    for {
        f, more := frames.Next()
        fmt.Printf("%s\n  %s:%d\n", f.Function, f.File, f.Line)
        if !more {
            break
        }
    }
}

func a() { dumpStack() }
func main() { a() }
```

---

## Task 4 (Easy) — Recover from a panic and log the trace

Wrap a function that panics in a `defer recover` and log the panic value plus the stack.

**Solution**
```go
package main

import (
    "log"
    "runtime/debug"
)

func mayPanic() {
    panic("something broke")
}

func safe() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("recovered: %v\n%s", r, debug.Stack())
        }
    }()
    mayPanic()
}

func main() {
    safe()
    log.Println("still running")
}
```

---

## Task 5 (Medium) — Stack-aware error type

Build a `New(msg string) error` that captures a stack at the call site and exposes it via a `StackTrace() []runtime.Frame` method.

**Hints**
- Embed a `[]uintptr`.
- Resolve frames lazily.

**Solution**
```go
package main

import (
    "fmt"
    "runtime"
)

type stackErr struct {
    msg string
    pcs []uintptr
}

func (e *stackErr) Error() string { return e.msg }

func (e *stackErr) StackTrace() []runtime.Frame {
    out := make([]runtime.Frame, 0, len(e.pcs))
    fs := runtime.CallersFrames(e.pcs)
    for {
        f, more := fs.Next()
        out = append(out, f)
        if !more {
            break
        }
    }
    return out
}

func New(msg string) error {
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    return &stackErr{msg: msg, pcs: pcs[:n]}
}

func main() {
    err := New("boom").(*stackErr)
    for _, f := range err.StackTrace() {
        fmt.Printf("%s %s:%d\n", f.Function, f.File, f.Line)
    }
}
```

---

## Task 6 (Medium) — Wrap-aware error type

Extend Task 5 so that `Wrap(err error, msg string) error` returns a wrapped error with a stack and supports `errors.Unwrap`.

**Solution**
```go
type stackErr struct {
    msg string
    err error
    pcs []uintptr
}

func (e *stackErr) Error() string {
    if e.err != nil {
        return e.msg + ": " + e.err.Error()
    }
    return e.msg
}

func (e *stackErr) Unwrap() error { return e.err }

func Wrap(err error, msg string) error {
    if err == nil {
        return nil
    }
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    return &stackErr{msg: msg, err: err, pcs: pcs[:n]}
}
```

---

## Task 7 (Medium) — Goroutine dump on demand

Write a small program that, on receiving SIGUSR1, prints the stacks of *all* goroutines.

**Hints**
- `signal.Notify` with `syscall.SIGUSR1`.
- `runtime.Stack(buf, true)`.

**Solution**
```go
package main

import (
    "fmt"
    "os"
    "os/signal"
    "runtime"
    "syscall"
    "time"
)

func main() {
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGUSR1)

    // Some background work
    for i := 0; i < 3; i++ {
        go func(i int) {
            time.Sleep(1 * time.Hour)
            _ = i
        }(i)
    }

    for {
        select {
        case <-sigs:
            buf := make([]byte, 1<<20)
            n := runtime.Stack(buf, true)
            fmt.Println(string(buf[:n]))
        }
    }
}
```

Run with `kill -USR1 <pid>` from another terminal.

---

## Task 8 (Medium) — Caller-aware logger

Write `Logf(format string, args ...any)` that prepends `file:line` of the caller to every log message.

**Solution**
```go
package main

import (
    "fmt"
    "path/filepath"
    "runtime"
    "time"
)

func Logf(format string, args ...any) {
    _, file, line, _ := runtime.Caller(1)
    file = filepath.Base(file)
    fmt.Printf("%s %s:%d "+format+"\n",
        append([]any{time.Now().Format("15:04:05"), file, line}, args...)...)
}

func work() {
    Logf("doing work %d", 42)
}

func main() {
    work()
}
```

---

## Task 9 (Medium) — pprof endpoint

Mount `net/http/pprof` and let the user inspect goroutines via HTTP.

**Solution**
```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof"
    "time"
)

func busy() {
    for {
        time.Sleep(50 * time.Millisecond)
    }
}

func main() {
    for i := 0; i < 5; i++ {
        go busy()
    }
    log.Println("pprof at http://localhost:6060/debug/pprof/")
    log.Fatal(http.ListenAndServe("localhost:6060", nil))
}
```

Run, then visit `http://localhost:6060/debug/pprof/goroutine?debug=2`.

---

## Task 10 (Medium → Hard) — Minimum-allocation stack capture

Implement a `Capture` struct with a fixed-size `[16]uintptr` array. Capturing should not allocate a slice on the heap. Verify with `go test -benchmem`.

**Solution**
```go
package main

import (
    "runtime"
    "testing"
)

type Capture struct {
    pcs [16]uintptr
    n   int
}

func (c *Capture) Snap() {
    c.n = runtime.Callers(2, c.pcs[:])
}

func BenchmarkCapture(b *testing.B) {
    var c Capture
    for i := 0; i < b.N; i++ {
        c.Snap()
    }
}

func main() {
    var c Capture
    c.Snap()
    println(c.n, "frames captured")
}
```

`go test -bench=. -benchmem` should report `0 allocs/op`.

---

## Task 11 (Hard) — Periodic goroutine count alert

Spawn 1000 worker goroutines that each sleep for an hour. Print a goroutine dump every 5 seconds *only* when the goroutine count exceeds 500.

**Solution**
```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    for i := 0; i < 1000; i++ {
        go func() { time.Sleep(time.Hour) }()
    }

    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for range t.C {
        n := runtime.NumGoroutine()
        if n > 500 {
            buf := make([]byte, 1<<16)
            written := runtime.Stack(buf, true)
            fmt.Printf("alert: %d goroutines\n", n)
            fmt.Println(string(buf[:written]))
            return
        }
    }
}
```

---

## Task 12 (Hard) — Diff two goroutine dumps

Take two snapshots of `runtime.Stack(_, true)` 1 second apart, and print which `created by` callsites have *more* goroutines in the second snapshot.

**Hints**
- Parse the `created by` lines.
- Use a `map[string]int` keyed by callsite.

**Solution sketch**
```go
package main

import (
    "fmt"
    "runtime"
    "strings"
    "time"
)

func snapshot() map[string]int {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    counts := map[string]int{}
    for _, line := range strings.Split(string(buf[:n]), "\n") {
        if strings.HasPrefix(line, "created by ") {
            counts[strings.TrimPrefix(line, "created by ")]++
        }
    }
    return counts
}

func main() {
    for i := 0; i < 5; i++ {
        go func() { time.Sleep(time.Hour) }()
    }
    a := snapshot()
    time.Sleep(time.Second)
    for i := 0; i < 50; i++ {
        go func() { time.Sleep(time.Hour) }()
    }
    b := snapshot()

    for k, v := range b {
        if v > a[k] {
            fmt.Printf("growing: %s (%d -> %d)\n", k, a[k], v)
        }
    }
}
```

---

## Task 13 (Hard) — Recover middleware with stack-on-error

Build an HTTP middleware that:
- Recovers from panics in handlers.
- Logs panic value + stack.
- Returns 500 to the client without leaking the stack.

**Solution**
```go
package main

import (
    "log"
    "net/http"
    "runtime/debug"
)

func recoverMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic in %s %s: %v\n%s",
                    r.Method, r.URL.Path, rec, debug.Stack())
                http.Error(w, "internal server error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func bad(w http.ResponseWriter, r *http.Request) {
    panic("kaboom")
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", bad)
    log.Fatal(http.ListenAndServe(":8080", recoverMiddleware(mux)))
}
```

---

## Task 14 (Hard) — Detect a deadlock with a watchdog

Write a watchdog goroutine that prints a goroutine dump if `main`'s heartbeat channel goes silent for 3 seconds.

**Solution**
```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    heartbeat := make(chan struct{})

    // Watchdog
    go func() {
        timer := time.NewTimer(3 * time.Second)
        for {
            select {
            case <-heartbeat:
                if !timer.Stop() {
                    select { case <-timer.C: default: }
                }
                timer.Reset(3 * time.Second)
            case <-timer.C:
                buf := make([]byte, 1<<20)
                n := runtime.Stack(buf, true)
                fmt.Printf("watchdog fired:\n%s", buf[:n])
                return
            }
        }
    }()

    var mu sync.Mutex
    mu.Lock()
    go func() {
        mu.Lock() // deadlock
    }()

    for i := 0; i < 5; i++ {
        heartbeat <- struct{}{}
        time.Sleep(500 * time.Millisecond)
    }
    // Now main blocks, heartbeat stops, watchdog fires
    mu.Lock()
}
```

---

## Task 15 (Boss-level) — Build a `cockroachdb/errors`-style API

Build an error package with:
- `New(msg string) error` — creates an error with stack.
- `Wrap(err error, msg string) error` — preserves the original stack, adds a layer of context.
- `Unwrap`, `Is`, `As` compatibility.
- `FormatStack(err error) string` — walks the chain and prints the original stack.

**Solution sketch**
```go
package errx

import (
    "errors"
    "fmt"
    "runtime"
    "strings"
)

type withStack struct {
    err error
    pcs []uintptr
}

func (e *withStack) Error() string { return e.err.Error() }
func (e *withStack) Unwrap() error { return e.err }

func capture(skip int) []uintptr {
    pcs := make([]uintptr, 32)
    n := runtime.Callers(skip+1, pcs)
    return pcs[:n]
}

func New(msg string) error {
    return &withStack{err: errors.New(msg), pcs: capture(2)}
}

func Wrap(err error, msg string) error {
    if err == nil { return nil }
    // If the wrapped error already has a stack, do not capture a new one.
    var ws *withStack
    if errors.As(err, &ws) {
        return fmt.Errorf("%s: %w", msg, err)
    }
    return &withStack{err: fmt.Errorf("%s: %w", msg, err), pcs: capture(2)}
}

func FormatStack(err error) string {
    var ws *withStack
    if !errors.As(err, &ws) {
        return ""
    }
    var b strings.Builder
    fs := runtime.CallersFrames(ws.pcs)
    for {
        f, more := fs.Next()
        fmt.Fprintf(&b, "%s\n  %s:%d\n", f.Function, f.File, f.Line)
        if !more { break }
    }
    return b.String()
}
```

Use:
```go
err := errx.New("read file failed")
err = errx.Wrap(err, "load config")
err = errx.Wrap(err, "start server")
fmt.Println(err)             // start server: load config: read file failed
fmt.Print(errx.FormatStack(err)) // original stack from New
```

The pattern: capture once, at origin; wraps add context strings without new stacks. This is exactly how `cockroachdb/errors` and the original `pkg/errors` worked.
