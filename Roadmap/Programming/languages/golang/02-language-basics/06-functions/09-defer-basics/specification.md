# Go Specification: Defer Statements

**Source:** https://go.dev/ref/spec#Defer_statements
**Sections:** Defer statements; interaction with panic/recover and named return values.

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Defer_statements |
| **Related** | https://go.dev/ref/spec#Handling_panics |
| **Related** | https://go.dev/ref/spec#Return_statements |
| **Go Version** | Go 1.0 (initial); Go 1.13 (stack-allocated `_defer`); Go 1.14 (open-coded defer); Go 1.17 (register ABI changes); Go 1.22 (loop-variable interaction) |
| **Effective Go** | https://go.dev/doc/effective_go#defer |
| **Blog** | https://go.dev/blog/defer-panic-and-recover |

Verbatim quote of the central rules:

> "A 'defer' statement invokes a function whose execution is deferred to the moment the surrounding function returns, either because the surrounding function executed a return statement, reached the end of its function body, or because the corresponding goroutine is panicking."

> "Each time a 'defer' statement executes, the function value and parameters to the call are evaluated as usual and saved anew but the actual function is not invoked. Instead, deferred functions are invoked immediately before the surrounding function returns, in the reverse order they were deferred. That is, if the surrounding function returns through an explicit return statement, deferred functions are executed *after* any result parameters are set by that return statement but *before* the function returns to its caller."

> "If a deferred function value evaluates to nil, execution panics when the function is invoked, not when the 'defer' statement is executed."

(Source: Go Programming Language Specification, "Defer statements" section.)

---

## 2. Definition

A **defer statement** schedules a function call to be invoked at the moment the surrounding function returns. The deferred call's arguments are evaluated **at the point of the `defer` statement**, not at the point of the eventual call. Multiple deferred calls in a function are executed in **last-in-first-out (LIFO)** order. Deferred calls run regardless of how the surrounding function returns: explicit `return`, fall-off-the-end, or panic propagation.

For functions with **named return values**, deferred functions can read and modify those values, because they execute after the return statement assigns to the named results but before the function actually returns to the caller.

---

## 3. Core Rules & Constraints

### 3.1 The Call Expression Is Evaluated, Not Invoked

The `defer` keyword takes a function call expression. The function value and its arguments are evaluated immediately. The resulting call is queued — it does not run yet.

```go
package main

import "fmt"

func main() {
    x := 10
    defer fmt.Println("deferred:", x) // x evaluates to 10 here
    x = 99
    fmt.Println("body:", x)
}
// Output:
// body: 99
// deferred: 10
```

Even though `x` was reassigned to 99, the deferred call already had `10` packed into its argument list.

### 3.2 LIFO Execution Order

Deferred calls run in the reverse order they were registered.

```go
defer fmt.Println("A") // runs last
defer fmt.Println("B")
defer fmt.Println("C") // runs first
```

Output:
```
C
B
A
```

The runtime maintains a per-goroutine LIFO stack of pending defers.

### 3.3 Defers Run On All Exit Paths

The deferred call runs whether the function:
- Reaches a `return` statement.
- Falls off the end of the body.
- Propagates a panic.
- Is exited via `runtime.Goexit` (which still runs defers).

The deferred call does **not** run when:
- The program calls `os.Exit` (process terminates immediately).
- The runtime aborts on an unrecovered panic *after* all defers have run (the defers have already executed by then).
- The OS kills the process (signal, OOM, etc.).

### 3.4 Defers Tied To The Enclosing Function, Not Block

```go
func main() {
    {
        defer fmt.Println("hi")
        // hi does NOT print here
    }
    fmt.Println("middle")
    // hi prints when main returns, not at the end of the block
}
// Output:
// middle
// hi
```

The `defer` is associated with `main`, not the inner block.

### 3.5 Defers Can Modify Named Return Values

If the function declares named results, deferred calls can read and write them. The sequence at exit is:

1. The `return EXPR` statement evaluates `EXPR`.
2. The result is assigned to the named return variable(s).
3. Deferred calls run in LIFO order; they may modify named returns.
4. The function returns the (possibly modified) named return values to the caller.

