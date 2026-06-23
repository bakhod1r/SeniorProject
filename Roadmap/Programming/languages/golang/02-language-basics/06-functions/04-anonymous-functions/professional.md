# Go Anonymous Functions — Professional / Internals Level

## 1. Overview

This document covers the binary-level mechanics of function literals: how they are lowered into `closure` structs, the layout of capture environments, the calling convention's use of the closure context register, escape analysis interactions, the generated assembly for invocation, the impact on inlining and PGO, and the runtime mechanism for the Go 1.22 per-iteration loop variable change.

---

## 2. Compilation Pipeline

```
Source: f := func(x int) int { return x + y }   (y captured)
    ↓
AST: FuncLit{Type, Body}
    ↓
Type checking + name resolution (resolves captures)
    ↓
Closure conversion (cmd/compile/internal/walk):
    - Synthesize closure struct type containing captures.
    - Rewrite literal body to read captures via context register.
    - Insert allocation of closure struct (stack or heap).
    ↓
SSA construction
    ↓
Optimization passes:
    - Escape analysis decides closure struct location
    - Dead code elimination
    - Inlining (sometimes can inline literals)
    ↓
Code generation:
    - Synthesize body as a separate function symbol (named like main.func1)
    - Emit funcval + capture struct
    ↓
Linker
```

---

## 3. AST Representation

```go
func main() {
    y := 10
    f := func(x int) int {
        return x + y
    }
    _ = f
}
```

AST:
```
FuncDecl "main"
└── BlockStmt
    ├── AssignStmt y := 10
    ├── AssignStmt f := FuncLit{
    │   Type: FuncType { params: [x int], results: [int] }
    │   Body: BlockStmt {
    │       ReturnStmt { BinaryExpr "+" [x, y] }
    │   }
    │}
    └── ...
```

The `FuncLit` AST node represents the literal. Capture analysis runs over its body to identify free variables.

---

## 4. Closure Conversion

The compiler:

1. Identifies free variables (`y` in our example).
2. Creates a synthesized closure struct type:
   ```go
   type funcLitClosure struct {
       y *int // pointer to captured y
   }
   ```
3. Rewrites the literal body to dereference captures via the context register.
4. Inserts allocation of the closure struct (stack or heap based on escape).
5. Constructs a funcval:
   ```
   funcval {
       code: pointer to compiled body
   }
   ```
   followed contiguously by the closure struct fields.

The runtime accesses captures via DX (closure context register) on amd64.

---

## 5. SSA Representation

After closure conversion, the SSA looks like:

```
b1: (main)
    v1 = LocalAddr y           ; address of y on stack
    v2 = NewObject closure-type ; alloc closure struct
    v3 = Store v1 → v2.y       ; capture y by ref
    v4 = MakeFuncVal v2 (& main.func1)  ; create funcval
    v5 = LocalAddr f
    v6 = Store v4 → v5
    ...

b2: (main.func1, the literal body)
    ; DX = closure struct address
    v10 = LoadField DX.y       ; load &y
    v11 = Load v10              ; load *y
    v12 = Add x v11
    Ret v12
```

The funcval's body lives at a separate symbol; the funcval merely points to it, plus carries captures.

---

## 6. Closure Layout in Memory

For `func() { use(x, y) }` capturing `x int` and `y *T`:

```
Heap (or stack) layout:

  funcval header:
    [code: ptr to body]

  closure struct (immediately after, or pointed to by funcval depending on impl):
    [x: int]
    [y: *T]
```

The exact layout is an implementation detail. Modern Go uses an indirection: funcval has a single code pointer, and DX points to the closure struct on call.

---

## 7. Calling Convention for Closures

Caller:
```asm
; Set up args in regular ABI registers (AX, BX, ...).
; Set DX = closure struct pointer.
MOVQ closure_ptr, DX
MOVQ AX, x_value      ; x argument

; Indirect call via the funcval's code pointer:
MOVQ (DX), AX         ; (or wherever the code ptr is)
CALL AX
```

Inside the closure body:
```asm
; Standard prologue
; To access capture y:
MOVQ y_offset(DX), R8  ; R8 = ptr to captured y
MOVQ (R8), R8           ; R8 = *y
```

The DX register is reserved by Go's ABI for this purpose. CGO and assembly stubs must preserve it.

---

## 8. Escape Analysis for Closures

```bash
go build -gcflags="-m=2" 2>&1 | grep "func literal"
```

Common patterns:

```go
// Stays on stack
func A() {
    x := 1
    f := func() int { return x }
    _ = f()
}
// "func literal does not escape"

// Escapes to heap
func B() func() int {
    x := 1
    return func() int { return x }
}
// "moved to heap: x"
// "func literal escapes to heap"
```

If a closure escapes, BOTH the funcval struct AND any captured variables that were stack-locals are promoted to the heap.

---

## 9. Inlining of Function Literals

The Go inliner can inline literals when:
- The literal body is small (≤ inlining cost budget).
- The literal is called directly from a known site.
- The literal doesn't have captures that complicate the analysis.

```go
inc := func(x int) int { return x + 1 }
y := inc(5) // inliner may rewrite to: y := 5 + 1
```

Verify:
```bash
go build -gcflags="-m -m" 2>&1 | grep -i "inline"
```

