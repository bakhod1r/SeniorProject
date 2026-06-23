# Go Variadic Functions — Professional / Internals Level

## 1. Overview

This document covers what the Go compiler does when it sees a variadic call site, the SSA representation of variadic functions, the calling convention's treatment of the implicit slice, escape analysis interactions, and the runtime cost decomposition for `...any` style functions like `fmt.Printf`. The goal is precise enough understanding to read profiles, predict allocations, and design libraries that scale to high call rates.

---

## 2. Compilation Pipeline for a Variadic Call

Source:
```go
func sum(xs ...int) int {
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}

s := sum(1, 2, 3)
```

```
Parser
    ↓
AST: FuncDecl{Name="sum", Params=[Field{Names=[xs], Type=...int}], ...}
     CallExpr{Fun=sum, Args=[1,2,3]}
    ↓
Type checker normalizes the call:
  CallExpr → represents implicit slice construction
    ↓
walk pass (cmd/compile/internal/walk) lowers variadic call:
  s := sum(1, 2, 3)
   becomes
  {
      var tmp = [3]int{1, 2, 3}
      s = sum(tmp[:])
  }
    ↓
SSA generation
    ↓
Register allocation
    ↓
Code generation
```

For the spread form `sum(s...)`, no implicit slice — the call is essentially `sum(s)`.

---

## 3. SSA Representation

For the call `sum(1, 2, 3)`, the SSA after walk includes (conceptually):

```
b1:
  v1 = SP
  v2 = OffPtr <*[3]int> [argsoffset] v1
  v3 = StaticAuto <*[3]int> {tmp}
  v4 = MovQ 1 → v3.0
  v5 = MovQ 2 → v3.1
  v6 = MovQ 3 → v3.2
  v7 = SliceHeader v3 [length=3] [cap=3]
  v8 = StaticCall {sum} v7
  Ret v8
```

The implicit array `tmp` is a stack-allocated frame slot (`StaticAuto`). The slice header is built from `tmp[0:3:3]` and passed as the single parameter to `sum`.

If escape analysis determines `tmp` escapes (e.g., `sum` stores `xs` in a global), `tmp` becomes a heap allocation: `v3 = NewArray *[3]int` instead of `StaticAuto`.

Inspect with:
```bash
GOSSAFUNC=main go build .
# Opens ssa.html
```

---

## 4. Calling Convention

A variadic function has the same calling convention as a non-variadic function with the same lowered signature. For `sum(xs ...int)`, the lowered signature is:

```
func sum([]int) int
```

The slice header is three words: pointer, length, capacity. In the register-based ABI on amd64:
- Pointer in AX
- Length in BX
- Capacity in CX
- Result in AX

So `sum([]int{1,2,3})` requires only register loads — no memory traffic for the parameter.

For larger variadic argument counts (>~16 args), the implicit array spans more stack/registers, but the *call* itself still passes only the slice header.

---

## 5. The Implicit Slice and Escape Analysis

The key compiler decision for every variadic call is where the **implicit array** (the storage backing the slice) lives.

**Rules (heuristic, not contract)**:
- If the slice does not escape `sum` → array is in the caller's stack frame.
- If the slice escapes (via global, channel, retained pointer) → array is heap-allocated.

The escape analyzer treats the implicit slice exactly like any explicit `[]int{...}` literal.

For `fmt.Printf(format, args...)`, the spread form passes the caller's slice directly — `Printf` does not get a fresh implicit slice. But `fmt.Printf("hi", 42)` builds an implicit `[]any{any(42)}` slice. Whether THAT slice escapes is a function-by-function decision.

In `fmt`, the slice is often retained briefly (passed through `pp.doPrintf`); the compiler may or may not prove it doesn't escape. Empirically, many simple `fmt.Println` calls do allocate the slice on the heap.

Verify:
```bash
go build -gcflags="-m=2" 2>&1 | grep -E "implicit|escapes"
```

---

## 6. The `...any` Boxing Pipeline

Boxing an `int` into `interface{}` (= `any`):

```
runtime.convT64(*type_int, &v)
  → returns runtime.eface{typ: *type_int, data: heap-alloced-int-or-static-pool-entry}
```

