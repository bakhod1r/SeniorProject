# panic and recover — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The Built-in Functions panic and recover](#the-built-in-functions-panic-and-recover)
3. [Spec Text on panic](#spec-text-on-panic)
4. [Spec Text on recover](#spec-text-on-recover)
5. [Defer Statement Spec](#defer-statement-spec)
6. [Run-time Panics](#run-time-panics)
7. [Goroutine Termination on Panic](#goroutine-termination-on-panic)
8. [What the Spec Says vs Convention](#what-the-spec-says-vs-convention)
9. [Differences Across Go Versions](#differences-across-go-versions)
10. [Things the Spec Does NOT Say](#things-the-spec-does-not-say)
11. [References](#references)

---

## Introduction

The Go specification defines `panic`, `recover`, and `defer` precisely but tersely. Idiomatic usage is mostly convention layered on top. This file separates "what the spec says" from "what the community has agreed to do."

Reference: [The Go Programming Language Specification — Handling panics](https://go.dev/ref/spec#Handling_panics).

---

## The Built-in Functions panic and recover

From the **Built-in functions** section of the spec:

> The built-in functions `panic` and `recover`, described in the **Handling panics** section, assist in reporting and handling run-time panics and program-defined error conditions.

Their declared signatures (as if written in Go):

```go
func panic(interface{})
func recover() interface{}
```

In modern Go these are equivalent to:

```go
func panic(v any)
func recover() any
```

`panic` takes one argument of any type; `recover` takes no arguments and returns the panic value (or nil).

These are **built-in identifiers** in the universe block. You cannot redefine them at package scope.

---

## Spec Text on panic

The **Handling panics** section says:

> Two built-in functions, panic and recover, assist in reporting and handling run-time panics and program-defined error conditions.

> While executing a function F, an explicit call to panic or a run-time panic terminates the execution of F. Any functions deferred by F are then executed as usual. Next, any deferred functions run by F's caller are run, and so on up to any deferred by the top-level function in the executing goroutine. At that point, the program is terminated and the error condition is reported, including the value of the argument to panic. This termination sequence is called **panicking**.

Key takeaways from that paragraph:

1. **Panicking is a runtime sequence**, not just a function call.
2. **Deferred functions execute** as the panic propagates.
3. **Termination follows** unwinding all frames if no recover intervenes.

The spec also notes that `panic` may be called with a typed nil interface, but in Go 1.21+ this is automatically converted to a non-nil `*runtime.PanicNilError` value.

---

## Spec Text on recover

> The recover function allows a program to manage behavior of a panicking goroutine. Suppose a function G defers a function D that calls recover and a panic occurs in a function on the same goroutine in which G is executing. When the running of deferred functions reaches D, the return value of D's call to recover will be the value passed to the call of panic. If D returns normally, without starting a new panic, the panicking sequence stops. In that case, the state of functions called between G and the call to panic is not restored, but any deferred functions in those functions execute as if their function had returned normally. The recover function returns nil if any of the following conditions holds:

> - panic's argument was nil (Go ≤ 1.20);
> - the goroutine is not panicking;
> - recover was not called directly by a deferred function.

Three conditions for `recover()` to do anything useful:

1. The goroutine **must currently be panicking**.
2. `recover` **must be called from a deferred function** (specifically, the function whose call was deferred — not a function called by a deferred function).
3. (Pre-1.21) The panic value **must not have been nil**.

If any condition fails, `recover` returns nil.

---

## Defer Statement Spec

From the **Defer statements** section:

> A "defer" statement invokes a function whose execution is deferred to the moment the surrounding function returns, either because the surrounding function executed a return statement, reached the end of its function body, or because the corresponding goroutine is panicking.

The spec defines the syntax:

```
DeferStmt = "defer" Expression .
```

And the rules:

- The function value and parameters are evaluated **as usual** (at the point of the `defer` statement) and saved.
- The function call itself is delayed.
- Multiple defers form a **LIFO queue**: the last deferred is the first run.
- Defers run on **return**, **end of body**, or **panic**.

Notably, **defers do NOT run on `os.Exit` or fatal errors**. This is convention/runtime behavior, not spec text — but it follows from the spec mentioning "return statement" and "panicking" as the trigger conditions, with no mention of `os.Exit`.

---

## Run-time Panics

From the **Run-time panics** section:

> Execution errors such as attempting to index an array out of bounds trigger a run-time panic equivalent to a call of the built-in function panic with a value of the implementation-defined interface type runtime.Error. That interface satisfies the built-in interface type error.

`runtime.Error` is defined in `runtime/error.go`:

```go
type Error interface {
    error
    RuntimeError()
}
```

A type that satisfies `runtime.Error` is *also* an `error` (because `RuntimeError()` extends `error`). So:

```go
defer func() {
    if r := recover(); r != nil {
        if _, ok := r.(runtime.Error); ok {
            // it was a runtime panic, not an explicit panic
        }
    }
}()
```

The spec lists conditions that produce run-time panics, including (paraphrased):

- Out-of-range index for arrays, slices, strings.
- Nil pointer dereference.
- Method invocation on nil interface value.
- Integer division by zero.
- Some channel operations (send on closed, close of closed/nil).
- Some map operations (write on nil map).
- Failed type assertion (single-value form).

Each of these is the same panic mechanism as a user-level `panic(...)`, just initiated by the runtime.

---

## Goroutine Termination on Panic

The spec says:

> if no deferred function calls recover before the top of the executing goroutine's stack, the runtime terminates the program. The error condition is reported.

Note the *program* terminates, not just the goroutine. This is important: a panicking goroutine that runs out of frames *crashes the entire process*. There is no "kill just this goroutine" path in the spec.

The implementation detail (in `runtime/panic.go`): `fatalpanic` calls `runtime·exit(2)`, terminating the process with exit code 2.

---

## What the Spec Says vs Convention

The spec is minimal. Convention fills in the rest:

| Spec | Convention |
|------|------------|
| `panic(v any)` accepts anything | Panic with strings or errors; rarely with structs |
| `recover()` returns `any` | Type-assert to inspect; usually `error` or `string` |
| Panic terminates the program if not recovered | Wrap goroutines in recover; recover at boundaries |
| Defers run on panic | Use defer for cleanup; never duplicate cleanup outside defer |
| `panic` for any reason | Reserve for impossible states; use errors for everything else |
| No spec on stack traces | Use `runtime/debug.Stack()` to capture |
| No spec on log integration | Convert panic to error at API boundaries |

A developer who learns only the spec will write technically correct panics that nobody else recognizes idiomatically. A developer who learns only conventions sometimes misses subtle rules (the `recover()` directness rule, the goroutine isolation rule, the `panic(nil)` change in 1.21).

---

## Differences Across Go Versions

| Go version | Change |
|-----------|--------|
| 1.0 | `panic`, `recover`, `defer` available |
| 1.13 | Chained panic printing — multiple panics in a row print one after another |
| 1.14 | Open-coded defer optimization — defers ~25x faster in many cases |
| 1.21 | `panic(nil)` now panics with a non-nil `*PanicNilError` so `recover()` sees the nil-panic |
| (future) | No major panic/recover changes proposed |

The Go 1.21 change deserves attention. Pre-1.21:

```go
func main() {
    defer func() {
        r := recover()
        fmt.Println("recover:", r) // prints "recover: <nil>"
    }()
    panic(nil) // legal but useless
}
```

`recover()` returned nil. The program looked like it had no panic. In Go 1.21+, `panic(nil)` is replaced with `panic(&PanicNilError{})`. `recover()` returns that non-nil value, and the recover code can detect it.

If you maintain code that supports pre-1.21 Go, do not call `panic(nil)`.

---

## Things the Spec Does NOT Say

- **The spec does not require recover to be inside an inline anonymous deferred function.** The directness rule is "called by a deferred function" — naming the deferred function is permitted, but the call to `recover` must be in that function's body (not in something it calls).
- **The spec does not say what runtime panics look like in print.** The format ("runtime error: index out of range...") is convention from `runtime/error.go`.
- **The spec does not link panic to error.** A panic value need not be an `error`; though by convention, panicking with `error` is preferred for production code.
- **The spec does not require a stack trace on panic.** It says "the error condition is reported." The actual format is implementation-defined.
- **The spec does not specify defer overhead.** Performance characteristics are runtime decisions; open-coded defer is an optimization, not a guarantee.
- **The spec does not make panic recoverable across goroutines.** The "same goroutine" requirement is explicit.
- **The spec does not differentiate runtime panic from user panic for recover purposes.** Both are `recover`-able.

---

## References

- [The Go Programming Language Specification — Built-in functions](https://go.dev/ref/spec#Built-in_functions)
- [The Go Programming Language Specification — Defer statements](https://go.dev/ref/spec#Defer_statements)
- [The Go Programming Language Specification — Run-time panics](https://go.dev/ref/spec#Run_time_panics)
- [The Go Programming Language Specification — Handling panics](https://go.dev/ref/spec#Handling_panics)
- [Go 1.13 release notes — Improved panic stack traces](https://go.dev/doc/go1.13)
- [Go 1.14 release notes — open-coded defers](https://go.dev/doc/go1.14#runtime)
- [Go 1.21 release notes — panic(nil) change](https://go.dev/doc/go1.21#language)
- `$GOROOT/src/runtime/panic.go` — runtime implementation
- `$GOROOT/src/runtime/error.go` — `runtime.Error` interface and types
