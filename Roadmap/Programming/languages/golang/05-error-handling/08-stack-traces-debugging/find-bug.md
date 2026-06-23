# Stack Traces & Debugging — Find the Bug

> Each snippet contains a real-world bug related to stack traces, panics, or debugging. Find it, explain it, fix it.

---

## Bug 1 — Wrong `skip` in `runtime.Caller`

```go
func logHere() {
    pc, file, line, _ := runtime.Caller(0)
    fn := runtime.FuncForPC(pc)
    fmt.Printf("at %s %s:%d\n", fn.Name(), file, line)
}
```

**Bug:** `Caller(0)` returns the call site of `Caller` itself — so the message points at the line *inside `logHere`*, not the caller of `logHere`. Useless as a "where am I" helper.

**Fix:**
```go
pc, file, line, _ := runtime.Caller(1)  // skip logHere itself
```

---

## Bug 2 — `runtime.Stack` buffer too small

```go
func dumpAllGoroutines() string {
    buf := make([]byte, 1024)
    n := runtime.Stack(buf, true)
    return string(buf[:n])
}
```

**Bug:** A 1 KB buffer is far too small for "all goroutines". `runtime.Stack` truncates silently when the buffer is full, so you get a partial dump with no warning.

**Fix:** start with a larger buffer and grow if it filled:
```go
func dumpAllGoroutines() string {
    buf := make([]byte, 1<<16)
    for {
        n := runtime.Stack(buf, true)
        if n < len(buf) {
            return string(buf[:n])
        }
        buf = make([]byte, 2*len(buf))
    }
}
```

---

## Bug 3 — `recover` without logging the stack

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("recovered: %v", r)
    }
}()
```

**Bug:** The panic value is logged but the stack is lost. You see *what* failed but not *where*.

**Fix:** always log the stack alongside the panic value:
```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("recovered: %v\n%s", r, debug.Stack())
    }
}()
```

---

## Bug 4 — Stack capture inside a hot loop

```go
type errWithStack struct {
    err error
    s   []byte
}

func process(items []Item) error {
    for _, it := range items {
        if err := step(it); err != nil {
            return &errWithStack{err: err, s: debug.Stack()}
        }
    }
    return nil
}
```

**Bug:** Not exactly inside the loop, but the issue is that **each error allocates a `debug.Stack()`** which formats and copies the whole stack. For a parser called millions of times the cost is large; worse, the stack is the same every iteration.

**Fix:** capture cheap PCs (`runtime.Callers`) and resolve only when actually printing. Better yet, capture *once* at the top of the operation, not per item.

---

## Bug 5 — Logging panic but not exiting in a worker

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
        }
    }()
    for {
        doWork()
    }
}()
```

**Bug:** When `doWork` panics, the recover catches it, logs, then... the goroutine *exits*. The for-loop never runs again. The worker is silently dead while the rest of the program runs.

**Fix:** restart the loop, or restart the goroutine, or escalate. One option:
```go
for {
    func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("worker panic: %v\n%s", r, debug.Stack())
            }
        }()
        doWork()
    }()
    // loop continues; panics no longer kill the worker
}
```

---

## Bug 6 — Returning a leaked stack to the user

```go
func handler(w http.ResponseWriter, r *http.Request) {
    defer func() {
        if rec := recover(); rec != nil {
            fmt.Fprintf(w, "panic: %v\n%s", rec, debug.Stack())
        }
    }()
    business(r)
}
```

**Bug:** The stack trace — internal package paths, function names, sometimes data — is sent to the HTTP client. Anyone hitting a panicking endpoint can scrape your code structure.

**Fix:** log the stack internally; respond with a bland message:
```go
defer func() {
    if rec := recover(); rec != nil {
        log.Printf("panic %v\n%s", rec, debug.Stack())
        http.Error(w, "internal server error", http.StatusInternalServerError)
    }
}()
```

---

## Bug 7 — `runtime.Stack(buf, false)` for a goroutine dump

```go
func goroutineDump() string {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, false)  // only current
    return string(buf[:n])
}
```

**Bug:** The `false` argument captures only the *current* goroutine, not all of them. For diagnosing a goroutine leak, you need `true`.

**Fix:**
```go
n := runtime.Stack(buf, true)
```

---

## Bug 8 — `FuncForPC` for inlined function

