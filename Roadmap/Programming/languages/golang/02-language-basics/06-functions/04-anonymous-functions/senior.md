# Go Anonymous Functions — Senior Level

## 1. Overview

Senior-level mastery of anonymous functions means understanding how the compiler lowers a function literal to a funcval, when captures stack-allocate vs heap-allocate, the cost of indirect calls through function values, the loop-variable semantic change in Go 1.22, and the production patterns that arise from misuse — leaks, races, performance regressions.

---

## 2. Advanced Semantics

### 2.1 Compilation of a Function Literal

A function literal is compiled into:
- A static piece of code (a function in the binary, named like `main.main.func1`).
- A funcval value that points to that code (and to captured variables, if any).

For non-capturing literals, the funcval is essentially a single code-pointer word (often hoisted to a global, so each instantiation is free). For capturing literals, the funcval includes captures.

### 2.2 Closure Layout

The compiler synthesizes a "closure struct" containing the captured variables. The funcval points to this struct via the closure context register (DX on amd64).

```
funcval {
    code: ptr to compiled body
}

closure-struct {
    capture0
    capture1
    ...
}
```

Inside the literal body, captured variable references are translated into loads through the context register: `MOV (DX), AX` etc.

### 2.3 Stack vs Heap Allocation of Closures

Decision is made by escape analysis:

- **Non-escaping closure** → stack-allocated. Lives in the enclosing function's frame.
- **Escaping closure** → heap-allocated. Closure struct + captures move to the heap.

```go
// Non-escaping
func nonEscape() {
    x := 1
    f := func() int { return x }
    _ = f()
}

// Escaping — closure returned
func escape() func() int {
    x := 1
    return func() int { return x }
}
```

Verify:
```bash
go build -gcflags="-m=2"
# Look for: "func literal escapes to heap" or "func literal does not escape"
```

### 2.4 Indirect Call Cost

Calling a function through a funcval is an **indirect call**:

```asm
MOVQ funcval, DX        ; load funcval pointer
MOVQ (DX), CX           ; load code pointer
; ... set up args ...
CALL CX                 ; indirect branch
```

Cost vs direct call: ~3-5 cycles extra on modern x86, plus inability to inline. In tight loops calling >100M times/sec, this matters.

PGO (Go 1.21+) can devirtualize hot indirect calls.

### 2.5 Loop Variable Semantic Change (Go 1.22)

The Go 1.22 change creates a new variable per iteration for ALL three for-loop forms when the loop variable is declared with `:=`:

```go
// Pre Go 1.22:
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }() // may print 3, 3, 3
}

// Go 1.22+:
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }() // prints 0, 1, 2 (each goroutine has its own i)
}
```

The change is gated by the `go` directive in `go.mod`. Modules declaring `go 1.22` get the new behavior; older modules retain the old.

For C-style `for` with mutation in body (e.g., `for i := 0; i < 3; i++`), each iteration gets its own `i` even though the post-statement increments. The compiler synthesizes this behind the scenes.

### 2.6 Function Literal in `defer` Argument Evaluation

```go
i := 1
defer fmt.Println(i) // i evaluated NOW; deferred call has i=1 baked in
i = 99

// With closure:
defer func() { fmt.Println(i) }() // closure captures i by reference
i = 99
// At return: prints 99
```

The first form is `defer call(args)` — args eager. The second form is `defer fn()` where fn is a closure capturing i.

### 2.7 Panic in a Deferred Closure

If a panic occurs in a deferred closure, it overrides any current panic:

```go
func foo() {
    defer func() {
        panic("from defer")
    }()
    panic("from body")
}

// Panic message: "from defer" — the second panic wins.
```

The original panic's stack trace is preserved in the runtime's panic chain (`runtime.Goexit` aside).

---

## 3. Production Patterns

### 3.1 Avoid Closures in Hot Loops

```go
// BAD — closure created each iteration
for _, x := range items {
    items := items // shadow (pre-1.22 fix)
    sched.Go(func() { process(x) })
}

// BETTER — pass as argument
for _, x := range items {
    sched.GoArg(processArg, x)
}

// processArg is a regular function; no per-iteration capture allocation
```