```go
func f() (n int) {
    defer func() { n *= 2 }()
    return 21
}
// returns 42
```

For unnamed returns, defers cannot reach the return value.

```go
func g() int {
    n := 21
    defer func() { n *= 2 }() // doesn't affect return
    return n
}
// returns 21
```

### 3.6 Deferred Calls Run On Panic

When a goroutine panics, the runtime walks the deferred-call list, invoking each one. This is what makes defer suitable for cleanup that must always happen.

```go
func main() {
    defer fmt.Println("cleanup")
    panic("boom")
}
// Output:
// cleanup
// (panic message and trace)
```

If a deferred call calls `recover()`, the panic stops propagating; the function whose deferred call recovered returns normally.

### 3.7 `recover` Is Effective Only Inside A Deferred Function

`recover()` returns a non-nil value only when called **directly inside** a deferred function. Anywhere else, it returns `nil` and has no effect.

```go
defer func() {
    if r := recover(); r != nil { /* this works */ }
}()
panic("x")
```

Calling `recover()` one frame deeper (e.g., from a function called by the deferred function) does not work.

### 3.8 A `nil` Function Value Panics At Invocation, Not At Defer

If the function value passed to `defer` is `nil`, the panic happens when the deferred call would run, not when `defer` executes.

```go
var f func()
defer f() // does NOT panic here
// At function exit, the runtime tries to invoke f and panics.
```

### 3.9 Argument Evaluation Captures At Defer-Time, But Closure Bodies Read At Call-Time

A subtle distinction:

- `defer f(x)` — `x` is evaluated at defer-time and stored. The deferred call sees that captured value.
- `defer func() { use(x) }()` — the closure body reads `x` at call-time (function exit). It sees whatever `x` is then.

```go
x := 1
defer fmt.Println(x)               // captures 1
defer func() { fmt.Println(x) }()  // reads at exit
x = 99
// Output (LIFO):
// 99 (from closure)
// 1  (from arg)
```

For methods on pointers, the receiver pointer is evaluated at defer-time but the method body still dereferences the pointer at call-time.

### 3.10 Variadic Slice Headers Are Captured At Defer-Time

```go
xs := []int{1, 2, 3}
defer fmt.Println(xs...) // captures the slice header
xs = []int{99}
// prints "1 2 3"
```

The header (ptr+len+cap) is captured. Mutations to the original backing array would still be visible (because the header points to it). But re-assigning `xs` to a new slice doesn't affect the deferred call.

### 3.11 The Number Of Defers Is Bounded At Compile-Time For Open-Coded Optimization

The Go 1.14 compiler performs "open-coded" defer optimization when:
- The function has at most 8 `defer` statements.
- No defer is inside a loop.
- The function does not call `recover` from a non-deferred function in the same function.
- Optimizations are enabled.

When all conditions hold, defers cost ~3-7 ns each (no allocation, no list manipulation). Otherwise, defers fall back to stack-allocated or heap-allocated records (`_defer` struct), with proportionally higher cost.

### 3.12 Defers Are Per-Goroutine

Each goroutine has its own defer list. Defers in goroutine A cannot affect goroutine B. A panic in one goroutine cannot be recovered by a defer in another goroutine. To recover from goroutine panics, every goroutine that may panic must defer its own recover.

---

## 4. Edge Cases

### 4.1 Defer With A Method Value

`defer m.Method()` evaluates the receiver at defer-time. For pointer receivers, the deferred call uses that captured pointer, dereferencing it at call-time. For value receivers, the receiver is *copied* at defer-time, so later changes to the original don't affect the deferred call's view.

```go
type C struct{ n int }
func (c C) print() { fmt.Println(c.n) }    // value receiver
func (c *C) Print() { fmt.Println(c.n) }   // pointer receiver

c := C{n: 1}
defer c.print()  // captures a copy: c.n=1
defer (&c).Print() // captures pointer; reads c.n at exit
c.n = 99
// Output:
// 99 (Print: pointer follows mutation)
// 1  (print: snapshot via value copy)
```

