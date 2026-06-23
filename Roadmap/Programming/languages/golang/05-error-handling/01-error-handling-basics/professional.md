# Error Handling Basics — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The error Interface in the Compiler](#the-error-interface-in-the-compiler)
3. [How nil Errors Are Represented](#how-nil-errors-are-represented)
4. [The Memory Cost of an Error](#the-memory-cost-of-an-error)
5. [Allocation Patterns](#allocation-patterns)
6. [Escape Analysis and Errors](#escape-analysis-and-errors)
7. [Inlining and Inlining Boundaries](#inlining-and-inlining-boundaries)
8. [The Cost of fmt.Errorf](#the-cost-of-fmterrorf)
9. [Compiler-Inserted Boilerplate](#compiler-inserted-boilerplate)
10. [Errors and the Garbage Collector](#errors-and-the-garbage-collector)
11. [Errors in the Runtime](#errors-in-the-runtime)
12. [The Standard Library's Error Strategy](#the-standard-librarys-error-strategy)
13. [Performance Profiles of Real Programs](#performance-profiles-of-real-programs)
14. [Disassembly: What if err != nil Actually Compiles To](#disassembly-what-if-err-nil-actually-compiles-to)
15. [Cross-Goroutine Error Propagation Costs](#cross-goroutine-error-propagation-costs)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level, you stop talking about `error` as an idiom and start talking about it as a runtime artifact: an interface header, a heap allocation, a pointer in a generated struct, a slot in the call frame. You read the compiled assembly, you measure with `pprof`, you predict the GC behavior of error-heavy code paths.

This file is about Go errors at the level of bits, bytes, and CPU cycles.

---

## The error Interface in the Compiler

`error` is a *predeclared* interface. In `$GOROOT/src/builtin/builtin.go`:

```go
type error interface {
    Error() string
}
```

Like all interfaces, `error` is represented at runtime as **two machine words**:
- `*itab` (interface table pointer): describes the dynamic type, holds a pointer to the type's `Error` method.
- `unsafe.Pointer` (data): pointer to the underlying value.

```
+------+------+
| itab | data |
+------+------+
   8 B    8 B    on amd64
```

A *nil* error has both words zero. A *non-nil* error has both words non-zero.

The famous "non-nil interface holding a nil pointer" gotcha: if you assign a typed nil pointer (`var p *MyErr = nil`) to an `error` variable, the itab is *non-nil* (it identifies `*MyErr`) while data is nil. The interface is therefore non-nil.

---

## How nil Errors Are Represented

```go
var err error  // both words zero
err == nil     // true
```

The compiler emits a comparison against the zero-pair. On amd64 it's effectively two `cmp` instructions or a single 16-byte SIMD compare on modern CPUs. Cost: < 1 ns.

When you do `if err != nil { return err }`, the compiler checks both words.

A `nil` return statement assigns the zero-pair into the interface return slot. No allocation, no methods called.

---

## The Memory Cost of an Error

Three pieces of memory:

1. **The interface header** — 16 bytes, lives in the call frame. Zero allocation.
2. **The dynamic type's storage** — varies. `*errors.errorString` is 16 bytes (a pointer + a struct with a string). Allocated on the heap if the value escapes.
3. **The string** — the error message itself. May be a string literal (no allocation, just a slice header pointing to read-only memory) or a constructed string (heap-allocated).

Example:

```go
return errors.New("bad input")
```

`errors.New` allocates a `*errorString` on the heap (16 B for the struct, plus the string header pointing to read-only ".rodata"). One allocation, ~32 B.

```go
return fmt.Errorf("user %d: %w", id, err)
```

Goes through `fmt.Sprintf` to build the message string (allocation), then constructs a `*fmt.wrapError` (allocation). Two allocations, ~80-128 B depending on string length.

---

## Allocation Patterns

| Construct | Allocation per call |
|-----------|---------------------|
| `var err error = nil` | 0 |
| `errors.New("...")` (package level) | 0 (allocated once at init) |
| `errors.New("...")` (in function) | 1 (the `*errorString`) |
| `fmt.Errorf("...")` (no `%w`) | 1-2 |
| `fmt.Errorf("...: %w", err)` | 2-3 (wrapper + maybe formatted string) |
| `errors.Is(err, target)` | 0 (just method calls and type compares) |
| `errors.As(err, &target)` | 0 in most cases |
| `errors.Join(a, b)` | 1 (the joinError) |

**Optimization rule**: package-level error variables are free per call. Inside-function allocations are not.

---

## Escape Analysis and Errors

The Go compiler decides per allocation whether a value lives on the stack or the heap. This decision is called **escape analysis**.

```go
func f() error {
    return errors.New("oops")
}
```

The `*errorString` returned by `errors.New` *escapes* — it leaves the function via the return value. It must live on the heap.

```go
func f() {
    err := errors.New("local")
    log.Print(err.Error())
}
```

If `err` is only used locally and never returned, escape analysis *might* keep it on the stack. In practice, because `Error()` is an interface call (and the analyzer is conservative about interface methods), the value usually still escapes.

You can inspect the decision:

```bash
go build -gcflags='-m=2' ./...
```

Output includes lines like:
```
./main.go:10:21: errors.New("local") escapes to heap
```

This is the truth. Believe `gcflags`, not your intuition.

---

## Inlining and Inlining Boundaries

`errors.New` is small enough to be inlined since Go 1.10ish:

```go
func New(text string) error {
    return &errorString{text}
}
```

When inlined, the call disappears and only the allocation remains.

`fmt.Errorf` is *not* inlined. It is a wrapper around the `fmt.Sprintf` machinery, which is far too large for the inliner. Every call has full call overhead plus the work inside.

The `if err != nil` branch is itself a candidate for branch prediction. CPUs predict it correctly the vast majority of the time (errors are rare), so the misprediction cost is paid only on actual failures. This is one reason the idiom is performant: the compiler does nothing exotic, the CPU does the rest.

---

## The Cost of fmt.Errorf

Roughly:
- ~150 ns per call on a typical machine.
- 1-3 allocations.
- Acquires no locks.

Source: `$GOROOT/src/fmt/errors.go`. The implementation:

```go
func Errorf(format string, a ...any) error {
    p := newPrinter()
    p.wrapErrs = true
    p.doPrintf(format, a)
    s := string(p.buf)
    var err error
    switch len(p.wrappedErrs) {
    case 0:
        err = errors.New(s)
    case 1:
        w := &wrapError{msg: s}
        w.err, _ = a[p.wrappedErrs[0]].(error)
        err = w
    default:
        // ... uses wrapErrors with []error
    }
    p.free()
    return err
}
```

Three things to notice:
1. There is a printer pool (`newPrinter()` / `p.free()`), which avoids per-call allocation of the formatter itself.
2. The formatted message is always allocated.
3. The wrapper struct is allocated.

In a benchmark, `fmt.Errorf("foo: %w", err)` is roughly **3x** more expensive than `errors.New("foo")`.

---

## Compiler-Inserted Boilerplate

When you write:

```go
n, err := f()
```

and `f` returns `(int, error)`, the compiler emits:
1. Call site that allocates two return slots in the frame (8 B + 16 B = 24 B).
2. Two move instructions to copy the returns to `n` and `err`.

That's it. No hidden machinery. The mental model "just multi-return" is the literal model.

---

## Errors and the Garbage Collector

Every error value created with `errors.New` or `fmt.Errorf` becomes a **heap object** and a **GC root candidate**. Implications:

- An error escaping into a long-lived collection (logs, error queues) keeps the wrapped error alive, which keeps any wrapped chain alive.
- A wrap chain forms a linked list on the heap. Long chains = many small live objects = more GC scan work.
- For high-volume error paths, *prefer sentinels* declared at package level. They live forever as part of the data segment and do not interact with the GC mark phase per call.

---

## Errors in the Runtime

The Go runtime *itself* uses `error` for many things:

- `runtime.Error` is an interface returned by panics like "index out of range" or "nil map".
- `os.PathError`, `net.OpError`, etc. are exported error types from runtime-adjacent packages.
- The `runtime` package generally avoids `errors.New`/`fmt.Errorf` in hot paths to avoid allocations during GC or scheduler events.

You can see this in `$GOROOT/src/runtime/error.go` — runtime errors are typed structs, not stringly-typed.

---

## The Standard Library's Error Strategy

Different stdlib packages use different patterns:

| Package | Pattern |
|---------|---------|
| `os` | Typed errors (`*PathError`, `*LinkError`) + sentinels (`ErrExist`, `ErrPermission`). |
| `io` | Sentinels (`io.EOF`, `io.ErrUnexpectedEOF`). |
| `net` | Typed errors (`*OpError`, `*DNSError`) + sentinels via `net.ErrClosed`. |
| `database/sql` | Sentinels (`ErrNoRows`, `ErrTxDone`). |
| `encoding/json` | Typed errors (`*SyntaxError`, `*UnmarshalTypeError`). |
| `context` | Sentinels (`Canceled`, `DeadlineExceeded`). |
| `fmt` | Returns errors but defines few of its own. |
| `strconv` | Typed (`*NumError`) + sentinels (`ErrSyntax`, `ErrRange`). |

Reading the standard library is the best way to learn idiomatic error API design. Pick a package you know, look at its `errors.go` (or equivalent), study the patterns.

---

## Performance Profiles of Real Programs

In a typical Go web service, errors are *not* a bottleneck. Profiling rarely shows `fmt.Errorf` in the top 20 of CPU time.

Where errors *do* show up:

- **Parsers** that throw away most input as malformed (`strconv.Atoi` on user data).
- **Network glue** that wraps every error with multiple layers of context.
- **Tight retry loops** that allocate a new error each iteration.

Diagnosis:
```bash
go test -bench=. -benchmem -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -alloc_objects mem.out
```

Look for `errors.New`, `fmt.Errorf`, `*wrapError` in the allocation profile. If they are in the top 10 by count, they are worth attention.

---

## Disassembly: What if err != nil Actually Compiles To

A simple function:

```go
func f() (int, error) {
    n, err := strconv.Atoi("42")
    if err != nil {
        return 0, err
    }
    return n, nil
}
```

On amd64 (Go 1.21, simplified):

```asm
MOVQ    $0x4, AX         ; len("42")
MOVQ    "".str(SB), BX
CALL    strconv.Atoi(SB)
MOVQ    AX, n+0(SP)      ; n
MOVQ    BX, errType(SP)  ; err type word
MOVQ    CX, errData(SP)  ; err data word
TESTQ   BX, BX           ; check err type word == 0?
JNE     errpath          ; if non-nil, jump
MOVQ    n+0(SP), AX
XORL    BX, BX           ; nil error type
XORL    CX, CX           ; nil error data
RET
errpath:
XORL    AX, AX           ; n = 0
MOVQ    errType(SP), BX
MOVQ    errData(SP), CX
RET
```

Highlights:
- The `nil` check is a single `TESTQ` on the type word (because both words are zero for nil).
- The success path has a predictable branch.
- No magic; no exception tables; no stack unwinding.

This is why `if err != nil` is *not* a performance concern in practice.

---

## Cross-Goroutine Error Propagation Costs

When errors cross goroutine boundaries (channels, `errgroup`, etc.), the cost is the cost of **sharing the value through a synchronization primitive**, not the cost of the error itself.

A channel send/receive of an `error` is the same as a channel send/receive of any 16-byte value. The error value's heap allocation already happened when it was created.

If you fan out N goroutines and all return an error, you have N allocations regardless. The collection pattern (channel, slice with mutex, errgroup) just decides *how* you collect them.

---

## Summary

At professional level, errors are runtime objects with measurable cost: 16-byte interface headers, heap-allocated dynamic values, GC participation, escape-analysis interactions. The standard library's idioms are designed so that the *common* path (no error) costs almost nothing, and the *error* path costs a controlled amount. Knowing exactly where the bytes live and the cycles go is the difference between "I think my service is fast" and "I know it is."

---

## Further Reading

- `$GOROOT/src/errors/errors.go` — read it.
- `$GOROOT/src/fmt/errors.go` — `Errorf` implementation.
- `$GOROOT/src/runtime/error.go` — runtime errors.
- [The Go Runtime: Goroutine and Stack Internals](https://go.dev/doc/articles/go_command.html)
- [Allocator and GC Tuning](https://go.dev/doc/gc-guide)
- `go build -gcflags='-m=2' ./...` — escape analysis output.
- `go tool objdump` — disassembly.