For hot inner loops, prefer plain function calls over closures.

### 3.2 Closure Lifetime and Goroutine Leaks

```go
func leak() {
    bigData := make([]byte, 1<<20)
    go func() {
        for {
            time.Sleep(time.Hour)
            _ = bigData[0] // keeps bigData alive forever
        }
    }()
}
```

The goroutine never exits, so `bigData` is never collected. For short-lived data, capture only what you need and nil out after use.

### 3.3 Functional Options With Validation

```go
type Server struct {
    addr   string
    port   int
    logger Logger
}

type Option func(*Server) error

func WithPort(p int) Option {
    return func(s *Server) error {
        if p < 1 || p > 65535 {
            return fmt.Errorf("invalid port: %d", p)
        }
        s.port = p
        return nil
    }
}

func NewServer(opts ...Option) (*Server, error) {
    s := &Server{addr: "localhost", port: 8080}
    for _, o := range opts {
        if err := o(s); err != nil {
            return nil, err
        }
    }
    return s, nil
}
```

Returning errors from options enables validation while preserving the literal-friendly call site.

### 3.4 Defer-and-Capture for Result Modification

```go
func processFile(path string) (count int, err error) {
    f, err := os.Open(path)
    if err != nil { return 0, err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    // ... read and count ...
    return count, nil
}
```

The deferred closure captures `f` and `err` (named return). Idiomatic for resource cleanup that may produce additional errors.

### 3.5 Lazy Initialization With sync.Once

```go
var (
    once sync.Once
    cfg  *Config
)

func getConfig() *Config {
    once.Do(func() {
        cfg = loadConfig()
    })
    return cfg
}
```

The closure passed to `Do` runs at most once across all goroutines. Standard pattern for lazy singletons.

### 3.6 Method Value vs Function Literal

```go
type Handler struct{}
func (h *Handler) Process(x int) {}

h := &Handler{}
// Method value — closure capturing h
fn1 := h.Process // creates funcval with bound receiver

// Equivalent function literal
fn2 := func(x int) { h.Process(x) }

// fn1 and fn2 are identical in behavior; fn1 uses Go's method-value mechanism.
```

Method values may allocate (boxing the receiver into a funcval). For hot paths, prefer method expressions:

```go
fn3 := (*Handler).Process // method expression: func(*Handler, int)
fn3(h, 42)
```

---

## 4. Concurrency Considerations

### 4.1 Goroutine Body Captures

```go
go func() {
    // Captures from enclosing scope.
    // Synchronize any shared mutable state.
}()
```

The closure captures variables by reference. If multiple goroutines write to the same captured variable, you need a mutex or atomic.

### 4.2 Loop-Variable Per-Iteration (Go 1.22+)

Per-iteration semantics make the classic capture-shared bug less likely, but watch for:
- Pre-1.22 modules (gated by `go.mod`).
- Goroutines spawned from outside `for ... range` (e.g., from a callback).
- Capture by mutation: `for ... { i = newVal; go func() { use(i) }() }` — explicit reassignment defeats per-iteration semantics.

### 4.3 Closure-Captured Mutex

```go
var mu sync.Mutex
items := []int{}
add := func(x int) {
    mu.Lock()
    defer mu.Unlock()
    items = append(items, x)
}
go add(1)
go add(2)
```

The closure captures `mu` and `items`. Both are shared safely as long as all access goes through the closure.

---

## 5. Memory and GC Interactions

### 5.1 Closure Allocation

For each escaping closure:
- 1 allocation for the closure struct (size depends on captures).
- The closure struct is GC-tracked normally.
- Captures that are pointer-typed are roots through the closure struct.

For non-escaping closures:
- Closure struct on the goroutine stack, freed at function return.
- No GC overhead.

### 5.2 Pinning Captured Memory

A closure captures pointers; those pointers keep their pointees alive. Long-lived closures pin captured objects:

```go
var globalCallback func()

func pin() {
    big := make([]byte, 1<<20)
    globalCallback = func() {
        _ = big // keeps 1 MB alive forever
    }
}
```

