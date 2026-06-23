# Go Nil Pointer Dereference — Senior Level

## 1. Overview

Senior-level mastery of nil pointer dereference combines runtime mechanics, compiler internals, and production diagnostics. You can describe how a CPU fault becomes a Go panic, where in the runtime the conversion happens, what `*runtime.PanicNilError` is and when it appeared, how the compiler decides whether to insert a nil check, which SSA passes elide redundant nil checks, and how the GC and signal handler interact with bad addresses.

This document covers the kernel-to-runtime path of a SIGSEGV, the funcval representation that makes nil function calls panic, the Go 1.21+ typed panic value, and the compiler-side machinery that minimizes the cost of nil checks in normal code.

---

## 2. From CPU Fault to Go Panic

### 2.1 The CPU Trap

When the CPU executes a load or store using address 0 (or any address in an unmapped page), the hardware MMU raises a page fault. On Linux/macOS, the kernel translates this into the signal SIGSEGV (segmentation fault). The kernel suspends the offending thread and delivers the signal to the process.

Go installs a signal handler for SIGSEGV at startup. The handler lives in `src/runtime/signal_unix.go` (function `sigtrampgo` and friends, dispatching to `sighandler`).

### 2.2 Distinguishing Nil from Other Faults

A SIGSEGV gives the runtime a `siginfo_t` with the offending address. Go inspects the address:
- If it falls in the nil region (the first 64 KB on most platforms), the runtime treats it as a nil pointer dereference.
- Otherwise, it might be a wild pointer, a stack overflow, or something else.

Linux's `vm.mmap_min_addr` (typically 65536) reserves the low pages so they cannot be mapped. Go relies on this to ensure nil dereference always faults.

### 2.3 Conversion to a Panic

The runtime calls `panicmem` (in `src/runtime/panic.go`):

```go
func panicmem() {
    panicCheck1(getcallerpc(), "invalid memory address or nil pointer dereference")
    panic(memoryError)
}

// On Go 1.21+:
func panicmemAddr(addr uintptr) {
    panicCheck1(getcallerpc(), "invalid memory address or nil pointer dereference")
    panic(errorAddressString{...}) // or *PanicNilError specifically for nil
}
```

The panic is initiated as if the offending instruction had called `panic`. The runtime walks the stack via `gopanic`, runs deferred functions, and either reaches a `recover` or terminates the goroutine.

### 2.4 Stack Frame Reconstruction

The signal handler had to inject the panic into the user goroutine's stack mid-instruction. Go uses a clever trick: it modifies the saved program counter on the signal stack so that when the handler returns, execution resumes at `runtime.sigpanic`. From there, the runtime sees a normal Go stack frame and runs the panic machinery.

This is why nil panics appear in stack traces with a `runtime.sigpanic` frame just below the offending function.

---

## 3. `*runtime.PanicNilError` (Go 1.21+)

### 3.1 Background

Before Go 1.21, the panic value for nil dereference was `runtime.errorString("invalid memory address or nil pointer dereference")`. There was no easy way to distinguish a nil panic from another runtime error programmatically — you had to compare strings.

### 3.2 The Typed Panic

Go 1.21 introduced `runtime.PanicNilError`:

```go
// runtime/panic.go (excerpt)
type PanicNilError struct {
    _ [0]*PanicNilError // prevents zero-value comparisons
}

func (*PanicNilError) Error() string { return "invalid memory address or nil pointer dereference" }
func (*PanicNilError) RuntimeError() {}
```

Now you can:

```go
defer func() {
    if r := recover(); r != nil {
        if _, ok := r.(*runtime.PanicNilError); ok {
            // specifically a nil deref
        }
    }
}()
```

This was added alongside changes that disambiguated `panic(nil)` (which used to also mean "no panic"). The new `*PanicNilError` is also the value passed to `recover()` after a `panic(nil)`, so callers can detect that case too.

### 3.3 Source Location

- `src/runtime/panic.go` — `panicmem`, `PanicNilError` type.
- `src/runtime/signal_unix.go` — signal handler entry, `sigtrampgo`.
- `src/runtime/signal_amd64.go` (and per-arch variants) — `sigpanic` setup.

---

## 4. The Compiler's Role

### 4.1 Nil Checks the Compiler Inserts

For most pointer dereferences, the compiler does not insert an explicit nil check — the load itself will fault if the pointer is nil. But there are exceptions:

1. **Loads at high offsets** — if the dereference involves an offset large enough to skip past the nil page (typically beyond 64 KB), the compiler must insert an explicit `if p == nil` check. Otherwise the load might land in valid memory and silently succeed when it should fault.

2. **Slice bounds + nil**, **map operations**, **interface method calls** — these go through runtime helpers that often have their own nil check.

