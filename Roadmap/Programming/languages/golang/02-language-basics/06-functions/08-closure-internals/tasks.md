# Closure Internals — Tasks

Author: Bakhodir Yashin Mansur

Hands-on exercises. Each task has a goal, a starting hint, and a self-check. Solutions are intentionally not provided — they live in your editor.

---

## Task 1 — Counter via closure

**Goal**: write `makeCounter() func() int` so that each call returns the next integer starting from 1, and so two independent counters keep independent state.

**Hint**: declare an `int` in `makeCounter`, return a function literal that increments and returns it.

**Self-check**:

```go
c1, c2 := makeCounter(), makeCounter()
fmt.Println(c1(), c1(), c1()) // 1 2 3
fmt.Println(c2(), c2())       // 1 2
fmt.Println(c1())             // 4
```

Bonus: write `makeCounterFrom(start int)` that lets the caller choose the starting value.

---

## Task 2 — Prove that capture is by reference

**Goal**: write a single program that demonstrates the closure and the outer scope share a variable.

**Hint**: assign to the variable from outside the closure, then call the closure and observe the new value.

**Self-check**: your program prints something like:

```
before: 5
after outer mutation: 100
after closure mutation: 101
```

…showing both directions of the share.

---

## Task 3 — Prove that captured variables escape

**Goal**: write a closure that the compiler must heap-allocate the captured variable for. Confirm with `-gcflags='-m'`.

**Hint**: return a closure from a function. The captured local must outlive the frame.

**Self-check**: build with `go build -gcflags='-m'` and verify a message like:

```
./main.go:5:2: moved to heap: counter
```

Then modify the program so the closure is invoked locally and never escapes; confirm the message disappears.

---

## Task 4 — Reproduce the pre-1.22 loop bug

**Goal**: in a module with `go 1.21` in `go.mod`, run a `for` loop that captures the loop variable in goroutines and observe the bug. Then upgrade the module to `go 1.22` and observe the fix.

**Hint**: classic shape:

```go
for i := 0; i < 5; i++ {
    go func() { fmt.Println(i) }()
}
time.Sleep(50 * time.Millisecond)
```

**Self-check**: pre-1.22 prints `5 5 5 5 5` (order indeterminate). Post-1.22 (after changing the `go.mod`) prints `0 1 2 3 4` (order indeterminate).

Bonus: write the same loop with both the `v := v` shadow and the `func(v int){...}(v)` argument-pass workarounds. Verify they fix the bug at 1.21.

---

## Task 5 — Method value vs. method expression

**Goal**: compare allocation behaviour of a method value vs. a method expression for a struct with a pointer receiver.

**Hint**:

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

func BenchmarkMethodValue(b *testing.B) {
    c := &Counter{}
    for i := 0; i < b.N; i++ {
        f := c.Inc
        f()
    }
}

func BenchmarkMethodExpression(b *testing.B) {
    c := &Counter{}
    inc := (*Counter).Inc
    for i := 0; i < b.N; i++ {
        inc(c)
    }
}
```

**Self-check**: run `go test -bench=. -benchmem`. Compare allocs/op. The method value should sometimes allocate (depending on escape analysis); the method expression should not.

Bonus: extract the method value out of the loop and re-benchmark — note the change.

---

## Task 6 — Build a middleware chain

**Goal**: implement `chain(h Handler, ms ...Middleware) Handler` such that `chain(h, A, B, C)` produces `A(B(C(h)))`.

**Hint**:

```go
type Handler func(ctx context.Context) error
type Middleware func(Handler) Handler

func chain(h Handler, ms ...Middleware) Handler {
    // iterate ms in reverse order, wrapping h
}
```

**Self-check**: write three middlewares that log "enter X" and "exit X" around `next` and verify the order is `enter A, enter B, enter C, [handler], exit C, exit B, exit A`.

Bonus: add a middleware that injects a value into the context and have the handler read it.

---

## Task 7 — Measure indirect-call cost

**Goal**: benchmark a direct call vs. a call through a `func()` variable holding the same function. Report ns/op.

**Hint**:

```go
func add(a, b int) int { return a + b }

func BenchmarkDirect(b *testing.B) {
    s := 0
    for i := 0; i < b.N; i++ { s += add(i, 1) }
    _ = s
}

