# panic and recover — Find the Bug

> Each snippet contains a real-world bug related to panic, recover, or defer. Find it, explain it, fix it.

---

## Bug 1 — recover called outside a deferred function

```go
func safeRun(fn func()) {
    fn()
    if r := recover(); r != nil {
        log.Printf("recovered: %v", r)
    }
}
```

**Bug:** `recover()` is called normally, not from a deferred function. It returns nil. The panic is not caught and crashes the program.

**Fix:**
```go
func safeRun(fn func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("recovered: %v", r)
        }
    }()
    fn()
}
```

---

## Bug 2 — recover one level too deep

```go
func handle() {
    if r := recover(); r != nil {
        log.Printf("caught: %v", r)
    }
}

func main() {
    defer handle()
    panic("boom")
}
```

**Bug:** Although `handle` is called *via* a deferred call, `recover()` inside `handle` is one frame removed from the deferred call. In modern Go this *can* still work (because `handle` is the deferred function), but the more common shape has `recover` deeper:

```go
func cleanup() {
    handle() // recover is two frames below the deferred call
}
defer cleanup()
panic("boom")
```

In this case `recover()` returns nil and the panic crashes the program.

**Fix:** put the recover directly in the deferred function body:
```go
defer func() {
    if r := recover(); r != nil { /* ... */ }
}()
```

This shape is unambiguous and recommended.

---

## Bug 3 — panic in goroutine without recover

```go
func main() {
    go func() {
        panic("worker died")
    }()
    time.Sleep(time.Second)
    fmt.Println("never reached")
}
```

**Bug:** The goroutine panic crashes the entire program. Main goroutine's "recover" (if any) does not apply across goroutine boundaries.

**Fix:**
```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v", r)
        }
    }()
    panic("worker died")
}()
```

---

## Bug 4 — defer registered after the panic

```go
func main() {
    panic("boom")
    defer func() { recover() }() // never registered
}
```

**Bug:** The `defer` is unreachable code (the panic already triggered). Defers must be registered **before** the panic occurs.

**Fix:** put `defer` first:
```go
func main() {
    defer func() {
        if r := recover(); r != nil {
            log.Print(r)
        }
    }()
    panic("boom")
}
```

---

## Bug 5 — recover with non-named return

```go
func F(fn func()) error {
    var err error
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    fn()
    return err
}
```

**Bug:** Although `err` is set in the deferred function, the enclosing function has *already evaluated* the `return err` expression. By the time the defer runs, the return value is fixed. The caller sees nil.

**Fix:** use a named return:
```go
func F(fn func()) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    fn()
    return nil
}
```

With a named return, the deferred function's assignment to `err` is visible to the caller.

---

## Bug 6 — silent panic swallowing

```go
func work() {
    defer func() { recover() }()
    riskyStuff()
}
```

**Bug:** The recover discards everything. No log, no metric, no error returned. Future bugs that should crash the program are silently masked.

**Fix:** at minimum, log:
```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("work recovered: %v\n%s", r, debug.Stack())
    }
}()
```

Or convert to error and return.

---

## Bug 7 — panic for ordinary errors

```go
func ParseAge(s string) int {
    n, err := strconv.Atoi(s)
    if err != nil {
        panic(err)
    }
    return n
}
```

**Bug:** Panics on bad user input. Callers cannot anticipate the panic from the function signature. The whole program may crash on a typo.

**Fix:** return an error:
```go
func ParseAge(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parse age: %w", err)
    }
    return n, nil
}
```

If you have a use case for static input, also provide `MustParseAge`.

---

## Bug 8 — recover inside a goroutine, panic in another goroutine

```go
func main() {
    defer func() {
        if r := recover(); r != nil {
            log.Print("recovered:", r)
        }
    }()
    go func() {
        panic("x")
    }()
    time.Sleep(time.Second)
}
```

**Bug:** The recover is in the main goroutine. The panic is in a different goroutine. They do not connect — the spawned goroutine crashes the program.

**Fix:** the recover must be inside the goroutine that may panic:
```go
go func() {
    defer func() {
        if r := recover(); r != nil { log.Print(r) }
    }()
    panic("x")
}()
```

