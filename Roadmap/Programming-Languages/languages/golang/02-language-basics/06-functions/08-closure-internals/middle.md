# Closure Internals — Middle

Author: Bakhodir Yashin Mansur

[junior.md](junior.md) introduced the funcval (code + env) and the capture-by-reference rule. This file goes one level deeper: how the compiler synthesises the env struct, how escape analysis decides heap vs. stack, how method values are built, and how closures interact with `defer` and `go`.

You should already be comfortable with: pointers, structs, escape analysis at the user level, and what `defer` does.

---

## 1. The synthesised capture struct

Every function literal that captures variables produces a struct in the binary. The struct's fields are pointers to the captured variables (when capture is by reference) or copies of their values (when the compiler can prove no mutation and no aliasing).

```go
func makeBoth(x int) (func(), func() int) {
    return func() { x++ }, func() int { return x }
}
```

The compiler synthesises one struct shared by both closures:

```
struct {
    x *int   // pointer because both closures reference x
}
```

Both funcvals point at the same struct, so both observe the same `x`. The IR for this is in `cmd/compile/internal/walk/closure.go`; the struct type is created in `typecheck`/`walk` and given a generated name like `func1·dot1`.

If a closure captures only a single int and the compiler can prove it never escapes, the struct may be elided entirely and the int placed directly in the funcval slot. This is an optimisation; you cannot rely on it for semantics.

---

## 2. Capture by reference vs. capture by value (compiler decision)

Although the user-visible rule is "capture by reference", the compiler may optimise to value capture when:

- The variable is not mutated after the closure is created.
- The variable's address is not taken anywhere else.
- The variable's type is small (fits in a machine word or two).

For example:

```go
func greet(name string) func() {
    return func() { fmt.Println("hi,", name) }
}
```

`name` is never mutated and is a 16-byte string header. The compiler may copy the string header directly into the env struct rather than store `*string`. Behaviour is identical because Go's strings are immutable.

When the compiler can't prove these conditions, it falls back to by-reference: the local is hoisted to the heap and the env struct holds a pointer.

You can inspect the generated SSA with:

```bash
go build -gcflags='-m=2 -d=ssa/checkfunc/dump' ./...
```

Or, more reliably, just `-gcflags='-m=2'` and watch for `moved to heap: x`.

---

## 3. Escape analysis and closures

The relevant rules, in plain English:

1. **A captured variable that outlives the enclosing function's frame escapes.** "Outlives" means: the closure is returned, stored in a longer-lived variable, sent on a channel, started in a goroutine, or otherwise placed where the frame's end cannot reach.
2. **The funcval itself escapes if it is returned, stored, or passed to a function that lets it escape.** The funcval is two words on the stack; if it escapes, those two words go to heap-allocated storage.
3. **A funcval used purely inline (call it, throw it away) stays on the stack.** No heap allocation at all.

The third rule is the reason `sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })` does not allocate: the funcval lives in the caller's frame, the env struct can also live there, `sort.Slice` is called with it, returns, and the frame is reclaimed.

Run with `-gcflags='-m'` to see decisions:

```
./main.go:10:9: can inline makeAdder.func1
./main.go:11:14: func literal escapes to heap
./main.go:11:14: &{x} escapes to heap
```

The first message says the body could be inlined into its caller if it weren't a closure that escapes; the second and third say the funcval and its env both went to the heap.

---

## 4. Method values are closures of the receiver

`s.Method` (no call) builds a funcval whose env contains the receiver:

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

c := &Counter{}
f := c.Inc   // funcval { code: (*Counter).Inc, env: &{ recv: c } }
```

The receiver inside the env is the *value* you wrote — for pointer receivers it's the pointer, for value receivers it's a copy of the struct.

### Value receiver gotcha

```go
type Counter struct{ n int }
func (c Counter) Inc() { c.n++ }   // value receiver