func BenchmarkIndirect(b *testing.B) {
    f := add
    s := 0
    for i := 0; i < b.N; i++ { s += f(i, 1) }
    _ = s
}
```

**Self-check**: indirect should be a few hundred picoseconds slower per call. Vary `-benchtime=10s` to reduce noise. Add `//go:noinline` to `add` to prevent the direct call from being inlined and rerun.

---

## Task 8 — `defer` in a loop disaster

**Goal**: write a function that opens 1000 files in a loop with `defer f.Close()` and observe that file descriptors aren't released until the function returns. Then refactor to release per iteration using an inner function literal.

**Hint**:

```go
func bad(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()
        // ... work
    }
    return nil
}

func good(paths []string) error {
    for _, p := range paths {
        if err := func() error {
            f, err := os.Open(p)
            if err != nil { return err }
            defer f.Close()
            // ... work
            return nil
        }(); err != nil { return err }
    }
    return nil
}
```

**Self-check**: instrument `os.Open` count vs. `f.Close` count over time. The `good` version closes one file per iteration; the `bad` version waits until the end.

Bonus: read `runtime/debug.Stack()` mid-loop to see the defer stack size.

---

## Task 9 — Capture a `*Config` and replace it safely

**Goal**: design a handler closure that observes config changes pushed via an atomic pointer, without rebuilding the closure on every update.

**Hint**: capture an `*atomic.Pointer[Config]` (one level of indirection that does not change), not a `*Config` directly. Inside the closure, `.Load()` the current config per call.

**Self-check**:

```go
ap := &atomic.Pointer[Config]{}
ap.Store(&Config{Tier: "free"})
handler := makeHandler(ap)
handler(req) // sees free
ap.Store(&Config{Tier: "pro"})
handler(req) // sees pro — same handler, new config
```

Bonus: benchmark this approach vs. recreating the handler on each config change.

---

## Task 10 — Inspect the funcval in a debugger

**Goal**: in a program with at least one capturing closure, attach `delve` (or use `runtime.FuncForPC`) to print the funcval's code pointer and resolve it to a symbol name.

**Hint**:

```go
import "runtime"

f := makeCounter()
pc := **(**uintptr)(unsafe.Pointer(&f))
fn := runtime.FuncForPC(pc)
fmt.Println(fn.Name())
```

**Self-check**: prints something like `main.makeCounter.func1`. Compare with the symbol you see in `go tool nm ./bin`.

Bonus: dump the env struct by casting the funcval's second word to your synthesised env type (you'll need to read the body's prologue in `go tool objdump` to discover the field offsets).

---

## Task 11 — Closure-heavy worker pool

**Goal**: implement a worker pool that takes tasks as `func() error` from a channel, runs them with N workers, and collects errors. Each worker is one closure capturing the channel and the error sink.

**Hint**:

```go
func runPool(tasks <-chan func() error, n int) []error {
    errs := make(chan error, 1)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for t := range tasks {
                if err := t(); err != nil { errs <- err }
            }
        }()
    }
    // wait, drain, return
}
```

**Self-check**: feed it 1000 tasks, time the total runtime. Compare with a `for task := range tasks { go task() }` approach. The pool should use less memory (fixed goroutine count) and similar wall time.

Bonus: measure `runtime.NumGoroutine()` while running both approaches.

---

## Task 12 — Closure as `sync.Once.Do` argument

**Goal**: implement a lazy initialiser using `sync.Once` whose work depends on a captured `*Config`.

**Hint**:

```go
type Service struct {
    once   sync.Once
    db     *sql.DB
    cfg    *Config
}

func (s *Service) DB() *sql.DB {
    s.once.Do(func() {
        s.db, _ = sql.Open("pgx", s.cfg.DSN)
    })
    return s.db
}
```

**Self-check**: call `DB()` from multiple goroutines and verify exactly one `sql.Open` happens. Use `-race`.

Bonus: replace `sync.Once` with `atomic.Bool` + manual locking and verify the closure usage is equivalent.

---

## Summary

These twelve exercises trace the arc from "closure as factory" through "loop bug reproduction" to "pool architecture and observability". Working through them gives you both the mechanical skill to write closures correctly and the diagnostic skill to debug them when they misbehave. For deeper rabbit holes, see [find-bug.md](find-bug.md) and [optimize.md](optimize.md).

---

## Further reading

- [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md)
- Benchmarking: https://pkg.go.dev/testing#hdr-Benchmarks
- `go tool nm`: https://pkg.go.dev/cmd/nm
- `runtime.FuncForPC`: https://pkg.go.dev/runtime#FuncForPC
