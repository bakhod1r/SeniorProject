---
layout: default
title: Cleanup Ordering — Specification
parent: Cleanup Ordering
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/specification/
---

# Cleanup Ordering — Specification

This file collects the formal language-spec excerpts and library contracts that govern cleanup ordering in Go. It is a reference, not a tutorial.

## 1. The `defer` Statement (Go Language Specification)

From the Go Programming Language Specification, section "Defer statements":

> A "defer" statement invokes a function whose execution is deferred to the moment the surrounding function returns, either because the surrounding function executed a return statement, reached the end of its function body, or because the corresponding goroutine is panicking.

> Each time a "defer" statement executes, the function value and parameters to the call are evaluated as usual and saved anew but the actual function is not invoked.

> Deferred function calls are executed in Last In First Out order after the surrounding function returns but before the surrounding function returns to its caller.

> If a deferred function value evaluates to nil, execution panics when the function is invoked, not when the "defer" statement is executed.

> For instance, if the deferred function is a function literal and the surrounding function has named result parameters that are in scope within the literal, the deferred function may access and modify the result parameters before they are returned.

> If the deferred function has any return values, they are discarded when the function completes.

The grammar:

```
DeferStmt = "defer" Expression .
```

The Expression must be a function call.

## 2. Panic and Recover (Go Language Specification)

From "Handling panics":

> Two built-in functions, panic and recover, assist in reporting and handling run-time panics and program-defined error conditions.

> While executing a function F, an explicit call to panic or a run-time panic terminates the execution of F. Any functions deferred by F are then executed as usual. Next, any deferred functions run by F's caller are run, and so on up to any deferred by the top-level function in the executing goroutine. At that point, the program is terminated and the error condition is reported, including the value of the argument to panic. This termination sequence is called panicking.

> The recover function allows a program to manage behavior of a panicking goroutine. Suppose a function G defers a function D that calls recover and a panic occurs in a function on the same goroutine in which G is executing. When the running of deferred functions reaches D, the return value of D's call to recover will be the value passed to the call of panic. If D returns normally, without starting a new panic, the panicking sequence stops.

> The return value of recover is nil when the goroutine is not panicking or recover was not called directly by a deferred function. Conversely, if a goroutine is panicking and recover was called directly by a deferred function, the return value of recover is guaranteed not to be nil.

## 3. The `Goexit` Function (runtime package)

From `runtime.Goexit`:

> Goexit terminates the goroutine that calls it. No other goroutine is affected. Goexit runs all deferred calls before terminating the goroutine. Because Goexit is not a panic, any recover calls in those deferred functions will return nil.

> Calling Goexit from the main goroutine terminates that goroutine without func main returning. Since func main has not returned, the program continues execution of other goroutines. If all other goroutines exit, the program crashes.

## 4. The `context` Package Contracts

### 4.1 `context.CancelFunc`

> A CancelFunc tells an operation to abandon its work. A CancelFunc does not wait for the work to stop. A CancelFunc may be called by multiple goroutines simultaneously. After the first call, subsequent calls to a CancelFunc do nothing.

### 4.2 `context.WithCancel`

> WithCancel returns a copy of parent with a new Done channel. The returned context's Done channel is closed when the returned cancel function is called or when the parent context's Done channel is closed, whichever happens first.

> Canceling this context releases resources associated with it, so code should call cancel as soon as the operations running in this Context complete.

### 4.3 `context.WithTimeout` and `context.WithDeadline`

> WithTimeout returns WithDeadline(parent, time.Now().Add(timeout)).

> WithDeadline returns a copy of the parent context with the deadline adjusted to be no later than d. If the parent's deadline is already earlier than d, WithDeadline(parent, d) is semantically equivalent to parent. The returned context's Done channel is closed when the deadline expires, when the returned cancel function is called, or when the parent context's Done channel is closed, whichever happens first.

> Canceling this context releases resources associated with it, so code should call cancel as soon as the operations running in this Context complete.

### 4.4 `context.AfterFunc` (Go 1.21+)

> AfterFunc arranges to call f in its own goroutine after ctx is done (cancelled or timed out). If ctx is already done, AfterFunc calls f immediately in its own goroutine.

