# Go Call by Value — Professional / Internals Level

## 1. Overview

This document covers the binary-level mechanics of argument passing in Go: the register-based ABI's parameter mapping, struct decomposition rules, slice/map/channel/interface header layouts, escape analysis interactions with pointer parameters, and the runtime implications of large-vs-small value passing.

---

## 2. The Register ABI (ABIInternal) on amd64

Since Go 1.17, the standard `gc` compiler uses a register-based calling convention internally:

| Purpose | Registers (amd64) |
|---------|-------------------|
| Integer/pointer args | AX, BX, CX, DI, SI, R8, R9, R10, R11 (9 total) |
| Floating-point args | X0-X14 (15 total) |
| Integer/pointer results | Same registers, AX first |
| Closure context | DX |
| Goroutine pointer | R14 |

Beyond 9 int args (or 15 float), values spill to the stack.

For arm64, the register set is similar but uses ARM64 registers.

---

## 3. Struct Decomposition

Structs are passed field-by-field through the register set:

```go
type Point struct{ X, Y int }
func use(p Point) { /* X in AX, Y in BX */ }
```

Compilation:
```asm
use:
    ; AX = X
    ; BX = Y
    ; ... use them ...
    RET
```

For larger structs, the compiler decides per-call based on the field types and total size. Rules of thumb:
- Up to ~64 B: usually decomposed.
- Beyond: spill to caller's outgoing args area on the stack.

Inspect:
```bash
go build -gcflags="-S" 2>asm.txt
grep -A 20 "TEXT main.use" asm.txt
```

---

## 4. Reference Type Headers

### 4.1 Slice

```go
type slice struct {
    array unsafe.Pointer
    len   int
    cap   int
}
```

24 B on 64-bit. Passed via 3 registers (AX = array, BX = len, CX = cap).

### 4.2 String

```go
type string struct {
    array unsafe.Pointer
    len   int
}
```

16 B. Passed via 2 registers.

### 4.3 Map

A map "value" is `*hmap` — a single pointer. 8 B, 1 register.

### 4.4 Channel

A channel "value" is `*hchan` — a single pointer. 8 B, 1 register.

### 4.5 Interface

```go
type iface struct {
    tab  *itab
    data unsafe.Pointer
}
```

16 B. Passed via 2 registers (AX = tab, BX = data).

### 4.6 Function Value

Funcval header is 1 word (code pointer), with optional capture struct accessed via DX (closure context register).

---

## 5. Calling Convention in Detail

For:
```go
type Point struct{ X, Y int }

func translate(p Point, dx, dy int) Point {
    return Point{X: p.X + dx, Y: p.Y + dy}
}

p := Point{1, 2}
q := translate(p, 10, 20)
```

Caller (amd64, schematic):
```asm
    MOVQ $1, AX        ; p.X
    MOVQ $2, BX        ; p.Y
    MOVQ $10, CX       ; dx
    MOVQ $20, DI       ; dy
    CALL translate(SB)
    ; AX = result.X
    ; BX = result.Y
    MOVQ AX, q+0(SP)
    MOVQ BX, q+8(SP)
```

Callee:
```asm
translate:
    ADDQ AX, CX        ; X + dx
    ADDQ BX, DI        ; Y + dy
    MOVQ CX, AX        ; result.X
    MOVQ DI, BX        ; result.Y
    RET
```

No memory traffic for the args; everything in registers.

---

## 6. Stack Spillover for Large Structs

For:
```go
type State struct{ Data [1<<10]byte } // 1 KB

func process(s State) {}
```

The compiler determines that 1 KB exceeds the register budget. It spills to the caller's outgoing-args area:

```asm
caller:
    SUBQ $1024, SP        ; reserve outgoing args
    MOVQ &s_local, RDX
    MOVQ $1024, RCX
    REP MOVSQ              ; memcpy s into outgoing area
    CALL process(SB)
    ADDQ $1024, SP

callee:
    ; access via SP-relative offsets
```

The 1 KB copy is the cost. For hot paths, prefer `*State`.

---

## 7. Escape Analysis With Pointer Parameters

A pointer parameter doesn't force the caller's variable to escape:

```go
func use(p *T) { /* read *p */ }

t := T{}
use(&t) // t stays on stack
```

But if `use` stores the pointer beyond its lifetime:
```go
var sink *T

func use(p *T) { sink = p }

t := T{}
use(&t) // t escapes to heap
```

Verify:
```bash
go build -gcflags="-m"
# moved to heap: t
```

---

## 8. Method Receiver Implementation

A method is just a function with an extra parameter (the receiver). Value-receiver:

```go
type T struct{ N int }
func (t T) M() {}
```

Lowered to:
```go
func T_M(t T) {}
```

`t.M()` lowers to `T_M(t)` — the receiver is copied like any value parameter.

Pointer-receiver:
```go
func (t *T) M() {}
```

Lowered to:
```go
func T_M(t *T) {}
```

`t.M()` (with t a value) lowers to `T_M(&t)` — taking the address.

---

## 9. Interface Boxing Cost

When a concrete value is assigned to an interface:

```go
var i any = T{}
```