```go
pcs := make([]uintptr, 32)
n := runtime.Callers(2, pcs)
for _, pc := range pcs[:n] {
    fn := runtime.FuncForPC(pc)
    file, line := fn.FileLine(pc)
    fmt.Printf("%s %s:%d\n", fn.Name(), file, line)
}
```

**Bug:** When a frame represents an inlined call, `FuncForPC` reports only the *outer* function. You silently lose the inner function's line and name.

**Fix:** use `runtime.CallersFrames`, which understands inlining:
```go
fs := runtime.CallersFrames(pcs[:n])
for {
    f, more := fs.Next()
    fmt.Printf("%s %s:%d\n", f.Function, f.File, f.Line)
    if !more { break }
}
```

---

## Bug 9 — Panic in a goroutine with no recover

```go
func main() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recovered in main:", r)
        }
    }()
    go func() {
        panic("oops")
    }()
    time.Sleep(time.Second)
}
```

**Bug:** A `recover` in `main` does **not** catch panics in *other* goroutines. The goroutine's panic kills the entire program. The `recover` in `main` never runs.

**Fix:** put a recover *inside* each goroutine, or use a helper:
```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("goroutine panic: %v\n%s", r, debug.Stack())
        }
    }()
    panic("oops")
}()
```

---

## Bug 10 — `os/signal.Notify` without buffered channel

```go
sig := make(chan os.Signal)  // unbuffered!
signal.Notify(sig, syscall.SIGUSR1)
for range sig {
    fmt.Println(string(debug.Stack()))
}
```

**Bug:** `signal.Notify` *will not block*: if the channel is full and unbuffered, the signal is **dropped** entirely. Two SIGUSR1 in quick succession may produce only one trace.

**Fix:** buffer the channel:
```go
sig := make(chan os.Signal, 1)
```

---

## Bug 11 — Stripped binary missing symbols

```bash
go build -ldflags='-s -w' -o myapp .
```

```go
panic("oops")
// trace shows:
// goroutine 1 [running]:
// main.??()
//         ??:0
```

**Bug:** `-s` strips the Go symbol table; traces lose function names and lines. Diagnosing a production crash becomes nearly impossible.

**Fix:** drop `-s` for production:
```bash
go build -trimpath -ldflags='-w' -o myapp .  # keep symbols, drop DWARF only
```

`-w` is acceptable (only breaks dlv source-level debug); `-s` is too aggressive.

---

## Bug 12 — `runtime.Caller` skip off-by-one in a wrapper

```go
func logCaller(msg string) {
    pc, file, line, _ := runtime.Caller(1)
    log.Printf("%s %s:%d %s", runtime.FuncForPC(pc).Name(), file, line, msg)
}

func helper(msg string) {
    logCaller(msg)
}

func main() {
    helper("hi")
}
```

**Bug:** From `main`'s perspective, the report says "caller is `helper`", not `main`. That is correct *if* the caller wanted the immediate caller. But often the user of `helper` wants `helper`'s caller (i.e., `main`). The skip count must increase by one in such helpers.

**Fix:** allow skip to be passed in, or document the expectation:
```go
func logCallerSkip(skip int, msg string) {
    pc, file, line, _ := runtime.Caller(skip + 1)
    log.Printf("%s %s:%d %s", runtime.FuncForPC(pc).Name(), file, line, msg)
}
```

`testing.T.Helper()` solves the same problem in tests.

---

## Bug 13 — `debug.SetTraceback` lowering verbosity

```go
debug.SetTraceback("none")
panic("hidden")
```

**Bug:** `SetTraceback` can only *increase* verbosity above the env-set baseline. Setting `"none"` does not silence panic output if `GOTRACEBACK=single` (the default). The intent is probably to hide the trace from users — but this code does *not* achieve that.

**Fix:** real solution is to recover the panic and present a sanitized error to the user; do not rely on traceback levels for security.

---

## Bug 14 — `defer` capturing a stale stack

```go
func process(item Item) {
    defer func() {
        if r := recover(); r != nil {
            // BUG: pcs captured BEFORE the panic site
            pcs := make([]uintptr, 32)
            n := runtime.Callers(0, pcs)
            log.Printf("panic %v\n%s", r, formatFrames(pcs[:n]))
        }
    }()
    work(item)
}
```

**Bug:** Inside a `defer ... recover()`, calling `runtime.Callers` gives you the **deferred function's** stack, not the panic site's stack. The trace ends up uninformative.