For values 0..255 (and a few negatives), `convT64` returns a pointer into `runtime.staticuint64s` — a pre-populated array, no allocation. For other ints, it allocates 8 bytes on the heap.

For `string`:
```
runtime.convTstring(s)  → returns eface{typ: *type_string, data: &s}
```
Strings are already pointer-and-length; the boxing copies the string header into a 16-byte heap region.

For `bool`:
```
runtime.convT(bool, ...) → uses staticTrue or staticFalse
```
No allocation.

For pointers:
```
i := &SomeStruct{}
any(i) → eface{typ: *SomeStruct, data: i}
```
Just a struct copy; no heap alloc beyond what already existed for the pointee.

So the per-arg cost depends sharply on type:

| Type | Boxing cost |
|------|-------------|
| `int` ∈ [0, 255] | 0 alloc (static pool) |
| `int` (other) | 1 alloc, 8 B |
| `int64`, `uint64` (other) | 1 alloc, 8 B |
| `string` | 1 alloc, 16 B (header) |
| `bool` | 0 alloc (static `staticTrue`/`staticFalse`) |
| `nil` | 0 alloc |
| pointer types (`*T`) | 0 alloc (pointer is already "a value") |
| small struct (≤ 8 B) | 1 alloc |
| larger struct | 1 alloc, full size |

For `Println(1, "hi", true)`:
- `1` (int 1): static pool → 0 alloc
- `"hi"` (string): convTstring → 1 alloc, 16 B
- `true` (bool): static → 0 alloc

Plus the implicit `[]any{...}` slice (24 B header + 48 B array = 72 B if heap).

---

## 7. The Variadic Slice in `fmt.Printf`

```go
func Printf(format string, a ...any) (n int, err error) {
    return Fprintf(os.Stdout, format, a...)
}
```

The slice `a` is just forwarded with `a...`. No new allocation in `Printf` itself. `Fprintf` similarly forwards. The actual slice was built at the original call site.

The expensive work in `fmt.Printf` is the per-arg formatting (reflection, type switches), not the variadic mechanism itself.

---

## 8. Variadic Spread of Function Values

When the variadic element type is a function type, each element is just a funcval pointer:

```go
type Step func() error

func runAll(steps ...Step) error {
    for _, s := range steps {
        if err := s(); err != nil {
            return err
        }
    }
    return nil
}
```