> Multiple calls to AfterFunc on a context operate independently; one does not replace another. Calling the returned stop function stops the association of ctx with f. It returns true if the call stopped f from being run. If stop returns false, either the context is done and f has been started in its own goroutine; or f was already stopped. The stop function does not wait for f to complete before returning. If the caller needs to know whether f is completed, it must coordinate with f explicitly.

> If ctx has a "AfterFunc(func()) func() bool" method, AfterFunc will use it to schedule the call.

### 4.5 `context.WithCancelCause` (Go 1.20+)

> WithCancelCause behaves like WithCancel but returns a CancelCauseFunc instead of a CancelFunc. Calling cancel with a non-nil error ("cause") records that error in ctx; it can then be retrieved by calling Cause(ctx). Calling cancel with nil sets the cause to Canceled.

### 4.6 `context.Cause` (Go 1.20+)

> Cause returns a non-nil error explaining why c was canceled. The first cancellation of c or one of its parents sets the cause. If that cancellation happened via a call to CancelCauseFunc(err), then Cause returns err. Otherwise Cause(c) returns the same value as c.Err(). Cause returns nil if c has not been canceled yet.

## 5. The `os.Exit` Function (os package)

> Exit causes the current program to exit with the given status code. Conventionally, code zero indicates success, non-zero an error. The program terminates immediately; deferred functions are not run.

## 6. The `io.Closer` Interface

> Closer is the interface that wraps the basic Close method. The behavior of Close after the first call is undefined. Specific implementations may document their own behavior.

## 7. Memory Model and Defers

From the Go Memory Model:

> The receipt of a value from a closed channel happens after the close that closed the channel.

> A send on a channel happens before the corresponding receive from that channel completes.

These rules apply to defers that operate on channels. A `defer close(ch)` happens-before any subsequent receive on `ch`.

## 8. `sync.Once` Semantics

> Do calls the function f if and only if Do is being called for the first time for this instance of Once. In other words, given var once Once, if once.Do(f) is called multiple times, only the first call will invoke f, even if f has a different value in each invocation.

> If f panics, Do considers it to have returned; future calls of Do return without calling f.

The memory ordering: writes performed by `f` are visible to all subsequent calls of `Do`.

## 9. `errors.Join` Specification (Go 1.20+)

> Join returns an error that wraps the given errors. Any nil error values are discarded. Join returns nil if every value in errs is nil. The error formats as the concatenation of the strings obtained by calling the Error method of each element of errs, with a newline between each string.

> A non-nil error returned by Join implements the Unwrap() []error method.

The `errors.Is` and `errors.As` functions traverse the joined errors transparently.

## 10. `signal.NotifyContext` Specification (Go 1.16+)

> NotifyContext returns a copy of the parent context that is marked done (its Done channel is closed) when one of the listed signals arrives, when the returned stop function is called, or when the parent context's Done channel is closed, whichever happens first.

> The stop function unregisters the signal behavior, which, like signal.Reset, may restore the default behavior for a given signal. For example, the default behavior of a Go program receiving os.Interrupt is to exit. Calling NotifyContext(parent, os.Interrupt) will change the behavior to cancel the returned context. Future interrupts received will not trigger the default (exit) behavior until the returned stop function is called.

> The stop function releases resources associated with it, so code should call stop as soon as the operations running in this Context complete and signals no longer need to be diverted to the context.

## 11. `t.Cleanup` Specification (testing package)

> Cleanup registers a function to be called when the test (or subtest) and all its subtests complete. Cleanup functions will be called in last added, first called order.

## 12. `runtime.SetFinalizer` Specification

> SetFinalizer sets the finalizer associated with obj to the provided finalizer function. When the garbage collector finds an unreachable block with an associated finalizer, it clears the association and runs finalizer(obj) in a separate goroutine. This makes obj reachable again, but now without an associated finalizer. Assuming that SetFinalizer is not called again, the next time the garbage collector sees that obj is unreachable, it will free obj.

> SetFinalizer(obj, nil) clears any finalizer associated with obj.

> The argument obj must be a pointer to an object allocated by calling new, by taking the address of a composite literal, or by taking the address of a local variable. The argument finalizer must be a function that takes a single argument to which obj's type can be assigned, and can have arbitrary ignored return values.

> Finalizers are run in the dependency order: if A points to B, both have finalizers, and they are otherwise unreachable, only the finalizer for A runs; once A is freed, the finalizer for B can run.

