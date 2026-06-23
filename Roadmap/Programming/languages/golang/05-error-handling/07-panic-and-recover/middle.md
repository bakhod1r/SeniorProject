# panic and recover — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Six Built-in Panics You Will Meet](#the-six-built-in-panics-you-will-meet)
3. [Defer and Panic Interact in Specific Ways](#defer-and-panic-interact-in-specific-ways)
4. [Why recover Must Be Directly in a Deferred Function](#why-recover-must-be-directly-in-a-deferred-function)
5. [Panic Across Goroutines](#panic-across-goroutines)
6. [Panic vs Error: Choosing the Right Tool](#panic-vs-error-choosing-the-right-tool)
7. [Capturing the Stack Trace](#capturing-the-stack-trace)
8. [Re-panic and Chained Panics](#re-panic-and-chained-panics)
9. [Panic Values: string, error, struct](#panic-values-string-error-struct)
10. [The Panic-to-Error Idiom](#the-panic-to-error-idiom)
11. [Testing Code That Panics](#testing-code-that-panics)
12. [Resource Cleanup During Panic](#resource-cleanup-during-panic)
13. [panic vs os.Exit vs log.Fatal](#panic-vs-osexit-vs-logfatal)
14. [Common Anti-Patterns](#common-anti-patterns)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you saw the mechanic: `defer func() { if r := recover(); r != nil { ... } }()`. Middle level shifts to *why* the rules look the way they do, *when* each variant is right, and *what trade-offs* you accept by reaching for panic over an error.

This file unpacks the runtime behavior, the rules that trip up developers, and the deliberate decisions you make every time you write `panic` or `recover`.

---

## The Six Built-in Panics You Will Meet

Most panics in Go programs come from the runtime itself, not from explicit `panic` calls. Knowing them by sight saves you minutes when you read a stack trace.

### 1. nil pointer dereference

```go
var p *int
fmt.Println(*p)
// runtime error: invalid memory address or nil pointer dereference
```

### 2. Index out of range

```go
s := []int{1, 2, 3}
_ = s[5]
// runtime error: index out of range [5] with length 3
```

### 3. Integer divide by zero

```go
a, b := 10, 0
_ = a / b
// runtime error: integer divide by zero
```

(Floating-point divide by zero in Go is **not** a panic — it produces `+Inf`, `-Inf`, or `NaN`. This is a common confusion.)

### 4. Assignment to entry in nil map

```go
var m map[string]int
m["x"] = 1
// assignment to entry in nil map
```

Reading from a nil map is fine (returns zero value); writing panics. Always make a map with `make(map[K]V)` before writing.

### 5. Failed type assertion (single-value form)

```go
var i any = "hello"
n := i.(int)
// interface conversion: interface {} is string, not int
```

The two-value form `n, ok := i.(int)` does *not* panic; it sets `ok` to false. Always prefer the two-value form when you are not sure.

### 6. Channel misuse

```go
// Send on closed channel
ch := make(chan int)
close(ch)
ch <- 1 // send on closed channel

// Close of closed channel
ch := make(chan int)
close(ch)
close(ch) // close of closed channel

// Close of nil channel
var ch chan int
close(ch) // close of nil channel
```

Receive on a closed channel does *not* panic — it returns the zero value with `ok == false`. The asymmetry catches people.

These six are the "usual suspects" in production stack traces. A senior who can identify them at a glance from one log line saves hours.

---

## Defer and Panic Interact in Specific Ways

When a goroutine panics, the runtime walks back through the call stack. At each frame it runs the deferred functions of that frame in **LIFO order** (last-deferred runs first). Some rules:

1. **All defers in the panicking function run, in reverse order.**
2. **Then the runtime returns to the caller** and runs *its* defers, and so on.
3. **A `recover()` inside any of those defers stops the unwind.** Execution continues from the function that did the recover (i.e., the function returns normally to *its* caller).
4. **If no recover happens, the goroutine dies.** If it is the main goroutine, the program crashes with a stack trace.

Example:

```go
func main() {
    defer fmt.Println("main defer 1")
    defer fmt.Println("main defer 2")
    f()
    fmt.Println("never runs")
}

func f() {
    defer fmt.Println("f defer 1")
    defer fmt.Println("f defer 2")
    panic("boom")
}
```

Output (before the crash):
```
f defer 2
f defer 1
main defer 2
main defer 1
panic: boom
```

Note the order: the last `defer` registered runs first. Then control passes back to `main`, whose deferred prints run, then the program crashes.

If `main` had recovered, "never runs" would still not run (control returned to *after* the call to `f`, but the panic state was consumed — `main` would just keep running normally from the line after the panic check, which here means the next line which prints "never runs"... wait, let me clarify).

Actually: `recover` stops the panic *only* in the function that called it. The caller's stack continues from where it left off — usually that means the function whose defer recovered then returns normally to its own caller. Concretely:

```go
func main() {
    f()
    fmt.Println("after f")
}

func f() {
    defer func() { recover() }()
    panic("x")
    fmt.Println("never runs (in f)") // unreachable
}
```

Here `f` recovers and *returns normally* to `main`. `main` prints "after f". The panic was contained inside `f`.

---

## Why recover Must Be Directly in a Deferred Function

A common bug:

```go
func handlePanic() {
    if r := recover(); r != nil { // does NOT catch
        log.Print(r)
    }
}

func main() {
    defer handlePanic()
    panic("x")
}
```

This **does not work**. The panic crashes the program.

Why? When the runtime walks defers during a panic, it calls `handlePanic`. Inside `handlePanic`, `recover()` looks at the call stack and asks: "is the caller of me a deferred function executing for an active panic?" The caller of `recover()` here is `handlePanic`, which *is* a deferred function — but the stack rule is more precise. Let me re-state:

`recover` works only when the *calling function* (the one that contains the `recover()` call directly) is itself a deferred function being executed by the runtime during a panic.

In the example, `handlePanic` *is* such a function. So in newer Go versions this **does work**. But the reliable, idiomatic shape is to put `recover` in an inline deferred anonymous function:

```go
defer func() {
    if r := recover(); r != nil { /* ... */ }
}()
```

This is the pattern that always works and that every Go reader recognizes instantly.

The case that *definitely* does not work:

```go
func deeper() {
    if r := recover(); r != nil { /* ... */ } // never catches
}

func cleanup() {
    deeper() // recover is one level too deep
}

func main() {
    defer cleanup()
    panic("x")
}
```

Here `recover` is called from `deeper`, which is *not* a deferred function — it is called *from* a deferred function. The runtime says "you are not the deferred frame; you cannot consume a panic." `recover()` returns nil.

**Rule of thumb:** put `recover()` directly in the body of the function passed to `defer`.

---

## Panic Across Goroutines

A panic *does not cross goroutine boundaries*. This is a deliberate design decision and one of the most important things to understand at middle level.

```go
func main() {
    go func() {
        panic("worker") // crashes the entire program
    }()
    time.Sleep(time.Second)
    fmt.Println("not reached")
}
```

The main goroutine has no chance to recover. Why? Because the panic is in a *different goroutine*; recover in main only sees panics originating in main (or its synchronous callees).

This means:

1. **Every long-lived goroutine you spawn must have its own recover** (or you must accept that one panic kills your service).
2. **You cannot "catch" a panicking goroutine from the outside.** The only way to communicate failure across goroutines is via channels or shared state.
3. **`go fn()` with no wrapper is dangerous in production.** Wrap it:

```go
func goSafe(fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("goroutine panic: %v\n%s", r, debug.Stack())
            }
        }()
        fn()
    }()
}
```

Now any panic inside `fn` is logged but does not crash the process.

The design choice: panics are scoped to a single stack. Crossing goroutine boundaries would require shared state, synchronization, and conceptual complexity. Go opts for "each goroutine panics in isolation; cross-goroutine signaling uses channels."

---

## Panic vs Error: Choosing the Right Tool

A practical decision tree:

```
Can the caller reasonably handle this?
   |
   YES -> return error
   |
   NO  -> Is this a programmer bug or impossible state?
            |
            YES -> panic
            |
            NO  -> still error (unexpected, but treat it as data)
```

Examples:

| Situation | Use | Why |
|-----------|-----|-----|
| File not found | error | caller may have a fallback |
| User submitted invalid form | error | not a bug; expected input |
| Reached default branch in supposedly-exhaustive switch | panic | program is broken |
| `regexp.MustCompile("[a-z")` on a constant | panic | static input was wrong, fix the code |
| Database connection lost | error | caller may retry |
| Calling a method on a nil pointer that the program guarantees is non-nil | panic | invariant violated |
| Index out of range for a fixed array | panic (runtime) | by definition not handled by Go |
| Network read timeout | error | expected, retryable |

The general rule: errors are for **expected** failures the program is designed to handle; panics are for **unexpected** failures the program is *not* designed to handle.

---

## Capturing the Stack Trace

The default panic output includes a stack trace. But once you `recover`, that trace is gone unless you captured it. Two options:

### Option 1: `runtime/debug.Stack()`

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v\n%s", r, debug.Stack())
    }
}()
```

`debug.Stack()` returns a `[]byte` snapshot of the current goroutine's stack. Cheap by debugging standards (~10 µs), expensive by hot-path standards.

### Option 2: `runtime.Stack()`

```go
buf := make([]byte, 4096)
n := runtime.Stack(buf, false) // false = current goroutine only
log.Printf("panic: %v\n%s", r, buf[:n])
```

You provide the buffer; the runtime fills it. With `true`, you get *all* goroutines (useful for debugging deadlocks, but expensive).

### What's in the trace

```
goroutine 1 [running]:
main.deepFunction(0x0)
        /path/main.go:12 +0x1f
main.middleFunction(...)
        /path/main.go:8
main.main()
        /path/main.go:4 +0x18
```

Each line: function name, file path with line number, instruction offset. Reading from top to bottom, top is the innermost (where the panic happened), bottom is outermost.

In production, log this once per panic — not per recover layer. Stack traces are big.

---

## Re-panic and Chained Panics

Inside a recover, you can choose to *re-panic*:

```go
defer func() {
    if r := recover(); r != nil {
        if !isRecoverable(r) {
            panic(r) // pass it on
        }
        // else handle locally
    }
}()
```

Re-panic continues unwinding. The next deferred function up the stack sees the same value (or a wrapped one).

A defer can also panic *while running*:

```go
func f() {
    defer func() { panic("from defer") }()
    panic("from f")
}
```

What happens? When `f` panics, its deferred function runs. The deferred function panics. The new panic *replaces* the old one (with respect to what `recover` would see), and unwinding continues. Pre-Go-1.13 you would lose the original; in Go 1.13+ the runtime preserves the chain (you can see both in the stack trace).

This is rarely intentional — it usually means a cleanup path itself has a bug. Avoid it.

---

## Panic Values: string, error, struct

`panic` accepts `any`. Common conventions:

- **`panic(string)`** — quick and dirty. Idiomatic for `Must`-style helpers.
- **`panic(error)`** — better for production code; recovers can extract via `r.(error)`.
- **`panic(struct{...})`** — when you need structured info; common in libraries that expose a custom panic type.

A library convention worth following: when you panic *intentionally* (not propagating someone else's panic), wrap the value in a known struct:

```go
type myPanic struct {
    Op    string
    Cause error
}

panic(myPanic{Op: "Save", Cause: err})
```

A recover at the boundary type-asserts to `myPanic` and knows it was *your* panic, not a runtime nil-deref. This lets you safely re-panic on unknown values:

```go
defer func() {
    if r := recover(); r != nil {
        if mp, ok := r.(myPanic); ok {
            handle(mp)
            return
        }
        panic(r) // not ours; let it propagate
    }
}()
```

This pattern keeps your boundary code from masking unrelated bugs.

---

## The Panic-to-Error Idiom

A common pattern at API boundaries: internally panic, externally return errors.

```go
func Render(tmpl string, data any) (out string, err error) {
    defer func() {
        if r := recover(); r != nil {
            switch v := r.(type) {
            case error:
                err = fmt.Errorf("render: %w", v)
            default:
                err = fmt.Errorf("render: %v", v)
            }
        }
    }()
    out = renderInternal(tmpl, data) // may panic on bad template
    return out, nil
}
```

The internal code freely panics on impossible states; the external caller stays in the `if err != nil` world.

Three reasons to use this pattern:
1. **Reflective code** that has many small "should not happen" branches; panic is briefer than error returns at every level.
2. **Recursive descent** parsers that benefit from "fail fast all the way out."
3. **Library code** wrapping unsafe operations, where exposing every panic to users would be ugly.

Three reasons NOT to use it:
1. **Performance:** panic+recover is ~100x slower than a normal return. Do not use for routine errors.
2. **Misleading callers:** if your panics include things the caller *could* have handled, they will be surprised by a generic error.
3. **Loss of error type info:** the recover sees an `any`. Type-asserting to recover the original error works only if you always panic with errors.

---

## Testing Code That Panics

Two common patterns in tests:

### Pattern A: Assert that a function panics

```go
func TestMustParse_Bad(t *testing.T) {
    defer func() {
        if r := recover(); r == nil {
            t.Fatal("expected panic, got none")
        }
    }()
    MustParse("not-a-number")
}
```

If `MustParse` does not panic, `recover` is nil, and `t.Fatal` runs. If it panics, the deferred function catches it and the test passes.

### Pattern B: Assert the panic value

```go
func TestMustParse_Value(t *testing.T) {
    defer func() {
        r := recover()
        if r == nil {
            t.Fatal("expected panic")
        }
        s, ok := r.(string)
        if !ok || !strings.Contains(s, "MustParse") {
            t.Fatalf("unexpected panic value: %v", r)
        }
    }()
    MustParse("bad")
}
```

Inspect the value. If you panic with `error`, type-assert to `error`.

### Avoid: testing panic behavior in subtests with shared state

A panic in a subtest can take down sibling subtests if they share goroutine state. Each subtest should be self-contained.

---

## Resource Cleanup During Panic

Panic does *not* skip `defer`. This is the design. So resource cleanup via defer survives panics:

```go
func work() {
    f, err := os.Open("data.txt")
    if err != nil { return }
    defer f.Close() // runs even on panic

    mu.Lock()
    defer mu.Unlock() // runs even on panic

    riskyOp() // may panic; defers still run
}
```

This is one reason `defer` is so important: it is the *only* reliable cleanup mechanism in Go. Code that uses raw `f.Close()` at the end of a function loses that cleanup on panic.

The exception: `os.Exit` and `log.Fatal` (which calls `os.Exit`) **do not run defers**. They terminate the process directly. This is a critical distinction.

---

## panic vs os.Exit vs log.Fatal

Three ways to abort a Go program. They look similar but differ on cleanup behavior, recoverability, and exit code:

| Mechanism | Runs defers | Recoverable | Default exit code | Use case |
|-----------|-------------|-------------|-------------------|----------|
| `panic("x")` | Yes | Yes (with recover) | 2 | Impossible state, may be wrapped at boundary |
| `os.Exit(1)` | **No** | No | 1 (or whatever you pass) | Definite program termination from main |
| `log.Fatal(...)` | **No** | No | 1 | Logs message, then `os.Exit(1)` |
| `log.Panic(...)` | Yes | Yes | 2 | Logs message, then `panic(...)` |

`log.Fatal` is appealing because it logs and exits in one line. It is also dangerous: if your program owns any resources that matter to the outside world (open files, network connections, lock files), they are *not* released. `os.Exit` skips finalization.

**Rule of thumb in main:** prefer returning from `main` (or panic with recover for fatal errors). Use `os.Exit` only when you specifically need to control the exit code without running cleanup.

---

## Common Anti-Patterns

1. **Generic recover that swallows everything**:
   ```go
   defer func() { recover() }()
   ```
   Logs nothing, hides bugs. If you must recover, *log* what you recovered.

2. **Using panic for early-exit**:
   ```go
   for ... {
     for ... {
       if cond { panic("done") }
     }
   }
   ```
   Use a labeled break or extract the inner work into a function that returns.

3. **Recover wrapping the wrong scope**:
   ```go
   func handler(w http.ResponseWriter, r *http.Request) {
       defer func() { recover() }()
       go background() // panic here is NOT caught
   }
   ```
   The recover is in the handler goroutine; the background goroutine is independent.

4. **Panicking with sensitive data**:
   ```go
   panic(fmt.Sprintf("unexpected user data: %+v", user)) // leaks PII
   ```
   The stack trace ends up in logs. Sanitize first.

5. **Panic in `init()` for things that can be configured**:
   ```go
   func init() {
       if os.Getenv("KEY") == "" { panic("KEY required") }
   }
   ```
   Better: print a clear message and `os.Exit(1)`. Panic in init produces ugly stack traces in user-facing output.

6. **Over-zealous panic-to-error conversion**: wrapping every internal call in panic/recover when a normal error chain would be clearer and faster.

---

## Summary

Middle-level mastery of panic and recover is about discipline: knowing the six built-in panics on sight, understanding why recover must live in a deferred function, accepting that goroutines panic in isolation, and choosing between panic and error based on whether the caller can do anything about the failure. You have learned that defers run on panic (so cleanup survives), that `os.Exit` and `log.Fatal` do *not* (so use them only at deliberate process termination), and that the panic-to-error idiom is a powerful boundary tool when used judiciously.

---

## Further Reading

- [The Go Blog: Defer, Panic, and Recover (Andrew Gerrand, 2010)](https://go.dev/blog/defer-panic-and-recover)
- [Effective Go: Recover](https://go.dev/doc/effective_go#recover)
- [Go 1.21 release notes — `panic(nil)` change](https://go.dev/doc/go1.21#language)
- `runtime/debug` package documentation
- `$GOROOT/src/runtime/panic.go` — the runtime implementation