3. **Function-typed values** — calling `nil` function values requires an explicit check (the funcval's first word would be nil), inserted by the compiler.

### 4.2 The Funcval and Nil Function Calls

A function value (`func()`) at runtime is represented as a `*funcval`:

```go
// runtime/runtime2.go
type funcval struct {
    fn uintptr
    // optional: captured variables follow
}
```

Calling a function value loads `fn` and indirect-jumps. If the funcval is nil, the load itself faults — a nil pointer dereference. The runtime catches this and panics.

```go
var f func()
f() // funcval pointer is nil; load of fn faults
```

### 4.3 Nil Check Insertion

The compiler tracks whether a pointer has been "nil-checked" in scope. If it has, subsequent dereferences within the same basic block don't re-check. The `OpIsNonNil` SSA op is emitted as needed.

`cmd/compile/internal/ssa/nilcheck.go` runs the dedicated nil-check elimination pass. It walks the control-flow graph and removes nil checks on values that the dominator chain proves non-nil:

- `&x` is non-nil.
- `new(T)` is non-nil.
- A pointer that has already been dereferenced in a dominating block is non-nil.
- A pointer compared `!= nil` and the comparison guards the use is non-nil within the guard.

### 4.4 Deciphering `-gcflags="-d=nil"` Output

```bash
go build -gcflags="-d=nil" main.go
```

This dumps every nil check the compiler considered. You'll see lines like:
```
main.go:42:10: removed nil check
main.go:55:8: generated nil check
```

Useful when investigating why a nil check appears in hot code.

### 4.5 SSA Passes Relevant to Nil

Order in `ssa.compile` (rough):
1. `phielim` — eliminates trivial phis.
2. `nilcheckelim` — the main nil-check elimination.
3. `prove` — adds proven-non-nil annotations from comparisons and dominators.
4. `nilcheckelim2` — second pass after `prove`.

The `prove` pass infers facts like "after this branch, `p` is non-nil" and feeds them back to `nilcheckelim`.

---

## 5. Runtime Helpers and Their Nil Behavior

### 5.1 `runtime.mapaccess1` / `mapaccess2`

Reading a nil map calls `mapaccess1` with a nil `*hmap`. The function checks at the top:
```go
if h == nil || h.count == 0 {
    return zeroPtr
}
```
So reading from a nil map returns the zero value of the value type. **No panic.**

Writing is different — `mapassign` panics with `assignment to entry in nil map`.

### 5.2 `runtime.newobject`

`new(T)` returns a non-nil pointer to a zero-initialized T. The compiler's nil-check pass treats this as proven non-nil and elides downstream checks.

### 5.3 Method Dispatch via Interface

For an interface call `v.M()`, the compiler emits a load of the method table from the interface's type word, then calls indirectly. If the interface value is the zero interface (both words nil), the load of the type word is from address 0, which faults. The runtime then panics with nil dereference.

### 5.4 Type Assertions

`v.(T)` on a nil interface panics with a different error: "interface conversion: interface is nil, not T". This is NOT a nil pointer dereference; the compiler emits an explicit check.

`v.(T)` on a non-nil interface with mismatched type panics with "interface conversion: ... is not T".

`v, ok := v.(T)` never panics; returns zero T and false on mismatch.

---

## 6. Stack Trace Anatomy

A typical nil-deref stack trace:

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x10b1c80]

goroutine 1 [running]:
main.(*User).Greet(...)
        /path/main.go:15
main.main()
        /path/main.go:25 +0x18
```

Decoding:
- `signal SIGSEGV`: confirms the kernel raised a segfault.
- `code=0x1`: SI_USER on most archs; for nil deref it's typically SEGV_MAPERR (1) — address not mapped.
- `addr=0x0`: the offending address. Always 0 for direct nil deref; might be a small positive number if the deref involved an offset (e.g., `p.field` where `field` is at offset 8).
- `pc=0x10b1c80`: the program counter of the offending instruction.

The `addr` field is diagnostic gold. If `addr` is, say, `0x18`, the dereference involved a struct field at offset 0x18 — narrows down the field.

---

## 7. Method Set Subtleties

### 7.1 Value Receiver on Nil

```go
type T struct{ v int }
func (t T) Show() { fmt.Println(t.v) }
var t *T
t.Show() // PANIC: dereferences t to copy receiver
```

A value-receiver method invoked through a pointer must dereference the pointer to copy the value. Nil pointer → panic.

### 7.2 Pointer Receiver on Nil

```go
func (t *T) Show() { fmt.Println(t.v) }
var t *T
t.Show() // PANIC: body reads t.v
```

The call itself is fine (no dereference of `t` until the body executes). The panic comes from `t.v` inside `Show`.

### 7.3 Pointer Receiver Without Field Access

```go
func (t *T) Type() string { return "T" }
var t *T
t.Type() // OK: body never reads t
```

This is the foundation of nil-safe methods.

### 7.4 Embedded Field on Nil

```go
type Inner struct{ v int }
type Outer struct{ *Inner }