---

## Bug 9 — defer in a loop registers many recovers

```go
func processAll(items []func()) {
    for _, fn := range items {
        defer func() {
            if r := recover(); r != nil { log.Print(r) }
        }()
        fn()
    }
}
```

**Bugs:**
1. Defers do not run until `processAll` returns. So a panic in the first iteration is caught by the first defer, but `fn()` in subsequent iterations never runs (panic interrupted the loop).
2. Even without panic, all defers stack up to run only at function exit — wasteful.

**Fix:** wrap each iteration in its own function:
```go
for _, fn := range items {
    safeCall(fn)
}

func safeCall(fn func()) {
    defer func() {
        if r := recover(); r != nil { log.Print(r) }
    }()
    fn()
}
```

---

## Bug 10 — log.Fatal hides defers

```go
func saveUser(u User) {
    f, err := os.Create("user.json")
    if err != nil {
        log.Fatal(err) // BUG: skips deferred Close on prior open files, etc.
    }
    defer f.Close()
    // ...
}
```

**Bug:** `log.Fatal` calls `os.Exit`, which does not run deferred functions. If the function is part of a larger flow that has resources held by other defers in the call stack, those defers are lost.

**Fix:** return an error and let main decide:
```go
func saveUser(u User) error {
    f, err := os.Create("user.json")
    if err != nil {
        return err
    }
    defer f.Close()
    // ...
    return nil
}
```

---

## Bug 11 — re-panic loses original stack

```go
defer func() {
    if r := recover(); r != nil {
        log.Print("logged")
        panic(r)
    }
}()
```

**Bug:** Re-panicking with `panic(r)` works, but the new panic is reported from *this* line, losing the original stack location.

**Fix:** capture the stack at the recover point:
```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("recovered: %v\n%s", r, debug.Stack())
        panic(r)
    }
}()
```

The stack trace is logged at the point of recovery (still close to the original panic), and the program still crashes for visibility.

---

## Bug 12 — recover swallowing a runtime corruption

```go
func deepWork() {
    defer func() { recover() }()
    var p *MyStruct
    p.Update() // nil deref panics; recovered silently
}
```

**Bug:** Recovering from a nil dereference may indicate a *real* bug — perhaps caused by a race, perhaps by missed initialization. Silently swallowing it lets the program continue with broken assumptions; the next call may corrupt data.

**Fix:** log at minimum, ideally let the panic crash the process so the bug is found and fixed:
```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("FATAL: deepWork: %v\n%s", r, debug.Stack())
        panic(r) // re-panic to crash
    }
}()
```

If you absolutely must keep running, log loudly and increment a metric tagged "suspected bug."

---

## Bug 13 — Forgetting to type-assert the panic value

```go
defer func() {
    err := recover().(error) // BUG
    log.Print(err)
}()
```

**Bug:** Two problems:
1. If `recover()` returns nil (no panic), `nil.(error)` panics with "interface conversion: <nil> is not error."
2. If the panic value is a string (`panic("x")`), `recover().(error)` panics with "interface conversion: string is not error."

**Fix:** check before asserting, and use the two-value form:
```go
defer func() {
    r := recover()
    if r == nil { return }
    if err, ok := r.(error); ok {
        log.Printf("error panic: %v", err)
    } else {
        log.Printf("non-error panic: %v", r)
    }
}()
```

---

## Bug 14 — Defer modifying named return without naming it

```go
func GetData() (result []byte, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
            // BUG: forgot to clear result
        }
    }()
    result = doRiskyWork() // panic mid-way
    return
}
```

**Bug:** If `doRiskyWork` panics partway through and writes a partial value, `result` may be non-nil garbage. The recover sets `err` but does not clear `result`. Caller may see a non-nil error and a non-nil partial result, violating the contract that a non-nil error means the value is invalid.

**Fix:** clear the value too:
```go
defer func() {
    if r := recover(); r != nil {
        err = fmt.Errorf("recovered: %v", r)
        result = nil
    }
}()
```

---

## Bug 15 — Catching panic at the wrong layer