## 13. The `panic` and `recover` Built-ins (Language Spec)

```
The built-in functions panic and recover, described later, assist in reporting and handling run-time panics and program-defined error conditions.
```

Function signatures (conceptual):

```go
func panic(v interface{})
func recover() interface{}
```

`panic` is variadic in some descriptions; in practice it takes a single argument.

`recover` returns the value passed to `panic`, or nil if no panic is in progress or `recover` is not called from a deferred function.

## 14. The `errgroup.Group` Contract (golang.org/x/sync/errgroup)

> A Group is a collection of goroutines working on subtasks that are part of the same overall task.

> A zero Group is valid, has no limit on the number of active goroutines, and does not cancel on error.

> Go calls the given function in a new goroutine. The first call to return a non-nil error cancels the group's context, if the group was created by calling WithContext.

> Wait blocks until all function calls from the Go method have returned, then returns the first non-nil error (if any) from them.

> WithContext returns a new Group and an associated Context derived from ctx. The derived Context is canceled the first time a function passed to Go returns a non-nil error or the first time Wait returns, whichever occurs first.

## 15. Goroutine Termination

A goroutine terminates when:
- The function it started executing returns normally.
- The function it started executing panics and the panic is not recovered.
- The function calls `runtime.Goexit`.

In all three cases, the goroutine's pending defers run before termination. After termination, the goroutine's resources (stack, registers, etc.) are reclaimed by the runtime.

## 16. The `Reset` Behavior of `t.Cleanup`

`t.Cleanup` accepts a function with no arguments and no return value:

```go
func (t *T) Cleanup(f func())
```

Cleanup functions are called regardless of test outcome (pass, fail, panic). They run in LIFO order. If a Cleanup function itself fails (via t.Errorf or panic), the test is marked failed but subsequent Cleanup functions still run.

## 17. Order of Evaluation for `defer` Arguments

From the language specification:

> Each time a "defer" statement executes, the function value and parameters to the call are evaluated as usual and saved anew but the actual function is not invoked.

"Evaluated as usual" means at the defer line, using Go's standard left-to-right evaluation order for function arguments.

Example:
```go
defer fmt.Println(a(), b(), c())
```

`a`, `b`, `c` are called at the defer line (in left-to-right order). Their results are stored. Later, `fmt.Println` is called with those stored values.

## 18. Defer in the Top Frame

When `main` returns, its defers run. When `main` panics, its defers run. But `os.Exit` skips them.

When the main goroutine ends (any cause that runs defers), the program terminates as if `main` had returned.

## 19. The "Goroutine 1" Special Case

The main goroutine (often called "goroutine 1" in stack traces) is special:
- It runs `main.main`.
- When it returns, the program exits with status 0.
- When it panics unrecovered, the program exits with a non-zero status.
- Its defers run on return or panic, but not on `os.Exit`.

Other goroutines: when they return or are recovered, no special action; when they panic unrecovered, the program crashes.

## 20. Concurrency Safety of Cleanup Primitives

- `defer`: per-goroutine; no synchronisation needed.
- `recover`: per-goroutine.
- `context.AfterFunc.stop`: safe for concurrent calls; uses `sync.Once`.
- `sync.Once.Do`: safe for concurrent calls; serialises.
- `errgroup.Group`: methods are safe for concurrent use; first error wins.

## 21. Closing Notes

These excerpts and contracts are the formal foundation. The other files in this sub-topic interpret, apply, and extend them. When in doubt about cleanup semantics, return to this specification.

The Go specification is at https://go.dev/ref/spec. The standard library docs are at https://pkg.go.dev. Read them. Cross-reference. Verify behaviour with small programs.

Cleanup correctness rests on understanding the contracts. The contracts rest on the specification. The specification is the source of truth.

## 22. Quick Cross-Reference Table

| Concept | Spec Section / Package |
|---------|-----------------------|
| `defer` statement | Lang Spec: Defer statements |
| `panic`/`recover` | Lang Spec: Handling panics |
| `runtime.Goexit` | `runtime` package docs |
| `os.Exit` | `os` package docs |
| `io.Closer` | `io` package docs |
| `context.AfterFunc` | `context` package docs (Go 1.21+) |
| `context.Cause` | `context` package docs (Go 1.20+) |
| `errors.Join` | `errors` package docs (Go 1.20+) |
| `signal.NotifyContext` | `os/signal` package docs (Go 1.16+) |
| `testing.T.Cleanup` | `testing` package docs |
| `sync.Once` | `sync` package docs |
| `runtime.SetFinalizer` | `runtime` package docs |
| `errgroup.Group` | `golang.org/x/sync/errgroup` |

