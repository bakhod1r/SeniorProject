# Go Closures — Professional / Internals Level

## 1. Overview

This document covers what a closure becomes at the binary level: the compiler's closure conversion pass, the synthesized closure struct layout, the calling convention's use of the closure context register (DX on amd64), how escape analysis decides stack vs heap, the Go 1.22 loop-variable transformation in detail, and the runtime/GC mechanics that make capture-by-reference work.

---

## 2. Closure Conversion Pass

In `cmd/compile/internal/walk/closure.go`, the compiler performs closure conversion:

1. **Free variable analysis**: walk the literal body, identify variables defined outside but referenced inside.
2. **Synthesize closure struct type**:
   ```go
   type _closure_T struct {
       capture0 *T0  // pointer if shared mutable
       capture1 T1   // value if read-only/non-shared
       ...
   }
   ```
3. **Allocate closure struct**: stack if non-escaping, heap if escaping.
4. **Rewrite literal body**: replace free-variable references with loads/stores through the closure context register.
5. **Generate funcval**: a value of function type pointing to the compiled body, with the closure struct attached.

---

## 3. Closure Struct Layout

For:
```go
func make() (func() int, func()) {
    n := 0
    incr := func() { n++ }
    get := func() int { return n }
    return get, incr
}
```

The compiler:
- Creates a heap cell for `n` (because it's mutated and shared between two closures).
- Each closure struct has one pointer field: `n_ptr`.
- The funcval points to the compiled body and carries the closure struct.

Memory layout:
```
heap_cell_n: int (some offset)
incr_closure_struct: { n_ptr: &heap_cell_n }
get_closure_struct:  { n_ptr: &heap_cell_n }
incr_funcval: { code: incr_body, ctx: &incr_closure_struct }
get_funcval:  { code: get_body,  ctx: &get_closure_struct }
```

---

## 4. Calling Convention

Caller invokes:
```asm
MOVQ funcval, DX        ; DX = closure context register
MOVQ (DX), R8           ; load code pointer (first word of funcval)
CALL R8                 ; indirect call
```

Inside the closure body:
```asm
MOVQ n_ptr_offset(DX), R10   ; load &n
MOVQ (R10), R11               ; load n
INCQ R11
MOVQ R11, (R10)               ; store n+1
```

DX is reserved by the Go ABI as the "closure context register" on amd64. CGO and assembly stubs must preserve it.

---

## 5. Escape Analysis Details

The escape analyzer decides per-allocation:

1. If the closure is returned, sent on a channel, stored in a global, or captured by another escaping closure → **escapes**.
2. If the closure stays within its enclosing function's lifetime → **doesn't escape**.

When a closure escapes, all captured variables that were stack locals also escape (their addresses are taken via the closure).

```bash
go build -gcflags="-m=2"
```

Output:
```
./main.go:5: func literal escapes to heap
./main.go:4: moved to heap: n
```

The compiler emits one allocation for the closure struct + one (or more) for the captured cells.

---

## 6. SSA Representation

For:
```go
func make() func() int {
    n := 0
    return func() int {
        n++
        return n
    }
}
```

After closure conversion, the SSA looks like:

```
b1: (make)
    v1 = NewObject *int   ; alloc heap cell for n
    v2 = Store 0 → v1
    v3 = NewObject *closure-type ; alloc closure struct
    v4 = Store v1 → v3.n_ptr
    v5 = MakeFuncVal v3 (& make.func1)
    Ret v5

b2: (make.func1, the closure body)
    ; DX = closure struct addr
    v10 = LoadField DX.n_ptr   ; → &n_cell
    v11 = Load v10              ; → n value
    v12 = Add v11 1
    v13 = Store v12 → v10       ; n_cell = n + 1
    Ret v12
```

---

## 7. Stack-Allocated Closures

When the compiler proves the closure doesn't escape, the closure struct lives in the enclosing function's stack frame:

```go
func direct() int {
    n := 5
    f := func() int { return n }
    return f()
}
```

`f` doesn't escape. The closure struct (with capture of `n`) is on the stack. No heap allocation.

After inlining, `f()` may be reduced to `5` directly — the entire closure machinery disappears.

---

## 8. The Go 1.22 Loop Variable Transformation

In `cmd/compile/internal/walk/order.go` (and related), the compiler transforms:

```go
for i := 0; i < N; i++ {
    body using i
}
```

into (conceptually):

```go
{
    var outerI int
    for outerI = 0; outerI < N; outerI++ {
        i := outerI // fresh per iteration
        body
    }
}
```

When closures capture `i`, they capture the per-iteration `i` variable, not the outer `outerI`.

The optimizer eliminates the per-iteration alloc when no closure captures `i`. So:
- No-capture case: identical to pre-1.22 — single stack slot.
- Capture case: per-iteration heap cell.

This change is gated by the `go` directive in `go.mod`.

For `for ... range`, the same transformation applies to the range iteration variable.

---

## 9. Closure as Method-Like Object

A closure is functionally equivalent to a struct + method:

```go
// Closure
func makeCounter() func() int {
    n := 0
    return func() int { n++; return n }
}

// Struct+method
type Counter struct{ n int }
func (c *Counter) Next() int { c.n++; return c.n }
```

At the binary level:
- Closure: 2 allocations (closure struct + n cell), 1 method (the body).
- Struct: 1 allocation (Counter), 1 method (Next).

The struct version is slightly more allocation-friendly. For hot paths with single-method behavior, both are reasonable.

---

## 10. PGO and Closures

PGO (Go 1.21+) can devirtualize hot indirect calls through closures:

```go
fn := getCallback()
fn(x) // hot
```

If profiling shows `getCallback` returns the same closure most of the time, PGO can specialize the call site:

```go
if fn == knownClosure {
    knownClosure_inlined(x)
} else {
    fn(x)
}
```

Capture profile and rebuild:
```bash
go build -pgo=cpu.prof .
```

Wins are typically 5-20% on indirect-call-heavy code.

---

## 11. GC Interactions With Closures

The GC scans the closure struct's pointer-typed fields as roots. For a closure capturing many pointers:
- Each capture is a GC root through the closure struct.
- The closure struct itself is a GC-tracked allocation.

For a pool of long-lived closures capturing per-request data, total GC overhead scales with (closures × pointer-fields-per-closure).

To minimize GC pressure:
- Capture primitive values where possible.
- Group captures in a small struct.
- Drop closures promptly when done.

---

## 12. Cost Decomposition

Per closure value (escaping):

| Component | Cost |
|-----------|------|
| Closure struct allocation | 1 heap alloc, ~32-64 B |
| Captured cell allocation (per shared mutable capture) | 1 heap alloc per cell |
| Indirect call at invocation | ~3-5 cycles |
| Cannot inline at call site (without PGO devirt) | usually |

For non-escaping closures:
- Stack-allocated; near-zero overhead.

For non-capturing literals:
- Single shared funcval; essentially zero cost.

---

## 13. Microbenchmarks

```go
package main

import "testing"

func direct(x int) int { return x + 1 }

var globalDelta = 1
func nonCapturing(x int) int { return x + globalDelta }

func makeAdder(by int) func(int) int {
    return func(x int) int { return x + by }
}

func BenchmarkDirect(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = direct(i)
    }
}

func BenchmarkNonCapturing(b *testing.B) {
    f := func(x int) int { return x + 1 } // non-capturing
    for i := 0; i < b.N; i++ {
        _ = f(i)
    }
}

func BenchmarkCapturing(b *testing.B) {
    f := makeAdder(1) // captures by
    for i := 0; i < b.N; i++ {
        _ = f(i)
    }
}
```

Typical (Go 1.22, amd64):
- Direct: 0.3 ns/op (inlined).
- NonCapturing: 1.5 ns/op (indirect call, no allocation).
- Capturing: 1.6 ns/op (one extra load for `by`).

The differences are small. They become meaningful only in hot inner loops doing >100M calls/sec.

---

## 14. Closure-Heavy Code Profile

A typical closure-heavy program (e.g., functional combinators):
- Heap allocations: closure structs.
- GC time: scanning closure captures.
- CPU: indirect calls + loading captures.

Profile with:
```bash
go test -benchmem -bench=.
go test -cpuprofile=cpu.prof -bench=.
go tool pprof -alloc_space mem.prof
```

Identify hot allocation sites; consider hoisting closures or replacing with direct calls.

---

## 15. Reading Generated Assembly

```bash
go build -gcflags="-S" main.go 2>asm.txt
grep -A 30 "make.func1" asm.txt
```

Look for:
- `MOVQ closure, DX` setup.
- Loads through DX in the body.
- `CALL R8` (or similar) for indirect invocation.

---

## 16. Closure Struct in DWARF / Debug Info

The compiler emits debug info for closure structs (under synthesized type names) so debuggers can inspect captures. In `delve`:

```
(dlv) print closure_var
*main.make.func1.closure {
    n_ptr: *int 5
}
```

The synthesized type name reflects the enclosing function and literal index.

---

## 17. Closures and `runtime.SetFinalizer`

A finalizer is itself a closure (typically). It captures the object being finalized. The runtime calls the finalizer in a separate goroutine when the object is unreachable.

Be careful:
- The finalizer-closure must not strongly reference the object it's finalizing (it would prevent the GC from collecting it). The runtime detects this.
- The finalizer runs at unspecified time; don't rely on prompt execution.

---

## 18. Closure-Based Iterator (Go 1.23 Range Over Function)

Go 1.23 adds `for range f` over functions:

```go
func iter(stop int) func(yield func(int) bool) {
    return func(yield func(int) bool) {
        for i := 0; i < stop; i++ {
            if !yield(i) { return }
        }
    }
}

for v := range iter(5) {
    fmt.Println(v)
}
```

The `iter` function returns a closure that captures `stop`. The `for range` loop calls this closure with a `yield` callback.

This is the most prominent use of closures in modern Go.

---

## 19. Self-Assessment Checklist

- [ ] I can describe closure conversion at the IR level
- [ ] I can predict closure struct layout for a given literal
- [ ] I know when shared cells are heap-allocated
- [ ] I can read assembly for a closure call
- [ ] I understand the Go 1.22 loop-variable transformation
- [ ] I know GC implications of closure captures
- [ ] I can microbenchmark closure costs
- [ ] I can apply PGO to optimize indirect calls
- [ ] I understand closure-based iterators (Go 1.23)

---

## 20. References

- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [Closure conversion source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/cmd/compile/internal/walk/closure.go)
- [Go 1.22 loopvar release notes](https://go.dev/doc/go1.22)
- [Range over function proposal (Go 1.23)](https://github.com/golang/proposal/blob/master/design/56413-range-on-funcs.md)
- [PGO documentation](https://go.dev/doc/pgo)
- [`runtime.SetFinalizer`](https://pkg.go.dev/runtime#SetFinalizer)
- 2.6.4 Anonymous Functions
- 2.7.4 Memory Management