```go
func ServeHTTP(w http.ResponseWriter, r *http.Request) {
    defer func() {
        if rec := recover(); rec != nil {
            // ... some handling
        }
    }()
    handler.ServeHTTP(w, r) // calls handler that spawns goroutines
}
```

**Bug:** The recover only catches panics in the synchronous call chain. If `handler.ServeHTTP` spawns goroutines, panics in those goroutines bypass this recover and crash the program.

**Fix:** ensure spawned goroutines have their own recover:
```go
go func() {
    defer func() {
        if r := recover(); r != nil { log.Print(r) }
    }()
    background()
}()
```

This is per-goroutine, not per-request.

---

## Bug 16 — Releasing a lock outside its critical section after panic

```go
func update(m *sync.Mutex, ptr *int) {
    m.Lock()
    *ptr = 1 // may panic if ptr is nil
    m.Unlock()
}
```

**Bug:** If `*ptr = 1` panics (nil deref), `m.Unlock()` does not run. The lock is held forever; subsequent locks deadlock.

**Fix:** always release locks via defer:
```go
func update(m *sync.Mutex, ptr *int) {
    m.Lock()
    defer m.Unlock()
    *ptr = 1
}
```

---

## Bug 17 — Type assertion that may panic

```go
func handle(v any) string {
    return v.(string) // BUG: panics if v is not a string
}
```

**Bug:** Single-value type assertion panics on type mismatch. Caller may not expect the panic.

**Fix:** use the two-value form:
```go
func handle(v any) (string, bool) {
    s, ok := v.(string)
    return s, ok
}
```

Or: handle the panic if you want to keep the API:
```go
func handle(v any) (s string, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("not a string: %T", v)
        }
    }()
    return v.(string), nil
}
```

(The `defer/recover` form is uglier but works.)

---

## Bug 18 — panic(nil) on old Go

```go
func main() {
    defer func() {
        r := recover()
        if r == nil {
            fmt.Println("no panic")
            return
        }
        fmt.Println("panic:", r)
    }()
    panic(nil)
}
```

**Bug:** On Go ≤ 1.20, `panic(nil)` makes `recover()` return nil — looking like no panic happened. The recovery logic prints "no panic" even though something *did* panic.

**Fix on Go 1.21+:** `panic(nil)` is automatically replaced by `panic(&runtime.PanicNilError{})`, so `recover()` returns non-nil.

**Fix in code:** never call `panic(nil)`. If you need a "marker" panic, use a known sentinel:
```go
var errAbort = errors.New("abort")
panic(errAbort)
```

---

## Bug 19 — Defer error captures stale loop variable

```go
for _, item := range items {
    defer func() {
        if err := process(item); err != nil { log.Print(err) }
    }()
}
```

**Bug:** Pre-Go-1.22, `item` is captured by reference, so all deferred closures see the *last* item (and re-process it N times). Plus the defers all run at function exit, not per iteration.

**Fix (Go 1.22+):** the loop variable is per-iteration, and the closure captures the right one. But the function-end execution issue remains.

**Better fix:** call the work in a separate function:
```go
for _, item := range items {
    func(it Item) {
        defer func() {
            if err := process(it); err != nil { log.Print(err) }
        }()
    }(item)
}
```

(Or just don't use defer here; defer is for cleanup at function exit, not for per-iteration work.)

---

## Bug 20 — Stack overflow from infinite recursion

```go
func recurse() {
    defer func() {
        if r := recover(); r != nil {
            log.Print("recovered:", r)
        }
    }()
    recurse()
}
```

**Bug:** Infinite recursion eventually causes a stack overflow. In some configurations, this is reported as a fatal error (`runtime: goroutine stack exceeds limit`) — `recover()` cannot catch fatal errors.

Even when the runtime gives a regular `panic: runtime error: stack overflow`, the `defer` registered in each recursive call has filled the stack before the panic.

**Fix:** the bug is the infinite recursion. Add a base case:
```go
func recurse(n int) {
    if n <= 0 { return }
    recurse(n - 1)
}
```

`recover` cannot save you from infinite recursion.