No boxing. Each `Step` is an 8-byte funcval pointer (or 16 bytes if it's a closure pointer + context). The implicit array packs them densely.

---

## 9. Inlining of Variadic Functions

The Go inliner can inline simple variadic functions, especially in Go 1.20+:

```go
//go:inline-friendly
func max3(a, b, c int) int { return max(a, max(b, c)) }

// Variadic version:
func max(xs ...int) int {
    if len(xs) == 0 { return 0 }
    m := xs[0]
    for _, x := range xs[1:] { if x > m { m = x } }
    return m
}
```

For a call `max(1, 2, 3)`, the inliner can:
- Inline `max` body.
- Constant-fold the slice access `xs[0]`, `xs[1]`, `xs[2]`.
- Eliminate the loop entirely.

Result: zero-cost call. Verify:
```bash
go build -gcflags="-m -m" 2>&1 | grep "inlining call to max"
```

---

## 10. Spread Form Implementation in Assembly

For `f(s...)`:

```asm
; Pass slice s via the register ABI on amd64
MOVQ s+0(FP), AX     ; slice pointer
MOVQ s+8(FP), BX     ; slice length
MOVQ s+16(FP), CX    ; slice capacity
CALL f(SB)
```

For the literal form `f(1, 2, 3)`:

```asm
; Build implicit array on caller's stack:
SUBQ $24, SP
MOVQ $1, 0(SP)
MOVQ $2, 8(SP)
MOVQ $3, 16(SP)
LEAQ 0(SP), AX       ; pointer
MOVQ $3, BX          ; length
MOVQ $3, CX          ; capacity (== length for implicit)
CALL f(SB)
ADDQ $24, SP
```

Inspect:
```bash
go build -gcflags="-S" 2>asm.txt | less
```

---

## 11. PGO Interactions

PGO (Profile-Guided Optimization, Go 1.21+) helps variadic call sites in two ways:

1. **More aggressive inlining**: hot variadic calls inline even if they're slightly above the standard cost budget.
2. **Devirtualization through interfaces**: when the variadic carries interface values that are dominantly one concrete type, calls through them get specialized.

Generate and use a profile:
```bash
# Capture
go test -cpuprofile=cpu.prof -bench=.
# Or in production:
import _ "net/http/pprof"

# Build with PGO
go build -pgo=cpu.prof .
```

---

## 12. Garbage Collection of Variadic Slices

The implicit slice (when on the heap) is a regular heap allocation tracked by Go's GC. The slice header on the stack is not GC-tracked separately — it's covered by the function's stack map. The backing array, if heap, has its own GC bits per element type.

For a million-args variadic call (don't do this, but conceptually):
- 1 slice header on the stack (24 B).
- 1 array on the heap (8 MB for `[]int64`).
- GC marks it once during the next cycle if it's still reachable.

For per-call ephemeral variadic slices, the slice and array are short-lived and may be reclaimed quickly by the GC's young-generation-like behavior in the bump allocator.

---

## 13. Variadic in the Runtime / Stdlib

The Go runtime uses variadic sparingly because of the boxing cost. Examples:

- `fmt.*` family — variadic of `any`.
- `errors.Join(errs ...error)` — variadic of `error` (interface, but cheap because errors are pointer-ish).
- `slices.Concat[S ~[]E, E any](slices ...S)` — generic variadic.
- `slog`'s structured API uses `slog.Attr` (struct), not `...any`.

The runtime itself (e.g., `runtime.gopanic`, `runtime.printany`) avoids variadic in hot paths.

---

## 14. Linker and Variadic

Variadic functions appear in the symbol table the same as non-variadic. The variadic-ness is part of the function type signature in DWARF debug info but not in the symbol name. There's no name-mangling for variadic vs non-variadic.

```bash
go tool nm myprog | grep main\.sum
# T   main.sum   <addr>
```

---

## 15. Microbenchmarking the Cost Components

```go
package main

import "testing"

func sumDirect(a, b, c int) int { return a + b + c }

func sumVariadic(xs ...int) int {
    s := 0
    for _, v := range xs {
        s += v
    }
    return s
}

func BenchmarkDirect(b *testing.B) {
    s := 0
    for i := 0; i < b.N; i++ {
        s += sumDirect(1, 2, 3)
    }
    _ = s
}

func BenchmarkVariadicLiteral(b *testing.B) {
    s := 0
    for i := 0; i < b.N; i++ {
        s += sumVariadic(1, 2, 3)
    }
    _ = s
}

func BenchmarkVariadicSpread(b *testing.B) {
    args := []int{1, 2, 3}
    s := 0
    for i := 0; i < b.N; i++ {
        s += sumVariadic(args...)
    }
    _ = s
}
```

Typical results (Go 1.22, amd64, M-class CPU):

```
BenchmarkDirect-8          1000000000   0.5 ns/op   0 B/op   0 allocs/op
BenchmarkVariadicLiteral-8  500000000   2.5 ns/op   0 B/op   0 allocs/op
BenchmarkVariadicSpread-8  1000000000   0.6 ns/op   0 B/op   0 allocs/op
```

The variadic-literal call is ~5× slower than direct because of the implicit array build. The spread form is essentially free. The literal form does NOT allocate (small slice, doesn't escape).

For `BenchmarkVariadicAny`, where the parameter is `...any`:

```
BenchmarkVariadicAny-8      30000000   45 ns/op   24 B/op   3 allocs/op
```

Large drop due to per-arg boxing.

---

## 16. The `...any` Cost in `fmt.Sprintf`

```go
package main

import (
    "fmt"
    "testing"
)

func BenchmarkSprintf(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = fmt.Sprintf("user %s scored %d", "ada", 42)
    }
}
```

Typical: ~150 ns/op, ~80 B/op, ~3 allocs/op. Breakdown:
- ~16 B for the implicit `[]any` slice.
- ~16 B for the boxed string.
- ~16 B for the boxed int (might use the static pool for 42 — it's <256, so possibly 0 alloc).
- ~32 B for the result string.

Profile shows time in `fmt.(*pp).doPrintf` and `fmt.(*pp).printArg` (reflection-driven).

---

## 17. Variadic and CGO

CGO function declarations cannot be variadic. If a C function is variadic (`int printf(const char *format, ...)`), Go cannot call it directly. The standard workaround is a wrapper:

```c
// shim.c
#include <stdio.h>
int print_int(const char *fmt, int v) { return printf(fmt, v); }
```

```go
// #include "shim.h"
import "C"

C.print_int(C.CString("%d\n"), 42)
```

The CGO call uses the C ABI (register-based on most platforms but different from Go's ABIInternal).

---

## 18. Variadic Reflection

Reflect-time:

```go
package main

import (
    "fmt"
    "reflect"
)

func sum(xs ...int) int {
    s := 0
    for _, x := range xs {
        s += x
    }
    return s
}

func main() {
    t := reflect.TypeOf(sum)
    fmt.Println(t.IsVariadic())                 // true
    fmt.Println(t.NumIn())                      // 1 — variadic counts as ONE in
    fmt.Println(t.In(0))                        // []int

    // Calling via reflection:
    v := reflect.ValueOf(sum)
    args := []reflect.Value{
        reflect.ValueOf(1),
        reflect.ValueOf(2),
        reflect.ValueOf(3),
    }
    out := v.Call(args)               // pass as separate args
    fmt.Println(out[0].Int())         // 6

    // Or as spread:
    sliceArg := []reflect.Value{reflect.ValueOf([]int{1, 2, 3})}
    out2 := v.CallSlice(sliceArg)     // pass the slice as the variadic
    fmt.Println(out2[0].Int())        // 6
}
```

`reflect.Value.Call` matches the literal form; `CallSlice` matches the spread form.

---

## 19. Variadic Lowering Pseudo-IR

For:
```go
fmt.Println("a", 1, true)
```

The compiler synthesizes:

```go
{
    _t0 := fmt.staticArgsBuf[:0:3]   // or new heap slice
    _t1 := any("a")
    _t2 := any(1)
    _t3 := any(true)
    _t0 = append(_t0, _t1, _t2, _t3) // or direct array fill
    _ = fmt.Println(_t0)
}
```

In practice the compiler uses a more direct form (no `append`) and lays out `_t0` as a stack array unless escape forces heap. The boxing of `1` and `true` may use `runtime.staticuint64s` and `staticTrue` — zero-alloc paths.

---

## 20. Reading the Go Source

The entire variadic call lowering lives in:

- `cmd/compile/internal/walk/walk.go` — calls `walkCall1` which handles variadic args.
- `cmd/compile/internal/walk/expr.go` — `walkCallVariadic` and friends.
- `cmd/compile/internal/types2/call.go` — type checking for variadic calls.

The runtime side:
- `runtime/iface.go` — interface boxing (`convT64`, `convTstring`, etc.).
- `runtime/panic.go` — `gopanic` is variadic-via-`any`.

Reading these confirms exactly when allocations happen.

---

## 21. Self-Assessment Checklist

- [ ] I can explain how the compiler lowers `f(1, 2, 3)` vs `f(s...)`
- [ ] I can predict whether the implicit slice escapes
- [ ] I know the per-type cost of `...any` boxing
- [ ] I know `staticuint64s` and `staticTrue` save allocs in `Printf`
- [ ] I can read SSA / asm to confirm the call shape
- [ ] I understand `reflect.Value.Call` vs `CallSlice`
- [ ] I know variadic functions cannot be called from CGO directly
- [ ] I can microbenchmark direct vs variadic vs spread vs `...any`
- [ ] I know `slices.Concat` and `errors.Join` patterns

---

## 22. References

- [Go Spec — Function types (variadic)](https://go.dev/ref/spec#Function_types)
- [`runtime.staticuint64s`](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/iface.go)
- [`fmt` package source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/fmt/print.go)
- [`slices.Concat`](https://pkg.go.dev/slices#Concat)
- [`errors.Join`](https://pkg.go.dev/errors#Join)
- [`reflect.Value.CallSlice`](https://pkg.go.dev/reflect#Value.CallSlice)
- 2.6.1 Functions Basics — register ABI, escape analysis
- 2.7.3 With Maps & Slices — slice header layout