### 4.2 Defer In A Goroutine

A defer registered inside a goroutine fires when **that goroutine's outer function** returns, not when the parent function returns.

```go
func parent() {
    go func() {
        defer fmt.Println("goroutine cleanup")
        // ...
    }()
    // parent's return doesn't fire the goroutine's defer
}
```

If the goroutine outlives the parent, the defer waits for the goroutine to exit.

### 4.3 Defer In `init()`

`init()` is a regular function. Its defers fire when it returns — *before* `main` runs.

```go
func init() {
    defer fmt.Println("init cleanup") // fires before main
}
```

### 4.4 Recursive Defers

Each recursive call has its own defer scope. With deep recursion, defers accumulate (one per frame) and fire during unwinding.

```go
func recurse(n int) {
    defer fmt.Println(n)
    if n > 0 { recurse(n - 1) }
}
recurse(3)
// Output:
// 0
// 1
// 2
// 3
```

For very deep recursion, this can amplify stack growth and slow down unwinding.

### 4.5 Defer With Function Value vs Method Expression

`defer T.M(receiver)` (method expression) and `defer receiver.M()` (method value) both evaluate the receiver at defer-time, but the call form differs in which method set is consulted.

### 4.6 Deferred Calls After A Panic In Another Defer

If a deferred function itself panics, that panic supersedes the original. The runtime continues unwinding from the second panic. Pending defers above (in LIFO order) still run.

```go
func f() {
    defer fmt.Println("A")
    defer func() { panic("from defer") }()
    panic("original")
}
// Output:
// A
// panic: original
//        panic: from defer (recovered? no — both fatal)
```

The panic message shows the most recent panic plus the original.

### 4.7 `runtime.Goexit` Vs `os.Exit`

- `runtime.Goexit`: terminates the goroutine, but **runs all its defers first**. Used by `t.FailNow` in tests.
- `os.Exit`: terminates the process immediately. **Defers do NOT run.**

### 4.8 Defer In `defer` (Nested)

`defer (defer f())` is a syntax error — defer takes a call expression. But you can defer a call that itself executes a defer:

```go
func helper() {
    defer fmt.Println("inner")
}

func main() {
    defer helper() // when main returns, helper runs; helper's defer also runs
}
```

---

## 5. Related Specs