Refer to each as the canonical source. The Go documentation is excellent; read it directly.

---

This specification file is intentionally short. It is a reference, not a tutorial. The tutorial content is in junior.md, middle.md, senior.md, and professional.md. The exercise content is in interview.md, tasks.md, find-bug.md, and optimize.md.

Together they form the complete chapter.

---

## 23. Sample Programs Demonstrating Each Spec Rule

The following short programs verify the spec rules in practice. Run them to confirm behaviour.

### Defer arg evaluation timing

```go
package main
import "fmt"
func main() {
    x := 1
    defer fmt.Println("deferred:", x)
    x = 99
    fmt.Println("body:", x)
}
```
Output: `body: 99` then `deferred: 1`. Confirms args are evaluated at the defer line.

### LIFO order

```go
package main
import "fmt"
func main() {
    defer fmt.Println("1")
    defer fmt.Println("2")
    defer fmt.Println("3")
}
```
Output: `3 2 1`. Confirms LIFO.

### Defer modifies named return

```go
package main
import "fmt"
func f() (n int) {
    defer func() { n *= 2 }()
    return 5
}
func main() { fmt.Println(f()) }
```
Output: `10`. Confirms deferred function can modify named return.

### Defer doesn't modify unnamed return

```go
package main
import "fmt"
func f() int {
    n := 5
    defer func() { n *= 2 }()
    return n
}
func main() { fmt.Println(f()) }
```
Output: `5`. Confirms unnamed return is captured before defer runs.

### Defer runs on panic

```go
package main
import "fmt"
func main() {
    defer fmt.Println("cleanup")
    defer func() { recover() }()
    panic("boom")
}
```
Output: `cleanup`. Confirms defers run during panic; recover catches it.

### `os.Exit` skips defers

```go
package main
import (
    "fmt"
    "os"
)
func main() {
    defer fmt.Println("never prints")
    os.Exit(0)
}
```
Output: nothing. Confirms `os.Exit` skips defers.

### `runtime.Goexit` runs defers

```go
package main
import (
    "fmt"
    "runtime"
    "sync"
)
func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer fmt.Println("goexit cleanup")
        runtime.Goexit()
    }()
    wg.Wait()
}
```
Output: `goexit cleanup`. Confirms Goexit runs defers.

### AfterFunc fires on cancel

```go
package main
import (
    "context"
    "fmt"
    "time"
)
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    context.AfterFunc(ctx, func() { fmt.Println("after") })
    cancel()
    time.Sleep(10 * time.Millisecond)
}
```
Output: `after`. Confirms AfterFunc fires on cancel.

### `stop()` deregisters AfterFunc

```go
package main
import (
    "context"
    "fmt"
    "time"
)
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    stop := context.AfterFunc(ctx, func() { fmt.Println("should not print") })
    fmt.Println("stopped:", stop())
    cancel()
    time.Sleep(10 * time.Millisecond)
}
```
Output: `stopped: true`. Confirms stop deregisters before fire.

### `errors.Join` short-circuits on nil

```go
package main
import (
    "errors"
    "fmt"
)
func main() {
    fmt.Println(errors.Join(nil, nil))  // nil
    fmt.Println(errors.Join(errors.New("a"), nil))  // a
}
```
Confirms nil errors are dropped.

### `context.Cause` returns the cause

```go
package main
import (
    "context"
    "errors"
    "fmt"
)
func main() {
    ctx, cancel := context.WithCancelCause(context.Background())
    cancel(errors.New("custom"))
    fmt.Println("err:", ctx.Err())
    fmt.Println("cause:", context.Cause(ctx))
}
```
Output: `err: context canceled` and `cause: custom`. Confirms cause is separate.

### `sync.Once` runs body once

```go
package main
import (
    "fmt"
    "sync"
)
func main() {
    var once sync.Once
    for i := 0; i < 3; i++ {
        once.Do(func() { fmt.Println("hello") })
    }
}
```
Output: `hello` (once). Confirms Once semantics.

### `t.Cleanup` runs LIFO