For literals stored in function-typed variables and called indirectly, inlining typically fails (the compiler can't see the body at the call site).

---

## 10. The Go 1.22 Loop Variable Change

Pre-1.22, the loop variable was shared across iterations (one stack slot reused). Closures captured a pointer to this single slot.

Go 1.22+ creates a fresh stack slot per iteration. Each closure captures its own copy.

Implementation:
- The compiler synthesizes a per-iteration variable in the for-statement's body block.
- For `for i := 0; ...; i++`, the loop transforms (conceptually) to:
  ```go
  for outerI := 0; outerI < N; outerI++ {
      i := outerI // fresh variable per iteration
      // body uses i
  }
  ```
- The pre-1.22 behavior is retained for modules with `go 1.21` or earlier in `go.mod`.

This change is gated by the `go` directive — different files in a module may compile with the same semantics, but two modules can interleave.

---

## 11. Method Value vs Method Expression at the Binary Level

Source:
```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }
```

```go
c := &Counter{}
m := c.Inc
m()
```

Compiled:
- `m := c.Inc` allocates a funcval that captures `c` (the *Counter pointer).
- `m()` is an indirect call through the funcval, which loads `c` from the capture and invokes `Inc`.

```go
m := (*Counter).Inc
m(c)
```

Compiled:
- `m := (*Counter).Inc` produces a direct funcval for `Inc` (no capture).
- `m(c)` is an indirect call but with `c` passed as a regular argument — no allocation.

Method expressions avoid the capture allocation entirely.

---

## 12. PGO and Closures

PGO can:
- Devirtualize hot indirect calls through funcvals when one body dominates.
- Inline more aggressively across function boundaries.

For a closure that's the dominant target of an indirect call site:
```bash
go build -pgo=cpu.prof .
```

The compiler may rewrite:
```go
fn := getCallback() // dominantly returns f1 in production
fn(x)
```
into:
```go
fn := getCallback()
if fn == &f1 {
    f1(x) // inlined
} else {
    fn(x) // fallback indirect
}
```

Enabling 1.5-2× speedups for hot indirect-call sites.

---

## 13. Garbage Collection Touchpoints

A closure value contains:
- A code pointer (not a GC root — code is in the binary).
- Captured variables, some of which may be pointers.

The GC scans the closure struct's pointer-typed fields as roots. Capturing many pointers means more GC work.

For long-lived closures:
- Released captures (set to nil before exit) become collectable.
- The closure struct itself stays alive as long as referenced.

---

## 14. Cost Decomposition

Per closure value:

| Component | Cost |
|-----------|------|
| Code pointer (constant) | 0 (compile-time) |
| Funcval struct allocation | 0 if non-escaping, 1 small alloc otherwise |
| Capture struct | 0 if non-escaping, 1 alloc otherwise |
| Each capture field copy | trivial |
| Indirect call at invocation | 3-5 cycles vs 1-2 for direct |
| Inlining | usually disabled for indirect calls |

For non-capturing literals, the cost is essentially zero — the funcval is a static global.

---

## 15. Microbenchmark

```go
package main

import "testing"

func direct(x int) int { return x + 1 }

func BenchmarkDirect(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = direct(i)
    }
}

func BenchmarkLiteralVar(b *testing.B) {
    f := func(x int) int { return x + 1 }
    for i := 0; i < b.N; i++ {
        _ = f(i)
    }
}

func BenchmarkLiteralCapturing(b *testing.B) {
    delta := 1
    f := func(x int) int { return x + delta }
    for i := 0; i < b.N; i++ {
        _ = f(i)
    }
}
```

Typical (Go 1.22, amd64):
- Direct: 0.3 ns/op (inlined to constant)
- LiteralVar: 1.5 ns/op (not inlined; indirect call)
- LiteralCapturing: 1.6 ns/op (one extra load for delta)

For most application code, this difference is negligible. For hot inner loops in numerical code, prefer direct calls.

---

## 16. Reading Generated Assembly

```bash
go build -gcflags="-S" main.go 2>asm.txt
grep -A 20 "main.main.func1" asm.txt
```

Look for:
- `main.main.func1` — the synthesized symbol for the literal.
- `MOVQ ..., DX` setup before the call.
- Loads through DX inside the body.

---

## 17. Linkname and Anonymous Functions

You cannot apply `//go:linkname` to an anonymous function (no name to reference). But you can:
- Apply it to the named container function.
- Apply it to a method whose receiver is in another package.

For inspection of literals in compiled binaries:
```bash
go tool nm myprog | grep "func[0-9]"
# main.main.func1   T   <addr>
# main.main.func2   T   <addr>
```

The `funcN` numbering is per-enclosing-function, not unique across the binary.

---

## 18. Closure Captures and Stack Maps

The compiler emits a stack map for the closure struct, telling the GC which fields are pointers. This is what allows the GC to walk closure captures correctly during a collection.

For closures with mostly non-pointer captures (ints, bools), GC overhead is minimal. For closures capturing many pointers (or large structs containing pointers), each closure adds GC roots.

---

## 19. Self-Assessment Checklist

- [ ] I can read assembly for a function literal call
- [ ] I understand DX is the closure context register on amd64
- [ ] I can predict closure escape behavior
- [ ] I know when literals can be inlined
- [ ] I can use PGO to optimize hot indirect calls
- [ ] I understand the Go 1.22 loop-variable change at the implementation level
- [ ] I can microbenchmark direct vs literal calls
- [ ] I know the cost decomposition of closure invocation
- [ ] I can identify closure captures contributing to GC pressure

---

## 20. References

- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [`runtime.funcval` source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/funcdata.go)
- [Closure conversion in cmd/compile](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/cmd/compile/internal/walk/closure.go)
- [Go 1.22 loopvar release notes](https://go.dev/doc/go1.22)
- [PGO documentation](https://go.dev/doc/pgo)
- 2.6.1 Functions Basics
- 2.6.5 Closures
