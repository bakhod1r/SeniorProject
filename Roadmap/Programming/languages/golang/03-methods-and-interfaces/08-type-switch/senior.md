# Go Type Switch — Senior Level

## 1. Overview

Senior-level mastery of type switches means understanding how the compiler lowers `switch v := x.(type)` to runtime interface comparisons, how `iface`/`eface` headers are laid out, how the `*itab` cache speeds repeated checks, and how to read assembly to predict cost. It also means knowing the rare-but-important cases where a type switch interacts with generics, embedded interfaces, and method-set rules.

---

## 2. Interface Representation

### 2.1 `eface` — Empty Interface

A value of type `interface{}` (alias `any`) is two machine words:

```go
// runtime/runtime2.go (simplified)
type eface struct {
    _type *_type        // pointer to type descriptor
    data  unsafe.Pointer // pointer (or boxed value)
}
```

The `_type` field carries the dynamic type at runtime. A nil `eface` has both fields zero.

### 2.2 `iface` — Non-Empty Interface

A value of type `error`, `io.Reader`, etc.:

```go
type iface struct {
    tab  *itab           // interface table (type info + method ptrs)
    data unsafe.Pointer
}
```

The `itab` describes the (interface, concrete-type) pair plus the method dispatch table.

### 2.3 The `_type` Descriptor

```go
type _type struct {
    size       uintptr
    ptrdata    uintptr
    hash       uint32
    tflag      tflag
    align      uint8
    fieldAlign uint8
    kind       uint8
    equal      func(unsafe.Pointer, unsafe.Pointer) bool
    gcdata     *byte
    str        nameOff
    ptrToThis  typeOff
}
```

A type switch ultimately compares `_type` pointers (or the `_type` field of an `itab`).

---

## 3. How Type Switches Lower

### 3.1 The Source

```go
func describe(x any) string {
    switch v := x.(type) {
    case int:
        return strconv.Itoa(v)
    case string:
        return v
    case error:
        return v.Error()
    default:
        return "?"
    }
}
```

### 3.2 The Lowered Pseudocode

```
e := x as eface
if e._type == nil { goto default }            // nil case (not present here)
if e._type == &runtime.intType  { v_int := *(int*)e.data;  goto case_int }
if e._type == &runtime.stringType { v_str := *(string*)e.data; goto case_string }
itab := getitab(&errorInterface, e._type, true) // memoized lookup
if itab != nil { v_err := iface{itab, e.data}; goto case_error }
goto default
```

Concrete-type cases use direct `_type*` comparison. Interface-type cases use `getitab`, which:
1. Hashes `(interface_type, concrete_type)` to find or build an `itab`.
2. Caches the `itab` in a global hash table for next time.

### 3.3 `getitab` and the Cache

`runtime/iface.go` defines:

```go
var itabTable = &itabTableInit

func getitab(inter *interfacetype, typ *_type, canfail bool) *itab {
    if !typ.IsDirectIface() && /* etc */ {
        // ...
    }
    m := itabTable
    for h := atomic.Load(&m.entries[...]); ; {
        // Compare (inter, typ) pair; return cached *itab on hit
    }
    // Build itab on miss; insert; return.
}
```

Hits are constant-time pointer comparisons on a hash bucket. Misses incur a method-set check and itab construction (one-time cost per pair).

### 3.4 The Compiled Branch Sequence

For concrete cases only (no interface types in cases), the compiler emits:

```asm
MOVQ  x_type+0(FP), AX     ; load _type
TESTQ AX, AX               ; nil?
JEQ   case_nil_or_default
LEAQ  type·int(SB), CX
CMPQ  AX, CX
JEQ   case_int
LEAQ  type·string(SB), CX
CMPQ  AX, CX
JEQ   case_string
JMP   default
```

Each case is one compare + one branch. Linear scan; no hashing.

### 3.5 Mixed Concrete + Interface Cases

```go
switch x.(type) {
case io.Reader:
    // ...
case *os.File:
    // ...
}
```

The compiler emits a `getitab` call for the interface case, falling through to direct compares for concrete cases. The first matching wins, so concrete-type cases under an interface case may be dead code.

### 3.6 Many Cases — Linear vs Tree

Currently the gc compiler uses a linear search of cases. There's no jump-table optimization for type switches because `_type` pointers don't have a useful numeric order. With dozens of cases, performance is O(N) in the worst case.

If you need O(1) dispatch on type, build a `map[reflect.Type]Handler` yourself.

---

## 4. Reading the Assembly

Take this trivial program:

```go
package main

func describe(x any) int {
    switch x.(type) {
    case int:
        return 1
    case string:
        return 2
    default:
        return 3
    }
}

func main() {
    _ = describe(0)
}
```

Compile with:

```bash
go tool compile -S -N -l main.go > /tmp/asm.txt
```

Excerpt (amd64, Go 1.22, simplified):