var o *Outer
_ = o.v // panic: dereferences o
```

Even with embedding, the access still requires loading from o.

---

## 8. Concurrency and Nil

### 8.1 Goroutine Panic Visibility

A panic in a goroutine that is not recovered terminates the entire process. The runtime walks the panicking goroutine's deferred functions; if none recover, `runtime.fatalpanic` is called, which prints the trace for ALL goroutines and exits.

```go
go func() {
    var p *int
    *p = 1 // process dies
}()
```

This is intentional — silent failure of a worker goroutine is usually worse than crashing.

### 8.2 Recovery in Goroutines

Each goroutine has its own deferred-function chain. A recover in goroutine A does not catch a panic in goroutine B. Each goroutine that may panic should have its own recovery.

### 8.3 Race Detector

The `-race` flag often surfaces latent nil paths because it instruments memory accesses. A read-after-uninitialized-write race may appear at the same place as a future nil deref.

---

## 9. Production Patterns

### 9.1 Stack Capture

When recovering, capture the full stack with `debug.Stack()` and log it before re-acting:

```go
defer func() {
    if r := recover(); r != nil {
        stack := debug.Stack()
        log.Printf("panic: %v\n%s", r, stack)
        // optional: send to error tracker (Sentry, Honeycomb, etc.)
    }
}()
```

### 9.2 Distinguishing Nil from Other Runtime Errors (Go 1.21+)

```go
import "runtime"

defer func() {
    if r := recover(); r != nil {
        if _, isNil := r.(*runtime.PanicNilError); isNil {
            metrics.Inc("nil_panics")
        }
        log.Printf("panic: %T %v", r, r)
    }
}()
```

### 9.3 Per-Handler Recovery in HTTP Server

```go
func recoverMiddleware(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("HTTP panic: %v\n%s", rec, debug.Stack())
                http.Error(w, "internal error", 500)
            }
        }()
        h.ServeHTTP(w, r)
    })
}
```

### 9.4 Re-Panic for Aggregate Logging

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("...")
        panic(r) // let outer handler also see it, OR escalate to fatal
    }
}()
```

Use sparingly — multiple recover/repanic chains can confuse stack traces.

---

## 10. Compiler-Inserted Nil Checks: Cost

For a typical `p.field` where `field` is at small offset:
- 0 instructions for the nil check (the load itself faults if nil).
- Total cost: 1 load instruction.

For a `p.field` where `field` is at large offset (>64 KB):
- 2 instructions: TEST + JCC for the explicit check.
- Plus 1 instruction for a `panicmem` call branch (cold path).

For `f()` where `f` is a function value:
- 1 load of fn pointer.
- Indirect call.
- Implicit nil check via the load (if nil, the load itself faults).

The compiler's nilcheckelim pass typically removes >90% of redundant checks in real code, so the cost is essentially zero.

---

## 11. Reading the Source

Key files in the Go source tree:

- `src/runtime/panic.go` — `gopanic`, `gorecover`, `panicmem`, `PanicNilError`.
- `src/runtime/signal_unix.go` — SIGSEGV handler entry.
- `src/runtime/signal_amd64.go` (per-arch) — `sigpanic` trampoline.
- `src/cmd/compile/internal/ssa/nilcheck.go` — nil-check elimination pass.
- `src/cmd/compile/internal/ssa/prove.go` — fact propagation including nilness.
- `src/cmd/compile/internal/walk/expr.go` — initial nil-check generation during walk.

---

## 12. Self-Assessment Checklist

- [ ] I can describe the SIGSEGV → panic conversion path
- [ ] I know where `panicmem` lives in the runtime
- [ ] I can identify `*runtime.PanicNilError` from a recovered value
- [ ] I understand when the compiler inserts explicit nil checks
- [ ] I can read the SSA dump and find nil-check operations
- [ ] I know why low-memory pages must be unmapped
- [ ] I can decode a SIGSEGV stack trace's addr field
- [ ] I distinguish nil-deref panic from other runtime errors
- [ ] I design recovery layers for goroutines

---

## 13. Summary

A nil pointer dereference is a hardware page fault, intercepted by the kernel as SIGSEGV, intercepted by Go's signal handler, transformed into a panic via `panicmem`, and propagated through the goroutine's deferred-function chain until recovered or fatal. Go 1.21 introduced `*runtime.PanicNilError` to make detection programmatic. The compiler aggressively elides redundant nil checks via SSA passes; remaining checks have negligible cost. Production handling means recovering at boundaries, capturing stacks, distinguishing nil from other runtime errors, and ensuring no goroutine panics silently. Senior engineers know which OS guarantees (e.g., low-memory unmapping) and which compiler passes make this all work, and can dive into the runtime when a panic doesn't make sense.

---

## 14. Further Reading

- [`runtime.PanicNilError`](https://pkg.go.dev/runtime#PanicNilError)
- [Go runtime signals](https://github.com/golang/go/blob/master/src/runtime/signal_unix.go)
- [SSA nil-check elimination](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssa/nilcheck.go)
- [Go 1.21 release notes](https://go.dev/doc/go1.21)
- [Linux mmap_min_addr](https://man7.org/linux/man-pages/man5/proc.5.html)
- 2.7.4 Memory Management
- 2.7.5 Unsafe Pointer
- 2.8 Error Handling Basics