**Fix:** use `debug.Stack()`, which the runtime captures *before* unwinding — it shows the panicking goroutine's stack:
```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic %v\n%s", r, debug.Stack())
    }
}()
```

`debug.Stack()` works correctly inside recover because it inspects the goroutine's saved state; raw `runtime.Callers` from inside the deferred function does not.

---

## Bug 15 — Block profile rate set too high

```go
runtime.SetBlockProfileRate(1)  // every block!
```

**Bug:** A rate of `1` samples *every* blocking event — channel ops, mutex waits, syscalls. In a busy server this can be tens of thousands per second, generating significant overhead.

**Fix:** sample, do not capture:
```go
runtime.SetBlockProfileRate(1000)  // sample every 1000th, ~ms granularity
```

Same for `SetMutexProfileFraction`. Use `1` only when actively investigating.

---

## Bug 16 — pprof endpoints exposed publicly

```go
http.ListenAndServe(":8080", nil)  // includes net/http/pprof handlers
```

**Bug:** Importing `_ "net/http/pprof"` registers handlers on `http.DefaultServeMux`. If the public-facing server uses the default mux, pprof endpoints become *publicly accessible*. They reveal goroutine stacks, heap contents, and CPU profiles — significant information leak.

**Fix:** mount pprof on a separate, private port:
```go
go http.ListenAndServe("localhost:6060", nil)  // only pprof, internal
http.ListenAndServe(":8080", myAppMux)         // public, no pprof
```

---

## Bug 17 — `errors.New` capturing stack via global init

```go
var ErrNotFound = errors.New("not found")  // no stack

func find(id int) error {
    return ErrNotFound  // returns shared sentinel
}
```

**Bug:** This is *not* a bug in normal usage, but is presented because some assume sentinels carry a stack. They do not. If you need to know *where* a `find` failed, you must wrap with context (or use a stack-aware error type) — the sentinel by itself tells you only the kind.

**Fix:** wrap when you need location:
```go
return fmt.Errorf("find %d: %w", id, ErrNotFound)
```

---

## Bug 18 — Forgetting `t.Helper()`

```go
func mustEqual(t *testing.T, got, want int) {
    if got != want {
        t.Errorf("got %d, want %d", got, want)
    }
}

func TestX(t *testing.T) {
    mustEqual(t, 1, 2)  // failure points at mustEqual, not TestX
}
```

**Bug:** When the assertion fails, `t.Errorf` reports the line inside `mustEqual` instead of the caller. With dozens of assertions this makes failures hard to locate.

**Fix:** mark the helper:
```go
func mustEqual(t *testing.T, got, want int) {
    t.Helper()
    if got != want {
        t.Errorf("got %d, want %d", got, want)
    }
}
```

`t.Helper` tells the framework to skip this function when reporting the failing line.

---

## Bug 19 — Goroutine ID parsed from `runtime.Stack`

```go
func goroutineID() int64 {
    var buf [64]byte
    n := runtime.Stack(buf[:], false)
    s := string(buf[:n])
    // parse "goroutine 42 [running]:"
    fields := strings.Fields(s)
    id, _ := strconv.ParseInt(fields[1], 10, 64)
    return id
}
```

**Bug:** Multiple problems:
1. **Performance**: `runtime.Stack` is microseconds; calling it for an ID is wildly inefficient.
2. **Stability**: Go intentionally does *not* expose goroutine IDs. The format may change.
3. **Misuse**: people use this for thread-local-style state, which Go discourages.

**Fix:** **do not** use goroutine IDs. Pass values explicitly through `context.Context`. If you genuinely need a unique ID for a logical operation, generate one yourself (UUID) and pass it through context.

---

## Bug 20 — Crashing on cgo SIGSEGV

```go
// ...assume cgo C code dereferences a bad pointer...
```

**Bug:** SIGSEGV in C code that was called via cgo crashes the whole process. The Go runtime cannot recover from C-side faults the way it recovers from Go panics. Setting `recover()` does nothing; the runtime gets a SIGSEGV from the OS and the process dies.

**Fix:** there is no clean fix in Go. Approaches:
- Validate inputs **before** calling into C.
- Run cgo-heavy code in a separate process whose crash you can survive.
- For memory-mapped I/O specifically, `runtime/debug.SetPanicOnFault(true)` makes some non-nil-address faults recoverable. Use cautiously.

The general lesson: cgo undermines Go's crash-safety model. Treat C-side errors as fatal unless you have a hard requirement otherwise.