```go
package mypackage
import (
    "fmt"
    "testing"
)
func TestCleanupOrder(t *testing.T) {
    t.Cleanup(func() { fmt.Println("A") })
    t.Cleanup(func() { fmt.Println("B") })
    t.Cleanup(func() { fmt.Println("C") })
}
```
Output: `C B A`. Confirms LIFO order.

These programs are the practical verification of the spec rules. Each is small enough to run quickly; together they confirm the entire cleanup machinery's behaviour.

---

## 24. Spec Edge Cases Worth Knowing

### Empty defer

```go
defer func() {}()
```

Legal. Registers an empty closure. Runs at function exit; does nothing.

### Defer in `if` branches

```go
if cond {
    defer fmt.Println("conditional")
}
```

Legal. The defer is registered only if `cond` is true. At function exit, it runs only if it was registered.

### Defer in `goto` blocks

```go
func f() {
    defer fmt.Println("first")
    goto skip
    defer fmt.Println("never registered")
skip:
    return
}
```

Output: `first`. The second defer was never reached, so never registered.

### Defer with multiple return values

```go
func swap() (a, b int) {
    defer func() { a, b = b, a }()
    return 1, 2
}
```

Output: `swap()` returns `2, 1`. The defer can modify multiple named returns.

### Defer with a defer

```go
func nested() {
    defer fmt.Println("outer")
    defer func() {
        defer fmt.Println("inner")
    }()
}
```

Output: `inner outer`. Wait — let me reason. Outer registered first, inner-wrapper registered second. LIFO: inner-wrapper runs first; it registers `inner` and then returns; `inner` runs; then `outer` runs.

So output: `inner outer`. (Note the inner is queued as a defer of the wrapper closure, which has its own defer scope.)

### Defer of `os.Exit`

```go
defer os.Exit(0)
defer fmt.Println("this prints")
```

LIFO: `Println` runs first, then `os.Exit` runs and the process terminates. Any defers registered *before* this `os.Exit` (i.e., registered later in execution order) have already run; defers registered later than `os.Exit` (executed earlier) ran before it.

### Defer of `panic`

```go
defer panic("oh no")
work()
```

After `work()` returns normally, the defer fires and panics. The function unwinds via panic.

### Multiple defers including a panic

```go
defer fmt.Println("first")
defer panic("boom")
defer fmt.Println("third")
```

LIFO: `third` prints, then `panic` fires. The panic propagates; the runtime keeps running defers. `first` prints, then the panic continues to the caller.

If no caller recovers, the program crashes.

### Defer with a method on a typed nil

```go
type T struct{}
func (t *T) Close() {}

var t *T
defer t.Close()
```

The defer registers fine (the receiver is captured at defer line as nil). When it runs, `t.Close()` is called on nil — but if `Close` does not dereference the receiver, it succeeds. If it does dereference, it panics.

So nil receivers are subtle. Methods that handle nil receivers safely are OK.

### Defer in a function that calls `runtime.Goexit`

```go
func f() {
    defer fmt.Println("ran")
    runtime.Goexit()
}
```

Output: `ran`. Goexit runs defers before terminating the goroutine.

### Cancel a context that has AfterFunc

```go
ctx, cancel := context.WithCancel(parent)
stop := context.AfterFunc(ctx, fn)
cancel()
// stop now returns false (callback already fired)
```

`stop()` returns false if the callback has started. To know if the callback finished, you must coordinate.

---

## 25. Spec Verification via the Go Test Tool

The Go team's own tests verify the specification. Running:

```sh
go test -run TestDefer runtime
```

executes the runtime's defer tests. They cover:
- Basic LIFO order.
- Defer in loops.
- Defer with panic.
- Defer with Goexit.
- Defer interaction with stack growth.
- Open-coded defer correctness.

Reading these tests is educational. They cover edge cases not always documented elsewhere.

---

## 26. Closing Reference

This spec file is the formal foundation for the cleanup ordering sub-topic. The narrative files (junior through professional) interpret and apply these rules. The exercise files put them into practice.

If a question arises about correct cleanup behaviour, return here first. The Go specification, the standard library docs, and the cited package documentation are the canonical sources.

When the spec is ambiguous (rare but possible), the runtime implementation is the operational ground truth — but file an issue with the Go team to clarify.

---

End of specification.