c := Counter{}
f := c.Inc
f(); f(); f()
fmt.Println(c.n) // 0
```

`c.Inc` copies `c` into the env. Each call to `f` mutates that copy. Original `c` is untouched.

### Method values and the heap

The funcval for `c.Inc` allocates iff it escapes. Inside a tight loop where the value is immediately called:

```go
do := c.Inc
do(); do(); do()
```

…the compiler often keeps the funcval on the stack and may even avoid the indirection. Whereas:

```go
go c.Inc()                    // funcval escapes — goroutine outlives frame
button.OnClick = c.Inc        // stored in a long-lived field — escapes
ch <- c.Inc                   // sent on channel — escapes
```

…all force heap allocation of the funcval (and possibly of `c` if `c` itself was on the stack).

---

## 5. Method expressions

`(*Counter).Inc` is a `func(*Counter)`. No env. No funcval allocation. The receiver is an explicit parameter:

```go
g := (*Counter).Inc
g(c)
```

Use method expressions when you want to pre-bind a method without paying for closure allocation. The trade-off: callers must thread the receiver explicitly.

---

## 6. Closures and `defer`

`defer` registers a function call that runs when the surrounding function returns. The compiler is careful with capture inside deferred closures because their semantics interact with named return values.

### Pattern: capture by reference to mutate named returns

```go
func process() (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("process: %w", err)
        }
    }()
    // ... assigns to err
    return doThing()
}
```

The deferred closure captures `err` (a named return) by reference. After `doThing()` runs and `return` assigns its result to `err`, the deferred function sees the assigned value and can wrap it.

If you used `defer func(err error) { ... }(err)`, you would capture a snapshot of `err` taken **at defer-registration time**, which is before `doThing()` runs — and would always observe `nil`. The two patterns are *not* equivalent; choose deliberately.

### Pattern: defer in a loop captures the iteration variable

Pre-Go 1.22:

```go
for _, fname := range files {
    f, _ := os.Open(fname)
    defer f.Close()           // not the bug
    defer func() { fmt.Println(fname) }()  // captures fname — bug
}
```

All deferred closures share `fname`. After the loop, `fname` holds the last file's name; every deferred printout shows that.

Go 1.22 per-iteration scoping fixes the `fname` case. The `defer f.Close()` form was never buggy because `f` is freshly declared each iteration (it's a `:=` introduction).

A subtler issue: deferring inside a loop accumulates registrations. If the loop has 10000 iterations, 10000 deferred calls fire at function return — possibly OOM or stack pressure. Prefer wrapping the body in a function:

```go
for _, fname := range files {
    func() {
        f, _ := os.Open(fname)
        defer f.Close()
        // ...
    }()
}
```

Each anonymous-function call has its own defer stack that runs immediately at its end.

### Defer overhead changed in Go 1.14

Before 1.14, `defer` allocated a `_defer` record per call (open-coded only for top-level functions). Since 1.14, the compiler "open-codes" deferred calls: it emits inline cleanup code at every return path. When the function returns, no allocation is required for typical `defer` use. This change made `defer f.Close()` cheap even in hot paths.

But: open-coding only applies when the compiler can statically determine **all** defer sites in the function. If a defer is inside a loop or behind a conditional that the analysis cannot enumerate, the function falls back to the older heap-allocated `_defer` chain.

---

## 7. Closures and `go`

`go func() { ... }()` starts a new goroutine. The funcval is the entry point of the new goroutine; the env struct holds whatever it captured.

The funcval and env **must escape to the heap**: the goroutine outlives the spawning frame. The compiler will tell you so:

```
./main.go:17:5: func literal escapes to heap
./main.go:17:5: &{x} escapes to heap
```

No way to avoid this for goroutines. What you *can* control is how much the closure captures:

```go
// captures x, y, big, results, ch  — env struct has 5 pointers
go func() {
    results <- big.process(x, y) + ch.Sequence()
}()

// captures only the values the goroutine needs — env has 2 pointers
go func(x, y int) {
    results <- compute(x, y)
}(x, y)
```

Smaller env = smaller heap allocation = faster goroutine startup. For 1000 goroutines this can be a measurable saving.

---

## 8. Inspecting the env struct in practice

The struct itself doesn't have a stable name in user code, but you can see it indirectly.

### With `go build -gcflags='-m=2'`

```
./main.go:8:11: closure: capturing &x by ref
./main.go:8:11: closure: capturing y by val
```

`-m=2` is the verbose level. It prints every captured variable and how it was captured.

### With pprof — heap profile

Closure env structs show up as `runtime.newobject` allocations attributed to the file/line of the function literal. In a heap profile, search for allocations whose source line is `func(...)` — those are the funcvals and env structs.

### With objdump

```bash
go tool objdump -s 'main\.main' ./bin
```

Look for `MOVQ "".body·f(SB), AX` followed by `CALL AX` — that's a typical closure call sequence (load funcval into register, call indirectly).

---

## 9. Allocation cost of closures

Cost = funcval (2 words) + env struct + initialisation. For a closure capturing one int by reference: 8 bytes (env) + 16 bytes (funcval) + the captured int (8 bytes, on the heap because it escaped). Roughly one heap allocation of ~32 bytes plus initialisation cost (~5 ns on modern CPUs).

In a hot loop, this adds up:

```go
for i := 0; i < 1_000_000; i++ {
    go process(makeHandler(i)) // new closure per iteration
}
```

A million ~32-byte allocations is ~32 MB plus GC pressure. Two ways to reduce:

1. **Hoist the closure out of the loop** if its captured state doesn't depend on the iteration.
2. **Replace with a method value** if the captured state can be represented by a struct that already exists.

A method value isn't free, but if the struct is already heap-allocated, the funcval is the only extra allocation.

---

## 10. Comparing closures, function values, and function-typed parameters

Three things look like `func()` in Go but have different cost profiles.

| Form | Code | Env | Allocation |
|------|------|-----|------------|
| Package-level function | `var f = doThing` | none | none |
| Method expression | `f := (*T).M` | none | none (just code pointer in a funcval) |
| Method value | `f := t.M` | receiver | env on heap if escapes |
| Closure capturing nothing | `f := func(){...}` | none | none |
| Closure capturing variables | `f := func(){use(x)}` | yes | env on heap if escapes |

A closure that captures nothing is identical in cost to a top-level function: the compiler emits a single static funcval in `.rodata`. You can call it via `f` without ever allocating.

Knowing the table above lets you choose the cheapest form for a given use case.

---

## 11. Recursive closures

A closure cannot reference itself by name during its own definition, because the name isn't bound until the literal is fully evaluated. The pattern:

```go
var fact func(int) int
fact = func(n int) int {
    if n <= 1 { return 1 }
    return n * fact(n-1)
}
```

`fact` is captured by reference. The literal closes over `fact` (the variable), not over the function literal it was initialised with. When the body references `fact`, it dereferences the variable — which by then holds the closure itself. This is why the two-line form works and a one-line `:=` does not.

The env struct here holds `*func(int)int` — a pointer to the variable `fact`.

---

## 12. Closures vs. interfaces for callbacks

Two ways to model "do something when event happens":

```go
// closure
type Server struct { onConnect func(net.Conn) }