```asm
"".describe STEXT size=120
    MOVQ "".x+8(FP), AX           ; AX = x._type
    TESTQ AX, AX
    JEQ default_case
    LEAQ type:int(SB), CX
    CMPQ AX, CX
    JEQ case_int
    LEAQ type:string(SB), CX
    CMPQ AX, CX
    JEQ case_string
default_case:
    MOVQ $3, "".~r0+16(FP)
    RET
case_int:
    MOVQ $1, "".~r0+16(FP)
    RET
case_string:
    MOVQ $2, "".~r0+16(FP)
    RET
```

Note:
- `type:int(SB)` is the global type descriptor for `int`.
- Each case is one compare-and-branch.
- The `nil` case (not present in source) folds into the implicit default.

---

## 5. Concrete vs Interface Cases — Cost

| Case kind | Runtime cost |
|-----------|--------------|
| `case ConcreteT:` | one pointer compare |
| `case InterfaceT:` | `getitab` (cached) — pointer compare on cache hit; full method-set check on miss |
| `case nil:` | one nil-test |
| `case T1, T2, ...:` | N pointer compares (one per listed type) |
| `default:` | unconditional jump |

### 5.1 Interface-Case Cost on First Call

Building an `itab` requires:
- Hashing `(inter, typ)`.
- Checking that `typ` implements every method of `inter` (linear in method count).
- Allocating the `itab` struct.

This happens **once per (interface, concrete type) pair** for the lifetime of the program. Subsequent matches are O(1).

### 5.2 Hot-Path Pattern

```go
// Lots of calls — itab gets cached on first call
for _, x := range stream {
    switch x.(type) {
    case io.Reader: handleReader(x)
    case io.Writer: handleWriter(x)
    }
}
```

After the first iteration of each branch, the itab cache is warm. No further allocation.

---

## 6. The Bound Variable's Underlying Layout

In `case T:`, the bound `v` is **the data field of the interface, reinterpreted as T**:

- For a concrete `T` that fits in a pointer (or where `_type.kind` says direct iface): `v = *(*T)(unsafe.Pointer(&iface.data))` — but more typically `v = iface.data` cast to T.
- For larger types, the iface holds a pointer to the heap-allocated value: `v = *(*T)(iface.data)` — a memory load.

This means `case BigStruct:` materializes `v` by copying the struct out of the heap. Avoid huge structs in case clauses.

For `case InterfaceT:`, the bound `v` is `iface{itab, data}` constructed from the matched itab.

---

## 7. Boxing Cost

Every value passed to `switch v := x.(type)` must already be in interface form. If the call site does `describe(42)`, the compiler boxes the `int` into an `eface`, allocating on the heap (unless escape analysis proves it can stay on the stack).

Boxing cost:
- Direct types (small ints, ptrs): 0 — `data` holds the value directly, no heap alloc.
- Indirect types (structs, large ints): heap allocation of the value, set `data` to point at it.

This boxing dominates the cost of the type switch itself for large structs.

```go
// Cheap — int is direct
describe(42)

// Expensive — copies BigStruct to heap
describe(BigStruct{...})
```

---

## 8. Generics and Type Switches

A type switch on a generic parameter:

```go
func handle[T any](x T) {
    switch v := any(x).(type) {
    case int:    /* ... */
    case string: /* ... */
    }
}
```

This compiles as for `any`. The `T` is erased into `any` first; you pay the boxing cost.

In Go 1.21+ there's also a special form for type-asserting against a constraint:

```go
type Numeric interface {
    int | float64 | string
}

// Use type set in a different way; no runtime switch.
```

Type sets aren't reflected at runtime — they're a compile-time constraint. They don't substitute for a runtime type switch when the operand is `any`.

---

## 9. Concurrency

Type switches themselves are not concurrent-sensitive — reading the iface header is atomic at the word level on all supported architectures. The danger is the **bound `v`**: if it's a pointer or slice and another goroutine mutates it, normal Go concurrency rules apply.

The `itab` cache is itself concurrent-safe (uses atomic loads + a lock for writes).

---

## 10. Garbage Collection Interaction

The dynamic type pointer (`_type`) and the data pointer in an interface header are GC roots. A type switch doesn't create new GC pressure beyond the existing iface value.

For large boxed structs, the heap allocation done at boxing time is the GC-visible cost, not the switch.

---

## 11. SSA & Compiler Notes

In the SSA passes (visit `cmd/compile/internal/ssa`), type switches are represented as a sequence of `OpInterCall`-like nodes that compare the dynamic type to constants. Look for:
- `lowerSwitch` in `cmd/compile/internal/ssa/lower.go`
- Walk pass: `cmd/compile/internal/walk/switch.go` — `walkSwitchType`

`walkSwitchType` is the function that translates source-level type switches to runtime checks. Reading it gives you ground truth about what cases compile to.

```bash
# Look at it locally:
go env GOROOT
# Then: $(go env GOROOT)/src/cmd/compile/internal/walk/switch.go
```

---

## 12. Edge Case — Embedded Interfaces