Set `globalCallback = nil` to release.

### 5.3 GC Sees Closure Struct Like Any Heap Object

The closure struct's pointer-shape map (generated by the compiler) tells the GC which fields are pointers. Captures of basic types (int, bool) don't add roots; pointer captures do.

---

## 6. Production Incidents

### 6.1 Closure-Captured Channel Causes Goroutine Leak

A long-running goroutine captured a channel from its caller. The caller exited but the goroutine waited forever on the channel. Memory grew until the process was killed.

Fix: introduce a context with cancellation; the goroutine selects on `ctx.Done()`.

### 6.2 Pre-1.22 Loop Variable Capture in Goroutine

Classic bug:
```go
for i := 0; i < 5; i++ {
    go func() { use(i) }()
}
```
All goroutines saw `i == 5`. Result: race on `i`, plus all writes hit the same `results[5]` causing index-out-of-bounds.

Fix: pass `i` as arg, or upgrade module to `go 1.22`+.

### 6.3 Defer in Loop Holding Resources

```go
for _, path := range paths {
    f, _ := os.Open(path)
    defer f.Close() // BUG
    // ...
}
```
All files stayed open until the function returned. Hit `EMFILE`.

Fix: extract a helper function so each defer scope is per-file.

### 6.4 Closure Holding Large `*http.Request`

A request-tracing library wrapped each handler in a closure that captured `*http.Request`. Closures were queued for batch processing. Result: each request held its body buffer alive for minutes.

Fix: extract minimal fields (URL, method, headers) before capturing.

---

## 7. Best Practices

1. **Keep literals short** — extract long ones.
2. **Pass loop variables as args** to goroutines for clarity (even with Go 1.22+ semantics).
3. **Extract minimum captures** — avoid pinning large objects.
4. **Use named functions** when stack traces matter.
5. **Always `()` after defer literals**.
6. **Verify escape behavior** with `-gcflags="-m"`.
7. **Avoid closures in hot inner loops** — prefer named or method expressions.
8. **Use functional options** for constructor flexibility.
9. **Use `sync.Once`** with a closure for lazy init.
10. **Use defer + closure** for cleanup-error capture.

---

## 8. Reading the Compiler Output

```bash
# Where do closures escape?
go build -gcflags="-m=2"

# Inlining decisions:
go build -gcflags="-m -m"

# Generated assembly:
go build -gcflags="-S"

# SSA passes:
GOSSAFUNC=foo go build .
```

Keywords to grep:
- `func literal escapes to heap`
- `func literal does not escape`
- `inlining call to <name>`
- `cannot inline <name>`

---

## 9. Self-Assessment Checklist

- [ ] I can predict whether a closure stack- or heap-allocates
- [ ] I understand the loop-variable change in Go 1.22
- [ ] I know the cost of indirect calls and when to avoid them
- [ ] I extract minimal captures to avoid pinning large objects
- [ ] I use defer + closure to capture cleanup errors
- [ ] I use sync.Once with closures for lazy init
- [ ] I avoid closures in hot inner loops where possible
- [ ] I know method values vs method expressions for hot paths
- [ ] I can read `-gcflags="-m"` output to verify behavior
- [ ] I can debug closure-related goroutine leaks

---

## 10. Summary

A function literal compiles to a code pointer plus an optional capture struct. Non-escaping captures stay on the stack; escaping captures heap-allocate. The Go 1.22 loop-variable change is gated by `go.mod` directive and applies to all for-forms when the iteration variable is `:=`. Watch for closure-driven goroutine leaks, indirect-call costs in hot loops, and over-captured large objects. Use defer + named-return + closure for clean resource cleanup with error propagation.

---

## 11. Further Reading

- [Go Blog — Loop variable scoping](https://go.dev/blog/loopvar-preview)
- [Go 1.22 release notes](https://go.dev/doc/go1.22)
- [Inlining optimisations in Go](https://dave.cheney.net/2020/04/25/inlining-optimisations-in-go)
- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- 2.6.5 Closures (deeper)
- 2.6.7 Call by Value
- 2.7.4 Memory Management