- [Function declarations](https://go.dev/ref/spec#Function_declarations)
- [Function literals](https://go.dev/ref/spec#Function_literals) — closures captured by deferred function literals
- [Return statements](https://go.dev/ref/spec#Return_statements) — interaction with named results
- [Handling panics](https://go.dev/ref/spec#Handling_panics) — `panic` and `recover`
- [Run-time panics](https://go.dev/ref/spec#Run_time_panics) — what panics the runtime initiates
- [For statements](https://go.dev/ref/spec#For_statements) — Go 1.22 loop variable scoping change

---

## 6. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `defer` introduced with the language. Heap-allocated `_defer` records. |
| Go 1.13 | Stack-allocated `_defer` records when bounded — ~30% speedup. |
| Go 1.14 | Open-coded defer optimization: defers ≤ 8 in non-looping functions become inline code. ~7-8x speedup for the common case. |
| Go 1.17 | Register-based ABI on amd64. `_defer` struct simplified; some `siz` fields removed. |
| Go 1.18 | Inliner improvements; some defer-using functions become inlinable. |
| Go 1.22 | Loop variable scoping changes affect deferred closures' capture semantics. With `go 1.22` in `go.mod`, each iteration gets a fresh loop variable. |
| Go 1.23+ | No spec changes to defer; runtime/compiler refinements continue. |

The defer **specification** has not changed since Go 1.0. The implementation has improved dramatically. The Go 1.22 loop-variable change affects what deferred closures observe but is technically a `for` statement spec change, not a defer spec change.

---

## 7. Specification Quirks & Subtleties

### 7.1 Defer Argument Lists Are Implicitly Stored

The spec says arguments are "evaluated as usual and saved anew". The compiler chooses where to save them — historically in the `_defer` record, now (with open-coded defer) in dedicated stack slots. This is invisible to programs.

### 7.2 Method Values Capture Their Receiver

For `defer m.M()`, the method value `m.M` is created at defer-time. The value bundles the function pointer and the receiver into a single value. Any later assignment to `m` doesn't affect the bundled receiver.

### 7.3 Generic Functions And Defer

Defers in generic functions behave identically to non-generic ones at the spec level. The compiler may need to instantiate per-type, but the rules are unchanged.

### 7.4 The Spec Doesn't Mandate Open-Coded Defer

The 8-defer threshold and "no loop" rules are implementation choices. Other Go implementations (gccgo, gollvm) may handle defers differently. The spec only mandates the *behavior* (LIFO, defer-time evaluation, panic-safety), not the cost.

### 7.5 Defer And Goroutine Lifetimes

Per the spec: "deferred functions are invoked immediately before the surrounding function returns". For a goroutine that never returns (e.g., `for {}`), its defers never fire. This is rarely a problem because such goroutines often live for the program's lifetime, but tools like `goleak` may report them.

---

## 8. Test Cases From The Spec's Examples

### 8.1 Spec Example: LIFO

```go
for i := 0; i < 3; i++ {
    defer fmt.Print(i, " ")
}
```

Output: `2 1 0 ` (when used inside a function that exits after the loop).

### 8.2 Spec Example: Argument Evaluation

```go
i := 0
defer fmt.Println(i) // evaluates i NOW; captured value 0
i++
return // prints "0"
```

### 8.3 Spec Example: Named Return Modification

```go
func f() (i int) {
    defer func() { i++ }()
    return 1
}
// returns 2
```

The spec explicitly calls out this pattern in the section on return statements:

> "If the surrounding function returns through an explicit return statement, deferred functions are executed *after* any result parameters are set by that return statement..."

---

## 9. Diagram: Sequence At Function Exit

```
+--------------------------------------+
|  return EXPR (or fall-through, panic) |
+--------------------------------------+
                  |
                  v
+--------------------------------------+
|  Evaluate EXPR (if any)              |
+--------------------------------------+
                  |
                  v
+--------------------------------------+
|  Assign to named return values       |
|  (if return values are named)        |
+--------------------------------------+
                  |
                  v
+--------------------------------------+
|  Run deferred calls (LIFO)           |
|  - Each can read/write named returns |
|  - Each can recover() panics         |
+--------------------------------------+
                  |
                  v
+--------------------------------------+
|  Function returns to caller          |
|  (caller reads return values)        |
+--------------------------------------+
```

---

## 10. Cross-References

- See `junior.md` for introductory examples.
- See `middle.md` for idiomatic patterns and named-return error wrapping.
- See `senior.md` for the three implementation strategies and runtime/compiler details.
- See `professional.md` for production usage in Kubernetes/etcd/CockroachDB and lint rules.
- See `optimize.md` for benchmark numbers.
- See `find-bug.md` for common defer mistakes.

---

## 11. Authoritative Quotes

From the Go FAQ and blog (paraphrased and quoted):

> "Use `defer` to ensure that resources are properly released. Defer pairs nicely with panic and recover, providing a clean way to handle errors or unexpected conditions."

> "The argument to a deferred function (which includes the receiver if the function is a method) is evaluated when the defer executes, not when the call executes."

> "Deferred function calls are pushed onto a stack. When a function returns, its deferred calls are executed in last-in-first-out order."

These three statements summarize the spec's rules concisely.

---

## 12. Summary

`defer` schedules a function call to run when the enclosing function returns, regardless of how it returns. Arguments are captured at defer-time; closure bodies read variables at call-time. Defers run in LIFO order. They run on panic, enabling recovery via `recover()` (which only works inside a deferred function). Deferred calls can modify named return values, the basis of Go's idiomatic error-wrapping pattern. The specification has been stable since Go 1.0; implementation improvements (open-coded defer in 1.14) have made defer essentially free in the common case.