```go
type R interface{ Read() }
type W interface{ Write() }

type RW interface{ R; W }

func dispatch(x any) {
    switch x.(type) {
    case RW: /* implements both */
    case R:  /* implements only R or also W */
    case W:  /* implements only W */
    }
}
```

Order matters strongly here. `RW` must come first; otherwise an `RW`-implementing value matches the `R` case and you lose the discrimination.

---

## 13. Edge Case — Pointer vs Value Receiver

If `T` has methods with pointer receivers, `*T` implements an interface but `T` doesn't. A type switch reflects this:

```go
type stringer interface{ String() string }

type Foo struct{}
func (f *Foo) String() string { return "foo" }

var x any = Foo{}
switch x.(type) {
case stringer: // does NOT match — Foo (value) doesn't have String
case Foo:      // matches
}

var y any = &Foo{}
switch y.(type) {
case stringer: // matches — *Foo has String
case *Foo:     // would match too (after stringer wins, this is dead)
}
```

The method-set rules of the language apply identically to type switches.

---

## 14. Production Patterns

### 14.1 Hot-Path Optimization

For a type switch on a hot path with many cases:

1. Profile (`pprof`) to confirm it's the bottleneck.
2. Reorder cases by frequency if profiling shows asymmetry.
3. Replace with a `map[reflect.Type]Handler` for O(1) dispatch.
4. Or replace with a sealed interface + method dispatch for monomorphic call sites.

### 14.2 Avoiding `getitab` Misses on Startup

If your program does many distinct type switches at startup, the first call of each pays for itab construction. Pre-warm the cache at init by performing a dummy assertion:

```go
func init() {
    var x any = (*MyImpl)(nil)
    _, _ = x.(MyInterface) // build itab
}
```

This is rarely worth the complexity, but useful for latency-sensitive startup.

### 14.3 Sealed Interfaces

```go
type Sealed interface{ sealed() }

type A struct{}; func (A) sealed() {}
type B struct{}; func (B) sealed() {}

func dispatch(s Sealed) {
    switch x := s.(type) {
    case A: /* ... */
    case B: /* ... */
    }
}
```

The unexported `sealed()` method limits implementations to the package. The compiler still doesn't check exhaustiveness — use `staticcheck`'s SA-style exhaustiveness or the third-party `exhaustive` linter.

### 14.4 Reading `runtime/iface.go`

Time well spent. The file is small (~700 lines) and explains:
- `getitab` cache.
- `iface` vs `eface` representation.
- `assertI2I`, `assertE2I`, `assertI2T`, etc. — the runtime entry points the compiler emits.

---

## 15. Production Incidents

### 15.1 Latent Order-Dependence Bug

A team added a `case net.Error:` after `case *net.OpError:`. Concrete case worked. Months later, someone "cleaned up" by reordering cases alphabetically — `net.Error` moved up, `*net.OpError` became dead code, and tests didn't catch it because the only test exercised the interface case.

Fix: keep concrete cases before interface cases that they implement. Add a comment explaining the order. Add a test for each case path.

### 15.2 Heavy Boxing in Hot Loop

```go
for _, n := range numbers {
    describe(n) // describe(any)
}
```

`numbers` was `[]int64`. The loop boxed every int64 into an `any`. Profile showed 80% of allocations from this single loop.

Fix: monomorphize the function (`describeInt64`) or use generics. Boxing went away; allocation pressure dropped to near zero.

### 15.3 itab Cache Size Surprise

A program loaded thousands of plugins, each with its own concrete types implementing a few stdlib interfaces. The `itab` cache grew to occupy several MB. Not a leak — just unbounded valid entries.

The cache is unbounded by design (typed entries are stable). If your design generates thousands of (interface, type) pairs, expect proportional memory use.

---

## 16. Self-Assessment Checklist

- [ ] I can explain `eface` vs `iface` and how a type switch reads each
- [ ] I know `getitab` is cached and what its first-call cost is
- [ ] I can read assembly output of a type switch
- [ ] I know boxing dominates type-switch cost for large structs
- [ ] I understand why interface-case order matters
- [ ] I know that pointer vs value receivers affect interface satisfaction in switches
- [ ] I can refactor a type switch into a map dispatcher when needed
- [ ] I understand sealed interfaces don't grant compile-time exhaustiveness

---

## 17. Summary

A type switch lowers to (a) one read of the iface/eface header, (b) one pointer compare per concrete case, and (c) one `getitab` cached lookup per interface case. The bound `v` is a reinterpretation (or copy) of the iface data field as the case type. Boxing the operand into an interface (when it isn't one already) is usually the larger cost. Sealed interfaces and method dispatch are the two main alternatives when type switches grow unwieldy.

---

## 18. Further Reading

- [runtime/iface.go](https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/iface.go)
- [cmd/compile/internal/walk/switch.go](https://cs.opensource.google/go/go/+/refs/heads/master:src/cmd/compile/internal/walk/switch.go)
- [Russ Cox — Go Data Structures: Interfaces](https://research.swtch.com/interfaces)
- [Go internal ABI](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [Go Spec — Type switches](https://go.dev/ref/spec#Type_switches)
