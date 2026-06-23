# Go Named Return Values — Professional / Internals Level

## 1. Overview

This document covers what named returns become at the binary level: the SSA representation, the calling convention's treatment of named-result slots, the open-coded defer interaction with named result mutation, the runtime's handling of recover via deferred named-result modification, and the compiler optimizations specific to named-return patterns.

---

## 2. Compilation Pipeline

Named returns are syntactic sugar for unnamed results plus implicit local variable declarations. The compiler:

1. Treats each named result as an implicit `var` declaration at function entry.
2. Initializes each to its type's zero value.
3. Translates `return expr1, expr2` into "assign to result vars, then return".
4. Translates naked `return` into "return current values of result vars".
5. Treats result variables like any other local for SSA purposes.

For type-checking, the result names are added to the function's local symbol table.

---

## 3. SSA Representation

Source:
```go
func split(sum int) (x, y int) {
    x = sum * 4 / 9
    y = sum - x
    return
}
```

SSA (conceptual):
```
b1: (entry)
    v1 = Arg <int> {sum}
    v2 = LocalAddr <*int> {x_result}
    v3 = LocalAddr <*int> {y_result}
    v4 = Const <int> 0
    v5 = Store v4 → v2     ; x = 0 (zero-init)
    v6 = Store v4 → v3     ; y = 0
    
    v7 = Mul64 v1 4
    v8 = Div64 v7 9
    v9 = Store v8 → v2     ; x = sum * 4 / 9
    
    v10 = Load v2          ; load x
    v11 = Sub64 v1 v10
    v12 = Store v11 → v3   ; y = sum - x
    
    v13 = Load v2          ; load x for return
    v14 = Load v3          ; load y for return
    Ret v13 v14            ; return (x, y)
```

The result variables are stack-allocated locations that the function reads/writes throughout, with a final load before `Ret`.

---

## 4. Calling Convention

Named results live in standard result registers (AX, BX, CX, ...) when small enough. For functions with multiple result registers, each named slot maps to one register.

For our `split` example on amd64:
- `x` → AX (final return value)
- `y` → BX

Compiled (rough):
```asm
split:
    MOVQ DX, R8       ; sum (input register varies)
    IMULQ $4, R8       ; sum * 4
    MOVQ R8, AX        ; quotient/remainder via division
    XORL DX, DX
    MOVQ $9, CX
    IDIVQ CX           ; AX = sum*4/9, DX = remainder
    MOVQ R8_input, BX   ; sum
    SUBQ AX, BX        ; y = sum - x
    RET
```

(Schematic; actual code depends on inlining, regalloc, etc.)

The register slots for results ARE the named results' "storage" inside the function.

---

## 5. Spilling Named Results

If the function has more results than fit in registers (>9 ints), the spillover lives in the caller's stack frame. The named result variables are then heap-or-stack locals that get copied to/from the spill area on entry/exit.

In practice, functions with > 4-5 results are rare; this case is uncommon.

---

## 6. Open-Coded Defer + Named Results

For functions with ≤ 8 defers and no defer in a loop, the compiler emits open-coded defers: each return path includes the deferred function bodies inlined.

For named results, the inlined defer body sees the named result as a normal local variable. Mutations are direct memory writes:

```go
func op() (err error) {
    defer func() {
        if cerr := close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    return nil
}
```

Compiled:
```asm
; ... body ...
MOVL $0, err_data       ; return nil sets err = nil (data slot)
MOVL $0, err_itab       ; (itab slot)
; --- inlined defer ---
CALL close
TESTQ AX, AX            ; close result
JNZ skip                ; if cerr is nil, skip
TESTQ err_itab, err_itab ; check err == nil
JNZ skip                ; if err is non-nil, skip
MOVQ AX, err_itab       ; err = cerr
MOVQ BX, err_data
skip:
RET
```

(Schematic.) The defer "modifies" the named result by writing to its register/stack slot before `RET`.

---

## 7. Defer + Recover

When a deferred function uses `recover` to catch a panic, the runtime:

1. Detects the panic during stack unwinding.
2. Calls each deferred function in LIFO order.
3. If a deferred function returns without re-panicking, the panic is absorbed; the function returns normally.

For panic-to-error conversion:
```go
func safe() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    risky()
    return nil
}
```

Open-coded defer + panic uses a slightly slower path:
- The runtime walks `funcdata` to find the deferred logic.
- Executes the deferred code in panic-handling mode.
- The named result modifications happen via the same memory locations.

The cost in the no-panic case is unchanged (open-coded fast path); the panic case is slower but rare.

---

## 8. Inlining of Functions With Named Returns

The inliner handles named returns normally. For:
```go
func half(n int) (result int) { result = n / 2; return }
```

Inline expansion at a call site:
```go
r := half(10)
// becomes:
{
    var result int = 0
    result = 10 / 2
    r = result
}
```

After dead-code elimination:
```go
r := 5
```

The named-return decoration disappears entirely after optimization.

---

## 9. Escape Analysis With Named Returns

A named result's address can be taken; if it escapes, the result moves to the heap:

```go
var sink *int

func f() (n int) {
    sink = &n // n escapes to heap
    n = 42
    return
}
```

Verify:
```bash
go build -gcflags="-m"
# moved to heap: n
```

For most code, named results don't escape — they're just register/stack values.

---

## 10. Closure Capture of Named Results

A closure inside the function can capture the named result:

