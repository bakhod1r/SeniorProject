# errors.New — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Source: `errors.go`](#the-source-errorsgo)
3. [Memory Layout of `*errorString`](#memory-layout-of-errorstring)
4. [The Allocation: When and Where](#the-allocation-when-and-where)
5. [Escape Analysis](#escape-analysis)
6. [Inlining and the Compiler](#inlining-and-the-compiler)
7. [Sentinel Allocation at Init](#sentinel-allocation-at-init)
8. [Comparing Errors at Machine-Code Level](#comparing-errors-at-machine-code-level)
9. [`errors.New` vs `fmt.Errorf`: Allocation Profile](#errorsnew-vs-fmterrorf-allocation-profile)
10. [Garbage Collector Interactions](#garbage-collector-interactions)
11. [Benchmarks: Real Numbers](#benchmarks-real-numbers)
12. [Disassembly Walkthrough](#disassembly-walkthrough)
13. [Cache Behavior of Sentinels](#cache-behavior-of-sentinels)
14. [Cross-Goroutine Use](#cross-goroutine-use)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level, `errors.New` stops being an API and becomes a runtime artifact: a pointer in a return slot, a heap object with a known size class, a method dispatched through an itab. You read the assembly, you measure with `pprof`, you predict the GC implications.

This file is about `errors.New` at the level of bits, bytes, and CPU cycles.

---

## The Source: `errors.go`

The Go 1.21 implementation of `errors.New` is exactly five lines (excluding the doc comment). From `$GOROOT/src/errors/errors.go`:

```go
// New returns an error that formats as the given text.
// Each call to New returns a distinct error value even if the text is identical.
func New(text string) error {
    return &errorString{text}
}

// errorString is a trivial implementation of error.
type errorString struct {
    s string
}

func (e *errorString) Error() string {
    return e.s
}
```

That is the whole thing. The doc comment includes the critical guarantee: *each call returns a distinct error value*. That is not an implementation detail — it is a documented property other code relies on.

The package has zero external dependencies. It ships with the runtime; everything else (`Is`, `As`, `Unwrap`, `Join`) is layered on top of this minimal core.

---

## Memory Layout of `*errorString`

The struct itself:

```go
type errorString struct {
    s string  // 16 bytes on 64-bit (data pointer + length)
}
```

A `string` header on 64-bit is two words: an 8-byte pointer to UTF-8 bytes and an 8-byte length. So `errorString` itself is **16 bytes**.

A pointer-to-`errorString` is **8 bytes**. The `error` interface returned by `New` is **16 bytes** (itab pointer + data pointer).

```
returned error (interface, 16 B):
+--------+--------+
|  itab  |  data  |
+--------+--------+
   |         |
   |         v
   |     +-----------+
   |     | errorString (16 B) on heap |
   |     | s.ptr  s.len               |
   |     +-----------+
   v
+---------------------------+
| itab for *errorString     |
| - type: *errorString      |
| - method: Error() string  |
+---------------------------+
```

The itab is allocated once, on first conversion of `*errorString` to `error`. After that all instances share it.

Total per call:
- **16 bytes** for the `errorString` struct on the heap (size class 16 in Go's allocator).
- The string bytes — *no* extra allocation if the input string is a compile-time constant or already heap-resident; just a pointer copy.

---

## The Allocation: When and Where

`&errorString{text}` always escapes. The compiler cannot prove the pointer does not survive the call — the function returns an interface containing it, and interface conversion is treated as an escape sink.

You can verify with `-gcflags=-m`:

```
$ go build -gcflags=-m
./main.go:5:9: &errorString literal escapes to heap
```

The allocation goes through `runtime.newobject`, which selects the size-class-16 mcache. On modern Go, this is a few-instruction fast path (~10 ns) when the cache has free slots.

If the call happens in a hot loop and the cache is empty, you fall into the slower mcentral path or even mheap. That is when `errors.New` per-call becomes painful.

---

## Escape Analysis

Even though `errors.New` itself is tiny, the address-of-literal pattern is unconditionally escaping:

```go
func New(text string) error {
    return &errorString{text}  // & + return -> escapes
}
```

Why can't the compiler stack-allocate? Two reasons:

1. The returned `error` interface stores a pointer. If the receiver of `New` stores the error in a heap structure (a slice, a map, an interface field), the pointer must outlive `New`'s frame. The compiler is conservative.
2. Cross-package inlining is limited. Even when `errors.New` is inlined into the caller, the `&errorString{}` still escapes if the *caller* does anything that escapes, which most callers do.

You can in principle write:

```go
es := errorString{s: "static"}
return &es
```

But the result is the same: the address is taken, the interface conversion observes the pointer, escape.

The only way to avoid the allocation is to declare the value once at package scope. Then the allocation happens during package init, not per call.

---

## Inlining and the Compiler

`errors.New` is small enough to be inlined. As of Go 1.21, the compiler's inliner happily flattens it into the caller. The resulting code at the call site is morally equivalent to:

```go
return error(&errorString{"static"})
```

That is one allocation, one interface conversion, one return. Roughly six machine instructions on amd64.

The `Error` method on `*errorString` is also inlined:

```go
func (e *errorString) Error() string { return e.s }
```

This is a struct-field load: one MOV instruction in assembly. The cost of calling `err.Error()` is therefore an interface dispatch (an indirect call through the itab) followed by a single memory load.

---

## Sentinel Allocation at Init

A package-level `var ErrFoo = errors.New("foo")` triggers the allocation at package initialization, before `main` runs:

```go
package mypkg

var ErrFoo = errors.New("foo") // allocated during init
```

Cost:
- **One** `*errorString` allocation, one-time.
- **One** itab construction (or reuse of existing).
- The pointer is then a constant for the rest of the program.

Returning `ErrFoo` from a function does **zero** allocations:

```go
func bad() error  { return errors.New("foo") } // allocates per call
func good() error { return ErrFoo }            // zero allocations
```

This is the single most impactful optimization in error-heavy code paths.

---

## Comparing Errors at Machine-Code Level

`err == ErrFoo` compiles to two pointer comparisons:

```
MOV    err+0(SP), R1    ; load itab word
MOV    err+8(SP), R2    ; load data word
CMP    R1, ErrFoo+0     ; compare itabs
JNE    notequal
CMP    R2, ErrFoo+8     ; compare data
JE     equal
notequal:
```

Total: ~4 cycles on a modern CPU. There is no method call, no string compare. This is why sentinel-based error matching is essentially free.

`errors.Is(err, ErrFoo)`, by contrast, walks the error chain via `Unwrap()`:

```go
func Is(err, target error) bool {
    for {
        if isComparable && err == target {
            return true
        }
        if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
            return true
        }
        switch x := err.(type) {
        case interface{ Unwrap() error }:
            err = x.Unwrap()
        case interface{ Unwrap() []error }:
            // multi-error case
        }
        if err == nil {
            return false
        }
    }
}
```

For an unwrapped sentinel match, `errors.Is` is dominated by the first branch — a comparable pointer compare, then return. A few extra instructions for the type assertions and loop check, but still under 10 ns.

For deeply wrapped errors, `errors.Is` walks the chain, so cost grows linearly with chain depth. Typical real-world chains are 2–4 deep. Negligible.

---

## `errors.New` vs `fmt.Errorf`: Allocation Profile

Same-message error, two constructors:

```go
errors.New("not found")
fmt.Errorf("not found")
```

`errors.New`:
- **1 allocation** (`*errorString`).
- Total bytes allocated: ~16.
- Time: ~30 ns/op.

`fmt.Errorf` without `%w`:
- **2 or 3 allocations** (an internal buffer, an `*fmt.fmtError` analog, possibly a string copy).
- Total bytes allocated: ~80–96.
- Time: ~200 ns/op.

`fmt.Errorf` with `%w`:
- **2–4 allocations** including the `*fmt.wrapError` struct.
- Total bytes: ~96+.
- Time: ~300 ns/op (depends on argument count).

When the message is static and there is no wrapping, `errors.New` is significantly cheaper. When you need formatting or wrapping, `fmt.Errorf` is the correct choice and the extra allocations are the price of the feature.

---

## Garbage Collector Interactions

Each `errors.New` allocation is a small heap object (16 bytes). Implications:

1. **Size class**: it lands in the 16-byte size class. Size-class-16 mcaches are abundant; allocation is fast.
2. **GC pressure**: per-call `errors.New` in a hot loop produces millions of tiny garbage objects, growing the live set during a GC cycle and increasing scan time.
3. **Generational behavior**: Go's GC is non-generational, so short-lived `*errorString` values do not get a "cheap death." They are scanned just like any other heap object until they are unreachable.
4. **Pointer-in-pointer**: an `errorString` contains a string header. The string's data pointer is also followed by the GC. If the string is a constant in the binary's read-only data section, that follow-up is essentially free.

Sentinels avoid all of this. The single allocation at init survives forever; the GC scans it once per cycle but never collects it.

---

## Benchmarks: Real Numbers

A representative benchmark (Go 1.21, amd64, modern Xeon):

```go
package errnew_bench

import (
    "errors"
    "fmt"
    "testing"
)

var ErrSentinel = errors.New("sentinel")

func BenchmarkPerCall(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = errors.New("inline")
    }
}

func BenchmarkSentinel(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = ErrSentinel
    }
}

func BenchmarkFmtErrorfStatic(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = fmt.Errorf("inline")
    }
}

func BenchmarkFmtErrorfWrap(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = fmt.Errorf("ctx: %w", ErrSentinel)
    }
}
```

Typical results:

```
BenchmarkPerCall          30 ns/op    16 B/op    1 allocs/op
BenchmarkSentinel        0.5 ns/op     0 B/op    0 allocs/op
BenchmarkFmtErrorfStatic 200 ns/op    80 B/op    2 allocs/op
BenchmarkFmtErrorfWrap   300 ns/op   112 B/op    3 allocs/op
```

The 60x gap between `BenchmarkPerCall` and `BenchmarkSentinel` is the optimization sentinels exist to enable.

---

## Disassembly Walkthrough

Compile a tiny program with `go tool compile -S`:

```go
package main

import "errors"

func makeErr() error {
    return errors.New("oops")
}
```

Annotated amd64 output (simplified):

```
makeErr:
    SUBQ    $24, SP                ; allocate stack
    MOVQ    BP, 16(SP)             ; save base pointer
    LEAQ    16(SP), BP

    LEAQ    type:errors.errorString(SB), AX  ; type info for newobject
    CALL    runtime.newobject(SB)            ; allocate 16-byte struct
    ; AX now holds *errorString

    LEAQ    "oops"(SB), CX                   ; address of constant string
    MOVQ    CX, (AX)                         ; store data pointer
    MOVQ    $4, 8(AX)                        ; store length

    LEAQ    go.itab.*errors.errorString,error(SB), CX
    MOVQ    CX, ret_itab+0(FP)               ; itab in return slot
    MOVQ    AX, ret_data+8(FP)               ; data in return slot

    MOVQ    16(SP), BP
    ADDQ    $24, SP
    RET
```

Six meaningful instructions plus calls. The expensive line is `CALL runtime.newobject` — that is the heap allocation. Everything else is pointer wrangling.

A sentinel return is even simpler:

```
makeErrSentinel:
    LEAQ    go.itab.*errors.errorString,error(SB), CX
    MOVQ    CX, ret_itab+0(FP)
    MOVQ    ErrSentinel(SB), AX
    MOVQ    AX, ret_data+8(FP)
    RET
```

Four MOVs and a return. No allocation, no call.

---

## Cache Behavior of Sentinels

A package-level sentinel lives in the data segment of the binary (well, the bss/heap, but allocated early). Its memory location is stable and tends to be hot if the sentinel is matched frequently.

If you have a small set of sentinels — say 5 — and they are matched in a single function, the relevant cache lines fit comfortably in L1. The matching becomes essentially free relative to the work the function is doing.

By contrast, ad-hoc `errors.New` allocations land wherever the heap allocator places them — anywhere. Cold cache lines, scattered access patterns. On a hot path this can show up as a measurable cycle hit beyond just the allocation cost.

This is a small but real reason sentinels are faster than they look on paper.

---

## Cross-Goroutine Use

Sentinels are immutable after their `s` field is set in the constructor. The constructor runs once, and the field is set before any other goroutine can observe the value (Go's package init is single-threaded with respect to package state).

After init, multiple goroutines can:
- Read the sentinel pointer (fine — it is a `var` reference).
- Compare it (fine — pointer compare).
- Call `Error()` on it (fine — string-field load).

There is no race. The Go memory model treats package-level variables initialized in `init()` as happens-before any goroutine that begins after init.

The **only** way to introduce a data race is to *reassign* the sentinel after init:

```go
var ErrFoo = errors.New("foo")

func dangerous() {
    ErrFoo = errors.New("rebranded") // RACE if other goroutines read ErrFoo
}
```

Don't do that. Treat sentinels as effectively `const`.

---

## Summary

`errors.New` is three lines of Go that compile to about a half-dozen machine instructions per call, plus one heap allocation. The cost is small per call but compounds in hot paths; the sentinel pattern reduces it to zero. At the bytes-and-cycles level, `errors.New` is the cheapest error constructor in the language; `fmt.Errorf` is several times slower because it parses a format string and may allocate intermediate buffers. Choose accordingly, profile when in doubt, and remember that the *real* cost is not in the constructor but in the cache and GC pressure of doing it a billion times.

---

## Further Reading

- Source: `$GOROOT/src/errors/errors.go`
- Source: `$GOROOT/src/runtime/malloc.go` (size classes)
- [The Go Memory Model](https://go.dev/ref/mem)
- [Compiler escape analysis docs](https://go.dev/doc/gc-guide)
- `go build -gcflags='-m=2'` to inspect escape decisions
- `go tool compile -S` to read the generated assembly