The compiler emits something like:
```go
i = iface{
    tab: &itab_for_T_in_any,  // pre-computed type word
    data: <ptr to T or T inline>,
}
```

For value types:
- Small (≤ 1 word, e.g., int, bool, *T): may be stored inline in `data`.
- Larger: heap-allocated; `data` is the pointer.

For pointer types (*T):
- `data` IS the pointer; no allocation.

For numeric types in static pools (e.g., small ints), no allocation.

`runtime.convT64`, `runtime.convTstring`, etc., handle the boxing.

---

## 10. Slice/Map/Channel Operations Through Headers

Calling `len(s)` on a slice parameter loads `s.len` from the register holding it (or from stack spill). Essentially free.

`m[k]` on a map parameter calls into `runtime.mapaccess1`, passing the map handle (`*hmap`) and the key. The runtime accesses the hash table through that pointer.

`<-ch` on a channel parameter calls into `runtime.chanrecv`, passing the channel handle (`*hchan`).

Calling these through a parameter has the same cost as through a local — the parameter IS the same handle.

---

## 11. Function Value Calling

```go
func use(fn func(int) int, x int) int { return fn(x) }
```

The funcval is in a register. Calling through it:
```asm
    MOVQ funcval, DX        ; closure context register
    MOVQ (DX), CX           ; load code pointer
    MOVQ x, AX              ; argument
    CALL CX                 ; indirect call
```

Indirect call cost: ~3-5 cycles. Cannot be inlined unless devirtualized via PGO.

---

## 12. Cost Decomposition

For a typical function call:

| Component | Cost |
|-----------|------|
| Argument register loads | 1 cycle each |
| Stack spill (if needed) | memcpy-equivalent |
| Function call (direct) | 1-2 cycles |
| Function call (indirect) | 3-5 cycles |
| Result register loads | 1 cycle each |

For small types: total call overhead ~2-5 ns. Negligible for most code.

For huge struct passes: dominant cost is the memcpy.

---

## 13. Microbenchmarks

```go
package main

import "testing"

type Small struct{ X, Y int }
type Medium struct{ Data [16]int } // 128 B
type Large struct{ Data [256]int }  // 2 KB

func passSmallVal(s Small) Small      { s.X++; return s }
func passSmallPtr(s *Small) *Small    { s.X++; return s }
func passMediumVal(m Medium) Medium   { m.Data[0]++; return m }
func passMediumPtr(m *Medium) *Medium { m.Data[0]++; return m }
func passLargeVal(l Large) Large      { l.Data[0]++; return l }
func passLargePtr(l *Large) *Large    { l.Data[0]++; return l }

func BenchmarkSmallVal(b *testing.B) {
    s := Small{1, 2}
    for i := 0; i < b.N; i++ { s = passSmallVal(s) }
    _ = s
}
// ... similar for others
```

Typical results (Go 1.22, amd64):
- SmallVal: ~0.5 ns/op (register-passed, inlined)
- SmallPtr: ~1 ns/op (indirection)
- MediumVal: ~10 ns/op (stack memcpy)
- MediumPtr: ~1 ns/op
- LargeVal: ~150 ns/op (large memcpy)
- LargePtr: ~1 ns/op

For small types, value pass is faster (no indirection, fits in registers). For large types, pointer pass dominates.

---

## 14. Reading Generated Assembly

```bash
go build -gcflags="-S" -o /dev/null . 2>asm.txt
```

For a function `func f(a, b int)`:
- Look for the `f:` symbol.
- Verify args are in AX, BX (or wherever the ABI puts them).
- Check the body for further loads/stores.

For a function `func f(s []int)`:
- Args in AX (array ptr), BX (len), CX (cap).

For a function `func f(p *Big)`:
- Single arg in AX.

---

## 15. Inlining and Argument Passing

When a function is inlined, argument passing disappears entirely — the caller's values are used directly:

```go
func add(a, b int) int { return a + b }

c := add(1, 2)
// after inlining:
c := 1 + 2
// after constant folding:
c := 3
```

No register loads, no call. This is the best-case scenario.

For functions that don't inline (too large, indirect calls, etc.), the register-ABI cost applies.

---

## 16. Linker / Symbol Table

Function arguments and parameter types are encoded in DWARF debug info, used by debuggers. The symbol table itself only contains the function name.

```bash
go tool nm myprog | grep main.f
go tool objdump -s "main.f" myprog
```

---

## 17. Self-Assessment Checklist

- [ ] I can read assembly for argument register usage
- [ ] I understand struct decomposition rules
- [ ] I know the headers of slice/map/channel/interface/string
- [ ] I can predict when struct passes spill to the stack
- [ ] I understand the cost difference between value and pointer passes
- [ ] I know interface boxing rules
- [ ] I can microbenchmark argument-passing patterns
- [ ] I know when escape analysis matters for parameters

---

## 18. References

- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [`runtime.iface` source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/iface.go)
- [`runtime.hmap`](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/map.go)
- [`runtime.hchan`](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/chan.go)
- [Slice header (`reflect.SliceHeader`)](https://pkg.go.dev/reflect#SliceHeader)
- 2.6.1 Functions Basics
- 2.7 Pointers