```go
func f() (n int) {
    helper := func() { n++ }
    helper()
    helper()
    return // returns 2
}
```

The closure captures `n` by reference. If the closure escapes, `n` moves to the heap.

For non-escaping closures, the compiler keeps `n` on the stack and the closure accesses it via the closure context register.

---

## 11. Defer Mechanics In Detail

Three defer implementations, all preserve named-result semantics:

**Open-coded (Go 1.14+, fast path)**:
- Used when ≤ 8 defers, no loop-defer.
- Each return path inlines the deferred body.
- Modifications to named results are direct memory writes.

**Stack-allocated defer (Go 1.13)**:
- Used when > 8 defers or for some patterns the open-coded path can't handle.
- The `_defer` record on the stack contains a pointer to the deferred closure.
- The closure captures any named result references.
- `runtime.deferreturn` walks the `_defer` chain at exit.

**Heap-allocated defer (Go ≤ 1.13 or in loops)**:
- Used when defer is inside a loop.
- Same chain mechanism but `_defer` records on the heap.

For named-result modifications, all three paths work the same way: the closure reads/writes the named result via captured reference.

---

## 12. Generic Functions With Named Returns

Generics work normally with named returns:

```go
func Zero[T any]() (v T) {
    return // returns zero of T
}
```

The compiler instantiates a separate function per type instantiation. Each has the appropriate zero-init of `v`. No special handling needed.

---

## 13. Cost Comparison

Per call:

| Pattern | Cost |
|---------|------|
| Unnamed result | Set result reg, RET |
| Named result, naked return | Same as unnamed (sugar) |
| Named result + defer (no panic, open-coded) | Same + a few inline instructions for defer body |
| Named result + defer + recover (no panic) | Slightly slower (recover check) |
| Named result + defer + recover (panic) | Significantly slower (unwind path) |

For the no-panic case, open-coded defer makes named-return + defer essentially free.

---

## 14. Microbenchmark

```go
package main

import "testing"

func unnamed() (int, error) { return 42, nil }
func named() (n int, err error) { n = 42; return }
func namedDefer() (n int, err error) {
    defer func() { /* no-op */ }()
    n = 42
    return
}
func namedDeferMod() (n int, err error) {
    defer func() { n++ }()
    return 42, nil
}

func BenchmarkUnnamed(b *testing.B) {
    for i := 0; i < b.N; i++ {
        n, _ := unnamed()
        _ = n
    }
}

func BenchmarkNamed(b *testing.B) {
    for i := 0; i < b.N; i++ {
        n, _ := named()
        _ = n
    }
}

func BenchmarkNamedDefer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        n, _ := namedDefer()
        _ = n
    }
}

func BenchmarkNamedDeferMod(b *testing.B) {
    for i := 0; i < b.N; i++ {
        n, _ := namedDeferMod()
        _ = n
    }
}
```

Typical (Go 1.22, amd64):
- Unnamed: 0.5 ns/op (inlined to constant)
- Named: 0.5 ns/op
- NamedDefer: 1-2 ns/op (open-coded defer cost)
- NamedDeferMod: 1.5-2 ns/op

The defer cost is the open-coded inline expansion; modification is just an extra increment.

---

## 15. Reading Generated Assembly

```bash
go build -gcflags="-S" main.go 2>asm.txt
```

For named results, look for:
- Initialization of result registers/locations to zero.
- Direct writes to result registers throughout the body.
- `RET` after final write.

---

## 16. Defer Mode Inspection

```bash
go build -gcflags="-d=defer=2" 2>&1 | grep "defer"
# main.op: open-coded defers
# main.loop: stack-allocated defers
```

Identifies which defer mode each function uses.

---

## 17. Panic-Recover Path Analysis

When a panic occurs:
1. `runtime.gopanic` walks the goroutine's defer list.
2. For open-coded defers, it consults `funcdata` to know which defers exist.
3. For each defer, executes the inlined logic in panic-mode.
4. If `recover()` returns non-nil, the panic is absorbed.
5. The function returns normally with whatever named results were set.

Cost in the panic path:
- Walking the defer list / funcdata.
- Executing each defer body.
- For open-coded, a slightly slower interpreter path.

But: panic should be exceptional. Normal returns hit the fast open-coded path.

---

## 18. Runtime/`runtime.deferproc` and Friends

For the non-open-coded path:
- `runtime.deferproc` creates a `_defer` record (stack or heap) and adds to `g._defer`.
- `runtime.deferreturn` runs at function exit, walks `g._defer`, calls each deferred function.

For named-return modification:
- The deferred closure captures the named result by reference.
- Modifications happen via that capture.

Both work, but open-coded is much faster.

---

## 19. Self-Assessment Checklist

- [ ] I can read the SSA for a function with named returns
- [ ] I understand the calling convention's treatment of named results
- [ ] I know how open-coded defer interacts with named-result modification
- [ ] I understand the panic-recover flow with named results
- [ ] I can verify defer mode with compiler flags
- [ ] I can microbenchmark named-return patterns
- [ ] I know when named results escape to heap

---

## 20. References

- [Open-coded defers proposal](https://github.com/golang/proposal/blob/master/design/34481-opencoded-defers.md)
- [Go Internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [`runtime.gopanic` source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/panic.go)
- [`runtime.deferproc` source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/runtime2.go)
- 2.6.3 Multiple Return Values
- 2.6.1 Functions Basics
