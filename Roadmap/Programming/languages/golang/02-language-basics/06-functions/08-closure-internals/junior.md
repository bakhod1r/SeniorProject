# Closure Internals — Junior

Author: Bakhodir Yashin Mansur

This file looks under the hood of Go closures. The sibling topic [closures](../05-closures/) explains how to use them. This file explains **what they actually are** at runtime: a pair of pointers, a synthesised struct, and a small contract that the compiler enforces. You only need to know basic Go to read this; the deeper compiler walk lives in [senior.md](senior.md).

---

## 1. A closure is two pointers

When you write a function literal that references a variable from its surrounding scope, the compiler does not produce a single function. It produces **two things**:

1. A piece of machine code (the function body).
2. A small struct holding the variables the body needs.

A closure value (`func()` in Go) is a two-word handle:

```
+-------------------+
| code pointer      |   -> machine code of the function body
+-------------------+
| env pointer       |   -> heap struct with captured variables
+-------------------+
```

Runtime source calls this pair a **funcval**. A `func()` variable in Go is one machine word in size on the stack — it holds a pointer to a funcval; the funcval itself lives somewhere else.

You don't see funcval in user code, but it explains every behaviour in this file.

---

## 2. The simplest closure

```go
func makeAdder(x int) func(int) int {
    return func(y int) int { return x + y }
}

add5 := makeAdder(5)
fmt.Println(add5(3)) // 8
```

What the compiler does, conceptually:

```go
// pseudo-code — not real Go
type envAdder struct { x int }

func body(env *envAdder, y int) int { return env.x + y }

func makeAdder(x int) func(int) int {
    e := &envAdder{x: x}     // allocated on the heap
    return funcval{code: body, env: e}
}
```

`add5` is a two-word value pointing at `body` and at the `envAdder` struct. Calling `add5(3)` is really `body(env, 3)`.

That is the whole "magic". Everything else is consequences of this design.

---

## 3. Capture is by reference, always

Go closures capture **variables**, not values. The struct synthesised by the compiler holds **a pointer** to each captured variable, not a copy of its current value.

```go
func main() {
    x := 0
    inc := func() { x++ }
    inc(); inc(); inc()
    fmt.Println(x) // 3
}
```

The closure and `main` share the same `x`. The compiler hoisted `x` into a small heap object the moment it noticed that `inc` references it.

This rule has two important corollaries:

- **All closures created in the same scope share the same captured variables.** If two closures both refer to `x`, they refer to the *one* `x`.
- **Captured variables survive the enclosing function's return.** Even though `main` looks like an ordinary frame, `x` is on the heap because the closure references it.

The mechanism that decides "this local must go to the heap" is **escape analysis**, covered in [escape-analysis](../../../11-advanced-topics/02-escape-analysis/).

---

## 4. The classic loop bug (pre-Go 1.22)

The most famous closure bug in Go's history:

```go
func main() {
    xs := []string{"a", "b", "c"}
    var fns []func()
    for i := 0; i < len(xs); i++ {
        fns = append(fns, func() { fmt.Println(xs[i]) })
    }
    for _, f := range fns { f() }
}
```

On Go ≤ 1.21 this prints:

```
c
c
c   (index 3 — panic: index out of range)
```

…actually it panics, because `i` ended at `3`. The point: every closure captured the *same* `i`. By the time they ran, `i` had moved past the end.

### Why?

Pre-1.22 loop semantics: the loop variable `i` is a **single variable** for the whole loop. The closures captured **that variable**, not its current value. After the loop finished, all closures shared one `i` whose value was the loop's terminal state.

### The pre-1.22 workaround

Shadow the variable inside the loop body so each iteration creates a fresh variable:

```go
for i := 0; i < len(xs); i++ {
    i := i                                  // new per-iteration variable
    fns = append(fns, func() { fmt.Println(xs[i]) })
}
```

Or pass the value through a function literal:

```go
for i := 0; i < len(xs); i++ {
    fns = append(fns, func(i int) func() {
        return func() { fmt.Println(xs[i]) }
    }(i))
}
```

Both tricks defeat capture by giving each closure its own variable to capture.

---

## 5. Go 1.22 changed loop-variable scope

Since Go 1.22 (released February 2024), the loop variable in `for` and `for range` is **per-iteration**:

```go
// Same code, Go 1.22+:
for i := 0; i < len(xs); i++ {
    fns = append(fns, func() { fmt.Println(xs[i]) })
}
// Prints: a, b, c (or panics differently — but each fn captures its own i)
```

The spec change: each iteration gets its own `i`. Closures capture the iteration's `i`, not a shared one. The bug is gone.

### Version detection

You can guard against pre-1.22 by setting your module's `go` directive:

```
// go.mod
module example.com/mine
go 1.22
```

The directive controls language semantics. A module declaring `go 1.22` uses per-iteration loop variables even when compiled with a newer toolchain. A module declaring `go 1.21` keeps the old behaviour even when compiled with Go 1.23.

This is unusual: usually `go` in `go.mod` is informational. For loop semantics it is binding.