// interface
type ConnectHandler interface { OnConnect(net.Conn) }
type Server struct { onConnect ConnectHandler }
```

Trade-offs:

- **Closure**: zero boilerplate. Allocates env if captured state. Hard to introspect (no type information).
- **Interface**: explicit type, supports type assertions, plays nicely with mocks. Receiver is one allocation if you build it on the fly.

For one-off callbacks (handlers, sort comparators), closures win. For stable APIs with multiple methods (`Read`, `Write`, `Close`), interfaces win.

This choice is also a memory-shape choice: a closure-with-env is one allocation; a struct-implementing-interface is one allocation. The difference is which fields you control.

---

## 13. Practical patterns

### Pattern A — middleware chain

```go
type Handler func(ctx context.Context) error
type Middleware func(Handler) Handler

func chain(h Handler, ms ...Middleware) Handler {
    for i := len(ms) - 1; i >= 0; i-- {
        h = ms[i](h)
    }
    return h
}
```

Each `ms[i](h)` returns a closure capturing `h`. The final chain is a stack of N nested closures. Each is one env allocation (containing the next handler). Cheap and idiomatic.

### Pattern B — once with a closure

```go
type once struct {
    fn   func()
    done atomic.Bool
}

func (o *once) Do() {
    if o.done.CompareAndSwap(false, true) {
        o.fn()
    }
}
```

`o.fn` is a `func()` field — could be any closure. The struct lets you compose `once` with arbitrary initialisation logic without changing types.

### Pattern C — error-wrapping defer

Already shown in §6.

### Pattern D — partial application

```go
func curry(f func(int, int) int, x int) func(int) int {
    return func(y int) int { return f(x, y) }
}

add := func(a, b int) int { return a + b }
add5 := curry(add, 5)
fmt.Println(add5(3)) // 8
```

The returned closure captures `f` and `x`. Two-word env, escapes (returned), one heap allocation.

---

## 14. Summary

At the middle level, closures stop being magic. They are funcvals: a code pointer plus a pointer to a struct of captured variables. The compiler decides whether each captured variable is held by reference or by value; the user-visible semantics is "by reference". Closures that escape allocate; closures that don't, don't. `defer` and `go` interact with capture in deterministic ways once you know that the captured variable is shared with the enclosing scope. Method values are a special closure with the receiver in the env. Method expressions are plain functions. The next file, [senior.md](senior.md), walks the compiler pass that builds these structures.

---

## Further reading

- `cmd/compile/internal/walk/closure.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/walk/closure.go
- `cmd/compile/internal/escape/`: https://github.com/golang/go/tree/master/src/cmd/compile/internal/escape
- `cmd/compile/internal/ir/func.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/ir/func.go
- Open-coded defers (Go 1.14): https://go.googlesource.com/proposal/+/refs/heads/master/design/34481-opencoded-defers.md
- Go 1.22 loop-variable change: https://go.dev/blog/loopvar-preview
- Sibling: [defer-basics](../09-defer-basics/), [escape-analysis](../../../11-advanced-topics/02-escape-analysis/), [function-design](../01-functions-basics/)