### Why care if 1.22 fixed it?

- Codebases older than 1.22 still exist.
- Many real bugs in production were caused by the old rule.
- Reviewers must recognise the pattern when reading legacy code.
- The fix did not change *closures*; it changed *loops*. Capture is still by reference.

---

## 6. Closures around goroutines

The loop-bug example reaches its highest stakes with goroutines:

```go
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }()       // pre-1.22: prints 3,3,3 (or similar)
}
```

Goroutines run **after** the loop body finishes. By the time they execute, the shared `i` is at its final value. Solutions are identical to §4: shadow, or pass-as-argument, or upgrade to Go 1.22 module mode.

A subtler version uses any captured variable that changes after the goroutine starts:

```go
work := []int{1, 2, 3}
for _, n := range work {
    go func() {
        process(n) // captures n by reference
    }()
}
```

Pre-1.22 this had the same shape of bug for `n` (range variable). Post-1.22 it is safe.

---

## 7. Capture by reference vs. by value: how to opt out

Sometimes you actually want a snapshot. Two idioms:

### Pass the value as an argument

```go
go func(v int) {
    process(v)
}(n)
```

`v` is a fresh parameter — pure value copy.

### Shadow with `:=`

```go
n := n
go func() { process(n) }()
```

This declares a new `n` in the inner scope, initialised from the outer `n`. The closure captures the new one.

Both patterns are useful even with Go 1.22 — for variables outside loops, the old rules still apply (capture is still by reference).

---

## 8. Method values are closures too

This is something many Go programmers learn late: `s.Method` (no parens, no call) is a closure of `s` over the method.

```go
type counter struct{ n int }
func (c *counter) inc() { c.n++ }

c := &counter{}
f := c.inc      // closure capturing c
f(); f(); f()
fmt.Println(c.n) // 3
```

`f` is a `func()` value. Internally it is a funcval whose env holds `c`. Every call goes through the captured pointer.

A method **expression** `(*counter).inc` is different — it is a plain function that takes the receiver explicitly:

```go
g := (*counter).inc
g(c)
```

The difference at runtime is whether the receiver is captured into a funcval (method value) or threaded through a normal parameter (method expression). For Go 1.18+ the compiler can often allocate the method-value funcval on the stack when it doesn't escape; otherwise it goes to the heap.

---

## 9. Mental model summary

When you write a closure, ask three questions:

1. **What variables does the body reference from outside?** Those become the env.
2. **Do those variables outlive the enclosing function?** If yes, they escape to the heap.
3. **Is the closure called later?** If yes, capture-by-reference matters: anything that changes the variable changes what the closure sees.

If you can answer those three, you can predict every closure behaviour in this file.

---

## 10. A short cookbook

```go
// 1. Stateful counter (factory pattern)
func makeCounter() func() int {
    n := 0
    return func() int { n++; return n }
}

// 2. Configurable callback
func onClick(handler func(int)) { /* ... */ }
onClick(func(id int) { fmt.Println("clicked", id) })

// 3. Defer that uses captured state
func process() (err error) {
    f, err := os.Open("data")
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); err == nil { err = cerr }
    }()
    /* ... */
    return nil
}

// 4. Method value as event handler
btn.OnClick = c.handleClick   // c.handleClick is a closure of c
```

Each of these uses capture deliberately. Each will allocate if the closure escapes (the heap funcval); each will be stack-allocated if it doesn't.

---

## 11. Things you can try today

1. Write `makeCounter` from §10. Confirm two independent counters keep independent state.
2. Reproduce the pre-1.22 bug in a module with `go 1.21` in `go.mod`. Switch to `go 1.22` and rerun.
3. Use `go build -gcflags='-m'` on a closure that escapes and one that doesn't. Note the messages: `&{...} escapes to heap` vs. `&{...} does not escape`.
4. Convert a method value (`c.inc`) into a method expression (`(*Counter).inc(c)`) and compare allocations with `-benchmem`.

---

## 12. Summary

A Go closure is a (code, env) pair. The env is a compiler-synthesised struct of pointers to captured variables. Capture is **by reference**, not by value — every closure created in a scope shares its captured variables with the outer scope and with each other. Variables that survive their enclosing frame escape to the heap. The notorious loop-variable bug was a consequence of this rule combined with single-variable loop semantics; Go 1.22 fixed the loop side, not the closure side. Method values are closures of the receiver. The deeper layout, the calling convention, and the compiler pass that builds the env struct are covered in [middle.md](middle.md) and [senior.md](senior.md).

---

## Further reading

- Go 1.22 release notes (loop variable change): https://go.dev/blog/loopvar-preview
- Proposal #60078, "spec: less error-prone loop variable scoping": https://github.com/golang/go/issues/60078
- Spec, "Function literals": https://go.dev/ref/spec#Function_literals
- `cmd/compile/internal/walk/closure.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/walk/closure.go
- Sibling: [closures](../05-closures/), [anonymous-functions](../04-anonymous-functions/), [escape-analysis](../../../11-advanced-topics/02-escape-analysis/)
